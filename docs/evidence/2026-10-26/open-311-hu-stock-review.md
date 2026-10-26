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

## Addendum 2026-10-26 11:10 IST — superseded by the collector run

The table above was built from selective saved reads. `hu-stock-evidence.raw.json` (captured `2026-10-26T05:31:12Z`, READ-ONLY) now contains complete LQUA reads by material for W01 / plant / CS02 (`queries[2]`–`queries[5]`). It supersedes the "Saved stock observations" column:

- Material 8000009754, 1120/CS02: 20 LQUA rows, 15 distinct LENUM, total quantity 10 NOS by storage type: 902 −5, OH1 +5, 911 3, 913 5, EN1 1 (HU `2000019372` at bin `1-L0001-04`), 921 1. Open demand 3 (523654/1, 529960/1, 529959/1).
- Material 8000006485, 1120/CS02: unchanged, 2 × OH1/ONHOLD (HUs 2000020150/151), total 2 NOS. Open demand 11; pool shortfall 9.
- Materials 8000009802/9803 at 1150/CS02: queried in W01, 0 rows each. Open demand 1 each. Whether 1150/CS02 belongs to W01 is Not verified (no T320 evidence).

Reservation numbers in this file were checked against `queries[25]`/`queries[26]` and are correct (`520235/1`, `520235/2`, `520236/1`, `520236/2`). Full analysis: `hu-stock-evidence-analysis.md`. No pickability judgement is made here.
