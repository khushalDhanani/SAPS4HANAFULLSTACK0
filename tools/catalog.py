#!/usr/bin/env python3
"""Search the Gateway catalog dump.
  ./catalog.py quotation delivery      # any term, in name or description
  ./catalog.py -a batch classification # ALL terms must match
  ./catalog.py -p API_                 # name starts with
  ./catalog.py --stats                 # what's in here, by prefix
"""
import json, re, sys, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(ROOT, 'srv/external/all_catalog_services.json')
cat = json.load(open(F))
rows = [(x['TechnicalServiceName'],
         x.get('Description', ''),
         re.sub(r'^https?://[^/]+', '', x['ServiceUrl'])) for x in cat]

args = sys.argv[1:]
need_all = '-a' in args;  args = [a for a in args if a != '-a']

if '--stats' in args:
    pre = collections.Counter()
    for n, _, p in rows:
        s = p.rsplit('/', 1)[-1]
        pre[s.split('_')[0] if '_' in s else s[:4]] += 1
    print(f"{len(rows)} services, {sum(1 for _,_,p in rows if '/scwm/' in p)} in /scwm/\n")
    for k, v in pre.most_common(30):
        print(f"  {k+'_':16} {v}")
    sys.exit()

if '-p' in args:
    i = args.index('-p'); pfx = args[i+1].upper(); del args[i:i+2]
    hits = [r for r in rows if r[0].upper().lstrip('Z').startswith(pfx.lstrip('Z'))]
else:
    terms = [a.lower() for a in args]
    if not terms: print(__doc__); sys.exit()
    def m(r):
        blob = (r[0] + ' ' + r[1]).lower()
        return all(t in blob for t in terms) if need_all else any(t in blob for t in terms)
    hits = [r for r in rows if m(r)]

for n, d, p in sorted(hits, key=lambda r: r[2]):
    print(f"{p:60} {d}")
print(f"\n{len(hits)} match(es)", file=sys.stderr)
