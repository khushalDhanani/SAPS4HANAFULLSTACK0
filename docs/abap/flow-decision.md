# WM Architecture Decision Note: Movement Orchestration & TR Lifecycle

**Document Reference:** `docs/abap/flow-decision.md`  
**Date:** 2026-10-13  
**System Target:** SAP S/4HANA Client 220, Warehouse `W01`  
**Scope:** UI5 + CAP/Node, RFC Adapter (`node-rfc`)  
**Audience:** SAP WM Consultant, Solution Architect, Full-Stack Development Team  

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 The Double-Removal & Stranded Stock Problem
When processing reservations via the custom CAP application (`/wm/scan-to`), users observed inventory discrepancies where stock was removed twice in WM while consumed only once in IM (`RESB-ENMNG = 1.000`):
1. **App Staging Step:** The application executed `L_TR_CREATE` upfront, substituting the movement type to `BWLVS 311`. A subsequent Transfer Order (TO) moved physical stock from bin storage into interim destination `921/TRANSFER`.
2. **Goods Movement Step:** Later in the process, the application executed `MIGO` (`BAPI_GOODSMVT_CREATE`) to issue the goods against the reservation (`BWART 201` for Cost Center, `BWART 241` for Asset).
3. **Standard SAP Auto-TR Creation:** Standard IM-WM interface table `T321` has `TBFKZ = 'X'` for movement types 201, 241, 301, and 311 in warehouse `W01`. As a result, standard SAP automatically generated a **second** Transfer Requirement (`LTBK-MBLNR` filled).
4. **Physical Double Removal:** Because standard MIGO posts goods issue against interim storage type `911` (for 201) or `913` (for 241), it created a negative interim quant in `911`/`913`. When operators processed the MIGO-generated TR, an additional unit was picked from warehouse bins to clear `911`/`913`. Meanwhile, the original unit picked by the app's initial TO sat **orphaned in `921/TRANSFER`**.

### 1.2 Live Audit Evidence (Client 220)
*All statements below are `CONFIRMED (read from code/system)`*:
- **TR `0001000757`** (App TR, Res `0000525278`, Mvt 201, Material `8000009754`): `LTBK-BWLVS = '311'`, `MBLNR = ''`. Linked TO `0001037270` (`VLTYP = '902'`, `NLTYP = '921'`, `NLPLA = 'TRANSFER'`, `VSOLA = 1.000`, confirmed at `16:02:39`).
- **TR `0001000759`** (MIGO TR, Doc `4900050142`, Mvt 201, Material `8000009754`): `LTBK-BWLVS = '201'`, `MBLNR` filled, `RSNUM = '0000000000'`. Linked TO `0001037277` (`VLTYP = '902'`, `NLTYP = '911'`, `NLPLA = '1011201301'`, `VSOLA = 1.000`, confirmed at `18:08:11`).
- **TR `0001000760`** (App TR, Res `0000525279`, Mvt 241, Material `8900000004`): `LTBK-BWLVS = '311'`, `MBLNR = ''`. Linked TO `0001037271` (`VLTYP = '902'`, `NLTYP = '921'`, `NLPLA = 'TRANSFER'`, `VSOLA = 1.000`, confirmed at `16:24:43`).
- **TR `0001000761`** (MIGO TR, Doc `4900050143`, Mvt 241, Material `8900000004`): `LTBK-BWLVS = '241'`, `MBLNR` filled, `RSNUM = '0000000000'`. Linked TO `0001037272` (`VLTYP = '902'`, `NLTYP = '913'`, `NLPLA = '0000400001'`, `VSOLA = 1.000`, confirmed at `16:51:12`).

---

## 2. Option A: IM-First Architectural Design (Recommended)

Option A aligns the custom application with standard SAP ERP / S/4HANA warehouse picking architecture. Instead of inventing an upfront staging TR with substituted movement types, the application posts the goods movement first and picks from the resulting standard SAP Transfer Requirement.

### 2.1 Process Flow & Execution Sequence
```
[User Action: Scan & Pick]
       │
       ▼
1. Reservation Created / Verified (MB21 / RESB)
       │
       ▼
2. Post Goods Movement (MIGO / BAPI_GOODSMVT_CREATE)
   - Movement Type: Real BWART (201, 241, 301, 311)
   - References: RSNUM / RSPOS
   - Result: SAP generates Material Document (MBLNR / MJAHR)
       │
       ▼
3. Auto-TR Discovery in SAP Gateway / RFC
   - Read LTBK where LGNUM = 'W01', MBLNR = <MBLNR>, MJAHR = <MJAHR>
   - Output: Discovered Transfer Requirement (TBNUM)
       │
       ▼
4. Immediate TO Evaluation (T321-TAFKZ)
   - Query LTAK where LGNUM = 'W01' AND TBNUM = <TBNUM>
   ├─ If TO already exists (Immediate TO created by SAP):
   │    └─ Skip L_TO_CREATE_TR; use existing TANUM
   └─ If no TO exists (Standard behavior observed in W01):
        └─ Execute L_TO_CREATE_TR using discovered TBNUM
       │
       ▼
5. TO Confirmation (L_TO_CONFIRM / LT12)
   - Confirms picking from storage bin to interim clearing zone
   - Clears negative quant in 911 / 913 / 920 / 921 naturally!
```

### 2.2 Finding the Auto TR (`LTBK` Query Contract)
*`CONFIRMED (read from code/system)`*:
When `MIGO` posts with `T321-TBFKZ = 'X'`, SAP Gateway writes the `MBLNR` directly into table `LTBK`:
- **Query Table:** `LTBK`
- **Fields:** `TBNUM`, `BWLVS`, `MBLNR`, `MJAHR`, `STATU`, `BNAME`, `BDATU`, `BZEIT`
- **Where Condition:** `LGNUM = 'W01' AND MBLNR = '${mblnr}' AND MJAHR = '${mjahr}'`
- **Fallback / Safety Window:** Because SAP updates `LTBK` in the same LUW or immediately via update task, if not found within 500ms, retry with exponential backoff up to 3 seconds.

### 2.3 Handling Immediate Transfer Order Creation (`T321-TAFKZ`)
- *`CONFIRMED (read from system)`*: Live query of all 28 MIGO-created TRs in warehouse `W01` over the last 60 days revealed that **0 out of 28** had a TO created in the same second (`sameSecondCount = 0`). TOs were created manually minutes or hours later.
- *Orchestration Logic*:
  1. Inspect `LTAK` with `TBNUM = ltbk.TBNUM`.
  2. If `LTAK` returns a row (`tanum` found):
     - Check `KQUIT` (confirmation flag).
     - If unconfirmed (`KQUIT = ''`), call `L_TO_CONFIRM`.
     - If already confirmed (`KQUIT = 'X'`), return success immediately.
  3. If `LTAK` returns 0 rows:
     - Call `L_TO_CREATE_TR` with `TBNUM`.
     - Call `L_TO_CONFIRM` to complete the transfer order.

### 2.4 Status Model Changes (`srv/common/wmStatus.js`)
*Status lifecycle evolution under IM-First*:

| Status Code | Current Meaning (WM-First) | Proposed Meaning (IM-First) | Step Failed / Criticality |
|---|---|---|---|
| `01` | Reservation Created | Reservation Created | MB21 (Yellow) |
| `11` | TR Creation Error | Goods Issue Error | MIGO (Red) |
| `02` | TR Created | Goods Issue Posted (MIGO Done) | MIGO (Yellow) |
| `12` | TO Creation Error | Auto-TR Discovery Failed | LTBK lookup (Red) |
| `03` | TO Created (unconfirmed) | TO Created (Auto or Manual) | LT04 / LTAK (Yellow) |
| `13` | TO Confirmation Error | TO Confirmation Error | LT12 (Red) |
| `04` | TO Confirmed | TO Confirmed / Complete | LT12 (Green) |
| `05` | Goods Issue Posted | Process Finalized | Complete (Green) |
| `90` | Goods Issue Error | *Deprecated in favor of 11* | - |
| `99` | Cancelled / Reversed | Cancelled / Reversed | Reversal (Red) |

### 2.5 Code Reuse vs. Code Removal
- **Reused Components:**
  - `srv/integration/s4hana/wm/MigoAdapter.js`: Full reuse of `postGoodsMovement` (`BAPI_GOODSMVT_CREATE`).
  - `srv/integration/s4hana/wm/TrToAdapter.js`: Full reuse of `createTOFromTR` (`L_TO_CREATE_TR`), `confirmTO` (`L_TO_CONFIRM`), and FIFO source quant selection (`_resolvePickSourceFromLqua`).
  - CAP Persistence & Logging: `ReservationTrack` and `ReservationLog` entities.
- **Removed / Deprecated Components:**
  - Upfront `L_TR_CREATE` call in `ReservationProcessAdapter.js:160-220` (completely eliminated).
  - Artificial movement type substitution (`s4Bwlvs = '311'`) in `ReservationProcessAdapter.js:170`.
  - Staging zone interim clearing logic for `921/TRANSFER`.

---

## 3. Option B: WM-First Variant with Real Movement Type and BENUM

If warehouse operations mandate that physical bin picking and transfer must be executed and confirmed *before* any financial/inventory goods issue is posted in IM, the application must execute the WM-first flow without creating duplicate TRs or stranding stock.

### 3.1 Why Movement Type 311 Was Substituted
*`CONFIRMED (read from code/system)`*:
In `srv/integration/s4hana/wm/ReservationProcessAdapter.js:169-170`:
```javascript
const s4Bwlvs = sapKey(wmMovementType === '201' || wmMovementType === '241' ? '311' : wmMovementType, 'mvt');
```
- In table `T333` for warehouse `W01`:
  - `BWLVS 201`: Destination `NLTYP = '911'`, `NKDYN = 'X'` (dynamic bin), `BETYP = 'K'` (Cost Center).
  - `BWLVS 241`: Destination `NLTYP = '913'`, `NKDYN = 'X'` (dynamic bin), `BETYP = 'A'` (Asset).
  - `BWLVS 311`: Destination `NLTYP = '921'`, `NKDYN = ''` (static bin `TRANSFER`), `BETYP = ''`.
- When `L_TR_CREATE` is called for a movement type with dynamic coordinates (`NKDYN = 'X'`), ABAP include `LL02AF02` performs mandatory requirement validation:
  ```abap
  257: IF T_LTBA-BETYP IS INITIAL.
  258:   FLG_ERROR = CON_TRUE. " L2 437
  ...
  307: IF T_LTBA-BENUM IS INITIAL.
  308:   FLG_ERROR = CON_TRUE.
  309:   MOVE: CON_MSGID_L2 TO LMESS-MSGID, '438' TO LMESS-MSGNO.
  ```
- Because the original adapter omitted `BENUM` and `BETYP`, `L_TR_CREATE` threw error `L2 438` ("Requirement number required for dynamic coordinates"). To evade this error, the author substituted `BWLVS 311`.

### 3.2 Native `L_TR_CREATE` Execution with Real Movement Types
*`CONFIRMED (read from code/system)`*:
Inspection of table structure `LTBA` in DDIC table `DD03L` confirms:
- **`BETYP`** (`LVS_BETYP`, CHAR 1) exists at **Position 0017**.
- **`BENUM`** (`LVS_BENUM`, CHAR 10) exists at **Position 0018**.
`L_TR_CREATE` accepts movement types 201 and 241 natively when the caller populates these fields:
- For Movement 201: Populate `T_LTBA-BETYP = 'K'` and `T_LTBA-BENUM = CostCenter` (e.g., `'1011201301'`).
- For Movement 241: Populate `T_LTBA-BETYP = 'A'` and `T_LTBA-BENUM = AssetNumber` (e.g., `'0000400001'`).
When populated, `LL02AF01:66/88` dynamically builds `NLPLA = T_LTBA-BENUM`, placing the staging destination into `911/<CostCenter>` or `913/<Asset>`.

### 3.3 Required Customizing Change in `T321`
To prevent MIGO from generating a second TR in WM-First, the WM consultant must modify SPRO table `T321` ("Assignment MM Movement Type --> MM-WM Movement Type"):
- **Key:** `LGNUM = 'W01'`, `BWART = '201'`, `'241'`, `'261'`, `'301'`, `'311'`.
- **Change:** Set **`TBFKZ = ''`** (blank = do not create TR on goods movement).
- **Effect:** When MIGO executes, IM posts inventory consumption without generating an auto-TR in `LTBK`.

### 3.4 CRITICAL WARNING: T321 Change Alone Does NOT Fix 921 Stranding!
> **IMPORTANT ARCHITECTURAL FACT:**  
> Changing `T321-TBFKZ = ''` stops the second TR from being generated, but **IT DOES NOT RESOLVE THE 921 STRANDING BUG** if the app continues to create the TR with `BWLVS 311`.

**Why?**
1. In the current app flow, the initial TO moves stock to `NLTYP = '921'`, `NLPLA = 'TRANSFER'`.
2. When MIGO posts later for movement 201/241, standard SAP IM creates an interim negative quant in **`911`** (for 201) or **`913`** (for 241) via reference movement type `T156S-RBLVS`.
3. Standard MIGO has **zero awareness** of `921/TRANSFER`.
4. As a result, the negative quant in `911`/`913` remains open, and the physical stock in `921/TRANSFER` remains permanently stranded!
5. **Conclusion:** To make WM-first work, the app MUST pass the real movement type (`BWLVS 201/241`) with `BENUM` so that the initial TO stages stock into `911`/`913`, which MIGO will then clear upon posting.

---

## 4. Option C: Post-MIGO TR Cancellation (`L_TR_CANCEL`)

### 4.1 Technical Feasibility
*`CONFIRMED (read from code/system)`*:
Function module `L_TR_CANCEL` **EXISTS** in table `TFDIR`:
- **Function Name:** `L_TR_CANCEL`
- **Main Program:** `SAPLL02A`, Include: `LL02AU09`
- **Interface Parameters:**
  - `I_COMMIT_WORK` (`RL02A-COMMI`)
  - `I_SAVE_ONLY_ALL` (`RL02A-SNWAR`)
  - `I_UPDATE_TASK` (`RL02A-VERBU`)
  - `T_LTBC` (Internal table of structure `LTBC` containing fields `LGNUM`, `TBNUM`, `TBPOS`, `ELIKZ`)
- Setting `T_LTBC-ELIKZ = 'X'` marks the Transfer Requirement completed/cancelled (`LTBK-STATU = 'U'` or `'E'`).

### 4.2 Limitations & Operational Hazards of Option C
1. **Race Condition:** If background jobs (e.g., automated TO creation via `RLAUTA01`) or warehouse operators pick up the auto-TR before `L_TR_CANCEL` executes, a second TO will be generated.
2. **Stranded Stock Unresolved:** `L_TR_CANCEL` cancels the document in `LTBK`/`LTBP`, but it does **nothing** to clear the physical stock stranded in `921/TRANSFER` or the negative quant in `911`/`913`.
3. **Ghost Inventory:** Leaves orphaned inventory in interim storage zones requiring manual `LT01` or `LU04` write-offs.

---

## 5. Architectural Comparison Matrix

| Evaluation Criteria | Option A: IM-First (Standard SAP) | Option B: WM-First + Real Mvt/BENUM + SPRO T321 | Option C: App Staging (311) + Post-MIGO TR Cancel |
|---|---|---|---|
| **Inventory Integrity** | **100% Guaranteed** (No duplicate picking, no stranded quants) | **100% Guaranteed** (If staged to 911/913 and T321-TBFKZ cleared) | **Fails** (Stock stranded in 921; interim quant in 911/913 unlinked) |
| **SPRO Customizing Required?** | **None** (Works on standard SAP customizing) | **Yes** (`T321-TBFKZ = ''` for W01) | **None** |
| **Risk of Stranded Stock in 921** | **Zero** (Standard interim zones used) | **Zero** (Moves directly to 911/913) | **High** (Leaves stock orphaned in 921) |
| **RFC Interface Complexity** | **Low** (Removes `L_TR_CREATE` custom call) | **Medium** (Requires `BENUM`/`BETYP` mapping) | **High** (Requires `L_TR_CANCEL` compensation call) |
| **Alignment with Standard SAP** | **Standard S/4HANA Best Practice** | Non-standard pre-staging | Anti-pattern / Workaround |
| **Immediate TO Support (`TAFKZ`)** | **Full** (Detects & confirms existing TO) | Not applicable | Conflicts with auto-TR |
| **Development Effort** | Low (~1.5 days refactor) | Medium (~3 days refactor + SPRO transport) | High (~4 days complex compensation logic) |
| **Recommendation** | **PRIMARY RECOMMENDATION** | Alternative if business requires physical pre-pick | **NOT RECOMMENDED** |

---

## 6. Consultant Sign-Off & Action Items

1. **Warehouse Process Review:** Confirm whether warehouse operators pick goods *after* MIGO posting (standard goods issue) or if physical picking must occur before MIGO.
2. **Path Selection:**
   - If Standard Goods Issue: Proceed with **Option A (IM-First)**.
   - If Pre-Picking Required: Approve SPRO transport to set `T321-TBFKZ = ''` in `W01`, and approve adding `BENUM`/`BETYP` mapping in `ReservationProcessAdapter.js`.

---

## 7. Test Prerequisites & Sandbox Runbook

### 7.1 `T321-TBFKZ` Configuration State per Scenario
*All customizing settings below cite table `T321` in SAP Client 220 (`CONFIRMED: read from system`)*:
In warehouse `W01`, table `T321` currently has `TBFKZ = 'X'` for movement types `201`, `241`, `261`, `301`, and `311`.

| Scenario / Flow | Desired `T321-TBFKZ` State | What Happens if `T321-TBFKZ` Remains `'X'` |
|---|---|---|
| **Option A (IM-First Flow)** | **`X`** (Standard SAP default) | **Required:** Standard MIGO triggers auto-TR in `LTBK` (`MBLNR` filled). Application discovers this TR and creates TO to pick physical stock and clear interim quant. Zero orphaned quants. |
| **Option B (WM-First, Flag ON, Mvt 201/241)** | **`''`** (Blank via SPRO) | **TBFKZ = X Failure Mode:** MIGO creates an **extra unneeded TR** in `LTBK` and a negative interim quant in `911`/`913`. While the staging TO placed stock in `911`/`913` (clearing physical stock against MIGO), the MIGO-generated TR remains stranded as an open TR (`STATU = ''`) in `LTBK` with 0 TOs. Setting `TBFKZ = ''` suppresses this extra TR. |
| **Current Baseline (WM-First, Flag OFF, 311 Sub)** | N/A (Defective Flow) | **Double Failure:** MIGO creates an extra TR and a negative quant in `911`/`913`. Staging stock sits in `921/TRANSFER`. Result: Double removal if second TR is picked, and permanent ghost stock stranded in `921`. |
| **Transfer 311 (Flag ON)** | **`''`** (Blank) or **`X`** | If `TBFKZ = 'X'`, MIGO creates a second TR for 311. Staging stock in `921/TRANSFER` clears MIGO's interim movement, but an extra TR remains open in `LTBK`. |
| **Transfer 301 (Flag ON)** | **`''`** (Blank) or **`X`** | If `TBFKZ = 'X'`, MIGO creates a second TR for 301. Staging stock in `920/TRANSFER` clears MIGO's interim movement, but an extra TR remains open in `LTBK`. |

### 7.2 Small Test Stock Specification (Consultant Action in Client 220)
To validate the real movement flow without storage unit split errors or serial/batch blocks, the WM consultant must stage a small test quant in Client 220:

- **Material:** `8000000995` (`CONFIRMED: read from MARC/T320/LQUA`):
  - Non-batch managed (`MARC-XCHPF = ''`)
  - Non-serial managed (`MARC-SERNP = ''`)
  - Extended to Plant `1120`, SLoc `HS01` (mapped to Warehouse `W01` in `T320`)
- **Storage Type:** `EN1` (`CONFIRMED: read from T331`):
  - Removal strategy FIFO (`T331-STAUS = 'F'`)
  - Storage Unit managed (`T331-VOLLE = 'X'`)
- **Storage Bin:** `0-L0001-02` (or any empty coordinate in `EN1`)
- **Storage Unit (SU):** e.g. `1000059999`
- **Quantity:** **`1.000` to `5.000 NOS`** (`CONFIRMED: read from T331`):
  - *Critical Constraint:* Because `T331-VOLLE = 'X'` enforces full SU removal, the total stock on the SU must equal the test transfer order quantity (e.g., exactly 1.000 NOS). Creating a large SU (like existing 10,000 NOS quant) causes `VOLLE` partial-pick rejection.
- **Master Data Test Values:**
  - **Cost Center (Movement 201):** `1011201301` (`CONFIRMED: read from CSKS`, `BUKRS 1000`, `KOKRS 1000`, valid through 9999-12-31).
  - **Fixed Asset (Movement 241):** `000000400092` / subnumber `0000` (`CONFIRMED: read from ANLA`, `BUKRS 1000`).

### 7.3 Master Execution & Verification Matrix

| Scenario | Feature Flag State | `T321-TBFKZ` | Expected `LTBK` Rows | Expected `LTAP` Rows | Expected `LQUA` Rows | Expected `MATDOC` Rows | What a FAIL Looks Like |
|---|---|---|---|---|---|---|---|
| **201 Baseline (Flag OFF)** | `WM_TR_REAL_MOVEMENT=false` | `X` | 2 rows: (1) App TR with `BWLVS 311`, `RSNUM` filled; (2) MIGO TR with `BWLVS 201`, `MBLNR` filled | TO 1: From `EN1` to `921/TRANSFER`. If MIGO TR picked: TO 2 from bin to `911/1011201301` | Positive quant left in `921/TRANSFER`; negative quant in `911/1011201301` if TO 2 not created | 1 row: `BWART 201`, `KOSTL 1011201301` | **FAIL:** Stock stranded in `921/TRANSFER`, negative quant open in `911`, or inventory removed twice. |
| **201 Real Mvt (`TBFKZ = X`)** | `WM_TR_REAL_MOVEMENT=true` | `X` | 2 rows: (1) App TR with `BWLVS 201`, `BETYP K`, `BENUM 1011201301`; (2) MIGO TR with `BWLVS 201`, `MBLNR` filled | TO 1: From `EN1` to `911/1011201301` (`VSOLA 1.000`). No TO 2 created. | Net zero in `911/1011201301` (TO 1 stages +1; MIGO consumes -1). 0 quants stranded in 921! | 1 row: `BWART 201`, `KOSTL 1011201301` | **FAIL:** `L_TR_CREATE` rejects with `L2 438` (BENUM missing), or TO destinations to 921 instead of 911. |
| **201 Real Mvt (`TBFKZ = ''`)** | `WM_TR_REAL_MOVEMENT=true` | `''` (SPRO) | **1 row only:** App TR with `BWLVS 201`, `BETYP K`, `BENUM 1011201301`. Zero MIGO TR generated. | 1 row: TO from `EN1` to `911/1011201301` | Net zero in `911/1011201301`. Zero stranded quants in 921 or 911. | 1 row: `BWART 201`, `KOSTL 1011201301` | **FAIL:** Second TR created in `LTBK` (`TBFKZ` not saved in SPRO), or `BENUM` format rejected. |
| **241 Baseline (Flag OFF)** | `WM_TR_REAL_MOVEMENT=false` | `X` | 2 rows: (1) App TR with `BWLVS 311`; (2) MIGO TR with `BWLVS 241`, `MBLNR` filled | TO 1: From `EN1` to `921/TRANSFER` | Positive quant in `921/TRANSFER`; negative quant in `913/0000400092` | 1 row: `BWART 241`, `ANLN1 000000400092` | **FAIL:** Stock stranded in `921/TRANSFER`, negative quant open in `913`. |
| **241 Real Mvt (`TBFKZ = X`)** | `WM_TR_REAL_MOVEMENT=true` | `X` | 2 rows: (1) App TR with `BWLVS 241`, `BETYP A`, `BENUM 0000400092`; (2) MIGO TR with `BWLVS 241`, `MBLNR` filled | TO 1: From `EN1` to `913/0000400092` | Net zero in `913/0000400092`. Zero quants stranded in 921. | 1 row: `BWART 241`, `ANLN1 000000400092` | **FAIL:** `BENUM` passed as 12 chars causing SAP coordinate truncation, or dest not 913. |
| **241 Real Mvt (`TBFKZ = ''`)** | `WM_TR_REAL_MOVEMENT=true` | `''` (SPRO) | **1 row only:** App TR with `BWLVS 241`, `BETYP A`, `BENUM 0000400092`. Zero MIGO TR. | 1 row: TO from `EN1` to `913/0000400092` | Net zero in `913/0000400092`. | 1 row: `BWART 241`, `ANLN1 000000400092` | **FAIL:** Second TR created in `LTBK`, or asset number rejected. |
| **311 Transfer (Flag ON)** | `WM_TR_REAL_MOVEMENT=true` | `X` | 1 or 2 rows: App TR with `BWLVS 311`, `RSNUM = ''` (`CONFIRMED: code`). Extra TR if `TBFKZ = X`. | 1 row: TO from `EN1` to `921/TRANSFER` | Net zero in `921/TRANSFER` after MIGO 311. | 2 rows: (1) Issue from issuing SLoc; (2) Receipt in receiving SLoc | **FAIL:** `L_TO_CREATE_TR` throws `XFELD_WRONG` (caused if `RSNUM` is populated on staging TR). |
| **301 Plant Transfer (Flag ON)** | `WM_TR_REAL_MOVEMENT=true` | `X` | 1 or 2 rows: App TR with `BWLVS 301`, `RSNUM = ''`. Extra TR if `TBFKZ = X`. | 1 row: TO from `EN1` to `920/TRANSFER` | Net zero in `920/TRANSFER` after MIGO 301. | 2 rows: (1) Plant 1 issue; (2) Plant 2 receipt | **FAIL:** Destination bin not `920/TRANSFER`, or cross-plant receiving SLoc unextended in `MARD`. |

### 7.4 Detailed Scenario Analysis: Movement 311 and Movement 301 with Flag ON

#### Movement 311 (Storage Location to Storage Location) Under Flag ON
- **Customizing Contract (`CONFIRMED: read from T333`):**
  - Table `T333` for `LGNUM = 'W01'`, `BWLVS = '311'`: `BETYP = ''`, `VKDYN = ''`, `NKDYN = ''`, `NLTYP = '921'`, `NLPLA = 'TRANSFER'`.
  - Movement 311 does **not** have dynamic coordinates. It stages into static bin `921/TRANSFER`.
  - Therefore, `BETYP` and `BENUM` are left blank (`CONFIRMED: read from system`).
- **Reservation Header Check (`CONFIRMED: read from code/system`):**
  - In `ReservationProcessAdapter.js:239-245`, `isTransferPosting` is `true` for 311.
  - The adapter intentionally leaves `T_LTBA-RSNUM = ''` and `RSPOS = ''` on the WM staging TR.
  - *Why?* If `RSNUM` is passed on a 311 staging TR, SAP FM `L_TO_CREATE_TR` performs strict reservation validations against the issuing storage location that trigger `XFELD_WRONG` or `L3 007` because the reservation is an IM transfer posting, not a standard WM delivery (`CONFIRMED: read from code/tests`).
- **MIGO Execution:**
  - When MIGO posts movement 311, IM posts inventory out of the source SLoc and into the target SLoc.
  - In WM, standard MIGO clears interim storage type `921/TRANSFER`.
  - If `T321-TBFKZ = 'X'`, MIGO creates a second TR. If `T321-TBFKZ = ''`, zero extra TR is created.

#### Movement 301 (Plant-to-Plant Transfer) Under Flag ON
- **Customizing Contract (`CONFIRMED: read from T333`):**
  - Table `T333` for `LGNUM = 'W01'`, `BWLVS = '301'`: `BETYP = ''`, `VKDYN = ''`, `NKDYN = ''`, `NLTYP = '920'`, `NLPLA = 'TRANSFER'`.
  - Movement 301 stages into interim plant transfer zone `920/TRANSFER`.
  - `BETYP` and `BENUM` are left blank (`CONFIRMED: read from system`).
- **Cross-Plant Behavior & Prerequisite Check:**
  - Issuing Plant: `1120`, SLoc `HS01` (Warehouse `W01`).
  - Receiving Plant: e.g. `1600` or `1120`.
  - *`UNSURE` (not read from system for plant 1600)*: Whether receiving plant SLoc is mapped to a warehouse in `T320` or is non-WM managed. If receiving plant is WM-managed in a different warehouse (e.g., `W12`), MIGO 301 will generate an inbound TR in the receiving warehouse.
  - Material must be extended in `MARC`/`MARD` for BOTH plants before attempting 301.

---

### 7.5 Consultant Pre-Test Checklist (Must Do Before First Live Test)

Before executing any live transaction test in Client 220, the WM consultant must perform the following actions:

1. [ ] **Verify `T321` Customizing:**
   - In SPRO (transaction `SPRO` $\rightarrow$ Logistics Execution $\rightarrow$ Warehouse Management $\rightarrow$ Interfaces $\rightarrow$ Inventory Management $\rightarrow$ Define Movement Types $\rightarrow$ Assign MM Movement Type to WM Movement Type):
   - Check entries for Warehouse `W01`, movement types `201` and `241`.
   - Note current `TBFKZ` value (currently `'X'`). Decide whether to test with `TBFKZ = 'X'` (extra TR expected) or apply transport to set `TBFKZ = ''`.
2. [ ] **Post Small Test Stock (`EN1` Full SU):**
   - Execute transaction `LT01` or `MIGO` (movement `561` or `101`) to post test stock for Material `8000000995`:
     - Plant: `1120`
     - Storage Location: `HS01`
     - Storage Type: `EN1`
     - Storage Bin: `0-L0001-02`
     - Storage Unit: e.g. `1000059999`
     - Exact Quantity: `1.000 NOS` (Must be $\le 5$ NOS so that total SU quantity matches TO requested quantity).
3. [ ] **Confirm Cost Center & Asset Master Data:**
   - Verify Cost Center `1011201301` is active in `KS03` for Controlling Area `1000`, Company Code `1000`.
   - Verify Asset `000000400092` / `0000` is active and not deactivated in `AS03` for Company Code `1000`.
4. [ ] **Verify Material Master Flags (`MM03`):**
   - Confirm Material `8000000995` in Plant `1120` has `XCHPF = ''` (Batch management inactive) and `SERNP = ''` (Serial number profile blank).
5. [ ] **Set Environment Flag in Sandbox:**
   - Ensure `WM_TR_REAL_MOVEMENT=true` is exported in the runtime environment before testing the real movement branch. Keep `false` when testing baseline.
6. [ ] **Monitor Interim Bins in `LS26` / `LS24`:**
   - Open transaction `LS26` for Warehouse `W01` and monitor storage types `911`, `913`, and `921`. Confirm that after the full flow (TR $\rightarrow$ TO $\rightarrow$ MIGO), the quant balance in the interim storage type is exactly **0.000**.