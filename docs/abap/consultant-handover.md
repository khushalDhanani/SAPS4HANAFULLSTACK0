# WM Consultant Handover: S/4HANA Client 220 (Warehouse W01)

All statements are marked **`CONFIRMED (read from code/system)`** or **`UNSURE`**. This document contains empirical findings, system reconciliation numbers, and execution constraints; it contains no speculative predictions.

---

## (a) Unexplained Quants (14) & App TO / MIGO Pair Table

### 1. 14 Quants Audit Summary
All 14 quants are confirmed in live system table `LQUA` for Warehouse `W01`:

| Quant | LGTYP / LGPLA | Material | Plant / SLoc | Quantity | Origin TR | Origin TO / MIGO | System State (`CONFIRMED`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `0001045066` | `921 / TRANSFER` | `8000009754` | `1120 / HS01` | `+2.000 NOS` | `0001000806` | TO `0001037294` | Paired with MIGO `4900050154` (+4s) |
| `0001045070` | `921 / TRANSFER` | `8900000004` | `1120 / CS01` | `+10.000 KG` | `0001000804` | TO `0001037292` | Accumulated from 10 TOs (1.000 KG each) |
| `0001043208` | `921 / TRANSFER` | `8000009753` | `1120 / HS01` | `+2.000 NOS` | `0001000797` | TO `0001037288` | Unpaired (0 MIGO within 60s) |
| `0001045086` | `921 / TRANSFER` | `1000000045` | `1120 / CS01` | `+10.000 KG` | `0001000808` | TO `0001037297` | Unpaired (0 MIGO within 60s) |
| `0001045084` | `921 / TRANSFER` | `1000000204` | `1600 / CS01` | `+1.000 KG` | `0001000800` | TO `0001037295` | Paired with MIGO `4900050155` (+3s) |
| `0001045087` | `921 / TRANSFER` | `8000006485` | `1120 / CS02` | `+1.000 NOS` | `0001000810` | TO `0001037298` | Unpaired (0 MIGO within 60s) |
| `0001045088` | `921 / TRANSFER` | `8000006485` | `1120 / CS02` | `+1.000 NOS` | `0001000810` | TO `0001037298` | Unpaired (0 MIGO within 60s) |
| `0001045089` | `921 / TRANSFER` | `8000006485` | `1120 / HS01` | `+5.000 NOS` | `0001000818` | TO `0001037304` | Paired with MIGO `4900050172` (+4s) |
| `0001045079` | `920 / TRANSFER` | `8900000004` | `1120 / CS01` | `+4.000 KG` | `0001000795` | TO `0001037296` | Accumulated from 4 plant transfers |
| `0001044448` | `911 / 1011101301` | `8000009753` | `1120 / HS01` | `-1.000 NOS` | `0001000693` | MIGO `4900049860` | Open TR, 0 TO created |
| `0001044449` | `914 / 0000001011` | `8000009753` | `1120 / HS01` | `-1.000 NOS` | `0001000694` | MIGO `4900049861` | Open TR, 0 TO created |
| `0001044455` | `911 / 1011202701` | `8000001989` | `1120 / HS01` | `-1.000 NOS` | `0001000698` | MIGO `4900049869` | Open TR, 0 TO created |
| `0001044827` | `914 / 4000033120` | `8000001948` | `1120 / HS01` | `-1.000 NOS` | `0001000744` | MIGO `4900050046` | Open TR, 0 TO created |
| `0001045075` | `902 / 0000000000` | `1000000045` | `1120 / CS01` | `-10.000 KG` | `0001000765` | TO `0001037274` | Picked from empty bin (`T331-NEGAT = 'X'`) |

### 2. Table of App TO / MIGO Pairs (Within 60 Seconds)
Matched strictly by `MATNR`, `WERKS`, and $|\text{TO Time} - \text{MIGO Time}| \le 60\text{ s}$ (`CONFIRMED: read from LTAK/LTAP/MATDOC`):

| TO Number | TO Qty (`LTAP-VSOLA`) | TO Time | MIGO Doc / Item | MIGO Qty (`MATDOC-MENGE`) | MIGO Time | $\Delta t$ | Movement |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `0001037286` | `1.000 KG` | 2026-10-12 10:05:06 | `4900050148 / 0001` | `1.000 KG` | 2026-10-12 10:05:09 | +3s | 311 |
| `0001037287` | `1.000 KG` | 2026-10-12 10:36:38 | `4900050149 / 0001` | `1.000 KG` | 2026-10-12 10:36:40 | +2s | 301 |
| `0001037290` | `1.000 KG` | 2026-10-12 13:25:14 | `4900050151 / 0001` | `1.000 KG` | 2026-10-12 13:25:18 | +4s | 311 |
| `0001037291` | `1.000 KG` | 2026-10-12 13:29:02 | `4900050152 / 0001` | `1.000 KG` | 2026-10-12 13:29:06 | +4s | 311 |
| `0001037292` | `1.000 KG` | 2026-10-12 13:43:41 | `4900050153 / 0001` | `1.000 KG` | 2026-10-12 13:43:45 | +4s | 311 |
| `0001037294` | `1.000 NOS` | 2026-10-12 14:56:32 | `4900050154 / 0001` | `1.000 NOS` | 2026-10-12 14:56:36 | +4s | 311 |
| `0001037295` | `1.000 KG` | 2026-10-12 15:01:34 | `4900050155 / 0001` | `1.000 KG` | 2026-10-12 15:01:37 | +3s | 311 |
| `0001037296` | `1.000 KG` | 2026-10-12 15:31:41 | `4900050157 / 0001` | `1.000 KG` | 2026-10-12 15:31:45 | +4s | 301 |
| `0001037299` | `1.000 NOS` | 2026-10-12 17:35:30 | `4900050165 / 0001` | `1.000 NOS` | 2026-10-12 17:35:34 | +4s | 311 |
| `0001037300` | `1.000 NOS` | 2026-10-12 17:39:43 | `4900050166 / 0001` | `1.000 NOS` | 2026-10-12 17:39:45 | +2s | 311 |
| `0001037301` | `1.000 NOS` | 2026-10-12 17:43:03 | `4900050167 / 0001` | `1.000 NOS` | 2026-10-12 17:43:05 | +2s | 311 |
| `0001037302` | `1.000 NOS` | 2026-10-12 17:54:09 | `4900050168 / 0001` | `1.000 NOS` | 2026-10-12 17:54:11 | +2s | 311 |
| `0001037303` | `1.000 NOS` | 2026-10-12 17:57:45 | `4900050169 / 0001` | `1.000 NOS` | 2026-10-12 17:57:47 | +2s | 311 |
| `0001037304` | `1.000 NOS` | 2026-10-13 10:29:22 | `4900050172 / 0001` | `1.000 NOS` | 2026-10-13 10:29:26 | +4s | 311 |

### 3. Unpaired App TOs (0 MIGO Within 60 Seconds)
`0001037270` (311, 1 NOS), `0001037271` (311, 1 KG), `0001037272` (241, 1 KG), `0001037273` (301, 5 KG), `0001037274` (301, 10 KG), `0001037275` (311, 1 KG), `0001037276` (311, 1 KG), `0001037277` (201, 1 NOS), `0001037278` (311, 1 KG), `0001037281` (301, 1 KG), `0001037284` (301, 1 KG), `0001037285` (301, 1 KG), `0001037288` (311, 1 NOS), `0001037289` (311, 1 KG), `0001037297` (311, 10 KG), `0001037298` (311, 1 NOS).

---

## (b) Quantity Reconciliation & Discrepancy Clarification

### 1. Correction of Contradicted Values for TR 795 & TO 37296
- **Raw System Row (`CONFIRMED: read from LTBP`):** TR `0001000795`, `LTBP-MENGE = 1.000 KG`, `LTBP-MENGA = 1.000 KG`, `TAMEN = 1.000 KG`.
- **Raw System Row (`CONFIRMED: read from LTAP`):** TO `0001037296`, `LTAP-VSOLA = 1.000 KG`, `VLTYP = '920'`, `VLPLA = 'TRANSFER'`, `NLTYP = '920'`, `NLPLA = 'TRANSFER'`, `VLQNR = '0001045079'`, `NLQNR = '0001045079'`, `NPPOS = ''`, `VPPOS = ''`, `PQUIT = 'X'`.
- **Raw System Row (`CONFIRMED: read from LTAK`):** TO `0001037296`, `BWLVS = '301'`, `BWART = '301'`, `TBNUM = '0001000795'`, `KQUIT = 'X'`.
- **Re-Read Twice (1 Minute Apart):** Executed at `2026-10-13T06:57:07Z` and `2026-10-13T06:58:08Z`. Both raw RFC responses are **100% identical** (saved unedited to `docs/abap/raw/to_0001037296_read1_*.json` and `docs/abap/raw/to_0001037296_read2_*.json`).
- **Correction of Earlier Contradictions:**
  1. The report claiming `LTBP-MENGE = 4.000` and `LTAP-VSOLA = 4.000` was **WRONG**. The raw TR and TO rows were strictly for **`1.000 KG`**. The `4.000 KG` value exists only in `LQUA-VERME` for Quant `0001045079`.
  2. The earlier read stating `(VLTYP 001, VLPLA 01-01-01, NPPOS 0001045079)` was **WRONG**: `VLTYP` is `920` (not `001`); `VLPLA` is `TRANSFER` (not `01-01-01`, which was an artifact from a unit test mock `reservationMonitorRetry.test.js`); and `NPPOS` is blank `''` (`0001045079` is the quant number `VLQNR`/`NLQNR`, not the bin position).

### 2. Reconciliation of Completed App TOs vs LQUA Balance in 921/920
Calculated from live `LTAP` (`NLTYP/VLTYP IN ('921', '920')`, `PQUIT = 'X'`, `BNAME = 'KHUSHAL'`) and `LQUA` (`CONFIRMED: read from LTAP/LQUA`):

| Material | Total TOs IN (`921+920`) | Total TOs OUT (`921+920`) | Net $\Delta$ (`IN - OUT`) | Current `LQUA` Balance | Balance == Net? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `8900000004` | `18.000 KG` (921: 10, 920: 8) | `1.000 KG` (920: 1) | `17.000 KG` | `14.000 KG` (921: 10, 920: 4) | **NO** (Diff: -3.000 KG) |
| `8000009754` | `2.000 NOS` (921: 2, 920: 0) | `0.000 NOS` | `2.000 NOS` | `2.000 NOS` (921: 2, 920: 0) | **YES** |
| `1000000204` (921 only) | `1.000 KG` (921: 1) | `0.000 KG` | `1.000 KG` | `1.000 KG` (921: 1) | **YES** |
| `1000000204` (All 921/920) | `41,501.000 KG` | `39,500.000 KG` | `2,001.000 KG` | `-19,249.000 KG` (Plant 1600 history) | **NO** |
| `8000006485` | `8.000 NOS` (921: 8, 920: 0) | `1.000 NOS` (921: 1) | `7.000 NOS` | `7.000 NOS` (921: 7) | **YES** |

### 3. Reconciliation: MARD (IM) Stock vs LQUA (WM) Sum per SLoc
Difference calculated strictly as $\text{MARD LABST} - \sum \text{LQUA VERME}$ (`CONFIRMED: read from MARD/LQUA`):

| Material | Plant / SLoc | MARD Unrestricted (`LABST`) | Sum of LQUA Quants | Difference (`MARD - LQUA`) |
| :--- | :--- | :--- | :--- | :--- |
| `8900000004` | `1120 / CS01` | `1240.000 KG` | `1240.000 KG` | **`0.000 KG`** |
| `8900000004` | `1120 / HS01` | `6.000 KG` | `6.000 KG` | **`0.000 KG`** |
| `8900000004` | `1120 / CS02` | `0.000 KG` | `0.000 KG` | **`0.000 KG`** |
| `8000009754` | `1120 / HS01` | `3.000 NOS` | `3.000 NOS` | **`0.000 NOS`** |
| `8000009754` | `1120 / CS02` | `14.000 NOS` | `14.000 NOS` | **`0.000 NOS`** |
| `1000000204` | `1600 / CS01` | `72510.000 KG` | `72510.000 KG` | **`0.000 KG`** |
| `1000000204` | `1600 / CS02` | `1000.000 KG` | `1000.000 KG` | **`0.000 KG`** |
| `1000000204` | `1120 / CS01` | `479766.000 KG` | `55751.000 KG` | **`+424015.000 KG`** (non-WM IM stock) |
| `8000006485` | `1120 / CS02` | `4.000 NOS` | `4.000 NOS` | **`0.000 NOS`** |
| `8000006485` | `1120 / HS01` | `1.000 NOS` | `0.000 NOS` | **`+1.000 NOS`** |

### 4. Why Removal Search Chose 902 (`UNSURE: search trace missing`)
- **T334T (Action A, `LGTKZ = ''`):** `LGTY0 = '***'`, `LGTY1 = '***'` (`CONFIRMED`).
- **T331 (902):** `STAUS = ''`, `NEGAT = 'X'` (`CONFIRMED`).
- **Positive Quants in 902:** Material `8900000004` had `1232.000 KG` in `902 / 0000000000` (`Quant 0001045016`); Material `1000000204` had large positive stock in `902`.
- **Materials with 0 Stock in 902 (`8000009754`, `1000000045`):** Exact runtime decision path that picked from `902` instead of standard bins cannot be definitively proven because runtime search logs were not recorded (`UNSURE: cannot tell`).

### 5. Movement 311 vs 201/241/301 TR Generation (`T321`) & Warehouse W10 Findings
- **14 Pairs MIGO TR Count (`CONFIRMED: read from LTBK`):**
  - Movement 311 (12 pairs): **0 MIGO-created TRs**.
  - Movement 301 (2 pairs): **2 MIGO-created TRs** (Pair TO `0001037287` $\leftrightarrow$ MIGO `4900050149` created TR `W01/0001000795` for issuing warehouse and TR `W10/0001001222` for receiving warehouse).
- **Why Movement 311 Gave No TR (`CONFIRMED: read from T321`):**
  - In `T321` for `RBLVS = '311'`, warehouse-specific `W01` rows only exist for `SOBKZ = 'E'` (sales order stock) with `LFART = 'DTR'` and explicit `TBFKZ = ''`.
  - Fallback `***` rows in `T321` only exist for `LFART = 'DOG'` (outbound delivery).
  - The application's 311 transfer posting via BAPI operates on standard unrestricted stock (`SOBKZ = ''`) without delivery document (`LFART = ''`). Because no row matches `SOBKZ = ''` and `LFART = ''` with `TBFKZ = 'X'`, SAP suppresses TR creation for 311.
  - In contrast, movements 201, 241, and 301 have active rows in `T321` with `TBFKZ = 'X'`, causing MIGO to auto-generate a TR when posted.
- **Warehouse W10 & TR `W10/0001001222` Scope:**
  - TR `W10/0001001222`: `LGNUM = 'W10'`, `BWLVS = '302'`, `STATU = ''` (open), `MATNR = '8900000004'`, `WERKS = '1110'`, `LGORT = 'CS01'`.
  - Warehouse `W10` is `"B21/7 HW Internal"` (`T300T`) assigned to Plant `1110` (`T320`).
  - **Scope Status:** `W10` is **OUT OF PROJECT SCOPE** (the application scope is strictly Warehouse `W01`, Plant `1120`, per `package.json` `cds.s4.warehouseNumber`). TR `0001001222` was created automatically by SAP standard cross-plant posting into Plant 1110.

---

## (c) The Single Sandbox Test Specification

Before going live, the consultant must witness one controlled execution:

1. **Pre-Test Snapshot:** Run `node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --out docs/abap/raw/snapshot_before_test.json` to record pre-test baseline.
2. **Feature Flag:** Set `WM_TR_REAL_MOVEMENT = true` (activates native 201 TR with `BETYP K` and 10-digit `BENUM`).
3. **Movement Type:** `201` (Goods Issue to Cost Center).
4. **Cost Center:** `1011201301` (Active in Controlling Area `1000`).
5. **Physical Stock Requirement:**
   - Material `8000009754` in Plant `1120`, SLoc `HS01` or Material `8000000995` in `1120/HS01`.
   - Storage Type `EN1` (Removal strategy FIFO, `T331-STAUS = 'F'`).
   - Must be a **small SU** where total SU stock equals requested quantity (`1.000 NOS`), without batch (`MARC-XCHPF = ''`) and without serials (`MARC-SERNP = ''`).
6. **SPRO `TBFKZ` Decision:**
   - Current state: `T321-TBFKZ = 'X'` (`CONFIRMED`).
   - If kept `'X'`: Consultant must observe 2 TRs in `LTBK`, and net `0.000` balance in `911/1011201301`.
   - If changed to `''` via transport: Consultant must observe 1 TR in `LTBK` and zero extra MIGO TR.
7. **Post-Test Snapshot & Diff:** Run `node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --tr <tr_no> --to <to_no> --mblnr <migo_no> --out docs/abap/raw/snapshot_after_test.json`, then run `node tools/snapshot.js diff docs/abap/raw/snapshot_before_test.json docs/abap/raw/snapshot_after_test.json` to verify exact quant and document delta.

---

## (d) What the Consultant Must NOT Do Before the Test

1. **DO NOT clear or delete interim quants in `921`, `920`, `911`, `914`, or `902`:**
   - Clearing quants via `LT01` or `LI21` destroys the historical audit trail needed to verify why negative quants were generated.
2. **DO NOT change `T321-TBFKZ` globally in SPRO without change governance:**
   - Changing `T321` globally affects all plants and users posting movement 201/241 across the system.
3. **DO NOT change storage type search `T334T` to point movement 201/241 to interim `902`:**
   - The app must pick from physical storage type `EN1`, not from interim receiving bins.
4. **DO NOT execute manual TO confirmations in transaction `LT12` during the automated run:**
   - The app executes chained TO creation and confirmation; manual interference creates lock conflicts (`FOREIGN_LOCK`).
