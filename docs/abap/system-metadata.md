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

---

## 6. Interface of Function Module `Z_WM_TO_CREATE_FROM_TR`

*Read live from SAP S/4HANA Client 220 via RFC (`RFC_GET_FUNCTION_INTERFACE`).*

### Importing Parameters
| Parameter | Type | Default | Optional | Description |
|---|---|---|---|---|
| `IV_COMMIT` | `CHAR1` | `'X'` | Yes | Commit work flag (`'X'` = execute COMMIT WORK) |
| `IV_LGNUM` | `LGNUM` (CHAR 3) | | No | Warehouse number (e.g. `'W01'`) |
| `IV_SQUIT` | `CHAR1` | `' '` | Yes | Immediate confirmation indicator (`'X'` = immediate confirm, `' '` = create only) |
| `IV_TBNUM` | `LTBK` (CHAR 10) | | No | Transfer Requirement number |

### Exporting Parameters
| Parameter | Type | Optional | Description |
|---|---|---|---|
| `EV_MESSAGE` | `BAPI_MSG` (CHAR 220) | No | Formatted return message text |
| `EV_SUCCESS` | `CHAR1` | No | Execution status flag (`'S'` = Success, `'E'` = Error) |
| `EV_TANUM` | `LTAK` (CHAR 10) | No | Generated Transfer Order number |

### Table Parameters
| Parameter | Type | Optional | Description |
|---|---|---|---|
| `ET_MESSAGES` | `BAPIRET2_T` | Yes | Table of BAPI return messages |
| `IT_ITEMS` | `L03B_TRITE_T` | Yes | Table of TR items to convert (`TBPOS`, `ANFME`, `ALTME`, `CHARG`, `LETYP`, `NLTYP`, `NLPLA`, `VLTYP`, `VLPLA`, `VLENR`) |

### Exceptions
- None declared in interface (errors returned via `EV_SUCCESS = 'E'`, `EV_MESSAGE`, and `ET_MESSAGES`).

---

## 7. Interface of Function Module `L_TO_CONFIRM` (TO Confirmation)

*Read live from SAP S/4HANA Client 220 via RFC (`RFC_GET_FUNCTION_INTERFACE`).*

### Importing Parameters
| Parameter | Type | Default | Optional | Description |
|---|---|---|---|---|
| `I_LGNUM` | `LTAK` (CHAR 3) | | No | Warehouse number |
| `I_TANUM` | `LTAK` (CHAR 10) | | No | Transfer order number |
| `I_SQUIT` | `RL03T` (CHAR 1) | `SPACE` | Yes | Confirmation target = actual (`'X'` confirms entire TO target qty) |
| `I_COMMIT_WORK` | `RL03B` (CHAR 1) | `'X'` | Yes | Indicator whether COMMIT WORK in function module |
| `I_QNAME` | `LTAP` (CHAR 12) | `SY-UNAME` | Yes | User who is executing confirmation |
| `I_SUBST` | `RL03T` (CHAR 1) | `SPACE` | Yes | Confirm also items to subsystems |
| `I_TBELI` | `RL03T` (CHAR 1) | `SPACE` | Yes | Set transfer requirement to processing complete |
| `I_UPDATE_TASK` | `RL03A` (CHAR 1) | `SPACE` | Yes | Indicator: update via update task |

### Table Parameters
| Parameter | Type | Optional | Description |
|---|---|---|---|
| `T_LTAP_CONF` | `LTAP_CONF` | No (if SQUIT space) | Table of TO items to confirm (`TANUM`, `TAPOS`, `PISTA`/`NISTA`, `SQUIT`) |
| `T_LTAP_CONF_HU` | `LTAP_CONF_HU` | Yes | Handling Unit Data for TO Item at Confirmation |
| `T_LTAP_CONF_HU_SERIAL` | `LTAP_CONF_HU_SERIAL` | Yes | Serial Number Data for TO Item at Confirmation |

### Key Exceptions
- `TO_CONFIRMED` (1): Transfer order already confirmed
- `TO_DOESNT_EXIST` (2): Transfer order does not exist
- `ITEM_CONFIRMED` (3): TO item already confirmed
- `FOREIGN_LOCK` (12): SAP lock set by another user
- `SQUIT_OR_QUANTITIES` (13): Must confirm via `I_SQUIT = 'X'` OR provide item quantities in `T_LTAP_CONF`
- `NO_AUTHORITY` (30): No authorization

---

## 8. Immediate-Confirm Parameter Check for `Z_WM_TO_CREATE_FROM_TR`

- **Parameter Exists in System:** **YES** (`IV_SQUIT TYPE CHAR1 DEFAULT ' '`).
- **Policy Enforcement:** Per design instruction, `IV_SQUIT` is left as `' '` (space), and TO confirmation is executed via a separate, explicit second call (`L_TO_CONFIRM` / `confirmTO`).
- **TODO Note Added in Code:** `// TODO: Z_WM_TO_CREATE_FROM_TR supports IV_SQUIT = 'X' for immediate confirmation in one call, but chained 2-call architecture is enforced here.`

---
◇ injected env (22) from .env.local // tip: ◈ encrypted .env [www.dotenvx.com]

*Step 0 export, 2026-10-12, read-only via RFC_GET_FUNCTION_INTERFACE / RFC_READ_TABLE (DD03L, DD07L, DD07T, DD04T, TOBJ, TOBJT, TFDIR).*

## 9. Function module interfaces (re-read)

### Z_WM_TO_CREATE_FROM_TR
| PARAMCLASS | PARAMETER | TABNAME | FIELDNAME | EXID | DEFAULT | OPTIONAL | PARAMTEXT |
|---|---|---|---|---|---|---|---|
| E | EV_MESSAGE | BAPI_MSG |  | C |  |  |  |
| E | EV_SUCCESS | CHAR1 |  | C |  |  |  |
| E | EV_TANUM | LTAK | TANUM | N |  |  |  |
| I | IV_COMMIT | CHAR1 |  | C | 'X' | X |  |
| I | IV_LGNUM | LGNUM |  | C |  |  |  |
| I | IV_SQUIT | CHAR1 |  | C | ' ' | X |  |
| I | IV_TBNUM | LTBK | TBNUM | N |  |  |  |
| T | ET_MESSAGES | BAPIRET2_T |  | h |  | X |  |
| T | IT_ITEMS | L03B_TRITE_T |  | h |  | X |  |

### L_TO_CONFIRM
| PARAMCLASS | PARAMETER | TABNAME | FIELDNAME | EXID | DEFAULT | OPTIONAL | PARAMTEXT |
|---|---|---|---|---|---|---|---|
| I | I_AUSFB | LTAK | AUSFB | C | SPACE | X | TO processing comment (code) |
| I | I_COMMIT_WORK | RL03B | COMIT | C | 'X' | X | Indicator whether COMMIT WORK in function module |
| I | I_EINLM | RL03T | EINLM | C | SPACE | X | Adopt putaway quantity as qty in delivery / Post GR |
| I | I_ENAME | LTAP | ENAME | C | SY-UNAME | X | User Name in Pick Confirmation (First Step) |
| I | I_ENDAT | LTAK | ENDAT | D | INIT_DATUM | X | End Date |
| I | I_ENUZT | LTAK | ENUZT | T | 0 | X | End Time |
| I | I_ISTWM | LTAK | ISTWM | P | 0 | X | Actual work |
| I | I_KOMIM | RL03T | KOMIM | C | SPACE | X | Copy pick quantities into delivery / Post GI |
| I | I_LGNUM | LTAK | LGNUM | C |  |  | Warehouse number |
| I | I_PERNR | LTAK | PERNR | N | 0 | X | Personnel Number |
| I | I_QNAME | LTAP | QNAME | C | SY-UNAME | X | User who is executing confirmation |
| I | I_QUKNZ | RL03T | QUKNZ | C | SPACE | X | Confirmation indicator for separate confirmation |
| I | I_SOLEX | LTAK | SOLEX | P | 0 | X | Planned Transfer Order Processing Time from External System |
| I | I_SQUIT | RL03T | SQUIT | C | SPACE | X | Confirmation target = actual |
| I | I_STDAT | LTAK | STDAT | D | INIT_DATUM | X | Start Date of the Transfer Order |
| I | I_STUZT | LTAK | STUZT | T | 0 | X | Start Time |
| I | I_SUBST | RL03T | SUBST | C | SPACE | X | Confirm also items to subsystems |
| I | I_TANUM | LTAK | TANUM | N |  |  | Transfer order number |
| I | I_TBELI | RL03T | TBELI | C | SPACE | X | Set transfer requirement to processing complete / close |
| I | I_UPDATE_TASK | RL03A | VERBU | C | SPACE | X | Indicator: update via update task |
| T | T_LTAP_CONF | LTAP_CONF |  | u |  |  | Table of items to be confirmed |
| T | T_LTAP_CONF_HU | LTAP_CONF_HU |  | u |  | X | Handling Unit Data for TO Item at Confirmation |
| T | T_LTAP_CONF_HU_SERIAL | LTAP_CONF_HU_SERIAL |  | u |  | X | Serial Number Data for TO Item at Confirmation |
| X | BQUIT_OR_QUANTITIES |  |  |  |  |  | End withdrawal fron SU block storage or quantities |
| X | CHARG_MISSING |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | DOUBLE_LINES |  |  |  |  |  | In T_LTAP_CONF, there are multiple entries |
| X | FOREIGN_LOCK |  |  |  |  |  | An SAP block has been set by another user |
| X | HU_DATA_MISSING |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | HU_DATA_WRONG |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | HU_NOT_FOUND |  |  |  |  |  | HU does not exist |
| X | INPUT_WRONG |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | ITEM_CONFIRMED |  |  |  |  |  | TO item already confirmed |
| X | ITEM_DOESNT_EXIST |  |  |  |  |  | TO item does not exist |
| X | ITEM_NO_SU_BULK_STORAGE |  |  |  |  |  | TO item is not withdrawal from SU block storage |
| X | ITEM_SUBSYSTEM |  |  |  |  |  | TO item to be confirmed by subsystem |
| X | ITEM_SU_BULK_STORAGE |  |  |  |  |  | TO item is withdrawal from SU block stor. |
| X | ITEM_WITHOUT_ZERO_STOCK_CHECK |  |  |  |  |  | Zero stock check for TO item not possible |
| X | ITEM_WITH_ZERO_STOCK_CHECK |  |  |  |  |  | Zero stock check required for TO item |
| X | KZDIF_WRONG |  |  |  |  |  | Difference indicator unknown |
| X | LQNUM_MISSING |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NLPLA_WRONG |  |  |  |  |  |  |
| X | NOTHING_TO_DO |  |  |  |  |  | Acc.to transf.parameter, no proc.required |
| X | NOT_ENOUGH_STOCK_IN_HU |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NO_AUTHORITY |  |  |  |  |  | No authorization |
| X | NO_CHARG |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NO_DIFFERENCE |  |  |  |  |  | Difference indicator superfluous |
| X | NO_DIFFERENCES_ALLOWED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NO_HU_DATA_REQUIRED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NO_NEGATIVE_QUANTITIES |  |  |  |  |  | Negative quantities not allowed |
| X | NO_SOBKZ |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | NO_STOCK_ON_SU |  |  |  |  |  | Storage unit does not contain stock |
| X | NO_UNIT_OF_MEASURE |  |  |  |  |  | Unit of measure for qty missing |
| X | ONE_ITEM_SU_BULK_STORAGE |  |  |  |  |  | There is a withdrawal from SU block storage |
| X | ONE_ITEM_WITH_ZERO_STOCK_CHECK |  |  |  |  |  | There is a TO item with zero stock check |
| X | PICKING_OF_HU_NOT_POSSIBLE |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | PICK_CONFIRMATION_MISSING |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | QUANTITY_WRONG |  |  |  |  |  | Total of specified quantities incorrect |
| X | QUKNZ_WRONG |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | SERIAL_NUMBERS_NOT_REQUIRED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | SERIAL_NUMBER_DATA_MISSING |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | SERIAL_NUMBER_DATA_WRONG |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | SERIAL_NUMBER_NOT_AVAILABLE |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | SQUIT_OR_QUANTITIES |  |  |  |  |  | Confirm target = actual or explicit quantities |
| X | SU_NOT_FOUND |  |  |  |  |  | Storage unit does not exist |
| X | SU_WRONG |  |  |  |  |  | Storage unit is not in source bin |
| X | TOO_MANY_SU |  |  |  |  |  | Too many storage units have been confirmed |
| X | TO_CONFIRMED |  |  |  |  |  | Transfer order already confirmed |
| X | TO_DOESNT_EXIST |  |  |  |  |  | Transfer order does not exist |
| X | TO_ITEM_SPLIT_NOT_ALLOWED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | TWO_STEP_CONFIRMATION_REQUIRED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | TWO_STEP_CONF_NOT_ALLOWED |  |  |  |  |  | DE-EN-LANG-SWITCH-NO-TRANSLATION |
| X | UPDATE_WITHOUT_COMMIT |  |  |  |  |  | Update via update task only using Commit |
| X | VQUIT_OR_QUANTITIES |  |  |  |  |  | Confirm entire SU or explicit quantities |
| X | WRONG_ZERO_STOCK_CHECK |  |  |  |  |  | Zero stock check incorrect |
| X | XFELD_WRONG |  |  |  |  |  | Incorrect value for checkbox |

## 10. LTBK / LTBP / LTAP fields (DD03L)

### LTBK
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DOMNAME | DATATYPE | LENG |
|---|---|---|---|---|---|---|
| 0001 | MANDT | X | MANDT | MANDT | CLNT | 000003 |
| 0002 | LGNUM | X | LGNUM | LGNUM | CHAR | 000003 |
| 0003 | TBNUM | X | TBNUM | TBNUM | NUMC | 000010 |
| 0004 | STATU |  | LTBK_STATU | LTBK_STATU | CHAR | 000001 |
| 0005 | TRART |  | LVS_TRART | LVS_TRART | CHAR | 000001 |
| 0006 | TBPRI |  | TBPRI | TBPRI | CHAR | 000001 |
| 0007 | BNAME |  | LVS_BNAME | USNAM | CHAR | 000012 |
| 0008 | BDATU |  | LTBK_BDATU | DATUM | DATS | 000008 |
| 0009 | BZEIT |  | LTBK_BZEIT | UZEIT | TIMS | 000006 |
| 0010 | TBKTX |  | LTBK_TBKTX | TEXT40 | CHAR | 000040 |
| 0011 | BETYP |  | LVS_BETYP | LVS_BETYP | CHAR | 000001 |
| 0012 | BENUM |  | LVS_BENUM | LVS_BENUM | CHAR | 000010 |
| 0013 | BWART |  | BWART | BWART | CHAR | 000003 |
| 0014 | BWLVS |  | BWLVS | BWLVS | NUMC | 000003 |
| 0015 | VLTYP |  | T333_VLTYP | LGTYP | CHAR | 000003 |
| 0016 | VLPLA |  | T333_VLPLA | LGPLA | CHAR | 000010 |
| 0017 | VKDYN |  | T333_VKDYN | XFELD | CHAR | 000001 |
| 0018 | NLTYP |  | T333_NLTYP | LGTYP | CHAR | 000003 |
| 0019 | NLPLA |  | T333_NLPLA | LGPLA | CHAR | 000010 |
| 0020 | NKDYN |  | T333_NKDYN | XFELD | CHAR | 000001 |
| 0021 | PDATU |  | LTBK_PDATU | DATUM | DATS | 000008 |
| 0022 | PZEIT |  | LTBK_PZEIT | UZEIT | TIMS | 000006 |
| 0023 | MBLNR |  | MBLNR | BELNR | CHAR | 000010 |
| 0024 | MJAHR |  | MJAHR | GJAHR | NUMC | 000004 |
| 0025 | ANZPS |  | LTBK_ANZPS | LTBK_ANZPS | DEC | 000004 |
| 0026 | BRGEW |  | LTBK_BRGEW | DEC8_3 | DEC | 000011 |
| 0027 | GEWEI |  | GEWEI | MEINS | UNIT | 000003 |
| 0028 | KLFR2 |  | LTBK_KLFR2 | XFELD | CHAR | 000001 |
| 0029 | KFAR2 |  | LTBK_KFAR2 | XFELD | CHAR | 000001 |
| 0030 | TBRUE |  | LTBK_TBRUE | LTBK_TBRUE | CHAR | 000001 |
| 0031 | RSNUM |  | RSNUM | RSNUM | NUMC | 000010 |
| 0032 | LZNUM |  | LVS_LZNUM | LVS_LZNUM | CHAR | 000020 |
| 0033 | AUTTA |  | LVS_AUTTA | AUTTA | CHAR | 000001 |
| 0034 | BDART |  | BDART | BDART | CHAR | 000002 |
| 0035 | PKNUM |  | PKNUM | PKNUM | CHAR | 000007 |
| 0036 | PKPOS |  | PKPOS | PKPOS | NUMC | 000003 |
| 0037 | DIRTA |  | LVS_DIRTA | XFELD | CHAR | 000001 |
| 0038 | KBNKZ |  | KBNKZ | KBNKZ | CHAR | 000001 |

### LTBP
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DOMNAME | DATATYPE | LENG |
|---|---|---|---|---|---|---|
| 0001 | MANDT | X | MANDT | MANDT | CLNT | 000003 |
| 0002 | LGNUM | X | LGNUM | LGNUM | CHAR | 000003 |
| 0003 | TBNUM | X | TBNUM | TBNUM | NUMC | 000010 |
| 0004 | TBPOS | X | TBPOS | TBPOS | NUMC | 000004 |
| 0005 | ELIKZ |  | LTBP_ELIKZ | XFELD | CHAR | 000001 |
| 0006 | MATNR |  | MATNR | MATNR | CHAR | 000040 |
| 0007 | WERKS |  | WERKS_D | WERKS | CHAR | 000004 |
| 0008 | BESTQ |  | BESTQ | BESTQ | CHAR | 000001 |
| 0009 | CHARG |  | CHARG_D | CHARG | CHAR | 000010 |
| 0010 | SOBKZ |  | SOBKZ | SOBKZ | CHAR | 000001 |
| 0011 | SONUM |  | LVS_SONUM | LVS_SONUM | CHAR | 000016 |
| 0012 | MENGE |  | LTBP_MENGE | MENG13 | QUAN | 000013 |
| 0013 | MEINS |  | MEINS | MEINS | UNIT | 000003 |
| 0014 | MENGA |  | LTBP_MENGA | MENG13 | QUAN | 000013 |
| 0015 | ALTME |  | LRMEI | MEINS | UNIT | 000003 |
| 0016 | UMREZ |  | UMREZ | UMBSZ | DEC | 000005 |
| 0017 | UMREN |  | UMREN | UMBSN | DEC | 000005 |
| 0018 | TANUM |  | LTBP_TANUM | TANUM | NUMC | 000010 |
| 0019 | TAMEN |  | LTBP_TAMEN | MENG13 | QUAN | 000013 |
| 0020 | TAMEA |  | LTBP_TAMEA | MENG13 | QUAN | 000013 |
| 0021 | AOFTA |  | LTBP_AOFTA | LVS_ANZPS | DEC | 000005 |
| 0022 | AGSTA |  | LTBP_AGSTA | LVS_ANZPS | DEC | 000005 |
| 0023 | TDATU |  | LTBP_TDATU | DATUM | DATS | 000008 |
| 0024 | TZEIT |  | LTBP_TZEIT | UZEIT | TIMS | 000006 |
| 0025 | WEMPF |  | WEMPF | WEMPF | CHAR | 000012 |
| 0026 | ABLAD |  | ABLAD | TEXT25 | CHAR | 000025 |
| 0027 | MBPOS |  | MBLPO | MBLPO | NUMC | 000004 |
| 0028 | WDATU |  | LVS_WDATU | DATUM | DATS | 000008 |
| 0029 | ZEUGN |  | LVS_ZEUGN | LVS_ZEUGN | CHAR | 000010 |
| 0030 | BRGEW |  | LTBP_BRGEW | DEC8_3 | DEC | 000011 |
| 0031 | GEWEI |  | GEWEI | MEINS | UNIT | 000003 |
| 0032 | QPLOS |  | QPLOS | QPLOS | NUMC | 000012 |
| 0033 | RSPOS |  | RSPOS | RSPOS | NUMC | 000004 |
| 0034 | VFDAT |  | VFDAT | DATUM | DATS | 000008 |
| 0035 | ANZL1 |  | LVS_ANZLE | LVS_ANZLE | DEC | 000003 |
| 0036 | ANZL2 |  | LVS_ANZLE | LVS_ANZLE | DEC | 000003 |
| 0037 | LMEN1 |  | LVS_LEMEN | MENG13 | QUAN | 000013 |
| 0038 | LMEN2 |  | LVS_LEMEN | MENG13 | QUAN | 000013 |
| 0039 | LETY1 |  | LVS_LETYP | LVS_LETYP | CHAR | 000003 |
| 0040 | LETY2 |  | LVS_LETYP | LVS_LETYP | CHAR | 000003 |
| 0041 | QPLOA |  | QPLOA | QPLOS | NUMC | 000012 |
| 0042 | RSART |  | RSART | RSART | CHAR | 000001 |
| 0043 | KZECH |  | LVS_KZECH | XFELD | CHAR | 000001 |
| 0044 | LGORT |  | LGORT_D | LGORT | CHAR | 000004 |
| 0045 | L2SKR |  | LVS_2SKPREL | LVS_2SKPREL | CHAR | 000001 |
| 0046 | KZFME |  | KZFME | KZFME | CHAR | 000001 |
| 0048 | SGT_SCAT |  | SGT_SCAT | SGT_SRCA | CHAR | 000040 |

### LTAP
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DOMNAME | DATATYPE | LENG |
|---|---|---|---|---|---|---|
| 0001 | MANDT | X | MANDT | MANDT | CLNT | 000003 |
| 0002 | LGNUM | X | LGNUM | LGNUM | CHAR | 000003 |
| 0003 | TANUM | X | TANUM | TANUM | NUMC | 000010 |
| 0004 | TAPOS | X | TAPOS | TAPOS | NUMC | 000004 |
| 0005 | TBPOS |  | TBPOS | TBPOS | NUMC | 000004 |
| 0006 | POSNR |  | POSNR | POSNR | NUMC | 000006 |
| 0007 | MATNR |  | MATNR | MATNR | CHAR | 000040 |
| 0008 | WERKS |  | WERKS_D | WERKS | CHAR | 000004 |
| 0009 | CHARG |  | CHARG_D | CHARG | CHAR | 000010 |
| 0010 | BESTQ |  | BESTQ | BESTQ | CHAR | 000001 |
| 0011 | SOBKZ |  | SOBKZ | SOBKZ | CHAR | 000001 |
| 0012 | SONUM |  | LVS_SONUM | LVS_SONUM | CHAR | 000016 |
| 0013 | STOFF |  | STOFF | STOFF | CHAR | 000040 |
| 0014 | MEINS |  | MEINS | MEINS | UNIT | 000003 |
| 0015 | ALTME |  | LRMEI | MEINS | UNIT | 000003 |
| 0016 | UMREZ |  | UMREZ | UMBSZ | DEC | 000005 |
| 0017 | UMREN |  | UMREN | UMBSN | DEC | 000005 |
| 0018 | LETYP |  | LVS_LETYP | LVS_LETYP | CHAR | 000003 |
| 0019 | KZFEH |  | LTAP_KZFEH | XFELD | CHAR | 000001 |
| 0020 | LANUM |  | T310_LANUM | T310_LANUM | NUMC | 000003 |
| 0021 | KZQUI |  | LTAP_KZQUI | XFELD | CHAR | 000001 |
| 0022 | KZNKO |  | LVS_KZNKO | XFELD | CHAR | 000001 |
| 0023 | NULKO |  | LTAP_NULKO | LTAP_NULKO | NUMC | 000001 |
| 0024 | KZINV |  | LTAP_KZINV | LVS_KZINV | CHAR | 000002 |
| 0025 | IVNUM |  | LVS_IVNUM | BELNR | CHAR | 000010 |
| 0026 | PQUIT |  | LTAP_PQUIT | XFELD | CHAR | 000001 |
| 0027 | QDATU |  | LTAP_QDATU | DATUM | DATS | 000008 |
| 0028 | QZEIT |  | LTAP_QZEIT | UZEIT | TIMS | 000006 |
| 0029 | QNAME |  | LTAP_QNAME | USNAM | CHAR | 000012 |
| 0030 | BRGEW |  | LTAP_BRGEW | DEC8_3 | DEC | 000011 |
| 0031 | GEWEI |  | GEWEI | MEINS | UNIT | 000003 |
| 0032 | MBPOS |  | MBLPO | MBLPO | NUMC | 000004 |
| 0033 | WEMPF |  | WEMPF | WEMPF | CHAR | 000012 |
| 0034 | ABLAD |  | ABLAD | TEXT25 | CHAR | 000025 |
| 0035 | WDATU |  | LVS_WDATU | DATUM | DATS | 000008 |
| 0036 | WENUM |  | LVS_WENUM | BELNR | CHAR | 000010 |
| 0037 | WEPOS |  | LVS_WEPOS | MBLPO | NUMC | 000004 |
| 0038 | ZEUGN |  | LVS_ZEUGN | LVS_ZEUGN | CHAR | 000010 |
| 0039 | LDEST |  | LVS_LDEST | RSPOPNAME | CHAR | 000004 |
| 0040 | VORGA |  | LTAP_VORGA | LTAP_VORGA | CHAR | 000002 |
| 0041 | VLTYP |  | LTAP_VLTYP | LGTYP | CHAR | 000003 |
| 0042 | VLBER |  | LTAP_VLBER | LGBER | CHAR | 000003 |
| 0043 | VLPLA |  | LTAP_VLPLA | LGPLA | CHAR | 000010 |
| 0044 | VKDYN |  | LVS_KZDYN | XFELD | CHAR | 000001 |
| 0045 | VPPOS |  | LTAP_VPPOS | LVS_PLPOS | CHAR | 000002 |
| 0046 | VANZL |  | LTAP_VANZL | LAGP_ANZLE | DEC | 000009 |
| 0047 | VANBR |  | LTAP_VANBR | XFELD | CHAR | 000001 |
| 0048 | VSOLM |  | LTAP_VSOLM | MENG13 | QUAN | 000013 |
| 0049 | VISTM |  | LTAP_VISTM | MENG13 | QUAN | 000013 |
| 0050 | VDIFM |  | LTAP_VDIFM | MENSH | QUAN | 000013 |
| 0051 | VSOLA |  | LTAP_VSOLA | MENG13 | QUAN | 000013 |
| 0052 | VISTA |  | LTAP_VISTA | MENG13 | QUAN | 000013 |
| 0053 | VDIFA |  | LTAP_VDIFA | MENSH | QUAN | 000013 |
| 0054 | VLQNR |  | LVS_LQNUM | LVS_LQNUM | NUMC | 000010 |
| 0055 | VAPPC |  | LTAP_VAPPC | XFELD | CHAR | 000001 |
| 0056 | NLTYP |  | LTAP_NLTYP | LGTYP | CHAR | 000003 |
| 0057 | NLBER |  | LTAP_NLBER | LGBER | CHAR | 000003 |
| 0058 | NLPLA |  | LTAP_NLPLA | LGPLA | CHAR | 000010 |
| 0059 | NKDYN |  | LVS_KZDYN | XFELD | CHAR | 000001 |
| 0060 | NPPOS |  | LTAP_NPPOS | LVS_PLPOS | CHAR | 000002 |
| 0061 | NANZL |  | LTAP_NANZL | LAGP_ANZLE | DEC | 000009 |
| 0062 | NANBR |  | LTAP_NANBR | XFELD | CHAR | 000001 |
| 0063 | NSOLM |  | LTAP_NSOLM | MENG13 | QUAN | 000013 |
| 0064 | NISTM |  | LTAP_NISTM | MENG13 | QUAN | 000013 |
| 0065 | NDIFM |  | LTAP_NDIFM | MENSH | QUAN | 000013 |
| 0066 | NSOLA |  | LTAP_NSOLA | MENG13 | QUAN | 000013 |
| 0067 | NISTA |  | LTAP_NISTA | MENG13 | QUAN | 000013 |
| 0068 | NDIFA |  | LTAP_NDIFA | MENSH | QUAN | 000013 |
| 0069 | NLQNR |  | LVS_LQNUM | LVS_LQNUM | NUMC | 000010 |
| 0070 | NAPPC |  | LTAP_NAPPC | XFELD | CHAR | 000001 |
| 0071 | RLTYP |  | LTAP_RLTYP | LGTYP | CHAR | 000003 |
| 0072 | RLBER |  | LTAP_RLBER | LGBER | CHAR | 000003 |
| 0073 | RLPLA |  | LTAP_RLPLA | LGPLA | CHAR | 000010 |
| 0074 | RPPOS |  | LTAP_RPPOS | LVS_PLPOS | CHAR | 000002 |
| 0075 | RSOLM |  | LTAP_RSOLM | MENG13 | QUAN | 000013 |
| 0076 | RISTM |  | LTAP_RISTM | MENG13 | QUAN | 000013 |
| 0077 | RDIFM |  | LTAP_RDIFM | MENSH | QUAN | 000013 |
| 0078 | RSOLA |  | LTAP_RSOLA | MENG13 | QUAN | 000013 |
| 0079 | RISTA |  | LTAP_RISTA | MENG13 | QUAN | 000013 |
| 0080 | RDIFA |  | LTAP_RDIFA | MENSH | QUAN | 000013 |
| 0081 | RLQNR |  | LVS_LQNUM | LVS_LQNUM | NUMC | 000010 |
| 0082 | RAPPC |  | LTAP_RAPPC | XFELD | CHAR | 000001 |
| 0083 | DLTYP |  | LTAP_DLTYP | LGTYP | CHAR | 000003 |
| 0084 | DLPLA |  | LTAP_DLPLA | LGPLA | CHAR | 000010 |
| 0085 | DLQNR |  | LTAP_DLQNR | LVS_LQNUM | NUMC | 000010 |
| 0086 | DMENG |  | LTAP_DMENG | MENSH | QUAN | 000013 |
| 0087 | DMENA |  | LTAP_DMENA | MENSH | QUAN | 000013 |
| 0088 | KZDIF |  | LVS_KZDIF | LVS_KZDIF | CHAR | 000001 |
| 0089 | MAKTX |  | MAKTX | TEXT40 | CHAR | 000040 |
| 0090 | DRUCK |  | LVS_DRUCK | XFELD | CHAR | 000001 |
| 0091 | VLENR |  | LTAP_VLENR | LENUM | CHAR | 000020 |
| 0092 | NLENR |  | LTAP_NLENR | LENUM | CHAR | 000020 |
| 0093 | DLENR |  | LTAP_DLENR | LENUM | CHAR | 000020 |
| 0094 | VLEST |  | LTAP_VLEST | LEIN_STATU | CHAR | 000001 |
| 0095 | NLEST |  | LTAP_NLEST | LEIN_STATU | CHAR | 000001 |
| 0096 | LELAS |  | LTAP_LELAS | XFELD | CHAR | 000001 |
| 0097 | HOMVE |  | LTAP_HOMVE | XFELD | CHAR | 000001 |
| 0098 | POSTY |  | LTAP_POSTY | LTAP_POSTY | CHAR | 000001 |
| 0099 | ORPOS |  | LTAP_ORPOS | TAPOS | NUMC | 000004 |
| 0100 | VSUMM |  | LTAP_VSUMM | T331BSUMME | CHAR | 000001 |
| 0101 | VBLCH |  | LTAP_VBLCH | XFELD | CHAR | 000001 |
| 0102 | NSUMM |  | LTAP_NSUMM | T331BSUMME | CHAR | 000001 |
| 0103 | NBLCH |  | LTAP_NBLCH | XFELD | CHAR | 000001 |
| 0104 | RSPOS |  | RSPOS | RSPOS | NUMC | 000004 |
| 0105 | VFDAT |  | VFDAT | DATUM | DATS | 000008 |
| 0106 | VKAPV |  | LTAP_VKAPV | DEC8_3 | DEC | 000011 |
| 0107 | VKAPA |  | LTAP_VKAPA | T331_KAPAP | CHAR | 000001 |
| 0108 | NKAPA |  | LTAP_NKAPA | T331_KAPAP | CHAR | 000001 |
| 0109 | RKAPA |  | LTAP_RKAPA | T331_KAPAP | CHAR | 000001 |
| 0110 | KZSUB |  | LTAP_KZSUB | LTAP_KZSUB | CHAR | 000001 |
| 0111 | QPLOS |  | QPLOS | QPLOS | NUMC | 000012 |
| 0112 | QPLOA |  | QPLOA | QPLOS | NUMC | 000012 |
| 0113 | KZSTI |  | LTAP_KZSTI | XFELD | CHAR | 000001 |
| 0114 | RSART |  | RSART | RSART | CHAR | 000001 |
| 0115 | KZECH |  | LVS_KZECH | XFELD | CHAR | 000001 |
| 0116 | KOBER |  | KOBER | KOBER | CHAR | 000003 |
| 0117 | LGORT |  | LGORT_D | LGORT | CHAR | 000004 |
| 0118 | SOLPO |  | LTAP_SOLPO | PW_QUAN13 | QUAN | 000013 |
| 0119 | ZEIEI |  | LVS_ZEIEI | MEINS | UNIT | 000003 |
| 0120 | L2SKR |  | LVS_2SKREL | LVS_2SKREL | CHAR | 000001 |
| 0121 | VOLUM |  | VOLUM | MENG13 | QUAN | 000013 |
| 0122 | VOLEH |  | VOLEH | MEINS | UNIT | 000003 |
| 0123 | KZBEF |  | LVS_KZBEF | XFELD | CHAR | 000001 |
| 0124 | IMREL |  | LVS_IMREL | LVS_IMREL | CHAR | 000001 |
| 0125 | NWIRM |  | LTAP_NWIRM | MENG13 | QUAN | 000013 |
| 0126 | WIRME |  | LTAP_WIRME | MEINS | UNIT | 000003 |
| 0127 | NPLEI |  | LVS_NPLEI | LVS_NPLEI | CHAR | 000001 |
| 0128 | KBNKZ |  | KBNKZ | KBNKZ | CHAR | 000001 |
| 0129 | STOAN |  | LVS_STOAN | XFELD | CHAR | 000001 |
| 0130 | KGVNQ |  | LVS_KGVNQ | XFELD | CHAR | 000001 |
| 0131 | PVQUI |  | LTAP_PVQUI | XFELD | CHAR | 000001 |
| 0132 | EDATU |  | LTAP_EDATU | DATUM | DATS | 000008 |
| 0133 | EZEIT |  | LTAP_EZEIT | UZEIT | TIMS | 000006 |
| 0134 | ENAME |  | LTAP_ENAME | USNAM | CHAR | 000012 |
| 0135 | KZFME |  | KZFME | KZFME | CHAR | 000001 |
| 0136 | QUSUB |  | LTAP_QUSUB | RL03TQUKNZ | CHAR | 000001 |
| 0137 | FHUTA |  | LTAP_FHUTA | LTAP_FHUTA | CHAR | 000001 |
| 0138 | VNEST |  | VLEIN_NEST | XFELD | CHAR | 000001 |
| 0139 | VHILM |  | VHILM | MATNR | CHAR | 000040 |
| 0140 | VDUMM |  | LTAP_VDUMM | XFELD | CHAR | 000001 |
| 0141 | NDUMM |  | LTAP_NDUMM | XFELD | CHAR | 000001 |
| 0142 | VSERI |  | LTAP_VSERI | XFELD | CHAR | 000001 |
| 0143 | HUPIK |  | LTAP_HUPIK | XFELD | CHAR | 000001 |
| 0144 | NXIDV |  | EXIDV | EXIDV | CHAR | 000020 |
| 0145 | NOLIS |  | LTAP_NOLIS | XFELD | CHAR | 000001 |
| 0146 | NPIPO |  | LTAP_NPIPO | XFELD | CHAR | 000001 |
| 0147 | PIPAR |  | LTAP_PIPAR | XFELD | CHAR | 000001 |
| 0148 | PCKPF |  | PCKPF | PCKPF | CHAR | 000001 |
| 0149 | KZTRM |  | LTAP_KZTRM | XFELD | CHAR | 000001 |
| 0150 | PASSD |  | LTAP_PASSD | XFELD | CHAR | 000001 |
| 0151 | VBELN |  | VBELN_VL | VBELN | CHAR | 000010 |
| 0152 | KZXDK |  | LTAP_KZXDK | XFELD | CHAR | 000001 |
| 0153 | KZVAS |  | LTAP_KZVAS | XFELD | CHAR | 000001 |
| 0154 | FROM_INSP_GUID |  | MSR_INSP_GUID |  | RAW | 000016 |
| 0155 | TO_INSP_GUID |  | MSR_INSP_GUID |  | RAW | 000016 |
| 0156 | DIFF_INSP_GUID |  | MSR_INSP_GUID |  | RAW | 000016 |
| 0157 | RETURN_INSP_GUID |  | MSR_INSP_GUID |  | RAW | 000016 |
| 0159 | /CWM/IND_CATCH |  | /CWM/IND_CATCH | /CWM/IND_CATCH | CHAR | 000001 |
| 0160 | /CWM/ACT_QTY |  | /CWM/ACT_QTY | MENG13 | QUAN | 000013 |
| 0161 | /CWM/ACT_UOM |  | /CWM/ACT_UOM | MEINS | UNIT | 000003 |
| 0162 | /CWM/TGT_QTY |  | /CWM/TGT_QTY | MENG13 | QUAN | 000013 |
| 0163 | /CWM/TGT_UOM |  | /CWM/TGT_UOM | MEINS | UNIT | 000003 |
| 0164 | /CWM/HU_NEW_QTY |  | /CWM/HU_NEW_QTY | MENG13 | QUAN | 000013 |
| 0165 | /CWM/HU_OLD_QTY |  | /CWM/HU_OLD_QTY | MENG13 | QUAN | 000013 |
| 0166 | /CWM/VEMEH |  | /CWM/VEMEH | MEINS | UNIT | 000003 |
| 0167 | /CWM/XCWMAT |  | /CWM/XCWMAT | XFELD | CHAR | 000001 |
| 0168 | /CWM/MEINS |  | /CWM/MEINS | MEINS | UNIT | 000003 |
| 0169 | /CWM/IND_DELUPD |  | /CWM/IND_DELUPD | XFELD | CHAR | 000001 |
| 0171 | DCNUM |  | LXDCK_DCNUM | LXDCK_DCNUM | NUMC | 000014 |
| 0172 | ZRSTG |  | FLAG | FLAG | CHAR | 000001 |
| 0173 | TOVAS |  | FLAG | FLAG | CHAR | 000001 |
| 0175 | SGT_SCAT |  | SGT_SCAT | SGT_SRCA | CHAR | 000040 |

## 11. Domain values of LTBK-STATU
Domain: `LTBK_STATU`
| Value | Text |
|---|---|
| E | Processing Complete |
| T | Partially Delivered |

## 12. MARC-XCHPF and MARC-SERNP
| FIELDNAME | ROLLNAME | DOMNAME | DATATYPE | LENG | TEXT |
|---|---|---|---|---|---|
| XCHPF | XCHPF_WERKS | XFELD | CHAR | 000001 | Batch Management Requirement Indicator for Plant |
| SERNP | SERAIL | SERAIL | CHAR | 000004 | Serial Number Profile |

## 13. Text field lengths for goods movements (re-read)
- `MKPF-BKTXT`: CHAR 000025 (data element `BKTXT`)
- `BAPI2017_GM_ITEM_CREATE-ITEM_TEXT`: CHAR 000050 (data element `SGTXT`)
- `MATDOC-SGTXT`: CHAR 000050 (data element `SGTXT`)
- `MSEG-SGTXT`: CHAR 000050 (data element `SGTXT`)
- `BAPI2017_GM_HEAD_01-HEADER_TXT`: CHAR 000025 (data element `BKTXT`)

## 14. MATDOC cancellation / reversal fields
| FIELDNAME | ROLLNAME | DATATYPE | LENG |
|---|---|---|---|
| SJAHR | MJAHR | NUMC | 000004 |
| SMBLN | MBLNR | CHAR | 000010 |
| SMBLP | MBLPO | NUMC | 000004 |
| CANCELLED | NSDM_CANCELLED_IND | CHAR | 000001 |
| CANCELLATION_TYPE | NSDM_CANCELLATION_TYPE | CHAR | 000001 |
| REVERSAL_MOVEMENT | XSTBW | CHAR | 000001 |

(MATDOC has 333 fields; TBNUM/TBPOS/PQUIT present in LTAP: TBNUM=false, TBPOS=true, PQUIT=true, VORGA=true)

## 15. Authorization objects (TOBJ / TOBJT)
| Object | Exists | Fields | Class | Text |
|---|---|---|---|---|
| L_LGNUM | YES | LGNUM, LGTYP | LE_L | Warehouse Number / Storage Type |
| L_TCODE | YES | TCD | LE_L | Transaction Codes in the Warehouse Management System |
| L_BWLVS | YES | LGNUM, BWLVS | LE_L | Movement Type in the Warehouse Management System |
| M_MSEG_BWA | YES | ACTVT, BWART | MM_B | Goods Movements: Movement Type |
| M_MSEG_WWA | YES | ACTVT, WERKS | MM_B | Goods Movements: Plant |
| M_MRES_BWA | YES | ACTVT, BWART | MM_B | Reservations: Movement Type |
| M_MRES_WWA | YES | ACTVT, WERKS | MM_B | Reservations: Plant |

## 16. RFC-enabled check of candidate function modules (TFDIR.FMODE, R = remote-enabled)
| FM | Exists | FMODE | Group |
|---|---|---|---|
| AUTHORITY_CHECK | YES | R | SAPLSUSR |
| SUSR_USER_AUTH_FOR_OBJ_GET | YES | R | SAPLSUSE |
| ENQUEUE_EMRESB | YES |  | /1BCDWBEN/SAPLCEN0000 |
| DEQUEUE_EMRESB | YES |  | /1BCDWBEN/SAPLCEN0000 |
| RFC_GET_FUNCTION_INTERFACE | YES | R | SAPLRFC1 |
| L_TO_CONFIRM | YES | R | SAPLL03B |
| Z_WM_TO_CREATE_FROM_TR | YES | R | SAPLZ_VENDOR_REMOTES |
| Z_WM_GET_TR_MATERIAL_LIST | YES | R | SAPLZ_WM_TR_SERVICES |

## 17. Interface of `AUTHORITY_CHECK` (RFC-enabled, see §16)
| PARAMCLASS | PARAMETER | TABNAME | FIELDNAME | EXID | DEFAULT | OPTIONAL | PARAMTEXT |
|---|---|---|---|---|---|---|---|
| I | FIELD1 | UST12 | FIELD | C | SPACE | X | An authorization field to the obje |
| I | FIELD10 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD2 | UST12 | FIELD | C | SPACE | X | Another author.field to the object |
| I | FIELD3 | UST12 | FIELD | C | SPACE | X | Another a author.field to the obje |
| I | FIELD4 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD5 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD6 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD7 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD8 | UST12 | FIELD | C | SPACE | X |  |
| I | FIELD9 | UST12 | FIELD | C | SPACE | X |  |
| I | NEW_BUFFERING | XUFLAG |  | C | 3 | X | Auth. object in user master maintenance |
| I | OBJECT | UST12 | OBJCT | C |  |  | Name of the object to be checked |
| I | USER | USR02 | BNAME | C | SY-UNAME | X | Name of the user to be checked |
| I | VALUE1 | UST12 | VON | C | SPACE | X | Inspection value to field1 |
| I | VALUE10 | UST12 | VON | C | SPACE | X |  |
| I | VALUE2 | UST12 | VON | C | SPACE | X | Inspection value to field1 (may be |
| I | VALUE3 | UST12 | VON | C | SPACE | X | Inspection value to field1 (may be |
| I | VALUE4 | UST12 | VON | C | SPACE | X |  |
| I | VALUE5 | UST12 | VON | C | SPACE | X |  |
| I | VALUE6 | UST12 | VON | C | SPACE | X |  |
| I | VALUE7 | UST12 | VON | C | SPACE | X |  |
| I | VALUE8 | UST12 | VON | C | SPACE | X |  |
| I | VALUE9 | UST12 | VON | C | SPACE | X |  |
| X | USER_DONT_EXIST |  |  |  |  |  | User does not exist |
| X | USER_IS_AUTHORIZED |  |  |  |  |  | User is authorized |
| X | USER_IS_LOCKED |  |  |  |  |  |  |
| X | USER_NOT_AUTHORIZED |  |  |  |  |  | User is not authorized |

## 18. LTAK fields relevant to the TR -> TO link (DD03L)
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DATATYPE | LENG |
|---|---|---|---|---|---|
| 0002 | LGNUM | X | LGNUM | CHAR | 000003 |
| 0003 | TANUM | X | TANUM | NUMC | 000010 |
| 0005 | BWLVS |  | BWLVS | NUMC | 000003 |
| 0012 | TBNUM |  | TBNUM | NUMC | 000010 |
| 0015 | KQUIT |  | LTAK_KQUIT | CHAR | 000001 |
| 0019 | BETYP |  | LVS_BETYP | CHAR | 000001 |
| 0020 | BENUM |  | LVS_BENUM | CHAR | 000010 |
| 0029 | RSNUM |  | RSNUM | NUMC | 000010 |

(LTAP carries TBPOS and PQUIT but no TBNUM: the TR number is on the TO header LTAK-TBNUM; an item-level "unconfirmed TO exists for TR item" check therefore reads LTAK by LGNUM+TBNUM, then LTAP by LGNUM+TANUM+TBPOS.)

## 19. Domain values of LTAP-VORGA (TO item transaction, used to recognise cancelled items)
| Value | Text |
|---|---|
(no fixed values)

## 20. Live behaviour of `AUTHORITY_CHECK` over node-rfc (read-only probe)

Called with `OBJECT='L_LGNUM', FIELD1='LGNUM', VALUE1='W01', FIELD2='LGTYP', VALUE2='902'` and with `OBJECT='M_MSEG_BWA', FIELD1='ACTVT', VALUE1='01', FIELD2='BWART', VALUE2='311'` (USER defaulted to SY-UNAME = the RFC user).
The function module never returns normally: it always raises one of its classic exceptions, which node-rfc surfaces as `ABAPError` with `err.key`:

| Result | `err.key` |
|---|---|
| authorized | `USER_IS_AUTHORIZED` |
| not authorized | `USER_NOT_AUTHORIZED` (not observed: the RFC user holds SAP_ALL, so even `LGNUM='ZZZ'` returned `USER_IS_AUTHORIZED`) |
| other | `USER_DONT_EXIST`, `USER_IS_LOCKED` |

Consequence for the adapter: treat `err.key === 'USER_IS_AUTHORIZED'` as success, `USER_NOT_AUTHORIZED` as HTTP 403, anything else as HTTP 502.
Same mechanism applies to every classic exception (e.g. `L_TO_CONFIRM` `TO_CONFIRMED`): `err.key` carries the exception name.
`ENQUEUE_EMRESB` / `DEQUEUE_EMRESB` are **not** remote-enabled (§16, FMODE blank), so no SAP-side lock can be taken from the Node layer.
