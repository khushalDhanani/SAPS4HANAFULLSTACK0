# Sandbox matrix results

Mode: **EXECUTE (live writes)** | 2026-10-12T07:54:48.635Z | warehouse W01 (cds.s4.warehouseNumber) | CAP http://localhost:4004 | T333 destinations: 201 -> 911/(dynamic), 241 -> 913/(dynamic), 311 -> 921/TRANSFER, 301 -> 920/TRANSFER


## Case 311/full
Test data (read at run time):
```json
{
  "Material": "8900000004",
  "Plant": "1120",
  "StorageLocation": "CS01",
  "Unit": "KG",
  "Available": 1235,
  "Batch": "INJW260001",
  "StorageType": "902",
  "Bin": "0000000000",
  "XCHPF": "X",
  "SERNP": "",
  "RemovalSearch": "A/(blank) -> ***,***",
  "source": "LQUA 0001045016",
  "CompanyCode": "1000",
  "ReceivingStorageLocation": "HS01",
  "ReceivingSource": "MARD 1120/HS01 (WM-managed, T320; XHUPF '' = issuing)"
}
```

POST http://localhost:4004/odata/v4/reservation-entry/createReservationEntry
```json
{
  "MovementType": "311",
  "Plant": "1120",
  "StorageLocation": "CS01",
  "Material": "8900000004",
  "Quantity": 1,
  "Unit": "KG",
  "WarehouseNumber": "W01",
  "Batch": "INJW260001",
  "ReceivingStorageLocation": "HS01"
}
```
HTTP 200
```json
{
  "@odata.context": "$metadata#ReservationEntries/$entity",
  "createdAt": "2026-10-12T07:55:11.054Z",
  "createdBy": "alice",
  "modifiedAt": "2026-10-12T07:55:11.054Z",
  "modifiedBy": "alice",
  "ReservationNo": "0000525875",
  "ReservationItem": "0001",
  "MovementType": "311",
  "WarehouseNumber": "W01",
  "Plant": "1120",
  "StorageLocation": "CS01",
  "Material": "8900000004",
  "MaterialName": "",
  "Quantity": "1.000",
  "Unit": "KG",
  "ReceivingPlant": "",
  "ReceivingStorageLocation": "HS01",
  "CostCenter": "",
  "AssetNo": "",
  "SubNumber": "",
  "TransferRequirement": "0001000802",
  "TransferOrder": null,
  "MaterialDocument": null,
  "MaterialDocYear": null,
  "LogHandle": "LOG_MV4YISL8_2O7YOKX90",
  "ExternalId": "0000525875/0001",
  "Status_code": "02",
  "ErrorMessage": "",
  "ErrorStep": "",
  "ProcessId": null,
  "StatusText": "TR Created",
  "StatusCriticality": 2
}
```
PASS  reservation created  observed="0000525875" expected="RSNUM"
PASS  TR created (status 02)  observed={"Status_code":"02","TR":"0001000802","ErrorMessage":""} expected={"Status_code":"02"}

RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 0.000 |  |  |
LTBK:
| TBNUM | BWLVS | STATU | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|
| 0001000802 | 311 |  | 0000000000 | 20261012 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000802 | 0001 | 000000008900000004 | 1.000 | 0.000 |  |
LTAK:
(no rows)
LTAP:
(no rows)
LQUA:
| LQNUM | WERKS | LGORT | CHARG | VERME | MEINS | LGTYP | LGPLA |
|---|---|---|---|---|---|---|---|
| 0001045078 | 1120 | HS01 | INJW260001 | 3.000 | KG | 922 | TR-ZONE |
| 0001045079 | 1120 | CS01 | INJW260001 | 4.000 | KG | 920 | TRANSFER |
| 0001045016 | 1120 | CS01 | INJW260001 | 1235.000 | KG | 902 | 0000000000 |
| 0001045070 | 1120 | CS01 | INJW260001 | 7.000 | KG | 921 | TRANSFER |
MATDOC:
(no rows)
PASS  RESB item open  observed={"RSPOS":"0001","MATNR":"000000008900000004","WERKS":"1120","LGORT":"CS01","CHARG":"","BDMNG":"1.000","ENMNG":"0.000","KZEAR":"","XLOEK":""} expected={"BDMNG":1,"KZEAR":""}

GET http://localhost:4004/odata/v4/tr-to/lookupTR(tbnum='0001000802',lgnum='W01',docType='TR',tbpos='')
PASS  lookupTR open qty before TO 1  observed=1 expected=1

POST http://localhost:4004/odata/v4/tr-to/createTOFromTR
```json
{
  "lgnum": "W01",
  "tbnum": "0001000802",
  "tbpos": "0001",
  "qty": 1,
  "unit": "KG",
  "batch": "INJW260001",
  "serials": [],
  "autoConfirm": true,
  "autoPostMigo": false
}
```
HTTP 200
```json
{
  "@odata.context": "$metadata#saps4hana.wm.TrToService.TOProcessResult",
  "TransferOrder": "1037290",
  "TransferRequirement": "1000802",
  "TRItem": "0001",
  "ReservationNo": "0",
  "ReservationItem": "",
  "MovementType": "311",
  "Status": "04",
  "StatusText": "TO Confirmed",
  "Confirmed": true,
  "IsConfirmed": true,
  "ConfirmationNumber": "1037290",
  "ConfirmedBy": "KHUSHAL",
  "ErrorStep": "",
  "ErrorMessage": "",
  "Material": "8900000004",
  "MaterialName": "5-CVC Crude Jobwork Material",
  "Plant": "1120",
  "StorageLocation": "CS01",
  "Quantity": 1,
  "ConfirmedQuantity": 1,
  "Unit": "KG",
  "Batch": "INJW260001",
  "Serials": [],
  "Success": true,
  "Message": "Transfer Order 1037290 created and confirmed successfully.",
  "ProcessId": "d839235b-77aa-4ecb-8858-b18660a7d0c6"
}
```
PASS  TO 1 created and confirmed (status 04)  observed={"TransferOrder":"1037290","Status":"04","ErrorMessage":""} expected={"Status":"04"}

RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 0.000 |  |  |
LTBK:
| TBNUM | BWLVS | STATU | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|
| 0001000802 | 311 | E | 0000000000 | 20261012 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000802 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037290 | 0001000802 | 311 | X | 20261012 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037290 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 | INJW260001 |
LQUA:
| LQNUM | WERKS | LGORT | CHARG | VERME | MEINS | LGTYP | LGPLA |
|---|---|---|---|---|---|---|---|
| 0001045078 | 1120 | HS01 | INJW260001 | 3.000 | KG | 922 | TR-ZONE |
| 0001045079 | 1120 | CS01 | INJW260001 | 4.000 | KG | 920 | TRANSFER |
| 0001045016 | 1120 | CS01 | INJW260001 | 1234.000 | KG | 902 | 0000000000 |
| 0001045070 | 1120 | CS01 | INJW260001 | 8.000 | KG | 921 | TRANSFER |
MATDOC:
(no rows)
PASS  LTAK KQUIT for TO 1037290  observed={"TANUM":"0001037290","TBNUM":"0001000802","BWLVS":"311","KQUIT":"X","BDATU":"20261012"} expected={"KQUIT":"X"}
PASS  LTAP PQUIT for TO 1037290  observed=["X"] expected=["X"]
PASS  LTAP destination = TR header or T333 (921/TRANSFER)  observed=["921/TRANSFER"] expected="921"
PASS  LTBP TAMEN after TO  observed="1.000" expected=1
PASS  LQUA quant at destination type  observed=["922/TR-ZONE:3.000","920/TRANSFER:4.000","902/0000000000:1234.000","921/TRANSFER:8.000"] expected="921"
PASS  LTBK STATU after last TO  observed="E" expected="E"

POST http://localhost:4004/odata/v4/tr-to/postMigoGoodsMovement
```json
{
  "ReservationNo": "0000525875",
  "ReservationItem": "0001",
  "MovementType": "311",
  "Material": "8900000004",
  "Plant": "1120",
  "StorageLocation": "CS01",
  "Unit": "KG",
  "Batch": "INJW260001",
  "TransferOrder": "1037290",
  "Quantity": 1,
  "ReceivingStorageLocation": "HS01",
  "CompleteReservation": true
}
```
HTTP 200
```json
{
  "@odata.context": "$metadata#saps4hana.wm.TrToService.MigoProcessResult",
  "ProcessId": "5c59c16b-3122-4167-b3c3-a0c8f068f60b",
  "ReservationNo": "0000525875",
  "ReservationItem": "0001",
  "TransferOrder": "1037290",
  "MovementType": "311",
  "Quantity": 1,
  "Unit": "KG",
  "Batch": "INJW260001",
  "Serials": [],
  "Success": true,
  "MaterialDocument": "4900050151",
  "MaterialDocYear": "2026",
  "Status": "05",
  "StatusText": "Goods Issue Posted",
  "StockEffect": "Stock transferred to Storage Location HS01",
  "Message": "Material Document 4900050151/2026 posted successfully.",
  "ErrorStep": "",
  "ErrorMessage": ""
}
```
PASS  goods movement 1 posted (status 05)  observed={"Status":"05","MaterialDocument":"4900050151","ErrorMessage":"","ProcessId":"5c59c16b-3122-4167-b3c3-a0c8f068f60b"} expected={"Status":"05"}

RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 1.000 | X |  |
LTBK:
| TBNUM | BWLVS | STATU | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|
| 0001000802 | 311 | E | 0000000000 | 20261012 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000802 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037290 | 0001000802 | 311 | X | 20261012 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037290 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 | INJW260001 |
LQUA:
| LQNUM | WERKS | LGORT | CHARG | VERME | MEINS | LGTYP | LGPLA |
|---|---|---|---|---|---|---|---|
| 0001045079 | 1120 | CS01 | INJW260001 | 4.000 | KG | 920 | TRANSFER |
| 0001045016 | 1120 | CS01 | INJW260001 | 1234.000 | KG | 902 | 0000000000 |
| 0001045070 | 1120 | CS01 | INJW260001 | 8.000 | KG | 921 | TRANSFER |
| 0001045078 | 1120 | HS01 | INJW260001 | 4.000 | KG | 922 | TR-ZONE |
MATDOC:
| MBLNR | MJAHR | ZEILE | BWART | WERKS | LGORT | CHARG | MENGE | RSPOS | SGTXT | CANCELLED | REVERSAL_MOVEMENT |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4900050151 | 2026 | 0001 | 311 | 1120 | CS01 | INJW260001 | 1.000 | 0001 |  |  |  |
| 4900050151 | 2026 | 0002 | 311 | 1120 | HS01 | INJW260001 | 1.000 | 0001 |  |  |  |
PASS  RESB ENMNG = posted quantity  observed="1.000" expected=1
PASS  RESB KZEAR set (CompleteReservation)  observed="X" expected="X"
PASS  MATDOC rows exist for the document  observed=2 expected=">0"
FAIL  MATDOC SGTXT = ProcessId (CHAR 50, full UUID)  observed=["",""] expected="5C59C16B-3122-4167-B3C3-A0C8F068F60B"
PASS  MATDOC BWART / RSPOS  observed=["311/0001","311/0001"] expected="311/0001"
PASS  MATDOC not cancelled  observed=["",""] expected=""
PASS  MATDOC CHARG = batch  observed=["INJW260001","INJW260001"] expected="INJW260001"


## Summary
| Case | Checks | PASS | FAIL | Result |
|---|---|---|---|---|
| 311/full | 19 | 18 | 1 | FAIL |
