# Open 311 RESB and captured LQUA stock review

**Mode:** READ-ONLY evidence review. No SAP calls or writes were performed in this task. RFC connection had previously failed before SAP response with local `Operation not permitted`; values below are from saved responses, not a fresh snapshot.

## Open reservation items

RESB rows are from 2026-10-23 files `resb-open-311-1120-cs02.json` and `resb-open-311-1150-cs02.json`. Open quantity is calculated as BDMNG − ENMNG. All listed units are NOS.

| Plant/SLoc | Reservation/item | Material | Open qty | Saved stock observations by storage type | Reservation shortfall |
|---|---|---|---:|---|---|
| 1120/CS02 | 523654/1 | 8000009754 | 1 | One captured HU, 913, qty 1 | Not verified; stock query is selective and shared with two other open reservations for this material |
| 1120/CS02 | 524283/1 | 8000006485 | 1 | Two captured HUs, OH1, qty 1 each | Not verified; same material pool is shared with 527591/1 and 527588/1 |
| 1120/CS02 | 527591/1 | 8000006485 | 2 | Two captured HUs, OH1, qty 1 each | Not verified; same material pool is shared with 524283/1 and 527588/1 |
| 1120/CS02 | 529960/1 | 8000009754 | 1 | One captured HU, 913, qty 1 | Not verified; stock query is selective and shared with two other open reservations for this material |
| 1120/CS02 | 529959/1 | 8000009754 | 1 | One captured HU, 913, qty 1 | Not verified; stock query is selective and shared with two other open reservations for this material |
| 1120/CS02 | 527588/1 | 8000006485 | 8 | Two captured HUs, OH1, qty 1 each | Not verified; same material pool is shared with 524283/1 and 527591/1 |
| 1150/CS02 | 520235/1 | 8000009802 | 1 | No matching LQUA stock evidence saved | Not verified |
| 1150/CS02 | 520235/2 | 8000009803 | 1 | No matching LQUA stock evidence saved | Not verified |
| 1150/CS02 | 520236/1 | 8000009802 | 1 | No matching LQUA stock evidence saved | Not verified |
| 1150/CS02 | 520236/2 | 8000009803 | 1 | No matching LQUA stock evidence saved | Not verified |

## Captured HU rows, without a pickability conclusion

- Material 8000009754: HU `00000000002000019371`, warehouse W01, type 913, bin `0080000134`, plant 1120, SLoc CS02, quantity 1 NOS. Source: `../2026-10-23/lqua-bin-913-delivery.json`.
- Material 8000006485: HUs `00000000002000020150` and `00000000002000020151`, warehouse W01, type OH1, bin ONHOLD, plant 1120, SLoc CS02, quantity 1 NOS each. Source: `hu-hold-indicators.raw.json` captured 2026-10-26 (the older 2026-10-23 file contains the same two targeted HUs).
- Materials 8000009802/9803 at 1150/CS02: no LQUA query/rows in the saved evidence.

The 9754 and 6485 rows are targeted reads, not a complete LQUA scan by material/plant/SLoc. Same-material units are shared across multiple open reservation items, and no reservation-to-HU allocation rule was queried. Therefore a numeric per-reservation shortage cannot be derived safely. A complete fresh stock picture and business allocation rule are required; no pickability judgement is made here.
