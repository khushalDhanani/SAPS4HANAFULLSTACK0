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

## 21. Interfaces of ENQUEUE_EMRESB / DEQUEUE_EMRESB (for the proposed Z_WM_RES_LOCK wrapper)

### ENQUEUE_EMRESB
| PARAMCLASS | PARAMETER | TABNAME | FIELDNAME | EXID | DEFAULT | OPTIONAL | PARAMTEXT |
|---|---|---|---|---|---|---|---|
| I | MANDT | RESB | MANDT | C | SY-MANDT | X | Enqueue argument 01 |
| I | MODE_RESB | ENQMODE |  | C | 'E' | X | Lock mode for table RESB |
| I | RSART | RESB | RSART | C |  | X | Enqueue argument 04 |
| I | RSNUM | RESB | RSNUM | N |  | X | Enqueue argument 02 |
| I | RSPOS | RESB | RSPOS | N |  | X | Enqueue argument 03 |
| I | X_RSART |  |  |  | SPACE | X | Fill argument 04 with initial value? |
| I | X_RSNUM |  |  |  | SPACE | X | Fill argument 02 with initial value? |
| I | X_RSPOS |  |  |  | SPACE | X | Fill argument 03 with initial value? |
| I | _COLLECT | DDENQCOLL |  | C | ' ' | X | Initially only collect lock |
| I | _SCOPE |  |  |  | '2' | X |  |
| I | _WAIT |  |  |  | SPACE | X |  |
| X | FOREIGN_LOCK |  |  |  |  |  | Object already locked |
| X | SYSTEM_FAILURE |  |  |  |  |  | Internal error from enqueue server |

### DEQUEUE_EMRESB
| PARAMCLASS | PARAMETER | TABNAME | FIELDNAME | EXID | DEFAULT | OPTIONAL | PARAMTEXT |
|---|---|---|---|---|---|---|---|
| I | MANDT | RESB | MANDT | C | SY-MANDT | X | Enqueue argument 01 |
| I | MODE_RESB | ENQMODE |  | C | 'E' | X | Lock mode for table RESB |
| I | RSART | RESB | RSART | C |  | X | Enqueue argument 04 |
| I | RSNUM | RESB | RSNUM | N |  | X | Enqueue argument 02 |
| I | RSPOS | RESB | RSPOS | N |  | X | Enqueue argument 03 |
| I | X_RSART |  |  |  | SPACE | X | Fill argument 04 with initial value? |
| I | X_RSNUM |  |  |  | SPACE | X | Fill argument 02 with initial value? |
| I | X_RSPOS |  |  |  | SPACE | X | Fill argument 03 with initial value? |
| I | _COLLECT | DDENQCOLL |  | C | ' ' | X | Initially only collect lock |
| I | _SCOPE |  |  |  | '3' | X |  |
| I | _SYNCHRON |  |  |  | SPACE | X | Synchonous unlock |

## 22. RFC-enabled source readers (TFDIR.FMODE)
| FM | Exists | FMODE | Group | Include |
|---|---|---|---|---|
| RPY_FUNCTIONMODULE_READ_NEW | YES | R | SAPLSIFP | 21 |
| RPY_FUNCTIONMODULE_READ | YES | R | SAPLSIFP | 12 |
| RFC_READ_REPORT | NO |  |  |  |
| FUNCTION_INCLUDE_INFO | YES |  | SAPLSUNI | 13 |

Z_WM_TO_CREATE_FROM_TR: group SAPLZ_VENDOR_REMOTES, include 05

## 23. Source of Z_WM_TO_CREATE_FROM_TR (read-only, `RPY_FUNCTIONMODULE_READ_NEW`, 159 lines, 2026-10-12)

Findings (CONFIRMED from this source): blank `NLTYP`/`NLPLA` on an item are filled from the LTBK header; blank `VLTYP`/`VLPLA` are passed through unchanged; T333 is **not** read by the wrapper; the item table goes to `L_TO_CREATE_TR` (`IT_TRITE`), which applies the standard WM determination. Whether `L_TO_CREATE_TR` then takes `NLTYP`/`NLPLA` from T333 when both item and LTBK header are blank is standard SAP behaviour and UNSURE until a sandbox TO is created that way.

```abap
FUNCTION z_wm_to_create_from_tr.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_LGNUM) TYPE  LGNUM
*"     VALUE(IV_TBNUM) TYPE  LTBK-TBNUM
*"     VALUE(IV_COMMIT) TYPE  CHAR1 DEFAULT 'X'
*"     VALUE(IV_SQUIT) TYPE  CHAR1 DEFAULT ' '
*"  EXPORTING
*"     VALUE(EV_TANUM) TYPE  LTAK-TANUM
*"     VALUE(EV_SUCCESS) TYPE  CHAR1
*"     VALUE(EV_MESSAGE) TYPE  BAPI_MSG
*"  TABLES
*"      IT_ITEMS TYPE  L03B_TRITE_T OPTIONAL
*"      ET_MESSAGES TYPE  BAPIRET2_T OPTIONAL
*"----------------------------------------------------------------------
  DATA: ls_hdr      TYPE ltbk,
        lt_trite    TYPE TABLE OF l03b_trite,
        ls_trite    TYPE l03b_trite,
        lt_ltak     TYPE TABLE OF ltak_vb,
        lt_ltap_vb  TYPE TABLE OF ltap_vb,
        lv_tbnum    TYPE ltbk-tbnum,
        lv_squit    TYPE rl03t-squit,
        lv_commit   TYPE rl03b-comit,
        ls_return   TYPE bapiret2.

  CLEAR: ev_tanum, ev_success, ev_message, et_messages[].

  lv_tbnum = |{ iv_tbnum ALPHA = IN }|.

  " Ensure valid XFELD values (only space or X)
  IF iv_squit = 'X'.
    lv_squit = 'X'.
  ELSE.
    lv_squit = space.
  ENDIF.

  IF iv_commit = 'X'.
    lv_commit = 'X'.
  ELSE.
    lv_commit = space.
  ENDIF.

  SELECT SINGLE *
    FROM ltbk
    INTO ls_hdr
   WHERE lgnum = iv_lgnum
     AND tbnum = lv_tbnum.

  IF sy-subrc <> 0.
    ev_success = 'E'.
    ev_message = |Transfer Requirement { lv_tbnum } not found in warehouse { iv_lgnum }.|.

    ls_return-type       = 'E'.
    ls_return-id         = 'L3'.
    ls_return-number     = '000'.
    ls_return-message    = ev_message.
    APPEND ls_return TO et_messages.
    RETURN.
  ENDIF.

  LOOP AT it_items INTO DATA(ls_item).
    CLEAR ls_trite.
    MOVE-CORRESPONDING ls_item TO ls_trite.

    IF ls_trite-nltyp IS INITIAL.
      ls_trite-nltyp = ls_hdr-nltyp.
    ENDIF.
    IF ls_trite-nlpla IS INITIAL.
      ls_trite-nlpla = ls_hdr-nlpla.
    ENDIF.

    IF ls_trite-vlenr IS NOT INITIAL.
      ls_trite-vlenr = |{ ls_trite-vlenr ALPHA = IN }|.
    ENDIF.

    APPEND ls_trite TO lt_trite.
  ENDLOOP.

  CALL FUNCTION 'L_TO_CREATE_TR'
    EXPORTING
      i_lgnum                       = ls_hdr-lgnum
      i_tbnum                       = ls_hdr-tbnum
      i_commit_work                 = lv_commit
      i_bname                       = sy-uname
      i_squit                       = lv_squit
      i_rsnum                       = ls_hdr-rsnum
      it_trite                      = lt_trite
    TABLES
      t_ltak                        = lt_ltak
      t_ltap_vb                     = lt_ltap_vb
    EXCEPTIONS
      foreign_lock                  = 1
      qm_relevant                   = 2
      tr_completed                  = 3
      xfeld_wrong                   = 4
      ldest_wrong                   = 5
      drukz_wrong                   = 6
      tr_wrong                      = 7
      squit_forbidden               = 8
      no_to_created                 = 9
      update_without_commit         = 10
      no_authority                  = 11
      preallocated_stock            = 12
      partial_transfer_req_forbidden = 13
      input_error                   = 14
      OTHERS                        = 15.

  IF sy-subrc = 0.
    READ TABLE lt_ltak INTO DATA(ls_ltak) INDEX 1.
    IF sy-subrc = 0 AND ls_ltak-tanum IS NOT INITIAL.
      ev_tanum = ls_ltak-tanum.
    ELSE.
      READ TABLE lt_ltap_vb INTO DATA(ls_ltap) INDEX 1.
      IF sy-subrc = 0 AND ls_ltap-tanum IS NOT INITIAL.
        ev_tanum = ls_ltap-tanum.
      ENDIF.
    ENDIF.
  ENDIF.

  IF ev_tanum IS NOT INITIAL.
    ev_success = 'S'.
    ev_message = |Transfer Order { ev_tanum } created successfully.|.

    ls_return-type    = 'S'.
    ls_return-message = ev_message.
    APPEND ls_return TO et_messages.

    IF lv_commit = 'X'.
      COMMIT WORK AND WAIT.
    ENDIF.
  ELSE.
    ev_success = 'E'.

    IF sy-msgid IS NOT INITIAL AND ( sy-msgid <> 'L3' OR sy-msgno <> '362' ).
      MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
        INTO ev_message.
    ELSE.
      CASE sy-subrc.
        WHEN 1.  ev_message = 'TR locked by another user (foreign_lock).'.
        WHEN 2.  ev_message = 'Material is QM relevant.'.
        WHEN 3.  ev_message = 'Transfer Requirement is already completed.'.
        WHEN 4.  ev_message = 'XFELD_WRONG: Invalid indicator value passed.'.
        WHEN 7.  ev_message = 'Transfer Requirement is incorrect or invalid.'.
        WHEN 8.  ev_message = 'Immediate confirmation (squit) forbidden by WM config.'.
        WHEN 9.  ev_message = 'No Transfer Order created. Check stock and bin assignment.'.
        WHEN 11. ev_message = 'No authorization to create Transfer Order.'.
        WHEN 14. ev_message = 'Input error in item quantities or bins.'.
        WHEN OTHERS. ev_message = |Failed to create TO. Subrc error code: { sy-subrc }.|.
      ENDCASE.
    ENDIF.

    ls_return-type    = 'E'.
    ls_return-message = ev_message.
    APPEND ls_return TO et_messages.
  ENDIF.

ENDFUNCTION.
```

## 24. T333 fields and live rows (CONFIRMED): the WM movement type carries NLTYP/NLPLA defaults; VLTYP/VLPLA are blank for W01
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DATATYPE | LENG |
|---|---|---|---|---|---|
| 0001 | MANDT | X | MANDT | CLNT | 000003 |
| 0002 | LGNUM | X | LGNUM | CHAR | 000003 |
| 0003 | BWLVS | X | BWLVS | NUMC | 000003 |
| 0004 | TRART |  | LVS_TRART | CHAR | 000001 |
| 0005 | VLTYP |  | T333_VLTYP | CHAR | 000003 |
| 0006 | VLPLA |  | T333_VLPLA | CHAR | 000010 |
| 0007 | NLTYP |  | T333_NLTYP | CHAR | 000003 |
| 0008 | NLPLA |  | T333_NLPLA | CHAR | 000010 |
| 0009 | RLTYP |  | T333_RLTYP | CHAR | 000003 |
| 0010 | RLPLA |  | T333_RLPLA | CHAR | 000010 |
| 0011 | BETYP |  | LVS_BETYP | CHAR | 000001 |
| 0012 | TBOBL |  | T333_TBOBL | CHAR | 000001 |
| 0013 | DRUKZ |  | LVS_DRUKZ | CHAR | 000002 |
| 0014 | SQUIT |  | T333_SQUIT | CHAR | 000001 |
| 0015 | TBMAN |  | T333_TBMAN | CHAR | 000001 |
| 0016 | DUNKL |  | LVS_DUNKL | CHAR | 000001 |
| 0017 | VQUIT |  | T333_VQUIT | CHAR | 000001 |
| 0018 | TBPRI |  | TBPRI | CHAR | 000001 |
| 0019 | WEDAT |  | T333_WEDAT | CHAR | 000001 |
| 0020 | LPMAN |  | T333_LPMAN | CHAR | 000001 |
| 0021 | VKDYN |  | T333_VKDYN | CHAR | 000001 |
| 0022 | NKDYN |  | T333_NKDYN | CHAR | 000001 |
| 0023 | ABILD |  | T333_ABILD | CHAR | 000001 |
| 0024 | FEHLT |  | T333_FEHLT | CHAR | 000001 |
| 0025 | VFIXP |  | T333_VFIXP | CHAR | 000001 |
| 0026 | NFIXP |  | T333_NFIXP | CHAR | 000001 |
| 0027 | KZUAP |  | LVS_KZUAP | CHAR | 000001 |
| 0028 | BWREF |  | LVS_BWREF | NUMC | 000003 |
| 0029 | UELIE |  | T333_UELIE | CHAR | 000001 |
| 0030 | AUTTA |  | LVS_AUTTA | CHAR | 000001 |
| 0031 | ZUSTE |  | LVS_ZUSTE | CHAR | 000001 |
| 0032 | CHSWM |  | KALSMA_CH | CHAR | 000006 |
| 0033 | QBILD |  | T333_QBILD | CHAR | 000001 |
| 0034 | RULES |  | T333_RULES | CHAR | 000004 |
| 0035 | VEPST |  | T333_VEPST | CHAR | 000001 |
| 0036 | DBILD |  | T333_DBILD | CHAR | 000001 |
| 0037 | NO2ST |  | T333_NO2ST | CHAR | 000001 |
| 0038 | PIKTA |  | T333_PIKTA | CHAR | 000001 |
| 0039 | WMMUE |  | T333_WMMUE | CHAR | 000001 |
| 0041 | XDREL |  | LXDCK_XDREL | CHAR | 000001 |

### Live rows for warehouse W01, movement types 201 / 241 / 311 / 301
| LGNUM | BWLVS | VLTYP | VLPLA | NLTYP | NLPLA | TBOBL | SQUIT |
|---|---|---|---|---|---|---|---|
| W01 | 201 |  |  | 911 |  |  |  |
| W01 | 241 |  |  | 913 |  |  |  |
| W01 | 311 |  |  | 921 | TRANSFER | X |  |
| W01 | 301 |  |  | 920 | TRANSFER | X |  |

---

## Discovery (2026-10-12, read-only; warehouse W01 from cds.s4.warehouseNumber)

### A1. WM-managed plant / storage location pairs (T320)
| WERKS | LGORT | LGNUM | LGNTB | OBEST |
|---|---|---|---|---|
| 1120 | CIS1 | W01 |  |  |
| 1120 | CS01 | W01 |  |  |
| 1120 | CS02 | W01 |  |  |
| 1120 | FG01 | W01 |  |  |
| 1120 | HS01 | W01 |  |  |
| 1120 | IM01 | W01 |  |  |
| 1120 | IP01 | W01 |  |  |
| 1120 | MT01 | W01 |  |  |
| 1120 | MT02 | W01 |  |  |
| 1120 | OH01 | W01 |  |  |
| 1120 | OH02 | W01 |  |  |
| 1120 | PWIP | W01 |  |  |
| 1120 | RA01 | W01 |  |  |
| 1120 | RJ02 | W01 |  |  |
| 1120 | SU01 | W01 |  |  |
| 1600 | CS01 | W01 |  |  |
| 1600 | CS02 | W01 |  |  |
| 1600 | FG01 | W01 |  |  |
| 1600 | HS01 | W01 |  |  |
| 1600 | IP01 | W01 |  |  |
| 1600 | OH01 | W01 |  |  |
| 1600 | OH02 | W01 |  |  |
| 1600 | RJ02 | W01 |  |  |
| 1600 | SC01 | W01 |  |  |

### A2. T333 rows (all fields) for 201 / 241 / 311 / 301
| LGNUM | BWLVS | TRART | VLTYP | VLPLA | NLTYP | NLPLA | RLTYP | RLPLA | BETYP | TBOBL | DRUKZ | SQUIT | TBMAN | DUNKL | VQUIT | TBPRI | WEDAT | LPMAN | VKDYN | NKDYN | ABILD | FEHLT | VFIXP | NFIXP | KZUAP | BWREF | UELIE | AUTTA | ZUSTE | CHSWM | QBILD | RULES | VEPST | DBILD | NO2ST | PIKTA | WMMUE | XDREL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W01 | 201 | A |  |  | 911 |  |  |  | K |  | 02 |  | X |  |  |  |  |  |  | X | 2 |  |  |  |  | 000 |  |  |  |  | 2 |  |  | 2 |  |  |  |  |
| W01 | 241 | A |  |  | 913 |  |  |  | A |  | 02 |  | X |  |  |  |  |  |  | X | 2 |  |  |  |  | 000 |  |  |  |  | 2 |  |  | 2 |  |  |  |  |
| W01 | 311 | A |  |  | 921 | TRANSFER |  |  |  | X | 02 |  | X |  |  |  |  | X |  |  | 2 |  |  |  |  | 000 |  |  |  |  | 2 |  |  | 2 |  |  |  |  |
| W01 | 301 | A |  |  | 920 | TRANSFER |  |  |  | X | 02 |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  | 000 |  |  |  |  | 2 |  |  | 2 |  |  |  |  |

### A2. DDIC search for the IM -> WM mapping table

DD02T, English texts containing "WM" or "Warehouse", table names T3* / T15*:
| TABNAME | DDTEXT |
|---|---|
| T300T | Warehouse Number Descriptions |
| T301 | WM Storage Types |
| T342 | Control of Screen Sequence in WM |
| T313Z | ILN for SSCC Generation at Warehouse Number Level |
| T333 | WM Movement Types |
| T303 | WM Storage Bin Types |
| T300 | WM Warehouse Numbers |
| T333T | Texts for WM Movement Types |
| T321 | Assignment MM Movement Type --> MM-WM Movement Type |
| T321D | Assignment Movement Type RM-WMS Dec. ERP -> HOST Act. (R/2) |
| T320 | Assignment IM Storage Location to WM Warehouse Number |
| T328 | Warehouse Activity Monitor: Defin. of Critical Parameters |
| T327V | Variants for WM Link -> Subsystem |
| T327T | Variant description for link WM -> subsystem |
| T303T | WM Names of Storage Bin Types |
| T30A | WM Picking Areas |
| T30B | WM Gates |
| T30C | WM Materials Staging Zones |
| T333U | WM Movement Types for Transf.Posting in WM and IM |
| T341 | WM Screen Selection |
| T340D | WM Default Values |
| T302 | WM Storage Sections |
| T320A | WM: Storage Location Control |
| T325 | WM: QM Interface for Handling Insptection Samples |
| T340 | WM Transactions |
| T329R | Additional WM Reports |
| T327B | Definition of function modules for IDOC setup: Link WM - sub |
| T311L | Definition of Run Within a WM Group |
| T311 | Definition of WM Groups |
| T325T | Description for Control WM-QM Interface |
| T344 | Client-Specific Control Table for MM-WM |
| T345 | Client-Dependent Control Table for WM->PP Staging |
| T327 | Control of Link between WM and Warehouse Control Unit (WCU) |
| T327A | Control of link WM - subsystem |
| T347A | Control of  link WM - TRM for Transfer Orders |
| T311A | Cross-Reference WM Group for Documents |
| T323M | Log. Error Handling Host R/2 - Decentr. WMS ERP (Mail Def.) |

DD03L tables (T*) that carry field RBLVS (reference movement type for WM):
| TABNAME | FIELDNAME | KEYFLAG |
|---|---|---|
| T321 | RBLVS | X |
| T156S | RBLVS |  |
| T156SC | RBLVS |  |
| TXI_T156SC | RBLVS |  |
| TXW_T156SC | RBLVS |  |

### A2. IM movement type -> reference movement type (T156S) -> WM movement type (T321)
| BWART | SOBKZ | KZBEW | KZZUG | KZVBR | RBLVS | UMRBL |
|---|---|---|---|---|---|---|
| 201 | P |  |  |  | 999 | 000 |
| 201 |  |  |  |  | 201 | 000 |
| 201 | K |  |  |  | 201 | 000 |
| 201 | P |  |  |  | 999 | 000 |
| 201 |  |  |  |  | 999 | 000 |
| 201 |  |  |  |  | 201 | 000 |
| 201 | K |  |  |  | 201 | 000 |
| 201 | P |  |  |  | 999 | 000 |
| 241 |  |  |  |  | 241 | 000 |
| 241 | K |  |  |  | 241 | 000 |
| 241 |  |  |  |  | 999 | 000 |
| 241 |  |  |  |  | 241 | 000 |
| 241 | K |  |  |  | 241 | 000 |
| 301 | E |  |  |  | 301 | 302 |
| 301 | E |  |  | E | 301 | 302 |
| 301 | Q |  |  |  | 301 | 302 |
| 301 | Q |  |  | P | 301 | 302 |
| 301 |  |  |  |  | 301 | 302 |
| 301 | E |  |  |  | 301 | 302 |
| 301 | E |  |  | E | 301 | 302 |
| 301 | K |  |  |  | 311 | 312 |
| 301 | O |  |  |  | 999 | 000 |
| 301 | Q |  |  |  | 301 | 302 |
| 301 | Q |  |  | P | 301 | 302 |
| 301 | V |  |  |  | 999 | 000 |
| 301 | W |  |  |  | 999 | 000 |
| 301 |  |  |  |  | 999 | 000 |
| 301 | O |  |  |  | 999 | 000 |
| 301 | V |  |  |  | 999 | 000 |
| 301 | W |  |  |  | 999 | 000 |
| 301 |  |  |  |  | 301 | 302 |
| 301 | E |  |  |  | 301 | 302 |
| 301 | E |  |  | E | 301 | 302 |
| 301 | K |  |  |  | 311 | 312 |
| 301 | O |  |  |  | 999 | 000 |
| 301 | Q |  |  |  | 301 | 302 |
| 301 | Q |  |  | P | 301 | 302 |
| 301 | V |  |  |  | 999 | 000 |
| 301 | W |  |  |  | 999 | 000 |
| 311 | E |  |  |  | 311 | 312 |
| 311 | E |  |  | E | 311 | 312 |
| 311 | Q |  |  |  | 311 | 312 |
| 311 | Q |  |  | P | 311 | 312 |
| 311 |  |  |  |  | 311 | 312 |
| 311 | E |  |  |  | 311 | 312 |
| 311 | E |  |  | E | 311 | 312 |
| 311 | K |  |  |  | 311 | 312 |
| 311 | M |  |  |  | 311 | 312 |
| 311 | Q |  |  |  | 311 | 312 |
| 311 | Q |  |  | P | 311 | 312 |
| 311 |  |  |  |  | 999 | 999 |
| 311 |  |  |  |  | 311 | 312 |
| 311 | E |  |  |  | 311 | 312 |
| 311 | E |  |  | E | 311 | 312 |
| 311 | K |  |  |  | 311 | 312 |
| 311 | M |  |  |  | 311 | 312 |
| 311 | Q |  |  |  | 311 | 312 |
| 311 | Q |  |  | P | 311 | 312 |

T321 for warehouse W01, RBLVS in (999, 201, 241, 301, 311):
| LGNUM | RBLVS | BSLVS | KZBEW | SOBKZ | BSSKZ | LGREF | BWLVS | TBFKZ | TAFKZ | UBFKZ | BESTQ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W01 | 311 |  |  | E |  |  | 311 |  | A | X |  |
| W01 | 311 | Q |  | E |  |  | 311 |  | A | X |  |

### A3. Field that controls automatic TR creation (DDIC text, T321)
| FIELDNAME | ROLLNAME | DATATYPE | LENG | TEXT |
|---|---|---|---|---|
| RBLVS | RBLVS | NUMC | 000003 | Reference movement type for WM from material movements |
| BWLVS | BWLVS | NUMC | 000003 | Movement Type for Warehouse Management |
| TBFKZ | T321_TBFKZ | CHAR | 000001 | Indicator: Creation/Cancellation of a Transfer Requirement |
| UBFKZ | T321_UBFKZ | CHAR | 000001 | Indicator: Creation of a Posting Change Notice |
| TAFKZ | T321_TAFKZ | CHAR | 000001 | Indicator: Create transfer order immediately |

### A4. Is movement type 301 allowed for reservations? (T156 fields whose text mentions reservations)
| FIELDNAME | ROLLNAME | DATATYPE | LENG | TEXT |
|---|---|---|---|---|
| RSTYP | RSTYP | CHAR | 000001 | Account assignment of reservation |

Live T156 rows:
| BWART | RSTYP |
|---|---|
| 201 | K |
| 241 | A |
| 311 | U |
| 301 | U |

Empirical: RKPF reservations with BWART 301 since 20260912:
| RSNUM | BWART | RSDAT | USNAM | UMWRK | UMLGO |
|---|---|---|---|---|---|
| 0000525864 | 301 | 20261012 | KHUSHAL | 1110 | CS01 |
| 0000525865 | 301 | 20261012 | KHUSHAL | 1110 | CS01 |
| 0000525866 | 301 | 20261012 | KHUSHAL | 1110 | CS01 |
| 0000525863 | 301 | 20261012 | KHUSHAL | 1110 | CS01 |
| 0000525868 | 301 | 20261012 | KHUSHAL | 1110 | CS01 |

### A5a/b. Free WM stock (LQUA VERME > 0, BESTQ blank, SOBKZ blank; interim storage types excluded) with MARC batch/serial profile
Storage types excluded: T333 NLTYP/VLTYP = 911, 913, 921, 920; repo config cds.s4.mvt261NotReadyBins = OH1, 901

280 quants read, 280 in WM-managed pairs. First 40:
| LQNUM | MATNR | WERKS | LGORT | CHARG | VERME | MEINS | LGTYP | LGPLA | LENUM | XCHPF | SERNP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0001045052 | 000000008900000007 | 1120 | CS01 | IN26001220 | 2875 | KG | 902 | 0000000000 |  | X |  |
| 0001031012 | 000000001000000579 | 1600 | CS01 | IN25041448 | 30 | KG | RM1 | 0-L0001-03 | 00000000001000042025 | X |  |
| 0001045078 | 000000008900000004 | 1120 | HS01 | INJW260001 | 3 | KG | 922 | TR-ZONE |  | X |  |
| 0001045016 | 000000008900000004 | 1120 | CS01 | INJW260001 | 1236 | KG | 902 | 0000000000 |  | X |  |
| 0001030606 | 000000001000000046 | 1600 | CS01 | IN24070325 | 15.66 | KG | RM1 | 0-L0001-03 | 00000000001000041619 | X |  |
| 0001030607 | 000000001000000095 | 1600 | CS01 | IN25080258 | 1440 | KG | RM1 | 0-L0001-03 | 00000000001000041620 | X |  |
| 0001030608 | 000000001000000098 | 1600 | CS01 | IN24100915 | 178.25 | KG | RM1 | 0-L0001-03 | 00000000001000041621 | X |  |
| 0001030609 | 000000001000000098 | 1600 | CS01 | IN25020910 | 70 | KG | RM1 | 0-L0001-03 | 00000000001000041622 | X |  |
| 0001030610 | 000000001000000106 | 1600 | CS01 | IN23081764 | 1700 | KG | RM1 | 0-L0001-03 | 00000000001000041623 | X |  |
| 0001030611 | 000000001000000106 | 1600 | CS01 | IN23100872 | 2520 | KG | RM1 | 0-L0001-03 | 00000000001000041624 | X |  |
| 0001030612 | 000000001000000106 | 1600 | CS01 | IN23100873 | 2520 | KG | RM1 | 0-L0001-03 | 00000000001000041625 | X |  |
| 0001030613 | 000000001000000106 | 1600 | CS01 | IN24062068 | 14 | KG | RM1 | 0-L0001-03 | 00000000001000041626 | X |  |
| 0001030614 | 000000001000000119 | 1600 | CS01 | IN24060650 | 68 | KG | RM1 | 0-L0001-03 | 00000000001000041627 | X |  |
| 0001030615 | 000000001000000119 | 1600 | CS01 | IN24110455 | 1300 | KG | RM1 | 0-L0001-03 | 00000000001000041628 | X |  |
| 0001030616 | 000000001000000119 | 1600 | CS01 | IN25031090 | 5000 | KG | RM1 | 0-L0001-03 | 00000000001000041629 | X |  |
| 0001030617 | 000000001000000127 | 1600 | CS01 | IN23101617 | 500 | KG | RM1 | 0-L0001-03 | 00000000001000041630 | X |  |
| 0001030618 | 000000001000000127 | 1600 | CS01 | IN24030336 | 5 | KG | RM1 | 0-L0001-03 | 00000000001000041631 | X |  |
| 0001030619 | 000000001000000132 | 1600 | CS01 | IN23091226 | 630 | KG | RM1 | 0-L0001-03 | 00000000001000041632 | X |  |
| 0001030620 | 000000001000000137 | 1600 | CS01 | IN25041053 | 184.5 | KG | RM1 | 0-L0001-03 | 00000000001000041633 | X |  |
| 0001030621 | 000000001000000137 | 1600 | CS01 | IN25072203 | 120 | KG | RM1 | 0-L0001-03 | 00000000001000041634 | X |  |
| 0001030622 | 000000001000000156 | 1600 | CS01 | IN25031691 | 1620 | KG | RM1 | 0-L0001-03 | 00000000001000041635 | X |  |
| 0001030623 | 000000001000000156 | 1600 | CS01 | IN25031994 | 1800 | KG | RM1 | 0-L0001-03 | 00000000001000041636 | X |  |
| 0001030625 | 000000001000000156 | 1600 | CS01 | IN25061035 | 19440 | KG | RM1 | 0-L0001-03 | 00000000001000041638 | X |  |
| 0001030626 | 000000001000000156 | 1600 | CS01 | IN25061666 | 4140 | KG | RM1 | 0-L0001-03 | 00000000001000041639 | X |  |
| 0001030627 | 000000001000000159 | 1600 | CS01 | IN25061586 | 20600 | KG | RM1 | 0-L0001-03 | 00000000001000041640 | X |  |
| 0001030628 | 000000001000000186 | 1600 | CS01 | IN23072038 | 2470 | KG | RM1 | 0-L0001-03 | 00000000001000041641 | X |  |
| 0001030629 | 000000001000000186 | 1600 | CS01 | IN23072592 | 2500 | KG | RM1 | 0-L0001-03 | 00000000001000041642 | X |  |
| 0001030630 | 000000001000000186 | 1600 | CS01 | IN23072596 | 2500 | KG | RM1 | 0-L0001-03 | 00000000001000041643 | X |  |
| 0001030643 | 000000001000000188 | 1600 | CS01 | IN25041914 | 2650 | KG | RM1 | 0-L0001-03 | 00000000001000041656 | X |  |
| 0001030644 | 000000001000000188 | 1600 | CS01 | IN25041915 | 2750 | KG | RM1 | 0-L0001-03 | 00000000001000041657 | X |  |
| 0001030645 | 000000001000000188 | 1600 | CS01 | IN25041919 | 2700 | KG | RM1 | 0-L0001-03 | 00000000001000041658 | X |  |
| 0001030646 | 000000001000000188 | 1600 | CS01 | IN25041920 | 1900 | KG | RM1 | 0-L0001-03 | 00000000001000041659 | X |  |
| 0001030647 | 000000001000000188 | 1600 | CS01 | IN25050350 | 800 | KG | RM1 | 0-L0001-03 | 00000000001000041660 | X |  |
| 0001030648 | 000000001000000188 | 1600 | CS01 | IN25050351 | 2700 | KG | RM1 | 0-L0001-03 | 00000000001000041661 | X |  |
| 0001030649 | 000000001000000188 | 1600 | CS01 | IN25050353 | 700 | KG | RM1 | 0-L0001-03 | 00000000001000041662 | X |  |
| 0001030650 | 000000001000000188 | 1600 | CS01 | IN25050355 | 2750 | KG | RM1 | 0-L0001-03 | 00000000001000041663 | X |  |
| 0001030651 | 000000001000000188 | 1600 | CS01 | IN25050356 | 2750 | KG | RM1 | 0-L0001-03 | 00000000001000041664 | X |  |
| 0001030652 | 000000001000000188 | 1600 | CS01 | IN25050357 | 2750 | KG | RM1 | 0-L0001-03 | 00000000001000041665 | X |  |
| 0001030653 | 000000001000000188 | 1600 | CS01 | IN25050358 | 1700 | KG | RM1 | 0-L0001-03 | 00000000001000041666 | X |  |
| 0001030654 | 000000001000000188 | 1600 | CS01 | IN25050362 | 800 | KG | RM1 | 0-L0001-03 | 00000000001000041667 | X |  |

Batch-managed material with stock: 8900000007 (1120/CS01, batch IN26001220, 2875 KG at 902/0000000000)
Serial-managed material with stock: none found in the first 300 quants
MARD 8900000007 1120/CS01: LABST 6000.000
MARD 1000000579 1600/CS01: LABST 28.000
MARD 8900000004 1120/HS01: LABST 3.000
MARD 8900000004 1120/CS01: LABST 1243.000
MARD 1000000046 1600/CS01: LABST 15.660

Serial-managed materials (MARC-SERNP <> '' in plants 1120, 1600) with free stock in W01:
| MATNR | WERKS | SERNP | XCHPF | LQNUM | LGORT | CHARG | VERME | MEINS | LGTYP | LGPLA |
|---|---|---|---|---|---|---|---|---|---|---|
| 000000008000009700 | 1120 | ZSN1 |  | 0001039552 | CS01 |  | 1 | NOS | OH1 | ONHOLD |
| 000000008000009700 | 1120 | ZSN1 |  | 0001039553 | CS01 |  | 1 | NOS | OH1 | ONHOLD |
| 000000008000009700 | 1120 | ZSN1 |  | 0001039955 | CS01 |  | 1 | NOS | RM1 | 0-L0001-01 |

### A5c. Account assignments and receiving targets
Company code per WM plant (T001K BWKEY -> BUKRS): 1120 -> 1000, 1600 -> 1000

CSKS (company code 1000, valid today, not blocked for postings; fields KOKRS, KOSTL, DATBI, DATAB, BUKRS, BKZKP):
| KOKRS | KOSTL | DATBI | DATAB | BUKRS | BKZKP |
|---|---|---|---|---|---|
| 1000 | 1010001001 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001202 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001501 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001601 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001602 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001801 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010001901 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002001 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002101 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002102 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002301 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002501 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002801 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002901 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010002902 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010003101 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1010003201 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1011101101 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1011101201 | 99991231 | 20230401 | 1000 |  |
| 1000 | 1011101202 | 99991231 | 20230401 | 1000 |  |

ANLA (company code 1000, not deactivated, capitalised; fields BUKRS, ANLN1, ANLN2, DEAKT, AKTIV, ANLKL):
| BUKRS | ANLN1 | ANLN2 | DEAKT | AKTIV | ANLKL |
|---|---|---|---|---|---|
| 1000 | 000000400001 | 0000 | 00000000 | 20250529 | A12000 |
| 1000 | 000000700000 | 0000 | 00000000 | 20250620 | A14000 |
| 1000 | 000001100000 | 0000 | 00000000 | 20250702 | A16000 |
| 1000 | 000000400003 | 0000 | 00000000 | 20250705 | A12000 |
| 1000 | 000000700001 | 0000 | 00000000 | 20250702 | A14000 |
| 1000 | 000000400002 | 0000 | 00000000 | 20250702 | A12000 |
| 1000 | 000001300000 | 0000 | 00000000 | 20250401 | A16200 |
| 1000 | 000000400005 | 0000 | 00000000 | 20250709 | A12000 |
| 1000 | 000001500000 | 0000 | 00000000 | 20250714 | A17100 |
| 1000 | 000000700004 | 0000 | 00000000 | 20250709 | A14000 |
| 1000 | 000003300000 | 0000 | 00000000 | 20250721 | A19130 |
| 1000 | 000000400008 | 0000 | 00000000 | 20250730 | A12000 |
| 1000 | 000000400009 | 0000 | 00000000 | 20250410 | A12000 |
| 1000 | 000000600005 | 0000 | 00000000 | 20241102 | A13000 |
| 1000 | 000000400010 | 0000 | 00000000 | 20241102 | A12000 |

T001L storage locations of plant 1120: AD01 (Analytical Team), ADM1 (Admin Team), AF01 (AFGS Tank Farm), AG01 (AGS Tank Farm), CF01 (Cafe), CI01 (C&I - 2), CI02 (C&I Team - 2), CIS1 (CIS Team), CS01 (Raw Material), CS02 (Raw Material), CS03 (IM03), CS04 (IM04), CT01 (Creative Team), DP01 (Dispatch Team), EHS1 (EHS Team), EL01 (Elec Team - 2), EL02 (Elec Team - 1), ENV1 (ETP  Team), EO01 (EO TANK 1), FG01 (Finished Storage), FI01 (Finance Team), HR01 (HR & IR Team), HS01 (ENGG Store), HU01 (FG Partner locat), HY01 (Hydrogen YARD), IB01 (IB TANK 2), IM01 (IM01), IP01 (Intermediate PT1), IP02 (Intermediate PT2), IP03 (Intermediate PT3), IP04 (Intermediate PT4), IP05 (Intermediate PT5), LG01 (Logistic Team), MT01 (Maint Team - 2), MT02 (Maint Team - 1), OH01 (RM On Hold Area), OH02 (HW On Hold Area), PR01 (ENGG Purchase), PR02 (RM Procurement), PS01 (Process Team), PT01 (Prod Team - 1), PT02 (Prod Team - 2), PT03 (Prod Team - 3), PT04 (Prod Team - 4), PT05 (PD Team - 5), PWIP (Production WIP), QA01 (QA Team), QC01 (QC Team), RA01 (Reject Area), RD01 (R&D Team - 1), RD02 (R&D Team - 2), RD03 (R&D Team - 3), RD04 (R&D Team - 4), RD05 (R&D Team - 5), RD06 (R&D Team - 6), RD07 (R&D Team - 7), RD08 (R&D Team - 8), RD09 (R&D Team - 9), RD10 (R&D Team - 10), RJ01 (Rejection Area), RJ02 (Reject Area ENG), SA01 (Sales Team), SC01 (Scrape Area), ST01 (Storage Tank 1), ST02 (Storage Tank 2), ST10 (Storage Tank 10), SU01 (SUT TESTING -DNR), TRAN (Stock in Transit), UG01 (UGS Tank Farm)

T001L storage locations of plant 1600: ADM1 (Admin Team), CI01 (C&I - 2), CI02 (C&I Team - 2), CIS1 (CIS Team), CS01 (Raw Material), CS02 (Raw Material), DP01 (Dispatch Team), EHS1 (EHS Team), EL01 (Elec Team - 2), EL02 (Elec Team - 1), ENV1 (ETP  Team), FG01 (Finished Storage), HS01 (ENGG Store), HU01 (FG Partner locat), IP01 (Intermediate PT1), LG01 (Logistics Team), MT01 (Maint Team - 2), MT02 (Maint Team - 1), OH01 (RM On Hold Area), OH02 (HW On Hold Area), PR01 (ENGG Purchase), PR02 (RM Procurement), RD01 (R&D Team - 1), RD02 (R&D Team - 2), RD03 (R&D Team - 3), RD04 (R&D Team - 4), RD05 (R&D Team - 5), RD06 (R&D Team - 6), RD07 (R&D Team - 7), RD08 (R&D Team - 8), RD09 (R&D Team - 9), RD10 (R&D Team - 10), RJ01 (Rejection Area), RJ02 (Reject Area ENG), SC01 (Scrape Area), ST01 (Engg Store), ST02 (RM Store Team)

### A5d. Reservations of the last 30 days per movement type and how SAP behaved

#### Movement type 201
| RSNUM | BWART | RSDAT | USNAM | KOSTL | ANLN1 | ANLN2 | UMWRK | UMLGO |
|---|---|---|---|---|---|---|---|---|
| 0000525278 | 201 | 20261010 | KHUSHAL | 1011201301 |  |  |  |  |
| 0000525277 | 201 | 20261010 | KHUSHAL | 1011201301 |  |  |  |  |
| 0000525274 | 201 | 20261010 | KHUSHAL | 1011201301 |  |  |  |  |
| 0000524978 | 201 | 20261009 | MSHUSSAIN | 1010001301 |  |  |  |  |
| 0000523963 | 201 | 20261008 | MPRAJAPATI | 1010001301 |  |  |  |  |
| 0000523961 | 201 | 20261008 | MPRAJAPATI | 1010001301 |  |  |  |  |
| 0000523653 | 201 | 20261007 | KHUSHAL | 1011201301 |  |  |  |  |
| 0000523652 | 201 | 20261007 | KHUSHAL | 1011201301 |  |  |  |  |

Chain of reservation 525278 (TR link: LTBK-RSNUM):
RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008000009754 | 1120 | HS01 |  | 1.000 | 1.000 | X |  |
LTBK:
| TBNUM | BWLVS | STATU | BETYP | BENUM | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|---|---|
| 0001000757 | 311 | E |  |  | 0000525278 | 20261010 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000757 | 0001 | 000000008000009754 | 1.000 | 1.000 | X |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037270 | 0001000757 | 311 | X | 20261010 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037270 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 |  |
MATDOC:
| MBLNR | MJAHR | ZEILE | BWART | WERKS | LGORT | CHARG | MENGE | SGTXT | CANCELLED | REVERSAL_MOVEMENT |
|---|---|---|---|---|---|---|---|---|---|---|
| 4900050142 | 2026 | 0001 | 201 | 1120 | HS01 |  | 1.000 |  |  |  |

Observed: destination 921/TRANSFER; TR BWLVS 311; RESB KZEAR X; MATDOC SGTXT ' '

#### Movement type 241
| RSNUM | BWART | RSDAT | USNAM | KOSTL | ANLN1 | ANLN2 | UMWRK | UMLGO |
|---|---|---|---|---|---|---|---|---|
| 0000525279 | 241 | 20261010 | KHUSHAL |  | 000000400001 | 0000 |  |  |
| 0000525276 | 241 | 20261010 | KHUSHAL |  | 000000400092 | 0000 |  |  |
| 0000523971 | 241 | 20261008 | MPRAJAPATI |  | 000000400094 | 0000 |  |  |
| 0000523970 | 241 | 20261008 | MPRAJAPATI |  | 000000400093 | 0000 |  |  |
| 0000523969 | 241 | 20261008 | MPRAJAPATI |  | 000001100013 | 0000 |  |  |
| 0000523162 | 241 | 20261006 | NARESH |  | 000000400092 | 0000 |  |  |

Chain of reservation 525279 (TR link: LTBK-RSNUM):
RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 1.000 | X |  |
LTBK:
| TBNUM | BWLVS | STATU | BETYP | BENUM | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|---|---|
| 0001000760 | 311 | E |  |  | 0000525279 | 20261010 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000760 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037271 | 0001000760 | 311 | X | 20261010 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037271 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 | INJW260001 |
MATDOC:
| MBLNR | MJAHR | ZEILE | BWART | WERKS | LGORT | CHARG | MENGE | SGTXT | CANCELLED | REVERSAL_MOVEMENT |
|---|---|---|---|---|---|---|---|---|---|---|
| 4900050143 | 2026 | 0001 | 241 | 1120 | CS01 | INJW260001 | 1.000 |  |  |  |

Observed: destination 921/TRANSFER; TR BWLVS 311; RESB KZEAR X; MATDOC SGTXT ' '

#### Movement type 311
| RSNUM | BWART | RSDAT | USNAM | KOSTL | ANLN1 | ANLN2 | UMWRK | UMLGO |
|---|---|---|---|---|---|---|---|---|
| 0000525871 | 311 | 20261012 | KHUSHAL |  |  |  | 1120 | CIS1 |
| 0000525869 | 311 | 20261012 | KHUSHAL |  |  |  | 1120 | CIS1 |
| 0000525867 | 311 | 20261012 | KHUSHAL |  |  |  | 1120 | HS01 |
| 0000525862 | 311 | 20261012 | KHUSHAL |  |  |  | 1120 | HS01 |
| 0000525289 | 311 | 20261010 | KHUSHAL |  |  |  | 1120 | CS02 |
| 0000525288 | 311 | 20261010 | KHUSHAL |  |  |  | 1120 | CS02 |
| 0000525287 | 311 | 20261010 | KHUSHAL |  |  |  | 1120 | CS02 |
| 0000525286 | 311 | 20261010 | KHUSHAL |  |  |  | 1120 | CS02 |

Chain of reservation 525867 (TR link: candidate: same BDATU, material and quantity (TR has no RSNUM)):
RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 1.000 | X |  |
LTBK:
| TBNUM | BWLVS | STATU | BETYP | BENUM | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|---|---|
| 0001000786 | 311 | E |  |  | 0000000000 | 20261012 |  |  | 921 | TRANSFER |
| 0001000793 | 311 | E |  |  | 0000000000 | 20261012 |  |  | 921 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000786 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000793 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037279 | 0001000786 | 311 | X | 20261012 |
| 0001037286 | 0001000793 | 311 | X | 20261012 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037279 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037286 | 0001 | 0001 | 902 | 0000000000 | 921 | TRANSFER | X | 1.000 | INJW260001 |
MATDOC:
| MBLNR | MJAHR | ZEILE | BWART | WERKS | LGORT | CHARG | MENGE | SGTXT | CANCELLED | REVERSAL_MOVEMENT |
|---|---|---|---|---|---|---|---|---|---|---|
| 4900050148 | 2026 | 0001 | 311 | 1120 | CS01 | INJW260001 | 1.000 |  |  |  |
| 4900050148 | 2026 | 0002 | 311 | 1120 | HS01 | INJW260001 | 1.000 |  |  |  |

Observed: destination 921/TRANSFER; TR BWLVS 311; RESB KZEAR X; MATDOC SGTXT ' '

#### Movement type 301
| RSNUM | BWART | RSDAT | USNAM | KOSTL | ANLN1 | ANLN2 | UMWRK | UMLGO |
|---|---|---|---|---|---|---|---|---|
| 0000525868 | 301 | 20261012 | KHUSHAL |  |  |  | 1110 | CS01 |
| 0000525866 | 301 | 20261012 | KHUSHAL |  |  |  | 1110 | CS01 |
| 0000525865 | 301 | 20261012 | KHUSHAL |  |  |  | 1110 | CS01 |
| 0000525864 | 301 | 20261012 | KHUSHAL |  |  |  | 1110 | CS01 |
| 0000525863 | 301 | 20261012 | KHUSHAL |  |  |  | 1110 | CS01 |
| 0000525283 | 301 | 20261010 | KHUSHAL |  |  |  | 1130 |  |
| 0000525275 | 301 | 20261010 | KHUSHAL |  |  |  | 1130 |  |
| 0000519366 | 301 | 20260927 | DRATHOD |  |  |  | 1120 | MT01 |

Chain of reservation 525868 (TR link: candidate: same BDATU, material and quantity (TR has no RSNUM)):
RESB:
| RSPOS | MATNR | WERKS | LGORT | CHARG | BDMNG | ENMNG | KZEAR | XLOEK |
|---|---|---|---|---|---|---|---|---|
| 0001 | 000000008900000004 | 1120 | CS01 |  | 1.000 | 1.000 | X |  |
LTBK:
| TBNUM | BWLVS | STATU | BETYP | BENUM | RSNUM | BDATU | VLTYP | VLPLA | NLTYP | NLPLA |
|---|---|---|---|---|---|---|---|---|---|---|
| 0001000787 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000788 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000789 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000790 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000791 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000792 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000794 | 301 | E |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
| 0001000795 | 301 |  |  |  | 0000000000 | 20261012 |  |  | 920 | TRANSFER |
LTBP:
| TBNUM | TBPOS | MATNR | MENGA | TAMEN | ELIKZ |
|---|---|---|---|---|---|
| 0001000787 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000788 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000789 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000790 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000791 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000792 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000794 | 0001 | 000000008900000004 | 1.000 | 1.000 | X |
| 0001000795 | 0001 | 000000008900000004 | 1.000 | 0.000 |  |
LTAK:
| TANUM | TBNUM | BWLVS | KQUIT | BDATU |
|---|---|---|---|---|
| 0001037280 | 0001000787 | 301 | X | 20261012 |
| 0001037281 | 0001000788 | 301 | X | 20261012 |
| 0001037282 | 0001000789 | 301 | X | 20261012 |
| 0001037283 | 0001000790 | 301 | X | 20261012 |
| 0001037284 | 0001000791 | 301 | X | 20261012 |
| 0001037285 | 0001000792 | 301 | X | 20261012 |
| 0001037287 | 0001000794 | 301 | X | 20261012 |
LTAP:
| TANUM | TAPOS | TBPOS | VLTYP | VLPLA | NLTYP | NLPLA | PQUIT | NSOLA | CHARG |
|---|---|---|---|---|---|---|---|---|---|
| 0001037280 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037281 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037282 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037283 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037284 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037285 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
| 0001037287 | 0001 | 0001 | 902 | 0000000000 | 920 | TRANSFER | X | 1.000 | INJW260001 |
MATDOC:
| MBLNR | MJAHR | ZEILE | BWART | WERKS | LGORT | CHARG | MENGE | SGTXT | CANCELLED | REVERSAL_MOVEMENT |
|---|---|---|---|---|---|---|---|---|---|---|
| 4900050149 | 2026 | 0001 | 301 | 1120 | CS01 | INJW260001 | 1.000 |  |  |  |
| 4900050149 | 2026 | 0002 | 301 | 1110 | CS01 | INJW260001 | 1.000 |  |  |  |

Observed: destination 920/TRANSFER; TR BWLVS 301; RESB KZEAR X; MATDOC SGTXT ' '

### A6. Lock object and users with limited authorization
Lock object EMRESB: see sections 5 and 21 (ENQUEUE_EMRESB / DEQUEUE_EMRESB, not remote-enabled, section 16).
USR02 rows read: 276; UST04 rows read: 5965. Users not locked (UFLAG 0) and without profile SAP_ALL:
| BNAME | USTYP | UFLAG | GLTGB | PROFILES |
|---|---|---|---|---|
| FRN_JOB_EWA | B | 0 | 00000000 | T-D4740010 T-D4740162 T-D4740164 |
| TC_USER | A | 0 | 00000000 | S_A.SYSTEM T-D4740162 T-D4740164 |
| CUST_ADMIN | A | 0 | 20240521 | SAP_NEW T-D4740162 T-D4740164 |
| SAPSUPPORT | A | 0 | 20240522 | S_A.SYSTEM T-D4740162 T-D4740164 |
| SAP_SUPPORT | A | 0 | 20240627 | SAP_NEW S_A.SYSTEM T-D4740162 T-D4740164 |
| SDAGENT_FMP | B | 0 | 00000000 | T-D4740001 T-D4740002 T-D4740003 T-D4740004 T-D4740005 T-D4740006 T-D4740007 T-D4740008 T-D4740009 T-D4740010 T-D4740011 T-D4740162 T-D4740164 |
| TMSADM | B | 0 | 00000000 | S_A.TMSADM T-D4740162 T-D4740164 |
| ADS_AGENT | B | 0 | 00000000 | T-D4740012 T_B0960197 T-D4740162 T-D4740164 |
| ZIETA_PM | A | 0 | 00000000 | T-D4740125 T-D4740158 T-D4740188 T-D47401881 T-D47401882 T-D4740189 T-D47401891 T-D47401892 T-D4740190 T-D47401901 T-D47401902 T-D4740191 T-D47401911 T-D47401912 T-D4740192 T-D47401921 T-D47401922 T-D4740162 T-D4740164 |
| ZIETA_FI | A | 0 | 00000000 | T-D4740016 T-D4740017 T-D47400171 T-D47400172 T-D4740086 T-D4740090 T-D4740091 T-D4740092 T-D4740093 T-D4740094 T-D4740095 T-D4740096 T-D4740097 T-D4740098 T-D4740099 T-D4740100 T-D4740101 T-D4740102 T-D4740125 T-D47400991 T-D4740162 T-D4740164 |
| ZIETA_PP | A | 0 | 00000000 | T-D4740110 T-D4740111 T-D4740112 T-D4740113 T-D4740115 T-D4740116 T-D4740125 T-D4740337 T-D4740182 T-D47401821 T-D4740345 T-D4740369 T-D47403691 T-D4740114 T-D4740162 T-D4740164 |
| ZIETA_QM | A | 0 | 00000000 | T-D4740125 T-D4740168 T-D4740169 T-D4740170 T-D4740175 T-D4740176 T-D4740177 T-D4740178 T-D47401771 T-D4740162 T-D4740164 |
| SEC362 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740295 T-D4740338 T-D4740162 |
| SEC363 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740296 T-D4740338 T-D4740162 |
| SEC452 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740297 T-D4740338 T-D4740334 T-D4740162 T-D4740164 |
| SEC6714 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740298 T-D4740338 T-D4740334 T-D4740162 T-D4740164 |
| SEC8206 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740301 T-D4740338 T-D4740162 |
| SEC8208 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740302 T-D4740338 T-D4740162 |
| SEC822 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740303 T-D4740338 T-D4740162 |
| SECPANOLI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740338 T-D4740162 T-D4740164 |
| BHUSAN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740355 T-D4740162 T-D4740164 |
| CHANDRAKANT | A | 0 | 00000000 | T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740125 T-D4740213 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| DENISH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740082 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740224 T-D4740334 T-D4740164 |
| DHANJI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740225 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| GOVINDA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740198 T-D4740334 T-D4740162 |
| HARSH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740232 T-D4740334 T-D4740162 |
| HARSHAD | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740082 T-D4740153 T-D47401531 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740131 T-D4740133 T-D4740134 T-D47401341 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740190 T-D47401901 T-D47401902 T-D4740191 T-D47401911 T-D47401912 T-D4740334 T-D4740368 T-D4740164 |
| HEER | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740234 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| HIREN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740082 T-D4740110 T-D4740131 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740334 T-D4740422 T-D4740164 |
| HITEN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740174 T-D4740366 T-D4740162 T-D4740164 |
| JATIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740164 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| JATINRANA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740111 T-D4740115 T-D4740131 T-D4740161 T-D4740174 T-D4740334 T-D4740366 T-D4740162 T-D4740164 |
| KAJAL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740027 T-D4740036 T-D47400361 T-D4740061 T-D4740076 T-D4740079 T-D4740080 T-D4740082 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740164 |
| KALPESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740111 T-D4740131 T-D4740334 T-D4740422 T-D4740162 T-D4740164 |
| KAUSHIK | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740200 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| KETAN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740162 |
| PRAMOD | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740164 |
| RAJKUMAR | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740281 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| SMIT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740082 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740198 T-D4740334 T-D4740164 |
| VIRAL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740113 T-D4740131 T-D4740334 T-D4740422 T-D4740162 T-D4740164 |
| YOGESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740355 T-D4740162 T-D4740164 |
| PSAVALIYA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740144 T-D4740145 T-D4740168 T-D4740334 T-D4740342 T-D4740162 T-D4740164 |
| YESHA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740014 T-D4740027 T-D4740032 T-D47400321 T-D4740034 T-D4740036 T-D47400361 T-D4740048 T-D4740051 T-D4740056 T-D47400561 T-D47400562 T-D4740058 T-D4740061 T-D4740072 T-D4740076 T-D4740078 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740082 T-D4740083 T-D4740084 T-D4740085 T-D4740087 T-D4740123 T-D4740124 T-D4740126 T-D4740127 T-D4740180 T-D4740186 T-D4740341 T-D47401231 T-D4740162 T-D4740164 |
| JIGNESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740247 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740392 T-D47403921 T-D47401542 T-D4740162 T-D4740164 |
| RAKESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740112 T-D4740116 T-D4740131 T-D4740334 T-D4740422 T-D4740162 T-D4740164 |
| USER_MM | A | 0 | 00000000 | T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740162 T-D4740164 |
| VASU | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740318 T-D4740334 T-D4740355 T-D4740368 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| VISHNU | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740164 T-D4740325 T-D47403251 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| SUDHIR | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740149 T-D47401491 T-D4740100 T-D4740102 T-D4740334 T-D4740162 T-D4740164 |
| MITUL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740331 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740393 T-D47403931 T-D47401542 T-D4740162 T-D4740164 |
| ZIETA_SD | A | 0 | 00000000 | T-D4740370 T-D4740085 T-D4740087 T-D4740120 T-D4740123 T-D47401231 T-D4740124 T-D4740125 T-D4740182 T-D47401821 T-D4740183 T-D4740184 T-D4740336 T-D4740344 T-D4740345 T-D4740369 T-D47403691 T-D4740421 T-D4740162 T-D4740164 |
| SDBPMD | A | 0 | 00000000 | T-D4740336 T-D4740373 T-D4740056 T-D47400561 T-D47400562 T-D4740162 T-D4740164 |
| SONU | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740310 T-D4740334 T-D4740153 T-D47401531 T-D4740154 T-D47401541 T-D4740156 T-D47401561 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| PRATIBHA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740319 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| VIVEKHANSOTI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740329 T-D4740153 T-D47401531 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| RAJESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740280 T-D47402801 T-D4740334 T-D4740355 T-D4740156 T-D47401561 T-D4740162 |
| RINKAL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740162 T-D4740211 T-D4740334 T-D4740164 |
| KAMLESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740250 T-D4740334 T-D4740156 T-D47401561 T-D4740162 T-D4740164 |
| AAKANSHA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740164 T-D4740384 T-D4740162 |
| ZIETA_MM | A | 0 | 00000000 | T-D4740378 T-D4740162 T-D4740164 |
| KRUTIK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740319 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| RAUFAHMED | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740037 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740160 T-D4740161 T-D4740164 T-D4740166 T-D47401661 T-D4740167 T-D47401671 T-D4740173 T-D4740174 T-D4740179 T-D4740180 T-D4740035 T-D47400351 T-D4740288 T-D4740334 T-D4740355 T-D4740380 T-D4740162 |
| NILESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740172 T-D47401721 T-D4740182 T-D4740334 T-D47401821 T-D4740345 T-D4740338 T-D4740369 T-D47403691 T-D4740162 T-D4740164 |
| RAVI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740289 T-D4740334 T-D4740355 T-D4740162 |
| MILIND | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740164 T-D4740384 T-D4740162 |
| JGHODADARA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740164 T-D4740167 T-D47401671 T-D4740334 T-D4740162 |
| RRANPARIYA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740382 T-D4740164 T-D4740162 |
| DARSHAN | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740319 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| AMOL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740197 T-D4740334 T-D4740355 T-D4740162 |
| SHARAD | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740164 T-D4740306 T-D4740334 T-D4740380 T-D4740162 |
| RNDLAB1 | A | 0 | 00000000 | T-D4740162 T-D4740164 |
| VGHODADARA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740319 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| BHARGAVPATEL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740203 T-D4740334 T-D4740162 T-D4740164 |
| RUPESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740292 T-D4740334 T-D4740355 T-D4740368 T-D4740154 T-D47401541 T-D4740372 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| SEC8202 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740299 T-D4740338 T-D4740334 T-D4740162 T-D4740164 |
| SEC8203 | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740300 T-D4740338 T-D4740334 T-D4740162 T-D4740164 |
| SECHOJI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740304 T-D4740338 T-D4740162 |
| CHITRARTH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740019 T-D4740090 T-D4740091 T-D4740096 T-D4740334 T-D4740417 T-D4740162 T-D4740164 |
| VINAY | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740091 T-D4740092 T-D4740094 T-D4740095 T-D4740096 T-D4740100 T-D4740334 T-D4740162 T-D4740164 |
| AKSHAY | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740088 T-D4740117 T-D4740118 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740183 T-D4740103 T-D47401031 T-D4740162 |
| NAYAN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740262 T-D4740334 T-D4740156 T-D47401561 T-D4740162 T-D4740164 |
| SNEHAL | A | 0 | 00000000 | T-D4740014 T-D4740027 T-D4740032 T-D47400321 T-D4740034 T-D4740036 T-D47400361 T-D4740048 T-D4740051 T-D4740056 T-D47400561 T-D47400562 T-D4740058 T-D4740061 T-D4740072 T-D4740076 T-D4740078 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740083 T-D4740084 T-D4740087 T-D4740122 T-D4740123 T-D47401231 T-D4740124 T-D4740125 T-D4740126 T-D4740127 T-D4740162 T-D4740164 T-D4740181 T-D4740186 T-D4740336 T-D4740341 T-D4740346 T-D4740347 T-D4740348 T-D4740373 T-D4740374 |
| AFTAB | A | 0 | 00000000 | T-D4740027 T-D4740030 T-D4740042 T-D4740074 T-D4740080 T-D4740117 T-D4740118 T-D4740120 T-D4740122 T-D4740124 T-D4740125 T-D4740127 T-D4740162 T-D4740164 T-D4740182 T-D47401821 T-D4740184 T-D4740334 T-D4740344 T-D4740345 T-D4740351 T-D4740353 T-D4740369 T-D47403691 T-D4740408 |
| AVINASH | A | 0 | 00000000 | T-D4740027 T-D4740030 T-D4740042 T-D4740074 T-D4740080 T-D4740117 T-D4740118 T-D4740120 T-D4740122 T-D4740124 T-D4740125 T-D4740127 T-D4740162 T-D4740164 T-D4740182 T-D47401821 T-D4740184 T-D4740334 T-D4740344 T-D4740345 T-D4740351 T-D4740353 T-D4740369 T-D47403691 T-D4740408 |
| RAJNIK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740144 T-D4740145 T-D4740168 T-D4740172 T-D47401721 T-D4740175 T-D4740334 T-D4740342 |
| JAIMIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740241 T-D4740334 T-D4740368 T-D4740154 T-D47401541 T-D4740372 T-D47401542 T-D4740415 |
| RUCHIT | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740331 T-D4740334 T-D4740355 T-D4740393 T-D47403931 T-D4740418 |
| NILESHMISTRY | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740334 T-D4740355 T-D4740393 T-D47403931 T-D4740418 |
| HITESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740144 T-D4740145 T-D4740168 T-D4740334 T-D4740068 T-D4740152 T-D4740169 T-D4740172 T-D47401721 T-D4740176 T-D4740342 T-D4740162 T-D4740164 |
| VIVEK | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740327 T-D47403271 T-D4740334 T-D4740156 T-D47401561 T-D4740162 |
| BRIJESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740153 T-D47401531 T-D4740154 T-D47401541 T-D47401542 T-D4740162 T-D4740164 T-D4740261 T-D4740334 T-D4740355 T-D4740390 T-D47403901 T-D4740415 |
| RAY | A | 0 | 00000000 | T-D4740421 |
| RAMESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740153 T-D47401531 T-D4740162 T-D4740131 T-D4740133 T-D4740134 T-D47401341 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740191 T-D47401911 T-D47401912 T-D4740334 T-D4740286 T-D4740164 |
| BHAVIN | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740131 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740371 T-D47401542 T-D4740162 T-D4740164 |
| ROHANSOLANKI | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740174 T-D4740334 T-D4740342 T-D4740416 T-D4740424 T-D4740169 |
| PRITESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740169 T-D4740174 T-D4740334 T-D4740342 T-D4740416 T-D4740424 |
| RAKESHWALHE | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740174 T-D4740334 T-D4740416 T-D4740424 T-D4740342 |
| MANOJ | A | 0 | 00000000 | T-D4740122 T-D4740342 T-D4740334 T-D4740168 T-D4740175 T-D4740068 T-D4740125 T-D4740144 T-D4740145 T-D4740152 T-D4740169 T-D4740172 T-D47401721 T-D4740176 T-D4740416 T-D4740162 T-D4740164 T-D4740429 |
| SANDEEPPATEL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740331 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740393 T-D47403931 T-D47401542 T-D4740162 T-D4740164 |
| BINNAT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740109 T-D4740117 T-D4740118 T-D4740166 T-D47401661 T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740335 T-D4740339 T-D4740107 T-D47401071 T-D4740355 T-D4740352 T-D4740162 T-D4740164 |
| AKAKADIYA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740082 T-D4740110 T-D4740131 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740334 T-D4740114 T-D4740164 |
| KISHAN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740131 T-D4740334 T-D4740110 T-D4740366 T-D4740114 T-D4740422 T-D4740162 T-D4740164 |
| ARPIT | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740200 T-D4740334 T-D4740164 T-D4740154 T-D47401541 T-D47401542 T-D4740368 T-D4740372 T-D4740415 |
| CHINTU | A | 0 | 00000000 | T-D4740117 T-D4740118 T-D4740122 T-D4740125 T-D4740166 T-D47401661 T-D4740352 T-D4740355 T-D4740162 T-D4740164 |
| CHETANA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740215 T-D4740334 T-D4740423 T-D4740027 T-D4740032 T-D47400321 T-D4740034 T-D4740036 T-D47400361 T-D4740048 T-D4740051 T-D4740056 T-D47400561 T-D47400562 T-D4740058 T-D4740061 T-D4740072 T-D4740076 T-D4740078 T-D4740079 T-D4740080 T-D4740126 T-D4740127 T-D4740084 T-D4740186 T-D4740336 T-D4740346 T-D4740347 T-D4740348 T-D4740373 T-D4740374 T-D4740426 |
| RAHUL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740182 T-D4740334 T-D4740338 T-D47401821 T-D4740345 T-D4740369 T-D47403691 T-D4740162 T-D4740164 |
| VIJAL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740334 T-D4740355 T-D4740393 T-D47403931 T-D4740418 T-D4740419 |
| DEEP | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740223 T-D4740334 T-D4740154 T-D47401541 T-D4740392 T-D47403921 T-D47401542 T-D4740162 |
| DHAVALPATEL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740292 T-D4740334 T-D4740355 T-D4740368 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| MOHIT | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740331 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| HIRENKUMAR | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740160 T-D4740162 T-D4740164 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740248 T-D4740334 T-D4740355 T-D4740392 T-D47403921 |
| YATIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740331 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740393 T-D47403931 T-D47401542 T-D4740162 T-D4740164 |
| ANAND | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740198 T-D4740334 T-D4740355 T-D4740162 T-D4740164 |
| VISHVAS | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740326 T-D47403261 T-D4740334 T-D4740156 T-D47401561 T-D4740162 T-D4740164 T-D4740390 T-D47403901 |
| CDUDHWALA | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740261 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| YATINDESAI | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740160 T-D4740162 T-D4740164 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740248 T-D4740334 T-D4740355 T-D4740392 T-D47403921 |
| MAULIK | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740259 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| PANKAJ | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740367 T-D4740154 T-D47401541 T-D47401542 T-D4740392 T-D47403921 |
| HARDIK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740231 T-D47402311 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| VICKY | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740027 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740080 T-D4740082 T-D4740131 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740024 T-D4740025 T-D4740026 T-D4740028 T-D47400281 T-D4740029 T-D4740031 T-D4740032 T-D47400321 T-D4740033 T-D47400331 T-D47400332 T-D4740034 T-D4740036 T-D47400361 T-D4740038 T-D47400381 T-D47400382 T-D47400383 T-D47400384 T-D4740039 T-D4740043 T-D4740044 T-D4740045 T-D47400451 T-D47400452 T-D4740046 T-D47400461 T-D4740047 T-D4740048 T-D4740049 T-D47400491 T-D4740050 T-D4740051 T-D4740052 T-D4740053 T-D4740054 T-D4740056 T-D47400561 T-D47400562 T-D4740057 T-D4740058 T-D4740059 T-D4740060 T-D4740061 T-D4740062 T-D4740063 T-D4740064 T-D4740065 T-D4740066 T-D4740067 T-D4740068 T-D4740069 T-D4740076 T-D4740079 T-D4740084 T-D4740085 T-D4740130 T-D47401301 T-D4740132 T-D4740133 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740139 T-D47401391 T-D4740140 T-D47401401 T-D4740142 T-D47401421 T-D4740143 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740148 T-D4740153 T-D47401531 T-D47400641 T-D47400642 T-D4740341 T-D4740427 T-D4740164 |
| DHIRAJ | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740156 T-D47401561 T-D4740162 T-D4740164 T-D4740326 T-D47403261 T-D4740334 T-D4740390 T-D47403901 |
| NITINSHIMPI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740268 T-D47402681 T-D4740334 T-D4740154 T-D47401541 T-D47401542 |
| PRABHJOT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740025 T-D4740026 T-D4740027 T-D4740028 T-D47400281 T-D4740029 T-D4740030 T-D4740031 T-D4740032 T-D47400321 T-D4740033 T-D47400331 T-D47400332 T-D4740034 T-D4740035 T-D47400351 T-D4740036 T-D47400361 T-D4740037 T-D4740038 T-D47400381 T-D47400382 T-D47400383 T-D47400384 T-D4740039 T-D4740040 T-D4740041 T-D4740042 T-D4740043 T-D4740044 T-D4740045 T-D47400451 T-D47400452 T-D4740046 T-D47400461 T-D4740047 T-D4740048 T-D4740049 T-D47400491 T-D4740050 T-D4740051 T-D4740052 T-D4740053 T-D4740054 T-D4740055 T-D47400551 T-D4740056 T-D47400561 T-D47400562 T-D4740057 T-D4740058 T-D4740059 T-D4740060 T-D4740061 T-D4740062 T-D4740063 T-D4740064 T-D4740065 T-D4740066 T-D4740067 T-D4740068 T-D4740069 T-D4740076 T-D4740079 T-D4740080 T-D4740082 T-D4740084 T-D4740085 T-D4740130 T-D47401301 T-D4740131 T-D4740132 T-D4740133 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740139 T-D47401391 T-D4740140 T-D47401401 T-D4740142 T-D47401421 T-D4740143 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740148 T-D4740153 T-D47401531 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D47400641 T-D47400642 T-D4740341 T-D4740427 T-D4740164 |
| KUSH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740154 T-D47401541 T-D47401542 T-D4740334 T-D4740355 T-D4740415 T-D4740427 |
| SARVESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740334 T-D4740367 T-D4740392 T-D47403921 |
| TEJAS | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740100 T-D4740334 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740162 T-D4740164 |
| SHUBHANGI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740097 T-D4740100 T-D4740102 T-D4740334 T-D4740151 T-D4740152 T-D4740420 T-D4740162 T-D4740164 |
| BIMAL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740164 T-D4740209 T-D47402091 T-D4740334 T-D4740156 T-D47401561 T-D4740390 T-D47403901 |
| SANJAY | A | 0 | 00000000 | T-D4740090 T-D4740100 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740122 T-D4740125 T-D4740334 T-D4740417 T-D4740420 |
| VIKAS | A | 0 | 00000000 | T-D4740027 T-D4740030 T-D4740042 T-D4740074 T-D4740080 T-D4740117 T-D4740118 T-D4740120 T-D4740122 T-D4740124 T-D4740125 T-D4740127 T-D4740182 T-D4740184 T-D4740344 T-D47401821 T-D4740345 T-D4740353 T-D4740369 T-D47403691 T-D4740408 T-D4740162 T-D4740164 |
| ABHISHEK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740164 T-D4740193 T-D47401931 T-D4740334 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 |
| MITANSHU | A | 0 | 00000000 | T-D4740090 T-D4740091 T-D4740092 T-D4740094 T-D4740095 T-D4740096 T-D4740100 T-D4740122 T-D4740125 T-D4740334 T-D4740417 T-D4740420 |
| BHAUTIK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740164 T-D4740204 T-D4740334 T-D4740388 T-D4740162 |
| VISHALK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D4740334 T-D4740390 T-D47403901 T-D47401542 T-D4740162 T-D4740164 |
| BIPIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740211 T-D4740334 T-D4740164 |
| CGHOGHARI | A | 0 | 00000000 | T-D4740122 T-D4740168 T-D4740175 T-D4740342 T-D4740125 T-D4740334 T-D4740144 T-D4740145 T-D4740172 T-D47401721 T-D4740416 T-D4740429 |
| PARUL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740027 T-D4740030 T-D4740042 T-D4740074 T-D4740080 T-D4740117 T-D4740118 T-D4740120 T-D4740124 T-D4740127 T-D4740182 T-D4740184 T-D4740344 T-D47401821 T-D4740345 T-D4740353 T-D4740369 T-D47403691 T-D4740408 T-D4740365 |
| PRAKASH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740100 T-D4740334 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740417 T-D4740162 T-D4740164 |
| HIMANSHU | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740109 T-D4740117 T-D4740118 T-D4740166 T-D47401661 T-D4740167 T-D47401671 T-D4740335 T-D4740339 T-D4740107 T-D47401071 T-D4740355 T-D4740352 T-D4740103 T-D47401031 T-D4740162 T-D4740164 |
| FAIZ | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740019 T-D4740020 T-D4740021 T-D4740022 T-D4740023 T-D4740025 T-D4740026 T-D4740027 T-D4740028 T-D47400281 T-D4740029 T-D4740030 T-D4740031 T-D4740032 T-D47400321 T-D4740033 T-D47400331 T-D47400332 T-D4740034 T-D4740035 T-D47400351 T-D4740036 T-D47400361 T-D4740037 T-D4740038 T-D47400381 T-D47400382 T-D47400383 T-D47400384 T-D4740039 T-D4740040 T-D4740041 T-D4740042 T-D4740043 T-D4740044 T-D4740045 T-D47400451 T-D47400452 T-D4740046 T-D47400461 T-D4740047 T-D4740048 T-D4740049 T-D47400491 T-D4740050 T-D4740051 T-D4740052 T-D4740053 T-D4740054 T-D4740055 T-D47400551 T-D4740056 T-D47400561 T-D47400562 T-D4740057 T-D4740058 T-D4740059 T-D4740060 T-D4740061 T-D4740062 T-D4740063 T-D4740065 T-D4740066 T-D4740067 T-D4740068 T-D4740069 T-D4740072 T-D4740073 T-D4740074 T-D4740075 T-D4740076 T-D4740077 T-D4740078 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740083 T-D4740084 T-D4740086 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740120 T-D4740121 T-D47401211 T-D474012110 T-D474012111 T-D474012112 T-D474012113 T-D474012114 T-D474012115 T-D474012116 T-D474012117 T-D474012118 T-D474012119 T-D47401212 T-D474012120 T-D474012121 T-D474012122 T-D474012123 T-D474012124 T-D474012125 T-D474012126 T-D474012127 T-D47401213 T-D47401214 T-D47401215 T-D47401216 T-D47401217 T-D47401218 T-D47401219 T-D4740126 T-D4740127 T-D4740130 T-D47401301 T-D4740131 T-D4740132 T-D4740133 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740139 T-D47401391 T-D4740140 T-D47401401 T-D4740142 T-D47401421 T-D4740143 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740148 T-D4740344 T-D4740420 T-D4740162 T-D4740164 |
| SUNIL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740313 T-D4740334 T-D4740381 T-D4740164 |
| ANISH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740162 T-D4740199 T-D4740334 T-D4740380 T-D4740164 |
| SANDEEP | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740293 T-D4740334 T-D4740382 T-D4740164 |
| VIJAY | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740319 T-D4740334 T-D4740162 T-D4740164 |
| PARAG | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740153 T-D47401531 T-D4740162 T-D4740165 T-D47401651 T-D4740131 T-D4740133 T-D4740134 T-D47401341 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740190 T-D47401901 T-D47401902 T-D4740334 T-D4740164 T-D4740269 T-D4740390 T-D47403901 |
| MEHUL | A | 0 | 00000000 | T-D4740125 T-D4740334 T-D4740164 T-D4740375 T-D4740162 T-D4740379 |
| PINTU | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740160 T-D4740161 T-D4740164 T-D4740166 T-D47401661 T-D4740167 T-D47401671 T-D4740173 T-D4740174 T-D4740179 T-D4740180 T-D4740334 T-D4740355 T-D4740379 T-D4740162 |
| DIPEN | A | 0 | 00000000 | T-D4740030 T-D4740042 T-D4740074 T-D4740118 T-D4740120 T-D4740122 T-D4740125 T-D4740182 T-D4740184 T-D4740344 T-D47401821 T-D4740345 T-D4740351 T-D4740353 T-D4740334 T-D4740117 T-D4740369 T-D47403691 T-D4740408 T-D4740425 T-D4740151 T-D4740152 T-D4740394 |
| RAKESHBHATIA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740110 T-D4740131 T-D4740334 T-D4740366 T-D4740114 T-D4740422 T-D4740162 T-D4740164 |
| SHARADBOBE | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740307 T-D4740334 T-D4740384 T-D4740164 |
| JITENDRA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740248 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740392 T-D47403921 T-D47401542 T-D4740162 T-D4740164 |
| 101HOD | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740341 T-D4740395 T-D4740396 T-D4740397 T-D4740398 T-D4740399 T-D47403991 T-D4740400 T-D4740401 T-D4740402 T-D4740403 T-D47404031 T-D4740162 T-D4740164 T-D4740430 |
| INB00 | A | 0 | 00000000 | T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740085 T-D4740103 T-D47401031 T-D4740111 T-D4740115 T-D4740117 T-D4740118 T-D4740122 T-D4740125 T-D4740128 T-D4740151 T-D4740152 T-D4740218 T-D4740334 T-D4740335 T-D4740336 T-D4740339 T-D4740351 T-D4740352 T-D4740362 T-D4740365 T-D4740409 T-D4740411 T-D4740425 |
| JAY | A | 0 | 00000000 | T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740106 T-D47401061 T-D4740117 T-D4740118 T-D4740122 T-D4740125 T-D4740128 T-D4740351 T-D4740352 T-D4740162 T-D4740164 |
| HARDIKOZA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740100 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740334 T-D4740417 T-D4740420 |
| BPANWALA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740106 T-D47401061 T-D4740117 T-D4740118 T-D4740128 T-D4740352 T-D4740411 T-D4740067 T-D4740068 T-D4740152 T-D4740335 T-D4740339 T-D4740351 T-D4740355 T-D4740365 T-D4740394 T-D4740425 |
| MANISHPATEL | A | 0 | 00000000 | T-D4740090 T-D4740100 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740122 T-D4740125 T-D4740334 T-D4740162 T-D4740164 T-D4740074 T-D4740081 T-D47400811 T-D4740182 T-D47401821 T-D4740183 T-D4740184 T-D4740369 T-D47403691 |
| PRADIP | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740092 T-D4740093 T-D4740094 T-D4740098 T-D4740099 T-D4740184 T-D4740334 T-D4740335 T-D47400991 T-D4740095 T-D4740417 T-D4740096 T-D4740420 |
| KINESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740160 T-D4740166 T-D47401661 T-D4740173 T-D4740179 T-D4740253 T-D47402531 T-D4740334 T-D4740355 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740392 T-D47403921 T-D47401542 T-D4740162 T-D4740164 |
| UMESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740154 T-D47401541 T-D47401542 T-D4740334 T-D4740367 T-D4740392 T-D47403921 |
| PRADIPMISTRY | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740131 T-D4740113 T-D4740334 T-D4740337 T-D4740068 T-D4740366 T-D4740156 T-D47401561 T-D4740160 T-D4740422 T-D4740111 T-D4740115 T-D4740114 T-D4740110 |
| SUJIT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740103 T-D47401031 T-D4740117 T-D4740118 T-D4740128 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740334 T-D4740162 |
| RAMARAJYA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740091 T-D4740092 T-D4740094 T-D4740095 T-D4740096 T-D4740100 T-D4740334 T-D4740417 T-D4740420 |
| NIKHIL | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740068 T-D4740144 T-D4740145 T-D4740175 T-D4740176 T-D4740177 T-D4740178 T-D4740334 T-D4740342 T-D47401771 T-D4740171 T-D4740162 T-D4740164 T-D4740429 |
| BMOTIWALA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740427 T-D4740162 T-D4740164 T-D4740334 |
| BHARGAV | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740164 T-D4740334 T-D4740380 T-D4740162 |
| ASHISH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740355 T-D4740201 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D47401542 |
| DHRUMIL | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740131 T-D4740154 T-D47401541 T-D4740334 T-D47401542 T-D4740162 T-D4740164 |
| SAURABH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740111 T-D4740115 T-D4740131 T-D4740160 T-D4740334 T-D4740156 T-D47401561 T-D4740386 T-D4740422 T-D4740162 T-D4740164 |
| HEMANT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740074 T-D4740081 T-D47400811 T-D4740092 T-D4740093 T-D4740094 T-D4740182 T-D4740183 T-D4740184 T-D4740334 T-D4740335 T-D47401821 T-D4740369 T-D47403691 T-D4740417 T-D4740420 |
| SOMPRABHA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740014 T-D4740027 T-D4740032 T-D47400321 T-D4740034 T-D4740036 T-D47400361 T-D4740048 T-D4740051 T-D4740056 T-D47400561 T-D47400562 T-D4740058 T-D4740061 T-D4740072 T-D4740076 T-D4740078 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740083 T-D4740084 T-D4740087 T-D4740123 T-D4740124 T-D4740126 T-D4740127 T-D4740181 T-D4740186 T-D4740341 T-D4740346 T-D4740347 T-D4740348 T-D47401231 T-D4740373 T-D4740336 T-D4740374 T-D4740184 T-D4740425 T-D4740426 |
| NITIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740161 T-D4740164 T-D4740167 T-D47401671 T-D4740174 T-D4740180 T-D4740267 T-D47402671 T-D4740153 T-D47401531 T-D4740334 T-D4740154 T-D47401541 T-D4740156 T-D47401561 T-D4740372 T-D4740390 T-D47403901 T-D47401542 T-D4740162 |
| PMDIPAK | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740153 T-D47401531 T-D4740162 T-D4740164 T-D4740165 T-D47401651 T-D4740190 T-D47401901 T-D47401902 T-D4740269 T-D4740334 T-D4740390 T-D47403901 T-D4740131 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740145 |
| RANJIT | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740117 T-D4740118 T-D4740128 T-D4740333 T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740335 T-D4740339 T-D4740351 T-D4740352 T-D4740162 T-D4740164 T-D4740355 T-D4740365 T-D4740411 T-D4740425 |
| MIHIR | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740334 T-D4740261 T-D4740154 T-D47401541 T-D4740390 T-D47403901 T-D4740355 T-D4740153 T-D47401531 T-D4740162 T-D4740164 T-D47401542 T-D4740415 T-D4740131 T-D4740133 T-D4740134 T-D47401341 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740144 T-D4740145 T-D4740146 T-D4740147 |
| BHAVESH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740175 T-D4740342 T-D4740168 T-D4740334 T-D4740144 T-D4740145 T-D4740172 T-D47401721 T-D4740394 T-D4740416 T-D4740429 |
| KEVINDESAI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740103 T-D47401031 T-D4740117 T-D4740118 T-D4740128 T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740334 T-D4740335 T-D4740339 T-D4740336 T-D4740351 T-D4740352 T-D4740411 T-D4740162 T-D4740164 |
| KEVIN | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740027 T-D4740030 T-D4740032 T-D47400321 T-D4740034 T-D4740035 T-D47400351 T-D4740036 T-D47400361 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740048 T-D4740051 T-D4740055 T-D47400551 T-D4740061 T-D4740072 T-D4740076 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740082 T-D4740084 T-D4740087 T-D4740109 T-D4740117 T-D4740118 T-D4740123 T-D4740124 T-D4740126 T-D4740127 T-D4740162 T-D4740165 T-D47401651 T-D4740180 T-D4740186 T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740335 T-D4740339 T-D4740341 T-D4740343 T-D47401231 T-D4740352 T-D4740164 T-D4740425 T-D4740355 T-D4740428 T-D4740365 |
| JALPA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740027 T-D4740032 T-D47400321 T-D4740034 T-D4740036 T-D47400361 T-D4740048 T-D4740051 T-D4740061 T-D4740072 T-D4740076 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740082 T-D4740084 T-D4740087 T-D4740123 T-D4740124 T-D4740126 T-D4740127 T-D4740159 T-D4740162 T-D4740165 T-D47401651 T-D4740172 T-D47401721 T-D4740180 T-D4740186 T-D4740341 T-D4740184 T-D4740346 T-D4740347 T-D4740348 T-D47401231 T-D4740164 T-D4740432 |
| MAHESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740257 T-D4740334 T-D4740388 T-D4740164 |
| KSHAMA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740097 T-D4740100 T-D4740101 T-D4740102 T-D4740091 T-D4740334 T-D4740115 T-D4740422 T-D4740151 T-D4740152 T-D4740394 T-D4740066 T-D4740067 T-D4740068 |
| RIDDHI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740090 T-D4740098 T-D4740099 T-D4740100 T-D4740101 T-D4740334 T-D47400991 T-D4740404 T-D4740420 T-D4740162 T-D4740164 |
| JAYESH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740109 T-D4740117 T-D4740118 T-D4740165 T-D47401651 T-D4740066 T-D4740067 T-D4740068 T-D4740151 T-D4740152 T-D4740335 T-D4740339 T-D4740061 T-D4740341 T-D4740343 T-D4740352 T-D4740362 T-D4740128 T-D4740162 T-D4740103 T-D47401031 T-D4740365 T-D4740425 |
| PRITIKA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740110 T-D4740114 T-D4740131 T-D4740334 T-D4740156 T-D47401561 T-D4740422 |
| UDAY | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740162 T-D4740315 T-D4740334 T-D4740379 T-D4740164 |
| MPRAJAPATI | A | 0 | 00000000 | T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740106 T-D47401061 T-D4740117 T-D4740118 T-D4740122 T-D4740125 T-D4740128 T-D4740351 T-D4740352 T-D4740335 T-D4740355 T-D4740365 T-D4740411 T-D4740339 T-D4740425 T-D4740067 T-D4740068 T-D4740152 T-D4740394 |
| RONAK | A | 0 | 00000000 | T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740067 T-D4740068 T-D4740117 T-D4740118 T-D4740122 T-D4740125 T-D4740128 T-D4740152 T-D4740335 T-D4740351 T-D4740352 T-D4740355 T-D4740365 T-D4740394 T-D4740411 T-D4740105 T-D47401051 |
| AKASH | A | 0 | 00000000 | T-D4740122 T-D4740125 T-D4740018 T-D4740019 T-D4740020 T-D4740021 T-D4740022 T-D4740023 T-D4740027 T-D4740028 T-D47400281 T-D4740029 T-D4740030 T-D4740031 T-D4740032 T-D47400321 T-D4740033 T-D47400331 T-D47400332 T-D4740034 T-D4740035 T-D47400351 T-D4740036 T-D47400361 T-D4740037 T-D4740038 T-D47400381 T-D47400382 T-D47400383 T-D47400384 T-D4740039 T-D4740040 T-D4740041 T-D4740042 T-D4740043 T-D4740044 T-D4740045 T-D47400451 T-D47400452 T-D4740046 T-D47400461 T-D4740047 T-D4740048 T-D4740049 T-D47400491 T-D4740050 T-D4740051 T-D4740052 T-D4740053 T-D4740054 T-D4740055 T-D47400551 T-D4740056 T-D47400561 T-D47400562 T-D4740057 T-D4740058 T-D4740059 T-D4740060 T-D4740061 T-D4740062 T-D4740063 T-D4740067 T-D4740068 T-D4740069 T-D4740072 T-D4740073 T-D4740074 T-D4740075 T-D4740076 T-D4740077 T-D4740078 T-D4740079 T-D4740080 T-D4740083 T-D4740084 T-D4740086 T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740120 T-D4740121 T-D47401211 T-D474012110 T-D474012111 T-D474012112 T-D474012113 T-D474012114 T-D474012115 T-D474012116 T-D474012117 T-D474012118 T-D474012119 T-D47401212 T-D474012120 T-D474012121 T-D474012122 T-D474012123 T-D474012124 T-D474012125 T-D474012126 T-D474012127 T-D47401213 T-D47401214 T-D47401215 T-D47401216 T-D47401217 T-D47401218 T-D47401219 T-D4740126 T-D4740127 T-D4740130 T-D47401301 T-D4740131 T-D4740132 T-D4740133 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740139 T-D47401391 T-D4740140 T-D47401401 T-D4740142 T-D47401421 T-D4740143 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740148 T-D4740339 T-D4740344 T-D4740420 T-D4740162 T-D4740164 |
| SHIBRAM | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740030 T-D4740035 T-D47400351 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740088 T-D4740117 T-D4740118 T-D4740161 T-D4740167 T-D47401671 T-D4740183 T-D4740352 T-D4740103 T-D47401031 T-D4740128 T-D4740411 T-D4740162 T-D4740164 |
| MANISH | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740105 T-D4740117 T-D4740118 T-D4740128 T-D47401051 T-D4740420 T-D4740162 T-D4740164 |
| RIYA | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740111 T-D4740115 T-D4740131 T-D4740334 T-D4740366 T-D4740160 T-D4740156 T-D47401561 T-D4740386 T-D4740152 T-D4740394 T-D4740422 |
| CHIRAGJOSHI | A | 0 | 00000000 | T-D4740125 T-D4740122 T-D4740018 T-D4740030 T-D4740037 T-D4740040 T-D4740041 T-D4740042 T-D4740055 T-D47400551 T-D4740103 T-D47401031 T-D4740117 T-D4740118 T-D4740128 T-D4740151 T-D4740152 T-D4740334 T-D4740335 T-D4740339 T-D4740336 T-D4740351 T-D4740352 T-D4740085 T-D4740218 T-D4740362 T-D4740365 T-D4740411 T-D4740111 T-D4740115 T-D4740425 T-D4740066 T-D4740067 T-D4740068 T-D4740394 |
| SAPMDM | A | 0 | 00000000 | T-D4740119 T-D47401191 T-D474011910 T-D474011911 T-D474011912 T-D474011913 T-D474011914 T-D474011915 T-D474011916 T-D474011917 T-D474011918 T-D474011919 T-D47401192 T-D474011920 T-D474011921 T-D474011922 T-D474011923 T-D474011924 T-D474011925 T-D474011926 T-D474011927 T-D474011928 T-D47401193 T-D47401194 T-D47401195 T-D47401196 T-D47401197 T-D47401198 T-D47401199 T-D4740121 T-D47401211 T-D474012110 T-D474012111 T-D474012112 T-D474012113 T-D474012114 T-D474012115 T-D474012116 T-D474012117 T-D474012118 T-D474012119 T-D47401212 T-D474012120 T-D474012121 T-D474012122 T-D474012123 T-D474012124 T-D474012125 T-D474012126 T-D474012127 T-D47401213 T-D47401214 T-D47401215 T-D47401216 T-D47401217 T-D47401218 T-D47401219 |
| KISHANSHIYAL | A | 0 | 00000000 | T-D4740125 T-D4740112 T-D4740116 T-D4740131 T-D4740334 T-D4740366 T-D4740156 T-D47401561 T-D4740422 T-D4740151 T-D4740152 |

RFC user (from S4_USERNAME) profiles: SAP_ALL T-D4740014 T-D4740015 T-D4740016 T-D4740018 T-D4740019 T-D4740027 T-D4740028 T-D47400281 T-D4740029 T-D4740030 T-D4740031 T-D4740032 T-D47400321 T-D4740033 T-D47400331 T-D47400332 T-D4740034 T-D4740035 T-D47400351 T-D4740036 T-D47400361 T-D4740037 T-D4740038 T-D47400381 T-D47400382 T-D47400383 T-D47400384 T-D4740039 T-D4740040 T-D4740041 T-D4740042 T-D4740043 T-D4740044 T-D4740045 T-D47400451 T-D47400452 T-D4740046 T-D47400461 T-D4740047 T-D4740048 T-D4740049 T-D47400491 T-D4740050 T-D4740051 T-D4740052 T-D4740053 T-D4740054 T-D4740055 T-D47400551 T-D4740056 T-D47400561 T-D47400562 T-D4740057 T-D4740058 T-D4740059 T-D4740060 T-D4740061 T-D4740062 T-D4740063 T-D4740064 T-D47400641 T-D47400642 T-D4740065 T-D4740066 T-D4740067 T-D4740068 T-D4740069 T-D4740071 T-D4740072 T-D4740073 T-D4740074 T-D4740075 T-D4740076 T-D4740077 T-D4740078 T-D4740079 T-D4740080 T-D4740081 T-D47400811 T-D4740083 T-D4740084 T-D4740085 T-D4740086 T-D4740130 T-D47401301 T-D4740131 T-D4740132 T-D4740133 T-D4740134 T-D47401341 T-D4740135 T-D47401351 T-D47401352 T-D47401353 T-D4740136 T-D47401361 T-D4740137 T-D47401371 T-D4740138 T-D47401381 T-D47401382 T-D4740139 T-D47401391 T-D4740140 T-D47401401 T-D4740142 T-D47401421 T-D4740143 T-D4740144 T-D4740145 T-D4740146 T-D4740147 T-D4740148 T-D4740162 T-D4740164 T-D4740187 T-D4740341 T-D4740343 T-D4740346 T-D4740347 T-D4740348 T-D4740350 T-D47403501 T-D4740389 T-D4740391 T-D4740427

### Discovery summary (CONFIRMED from the reads above unless marked UNSURE)

- **A1:** warehouse W01 (from `cds.s4.warehouseNumber`) covers 15 storage locations of plant 1120 and 9 of plant 1600; `LGNTB` blank for all (WM-managed).
- **A2:** T333 W01: 201 → NLTYP 911 (bin dynamic), 241 → 913 (dynamic), 311 → 921/TRANSFER, 301 → 920/TRANSFER; VLTYP/VLPLA blank for all four (source by stock removal strategy). The IM→WM link is T156S (`BWART` → `RBLVS`) → T321 (`RBLVS` → `BWLVS`); T321 for W01 holds only `RBLVS 311 → BWLVS 311` (SOBKZ E, BSLVS blank/Q). IM movements 201, 241 and 301 have no T321 row in W01.
- **A3:** `T321-TBFKZ` "Indicator: Creation/Cancellation of a Transfer Requirement" and `T321-TAFKZ` "Indicator: Create transfer order immediately" (DD04T). For W01 both are blank/`A` on the 311 rows → no automatic TR from an IM goods movement; the app creates staging TRs itself (`L_TR_CREATE`, BWLVS 311 for 201/241, else the IM type). UNSURE: exact meaning of `TAFKZ = 'A'` (domain values not read).
- **A4:** T156 field `RSTYP` "Account assignment of reservation": 201 → K, 241 → A, 311 → U, 301 → U, so 301 is reservation-capable; empirically five 301 reservations exist since 2026-09-12 (e.g. 525866 with a full WM/MM chain).
- **A5a/b:** free WM stock exists for plant 1120/CS01 (e.g. material 8900000007, batch-managed, 2875 KG; 8900000004 at 1120/CS01 and HS01) and 1600/CS01. Batch-managed with stock: 8900000007 (XCHPF X). Serial-managed with stock: 8000009700 (SERNP ZSN1), 1120/CS01, 1 NOS at RM1/0-L0001-01 (plus 2 on-hold quants).
- **A5c:** company code of plants 1120 and 1600 is 1000 (T001K); CSKS rows for 1000 valid today and ANLA assets of 1000 (e.g. 400001, used in Run 2) are listed; receiving SLocs from T320/T001L; receiving plant for 301 from MARC (1110 used by Run 4).
- **A5d:** every verified chain used VLTYP 902 / VLPLA 0000000000 as source (GR interim, chosen by SAP) and the T333 destination (921/TRANSFER for 311-staging, 920/TRANSFER for 301); RESB `KZEAR = X` after the final issue; `MATDOC-SGTXT` is blank on all documents posted before the ProcessId change; `LTBK-STATU = E` once fully converted. One open 301 TR without TO exists: 0001000795 (STATU blank, TAMEN 0).
- **A6:** lock object EMRESB (section 5/21). The RFC user holds SAP_ALL. Dialog users without SAP_ALL exist (see table, e.g. ZIETA_PM, ZIETA_FI, KISHANSHIYAL with T-D474* generated profiles), but their passwords are not known to this repo and no RFC session was opened for them: **negative authorization test = not verified.**


## 25. Stock removal search customizing (T334T) and material WM views (MLGN), read-only, 2026-10-12
| POSITION | FIELDNAME | KEYFLAG | ROLLNAME | DATATYPE | LENG | TEXT |
|---|---|---|---|---|---|---|
| 0001 | MANDT | X | MANDT | CLNT | 000003 | Client |
| 0002 | LGNUM | X | LGNUM | CHAR | 000003 | Warehouse Number / Warehouse Complex |
| 0003 | KZEAR | X | T334TKZEAR | CHAR | 000001 | Indicator: storage type search |
| 0004 | LGTKZ | X | LVS_LGTKZ | CHAR | 000003 | Storage Type Indicator |
| 0005 | BESTQ | X | BESTQ | CHAR | 000001 | Stock Category in the Warehouse Management System |
| 0006 | SOBKZ | X | SOBKZ | CHAR | 000001 | Special Stock Indicator |
| 0007 | LAGKL | X | LVS_LAGKL | CHAR | 000005 | Storage class |
| 0008 | WGFKL | X | MGEF_WGFKL | NUMC | 000001 | Water Pollution Class |
| 0009 | BWREF | X | LVS_BWREF | NUMC | 000003 | Reference to movement type during storage type search |
| 0010 | LGREF | X | LVS_LGREF | CHAR | 000002 | Storage loc. ref. |
| 0011 | LGTY0 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0012 | LGTY1 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0013 | LGTY2 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0014 | LGTY3 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0015 | LGTY4 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0016 | LGTY5 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0017 | LGTY6 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0018 | LGTY7 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0019 | LGTY8 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0020 | LGTY9 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0021 | LGT10 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0022 | LGT11 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0023 | LGT12 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0024 | LGT13 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0025 | LGT14 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0026 | LGT15 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0027 | LGT16 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0028 | LGT17 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0029 | LGT18 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0030 | LGT19 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0031 | LGT20 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0032 | LGT21 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0033 | LGT22 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0034 | LGT23 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0035 | LGT24 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0036 | LGT25 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0037 | LGT26 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0038 | LGT27 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0039 | LGT28 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0040 | LGT29 |  | LGTYP | CHAR | 000003 | Storage Type |
| 0041 | QMSTE |  | T325QMSTE | CHAR | 000002 | Indicator: Control for WM-QM interface |

T334T rows for W01 (34):
| LGNUM | KZEAR | LGTKZ | BESTQ | SOBKZ | LAGKL | WGFKL | BWREF | LGREF | LGTY0 | LGTY1 | LGTY2 | LGTY3 | LGTY4 | LGTY5 | LGTY6 | LGTY7 | LGTY8 | LGTY9 | LGT10 | LGT11 | LGT12 | LGT13 | LGT14 | LGT15 | LGT16 | LGT17 | LGT18 | LGT19 | LGT20 | LGT21 | LGT22 | LGT23 | LGT24 | LGT25 | LGT26 | LGT27 | LGT28 | LGT29 | QMSTE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W01 |  |  |  |  |  | 0 | 000 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | A |  |  |  |  | 0 | 000 |  | *** | *** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | A |  |  | E |  | 0 | 000 |  | *** | *** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | A | 005 |  |  |  | 0 | 000 |  | 005 | *** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | A | 005 |  | E |  | 0 | 000 |  | 005 | *** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E |  |  |  |  | 0 | 000 |  | 001 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E |  | Q | E |  | 0 | 000 |  | 005 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 001 |  |  |  | 0 | 000 |  | 001 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 001 | Q |  |  | 0 | 000 |  | 001 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 001 | R |  |  | 0 | 000 |  | 001 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 005 |  |  |  | 0 | 000 |  | 005 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 005 |  | E |  | 0 | 000 |  | 005 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | 005 | Q |  |  | 0 | 000 |  | 005 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | 005 | Q | E |  | 0 | 000 |  | 005 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | EN1 |  |  |  | 0 | 000 |  | EN1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | EN1 |  | E |  | 0 | 000 |  | EN1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | EN1 | Q |  |  | 0 | 000 |  | EN1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | EN1 | Q | E |  | 0 | 000 |  | EN1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | FG1 |  |  |  | 0 | 000 |  | FG1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | FG1 |  | E |  | 0 | 000 |  | FG1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | FG1 | Q |  |  | 0 | 000 |  | FG1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | FG1 | Q | E |  | 0 | 000 |  | FG1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | GS1 |  |  |  | 0 | 000 |  | GS1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | GS1 |  | E |  | 0 | 000 |  | GS1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | GS1 | Q |  |  | 0 | 000 |  | GS1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | GS1 | Q | E |  | 0 | 000 |  | GS1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | OH1 |  |  |  | 0 | 000 |  | OH1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | OH1 |  | E |  | 0 | 000 |  | OH1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | OH1 | Q |  |  | 0 | 000 |  | OH1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | OH1 | Q | E |  | 0 | 000 |  | OH1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | RM1 |  |  |  | 0 | 000 |  | RM1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | RM1 |  | E |  | 0 | 000 |  | RM1 | 003 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| W01 | E | RM1 | Q |  |  | 0 | 000 |  | RM1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 01 |
| W01 | E | RM1 | Q | E |  | 0 | 000 |  | RM1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

MLGN fields used: MATNR, LGNUM, LGBKZ, LTKZE, LTKZA
| MATNR | LGNUM | LGBKZ | LTKZE | LTKZA |
|---|---|---|---|---|
| 000000001000000204 | W01 |  | RM1 | RM1 |
| 000000008900000004 | W01 |  |  |  |
| 000000008900000007 | W01 |  |  |  |
| 000000001000000579 | W01 |  | RM1 | RM1 |
| 000000008000009754 | W01 |  |  |  |
| 000000008000009700 | W01 |  | EN1 | EN1 |

Texts: LGBKZ = ; LTKZA = ; LTKZE = 

T333 field texts for BWREF/TRART:
| FIELDNAME | ROLLNAME | TEXT |
|---|---|---|
| TRART | LVS_TRART | Shipment Type |
| VLTYP | T333_VLTYP | Source Storage Type |
| BWREF | LVS_BWREF | Reference to movement type during storage type search |

Reading (CONFIRMED from the rows above and the live error `Data for storage type search is not defined (A RM1  )`): the stock removal search strategy is T334T with `KZEAR = 'A'` and the material's removal storage type indicator `MLGN-LTKZA` as `LGTKZ`. W01 has `A` rows only for `LGTKZ` blank and `005` (search list `***` = all storage types, which is why the earlier runs could pick from 902). Materials with `LTKZA = RM1` (1000000204, 1000000579) have no `A` row → `L_TO_CREATE_TR` cannot find a source. The sandbox tool therefore only offers materials whose `LTKZA` has a T334T `A` row and whose quant storage type is in that row's list. Customizing is not changed.


## 26. Storage location handling-unit management (T001L), read-only, 2026-10-12
T001L fields whose text mentions handling units:
| FIELDNAME | ROLLNAME | DATATYPE | LENG | TEXT |
|---|---|---|---|---|
| XHUPF | XHUPF | CHAR | 000001 | Handling unit requirement |
| PARLG | PARLG | CHAR | 000004 | Partner storage location of the handling unit |

T001L plant 1120 (69 rows; WM-managed ones per T320 marked by the matrix tool):
| WERKS | LGORT | LGOBE | XHUPF | PARLG |
|---|---|---|---|---|
| 1120 | AD01 | Analytical Team |  |  |
| 1120 | ADM1 | Admin Team |  |  |
| 1120 | AF01 | AFGS Tank Farm |  |  |
| 1120 | AG01 | AGS Tank Farm |  |  |
| 1120 | CF01 | Cafe |  |  |
| 1120 | CI01 | C&I - 2 |  |  |
| 1120 | CI02 | C&I Team - 2 |  |  |
| 1120 | CIS1 | CIS Team |  |  |
| 1120 | CS01 | Raw Material |  |  |
| 1120 | CS02 | Raw Material | X | HU01 |
| 1120 | CS03 | IM03 |  |  |
| 1120 | CS04 | IM04 |  |  |
| 1120 | CT01 | Creative Team |  |  |
| 1120 | DP01 | Dispatch Team |  |  |
| 1120 | EHS1 | EHS Team |  |  |
| 1120 | EL01 | Elec Team - 2 |  |  |
| 1120 | EL02 | Elec Team - 1 |  |  |
| 1120 | ENV1 | ETP  Team |  |  |
| 1120 | EO01 | EO TANK 1 |  |  |
| 1120 | FG01 | Finished Storage | X | HU01 |
| 1120 | FI01 | Finance Team |  |  |
| 1120 | HR01 | HR & IR Team |  |  |
| 1120 | HS01 | ENGG Store |  |  |
| 1120 | HU01 | FG Partner locat |  |  |
| 1120 | HY01 | Hydrogen YARD |  |  |
| 1120 | IB01 | IB TANK 2 |  |  |
| 1120 | IM01 | IM01 |  |  |
| 1120 | IP01 | Intermediate PT1 |  |  |
| 1120 | IP02 | Intermediate PT2 |  |  |
| 1120 | IP03 | Intermediate PT3 |  |  |
| 1120 | IP04 | Intermediate PT4 |  |  |
| 1120 | IP05 | Intermediate PT5 |  |  |
| 1120 | LG01 | Logistic Team |  |  |
| 1120 | MT01 | Maint Team - 2 |  |  |
| 1120 | MT02 | Maint Team - 1 |  |  |
| 1120 | OH01 | RM On Hold Area |  |  |
| 1120 | OH02 | HW On Hold Area |  |  |
| 1120 | PR01 | ENGG Purchase |  |  |
| 1120 | PR02 | RM Procurement |  |  |
| 1120 | PS01 | Process Team |  |  |
| 1120 | PT01 | Prod Team - 1 |  |  |
| 1120 | PT02 | Prod Team - 2 |  |  |
| 1120 | PT03 | Prod Team - 3 |  |  |
| 1120 | PT04 | Prod Team - 4 |  |  |
| 1120 | PT05 | PD Team - 5 |  |  |
| 1120 | PWIP | Production WIP |  |  |
| 1120 | QA01 | QA Team |  |  |
| 1120 | QC01 | QC Team |  |  |
| 1120 | RA01 | Reject Area | X | HU01 |
| 1120 | RD01 | R&D Team - 1 |  |  |
| 1120 | RD02 | R&D Team - 2 |  |  |
| 1120 | RD03 | R&D Team - 3 |  |  |
| 1120 | RD04 | R&D Team - 4 |  |  |
| 1120 | RD05 | R&D Team - 5 |  |  |
| 1120 | RD06 | R&D Team - 6 |  |  |
| 1120 | RD07 | R&D Team - 7 |  |  |
| 1120 | RD08 | R&D Team - 8 |  |  |
| 1120 | RD09 | R&D Team - 9 |  |  |
| 1120 | RD10 | R&D Team - 10 |  |  |
| 1120 | RJ01 | Rejection Area | X | HU01 |
| 1120 | RJ02 | Reject Area ENG |  |  |
| 1120 | SA01 | Sales Team |  |  |
| 1120 | SC01 | Scrape Area |  |  |
| 1120 | ST01 | Storage Tank 1 |  |  |
| 1120 | ST02 | Storage Tank 2 |  |  |
| 1120 | ST10 | Storage Tank 10 |  |  |
| 1120 | SU01 | SUT TESTING -DNR |  |  |
| 1120 | TRAN | Stock in Transit |  |  |
| 1120 | UG01 | UGS Tank Farm |  |  |

T001L plant 1600 (37 rows; WM-managed ones per T320 marked by the matrix tool):
| WERKS | LGORT | LGOBE | XHUPF | PARLG |
|---|---|---|---|---|
| 1600 | ADM1 | Admin Team |  |  |
| 1600 | CI01 | C&I - 2 |  |  |
| 1600 | CI02 | C&I Team - 2 |  |  |
| 1600 | CIS1 | CIS Team |  |  |
| 1600 | CS01 | Raw Material |  |  |
| 1600 | CS02 | Raw Material | X | HU01 |
| 1600 | DP01 | Dispatch Team |  |  |
| 1600 | EHS1 | EHS Team |  |  |
| 1600 | EL01 | Elec Team - 2 |  |  |
| 1600 | EL02 | Elec Team - 1 |  |  |
| 1600 | ENV1 | ETP  Team |  |  |
| 1600 | FG01 | Finished Storage | X | HU01 |
| 1600 | HS01 | ENGG Store |  |  |
| 1600 | HU01 | FG Partner locat |  |  |
| 1600 | IP01 | Intermediate PT1 |  |  |
| 1600 | LG01 | Logistics Team |  |  |
| 1600 | MT01 | Maint Team - 2 |  |  |
| 1600 | MT02 | Maint Team - 1 |  |  |
| 1600 | OH01 | RM On Hold Area |  |  |
| 1600 | OH02 | HW On Hold Area |  |  |
| 1600 | PR01 | ENGG Purchase |  |  |
| 1600 | PR02 | RM Procurement |  |  |
| 1600 | RD01 | R&D Team - 1 |  |  |
| 1600 | RD02 | R&D Team - 2 |  |  |
| 1600 | RD03 | R&D Team - 3 |  |  |
| 1600 | RD04 | R&D Team - 4 |  |  |
| 1600 | RD05 | R&D Team - 5 |  |  |
| 1600 | RD06 | R&D Team - 6 |  |  |
| 1600 | RD07 | R&D Team - 7 |  |  |
| 1600 | RD08 | R&D Team - 8 |  |  |
| 1600 | RD09 | R&D Team - 9 |  |  |
| 1600 | RD10 | R&D Team - 10 |  |  |
| 1600 | RJ01 | Rejection Area |  |  |
| 1600 | RJ02 | Reject Area ENG |  |  |
| 1600 | SC01 | Scrape Area |  |  |
| 1600 | ST01 | Engg Store |  |  |
| 1600 | ST02 | RM Store Team |  |  |

T001L plant 1110 (61 rows; WM-managed ones per T320 marked by the matrix tool):
| WERKS | LGORT | LGOBE | XHUPF | PARLG |
|---|---|---|---|---|
| 1110 | AD01 | Analytical Team |  |  |
| 1110 | ADM1 | Admin Team |  |  |
| 1110 | AF01 | AFGS Tank Farm |  |  |
| 1110 | AG01 | AGS Tank Farm |  |  |
| 1110 | CF01 | Cafe |  |  |
| 1110 | CI01 | C&I - 2 |  |  |
| 1110 | CI02 | C&I Team - 2 |  |  |
| 1110 | CIS1 | CIS Team |  |  |
| 1110 | CS01 | Raw Material |  |  |
| 1110 | CS02 | Raw Material | X | HU01 |
| 1110 | CS03 | Raw Material |  |  |
| 1110 | CS04 | Raw Material |  |  |
| 1110 | CT01 | Creative Team |  |  |
| 1110 | DP01 | Dispatch Team |  |  |
| 1110 | EHS1 | EHS Team |  |  |
| 1110 | EL01 | Elec Team - 2 |  |  |
| 1110 | EL02 | Elec Team - 1 |  |  |
| 1110 | ENV1 | ETP  Team |  |  |
| 1110 | FG01 | Finished Storage | X | HU01 |
| 1110 | FI01 | Finance Team |  |  |
| 1110 | HR01 | HR & IR Team |  |  |
| 1110 | HS01 | ENGG Store |  |  |
| 1110 | HU01 | FG Partner locat |  |  |
| 1110 | HY01 | Hydrogen YARD |  |  |
| 1110 | IP01 | Intermediate PT1 |  |  |
| 1110 | IP02 | Intermediate PT2 |  |  |
| 1110 | LG01 | Logistics Team |  |  |
| 1110 | MT01 | Maint Team - 2 |  |  |
| 1110 | MT02 | Maint Team - 1 |  |  |
| 1110 | OH01 | RM On Hold Area |  |  |
| 1110 | OH02 | HW On Hold Area |  |  |
| 1110 | PR01 | ENGG Purchase |  |  |
| 1110 | PR02 | RM Procurement |  |  |
| 1110 | PS01 | Process Team |  |  |
| 1110 | PT01 | Prod Team - 1 |  |  |
| 1110 | PT02 | Prod Team - 2 |  |  |
| 1110 | PT03 | Prod Team - 3 |  |  |
| 1110 | PT04 | Prod Team - 4 |  |  |
| 1110 | PT05 | PD Team - 5 |  |  |
| 1110 | PWIP | Production WIP |  |  |
| 1110 | QA01 | QA Team |  |  |
| 1110 | QC01 | QC Team |  |  |
| 1110 | RA01 | Reject Area |  |  |
| 1110 | RD01 | R&D Team - 1 |  |  |
| 1110 | RD02 | R&D Team - 2 |  |  |
| 1110 | RD03 | R&D Team - 3 |  |  |
| 1110 | RD04 | R&D Team - 4 |  |  |
| 1110 | RD05 | R&D Team - 5 |  |  |
| 1110 | RD06 | R&D Team - 6 |  |  |
| 1110 | RD07 | R&D Team - 7 |  |  |
| 1110 | RD08 | R&D Team - 8 |  |  |
| 1110 | RD09 | R&D Team - 9 |  |  |
| 1110 | RD10 | R&D Team - 10 |  |  |
| 1110 | RJ01 | Rejection Area |  |  |
| 1110 | RJ02 | Reject Area ENG |  |  |
| 1110 | SA01 | Sales Team |  |  |
| 1110 | SC01 | Scrape Area |  |  |
| 1110 | ST01 | Engg Store |  |  |
| 1110 | ST02 | RM Store Team |  |  |
| 1110 | TRAN | Stock in Transit |  |  |
| 1110 | UG01 | UGS Tank Farm |  |  |

Reading (CONFIRMED): sandbox run 07:51 UTC posted TO 1037289 but `BAPI_GOODSMVT_CREATE` refused the 311 to CS02 with "Transfer posting with WM only possible if both storage locs subject to HU" — CS02 has `XHUPF = X` (HU-managed, partner HU01) while CS01 does not. The sandbox tool now only offers receiving storage locations whose `T001L-XHUPF` equals the issuing one. Reservation 525874 / TR 1000801 / TO 1037289 remain in SAP with 1 KG staged in 921/TRANSFER and no goods movement.
