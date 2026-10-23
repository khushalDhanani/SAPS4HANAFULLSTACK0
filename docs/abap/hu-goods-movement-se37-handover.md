# ABAP Handover: HU_CREATE_GOODS_MOVEMENT SE37 Simulation with Reservation Reference

**Status:** ON HOLD (Pending Task 4a Investigation)
**Hold Reason:** Task 4a live investigation of plant 1120 confirmed:
- Open 311 reservations in shipping-managed SLocs (`CS02`, Path A): **6 items**.
- Open 311 reservations in HU-managed, non-shipping SLocs (Path B): **0 items**.
Because all active reservations fall under Path A (delivery completion flow with HU picking), SE37 simulation of direct `HU_CREATE_GOODS_MOVEMENT` (Path B) is placed ON HOLD.
**Target System:** S/4HANA Client 220  
**Target Include:** `LLHU_GOODS_MOVEMENTU02` (Function Module `HU_CREATE_GOODS_MOVEMENT`, Function Group `HU_GOODS_MOVEMENT`)  
**Context:** Reservation-based 311 HU transfer (`CS02` -> `CIS1`, Plant `1120`, Material `8000009754`, Reservation `529960` / Item `0001`).

---

## 1. Background & Technical Objective

When moving Handling Units (HUs) between Storage Locations using standard HU movement tools (`VLMOVE` or FM `HU_CREATE_GOODS_MOVEMENT`), the header movement structure `HUM_DATA_MOVE_TO` does **not** carry reservation reference fields (`RSNUM` / `RSPOS`).

However, the interface of `HU_CREATE_GOODS_MOVEMENT` exposes a changing/table parameter:
```abap
TABLES
  CT_IMSEG STRUCTURE IMSEG OPTIONAL
```
`IMSEG` is the standard MM Inventory Management posting segment structure, which contains:
- `RSNUM` (Reservation Number, 10 char)
- `RSPOS` (Reservation Item, 4 char)
- `KZEAR` (Final Issue indicator, 1 char)

### Core Question for ABAP Developer
Does `HU_CREATE_GOODS_MOVEMENT` in include `LLHU_GOODS_MOVEMENTU02`:
1. **Preserve and pass through** caller-supplied values in `CT_IMSEG` (specifically `RSNUM`, `RSPOS`, and `KZEAR`) into the downstream inventory posting function (`MB_CREATE_GOODS_MOVEMENT` / `WS_DELIVERY_UPDATE`)?
2. Or does it **overwrite / clear** `CT_IMSEG` from internal buffer derivation based solely on `IS_MOVE_TO`?

---

## 2. Code Inspection: Include `LLHU_GOODS_MOVEMENTU02`

Please open transaction **SE38** or **SE37** and inspect include `LLHU_GOODS_MOVEMENTU02`:

1. Search for occurrences of `CT_IMSEG` or `imseg`.
2. Trace the population of `imseg`:
   - Check if lines exist such as:
     ```abap
     IF ct_imseg[] IS INITIAL.
       " Derives IMSEG from HU data...
     ELSE.
       " Reads/merges ct_imseg or loops over ct_imseg...
     ENDIF.
     ```
   - Check whether `imseg-rsnum = ...` or `imseg-rspos = ...` is explicitly assigned or overwritten.
   - Trace whether `ct_imseg` is passed directly into the goods movement function call:
     ```abap
     CALL FUNCTION 'MB_CREATE_GOODS_MOVEMENT'
       TABLES
         imseg = ct_imseg
         ...
     ```
3. Document line numbers and source snippets in this handover file under **Section 5 (Findings)**.

---

## 3. SE37 Simulation Test Instructions

Perform a test run in transaction **SE37** in test/simulation mode (`IF_SIMULATE = 'X'`, `IF_COMMIT = ' '`).

### Test Setup:
- **Function Module:** `HU_CREATE_GOODS_MOVEMENT`
- **Target Reservation:** `0000529960` / Item `0001`
- **Material:** `8000009754`
- **Plant:** `1120`
- **Source SLoc:** `CS02`
- **Target SLoc:** `CIS1`
- **Quantity:** `1.000 NOS`
- **Available HU in CS02:** (e.g. `2000019372` or test HU containing `8000009754`)

### Import Parameters:
| Parameter | Type | Value | Notes |
| :--- | :--- | :--- | :--- |
| `IF_EVENT` | `HUWBEVENT` | `'0006'` | Storage Location to Storage Location transfer |
| `IF_TCODE` | `TCODE` | `'VLMOVE'` | Transaction code context |
| `IF_SIMULATE` | `XFELD` | `'X'` | Simulation mode (zero database changes) |
| `IF_COMMIT` | `XFELD` | `' '` | Explicit NO commit |
| `IS_MOVE_TO-WERKS` | `WERKS_D` | `'1120'` | Target plant |
| `IS_MOVE_TO-LGORT` | `LGORT_D` | `'CIS1'` | Target storage location |

### Table Parameters:

#### `IT_VENUM`:
| VENUM / EXIDV | Notes |
| :--- | :--- |
| `<INTERNAL_VENUM>` or `<EXIDV>` | Set to the internal/external ID of the test HU in `CS02` |

#### `CT_IMSEG` (Pre-filled):
| Field | Value | Description |
| :--- | :--- | :--- |
| `MATNR` | `'8000009754'` | Material number |
| `WERKS` | `'1120'` | Plant |
| `LGORT` | `'CS02'` | Issuing storage location |
| `BWART` | `'311'` | Movement type |
| `UMLGO` | `'CIS1'` | Receiving storage location |
| `UMWRK` | `'1120'` | Receiving plant |
| `ERFMG` | `1.000` | Quantity |
| `ERFME` | `'NOS'` | Unit of measure |
| `RSNUM` | `'0000529960'` | **Reservation Number** |
| `RSPOS` | `'0001'` | **Reservation Item** |
| `KZBEW` | `' '` | Movement indicator |

---

## 4. Test Results Recording Table

| Test Case | Mode | Input Pre-fill | HU Status After (`VEKP`/`VEPO`) | RESB After (`ENMNG`, `KZEAR`) | Material Document (`MBLNR`) | Return Messages (`CT_MESSAGES`) | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-01: Baseline Simulation** | `IF_SIMULATE = 'X'` | `CT_IMSEG` empty; only `IS_MOVE_TO` set | *PENDING* | *PENDING* | *PENDING* | *PENDING* | **PENDING** |
| **TC-02: Pre-filled CT_IMSEG Simulation** | `IF_SIMULATE = 'X'` | `CT_IMSEG` pre-filled with `RSNUM=529960`, `RSPOS=1` | *PENDING* | *PENDING* | *PENDING* | *PENDING* | **PENDING** |
| **TC-03: Live Testrun / Rollback** | `IF_SIMULATE = ' '` (explicit rollback) | `CT_IMSEG` pre-filled | *PENDING* | *PENDING* | *PENDING* | *PENDING* | **PENDING** |

*All results currently marked PENDING awaiting ABAP developer execution in SAP GUI.*

---

## 5. ABAP Findings & Code Trace Notes

*(To be filled by ABAP developer upon code inspection of `LLHU_GOODS_MOVEMENTU02`)*

- **CT_IMSEG Handling:** `[Pending code review in SE38/SE37]`
- **Does CT_IMSEG get overwritten?** `[Pending code review]`
- **Downstream Goods Movement Call:** `[Pending code review - identify whether MB_CREATE_GOODS_MOVEMENT, WS_DELIVERY_UPDATE, or other FM is invoked]`
- **Reservation update verification:** If `CT_IMSEG-RSNUM` is preserved, verify whether `RESB-ENMNG` is updated upon posting.
