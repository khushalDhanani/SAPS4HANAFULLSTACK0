#!/bin/bash
# Test goods issue 261 posting.
#   ./test-261.sh find                     -> read-only: list open reservation items
#   ./test-261.sh post <RESV> <ITEM> <QTY> -> REAL POST, creates a material document
set -a; . "$(dirname "$0")/.env.local"; set +a
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
SVC="/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV"   # swap per find-postable.sh results
AUTH=(-u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C")

case "$1" in
find)
  F="ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false"
  curl -s "${AUTH[@]}" -H 'Accept: application/json' \
    --get "$H/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem" \
    --data-urlencode "\$filter=$F" --data-urlencode '$top=10' \
  | python3 -c '
import sys,json
d=json.load(sys.stdin).get("d",{}).get("results",[])
if not d: print("no open reservation items"); raise SystemExit
print("%-8s %-5s %-12s %-24s %-5s %-5s %11s %-4s %-4s %s" % (
    "RESV","ITEM","PRODUCT","NAME","PLNT","SLOC","QTY","UOM","MVT","ALLOWED"))
for r in d:
    print("%-8s %-5s %-12s %-24s %-5s %-5s %11s %-4s %-4s %s" % (
        r.get("Reservation",""), r.get("ReservationItem",""),
        r.get("Product",""), r.get("ProductName","")[:23],
        r.get("Plant",""), r.get("StorageLocation",""),
        r.get("ResvnItmRequiredQtyInEntryUnit",""), r.get("EntryUnit",""),
        r.get("GoodsMovementType",""), r.get("GoodsMovementIsAllowed","")))'
  ;;
post)
  RESV=$2; ITEM=$3; QTY=$4
  [ -z "$QTY" ] && { echo "usage: $0 post <RESV> <ITEM> <QTY>"; exit 1; }
  # Read the reservation item so Material + unit come from SAP, not from a guess
  META=$(curl -s "${AUTH[@]}" -H 'Accept: application/json' \
    --get "$H/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem" \
    --data-urlencode "\$filter=Reservation eq '$RESV' and ReservationItem eq '$ITEM'" \
    | python3 -c '
import sys,json
r=json.load(sys.stdin).get("d",{}).get("results",[])
if not r: print("|||"); raise SystemExit
r=r[0]
print("|".join([r.get("Product",""),r.get("EntryUnit",""),r.get("Plant",""),r.get("StorageLocation","")]))')
  MAT=${META%%|*}; REST=${META#*|}; UOM=${REST%%|*}; REST=${REST#*|}; PLANT=${REST%%|*}; SLOC=${REST##*|}
  [ -z "$MAT" ] && { echo "reservation $RESV/$ITEM not found or has no product"; exit 1; }
  echo ">>> REAL POST: 261  resv $RESV/$ITEM  material $MAT  qty $QTY $UOM  plant $PLANT/$SLOC"
  echo ">>> (Ctrl-C within 5s to abort)"; sleep 5

  # CSRF token + session cookies, then post with both in the same session
  J=$(mktemp)
  # CSRF must be fetched from a service this user CAN reach, or the session is never
  # established and the POST fails with "CSRF token validation failed" instead of the
  # real authorization verdict. Same path GoodsIssueAdapter.js:30 uses. Tokens are
  # session-scoped, not service-scoped.
  CSRF_PATH="/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?\$top=1"
  curl -s -c "$J" "${AUTH[@]}" -H 'x-csrf-token: Fetch' -H 'Accept: application/json' \
       -o /dev/null -D /tmp/csrf261 -w 'csrf fetch HTTP %{http_code}\n' "$H$CSRF_PATH"
  # SAP marks SAP_SESSIONID "secure", and this host is plain HTTP, so curl's cookie jar
  # silently drops it. Build the Cookie header from Set-Cookie by hand instead.
  COOKIE=$(grep -i '^set-cookie:' /tmp/csrf261 \
           | sed -e 's/^[Ss]et-[Cc]ookie: *//' -e 's/;.*//' | paste -sd '; ' -)
  TOKEN=$(awk 'tolower($1)=="x-csrf-token:"{print $2}' /tmp/csrf261 | tr -d '\r')
  echo "cookies: ${COOKIE:-<none>}"
  echo "csrf: ${TOKEN:-<none>}   (from MMIM_GR4PO_DL_SRV)"
  [ -z "$TOKEN" ] && echo ">>> WARNING: no token — POST will fail on CSRF, not on authorization"

  NOW=$(python3 -c 'import time;print(int(time.time()*1000))')
  read -r -d '' BODY <<JSON
{"GoodsMovementCode":"03",
 "PostingDate":"/Date($NOW)/","DocumentDate":"/Date($NOW)/",
 "MaterialDocumentHeaderText":"TEST261",
 "to_MaterialDocumentItem":{"results":[
   {"GoodsMovementType":"261","Reservation":"$RESV","ReservationItem":"$ITEM",
    "Material":"$MAT","Plant":"$PLANT","StorageLocation":"$SLOC",
    "EntryUnit":"$UOM","QuantityInEntryUnit":"$QTY"}]}}
JSON
  curl -s -H "Cookie: $COOKIE" "${AUTH[@]}" -H "x-csrf-token: $TOKEN" \
    -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -D /tmp/h261 -w '\n--- HTTP %{http_code} ---\n' -d "$BODY" \
    "$H$SVC/A_MaterialDocumentHeader"
  echo "--- relevant response headers ---"
  grep -i 'x-csrf-token\|sap-.*error\|www-authenticate' /tmp/h261 || echo "(none)"
  rm -f "$J"
  echo ">>> If a document was created, REVERSE IT: MBST in SAP GUI."
  ;;
stock)
  # Unrestricted stock per storage location. Field names taken from
  # GoodsIssueStockUnitClient.js, not guessed.
  PROD=$2; PLANT=${3:-1120}
  [ -z "$PROD" ] && { echo "usage: $0 stock <PRODUCT> [PLANT]"; exit 1; }
  curl -s "${AUTH[@]}" -H 'Accept: application/json' \
    --get "$H/sap/opu/odata/sap/C_STOCKQUANTITYVALUEBYTYPE_CDS/C_STOCKQUANTITYVALUEBYTYPE" \
    --data-urlencode "\$filter=Material eq '$PROD' and Plant eq '$PLANT'" \
    --data-urlencode '$top=20' \
  | python3 -c '
import sys,json
try: d=json.load(sys.stdin).get("d",{}).get("results",[])
except Exception: print("non-JSON response (auth or service error)"); raise SystemExit
if not d: print("no stock rows"); raise SystemExit
print("%-6s %-10s %-14s %14s %s" % ("PLNT","SLOC","STOCKTYPE","QTY","UOM"))
for r in d:
    print("%-6s %-10s %-14s %14s %s" % (
        r.get("Plant",""), r.get("StorageLocation",""),
        r.get("InventoryStockType","") or r.get("MatlWrhsStkTypeName",""),
        r.get("MatlWrhsStkQtyInMatlBaseUnit",""), r.get("MaterialBaseUnit","")))'
  ;;
*) echo "usage: $0 find | $0 stock <PRODUCT> [PLANT] | $0 post <RESV> <ITEM> <QTY>";;
esac
