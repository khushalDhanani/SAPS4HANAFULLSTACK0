# HU stock collector evidence — analysis (2026-10-26 11:10 IST)

**Mode:** files only. No SAP call, no SAP write, no tool under `tools/` was run. Every figure below is quoted from `hu-stock-evidence.raw.json` (abbreviated **RAW**; `capturedAt` `2026-10-26T05:31:12.378Z`, `mode` `READ-ONLY`) or from the named earlier evidence file. `RAW q<n>` means `queries[<n>]` of that file.

**Precondition check:** RAW has 27 entries in `queries` and 10 entries in `open311Reservations` — matches the stated 27 / 10.

## a) The four HUs

Serial numbers: RAW contains **no SER06/OBJK query** (no `SERNR`/`OBJK` fields anywhere in the file), so serials are **Not verified** by this collector run. Historical serial statements exist only in `WORKSTATUS.md` lines 691–692 and 752–754 (earlier live reads, not saved as evidence files).

| HU | LQUA LGTYP / LGPLA | GESME / VERME | MEINS | LETYP | VEKP (VENUM, STATUS, VPOBJ, VPOBJKEY, VHART) | VEPO (MATNR, WERKS/LGORT, VEMNG) | TOs touching the HU (LTAP) | Open TOs | Serial |
|---|---|---|---|---|---|---|---|---|---|
| 2000019372 | `EN1` / `1-L0001-04` (RAW q2, LENUM `00000000002000019372`) | `1.000` / `1.000` (RAW q2) | `NOS` | `E10` | `0000020535`, `0020`, `12`, `0180000068`, `Z007` (RAW q6) | `000000008000009754`, `1120`/`CS02`, `1.000 NOS` (RAW q7) | `0001036666` 902/`0180000068` → OH1/ONHOLD, `PQUIT X`; `0001037361` OH1/ONHOLD → EN1/`1-L0001-04`, `PQUIT X` (RAW q8); LTAK `KQUIT X` for both (RAW q9, q10) | 0 | Not verified (RAW has no SER06/OBJK) |
| 2000019371 | `913` / `0080000134` (RAW q2) | `1.000` / `1.000` | `NOS` | `E10` | `0000020534`, `0020`, `01`, `0080000134`, `Z007` (RAW q11) | `000000008000009754`, `1120`/`CS02`, `1.000 NOS` (RAW q12) | `0001036665` 902 → OH1; `0001037360` OH1 → EN1; `0001037372` EN1/`1-L0001-04` → 913/`0080000134`; all `PQUIT X` (RAW q13); LTAK `KQUIT X` (RAW q14–q16) | 0 | Not verified |
| 2000020150 | `OH1` / `ONHOLD` (RAW q3) | `1.000` / `1.000` | `NOS` | `E10` | `0000021384`, `0020`, `12`, `0180000117`, `Z007` (RAW q17) | `000000008000006485`, `1120`/`CS02`, `1.000 NOS` (RAW q18) | `0001037198` 902/`0180000117` → OH1/ONHOLD, `PQUIT X` (RAW q19); LTAK `KQUIT X` (RAW q20) | 0 | Not verified |
| 2000020151 | `OH1` / `ONHOLD` (RAW q3) | `1.000` / `1.000` | `NOS` | `E10` | `0000021385`, `0020`, `12`, `0180000117`, `Z007` (RAW q21) | `000000008000006485`, `1120`/`CS02`, `1.000 NOS` (RAW q22) | `0001037199` 902/`0180000117` → OH1/ONHOLD, `PQUIT X` (RAW q23); LTAK `KQUIT X` (RAW q24) | 0 | Not verified |

VEKP `WERKS` and `LGORT` are blank for all four HUs (RAW q6, q11, q17, q21); `LGNUM` is `W01` for all four.

## b) Open 311 reservations and HU stock by storage type

Open quantity = `BDMNG − ENMNG` as computed in RAW `open311Reservations[*].OpenQty`. Stock = LQUA rows for `LGNUM W01 / WERKS / LGORT CS02 / MATNR` (RAW q2–q5). Units are `NOS` throughout. **No pickability judgement is made.** Per the user's instruction of 2026-10-26 ("until I answer the OH1 question, report stock per storage type and flag negative quants; do not compute a pool total or a shortfall figure"), stock is reported **per storage type only**; negative quants are flagged; **no pool total and no shortfall figure is given**. (An earlier version of this section computed both; it is withdrawn.)

### Material `000000008000009754` — 1120/CS02 (RAW q2: 20 rows, 15 distinct LENUM)

| LGTYP | LENUMs (RAW q2) | Qty (sum of `GESME`) | Negative quants |
|---|---|---|---|
| `902` | 19363, 19364, 19365, 19366, 19367 | `−5.000` | **⚠ 5 rows, each `1.000-` (bin `0180000067`)** |
| `OH1` | 19363, 19364, 19365, 19366, 19367 | `5.000` | none; same LENUMs as the 902 negatives |
| `911` | 19348, 19349, 19352 | `3.000` | none |
| `913` | 19350, 19351, 19369, 19370, 19371 | `5.000` | none |
| `EN1` | 19372 | `1.000` | none |
| `921` | 19368 | `1.000` | none |

Open demand (RAW q25): `0000523654/0001` 1, `0000529960/0001` 1, `0000529959/0001` 1, all `UMLGO CIS1`.

### Material `000000008000006485` — 1120/CS02 (RAW q3: 2 rows)

| LGTYP | LENUMs | Qty | Negative quants |
|---|---|---|---|
| `OH1` | 20150, 20151 | `2.000` | none |

Open demand (RAW q25): `0000524283/0001` 1, `0000527591/0001` 2, `0000527588/0001` 8 (`BDMNG 10.000`, `ENMNG 2.000`), all `UMLGO HU01`.

### Materials `000000008000009802` / `000000008000009803` — 1150/CS02 (RAW q4, q5: 0 rows each)

No LQUA rows in W01 for either material. Open demand (RAW q26): `0000520235/0001` (…9802) 1, `0000520235/0002` (…9803) 1, `0000520236/0001` (…9802) 1, `0000520236/0002` (…9803) 1, all `UMLGO CIS1`.

Caveat: RAW q4/q5 filter on `LGNUM = 'W01'`. Whether 1150/CS02 is assigned to warehouse W01 (T320) is **Not verified** — no T320 row for 1150/CS02 exists in any evidence file. Zero rows may mean "no stock" or "different warehouse". The extended collector derives the warehouse from T320 instead.

Non-open rows also returned by RAW q25/q26 (not in `open311Reservations`): 12 rows for 1120 (KZEAR `X` or XLOEK `X`) and `0000520237/0001` for 1150 (`KZEAR X`).

## c) T301

DD03L for `TABNAME = 'T301'` (RAW q0, 5 rows; also `t301.dd03lRows`):

| FIELDNAME | POSITION | KEYFLAG | ROLLNAME | DATATYPE | LENG |
|---|---|---|---|---|---|
| `MANDT` | `0001` | `X` | `MANDT` | `CLNT` | `000003` |
| `LGNUM` | `0002` | `X` | `LGNUM` | `CHAR` | `000003` |
| `LGTYP` | `0003` | `X` | `LGTYP` | `CHAR` | `000003` |
| `.INCLU--AP` | `0004` | `` | `` | `` | `000000` |
| `GLCGR` | `0005` | `` | `LXYRD_GLCGR` | `CHAR` | `000003` |

Key fields (RAW `t301.keyFields`): `MANDT`, `LGNUM`, `LGTYP`.

W01 storage types (RAW q1 / `t301.storageTypeCodesW01`, `storageTypesQueryStatus` `READ`, 49 codes): `001 002 003 004 005 150 1FL 200 2FL 3FL 4FL 5FL 901 902 904 910 911 912 913 914 915 916 917 918 920 921 922 923 980 998 999 COR EN1 FG1 FLM GFL GS1 IP1 IP2 IP3 IP4 IP5 OH1 OXD POW QC1 RM1 TOX WRA`.

## d) Differences from earlier saved evidence

| # | Earlier statement / file | Now (RAW) | Earlier statement status |
|---|---|---|---|
| 1 | `WORKSTATUS.md` entry 2026-10-26 11:00: "The current DD03L snapshot has zero T301 rows; T301 key fields … are not established." Also Current Status bullets 10:44 / 10:48 / 11:00: T301 keys "unverified", "collector output was absent", "Collector remains unrun". | RAW q0 has 5 DD03L rows; keys `MANDT/LGNUM/LGTYP` CONFIRMED; collector output exists (committed in `73dd412`). | **Superseded** — corrected in WORKSTATUS Current Status (history left as written). |
| 2 | `2026-10-23/t301t-w01-storage-types.json`: 47 W01 codes. | RAW q1: 49 codes; the two extra are `OXD`, `WRA`. Identical to the 49 T301T rows in `2026-10-26/hu-w01-lqua-t301t.raw.json` (`summary.t301tRows` 49). No T301T code is missing from T301. | Not wrong; earlier list is older. |
| 3 | `WORKSTATUS.md` entry 2026-10-26 10:26: "HU 2000019372 … no raw LQUA row was found in the saved evidence; its current location is NOT VERIFIED." and 11:00: "HU 2000019372 current location/quantity/serial … remain unverified". | RAW q2 row LENUM `00000000002000019372`: `EN1` / `1-L0001-04`, `1.000 NOS`, `E10`. Location and quantity CONFIRMED; serial still Not verified. | **Superseded** for location/quantity. |
| 4 | `open-311-hu-stock-review.md` table: material 9754 "One captured HU, 913, qty 1"; material 6485 "Two captured HUs, OH1, qty 1 each"; 1150 materials "No matching LQUA stock evidence saved". | 9754: 20 LQUA rows / 15 LENUM across 902(−5, negative), OH1(+5), 911(3), 913(5), EN1(1), 921(1); no total reported. 6485: unchanged (2 × OH1). 1150 materials: real query, 0 rows in W01. | 9754 and 1150 rows **superseded** (addendum appended to that file; original table retained). |
| 5 | `2026-10-23/resb-open-311-1120-cs02.json` (6 open items) and `…-1150-cs02.json` (4 open items). | RAW q25/q26 return the same 6 + 4 open items with identical BDMNG/ENMNG (incl. `527588/1` `10.000`/`2.000`). RAW additionally returns 13 non-open rows because it did not filter XLOEK/KZEAR. RAW lacks `BDTER`/`XWAOK` which the 10-23 files have. | Unchanged. |
| 6 | `2026-10-23/lqua-bin-913-delivery.json`, `2026-10-23/lqua-hu-hold-indicators.json`, `2026-10-26/hu-hold-indicators.raw.json`, `hu-hold-vekp.raw.json`, `hu-to-storage-unit-movements.raw.json`. | HU 19371 (913/`0080000134`), HUs 20150/20151 (OH1/ONHOLD), their VEKP rows and TO `0001037372` are identical in RAW. | Unchanged. |
| 7 | No earlier VEKP/VEPO/LTAP evidence file for HU 2000019372 or VEKP for 2000019371. | RAW q6–q10 and q11 add them: 19372 `VPOBJ 12`/`0180000068`; 19371 `VPOBJ 01`/`0080000134`; both `VHART Z007`, `STATUS 0020`. | New. |
| 8 | `WORKSTATUS.md` line 750 (historical): "20 rows (15 distinct LENUM storage units; 10 net available units …). Only 1 HU sits in … EN1/1-L0001-04 (2000019372), others in interim bins (911, 913, 921, OH1)." | RAW q2 reproduces 20 rows / 15 LENUM / sole EN1 HU 19372; its "net available" total is not restated here (pending the OH1 decision). | Row counts confirmed; total withdrawn. |

## e) Sensitive-value scan of `hu-stock-evidence.raw.json`

Scanned for host, user, system-number, client, password, token, bearer, URL and IP patterns. **No hit.** The only JSON keys present are SAP field names (`LGNUM`, `MATNR`, …), collector metadata (`capturedAt`, `mode`, `query`, `table`, `fields`, `where`, `rowCount`, `timestamp`, `completedAt`) and the derived sections (`t301`, `huSummaries`, `open311Reservations`). Note: the file is already tracked in Git (added in commit `73dd412`); local mode is `0600`. No action taken.

## Correction 2026-10-26 11:50 IST (06:12Z collector run)

The 05:31Z collector hardcoded `LGNUM = 'W01'`. T320 (RAW2 q7) maps 1150/CS02 to **W15**, so §b's "0 rows in W01" for materials 8000009802/9803 described a wrong-warehouse query, not an absence of stock. In W15: 9802 has 3 OH1 units; 9803 has 22 rows (902 −10 flagged negative, OH1 10, EN1 4). Serials, VSTEL, deliveries and T319A are now verified. See `hu-stock-evidence-analysis-061255.md`.
