#!/usr/bin/env python3
"""Relabel catalog-data-reality.csv from the SAP message already stored in `detail`.
No SAP calls. Run after verify-catalog-depth.py finishes. Writes *-classified.csv."""
import csv, re, sys
from collections import Counter

RULES = [  # first match wins
    ("NOT_IMPLEMENTED", r"data object '.*' not found|not implemented in data provider"),
    ("NEEDS_FILTER",    r"not provided|no parameter provided|mandatory|is missing|required|must be specified"),
    ("NOT_LICENSED",    r"business function .* is not active|only with the full .* scope|switched off in the system"),
    ("BACKEND_DUMP",    r"runtime error|abnormally terminated|unknown internal server error|an exception was raised"),
]

src = sys.argv[1] if len(sys.argv) > 1 else "catalog-data-reality.csv"
out = src.replace(".csv", "-classified.csv")
rows = list(csv.DictReader(open(src)))
for r in rows:
    if r["verdict"] != "ERROR":
        continue
    d = r["detail"].lower()
    r["verdict"] = next((v for v, pat in RULES if re.search(pat, d)), "ERROR")

with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)

c = Counter(r["verdict"] for r in rows)
for k, n in c.most_common():
    print(f"  {k:<18} {n:>7}   {n*100/len(rows):.1f}%")
print(f"\n{len(rows)} entity sets across {len({r['service'] for r in rows})} services -> {out}")

assert not any(re.search(RULES[0][1], r["detail"].lower()) and r["verdict"] == "ERROR" for r in rows)
