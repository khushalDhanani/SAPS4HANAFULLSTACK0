# Live-proof request — ONE 311 reservation on CS02, Path A delivery flow (PREPARED, NOT RUN)

**Status: prepared only.** Nothing in this document has been executed. Every step below is a SAP **WRITE** and requires the user's explicit written "go" for that specific call. Values are filled **only** from evidence files; each value names its source. Anything that depends on a user decision is **PENDING** and is not filled. Placeholders are NOT PROVIDED.

Source abbreviations: **RAW** = `docs/evidence/2026-10-26/hu-stock-evidence.raw.json` (05:31Z); **RAW2** = `hu-stock-evidence.20261026T061255.raw.json` (06:12Z, supersedes RAW where they differ); `q<n>` = `queries[<n>]`.

## 0. Candidate reservation (selection PENDING)

The candidate below is the item WORKSTATUS Current Status already names for a report-only 311 plan ("A 311 live-proof plan for reservation 529960/1 is report-only", `WORKSTATUS.md` line 28). **Choosing it for live proof is the user's decision — PENDING.** The other same-material open items (`523654/1`, `529959/1`) are equally valid candidates on the evidence.

| Value | Content | Source |
|---|---|---|
| Reservation / item | `0000529960` / `0001` | RAW q25; `open311Reservations[3]` |
| Movement type | `311` (RESB `BWART`; `ResolvedBWART 311`, `BWARTSource RESB`) | RAW `open311Reservations[3]` |
| Material | `000000008000009754` | RAW `open311Reservations[3]` |
| Plant / source SLoc | `1120` / `CS02` | RAW `open311Reservations[3]` |
| Receiving SLoc (UMLGO) | `CIS1` | RAW `open311Reservations[3]` |
| Required / withdrawn / open qty | `1.000` / `0.000` / `1` `NOS` | RAW `open311Reservations[3]` |
| KZEAR / XLOEK / AUFNR | blank / blank / blank | RAW `open311Reservations[3]` |
| Warehouse | `W01` (T320 for 1120/CS02) | RAW2 q4 |
| Shipping point (VSTEL) for 1120/CS02 | `1105`; `XHUPF X` | RAW2 q6 (T001L) |
| Delivery type / sales org / order type for the delivery | **NOT PROVIDED** — not in evidence | — |

## 1. Preconditions from the evidence

| Precondition | Evidence state | Source |
|---|---|---|
| HU location / stock for material 9754 in W01/1120/CS02 | 20 LQUA rows, 15 LENUM, total 10 NOS: 902 −5, OH1 +5, 911 3, 913 5, EN1 1, 921 1. All `LETYP E10`. | RAW q2 |
| HU candidate for the pick | **PENDING (pickability rule)**. Facts only: `2000019372` is the sole EN1 quant (`1-L0001-04`, 1 NOS); five HUs sit in 913 of which `2000019371` is packed to delivery `0080000134` (VEKP `VPOBJ 01`, `VPOBJKEY 0080000134`); 3 HUs in 911, 1 in 921, 5 in OH1 (each offset by a negative 902 quant). | RAW q2, q11 |
| HU not on an open TO | `2000019372`: 2 TOs, both `PQUIT X`, LTAK `KQUIT X` → 0 open. | RAW q8–q10 |
| HU packaging type → T319A row for W01 | VEKP `VHART Z007`, `VHILM 000000002000000340` (MARA `VHART Z007`). **T319A W01 read live 06:12Z: `0001 → E1`, `Z003 → E1`, no `Z007` row. W15 has `Z007 → E1`.** → **Precondition NOT MET (CONFIRMED); PENDING SANDHLE / functional decision (E10 vs E1).** | RAW2 q6-equivalent VEKP, q141, q143, q144 |
| Open delivery already existing for the reservation | **None as of 06:12Z** for 529960/1 (LIPS by RSNUM/RSPOS and by VGBEL: 0 rows). Note: 524283/1 (material 6485) already has two open deliveries `0080000097`/`0080000098` (`HOD`, status A/A/A), so it is not a clean candidate. Re-read READ-ONLY immediately before any write. | RAW2 q155, q156, q148, q151, q152 |
| Serial selection for the HU | HU 19372 carries exactly one serial, `RKN000111` (SER06 `OBKNR 50049` → OBJK). Whether to assign it is still the user's choice → **PENDING**. | RAW2 `serials` |
| Competing reservations for the same material | `523654/1` and `529959/1` are open for 9754 (1 NOS each). Code offers a default ranking (earliest BDTER, then RSNUM; `srv/integration/s4hana/wm/HuStockTransferAdapter.js:1628`). **Business rule PENDING.** | RAW q25 |
| Oversize-HU rule | HU qty 1 = open qty 1 for this item, so no oversize case arises; the rule itself is "default BLOCK, pending the user's confirmation" — **PENDING**. | RAW q2 / `open311Reservations[3]` |
| OH1 pickability | OH1 holds 5 units of 9754; whether OH1 is pickable is **PENDING**. | RAW q2 |
| BusinessConfig storage-type lists for W01 | Unseeded; must be maintained (admin API validates against T301 codes — RAW q1 lists the 49 valid W01 codes). **PENDING (depends on pickability/hold decisions).** | RAW q1; `db/data/saps4hana.wm-BusinessConfig.csv` |

## 2. Call sequence (each a WRITE, each needs its own "go"; nothing filled beyond the evidence)

| Step | Call (as implemented) | Inputs from evidence | Inputs PENDING / NOT PROVIDED | Read-back required before next step |
|---|---|---|---|---|
| 1 | Outbound delivery creation for the reservation | reservation `0000529960/0001`, material `…9754`, plant `1120`, SLoc `CS02` → `CIS1`, qty `1 NOS` (RAW2), shipping point `1105` (RAW2 q6) | delivery type (NOT PROVIDED; the two existing deliveries on 524283/1 use `LFART HOD`, RAW2 q151 — using it here would be a decision, PENDING), the "go" | LIKP/LIPS row exists for the new delivery; LIPS references RSNUM `0000529960` |
| 2 | Picking TO by storage unit — `L_TO_CREATE_DN` (`I_LGNUM W01`, `I_VBELN <delivery>`, `I_COMMIT_WORK X`, `I_SQUIT X`) then `L_TO_CONFIRM` if created unconfirmed (`ReservationProcessAdapter.js:2246`, `:2307`) | `LGNUM W01`, HU `LENUM` per step 1 decision, `LETYP E10` (RAW q2) | which HU (pickability PENDING), T319A W01/Z007 row (NOT MET), the "go" | LTAP row: `VLENR = NLENR = <HU>`, `PQUIT X`; LTAK `KQUIT X`; LIKP `KOSTK C` |
| 3 | Serial assignment — `BAPI_OUTB_DELIVERY_CHANGE` with `ITEM_SERIAL_NO` + COMMIT (`ReservationProcessAdapter.js:2355`, `:2394`) | delivery item from step 1; HU 19372's only serial is `RKN000111` (RAW2) | serial assignment choice (PENDING), the "go". **Known blocker:** this step failed live on 2026-10-21 with `L3 866` for `Z007`/`W01` (WORKSTATUS line 810); unresolved until T319A W01/Z007 exists or the ABAP reproduction (`docs/sap-customizing/L3866-reproduction.md`) proves another cause. | SER01 shows the serial on the delivery item |
| 4 | Goods issue — `BAPI_OUTB_DELIVERY_CONFIRM_DEC` (`ReservationProcessAdapter.js:2114`, `completeDeliveryGoodsIssue`) | delivery from step 1 | the "go" | LIKP `WBSTK C`; MATDOC/MSEG rows for the delivery with the material and `1 NOS`; movement type on the material document **Not verified** in advance (delivery-based 311 vs. item-category movement type is not evidenced); RESB `ENMNG` of `0000529960/0001` becomes `1.000`; LQUA no longer shows the HU in CS02 |

## 2a. Consequences the user must accept before any "go"

- **The proof consumes HU 2000019372 and cannot be repeated.** Goods issue on the delivery removes the HU's single quant (`1.000 NOS`, RAW q2) from `EN1`/`1-L0001-04`; the sole EN1 unit of material 9754 is then gone and a second run would need a different HU and a different reservation.
- **Step 3 (serial assignment) is expected to fail with `L3 866`** ("SU type for pack. mat. type Z007 could not be determined in warehouse no. W01", live on 2026-10-21, WORKSTATUS line 810) unless the cause is resolved first: either a `T319A` row for `W01`/`Z007` exists (none evidenced; SANDHLE/functional decision PENDING) or the ABAP reproduction (`docs/sap-customizing/L3866-reproduction.md`) proves and removes another cause. Running steps 1–2 before that would leave an open delivery and a confirmed picking TO on the HU.

## 3. What must happen before any "go"

1. READ-ONLY re-reads immediately before the write (all were last read 06:12Z, RAW2): RESB `0000529960/0001` still open; LQUA for the chosen HU unchanged; LIPS by RSNUM = 0 rows; SER06/OBJK for the HU; T319A for `W01`/`Z007`.
2. User decisions recorded in the user's own words: candidate reservation, HU / pickability rule (incl. OH1), competing-reservation rule, oversize rule, serial, T319A W01/Z007 maintenance (SANDHLE).
3. One written "go" per step above, naming environment, reservation, HU and serial.

**Decisions made on the user's behalf: none.** All PENDING items above are unfilled.
