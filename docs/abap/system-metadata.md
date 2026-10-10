# SAP S/4HANA System Metadata Export (Client 220)

*Generated via read-only RFC adapter queries against DD03L, TADIR, SEOCLASS, SEOCOMPO, SEOSUBCO, DD25T.*

---

## 1. Table T320 (Plant/Storage Location to Warehouse Assignment)

### DDIC Fields (`DD03L`)
| Position | Field Name | Data Type | Length | Key Flag | Description |
|---|---|---|---|---|---|
| 0001 | `MANDT` | CLNT | 3 | X | Client |
| 0002 | `WERKS` | CHAR | 4 | X | Plant |
| 0003 | `LGORT` | CHAR | 4 | X | Storage Location |
| 0004 | `LGNUM` | CHAR | 3 |  | Warehouse Number / Warehouse Complex |
| 0005 | `OBEST` | CHAR | 1 |  | Change plant data during transfer |
| 0006 | `LGNTB` | CHAR | 1 |  | Storage location not in warehouse |
| 0007 | `SLGOR` | CHAR | 1 |  | Default storage location |
| 0008 | `OBTYP` | CHAR | 3 |  | Object type |
| 0009 | `LGREF` | CHAR | 2 |  | Warehouse reference number |
| 0010 | `CENSY` | CHAR | 1 |  | Central warehouse system |

### Sample Live Row (`WERKS = '1120'`, `LGORT = 'HS01'`)
- `WERKS`: `1120`
- `LGORT`: `HS01`
- `LGNUM`: `W01`

---

## 2. Tables T321 & T333 (IM-WM Interface & Movement Types)

### Table T321 (Movement Type Mapping IM -> WM)
*Key Insight: T321 links to IM via `RBLVS` (Reference Movement Type from T156), NOT directly via field `BWART`.*
| Position | Field Name | Data Type | Length | Key Flag | Description |
|---|---|---|---|---|---|
| 0001 | `MANDT` | CLNT | 3 | X | Client |
| 0002 | `LGNUM` | CHAR | 3 | X | Warehouse Number |
| 0003 | `RBLVS` | NUMC | 3 | X | Reference movement type for WM |
| 0004 | `BSLVS` | CHAR | 1 | X | Special stock indicator for WM |
| 0005 | `KZBEW` | CHAR | 1 | X | Movement indicator |
| 0006 | `SOBKZ` | CHAR | 1 | X | Special stock indicator |
| 0007 | `BSSKZ` | CHAR | 1 | X | Special movement indicator |
| 0008 | `LGREF` | CHAR | 2 | X | Warehouse reference number |
| 0009 | `BWLVS` | NUMC | 3 |  | Movement Type for Warehouse Management |
| 0010 | `BESTQ` | CHAR | 1 |  | Stock category in WM |
| 0011 | `TBFKZ` | CHAR | 1 |  | Create transfer requirement |
| 0012 | `WEDKZ` | CHAR | 1 |  | Print GR slip |
| 0013 | `UBFKZ` | CHAR | 1 |  | Create posting change notice |
| 0014 | `TAFKZ` | CHAR | 1 |  | Automatic transfer order creation |
| 0015 | `WENUM` | CHAR | 1 |  | GR number assignment |
| 0016 | `BSTQE` | CHAR | 1 |  | Stock category (receiving) |
| 0017 | `MAILK` | CHAR | 2 |  | Mail indicator |
| 0018 | `LFART` | CHAR | 4 |  | Delivery type |
| 0019 | `KUNWE` | CHAR | 10 |  | Ship-to party |
| 0020 | `LIFNR` | CHAR | 10 |  | Vendor number |
| 0021 | `SPE_FOLAR` | CHAR | 4 |  | Follow-up delivery type |

### Table T333 (Warehouse Movement Types)
| Position | Field Name | Data Type | Length | Key Flag | Description |
|---|---|---|---|---|---|
| 0001 | `MANDT` | CLNT | 3 | X | Client |
| 0002 | `LGNUM` | CHAR | 3 | X | Warehouse Number |
| 0003 | `BWLVS` | NUMC | 3 | X | Movement Type for WM |
| 0011 | `BETYP` | CHAR | 1 |  | Requirement type |
| 0012 | `TBOBL` | CHAR | 1 |  | TR obligatory indicator |
| 0014 | `SQUIT` | CHAR | 1 |  | Immediate confirmation allowed (`X` = yes, space = no) |
| 0015 | `TBMAN` | CHAR | 1 |  | Manual TR creation allowed |
| 0030 | `AUTTA` | CHAR | 1 |  | Automatic TO creation |

---

## 3. Background Processing Framework (bgPF / BGMC)

### Discovered Classes & Interfaces in Package `S_BGMC_PUBLIC`
- **Factory Class:** `CL_BGMC_PROCESS_FACTORY`
  - Method: `GET_DEFAULT( ) RETURNING VALUE(RO_FACTORY) TYPE REF TO IF_BGMC_PROCESS_FACTORY`
  - Method: `CREATE( ) RETURNING VALUE(RO_PROCESS) TYPE REF TO IF_BGMC_PROCESS_SINGLE_OP RAISING CX_BGMC`
- **Process Interface:** `IF_BGMC_PROCESS_SINGLE_OP`
  - Method: `SET_NAME( iv_name )`
  - Method: `SET_OPERATION_TX_UNCONTROLLED( io_op )` (for operations running classic BAPIs with `COMMIT WORK`)
  - Method: `SAVE_FOR_EXECUTION( )`
- **Single-Transaction Uncontrolled Operation Interface:** `IF_BGMC_OP_SINGLE_TX_UNCONTR`
  - Method: `EXECUTE( )`
- **Exception Class:** `CX_BGMC`

---

## 4. Header & Item Text Lengths for Goods Movements

| Table / Structure | Field Name | Data Type | Length | Notes |
|---|---|---|---|---|
| `MKPF` | `BKTXT` | CHAR | 25 | Header Document Text (too short for full 32/36-char UUID) |
| `MATDOC` | `BKTXT` | CHAR | 25 | Header Document Text (same as MKPF) |
| `BAPI2017_GM_ITEM_CREATE` | `ITEM_TEXT` | CHAR | 50 | Item Text (maps to `MSEG-SGTXT` / `MATDOC-SGTXT`) |
| `MSEG` / `MATDOC` | `SGTXT` | CHAR | 50 | Item Text (holds full 32-char UUID or 36-char string cleanly) |

---

## 5. Reservation Lock Object

- **Lock Object Name:** `EMRESB` (verified via `TADIR` `OBJECT = 'ENQU'` and `DD25T`)
- **Description:** Locking key for individual reservation (`Sperrschlüssel für einzelne Reservierung`)
- **Generated Function Modules:**
  - Enqueue: `ENQUEUE_EMRESB`
  - Dequeue: `DEQUEUE_EMRESB`
