# READ-ONLY 261 candidate period and order status review

Captured 2026-10-26. No SAP writes were performed.

## Field validation

`DD03L` field lists are saved in `261-period-status-dd03l.raw.json` and `261-plant-map-dd03l.raw.json`. Candidate row fields are saved in `261-period-status-candidates.raw.json`; the SAP system-info response and verified English status labels are in `261-sap-system-info.raw.json`, `261-status-texts.raw.json`, and `261-order-block-status-labels.raw.json`.

Verified plant/company-code path: `T001W-WERKS/BWKEY` → `T001K-BWKEY/BUKRS`. Plants 1120 and 1600 both map to company code 1000.

## Posting periods and date limitation

For company code 1000, SAP returned `MARV-LFGJA=2026`, `LFMON=07`, `VMMON=06`; `T001B` rows show `FRYE1=2025`, `TOYE1=2026`, `FRPE1=002`, `TOPE1=012` for the listed account types. These are confirmed SAP values. Interpreting them as the current/previous MM period and FI posting-period range is based on the field semantics, not a live posting test.

No candidate posting date was supplied. The 261 mapper accepts an optional PostingDate and the SAP system-info call returned no date. SAP's default date, current MM posting-period behavior for that default, and whether a posting on a specified date would pass are therefore **Not verified**. If 2026-10-26 were chosen as a posting date, the T001B range includes period 10 in fiscal year 2026, but the MARV record is at period 07/2026; this does not prove October material posting is open. Do not treat the desktop date as SAP's date.

## Candidate order status and 262 assessment

Plant 1120 candidates use company code 1000; plant 1600 also uses company code 1000.

| Order | Component | Period check | Active order status evidence | Block/deletion indicators | 262 against the component |
|---|---|---|---|---|---|
| 000001002318 | 000000001000000716; 1,000 KG open; 1120/CS01 | Plant 1120 → company 1000. T001B includes period 10 in its 2025–2026 range; MARV says 07/2026. Candidate date/SAP default date unknown, so **not proven open**. | Active `I0002` = REL/Released. Other active statuses include PRC, SETC, SSAP, ORRQ, NEWQ, BCRQ, BASC, and MANC. | `AUFK-LOEKZ` blank. No active `I0043` Locked, `I0045` TECO, `I0046` Closed, or `I0076` Deletion Flag in the captured JEST rows. | **Cannot pass now:** earlier MATDOC read returned no document for the order, so no original 261 document exists to reverse. Future period/auth/document checks are not verified. |
| 000002000585 | 000000008400000034; 500 KG open; 1600/CS01 | Plant 1600 → company 1000. T001B includes period 10 in its 2025–2026 range; MARV says 07/2026. Candidate date/SAP default date unknown, so **not proven open**. | Active `I0002` = REL/Released. Other active statuses include PRC, SETC, SSAP, ORRQ, NEWQ, BCRQ, BASC, MANC, CUGT, and CSER (Error in cost calculation). `I0046` Closed is present but inactive. | `AUFK-LOEKZ` blank. No active lock, TECO, closed, or deletion-flag status in captured JEST rows. | **Cannot pass now:** earlier MATDOC read returned no document for the order. Future reversal checks are not verified; CSER's effect on any posting is not established here. |
| 000002000540 | 000000004000000002; 15,000 KG open; 1120/CS01 | Plant 1120 → company 1000. T001B includes period 10 in its 2025–2026 range; MARV says 07/2026. Candidate date/SAP default date unknown, so **not proven open**. | Active `I0002` = REL/Released. Other active statuses include PRC, SETC, SSAP, ORRQ, NEWQ, BCRQ, BASC, MANC, CUGT, and ERTR (Error creating transfer requirement). | `AUFK-LOEKZ` blank. No active lock, TECO, closed, or deletion-flag status in captured JEST rows. | **Cannot pass now:** earlier MATDOC read returned no document for the order. Future reversal checks are not verified; ERTR's effect on any posting is not established here. |

The status rows prove the captured standard system-status state only. They do not prove that every order-specific/user status, authorization, material availability, or posting-period check will allow a future 261 or 262. A 262 is a reversal of an existing material document; no original document exists for any of these candidates in the captured read-back.

## Evidence files

- `261-period-status-dd03l.raw.json` — complete DD03L metadata for period/company-code/order/status tables.
- `261-plant-map-dd03l.raw.json` — DD03L field validation for plant mapping.
- `261-period-status-candidates.raw.json` — T001W, T001K, MARV, T001B, AUFK, and JEST rows.
- `261-sap-system-info.raw.json` — RFC_SYSTEM_INFO; no system date returned.
- `261-status-texts.raw.json` and `261-order-block-status-labels.raw.json` — SAP English status labels.

