# Transfer Requirement Creation over RFC — Specification for `ZWM_TR_CREATE`

> **Status:** Proposal & ABAP Specification for SAP S/4HANA DS4 Client 220
> **Target Package:** `Z001`
> **Target Function Group:** `ZWM_FINISHEDGOODS` (same as `ZWM_TO_CREATE_FROM_TR`)
> **Author / Reference:** ABAP Team (DIPAK / BASIS)

---

## 1. Problem Statement & Root Cause

When creating a reservation through `/wm/reservation-entry/create`, `BAPI_RESERVATION_CREATE1` successfully creates and commits the reservation document in SAP S/4HANA (e.g. `0000525273`).

However, the subsequent automated warehouse step — creating a Transfer Requirement (TR) via `L_TR_CREATE` — fails with:
```text
Incompatible Call Rejected, see note 2295840; Called Incompatible Function :L_TR_CREATECPROG:nodeDEST:vheudds4a
```

### Root Cause
Under SAP S/4HANA, classic function module `L_TR_CREATE` (like `L_TO_CREATE_TR`) is placed on the **SAP RFC Blacklist** (Unified Connectivity / UCON, SAP Note 2295840). When an external RFC client (`node-rfc` or external caller) calls `L_TR_CREATE` directly across the gateway, SAP rejects the execution to protect system integrity.

Standard SAP internal ABAP calls to `L_TR_CREATE` remain 100% permitted. This is identical to how `L_TO_CREATE_TR` was resolved on this system: by creating remote-enabled wrapper **`ZWM_TO_CREATE_FROM_TR`** in Function Group `ZWM_FINISHEDGOODS`.

---

## 2. Technical Specification for `ZWM_TR_CREATE`

Create Function Module **`ZWM_TR_CREATE`** in SE37 / ADT:
- **Processing Type:** Remote-Enabled Module (RFC)
- **Function Group:** `ZWM_FINISHEDGOODS`
- **Package:** `Z001`
- **Short Text:** Remote wrapper for Transfer Requirement creation (L_TR_CREATE)

### 2.1 Interface Definition

#### Import Parameters
| Parameter | Type | Default | Description |
|---|---|---|---|
| `IV_LGNUM` | `LGNUM` | | Warehouse Number (e.g. `W01`) |
| `IV_BWLVS` | `BWLVS` | `'311'` | WM Movement Type |
| `IV_MATNR` | `MATNR` | | Material Number |
| `IV_WERKS` | `WERKS_D` | `'1120'` | Plant |
| `IV_LGORT` | `LGORT_D` | `'CS01'` | Storage Location |
| `IV_MENGA` | `MENGA` | | Quantity |
| `IV_ALTME` | `ALTME` | `'KG'` | Unit of Measure |
| `IV_RSNUM` | `RSNUM` | optional | Reservation Number |
| `IV_RSPOS` | `RSPOS` | optional | Reservation Item |
| `IV_COMMIT` | `CHAR1` | `'X'` | Commit Work and Wait |

#### Export Parameters
| Parameter | Type | Description |
|---|---|---|
| `EV_TBNUM` | `LTBK-TBNUM` | Generated TR Number |
| `EV_TBPOS` | `LTBP-TBPOS` | TR Item (typically `0001`) |
| `EV_SUCCESS` | `CHAR1` | Status Flag (`S` = Success, `E` = Error) |
| `EV_MESSAGE` | `BAPI_MSG` | Status / Error Message |

#### Tables
| Parameter | Structure | Description |
|---|---|---|
| `IT_ITEMS` | `LTBA` | Optional multi-item transfer table |
| `ET_MESSAGES` | `BAPIRET2` | Return messages |

---

## 3. ABAP Source Code

The full ABAP source code is stored in [`docs/wm-discovery/pass2/fm_ZWM_TR_CREATE.abap`](file:///Users/khushaldhanani/Desktop/SAPS4HANAFULLSTACK0/docs/wm-discovery/pass2/fm_ZWM_TR_CREATE.abap).

---

## 4. Full-Stack Graceful Fallback

In the CAP and UI layers:
1. `ReservationProcessAdapter.js` tries `ZWM_TR_CREATE` first when available, falling back to `L_TR_CREATE`.
2. If `L_TR_CREATE` triggers Note 2295840 UCON rejection, the error is classified cleanly as:
   `"Auto TR creation deferred: restricted by SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)"`.
3. The reservation is preserved in SAP S/4HANA (Status `01` = Reservation Created).
4. The user is informed via the UI that reservation creation succeeded and that TR processing is deferred for warehouse execution.
