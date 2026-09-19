#!/usr/bin/env python3
"""
Depth verification for every catalogued S/4HANA service.

catalog-audit.csv proves a service ANSWERS. It does not prove it HOLDS ANYTHING.
This walks every service that answered 200, reads its $metadata, enumerates every
entity set, and counts the rows behind each one.

Output: catalog-data-reality.csv  (service,path,entityset,rows,verdict,detail)

Verdicts
  DATA          $count returned a positive integer
  EMPTY         $count returned 0
  NEEDS_FILTER  SAP demands a mandatory filter/key before it will count
  NOT_COUNTABLE function import, or $count unsupported on that segment
  FORBIDDEN     403 - service answers, this user may not read it
  ERROR         anything else, with the SAP message

Resumable: re-run after an interruption and it skips services already written.

  ./verify-catalog-depth.py              # all 200-services, 6 at a time
  PAR=3 ./verify-catalog-depth.py        # gentler
  LIMIT=25 ./verify-catalog-depth.py     # smoke test on 25 services first
"""
import csv, json, os, re, sys, threading, queue, time
import urllib.request, urllib.error, base64
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, "catalog-data-reality.csv")
PAR   = int(os.environ.get("PAR", "6"))
LIMIT = int(os.environ.get("LIMIT", "0"))

env = {}
for fn in (".env.local", ".env"):
    p = os.path.join(ROOT, fn)
    if not os.path.exists(p): continue
    for line in open(p):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env.setdefault(k, v.strip().strip('"').strip("'"))   # strip quotes - this bit locked an account once

HOST   = env["S4_DESTINATION_URL"].rstrip("/")
CLIENT = env.get("S4_CLIENT", "220")
AUTH   = "Basic " + base64.b64encode(("%s:%s" % (env["S4_USERNAME"], env["S4_PASSWORD"])).encode()).decode()
HDRS   = {"Authorization": AUTH, "sap-client": CLIENT}


def fetch(path, timeout=25):
    req = urllib.request.Request(HOST + path, headers=HDRS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        try: body = e.read()
        except Exception: body = b""
        return e.code, body
    except Exception as e:
        return 0, str(e).encode()


def sap_error(body):
    """Pull the SAP /IWFND code and message out of an OData error payload."""
    t = body.decode("utf-8", "replace")
    code = re.search(r"/IWFND/[A-Z_]+/\d+", t)
    msg  = re.search(r"<message[^>]*>([^<]*)</message>", t)
    if not msg:
        m2 = re.search(r'"message"\s*:\s*(?:{[^}]*"value"\s*:\s*)?"([^"]{0,200})"', t)
        msg = m2
    return (code.group(0) if code else ""), (msg.group(1)[:160].replace(",", ";") if msg else t[:120].replace(",", ";").replace("\n", " "))


def entity_sets(metadata_bytes):
    """Entity set names from an OData $metadata document (V2 and V4)."""
    try:
        root = ET.fromstring(metadata_bytes)
    except Exception:
        return [], []
    sets, funcs = [], []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        name = el.get("Name")
        if not name:
            continue
        if tag == "EntitySet":
            sets.append(name)
        elif tag in ("FunctionImport", "ActionImport"):
            funcs.append(name)
    return sorted(set(sets)), sorted(set(funcs))


def load_targets():
    """Services that answered 200 in catalog-audit.csv, mapped to their catalog path."""
    paths = {}
    cat = os.path.join(ROOT, "srv/external/all_catalog_services.json")
    for x in json.load(open(cat)):
        p = re.sub(r"^https?://[^/]+", "", x["ServiceUrl"]).rstrip("/")
        paths[x["TechnicalServiceName"]] = p
    targets = []
    with open(os.path.join(ROOT, "catalog-audit.csv")) as f:
        for row in csv.DictReader(f):
            if row["status"] == "200":
                targets.append((row["service"], row.get("path") or paths.get(row["service"], "")))
    return [t for t in targets if t[1]]


def already_done():
    if not os.path.exists(OUT): return set()
    done = set()
    with open(OUT) as f:
        for row in csv.DictReader(f):
            done.add((row["service"], row["path"]))
    return done


lock = threading.Lock()
writer = None
counts = {"DATA": 0, "EMPTY": 0, "NEEDS_FILTER": 0, "NOT_COUNTABLE": 0, "FORBIDDEN": 0, "ERROR": 0}
progress = {"n": 0, "total": 0}


def emit(rows):
    with lock:
        for r in rows:
            writer.writerow(r)
            counts[r[4]] = counts.get(r[4], 0) + 1
        progress["n"] += 1
        fh.flush()
        if progress["n"] % 10 == 0 or progress["n"] == progress["total"]:
            print("  %4d/%d  data=%d empty=%d needs_filter=%d not_countable=%d forbidden=%d error=%d"
                  % (progress["n"], progress["total"], counts["DATA"], counts["EMPTY"],
                     counts["NEEDS_FILTER"], counts["NOT_COUNTABLE"], counts["FORBIDDEN"], counts["ERROR"]),
                  flush=True)


NEEDS_FILTER_HINTS = ("mandatory", "is missing", "required", "must be specified", "no filter")


def classify(status, body):
    if status == 403:
        return "FORBIDDEN", sap_error(body)[1]
    code, msg = sap_error(body)
    low = msg.lower()
    if any(h in low for h in NEEDS_FILTER_HINTS):
        return "NEEDS_FILTER", (code + " " + msg).strip()
    if "not valid" in low or "must be" in low or "cannot be" in low:
        return "NOT_COUNTABLE", (code + " " + msg).strip()
    return "ERROR", ("http %s %s %s" % (status, code, msg)).strip()


def do_service(name, path):
    rows = []
    st, body = fetch(path + "/$metadata", timeout=40)
    if st != 200:
        code, msg = sap_error(body)
        rows.append([name, path, "(metadata)", "", "ERROR", "http %s %s %s" % (st, code, msg)])
        emit(rows); return
    sets, funcs = entity_sets(body)
    if not sets and not funcs:
        rows.append([name, path, "(metadata)", "", "ERROR", "metadata parsed but declares no entity set"])
        emit(rows); return
    for s in sets:
        st2, b2 = fetch("%s/%s/$count" % (path, s), timeout=25)
        txt = b2.decode("utf-8", "replace").strip()
        if st2 == 200 and txt.isdigit():
            n = int(txt)
            rows.append([name, path, s, n, "DATA" if n > 0 else "EMPTY", ""])
        else:
            verdict, detail = classify(st2, b2)
            rows.append([name, path, s, "", verdict, detail])
    for fn in funcs:
        rows.append([name, path, fn + "()", "", "NOT_COUNTABLE", "function/action import - not countable"])
    emit(rows)


def main():
    global writer, fh
    targets = load_targets()
    done = already_done()
    todo = [t for t in targets if (t[0], t[1]) not in done]
    if LIMIT: todo = todo[:LIMIT]
    progress["total"] = len(todo)

    print("host %s  client %s  user %s" % (HOST, CLIENT, env["S4_USERNAME"]))
    print("%d services answered 200 in catalog-audit.csv" % len(targets))
    if done: print("%d already recorded in %s - resuming" % (len(done), os.path.basename(OUT)))
    print("counting rows behind %d services, %d at a time\n" % (len(todo), PAR))
    if not todo:
        print("nothing to do"); return

    # one guarded probe: never hammer a locked account
    st, body = fetch("/sap/opu/odata/sap/API_WAREHOUSE/$metadata", timeout=25)
    if st == 401:
        print("ABORT: 401 on the first call. The SAP user is locked or the password is wrong.")
        print("Not sending anything further - repeated attempts extend a lockout.")
        sys.exit(2)
    print("auth ok (probe returned %s)\n" % st)

    new = not os.path.exists(OUT)
    fh = open(OUT, "a", newline="")
    writer = csv.writer(fh)
    if new: writer.writerow(["service", "path", "entityset", "rows", "verdict", "detail"])

    q = queue.Queue()
    for t in todo: q.put(t)

    def worker():
        while True:
            try: name, path = q.get_nowait()
            except queue.Empty: return
            try: do_service(name, path)
            except Exception as e:
                emit([[name, path, "(service)", "", "ERROR", "probe crashed: %s" % str(e)[:120]]])
            finally: q.task_done()

    t0 = time.time()
    threads = [threading.Thread(target=worker, daemon=True) for _ in range(PAR)]
    for t in threads: t.start()
    for t in threads: t.join()
    fh.close()

    print("\n=== %d services in %.1f min ===" % (len(todo), (time.time() - t0) / 60))
    for k in ("DATA", "EMPTY", "NEEDS_FILTER", "NOT_COUNTABLE", "FORBIDDEN", "ERROR"):
        print("  %-14s %d entity sets" % (k, counts[k]))
    print("\nfull detail: %s" % OUT)


if __name__ == "__main__":
    main()
