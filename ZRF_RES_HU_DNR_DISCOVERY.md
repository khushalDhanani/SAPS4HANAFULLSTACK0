# ZRF_RES_HU_DNR — Step 1 SAP Transaction Discovery

> **Document Type:** Business Process & Technical Discovery  
> **Target Transaction:** `ZRF_RES_HU_DNR`  
> **Source ABAP Program:** `ZRF_RES_HU_TRANSFER_DNR` (verified in SAP Client 220, Package `ZAMM`)  
> **Author:** DNR / Dipak Rathod (Date: 18.10.2026, Transport Request: `DS4K905295`)  
> **Status:** READ-ONLY DISCOVERY COMPLETE — Zero code mutations, zero live writes.

---

## 1. Transaction Identity

| Attribute | Technical Value | Verification Source |
|---|---|---|
| **Transaction Code** | `ZRF_RES_HU_DNR` | `TSTC-TCODE` (SAP Client 220) |
| **Transaction Description** | `RF & Desktop HU Stock Transfer` | `TSTCT-TTEXT` (Language 'E') |
| **Main Program** | `ZRF_RES_HU_TRANSFER_DNR` | `TSTC-PGMNA` |
| **Initial Screen (Dynpro)** | `1000` | `TSTC-DYPNO` |
| **Program Type** | Executable Program (`SUBC = 1`) | `TRDIR-SUBC` |
| **Package (Dev Class)** | `ZAMM` | `TADIR-DEVCLASS` |
| **Author / Creator** | `DIPAK` (DNR / Dipak Rathod) | `TADIR-AUTHOR`, `TRDIR-CNAM` |
| **Creation / Modification Date** | Created: `2026-10-16`, Updated: `2026-10-22` | `TRDIR-CDAT`, `TRDIR-UDAT` |
| **Transport Request** | `DS4K905295` | Source Header Documentation |
| **WebGUI / FLP Enablement** | `S_WEBGUI = '1'`, `S_SERVICE = '1'` | `TSTCC` |
| **Related Transactions** | `ZRF_COWBHUWA` (`SAPMZRF_COWBHUWA` - RF HU Goods Issue)<br>`ZRF_HU_SCAN` (`SAPMZ_RF_HU_TO_SCAN` - RF Scan HU & Map Serial)<br>`ZRF_RESWM` / `ZRF01` (`SAPMZRF_RES_WM_TRANSFER` - RF Reservation to WM Transfer) | `TSTC` / `TSTCT` |
| **Related Custom FMs** | `Z_GET_HU_HIERARCHY`, `Z_HU_ISSUE_TO_ORDER`, `Z_HU_SERIAL_PENDING_LIST`, `Z_HU_LINK_SERIAL_NUMBER` (in `SAPLZFG_HANDLINGUNIT`) | `TFDIR` |

---

## 2. Screen Flow

The transaction uses an ABAP selection-screen report architecture featuring two distinct screens: an initial filter screen (`1000`) rendering an interactive SALV grid, and a modal transfer processing screen (`2000`) styled after a Fiori Object Page.

### Screen 1000: Selection & Filter Screen

- **Purpose:** Filter and retrieve open/completed inventory reservations (primarily Movement Type 311) to be fulfilled via Handling Units or Storage Units.
- **Fields:**
  - `p_lgnum` (Warehouse Code, Memory ID `lgn`): Optional warehouse number filter.
  - `p_plnt` (Plant, Memory ID `wrk`): Plant filter, defaults to `'1120'`.
  - `s_sloc` (Storage Location): Select-Option for source storage location (`RESB-LGORT`).
  - `s_bwart` (Movement Type): Select-Option for movement type (`RESB-BWART`).
  - `s_usnam` (Requester): Select-Option for reservation creating user (`RKPF-USNAM`).
  - `s_res` (Reservation Number): Select-Option for reservation number (`RESB-RSNUM`).
  - `s_mat` (Material Code): Select-Option for material number (`RESB-MATNR`).
  - Status Radio Buttons (`RADIOBUTTON GROUP g_st`):
    - `r_open` ("Open Only", default `'X'`): Filters `KZEAR <> 'X'` and `open_qty > 0`.
    - `r_comp` ("Completed Only"): Filters `KZEAR = 'X'` or `open_qty <= 0`.
    - `r_all` ("All Reservations"): Includes open and completed.
  - Checkbox `p_del` ("Include Deleted Items (XLOEK)", default `' '`): When unchecked, filters out `RESB-XLOEK = 'X'`.
- **Buttons / Actions:**
  - `ONLI` (F8 / Execute): Triggers validation and data retrieval.
- **PBO Logic (`INITIALIZATION` & `AT SELECTION-SCREEN OUTPUT`):**
  - Sets screen titles, block titles, parameter labels, radio button descriptions with SAP GUI icon codes (`@0J@`, `@11@`, `@01@`, `@09@`, `@12@`).
  - Auto-checks and registers `TSTCC` Fiori Launchpad & WebGUI flags.
- **PAI Logic (`AT SELECTION-SCREEN`):**
  - Plant existence validation: `SELECT SINGLE werks FROM t001w WHERE werks = p_plnt`.
  - Warehouse existence validation: `SELECT SINGLE lgnum FROM t300 WHERE lgnum = p_lgnum`.
  - Displays modal error popup (`POPUP_TO_INFORM`) if invalid.
- **Next Screen:**
  - `START-OF-SELECTION` executes `fetch_open_reservations` and `display_reservation_alv`.
  - Renders an interactive ALV Grid (`cl_salv_table`) listing the candidate reservations.
  - Clicking or double-clicking any row (or the `AVAIL_HU` hotspot) calls `open_transfer_screen`, transitioning to Screen `2000`.

---

### Screen 1000 Worklist Grid (SALV Table)

- **Purpose:** Interactive worklist displaying matching reservation line items, requester contact details, warehouse mapping, and available HU/SU counts.
- **Columns Displayed:**
  - `RSNUM` (Reservation Number - Hotspot)
  - `RSPOS` (Item Number)
  - `STATUS_TXT` (Reservation Status with icons: `@01@ Open`, `@08@ Partially Open`, `@09@ Completed`, `@02@ Deleted`)
  - `BWART` (Movement Type)
  - `USNAM` (Requester User ID)
  - `NAME_TEXT` (Requester Full Name from `ADRP`)
  - `U_PHONE` (Requester Phone / Mobile from `ADCP` / `ADR2`)
  - `U_MAIL` (Requester E-Mail from `ADR6`)
  - `BDTER` (Requirement Date)
  - `MATNR` (Material Code - Hotspot)
  - `MAKTX` (Material Description - Hotspot)
  - `CHARG` (Batch)
  - `BDMNG` (Required Quantity)
  - `ENMNG` (Withdrawn Quantity)
  - `OPEN_QTY` (Calculated Open Balance: `BDMNG - ENMNG`)
  - `MEINS` (Base Unit of Measure)
  - `WERKS` (Plant)
  - `LGORT` (Source Storage Location)
  - `UMLGO` (Receiving / Destination Storage Location)
  - `LGNUM` (Warehouse Code from `T320` / `LQUA`)
  - `AVAIL_HU` (Available Units Count - Hotspot; click opens Storage Bin stock popup)
  - `SUT_IND` (SUT Mode: `'SUT-Enabled'` or `'Standard'`)
  - `LETYP` (Storage Unit Type code from `MLGN` / `LQUA`)
  - `LETYT` (Storage Unit Type Description from `T307T`)
- **Interactions:**
  - Click on `AVAIL_HU`: Launches Storage Bin Stock popup (`show_bin_locations`).
  - Click or double-click on any row: Executes `open_transfer_screen`, passing selected reservation to Screen `2000`.

---

### Screen 2000: Transfer Processing Screen

- **Purpose:** Operational transfer cockpit designed in a Fiori Object Page layout to scan/validate units and post the 311 goods movement.
- **Blocks & Technical Fields:**
  - **Block 1: Selected Reservation Header (Display-Only, `MODIF ID dsp`):**
    - `p_rsnum` (`RESB-RSNUM`): Reservation Number
    - `p_rspos` (`RESB-RSPOS`): Reservation Item
    - `p_bwart` (`RESB-BWART`): Movement Type (e.g. 311)
    - `p_usnam` (`RKPF-USNAM`): Requester User ID
    - `p_unam` (`CHAR40`): Requester Full Name / Details
    - `p_uphon` (`CHAR30`): Mobile Phone
    - `p_umail` (`CHAR45`): E-Mail Address
  - **Block 2: Material & Warehouse Inventory Information (Display-Only, `MODIF ID dsp`):**
    - `p_matnr` (`RESB-MATNR`): Material Code
    - `p_maktx` (`MAKT-MAKTX`): Material Description
    - `p_charg` (`RESB-CHARG`): Batch
    - `p_msut` (`CHAR15`): SUT Indicator / Mode
    - `p_opqty` (`RESB-BDMNG`): Open Balance Quantity
    - `p_meins` (`RESB-MEINS`): Base Unit of Measure
    - `p_frloc` (`RESB-LGORT`): Source Storage Location
    - `p_toloc` (`RESB-UMLGO`): Receiving Storage Location
    - `p_whse` (`LQUA-LGNUM`): Warehouse Code
    - `p_pstg` (`MLGT-LGTYP`): Preferred Storage Type (determined by picking strategy)
    - `p_stk` (`RESB-BDMNG`): Total Available Stock in Warehouse / SLoc
    - `p_hucnt` (`INT4`): Available Units Count
    - Action Buttons in Block 2:
      - `btn_loc` (`USER-COMMAND show_bins`): "View Storage Bins & Units"
      - `btn_vis` (`USER-COMMAND show_visual`): "Visual Rack & Bin View"
  - **Block 3: Scan & Validate Unit (HU / SU & SUT):**
    - `p_exidv` (`VEKP-EXIDV`): **Scan Handling Unit or Storage Unit** (Input Field, supports barcode scanning, ALPHA padded)
    - Pushbutton `btn_vfy` (`USER-COMMAND verify`): "Validate Unit"
    - `p_utyp` (`CHAR20`, Display-Only): Unit Category (`'Handling Unit (HU)'` or `'Storage Unit (SU)'`)
    - `p_sut` (`LVS_LETYP`, Display-Only): Storage Unit Type / Pallet Code
    - `p_sut_tx` (`CHAR12`, Display-Only): SUT Description
    - `p_huser` (`GERNR`, Display-Only): Serial Number in Unit (retrieved from `SER06` + `OBJK`)
    - `p_huqty` (`VEPO-VEMNG`, Display-Only): Available Quantity in Unit
    - `p_hubat` (`VEPO-CHARG`, Display-Only): Batch in Unit
  - **Block 4: Transfer Quantity & Mode:**
    - `p_tqty` (`RESB-BDMNG`): Transfer Quantity (Input field; editable if `p_full = ' '`, disabled if `p_full = 'X'`)
    - `p_full` (`AS CHECKBOX`, default `'X'`): "Transfer Full Unit"
  - **Block 5: Action Toolbar (Footer Bar Style):**
    - Pushbutton `btn_pst` (`USER-COMMAND post`): "Post Transfer"
    - Pushbutton `btn_bak` (`USER-COMMAND back`): "Back to Worklist"
- **PBO Logic (`AT SELECTION-SCREEN OUTPUT`):**
  - Disables input on all fields assigned to `MODIF ID dsp`.
  - Dynamically disables `p_tqty` if checkbox `p_full = 'X'` (auto-fills `p_tqty = p_huqty` or `p_opqty`).
- **PAI Logic (`AT SELECTION-SCREEN`):**
  - `SHOW_BINS`: Calls `show_bin_locations`.
  - `SHOW_VISUAL`: Calls `show_visual_rack_bins`.
  - `VERIFY` / `ENTR`: If `p_exidv` is populated, calls `validate_handling_unit`; if blank and `VERIFY` clicked, calls `f4_handling_unit`.
  - `POST`: Calls `execute_stock_transfer`.
  - `BACK`: Sets `SET SCREEN 0. LEAVE SCREEN.` to return to SALV worklist.

---

### Auxiliary Popup Screens

1. **Storage Bins & Units Popup (`show_bin_locations` -> `display_bin_stock_popup`):**
   - Modal SALV popup window (`set_screen_popup`, rows 3..18, cols 5..135).
   - Lists all quants from `LQUA` and HUs from `VEKP`/`VEPO` with status, bin position, storage type description, storage section name (`T302T-LBERT`), available quantity, batch, and serial numbers.
   - Categorizes stock: Priority 1 = Available in Preferred Storage Type, Priority 2 = Available in other storage types, Priority 3 = In-Process (`9*`, `911`, `902`), Priority 4 = On-Hold (`OH1` or bins with `HOLD`/`BLOCK`).
   - Double-clicking or clicking a row selects the unit into `p_exidv`, validates it, and updates Screen 2000.
2. **Visual Warehouse Rack & Bins Map (`show_visual_rack_bins` -> `display_visual_rack_popup`):**
   - Renders a multi-level visual representation of pallet racks (Ground = Level 0 / B0, Level 1 = B1, Level 2 = B2, up to Level 6).
   - Supports both SALV grid representation and embedded HTML viewer (`CL_GUI_HTML_VIEWER`) with custom CSS rendering visual pallet graphics.
   - Clicking a pallet unit picks that HU/SU into Screen 2000.

---

## 3. Complete User Flow

```text
========================================================================================
START
========================================================================================
  │
  ▼
[1. User opens Transaction ZRF_RES_HU_DNR]
  │  Initial Screen 1000 appears.
  │  Default Plant = 1120. Radiobutton = Open Reservations.
  │  User specifies optional filters (SLoc, Movement Type 311, Requester, Res#, Matnr).
  │  User presses Execute (F8 / ONLI).
  │
  ▼
[2. Screen 1000 Validation]
  │  System validates Plant against T001W and Warehouse against T300.
  │  If invalid: Modal popup displayed (POPUP_TO_INFORM), execution halts.
  │
  ▼
[3. Reservation Query & ALV Worklist]
  │  System queries RESB INNER JOIN RKPF.
  │  Calculates open balance: open_qty = BDMNG - ENMNG.
  │  Enriches requester information (Full name, phone, email) from USR21, ADRP, ADCP, ADR6, ADR2.
  │  Resolves warehouse mapping from T320.
  │  Queries in-stock HUs (VEKP status 0020) and SUs (LQUA) to calculate available unit counts.
  │  Renders interactive ALV grid with visual status icons (@01@ Open, @08@ Partial, @09@ Completed).
  │
  ▼
[4. Reservation Item Selection]
  │  User double-clicks an open reservation row (or clicks the AVAIL_HU hotspot).
  │  System executes open_transfer_screen:
  │    - Copies reservation details into Screen 2000 parameters.
  │    - Executes determine_whse_and_pref_stg (determines picking strategy from MLGN, T334T, MLGT).
  │    - Calculates total available warehouse stock and available units in source SLoc.
  │    - Calls Screen 2000 (CALL SELECTION-SCREEN 2000).
  │
  ▼
[5. Screen 2000: Unit Scan & Identification]
  │  Screen 2000 opens as an Object Page cockpit.
  │  Reservation header and material details are locked (display-only).
  │  User can:
  │    a) Directly scan a barcode for an HU or SU into p_exidv.
  │    b) Press F4 or click "Validate Unit" without input to open the F4 search help.
  │    c) Click "View Storage Bins & Units" to view the bin stock popup and select a row.
  │    d) Click "Visual Rack & Bin View" to inspect the visual rack and pick a pallet.
  │
  ▼
[6. Unit Validation (validate_handling_unit)]
  │  System cleans and ALPHA-converts p_exidv.
  │  Step A: Checks VEKP. If found:
  │    - Rejects if STATUS = '0050' ("HU Already Issued").
  │    - Reads contents from VEPO (material, batch, qty, plant, SLoc).
  │    - Reads serial number from SER06 + OBJK.
  │    - Reads storage type, bin, SUT from LQUA/T307T.
  │  Step B: If not in VEKP, checks LQUA (Storage Unit / SU):
  │    - Reads LENUM, GESME, CHARG, LGTYP, LGPLA, LETYPE.
  │  Step C: Cross-validates against selected reservation:
  │    - Checks source SLoc matches reservation SLoc (if specified).
  │    - Checks material code matches reservation material.
  │    - Checks batch matches reservation batch (if reservation batch is non-empty).
  │  Step D: If p_full = 'X', transfer quantity defaults to MIN(unit_qty, open_res_qty).
  │  Step E: Emits status message (Preferred Storage, On-Hold warning, or In-Process notice).
  │
  ▼
[7. Transfer Execution & Posting]
  │  User reviews transfer quantity p_tqty and clicks "Post Transfer" (btn_pst).
  │  System re-validates: p_exidv populated, unit valid, p_tqty > 0, p_tqty <= unit_qty, p_tqty <= open_qty.
  │  System checks if source SLoc is HU-Managed (T001L-XHUPF = 'X'):
  │
  ├─────────────────────────────────────────────────────────────────┐
  │ PATH A: Source SLoc is HU-Managed (HUM)                         │ PATH B: Non-HUM SLoc or Storage Unit (SU)
  ▼                                                                 ▼
  Calls HU_CREATE_GOODS_MOVEMENT:                                    Calls BAPI_GOODSMVT_CREATE:
    - Event: '0006' (SLoc to SLoc)                                     - GM_CODE: '06' (Goods movement for reservation)
    - External ID: p_exidv                                             - Header: Doc Date, Posting Date, Header Text
    - Movement Type: gs_sel_item-bwart (or '311')                      - Item: Material, Plant, Src SLoc, Dst SLoc,
    - Receiving SLoc: p_toloc                                                  Batch, Qty, Res#, Res Item, NO_MORE_GR flag
    - Commit: 'X'                                                    On Success: Calls BAPI_TRANSACTION_COMMIT
  If MBLNR generated:                                                On Error: Calls BAPI_TRANSACTION_ROLLBACK,
    - Direct SQL: UPDATE resb SET enmng = enmng + p_tqty                       formats error messages from BAPIRET2.
    - If fully issued: UPDATE resb SET kzear = 'X'
    - COMMIT WORK AND WAIT
  └─────────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
[8. Post-Posting Notification & Transfer Slip Generation]
  │  System executes send_requester_notification:
  │    - Queries posted line items from MATDOC (SHKZG = 'H').
  │    - Builds in-memory binary PDF Stock Transfer Slip (build_transfer_pdf)
  │      with company header, operator, reservation details, batch, serials, and signature boxes.
  │    - Generates HTML email body with styled responsive design.
  │    - Creates BCS message (cl_bcs / cl_document_bcs), attaches PDF (Transfer_Slip_<MBLNR>.pdf).
  │    - Dispatches email to Requester (ADR6) with CC to Operator (sy-uname).
  │
  ▼
[9. Return & Worklist Refresh]
  │  Sets gv_posted = abap_true.
  │  Emits success message: "Success! Stock Transfer Posted. Mat. Doc: <MBLNR>/<MJAHR> (Alerts sent to <USNAM>)".
  │  Leaves Screen 2000, returns to Screen 1000 ALV.
  │  SALV table automatically re-fetches open reservations and refreshes grid.
  │
========================================================================================
FINAL RESULT
========================================================================================
```

---

## 4. Backend Logic Trace

| UI Action | Triggered Routine | Backend Objects / Calls | Tables & Structures | Validation / SAP Updates |
|---|---|---|---|---|
| **Screen 1000 Initialization** | `INITIALIZATION` | Local inline logic | `TSTC`, `TSTCT`, `TSTCC`, `TADIR` | Ensures FLP and WebGUI enablement flags are set in `TSTCC`. |
| **Execute Search (F8)** | `AT SELECTION-SCREEN` (Screen 1000) | `lcl_ui_helper=>show_error_popup` | `T001W`, `T300` | Verifies plant existence in `T001W` and warehouse in `T300`. |
| **Fetch Worklist** | `fetch_open_reservations` | Open SQL JOIN | `RESB`, `RKPF`, `USR21`, `ADRP`, `ADCP`, `ADR6`, `ADR2`, `T320`, `VEKP`, `VEPO`, `LQUA` | Queries active 311 reservations, calculates open balances, aggregates in-stock HUs/SUs. |
| **Render ALV** | `display_reservation_alv` | `cl_salv_table=>factory`, `cl_salv_events_table` | `ty_alv_res`, `lvc_t_scol` | Configures columns, hotspots, zebra striping, and click event handlers. |
| **Row Selection** | `open_transfer_screen` | `determine_whse_and_pref_stg`, `CALL SELECTION-SCREEN 2000` | `MLGN`, `T334T`, `MLGT`, `LQUA`, `VEKP`, `VEPO` | Evaluates warehouse picking strategy (Stock Removal A / Placement E) and calculates stock. |
| **F4 Search on Unit** | `f4_handling_unit` | `F4IF_INT_TABLE_VALUE_REQUEST`, `DYNP_VALUES_UPDATE` | `VEKP`, `VEPO`, `LQUA`, `T307T`, `SER06`, `OBJK` | Queries in-stock HUs (status 0020) and SUs; sorts by Preferred Storage Type priority. |
| **Scan / Verify Unit** | `validate_handling_unit` | `CONVERSION_EXIT_ALPHA_INPUT` | `VEKP`, `VEPO`, `LQUA`, `T307T`, `SER06`, `OBJK` | Validates unit status (rejects 0050), material match, batch match, SLoc match. |
| **View Bins Popup** | `show_bin_locations` | `cl_salv_table=>factory` (popup) | `LQUA`, `LAGP`, `T301T`, `T302T`, `T307T`, `SER06`, `OBJK` | Displays modal grid with shelf locations, bin coordinates, stock status, and serials. |
| **Visual Rack View** | `show_visual_rack_bins` | `cl_gui_html_viewer`, `cl_gui_dialogbox_container` | `LAGP`, `LQUA`, `T302T` | Renders graphical multi-level rack view with pallet level mapping. |
| **Post Transfer (HUM SLoc)** | `execute_stock_transfer` (Path 1) | `CALL FUNCTION 'HU_CREATE_GOODS_MOVEMENT'`, Open SQL `UPDATE resb` | `HUM_EXIDV_T`, `HUM_DATA_MOVE_TO_T`, `EMKPF`, `RESB` | Executes event 0006 for 311 movement; updates `RESB-ENMNG` and `RESB-KZEAR`. |
| **Post Transfer (Non-HUM / SU)** | `execute_stock_transfer` (Path 2) | `CALL FUNCTION 'BAPI_GOODSMVT_CREATE'`, `BAPI_TRANSACTION_COMMIT` | `BAPI2017_GM_HEAD_01`, `BAPI2017_GM_CODE`, `BAPI2017_GM_ITEM_CREATE`, `BAPIRET2` | Posts material document via standard GM_CODE 06; executes commit or rollback. |
| **Send Notification** | `send_requester_notification` | `cl_bcs`, `cl_document_bcs`, `cl_bcs_convert`, `BAPI_USER_GET_DETAIL` | `MATDOC`, `ADR6`, `ADR2`, `SO_OBJ_DES`, `SOLI_TAB`, `SOLIX_TAB` | Queries `MATDOC` lines, builds binary PDF transfer slip, transmits responsive HTML email. |

---

## 5. Data Mapping

| Business Field | Technical Field | Source / Target Table | Read / Write | Verification Status |
|---|---|---|---|---|
| **Reservation Number** | `RSNUM` | `RESB-RSNUM`, `RKPF-RSNUM` | Read / Selection | **VERIFIED** |
| **Reservation Item** | `RSPOS` | `RESB-RSPOS` | Read / Selection | **VERIFIED** |
| **Movement Type** | `BWART` | `RESB-BWART`, `RKPF-BWART` | Read (Default: 311) | **VERIFIED** |
| **Requirement Date** | `BDTER` | `RESB-BDTER` | Read | **VERIFIED** |
| **Requester User ID** | `USNAM` | `RKPF-USNAM` | Read | **VERIFIED** |
| **Requester Full Name** | `NAME_TEXT` | `ADRP-NAME_TEXT` (via `USR21-PERSNUMBER`) | Read | **VERIFIED** |
| **Requester Phone** | `U_PHONE` | `ADCP-TEL_EXTENS` / `ADR2-TEL_NUMBER` | Read | **VERIFIED** |
| **Requester E-Mail** | `U_MAIL` | `ADR6-SMTP_ADDR` | Read | **VERIFIED** |
| **Material Code** | `MATNR` | `RESB-MATNR`, `VEPO-MATNR`, `LQUA-MATNR` | Read | **VERIFIED** |
| **Material Description** | `MAKTX` | `MAKT-MAKTX` | Read | **VERIFIED** |
| **Reservation Batch** | `CHARG` | `RESB-CHARG` | Read | **VERIFIED** |
| **Required Quantity** | `BDMNG` | `RESB-BDMNG` | Read | **VERIFIED** |
| **Withdrawn Quantity** | `ENMNG` | `RESB-ENMNG` | Read / Write (`UPDATE`) | **VERIFIED** |
| **Final Issue Indicator** | `KZEAR` | `RESB-KZEAR` | Read / Write (`UPDATE`) | **VERIFIED** |
| **Deletion Indicator** | `XLOEK` | `RESB-XLOEK` | Read | **VERIFIED** |
| **Base Unit of Measure** | `MEINS` | `RESB-MEINS` | Read | **VERIFIED** |
| **Plant** | `WERKS` | `RESB-WERKS`, `T001W-WERKS` | Read | **VERIFIED** |
| **Source Storage Location** | `LGORT` | `RESB-LGORT`, `VEPO-LGORT`, `LQUA-LGORT` | Read | **VERIFIED** |
| **Destination Storage Location** | `UMLGO` | `RESB-UMLGO` | Read | **VERIFIED** |
| **Warehouse Number** | `LGNUM` | `T320-LGNUM`, `LQUA-LGNUM` | Read | **VERIFIED** |
| **Storage Unit Type (SUT)** | `LETYP` | `MLGN-LETYP`, `LQUA-LETYP` | Read | **VERIFIED** |
| **SUT Description** | `LETYT` | `T307T-LETYT` | Read | **VERIFIED** |
| **Stock Removal Strategy** | `LTKZA` | `MLGN-LTKZA`, `T334T-LGTKZ` (`KZEAR='A'`) | Read | **VERIFIED** |
| **Stock Placement Strategy** | `LTKZE` | `MLGN-LTKZE`, `T334T-LGTKZ` (`KZEAR='E'`) | Read | **VERIFIED** |
| **Preferred Storage Type** | `LGTYP` | `T334T-LGTY0..LGTY5`, `MLGT-LGTYP` | Read | **VERIFIED** |
| **Storage Bin** | `LGPLA` | `LQUA-LGPLA`, `LAGP-LGPLA` | Read | **VERIFIED** |
| **Storage Section** | `LGBER` | `LAGP-LGBER`, `T302T-LBERT` | Read | **VERIFIED** |
| **Handling Unit External ID** | `EXIDV` | `VEKP-EXIDV` | Read / Scan Input | **VERIFIED** |
| **HU Internal Number** | `VENUM` | `VEKP-VENUM`, `VEPO-VENUM` | Read | **VERIFIED** |
| **HU Process Status** | `STATUS` | `VEKP-STATUS` (0020=In-stock, 0050=GI) | Read / Validated | **VERIFIED** |
| **HU Serial Number** | `SERNR` | `SER06-EXIDV` -> `OBJK-SERNR` | Read | **VERIFIED** |
| **Storage Unit Number (SU)** | `LENUM` | `LQUA-LENUM` | Read / Scan Input | **VERIFIED** |
| **Transfer Quantity** | `P_TQTY` | Input Parameter -> `BAPI2017_GM_ITEM_CREATE-ENTRY_QNT` | Input / Write | **VERIFIED** |
| **Full Unit Flag** | `P_FULL` | UI Checkbox | Input | **VERIFIED** |
| **HUM Location Flag** | `XHUPF` | `T001L-XHUPF` | Read | **VERIFIED** |
| **Material Document Number** | `MBLNR` | `EMKPF-MBLNR` / `BAPI2017_GM_HEAD_RET-MAT_DOC` | Generated / Written | **VERIFIED** |
| **Material Document Year** | `MJAHR` | `EMKPF-MJAHR` / `BAPI2017_GM_HEAD_RET-DOC_YEAR` | Generated / Written | **VERIFIED** |

---

## 6. Messages

All messages captured directly from the ABAP program source:

| Message Text / Pattern | Class | Number / Type | Trigger Condition | Verification Status |
|---|---|---|---|---|
| `Plant "{ p_plnt }" was not found in table T001W.` | Local UI | Error Dialog | Invalid Plant code entered on Screen 1000 | **VERIFIED** |
| `Warehouse Number "{ p_lgnum }" was not found in table T300.` | Local UI | Error Dialog | Invalid Warehouse code entered on Screen 1000 | **VERIFIED** |
| `No reservations found in database matching your filter criteria...` | Local UI | Error Dialog | `RESB/RKPF` query returned zero rows | **VERIFIED** |
| `Found { lv_cnt_raw } reservation(s), but ALL are marked as DELETED (XLOEK = 'X').` | Local UI | Error Dialog | All matching reservations have deletion indicator set | **VERIFIED** |
| `Found { lv_cnt_active } reservation(s), but all are COMPLETED (open qty <= 0 or KZEAR='X').` | Local UI | Error Dialog | Open filter chosen but all reservations are fulfilled | **VERIFIED** |
| `Please select a Reservation item first` | Local UI | `S` (Display `E`) | User triggered F4 without active reservation context | **VERIFIED** |
| `Please scan or select a Unit (HU / SU) before posting.` | Local UI | Error Dialog | User clicked "Post Transfer" with empty `p_exidv` | **VERIFIED** |
| `Handling Unit { p_exidv } is already Goods Issued (Status 0050).` | Local UI | Error Dialog | Scanned HU has status `0050` in `VEKP` | **VERIFIED** |
| `No material items or contents found in Handling Unit { p_exidv }.` | Local UI | Error Dialog | Scanned HU has no records in `VEPO` | **VERIFIED** |
| `Scanned unit "{ p_exidv }" does not exist in VEKP (HU) or LQUA (Storage Unit).` | Local UI | Error Dialog | Unit number exists in neither `VEKP` nor `LQUA` | **VERIFIED** |
| `{ gv_unit_type } { p_exidv } is located in SLoc { gv_hu_lgort }, but Reservation requires Source SLoc { gs_sel_item-lgort }.` | Local UI | Error Dialog | Scanned unit's storage location does not match reservation source SLoc | **VERIFIED** |
| `{ gv_unit_type } Material ({ gv_hu_matnr }) does not match Reservation ({ gs_sel_item-matnr }).` | Local UI | Error Dialog | Scanned unit's material does not match reservation requirement | **VERIFIED** |
| `{ gv_unit_type } Batch ({ gv_hu_charg }) does not match Reservation Batch ({ gs_sel_item-charg }).` | Local UI | Error Dialog | Reservation requires specific batch, but unit contains different batch | **VERIFIED** |
| `Please specify a valid Transfer Quantity greater than 0.` | Local UI | Error Dialog | User specified `p_tqty <= 0` | **VERIFIED** |
| `Transfer Qty ({ p_tqty }) exceeds available { gv_unit_type } Qty ({ p_huqty }).` | Local UI | Error Dialog | Transfer quantity exceeds stock inside the unit | **VERIFIED** |
| `Transfer Qty ({ p_tqty }) exceeds Reservation Open Qty ({ p_opqty }).` | Local UI | Error Dialog | Transfer quantity exceeds open reservation balance | **VERIFIED** |
| `Warning: Scanned { gv_unit_type } { p_exidv } is ON-HOLD in Storage Type { lv_vfy_lgtyp } (Bin { lv_vfy_lgpla })!` | Local UI | Warning (`W`) | Scanned unit is located in storage type `OH1` or a HOLD/BLOCK bin | **VERIFIED** |
| `Notice: Scanned { gv_unit_type } { p_exidv } is IN-PROCESS in Storage Type { lv_vfy_lgtyp }` | Local UI | Info (`I`) | Scanned unit is located in interim/staging storage types (`9*`, `911`, `902`) | **VERIFIED** |
| `Stock transfer could not be posted in SAP (BAPI): { lv_err_txt }` | Local UI | Error Dialog | Goods movement FM / BAPI rejected posting | **VERIFIED** |
| `Success! Stock Transfer Posted. Mat. Doc: { lv_posted_doc } / { lv_posted_yr } (Alerts sent to { p_usnam })` | Local UI | Success (`S`) | Material document successfully generated and committed | **VERIFIED** |

---

## 7. Fiori Integration Candidates

### Existing Capabilities in Repository That Can Be Reused

1. **Handling Unit Query & Verification:**
   - `HandlingUnitAdapter.js` (`srv/integration/s4hana/wm/HandlingUnitAdapter.js`):
     - Already queries `C_HANDLINGUNITMONITOR_CDS` and `VEKP`/`VEPO`.
     - Already resolves serial numbers via `SER06` -> `OBJK`.
     - Already proven live in Client 220.
2. **Reservation Query & 311 Goods Movement Posting:**
   - `ReservationProcessAdapter.js` (`srv/integration/s4hana/wm/ReservationProcessAdapter.js`):
     - Already implements `RFC_READ_TABLE` on `RESB` and `RKPF`.
     - Already implements movement 311 posting logic via `BAPI_GOODSMVT_CREATE` with GM_CODE `'06'` and reservation reference.
     - Already implements reservation locking (`resLock.js`) and idempotency stores (`GoodsIssueAttemptStore.js`).
3. **Storage Unit / Quant Management:**
   - `TrToAdapter.js` and `warehouseResolver.js`:
     - Already implement `T320` plant/SLoc to warehouse resolution.
     - Implements `LQUA` quant queries and storage type mapping.

### Logic That Must Remain Backend-Controlled (CAP / S/4HANA)

- **HUM vs Non-HUM Branching:** The check on `T001L-XHUPF` must run on the backend to determine whether to execute `HU_CREATE_GOODS_MOVEMENT` or `BAPI_GOODSMVT_CREATE`.
- **Atomic Commits and Reservation Balance Updating:** When using `HU_CREATE_GOODS_MOVEMENT`, the subsequent update to `RESB-ENMNG` and `RESB-KZEAR` must happen within a controlled transaction scope.
- **Stock Priority & Strategy Resolution:** Resolving picking strategies from `MLGN` (`LTKZA`), `T334T`, `MLGT`, and `LQUA` must occur server-side.
- **Requester Alerts & PDF Generation:** Generation of the transfer slip PDF and email dispatch via `cl_bcs` or CAP email service must be orchestrated by the backend.

### Data That Fiori UI Needs

- **Worklist View (Master):** List of open 311 reservations with Plant, SLoc, Destination SLoc, Material, Description, Batch, Required Qty, Open Qty, Available HU Count, Requester Name, and Requirement Date.
- **Transfer Detail View (Object Page):**
  - Header: Reservation Number/Item, Movement Type (311), Requester Details (Name, Phone, Email).
  - Material & Warehouse Info: Material, Description, Batch, SLoc, Target SLoc, Warehouse, Preferred Storage Type, Available Stock.
  - Scan Section: Input for scanning barcode (HU or SU) with auto-verification and haptic/audio feedback.
  - Unit Info Card: Display unit type (HU/SU), SUT code & description, serial number, batch, available quantity, and storage bin.
  - Transfer Qty Input: Number input with "Transfer Full Unit" toggle switch.
  - Bin / Rack Inspector Dialog: Modal drawer or dialog displaying storage bins and pallet positions.
  - Action Bar: "Validate Unit", "Post Transfer", "Cancel".

### Missing Service / API That May Be Required

- While read operations can leverage existing CAP endpoints or CDS models, a **dedicated CAP Service** (`ZrfResHuTransferService` or extension to `ReservationProcessService` / `GoodsIssueService`) exposing:
  - `getOpenReservations(plant, sloc, movementType)`
  - `getAvailableUnitsForReservation(rsnum, rspos)`
  - `getBinLocations(material, plant, warehouse, sloc)`
  - Action `postHuStockTransfer(rsnum, rspos, exidv, quantity, isFullUnit)`
- Backend wrapper or adapter method for `HU_CREATE_GOODS_MOVEMENT` in cases where the source SLoc is HU-managed (`T001L-XHUPF = 'X'`).

---

## 8. Unknowns & Verification Classification

### VERIFIED (Direct Live Evidence from SAP Client 220)

- Transaction code `ZRF_RES_HU_DNR` exists in `TSTC` and points to program `ZRF_RES_HU_TRANSFER_DNR` with dynpro `1000`.
- Program `ZRF_RES_HU_TRANSFER_DNR` is an active Executable Program (`SUBC = 1`) in package `ZAMM`, authored by `DIPAK` (`2026-10-16`, updated `2026-10-22`).
- All 6,671 lines of ABAP source code have been retrieved verbatim via ADT REST API and saved to [`docs/abap/zrf_res_hu_transfer_dnr.abap`](file:///Users/khushaldhanani/Desktop/SAPS4HANAFULLSTACK0/docs/abap/zrf_res_hu_transfer_dnr.abap).
- Complete field list, labels, validations, and user commands for Screen `1000` and Screen `2000`.
- All database queries against `RESB`, `RKPF`, `USR21`, `ADRP`, `ADCP`, `ADR6`, `ADR2`, `T320`, `T001W`, `T300`, `T001L`, `MLGN`, `T334T`, `MLGT`, `LQUA`, `LAGP`, `T301T`, `T302T`, `T307T`, `VEKP`, `VEPO`, `SER06`, `OBJK`, `MATDOC`.
- Both posting paths: `HU_CREATE_GOODS_MOVEMENT` (HUM locations) and `BAPI_GOODSMVT_CREATE` with GM_CODE `'06'` (Non-HUM / SU locations).
- BCS email notification logic and in-memory PDF generation stream.

### FOUND IN CODE (Observed in ABAP Source)

- Test email recipients hardcoded in lines 155-159 (`gv_test_notify = abap_true`, CC to `naresh@aether.co.in`, `Dipak@aether.co.in`, users `DRATHOD`, `NARESH`).
- Fallback default material hardcoded in line 1921 (`000000008000009754`, Plant `1120`, SLoc `CS02`, Unit `NOS`).
- Storage type priority logic: `EN1` as preferred/available, `OH1` or bin containing `HOLD`/`BLOCK` as On-Hold (Priority 4), `9*`/`911`/`902` as In-Process (Priority 3).

### NOT VERIFIED / NEEDS SAP GUI VALIDATION

- Exact runtime appearance of the embedded HTML visual rack viewer on different RF terminal hardware (handled via `CL_GUI_HTML_VIEWER` in SAP GUI).
- Whether live production storage locations used by Aether Industries (e.g. `CS01`, `CS02`, `HS01`, `HU01`) currently have `T001L-XHUPF = 'X'` (HU-managed) or `' '` (standard SLoc). *Recommendation: Perform a read-only query on `T001L` for target storage locations during Step 2.*
- Whether SAP spool / printer output is triggered in addition to the BCS email transmission.

---

## 9. VERIFIED WORKFLOW

A concise, evidence-proven 6-step business workflow:

1. **Worklist Ingestion:** The operator loads `ZRF_RES_HU_DNR` on an RF terminal or desktop; the system displays open reservation items (Movement 311) for Plant `1120` from `RESB`/`RKPF` with requester contact details and available unit counts.
2. **Context Selection:** The operator selects a reservation line; the system resolves the warehouse number, calculates available stock, and determines the preferred storage type using picking strategies from `MLGN`/`T334T`.
3. **Unit Identification & Scanning:** The operator scans or selects an HU or Storage Unit (SU); the system checks `VEKP`/`VEPO` (for HUs) or `LQUA` (for SUs), verifies serial numbers (`SER06`/`OBJK`), validates material, batch, and source storage location consistency, and issues warnings if the stock is On-Hold or In-Process.
4. **Quantity Confirmation:** The operator confirms the transfer quantity (defaulting to the full unit quantity or remaining open reservation balance).
5. **Goods Movement Execution:** The backend checks `T001L-XHUPF` and executes the appropriate posting path: `HU_CREATE_GOODS_MOVEMENT` (Event 0006) for HU-managed locations with direct reservation balance updates, or `BAPI_GOODSMVT_CREATE` (GM_CODE 06) for standard locations.
6. **Confirmation & Dispatch:** A SAP material document is generated, the reservation balance is updated, an official PDF stock transfer slip is generated, and an automated HTML confirmation email is dispatched via BCS to the requester.

---

## 10. FIORI CONVERSION BOUNDARY

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT SAP GUI / RF TERMINAL                         │
│   Selection Screen 1000  ──►  SALV Reservation Grid  ──►  Screen 2000 Cockpit │
│   (Filter Criteria)           (Open 311 Worklist)         (Scan HU, Bin Popup) │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                     ZRF_RES_HU_DNR BUSINESS LOGIC (ABAP)                       │
│  - Storage Location Warehouse & Strategy Determination (T320, MLGN, T334T)     │
│  - Dual Unit Validation: Handling Units (VEKP/VEPO) & Storage Units (LQUA)     │
│  - Serial Number Mapping (SER06 -> OBJK) & SUT Mapping (T307T)                 │
│  - Dual Posting Engine: HU_CREATE_GOODS_MOVEMENT (HUM) / BAPI_GOODSMVT_CREATE  │
│  - Reservation Balance Updating (RESB-ENMNG / RESB-KZEAR)                      │
│  - Transfer Slip PDF Generation & BCS Email Dispatch (cl_bcs)                  │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                       EXISTING / REQUIRED API BOUNDARY                         │
│  CAP Node.js Layer (`srv/` & `srv/integration/s4hana/`):                       │
│  - ReservationProcessAdapter: RESB/RKPF reads & BAPI_GOODSMVT_CREATE (Proven)   │
│  - HandlingUnitAdapter: VEKP/VEPO reads & SER06 serial resolution (Proven)     │
│  - NEW Action / Endpoint: `executeHuStockTransfer` (encapsulating dual posting)│
│  - Idempotency guard: `GoodsIssueAttemptStore`                                 │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                             CUSTOM FIORI APPLICATION                           │
│  SAPUI5 Freestyle / Fiori Elements (`app/fiori-app/`):                         │
│  - Worklist View: Master list of open reservations with search & filter bar     │
│  - Detail / Execution View: Touch-optimized RF scan interface                  │
│    * Camera/Hardware barcode scanner integration (p_exidv)                     │
│    * Immediate client-side audio/visual validation feedback                    │
│    * Storage Bins & Shelves inspector dialog                                   │
│    * One-tap "Transfer Full Unit" & "Post Transfer" execution                  │
│    * Success notification with Material Document reference                     │
└────────────────────────────────────────────────────────────────────────────────┘
```
