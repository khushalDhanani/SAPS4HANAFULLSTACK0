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
5. Open questions for the owner:
   - Is delivery-based issue intended for 1130/CS02, or should 261 for staged PSA stock bypass it (a
     customizing change)?
   - Who runs TO/PGI: the warehouse in SAP, or this app?
   - What happens to the 7 duplicate deliveries (0080000074–80) for 520615/0001? Deleting them (VL02N)
     is a manual SAP action. **The app changes nothing.**

Nothing in the list above is implemented. The PGI service must first be identified and proven per the
SAP API Discovery protocol.
