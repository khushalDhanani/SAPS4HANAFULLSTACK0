# HU stock collector evidence — analysis of the 06:12Z run (2026-10-26 11:50 IST)

**Mode:** files only; no SAP call, no SAP write by the analyst. Source **RAW2** = `hu-stock-evidence.20261026T061255.raw.json` (`capturedAt` `2026-10-26T06:12:22.747Z`, `mode` `READ-ONLY`, 169 queries, 10 open 311 reservations, 0 skipped reads, `RFC_READ_TABLE` only). `q<n>` = `queries[<n>]`. Every table's fields were confirmed through DD03L in the same run (`schemas`, 16 tables). **No pickability judgement is made; no pool total or shortfall is computed** (user instruction 2026-10-26).

## 1. Warehouse per plant/storage location (RAW2 `locations`, q4–q8)

| Plant/SLoc | T320 LGNUM | T001L XHUPF | T001L VSTEL |
|---|---|---|---|
| 1120/CS02 | `W01` | `X` | `1105` |
| 1150/CS02 | **`W15`** | `X` | `1150` |

Consequence: every earlier "0 LQUA rows in W01" statement for materials 8000009802/9803 queried the wrong warehouse (the 05:31Z collector hardcoded `W01`). Corrected below.

## 2. Open 311 reservations (RAW2 `open311Reservations`, q1/q2; identical rows to the 05:31Z file)

| Reservation/item | Material | Plant/SLoc → UMLGO | Open qty | Warehouse | Open deliveries (RAW2 `deliveries`) |
|---|---|---|---|---|---|
| `0000523654/0001` | …9754 | 1120/CS02 → CIS1 | 1 | W01 | none (q146, q147) |
| `0000524283/0001` | …6485 | 1120/CS02 → HU01 | 1 | W01 | **2**: `0080000097/000010` and `0080000098/000010`, each `LFIMG 1.000 NOS`, `LFART HOD`, `VSTEL 1105`, `WBSTK A`, `KOSTK A`, `LVSTK A` (q148, q151, q152) |
| `0000527591/0001` | …6485 | 1120/CS02 → HU01 | 2 | W01 | none |
| `0000529960/0001` | …9754 | 1120/CS02 → CIS1 | 1 | W01 | none (q155, q156) |
| `0000529959/0001` | …9754 | 1120/CS02 → CIS1 | 1 | W01 | none |
| `0000527588/0001` | …6485 | 1120/CS02 → HU01 | 8 (`10.000 − 2.000`) | W01 | none |
| `0000520235/0001` | …9802 | 1150/CS02 → CIS1 | 1 | W15 | none |
| `0000520235/0002` | …9803 | 1150/CS02 → CIS1 | 1 | W15 | none |
| `0000520236/0001` | …9802 | 1150/CS02 → CIS1 | 1 | W15 | none |
| `0000520236/0002` | …9803 | 1150/CS02 → CIS1 | 1 | W15 | none |

LIPS by `VGBEL = <RSNUM>` returned 0 rows for every reservation; the two deliveries on 524283/1 were found by `RSNUM/RSPOS` (their `VGBEL` is blank).

## 3. Stock per storage type (RAW2 `stockByStorageType`; LQUA q16–q19). Negative quants flagged. No totals.

**Material 8000009754 — W01 / 1120 / CS02 (q16, 20 rows, identical to the 05:31Z rows)**

| LGTYP | Qty | Storage units | Negative quants |
|---|---|---|---|
| `902` | `−5` NOS | 19363–19367 | **⚠ 5 × `1.000-`**, bin `0180000067` |
| `OH1` | `5` | 19363–19367 | none (same LENUMs as the 902 negatives) |
| `911` | `3` | 19348, 19349, 19352 | none |
| `913` | `5` | 19350, 19351, 19369, 19370, 19371 | none |
| `EN1` | `1` | **19372** (bin `1-L0001-04`) | none |
| `921` | `1` | 19368 | none |

**Material 8000006485 — W01 / 1120 / CS02 (q17, 2 rows, identical to 05:31Z)**: `OH1` `2` NOS, HUs 20150, 20151, `LETYP E10`; no negatives.

**Material 8000009802 — W15 / 1150 / CS02 (q18, 3 rows — new)**: `OH1`/`ONHOLD` `3` NOS, HUs 2000019885, 2000019886, 2000019887, `LETYP E10`; no negatives.

**Material 8000009803 — W15 / 1150 / CS02 (q19, 22 rows — new)**

| LGTYP | Qty | Storage units | Negative quants |
|---|---|---|---|
| `902` | `−10` NOS | 20112, 20113, 20114 (bin `0300002084`), 20245–20249 (bin `0300002090`), 20160 (`2.000-`, bin `0300002084`) | **⚠ 9 rows**, `LETYP E1` |
| `OH1` | `10` | same 9 LENUMs, bin `ONHOLD`, `LETYP E1` (20160 = `2.000`) | none |
| `EN1` | `4` | 2000019888, 2000019890, 2000019891, 2000019892, bin `CISBIN`, `LETYP E10` | none |

## 4. Target HUs (RAW2 `huSummaries`, `serials`, LTAP queries)

| HU | LQUA | VEKP (VENUM / STATUS / VPOBJ / VPOBJKEY / VHART / VHILM) | Open TOs | Serial (SER06 → OBJK) |
|---|---|---|---|---|
| 2000019372 | `EN1` / `1-L0001-04`, 1 NOS, `E10` | `0000020535` / `0020` / `12` / `0180000068` / `Z007` / `000000002000000340` | 0 (TOs 0001036666, 0001037361 both `PQUIT X`) | `OBKNR 50049` → **`RKN000111`** |
| 2000019371 | `913` / `0080000134`, 1 NOS | `0000020534` / `0020` / `01` / `0080000134` / `Z007` / `…340` | 0 (3 TOs confirmed) | `RA` |
| 2000020150 | `OH1` / `ONHOLD`, 1 NOS | `0000021384` / `0020` / `12` / `0180000117` / `Z007` / `…340` | 0 | `CON-40-004` |
| 2000020151 | `OH1` / `ONHOLD`, 1 NOS | `0000021385` / `0020` / `12` / `0180000117` / `Z007` / `…340` | 0 | `CON-40-005` |

Serials were read for all 33 HUs in the LQUA results (RAW2 `serials`, one SER06 and one OBJK row each, status `READ`). Every one of the 33 HUs has `VHILM 000000002000000340` (RAW2 `packaging.vekpVhilm`); MARA q141: `000000002000000340` → `VHART Z007`.

## 5. Customizing (RAW2 `t301`, `t301t`, `t319a`)

- **T301 keys** (DD03L): `MANDT`, `LGNUM`, `LGTYP`. W01: 49 codes (q10); W15: 48 codes (q13). Only in W01: `COR FLM OXD POW TOX WRA`; only in W15: `006 007 011 013 100`.
- **T301T (E)** — identical texts in W01 and W15 (q12, q14): `902` "GR Area External Rcpts", `911` "GI Area for Cost Center", `913` "GI Area - Fixed Assets", `921` "Stock Transfers (StLoc)", `EN1` "Gr Engineering material", `OH1` "Gr On-Hold Material".
- **T319A** (q143, q144): W01 → `0001 → E1`, `Z003 → E1`; **no `Z007` row in W01** (CONFIRMED live 06:12Z). W15 → `Z007 → E1`.

## 6. Differences and corrections

| # | Earlier statement | RAW2 | Status |
|---|---|---|---|
| 1 | `hu-stock-evidence-analysis.md` §b and `open-311-hu-stock-review.md` addendum: 1150 materials "0 LQUA rows in W01"; 1150/CS02→W01 mapping Not verified. | 1150/CS02 is **W15**; 9802 has 3 OH1 units, 9803 has 22 rows (902 −10 / OH1 10 / EN1 4). | **Wrong warehouse queried; corrected** (correction appended to both files). |
| 2 | 11:30 report: HU serials Not verified. | All four target HUs and 29 further HUs read; 19372 = `RKN000111` (matches the historical WORKSTATUS line 752). | Resolved. |
| 3 | Live-proof request: VSTEL for 1120/CS02 Not verified; open delivery for 529960/1 Not verified now. | `VSTEL 1105` (q6); 529960/1 has no LIPS rows (q155, q156). | Resolved. |
| 4 | T319A W01/Z007 "not evidenced" (DBTABLOG-based). | Directly read: absent (q143). W15 has `Z007 → E1` (q144). | Confirmed live. |
| 5 | 524283/1: no delivery known. | Two open deliveries `0080000097`, `0080000098` (`HOD`, all status `A`). | New fact. |
| 6 | 1120 LQUA and RESB rows (05:31Z). | Byte-identical in RAW2. | Unchanged. |

## 7. Sensitive-value scan of RAW2

Exact JSON-string matches against `.env.local`: SAP user 0, destination hostname 0, client 0, password 0, system number 0. Substring hits: client (3 digits) 8, all inside longer numbers. No forbidden connection-metadata field names. File mode `0600`, **untracked** (not committed).

## 8. 1150/CS02 reservations — preconditions from the evidence (2026-10-26 12:05 IST; files only; no candidate recommended)

Source: RAW2 unless stated. Plant 1150 / storage location CS02 → warehouse **W15** (T320, q7); T001L `XHUPF X`, `VSTEL 1150` (q8). `VKORG` was not selected in this run → **Not verified**.

| Reservation/item | Material | Open qty | HUs in W15 by storage type (LETYP) | Packaging / T319A W15 | Open deliveries |
|---|---|---|---|---|---|
| `0000520235/0001` | `000000008000009802` | 1 NOS | `OH1`/`ONHOLD`: 2000019885, 2000019886, 2000019887 (`E10`) — q18 | all three HUs `VHART Z007`, `VHILM 000000002000000340`, VEKP `STATUS 0020`, `VPOBJ 12`, `VPOBJKEY 0180000093`; T319A W15 `Z007 → E1` (q144) | none (q161, q162) |
| `0000520235/0002` | `000000008000009803` | 1 NOS | `EN1`/`CISBIN`: 2000019888, 2000019890, 2000019891, 2000019892 (`E10`); `OH1`/`ONHOLD`: 2000020112, 2000020113, 2000020114, 2000020245–2000020249, 2000020160 (`E1`; 20160 qty 2); `902`: the same nine storage units with **negative** quants (`E1`) — q19 | EN1 HUs: `Z007`/`…340`, `STATUS 0020`, `VPOBJ 12`, `VPOBJKEY 0180000093`; 902/OH1 HUs: `Z007`/`…340`, **`STATUS 0010`, `VPOBJ 03`**, `VPOBJKEY 0180000112 / 0180000119 / 0180000122`; T319A W15 `Z007 → E1` | none (q163, q164) |
| `0000520236/0001` | `000000008000009802` | 1 NOS | as 520235/1 (same material pool) | as above | none (q165, q166) |
| `0000520236/0002` | `000000008000009803` | 1 NOS | as 520235/2 | as above | none (q167, q168) |

MARA (q141): `000000002000000340 → VHART Z007`. Serials exist for all 16 W15 HUs (RAW2 `serials`, one SER06/OBJK row each). Shipping point for 1150/CS02: `1150` (q8). The meaning of VEKP `STATUS 0010` / `VPOBJ 03` is **Not verified** (not read from domain texts).

**Plant scope in the app.** There is no app-wide plant allow-list. Scope is the authenticated user's `Plant` attribute (`srv/wm/handling-unit/plantScope.js:12-16`; Admin → unrestricted). In the mocked `[development]`/`[test]` users (`package.json:87-186`) `bob`/`carol` carry `Plant ["1120"]`, `dave` `["1130"]`, `eve` none, `alice`/`khushal` are Admin. **Plant 1150 is not configured for any non-admin mocked user**; an Admin user is not restricted. The live SAP technical user's plant authorizations for 1150 are **Not verified**.

**Preconditions (holds / fails / Not verified) — no candidate recommended**

| Precondition | 520235/1, 520236/1 (9802) | 520235/2, 520236/2 (9803) |
|---|---|---|
| Reservation open (RESB, KZEAR/XLOEK blank) | holds (q2) | holds (q2) |
| Warehouse derived (T320) | holds — W15 | holds — W15 |
| Source SLoc HU-managed / shipping-managed (XHUPF, VSTEL) | holds — `X`, `1150` (q8) | holds |
| Stock of the material in W15 | holds — 3 units, all in `OH1` (pickability of OH1: **PENDING user decision**) | holds — 4 units in `EN1`, 10 in `OH1` (PENDING), 9 negative `902` quants flagged |
| HU packaging type row in T319A for W15 | holds — `Z007 → E1` (unlike W01) | holds |
| LETYP of HU quants vs T319A | **Not verified / mismatch to check**: HU quants are `E10` while T319A W15 maps `Z007 → E1` | EN1 HUs `E10` vs T319A `E1` (same open question); 902/OH1 HUs `E1` |
| No open delivery for the item | holds (0 LIPS rows) | holds |
| Serials present on HUs | holds (one per HU) | holds |
| Serial-number profile of the material (MARC-SERNP) | **Not verified** — MARC not read in this run (added to the collector, not run) | **Not verified** |
| VKORG of 1150/CS02 | **Not verified** (added to the collector, not run) | **Not verified** |
| Plant 1150 within the acting user's plant scope | **Not verified** (not in any mocked non-admin user; live technical user unknown) | **Not verified** |
| BusinessConfig storage-type lists for W15 | fails — unseeded (`db/data/saps4hana.wm-BusinessConfig.csv`); the resolver fails closed | fails |
| VEKP status/object meaning for the 902/OH1 HUs (`0010`/`03`) | n/a | **Not verified** |
