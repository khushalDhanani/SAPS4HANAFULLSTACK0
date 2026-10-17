# WM Sandbox Test Runbook: S/4HANA Client 220 (Warehouse W01)

This runbook is a numbered checklist for the WM consultant to witness and record one controlled execution of Movement Type 201 (Goods Issue to Cost Center).

---

## 1. Prerequisites Checklist

- [ ] **1.1 SPRO `T321` `TBFKZ` Decision for Movement 201:**
  - System baseline: `T321-TBFKZ = 'X'` for `LGNUM = '***'`, `RBLVS = '201'` (`CONFIRMED`).
  - Decision:
    - Option A: Keep `'X'`. Expect 2 TRs generated in `LTBK` and net `0.000` balance in `911/1011201301`.
    - Option B: Transport `TBFKZ = ''`. Expect 1 TR generated in `LTBK` and zero secondary TR.
  - Record chosen option: `[   ]`

- [ ] **1.2 Physical Test Stock Specification in Warehouse `W01`:**
  - Material: `8000009754` or `8000000995` in Plant `1120`, Storage Location `HS01`.
  - Storage Type: `EN1` (FIFO strategy, `T331-STAUS = 'F'`).
  - Storage Unit: Dedicated single SU where total stock equals requested quantity (`1.000 NOS`).
  - Material Master attributes: Non-batch (`MARC-XCHPF = ''`), non-serial (`MARC-SERNP = ''`).
  - Record selected SU number: `[                 ]`
  - Record selected bin in `EN1`: `[                 ]`

- [ ] **1.3 Application Feature Flag Configuration:**
  - Set `WM_TR_REAL_MOVEMENT = true` in `.env.local` or process environment.
  - Activates native 201 TR creation with `BETYP = 'K'` and 10-digit Cost Center `1011201301` in `BENUM`.
  - Record flag state: `[   ]`

---

## 2. Step-by-Step Execution & Snapshot Checklist

### Step 0: Pre-Test Baseline Snapshot
- **Command:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --out docs/abap/raw/snap_0_baseline.json
  ```
- **Fields to Record:**
  - `MARD-LABST` (1120 / HS01): `[                 ]`
  - `LQUA-VERME` (EN1 / Bin): `[                 ]`
  - `LQUA-VERME` (911 / 1011201301): `[                 ]`

---

### Step 1: Create Reservation (Movement 201)
- **Action:** Post Reservation via CAP endpoint `/odata/v4/reservation-entry/createReservationEntry` or SAP GUI `MB21`.
  - Movement Type: `201`
  - Plant: `1120`, SLoc: `HS01`
  - Cost Center: `1011201301`
  - Quantity: `1.000 NOS`
- **Snapshot & Diff:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --out docs/abap/raw/snap_1_res.json
  node tools/snapshot.js diff docs/abap/raw/snap_0_baseline.json docs/abap/raw/snap_1_res.json
  ```
- **Fields to Record:**
  - `RESB-RSNUM`: `[                 ]`
  - `RESB-RSPOS`: `[                 ]`
  - `RESB-BDMNG`: `[                 ]`
  - `RESB-ENMNG`: `[                 ]`
  - `RESB-KZEAR`: `[                 ]`

---

### Step 2: Transfer Requirement Creation / Verification
- **Action:** Created automatically by application or generated via `LB01` referencing Reservation.
- **Snapshot & Diff:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --tr <TBNUM> --out docs/abap/raw/snap_2_tr.json
  node tools/snapshot.js diff docs/abap/raw/snap_1_res.json docs/abap/raw/snap_2_tr.json
  ```
- **Fields to Record:**
  - `LTBK-TBNUM`: `[                 ]`
  - `LTBK-BWLVS`: `[                 ]`
  - `LTBK-BETYP`: `[                 ]`
  - `LTBK-BENUM`: `[                 ]`
  - `LTBK-STATU`: `[                 ]`
  - `LTBP-MENGA`: `[                 ]`
  - `LTBP-TAMEN`: `[                 ]`
  - `LTBP-ELIKZ`: `[                 ]`

---

### Step 3: Create Transfer Order
- **Action:** Create TO referencing TR via CAP endpoint `/odata/v4/tr-to/createTOFromTR` (`autoConfirm: false`) or SAP GUI `LT04`.
- **Snapshot & Diff:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --tr <TBNUM> --to <TANUM> --out docs/abap/raw/snap_3_to.json
  node tools/snapshot.js diff docs/abap/raw/snap_2_tr.json docs/abap/raw/snap_3_to.json
  ```
- **Fields to Record:**
  - `LTAK-TANUM`: `[                 ]`
  - `LTAK-BWLVS`: `[                 ]`
  - `LTAK-KQUIT`: `[                 ]`
  - `LTAP-VLTYP` / `VLPLA`: `[                 ]` / `[                 ]`
  - `LTAP-NLTYP` / `NLPLA`: `[                 ]` / `[                 ]`
  - `LTAP-VSOLA`: `[                 ]`
  - `LTAP-PQUIT`: `[                 ]`
  - `LQUA-VERME` in `EN1`: `[                 ]`
  - `LQUA-VERME` in `911`: `[                 ]`

---

### Step 4: Confirm Transfer Order
- **Action:** Confirm TO via CAP endpoint or SAP GUI `LT12`.
- **Snapshot & Diff:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --tr <TBNUM> --to <TANUM> --out docs/abap/raw/snap_4_confirm.json
  node tools/snapshot.js diff docs/abap/raw/snap_3_to.json docs/abap/raw/snap_4_confirm.json
  ```
- **Fields to Record:**
  - `LTAK-KQUIT`: `[                 ]`
  - `LTAK-QDATU` / `BZEIT`: `[                 ]` / `[                 ]`
  - `LTAP-PQUIT`: `[                 ]`
  - `LTBP-TAMEN`: `[                 ]`
  - `LTBP-ELIKZ`: `[                 ]`
  - `LTBK-STATU`: `[                 ]`
  - `LQUA-VERME` in source bin (`EN1`): `[                 ]`
  - `LQUA-VERME` in destination bin (`911`): `[                 ]`

---

### Step 5: Post Goods Movement (MIGO Goods Issue)
- **Action:** Post GI referencing Reservation via CAP endpoint `/odata/v4/tr-to/postMigoGoodsMovement` or SAP GUI `MIGO`.
- **Snapshot & Diff:**
  ```bash
  node tools/snapshot.js --mat 8000009754 --plant 1120 --wh W01 --tr <TBNUM> --to <TANUM> --mblnr <MBLNR> --out docs/abap/raw/snap_5_migo.json
  node tools/snapshot.js diff docs/abap/raw/snap_4_confirm.json docs/abap/raw/snap_5_migo.json
  ```
- **Fields to Record:**
  - `MATDOC-MBLNR` / `MJAHR`: `[                 ]` / `[                 ]`
  - `MATDOC-ZEILE` / `BWART`: `[                 ]` / `[                 ]`
  - `MATDOC-MENGE`: `[                 ]`
  - `MARD-LABST` (1120 / HS01): `[                 ]`
  - `RESB-ENMNG` / `KZEAR`: `[                 ]` / `[                 ]`
  - Count of secondary TRs in `LTBK` matching `MBLNR`: `[   ]`
  - Secondary `LTBK-TBNUM` (if generated): `[                 ]`
  - Secondary `LTBK-STATU`: `[                 ]`
  - Final net `LQUA-VERME` balance in interim `911 / 1011201301`: `[                 ]`
