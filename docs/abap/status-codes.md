# Reservation / WM process status codes

Single value set shared by the JS layer (`srv/common/wmStatus.js`, seeded into `db/data/saps4hana.wm-ReservationStatus.csv`)
and the ABAP mirror (`docs/abap/zcl_res_process.clas.abap` constants `gc_status_*`, domain `ZRES_STATUS` in `docs/abap/zres_track.ddl`).
The JS adapter layer owns the process logic; the ABAP class mirrors it and is not called by the app.

| Code | Meaning | Step | Error? | Retry from here |
|---|---|---|---|---|
| 01 | Reservation Created | MB21 | no | LB01 |
| 11 | TR Creation Error (backend created no Transfer Requirement) | LB01 | yes | LB01 |
| 02 | TR Created | LB01 | no | LT04 |
| 12 | TO Creation Error | LT04 | yes | LT04 |
| 03 | TO Created (not confirmed) | LT04 | no | LT12 |
| 13 | TO Confirmation Error | LT12 | yes | LT12 |
| 04 | TO Confirmed | LT12 | no | MIGO |
| 90 | Goods Issue Error (goods movement failed; retry allowed) | MIGO | yes | MIGO |
| 05 | Goods Issue Posted | MIGO | no | - |
| 99 | Cancelled / Reversed (process cancelled, stock reversed) | - | yes | - |

`99` is never written for a failed step any more; a failed goods movement is `90`. Codes `03` and `13` mean "an unconfirmed
TO exists" and block the creation of another TO for the same TR item until it is confirmed.

## Migration note for existing data (NOT executed)

Rows written before this change used `99` for "MIGO failed". They must become `90` so that retry applies to them again.
Run once, after backup, on the CAP database (SQLite file in development, HANA HDI container in BTP):

```sql
UPDATE saps4hana_wm_ReservationTrack
   SET Status_code = '90'
 WHERE Status_code = '99'
   AND (MaterialDocument IS NULL OR MaterialDocument = '');

UPDATE saps4hana_wm_ReservationLog
   SET Status = '90'
 WHERE Status = '99'
   AND Step = 'MIGO';
```

Rows with `99` that carry a material document are genuine cancellations/reversals and stay `99`.
Until the statement is run, the retry action no longer auto-selects old `99` rows (they are not an error status any more).
