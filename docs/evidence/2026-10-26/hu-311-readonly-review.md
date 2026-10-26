# HU / 311 READ-ONLY review — 2026-10-26

All SAP operations represented by the raw files below were READ-ONLY. No SAP write was performed. Field names were checked in `hu-311-dd03l.raw.json` before the corresponding reads. No new HU values were configured.

## T319A audit trail

`hu-t319a-dbtablog.raw.json` contains 69 DBTABLOG rows for T319A, including log date/time, user, key, operation type, and transaction. It shows inserts (`OPTYPE=I`) including keys `100W15Z007` (2026-09-30, SANDHLE/SIMG) and `220W15Z007` (2026-10-03, SANDHLE/SCC1). The captured history does not establish an edit to key `100W01Z007`. The `LOGDATA` request failed; see `hu-t319a-dbtablog-logdata-error.json`. Old/new field values are **Not verified**.

The open CTS snapshot is `hu-open-customizing-requests.raw.json`, queried from E070/E071/E071K for views/tables V_T319A, T319A, V_T320, T320, V_T001L, and T001L. Among requests with E070 status D, the snapshot contains 9 requests with T319A keys, 14 with T320 keys, and 25 with T001L keys. E071 view objects show 9 requests for V_T319A and 14 for V_T320; none for V_T001L. The complete request/object/key records are in the raw JSON. T319A requests include DS4K903364, DS4K903965, DS4K904158, DS4K904388, DS4K904892, DS4K905189, DS4K905264, DS4K905275, and DS4K905282. The last request's T319A key is `100W15Z007`; it does not show `100W01Z007` in the captured table keys.

## Transfer orders and HUs

`hu-to-storage-unit-movements.raw.json` contains the requested LTAP items:

- TO 1037372 item 0001: VLENR=NLENR=`00000000002000019371`, VLTYP EN1 → NLTYP 913, NLPLA `0080000134`, LETYP E10, material `000000008000009754`, quantity 1.000, PQUIT X.
- TO 1037246 items 0001–0004: VLENR=NLENR are HUs 20030, 20031, 20037, 20038; OH1 → 921 / TRANSFER; LETYP E10; each quantity 1.000 and PQUIT X.
- TO 1037247 items 0001–0002: VLENR=NLENR are HUs 20039 and 20032; OH1 → 921 / TRANSFER; LETYP E10; each quantity 1.000 and PQUIT X.

Every listed item has populated, equal source/destination HU numbers and LETYP E10. These records therefore evidence storage-unit moves; there is no loose-pick item in the captured rows. This classification is based on the returned LTAP fields.

`hu-hold-indicators.raw.json` shows HUs 2000020150 and 2000020151 as LQUA quants in W01/OH1/ONHOLD, material 8000006485, plant 1120, SLoc CS02, 1.000 each, LETYP E10 and KZHUQ X. Listed stock/block indicator fields (BESTQ, SOBKZ, SONUM, SKZUE, SKZUA, SKZSE, SKZSA, SKZSI, SPGRU) are blank; EINME/AUSME are zero. `hu-hold-vekp.raw.json` identifies corresponding VEKP rows with STATUS 0020, blank STATS/WMSTA/ERLKZ, HU_LGORT X, VPOBJ 12, VPOBJKEY 0180000117, VHART Z007, LGNUM W01. The semantic meaning of STATUS 0020 and HU_LGORT X as a posting block was not verified; do not treat these values alone as a proven SAP block.

`hu-w01-lqua-t301t.raw.json` read 8,338 LQUA rows (under the 9,999 row cap), found 21 distinct W01 storage types, and matched each to SPRAS E / LGNUM W01 T301T text: 2FL “2nd Floor”; 901 “GR Area for Production”; 902 “GR Area External Rcpts”; 911 “GI Area for Cost Center”; 913 “GI Area - Fixed Assets”; 914 “GI Area Production Orders”; 920 “Stock Transfers (plant)”; 921 “Stock Transfers (StLoc)”; 922 “Posting Change Area”; 998 “Init. Entry of Inv. Data”; COR “Corrosive”; EN1 “Gr Engineering material”; FLM “Flammable”; GS1 “Gr Green Stage Material”; IP1 “Production Supply - IP01”; IP5 “Production Supply - IP05”; OH1 “Gr On-Hold Material”; OXD “Oxidizer”; RM1 “Gr Raw Material/Packing”; TOX “Toxic / Hazardous”; WRA “Water reactive”.

**Pickability decision:** W01/OH1 is labeled “Gr On-Hold Material” in the captured English T301T text. Precedent TOs 0001037246 and 0001037247 picked HUs from OH1. These facts do not establish that OH1 is pickable for this cockpit flow. Pickability is a business decision, pending; until approved, the default is **not pickable**. This is a safe default, not a conclusion from SAP text or the precedent TOs.

## RESB reconciliation

No fresh SAP RESB call was made in this continuation because the RFC connection attempt was blocked locally (`261-order-1002318-readonly-attempt.raw.json`). The existing saved source is `../2026-10-23/resb-open-311-1120-cs02.json` plus `../2026-10-23/resb-specific-items.json`:

- 524284/1 is **not** one of the six open 311 items. It is plant 1130 / CS01, BWART 261, material 8400000047, 200 KG, XLOEK X (deleted).
- 527591/1 is the sixth open 311 row in 1120 / CS02: material 8000006485, BWART 311, BDMNG 2, ENMNG 0, 2 NOS, UMLGO HU01, XLOEK/KZEAR blank.
- 527588/1 is open 311 in 1120 / CS02 with BDMNG 10, ENMNG 2, so remaining demand 8 NOS; UMLGO HU01.
- 524283/1 is open 311 in 1120 / CS02, BDMNG 1, ENMNG 0, so remaining demand 1 NOS; UMLGO HU01.

The two current WORKSTATUS lists were corrected to substitute 527591/1 for the mistakenly listed 524284/1. The detailed 524284/1 row in the historical evidence was retained.

## HU storage-type rules: design only

Current code already expects `pickableStorageTypes`, `holdStorageTypes`, and `interimStorageTypes` for `hu-stock-transfer` and throws if any list is absent/empty (`srv/common/BusinessConfigResolver.js`). `BusinessConfig` is keyed by Plant + WarehouseNumber and is exposed through an admin-restricted OData service (`db/wm/business-config.cds`; `srv/wm/business-config/service.cds`). It currently has no three HU rule fields and repository search found no dedicated BusinessConfig admin Fiori screen. A future design would add three separately maintained lists to BusinessConfig, scoped by that existing key, and a role-restricted admin screen if business users need UI maintenance. Resolver behavior should keep rejecting before SAP access when any required list is empty. No values or implementation changes were made; the OH1/SANDHLE business decision remains pending.

## Candidate 000001002318 follow-up

Earlier saved SAP candidate evidence in `261-candidate-details.raw.json` contains AUFK creator ADAPHALE and creation date 20260812. It does not include KTEXT/LTEXT or a test designation. A new READ-ONLY AUFK query including order text was blocked before SAP response by local `connect`/`Operation not permitted`; see `261-order-1002318-readonly-attempt.raw.json`. Whether it was created for testing is therefore **Unknown**. No T001B/MARV query was run because no explicit posting date was provided. The existing earlier period snapshot does not answer date-specific posting eligibility.
