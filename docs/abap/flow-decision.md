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