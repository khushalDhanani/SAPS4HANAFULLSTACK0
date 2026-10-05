# 261 on WM-managed locations: delivery created instead of a material document

Status: **Open: waiting for the warehouse owner's decision.** No PGI automation is built.

## What SAP does (verified live, read-only, 2026-10-05)

- `POST API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader` (movement 261) for plant 1130 / sloc CS02
  (T320 → warehouse W12) answers 201 with an empty `MaterialDocument` and a `sap-message` header carrying
  **L9/514**.
- SE91 text of L9/514: EN "Delivery & created" / DE "Lieferung & wurde angelegt". Message class L9
  ("Function Modules") is SAP standard: TADIR package LVS, author SAP.
- Where-used (CROSS): L9/514 is raised only in the SAP standard include **MM07MLVS** (the MM-IM → WM
  interface). No Z/Y include references any L9 message.
- Active customer BAdI implementations exist around goods movements and deliveries (for example
  ZMB_DOCUMENT_UPDATE, ZMB_CHECK_LINE_BADI, ZMM_BADI_005, ZZDELIVERY_PUBLISH, ZZLE_SHP_ITEM_STATUS).
  Their source was **not inspected**, so "no custom logic contributes" is **not verified**. The message
  itself comes from standard code.
- The customizing switch that turns this movement into a delivery: **not verified** (T320 OBEST/OBTYP
  are blank for 1130/CS02, so it is not those fields).
- The result is delivery type **HOD** ("Outb.Deliv.GI Mvmnt"), item category HODN, LIPS-BWART 261 and
  LIPS-RSNUM/RSPOS = the reservation item. LIKP-LIFEX = our posting `ReferenceDocument`. The delivery is
  created with WBSTK/KOSTK/LVSTK = A, and no TO exists (LTAK by VBELN is empty).
- RESB withdrawn quantity is unchanged and no MATDOC row exists. **Stock has not moved.**

## What the app does now

- `DELIVERY_CREATED` outcome: the delivery number is persisted on the attempt row and returned. There is
  no retry and no MATDOC polling. The SU claim is kept.
- New 261 posts for a WM-managed item are blocked while SAP shows an open delivery (WBSTK ≠ C) for the
  reservation item. A failed read also blocks (fail closed).
- `recheckPostingAttempts` matches a delivery by LIFEX (exact) or by RSNUM/RSPOS. A found delivery is
  never `not_posted`.

## What PGI would need in W12 (for the decision)

1. **TO creation for the delivery** (LT03 / `L_TO_CREATE_DN`): which source storage type/bin. The staged
   quantity sits at the production supply area bin (e.g. GFL/0002000623), so the removal strategy must
   find it there.
2. **TO confirmation** (LT12 / `L_TO_CONFIRM`). This sets picking status KOSTK/LVSTK = C.
3. **Post goods issue** for the delivery (VL02N / `WS_DELIVERY_UPDATE` or an OData delivery API, still
   to be identified and capability-proven per AGENTS.md). This creates the 261 material document
   against the reservation.
4. **Read back** MATDOC by RSNUM/RSPOS or by the delivery, and promote the SU claim.

## Options for Warehouse Decision

- **Option A (Manual SAP GUI Cleanup & Execution — Recommended for immediate resolution)**:
  - Warehouse supervisor opens transaction `VL02N` in SAP GUI.
  - Deletes the 6 duplicate open deliveries (`0080000075` through `0080000080`).
  - Retains single delivery `0080000074` (or cancels all 7 and posts cleanly).
  - Creates and confirms Transfer Order (LT03 / LT12) for the 100 KG quantity from bin `GFL/0002000623` (or storage unit `2000018955`).
  - Posts Goods Issue (PGI) via VL02N.
  - Fiori UI operator clicks "Refresh" (`btnRefresh261`), which queries `OpenDeliveryCount` (now 0) and re-evaluates reservation open quantity.
- **Option B (Automated End-to-End Orchestration in CAP)**:
  - Implement sequential BAPI/RFC flow: TO Create (`L_TO_CREATE_DN`) -> TO Confirm (`L_TO_CONFIRM`) -> PGI (`WS_DELIVERY_UPDATE` or `BAPI_OUTB_DELIVERY_CONFIRM_DEC`).
  - **Prerequisite**: Must be verified and proven against live SAP Gateway/RFC per `AGENTS.md` API Discovery protocol. Not implemented in this change.
- **Option C (Customizing Adjustment in SAP S/4HANA IMG)**:
  - If single-item production staging issue is intended to move directly via IM Material Document (as in non-WM storage locations like PT01), adjust MM-IM/LE-WM interface customizing (e.g., movement type 261 / storage location CS02 customizing) to disable automatic delivery generation.

## Operational Risks

1. **Over-Issue Risk**: If an automated script or operator blindly posts PGI on all 7 deliveries, 700.000 KG of material `3000000415` would be withdrawn against a 100.000 KG requirement, causing massive physical and book inventory divergence.
2. **Double Storage Unit Allocation**: The available stock in bin `01-01-01` has only one SU `2000018955` (100 KG). Multiple deliveries cannot pick the same physical storage unit without raising stock deficits or duplicate quant errors.
3. **Zero Write Policy Adherence**: The application code strictly refrains from auto-PGI or auto-deletion. It enforces safety by blocking new postings (`DELIVERY_CREATED` / HTTP 409), displaying both blockers clearly on screen, and waiting for authorized warehouse intervention.

## Current State Summary for Reservation 520615/0001

- **Reservation**: `520615` / Item `0001`
- **Plant**: `1130`, Storage Location: `CS02`, Warehouse: `W12`
- **Material**: `3000000415` (`TEST SF - HU`) — *verified authentic; reference in chat to 3000000015 was a typo*
- **Batch**: `INWS260004`, Requirement: `100.000 KG`, Withdrawn: `0.000 KG`
- **Open Outbound Deliveries (7 total)**: `0080000074`, `0080000075`, `0080000076`, `0080000077`, `0080000078`, `0080000079`, `0080000080`
- **Delivery Status**: Type `HOD`, GM Status `WBSTK = 'A'`, Picking `KOSTK = 'A'`, WM Status `LVSTK = 'A'`, Transfer Orders (`LTAP`) = `0` (none created).
