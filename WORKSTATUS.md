
# Changes Log

> **Historical changes**: entries from 2026-09-16 11:30 IST to 2026-09-19 18:12 IST are in [logs/2026-09-16-to-19-archive.md](logs/2026-09-16-to-19-archive.md); entries prior to 2026-09-16 12:00 IST are in [logs/2026-09-archive.md](logs/2026-09-archive.md). Nothing was deleted.

## 2026-09-21 09:40 IST
- **Agent**: Antigravity
- **Change**: Phase 2 Outbound Delivery Screen & Integration:
  1. **New Module `modules/le/outbound-delivery/`**:
     - `OrdersDueForDelivery.view.xml`: Worklist view displaying live orders due for delivery with columns Sales Order, Item/Line, Ship-to Party, Shipping Point, Goods Issue Date, Delivery Block, and an action button "Create Delivery" per row. Features header KPIs, table toolbar search field, and refresh button.
     - `OrdersDueForDelivery.controller.js`: Handles routing (`ordersDueForDelivery`), search/filtering, KPI calculation, shipping points retrieval, dialog launching, delivery creation action execution, and table refresh.
     - `CreateDeliveryDialog.fragment.xml`: Confirmation dialog prompting confirmation of Sales Order (read-only), Shipping Point (ComboBox with available shipping points `1120`, `1112`, `1108`, `1109`), and Delivery Date (DatePicker defaulting to today). Shows `"Delivery {0} created"` on success, or SAP's exact error message on failure.
     - `OutboundDeliveryService.js`: Centralized frontend service implementing `setModel`/`getModel`, `getOrdersDueForDelivery`, `getShippingPoints`, `getDefaultShippingPoint`, and `createOutboundDelivery`.
  2. **Sales Order Screen Integration**:
     - `SalesOrders.view.xml`: Added Action column with "Create Delivery" button on each sales order row.
     - `SalesOrders.controller.js`: Implemented `onCreateDeliveryPress` to extract the sales order number and trigger the delivery confirmation dialog and creation flow.
  3. **Shell & Navigation Wiring**:
     - `manifest.json`: Declared `outboundDeliveryService` dataSource (`/odata/v4/outbound-delivery/`), `outboundDelivery` OData V4 model, route `ordersDueForDelivery` (pattern `le/orders-due`), and target `TargetOrdersDueForDelivery`.
     - `Component.js`: Imported `OutboundDeliveryService` and wired `outboundDelivery` model during component initialization.
     - `Dashboard.view.xml` & `Dashboard.controller.js`: Added "Orders Due for Delivery" tile under Overview, Sales & Distribution (`tabSD`), and Warehouse / Logistics (`tabEWM`) with navigation handler `onNavigateToOrdersDueForDelivery`.
     - `App.controller.js`: Added shell route mapping and header title ("Orders Due for Delivery") with backward navigation support.
  4. **Internationalization (i18n)**:
     - Added 30 semantic keys to `i18n.properties` and `i18n_en.properties`.
     - Verified exact 100% key-for-key parity (`diff -u` 0 differences).
  5. **Preload Bundle Rebuild**:
     - Built `Component-preload.js` via `cd app/fiori-app && npm run build` (1.3 s).
  6. **Automated Unit Tests**:
     - Created `test/unit/le/outboundDeliveryService.test.js` (8 tests).
     - Created `test/unit/le/ordersDueForDeliveryController.test.js` (8 tests).
     - Added Create Delivery tests in `test/unit/sales-order/salesOrdersController.test.js` (8 tests).
- **Files Created/Modified**:
  - `app/fiori-app/webapp/modules/le/outbound-delivery/service/OutboundDeliveryService.js` [NEW]
  - `app/fiori-app/webapp/modules/le/outbound-delivery/view/OrdersDueForDelivery.view.xml` [NEW]
  - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js` [NEW]
  - `app/fiori-app/webapp/modules/le/outbound-delivery/view/CreateDeliveryDialog.fragment.xml` [NEW]
  - `app/fiori-app/webapp/modules/sd/sales-order/view/SalesOrders.view.xml`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`
  - `app/fiori-app/webapp/manifest.json`
  - `app/fiori-app/webapp/Component.js`
  - `app/fiori-app/webapp/view/Dashboard.view.xml`
  - `app/fiori-app/webapp/controller/Dashboard.controller.js`
  - `app/fiori-app/webapp/controller/App.controller.js`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/le/outboundDeliveryService.test.js` [NEW]
  - `test/unit/le/ordersDueForDeliveryController.test.js` [NEW]
  - `test/unit/sales-order/salesOrdersController.test.js`
- **Executed Commands and Results**:
  - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total test suites; 79 passed, 79 total tests (100% green).
  - `npx jest test/unit/le/`: 4 passed, 4 total test suites; 36 passed, 36 total tests (100% green).
  - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `cd app/fiori-app && npm run build`: Build succeeded in 1.3 s; `Component-preload.js` generated cleanly.
  - `npx cds compile srv > /dev/null`: Succeeded with code 0.
  - `npm run lint`: Succeeded with code 0 (0 errors, 16 pre-existing warnings in unrelated modules).
  - `diff -u app/fiori-app/webapp/i18n/i18n.properties app/fiori-app/webapp/i18n/i18n_en.properties`: Clean (0 differences).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user, test in browser runtime, and commit Phase 2 delivery screen to `feature/CL01`.

## 2026-09-21 09:45 IST
- **Agent**: Antigravity
- **Change**: Outbound Delivery Adapter Paging Fix — deleted $top/$skip handling from the CAP-request branch in `OutboundDeliveryAdapter.js`:
  - **Root Cause**: CAP OData V4 passes pagination limits as `{ rows: { val: 50 }, offset: { val: 0 } }`. The adapter was running `Number(...)` on the inner object, yielding `NaN`, which caused `$top` and `$skip` to never be appended to the SAP Gateway URL. The adapter returned all due lines and `applyPaging(orders, req)` sliced them afterwards. If `$top`/`$skip` were ever passed to SAP, both SAP and `applyPaging` would skip rows, resulting in page 2 returning empty.
  - **Fix**: Initialized `top = null; skip = null;` by default. Removed the `$top`/`$skip` extraction block from the CAP-request branch (`query.req || query.query || query.data`) so that all matching due orders are fetched from SAP and client/UI pagination is handled cleanly by `applyPaging(orders, req)` without double-skipping.
  - **Automated Tests**: Added test in `test/unit/le/outboundDeliveryAdapter.test.js` verifying that CAP requests do not send `$top` or `$skip` to S/4HANA Gateway.
- **Files Modified**:
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
  - `test/unit/le/outboundDeliveryAdapter.test.js`
- **Executed Commands and Results**:
  - `npx jest test/unit/le/`: 4 passed, 4 total test suites; 37 passed, 37 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user and commit fix to `feature/CL01`.

## 2026-09-21 09:55 IST
- **Agent**: Antigravity
- **Change**: Outbound Delivery Role Alignment, Delivery Block Visibility, and In-Approval Guarding:
  1. **Role Alignment**:
     - Added `'SalesRepresentative'` to `@(requires: ['SalesRepresentative', 'WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin']) action createOutboundDelivery` in `srv/le/outbound-delivery/service.cds`.
     - Added `hasAnyRole(aRoles)` and `canCreateDelivery()` helper methods to `AuthService.js`.
     - Added `visible="{= ${salesOrdersView>/canCreateDelivery} !== false }"` to `btnSalesOrderCreateDelivery` on the Sales Orders screen.
     - Added `visible="{= ${ordersDueView>/canCreateDelivery} !== false }"` to the Create Delivery row button on the Orders Due for Delivery screen.
  2. **Delivery Block Visibility & Disabled Button**:
     - Removed `DelivBlockReasonForSchedLine eq ''` filter from `OutboundDeliveryAdapter.js` so orders with delivery blocks are visible in the worklist instead of being silently hidden.
     - In `OrdersDueForDelivery.view.xml`, displayed `DelivBlockReasonForSchedLine` in the Delivery Block column with Error state when present.
     - Disabled the Create Delivery button when `DelivBlockReasonForSchedLine` is set, with tooltip informing the user that the order has a delivery block.
     - In `OrdersDueForDelivery.controller.js`, added defensive validation in `onCreateDeliveryPress` warning that the order has a delivery block.
  3. **In-Approval Order Handling**:
     - Enriched `getOrdersDueForDelivery` in `OutboundDeliveryAdapter.js` by looking up unapproved orders from `SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873` (`SalesDocApprovalStatus eq 'A' or SalesDocApprovalStatus eq 'C'`) and mapping `SalesDocApprovalStatus`.
     - Added `SalesDocApprovalStatus: String(1);` to entity `OrdersDueForDelivery` in `srv/le/outbound-delivery/service.cds`.
     - Added `DeliveryBlockReason` to entity `SalesOrders` projection in `srv/sd/sales-order/service.cds`.
     - Added "Approval Status" column to `OrdersDueForDelivery.view.xml` showing "In Approval" (Warning), "Rejected" (Error), or "Approved" (Success).
     - Disabled the Create Delivery button on both `OrdersDueForDelivery.view.xml` and `SalesOrders.view.xml` when `SalesDocApprovalStatus === 'A'` or `SalesDocApprovalStatus === 'C'`, with tooltip informing the user that the order is in approval.
     - In `SalesOrders.controller.js` and `OrdersDueForDelivery.controller.js`, added defensive validation in `onCreateDeliveryPress` warning that the order is currently in approval.
     - Added i18n keys for tooltips and warning messages to `i18n.properties` and `i18n_en.properties` with 100% parity.
  4. **Preload Rebuild & Automated Tests**:
     - Rebuilt `Component-preload.js` via `cd app/fiori-app && npm run build`.
     - Updated unit tests in `test/unit/le/outboundDeliveryAdapter.test.js` to verify delivery block retention and approval status enrichment.
- **Files Modified**:
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
  - `srv/le/outbound-delivery/service.cds`
  - `srv/sd/sales-order/service.cds`
  - `app/fiori-app/webapp/service/AuthService.js`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/view/OrdersDueForDelivery.view.xml`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/view/SalesOrders.view.xml`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/le/outboundDeliveryAdapter.test.js`
- **Executed Commands and Results**:
  - `npx cds compile srv > /dev/null`: Succeeded with code 0.
  - `cd app/fiori-app && npm run build`: Build succeeded in 795 ms (`Component-preload.js` updated).
  - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `diff -u app/fiori-app/webapp/i18n/i18n.properties app/fiori-app/webapp/i18n/i18n_en.properties`: Clean (0 differences).
  - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total test suites; 82 passed, 82 total tests (100% green).
  - `npx jest test/unit/auth/`: 3 passed, 3 total test suites; 34 passed, 34 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user and commit to `feature/CL01`.

## 2026-09-21 10:05 IST
- **Agent**: Antigravity
- **Change**: Prevent Misleading Success Message When SAP Returns No Delivery Number:
  - **Issue**: If SAP returns HTTP 201 Created but does not return an `OutboundDelivery` number in the response body, `outboundDelivery.handler.js` was returning the fallback text `'Delivery created'`. In the UI, `sDeliveryNo` was interpolated into `Delivery {0} created`, resulting in `"Delivery Delivery created created"`, misleading the user into thinking "Delivery created" was a valid document number.
  - **Handler Fix**: In `srv/le/outbound-delivery/handlers/outboundDelivery.handler.js`, changed `return result.OutboundDelivery || 'Delivery created'` to `return result.OutboundDelivery || ''` so that no fake or placeholder document number is returned.
  - **UI Warning & VL03N Guidance**:
    - In `OrdersDueForDelivery.controller.js` and `SalesOrders.controller.js`, updated `onConfirmCreateDelivery` callback: if `sDeliveryNo` is empty or equals `'Delivery created'`, the system displays `MessageBox.warning` with message `msgDeliveryCreatedNoNumberWarning`:
      `"Delivery created in SAP S/4HANA for Sales Order {0}, but no delivery number was returned. Please check transaction VL03N."`
    - If a valid delivery document number is returned, it continues to show `MessageBox.success` with `"Delivery {0} created"`.
  - **i18n**: Added `msgDeliveryCreatedNoNumberWarning` to both `i18n.properties` and `i18n_en.properties` with 100% key parity.
  - **Preload & Tests**:
    - Rebuilt `Component-preload.js` via `cd app/fiori-app && npm run build`.
    - Added unit test in `test/unit/le/ordersDueForDeliveryController.test.js` verifying that `MockMessageBox.warning` is shown with VL03N instructions when no delivery number is returned.
    - Added unit test in `test/unit/sales-order/salesOrdersController.test.js` verifying the same warning and VL03N instruction behavior.
- **Files Modified**:
  - `srv/le/outbound-delivery/handlers/outboundDelivery.handler.js`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/le/ordersDueForDeliveryController.test.js`
  - `test/unit/sales-order/salesOrdersController.test.js`
- **Executed Commands and Results**:
  - `npx cds compile srv > /dev/null`: Succeeded with code 0.
  - `cd app/fiori-app && npm run build`: Build succeeded in 989 ms (`Component-preload.js` updated).
  - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `diff -u app/fiori-app/webapp/i18n/i18n.properties app/fiori-app/webapp/i18n/i18n_en.properties`: Clean (0 differences).
  - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total test suites; 85 passed, 85 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
## 2026-09-21 10:10 IST
- **Agent**: Antigravity
- **Change**: Live S/4HANA Verification of `SalesDocApprovalStatus` 'C' and 'D' Meanings & UI/Adapter Enforcement:
  - **Live S/4HANA Gateway Discovery**:
    - Queried `SD_F1873_SO_WL_SRV/I_SalesDocApprovalStatus` value help directly from SAP Gateway to establish the canonical SAP definition of all approval status codes:
      - `''` : `"Not Relevant"` (standard sales orders created without flexible workflow approval)
      - `'A'` : `"In Approval"` (order currently pending workflow approval)
      - `'B'` : `"Released"` (order workflow approved and released for execution)
      - `'C'` : `"Rejected"` (order workflow approval rejected)
      - `'D'` : `"To Be Reworked"` (order returned to creator for rework)
    - Queried live orders in `SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873?$filter=SalesDocApprovalStatus eq 'C'`:
      - Discovered 5 live orders (`5000013`, `5000015`, `5000349`, `5000353`, `5000354`).
      - All 5 orders have `SalesDocApprovalStatus = 'C'`, `OverallSDProcessStatus = 'C'` (Completed), and `OverallSDDocumentRejectionSts = 'C'` (Completely Rejected).
    - Tested live delivery creation against rejected order `5000013` via `POST /sap/opu/odata/sap/LE_SHP_QC_DLVREF_SRV/C_DelivWthRefQuickCreate`:
      - SAP rejected the request with HTTP 400: `{"lang":"en","value":"No schedule lines due for delivery up to the selected date"}`.
      - Confirmed why: when an order is Rejected ('C'), SAP closes/cancels its schedule lines, so it is never eligible for outbound delivery.
      - Confirmed in `C_SalesOrderDueForDeliveryVH`: order `5000013` does NOT appear because its schedule lines are closed/rejected.
  - **Adapter Filter Update**:
    - In `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`, updated `_fetchApprovalStatusMap` filter from `(SalesDocApprovalStatus eq 'A' or SalesDocApprovalStatus eq 'C')` to `(SalesDocApprovalStatus ne '' and SalesDocApprovalStatus ne 'B')`. This dynamically captures any non-released status ('A', 'C', 'D') from SAP.
  - **UI Views & Controllers**:
    - In `OrdersDueForDelivery.view.xml`:
      - Refined ObjectStatus badge: `'A'` -> `statusInApproval` (Warning), `'C'` -> `Rejected` (Error), `'D'` -> `To Be Reworked` (Warning), `'B'` -> `Released` (Success), other -> `Not Relevant` (None).
      - Set `enabled`: `{= !${outboundDelivery>DelivBlockReasonForSchedLine} && (${outboundDelivery>SalesDocApprovalStatus} === 'B' || !${outboundDelivery>SalesDocApprovalStatus}) }`.
      - Dynamic tooltip: distinguishes delivery block (`tooltipOrderDeliveryBlocked`), in approval (`tooltipOrderInApproval`), rejected (`tooltipOrderRejected`), rework (`tooltipOrderRework`), and default (`tooltipCreateDelivery`).
    - In `SalesOrders.view.xml`:
      - Set `enabled`: `{= (${salesOrder>SalesDocApprovalStatus} === 'B' || !${salesOrder>SalesDocApprovalStatus}) && !${salesOrder>DeliveryBlockReason} }`.
      - Dynamic tooltip: handles delivery block, in approval, rejected, rework, and default.
    - In `OrdersDueForDelivery.controller.js` and `SalesOrders.controller.js`:
      - Added explicit controller guards for `sApprovalStatus === 'C'` (warning: `msgOrderRejected`) and `sApprovalStatus === 'D'` (warning: `msgOrderRework`).
  - **i18n**: Added `msgOrderRejected`, `msgOrderRework`, `tooltipOrderRejected`, `tooltipOrderRework` to both `i18n.properties` and `i18n_en.properties` with 100% key parity (0 diffs).
  - **Unit Tests & Preload**:
    - Added unit test cases for status 'A', 'C', 'D' and delivery blocks in `test/unit/le/ordersDueForDeliveryController.test.js` and `test/unit/sales-order/salesOrdersController.test.js`.
    - Built `Component-preload.js` cleanly via `cd app/fiori-app && npm run build`.
- **Files Modified**:
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/view/OrdersDueForDelivery.view.xml`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/view/SalesOrders.view.xml`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/le/ordersDueForDeliveryController.test.js`
  - `test/unit/sales-order/salesOrdersController.test.js`
- **Executed Commands and Results**:
  - `cd app/fiori-app && npm run build`: Build succeeded in 1.2 s (`Component-preload.js` generated cleanly).
  - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `diff -u app/fiori-app/webapp/i18n/i18n.properties app/fiori-app/webapp/i18n/i18n_en.properties`: Clean (0 differences).
  - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total test suites; 93 passed, 93 total tests (100% green).
  - `npm test`: 68 passed, 68 total test suites; 831 passed, 831 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user and commit to `feature/CL01`.

## 2026-09-21 10:12 IST
- **Agent**: Antigravity
- **Change**: In-Memory 60-Second TTL Caching for Approval Status Lookup in OutboundDeliveryAdapter:
  - **Performance Optimization**: Added in-memory TTL caching (`cacheTtlMs: 60000`) for `_fetchApprovalStatusMap` on the `OutboundDeliveryAdapter` singleton.
  - **Behavior**:
    - When `getOrdersDueForDelivery` is called on initial worklist load, it fetches the non-released approval status map from SAP Gateway and stores it in `_approvalCache = { timestamp, map }`.
    - On successive reads within 60 seconds (table pagination, shipping point filtering, search), the cached map is reused immediately, eliminating the redundant SAP Gateway HTTP request.
    - If `options.forceRefresh` is specified or after 60 seconds expire, the adapter automatically refreshes the map from SAP Gateway.
    - If a transient network error occurs while refreshing, the adapter falls back gracefully to the existing cached map if available.
  - **Unit Test Coverage**:
    - Added test in `test/unit/le/outboundDeliveryAdapter.test.js` verifying that successive reads within 60 seconds make only 1 SAP call (for due orders) instead of 2, and that `forceRefresh: true` triggers a fresh SAP Gateway read.
- **Files Modified**:
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
  - `test/unit/le/outboundDeliveryAdapter.test.js`
- **Executed Commands and Results**:
  - `npx jest test/unit/le/outboundDeliveryAdapter.test.js`: 1 passed, 1 total suite; 15 passed, 15 total tests (100% green).
  - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total suites; 94 passed, 94 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
## 2026-09-21 10:16 IST
- **Agent**: Antigravity
- **Change**: Removal of Dead-Code `|| '1120'` and `|| ['1120']` Fallbacks in Outbound Delivery Adapter and Handler:
  - **Audit & Rationalization**: `s4Config.getShippingPoints()` executes `_requireArray('shippingPoints', ...)`, which strictly inspects `cds.env` / environment variables and throws a `ConfigurationError` if the setting is missing or empty. Because `s4Config.getShippingPoints()` guarantees a non-empty array of strings, all 7 instances of `|| '1120'` and `|| ['1120']` across the adapter and handler were dead code.
  - **Cleaned Locations**:
    - `OutboundDeliveryAdapter.js` (line 95): `const configuredSPs = s4Config.getShippingPoints();`
    - `OutboundDeliveryAdapter.js` (line 194): `const cleanSP = String(shippingPoint || s4Config.getShippingPoints()[0]).trim();`
    - `outboundDelivery.handler.js` (lines 42, 45): Resolved fallback directly to `configuredSPs[0]`.
    - `outboundDelivery.handler.js` (lines 62, 64): `getDefaultShippingPoint` returns `{ ShippingPoint: configuredSPs[0], ShippingPoints: configuredSPs }`.
    - `outboundDeliveryHandler.test.js` (lines 157, 191, 193): Removed redundant test assertion fallbacks.
    - `outboundDeliveryAdapter.test.js` (line 189): Removed redundant test assertion fallbacks.
  - **Files Modified**:
    - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
    - `srv/le/outbound-delivery/handlers/outboundDelivery.handler.js`
    - `test/unit/le/outboundDeliveryAdapter.test.js`
    - `test/unit/le/outboundDeliveryHandler.test.js`
  - **Executed Commands and Results**:
    - `npx cds compile srv > /dev/null`: Succeeded with code 0.
    - `npx jest test/unit/le/ test/unit/sales-order/`: 9 passed, 9 total suites; 94 passed, 94 total tests (100% green).
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
## 2026-09-21 10:20 IST
- **Agent**: Antigravity
- **Change**: Zero-Lint Hygiene: Fixed All 16 Root ESLint `no-unused-vars` Warnings Across Codebase:
  - **Audit & Resolution**: Eliminated all 16 pre-existing ESLint warnings in backend services, mappers, and test suites:
    - `srv/integration/s4hana/S4ErrorMapper.js` (lines 52, 91): Renamed unused caught error parameters `(e)` to `(_e)`.
    - `srv/integration/s4hana/S4HttpClient.js` (lines 242, 316): Removed unused `userJwt` destructuring in `get` and `post` methods (managed directly via `options`).
    - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper.js` (line 16): Renamed unused argument `options` to `_options`.
    - `srv/mm/purchase-order/validation/purchaseOrder.validation.js` (line 7): Removed unused `ALPHANUMERIC_REGEX` constant.
    - `test/integration/purchase-order/activation.test.js` (line 1): Removed unused `httpClient` import.
    - `test/integration/purchase-order/draftCreation.test.js` (line 1): Removed unused `httpClient` import.
    - `test/unit/auth/authService.test.js` (line 2): Removed unused `localTokenUtil` import.
    - `test/unit/purchase-order/formatter.test.js` (lines 9, 21, 180): Renamed `options` to `_options` and wired `originalSap` restoration in `afterAll`.
    - `test/unit/sales-inquiry/salesInquiryAdapter.test.js` (lines 27, 43, 70): Renamed unused mock argument `(query)` to `(_query)`.
    - `test/unit/wm/goodsIssueController.test.js` (lines 764, 785): Renamed unused parameter `(m)` to `(_m)`.
  - **Files Modified**:
    - `srv/integration/s4hana/S4ErrorMapper.js`
    - `srv/integration/s4hana/S4HttpClient.js`
    - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper.js`
    - `srv/mm/purchase-order/validation/purchaseOrder.validation.js`
    - `test/integration/purchase-order/activation.test.js`
    - `test/integration/purchase-order/draftCreation.test.js`
    - `test/unit/auth/authService.test.js`
    - `test/unit/purchase-order/formatter.test.js`
    - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`
    - `test/unit/wm/goodsIssueController.test.js`
  - **Executed Commands and Results**:
    - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `npx jest test/unit/auth/ test/unit/purchase-order/ test/unit/sales-inquiry/ test/unit/wm/goodsIssueController.test.js test/integration/purchase-order/`: 36 passed, 36 total suites; 405 passed, 405 total tests (100% green).
  ## 2026-09-21 10:30 IST
- **Agent**: Antigravity
- **Change**: Security Hardening for Local Dev Token Issuer and Authentication Service:
  1. **Dev-Token Issuer Production Guarding**:
     - In `srv/auth/localTokenUtil.js`, added `process.env.NODE_ENV !== 'production'` guard to `isDevTokenIssuerEnabled()` so that dev token issuance is strictly impossible in production/BTP regardless of environment flag misconfigurations. Exported `timingSafeEqual` for secure string comparison.
     - In `server.js`, reinforced both Express bearer token verification middleware and CAP OData middleware chain with `process.env.NODE_ENV !== 'production' && localTokenUtil.isDevTokenIssuerEnabled()`, guaranteeing that locally signed tokens cannot bypass XSUAA in deployed BTP environments.
  2. **Auth Service Password Enforcement & Least-Privilege Role Assignment**:
     - In `srv/auth-service.js`, added non-empty validation for both `username` and `password`. Missing credentials immediately return `{ authenticated: false, message: "Username/Password is required." }`.
     - Replaced no-check mock logins with `timingSafeEqual` constant-time password comparisons for mock personas (`alice`, `bob`, `khushal`) against `LOCAL_DEV_PASSWORD` (defaulting to username in local test environments).
     - Protected configured S/4 user (`S4_USERNAME`) by verifying password against `S4_PASSWORD` via `timingSafeEqual`, with fallback to `authAdapter.validateCredentials(username, password)`.
     - Replaced blanket role assignment with least-privilege defaults: external/unconfigured S/4 users receive `["Viewer"]` rather than all administrative roles; `bob` receives `["Viewer"]`; `alice`, `khushal`, and explicit development accounts receive configured roles or development defaults.
  3. **Automated Unit Tests**:
     - In `test/unit/auth/localTokenUtil.test.js`, added unit test asserting `isDevTokenIssuerEnabled()` returns `false` and `issueToken()` throws when `NODE_ENV === 'production'`.
     - In `test/unit/auth/authService.test.js`, updated tests with valid credentials, added assertions for rejection on empty or incorrect passwords, and verified that unconfigured external users receive least-privilege `["$XSAPPNAME.Viewer"]`.
- **Files Modified**:
  - `srv/auth/localTokenUtil.js`
  - `server.js`
  - `srv/auth-service.js`
  - `test/unit/auth/localTokenUtil.test.js`
  - `test/unit/auth/authService.test.js`
- **Executed Commands and Results**:
  - `npx jest test/unit/auth/`: 3 passed, 3 total test suites; 37 passed, 37 total tests (100% green).
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm test`: **68 passed, 68 total test suites; 835 passed, 835 total tests (100% green)** in 68.2 s.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user and commit security hardening to `feature/CL01`.

### 2026-09-21: Audit Finding A — Elimination of Invented Units of Measure ('PC' & 'KG') Sent to SAP
- **Problem**: Audit flagged that missing Units of Measure silently fell back to `'PC'` or `'KG'` across multiple adapters, mappers, clients, and handlers (`SalesInquiryAdapter.js`, `SalesInquiryMapper.js`, `salesInquiry.mapper.js`, `purchaseOrder.mapper.js`, `GoodsReceiptAdapter.js`, `GoodsIssuePostingClient.js`, `GoodsIssueBatchesClient.js`, `GoodsIssueReservationsClient.js`, `GoodsIssueStockUnitClient.js`, `goodsIssue.handler.js`). Silently defaulting units risked posting real ERP documents and goods movements in incorrect units of measure.
- **Changes Applied**:
  1. `SalesInquiryAdapter.js`:
     - In `createSalesDocument`, added upfront line item unit validation before posting header to SAP.
     - In both Order deep insert and Inquiry sequential `ItemSet`/`PriceCondSet` steps, resolved unit from `OrderQuantityUnit || SalesUnit || UnitOfMeasure || BaseUnit`; throws descriptive error if omitted. Removed `'PC'` defaults.
  2. `SalesInquiryMapper.js`:
     - In `mapToS4InquiryPayload` and `mapToS4OrderPayload`, required authentic `OrderQuantityUnit` and removed `'PC'` fallback.
  3. `salesInquiry.mapper.js`:
     - Preserves authentic unit or empty string; removed `'PC'` default.
  4. `purchaseOrder.mapper.js`:
     - Resolves `UnitOfMeasure || OrderQuantityUnit || BaseUnit || Unit`; throws descriptive error if omitted. Removed `'PC'` fallback.
  5. `GoodsReceiptAdapter.js`:
     - In `getMaterialStorageLocations`, returns `r.BaseUnit || ''` instead of `'KG'`.
     - In `resolveStorageUnit`, derives authentic unit from inbound delivery, purchase order, or material storage locations instead of hardcoded `'KG'`.
     - In `postGoodsReceipt`, validates that `Unit`/`EntryUnit`/`UnitOfMeasure` is present for each item; throws descriptive error if missing. Removed `'KG'` fallback.
  6. `GoodsIssuePostingClient.js`:
     - In `postGoodsIssue` and `submitGoodsIssueRequest`, validates that `Unit`/`EntryUnit` is present; throws 400 error if missing. Removed `'KG'` fallback.
  7. `GoodsIssueBatchesClient.js`:
     - In `getMaterialPackagingUnits`, returns `u.AlternativeUnit || ''`; removed `'PC'` default.
     - In `getMaterialBatches`, returns `(slocInfo && slocInfo.BaseUnit) || b.Unit || b.BaseUnit || ''`; removed `'KG'` default.
     - In `revalidateStockAndBatch`, initializes `baseUnit = ''` and maps from `slocRes[0].BaseUnit || ''`; removed `'KG'` default.
  8. `GoodsIssueReservationsClient.js`:
     - In `getOpenItems`, derives `baseUnit = r.BaseUnit || r.ResvnItemComponentUnit || r.EntryUnit || r.UnitOfMeasure || ''`. Only generates base packaging unit if authentic unit exists. Removed `'PC'` default.
  9. `GoodsIssueStockUnitClient.js`:
     - In `resolveReservationComponent`, derives `resvUnit = resvItem.BaseUnit || resvItem.ResvnItemComponentUnit || resvItem.EntryUnit || resvItem.UnitOfMeasure || ''`; removed `'KG'` default.
  10. `goodsIssue.handler.js`:
     - In fallback queue enrollment, uses `it.Unit || it.EntryUnit || it.BaseUnit || ''`; removed `'PC'` default.
- **Automated Tests**:
  - `test/unit/purchase-order/domainMapping.test.js`: Added assertions verifying rejection of items missing `UnitOfMeasure`.
  - `test/unit/sales-inquiry/salesInquiryMapping.test.js`: Added assertions verifying rejection of items missing `OrderQuantityUnit`.
  - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Added assertions verifying rejection of items missing `OrderQuantityUnit`.
  - `test/unit/wm/goodsReceiptService.test.js`: Added assertions verifying rejection of items missing `Unit`/`EntryUnit`.
  - `test/unit/wm/goodsIssueClients.test.js`: Added assertions verifying rejection of items missing `Unit`/`EntryUnit`.
- **Validation**: 32/32 test suites passed (488/488 tests green).

### 2026-09-21: Audit Finding A — Elimination of Invented Quantity Defaults (Default to 1) Sent to SAP
- **Problem**: Audit flagged that empty, zero, or invalid item quantities silently defaulted to `1` in `SalesInquiryAdapter.js` (lines 1079 and 1233) and `purchaseOrder.mapper.js` (line 41), causing blank or invalid quantities to silently post as orders for 1.
- **Changes Applied**:
  1. `purchaseOrder.mapper.js`:
     - Validates that `item.OrderQuantity` is non-empty and a positive number (`> 0`). Throws explicit error `OrderQuantity is required for item ${itemNo}` or `OrderQuantity must be greater than 0 for item ${itemNo}`.
     - Maps `OrderQuantity: String(qty)`. Removed `const qty = Number(item.OrderQuantity) || 1`.
  2. `SalesInquiryAdapter.js`:
     - Added upfront validation in `createSalesDocument` to verify that every item has a non-empty, positive `OrderQuantity (> 0)` before initiating any SAP network requests.
     - In Order branch deep insert, removed `|| 1` and enforces `qty > 0`.
     - In Inquiry branch sequential creation, removed `|| 1` and enforces `qty > 0`.
- **Automated Tests**:
  - `test/unit/purchase-order/domainMapping.test.js`: Added tests asserting `normalizePurchaseOrderData` rejects missing `OrderQuantity` and non-positive `OrderQuantity <= 0`.
  - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Added tests asserting `createSalesDocument` rejects missing `OrderQuantity` and non-positive `OrderQuantity <= 0`.
- **Executed Commands and Results**:
  - `npx jest test/unit/purchase-order/ test/unit/sales-inquiry/`: 25 passed, 25 total test suites; 299 passed, 299 total tests (100% green).
  - `npx jest test/unit/wm/`: 7 passed, 7 total test suites; 193 passed, 193 total tests (100% green).
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Review with user and commit fixes for Audit Finding A.

### 2026-09-21: Audit Finding A — Elimination of Invented Item Numbers (Default to '000010' / '00010') in GoodsReceiptAdapter.js
- **Problem**: Audit flagged that item numbers defaulted to `'000010'` / `'00010'` across 13 places in `GoodsReceiptAdapter.js`, allowing a goods receipt to post against item 10 when SAP did not return the real item.
- **Changes Applied**:
  1. `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`:
     - In `resolveStorageUnit`: Initialized `resolvedDeliveryItem = ''` and `resolvedPOItem = ''` (previously `'000010'` and `'00010'`).
     - Removed all 12 `|| '000010'` and `|| '00010'` fallback defaults across Tier 1 (Inbound Delivery), Tier 2 (PO), Tier 3 (Batch), Tier 4 (Material), and Tier 6 (Storage Unit broad match). Only preserves authentic SAP-returned item numbers.
     - In `postGoodsReceipt`: Validates that `DeliveryDocumentItem` or `PurchaseOrderItem` is non-empty before posting. Throws descriptive error `Delivery Document Item (or Purchase Order Item) is required to post Goods Receipt.` instead of defaulting to `'000010'`.
     - In `payload.Items` multi-item mapping: Validates that each item has a valid `DeliveryDocumentItem` or `PurchaseOrderItem`. Removed synthetic `String((idx + 1) * 10).padStart(6, '0')` generation.
  2. `app/fiori-app/webapp/modules/wm/goods-receipt/controller/GoodsReceipt.controller.js`:
     - Added `DeliveryDocumentItem: oActive.DeliveryDocumentItem`, `PurchaseOrder: oActive.PurchaseOrder`, `PurchaseOrderItem: oActive.PurchaseOrderItem`, and `Unit: oActive.Unit` to `oPayload` in `onPostGoodsReceipt` so authentic SAP-resolved document items and units are always forwarded to the backend.
  3. `test/unit/wm/goodsReceiptService.test.js`:
     - Added test asserting `postGoodsReceipt` rejects when `DeliveryDocumentItem` and `PurchaseOrderItem` are missing.
     - Added test asserting `resolveStorageUnit` preserves empty item numbers when SAP does not return item numbers.
     - Updated mock tests to supply authentic line item identifiers.
- **Executed Commands and Results**:
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 195 passed, 195 total tests (100% green)**.
  - `npx jest test/unit/purchase-order/ test/unit/sales-inquiry/ test/unit/sales-order/ test/unit/journal-entry/ test/unit/outbound-delivery/`: **30 passed, 30 total test suites; 348 passed, 348 total tests (100% green)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Review with user and commit fixes for Audit Finding A item numbers.

### 2026-09-21: Audit Finding A — Elimination of Invented Movement Reason Code Defaults ('0000') in GoodsReceiptAdapter.js
- **Problem**: Audit flagged that movement reason code defaulted to `'0000'` in `GoodsReceiptAdapter.js` (lines 663 and 681 in original file, lines 682 and 706 in current file), causing an invented dummy reason code to post to SAP S/4HANA.
- **Changes Applied**:
  1. `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`:
     - In `payload.Items` multi-item mapping: Mapped `GoodsMovementReasonCode: it.GoodsMovementReasonCode || payload.GoodsMovementReasonCode || ''`. Removed `'0000'` fallback.
     - In single item mapping: Mapped `GoodsMovementReasonCode: payload.GoodsMovementReasonCode || ''`. Removed `'0000'` fallback.
     - Reason code now remains blank (`''`) for standard movement postings unless an authentic reason code is explicitly provided by the caller or business workflow.
  2. `test/unit/wm/goodsReceiptService.test.js`:
     - Added assertion verifying `GoodsMovementReasonCode: ''` on standard Goods Receipt posting.
     - Added dedicated unit test asserting authentic `GoodsMovementReasonCode` is passed through when provided and empty string when omitted, never inventing `'0000'`.
- **Executed Commands and Results**:
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 196 passed, 196 total tests (100% green)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Review with user and commit fixes for Audit Finding A reason codes.

### 2026-09-21: Audit Finding A — Elimination of Invented Date Defaults (Today, Delivery Date +7 Days, Validity End +30 Days) in Sales Mappers
- **Problem**: Audit flagged that dates defaulted to today and delivery date defaulted to today + 7 days in both sales mappers (`salesInquiry.mapper.js`, `SalesInquiryMapper.js`), resulting in fabricated Customer PO date, document date, validity period dates, and requested delivery dates being sent to SAP S/4HANA when left blank.
- **Changes Applied**:
  1. `srv/sd/sales-inquiry/mapping/salesInquiry.mapper.js`:
     - Removed `today` (`new Date().toISOString().split('T')[0]`), `defaultEnd` (+30 days), and `defaultDelivery` (+7 days) synthesizers.
     - Header mapping now preserves authentic trimmed dates if provided (`CustomerPurchaseOrderDate`, `SalesInquiryDate`, `CreationDate`, `RequestedDeliveryDate`, `BindingPeriodValidityStartDate`, `BindingPeriodValidityEndDate`) or maps to `''` when blank/omitted.
     - Item mapping now maps `RequestedDeliveryDate` to authentic item delivery date, falling back to authentic header `RequestedDeliveryDate`, or `''` if omitted.
  2. `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper.js`:
     - In `mapToS4InquiryPayload`: Removed `today`. Mapped `CustomerPurchaseOrderDate`, `SalesInquiryDate`, `BindingPeriodValidityStartDate`, and `BindingPeriodValidityEndDate` to trimmed strings or `''`.
     - In `mapToS4OrderPayload`: Removed `today` and `defaultDelivery`. Mapped `CustomerPurchaseOrderDate`, `SalesOrderDate`, and `RequestedDeliveryDate` to trimmed strings or `''`. Item `RequestedDeliveryDate` maps to item date, header date, or `''`.
  3. `test/unit/sales-inquiry/salesInquiryMapping.test.js`:
     - Added unit tests for `normalizeSalesInquiryData` asserting dates remain empty strings when omitted, and are correctly preserved when authentic values are provided.
     - Added unit tests for `mapToS4InquiryPayload` asserting dates remain empty strings when omitted.
     - Added unit tests for `mapToS4OrderPayload` asserting dates and item delivery dates remain empty strings when omitted, and preserve authentic values/item overrides when supplied.
- **Executed Commands and Results**:
  - `npx jest test/unit/sales-inquiry/salesInquiryMapping.test.js`: **1 passed, 1 total test suite; 13 passed, 13 total tests (100% green)**.
  - `npx jest test/unit/sales-inquiry/ test/unit/sales-order/ test/unit/purchase-order/ test/unit/wm/`: **37 passed, 37 total test suites; 549 passed, 549 total tests (100% green)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit the date default elimination to `feature/CL01`.

### 2026-09-21: Audit Finding A — Elimination of Invented Customer Reference Defaults ('SALES ORDER' / 'SALES INQUIRY' / First Item Text)
- **Problem**: Audit flagged that customer reference defaulted to the first item's text, or `'SALES ORDER'` / `'SALES INQUIRY'` (`SalesInquiryAdapter.js` line 1052 and `salesInquiry.mapper.js` line 63), storing an invented dummy PO reference in SAP S/4HANA when left blank by the customer.
- **Changes Applied**:
  1. `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`:
     - Removed `firstItemText` and fallback to `(docType === 'ZIN' ? 'SALES INQUIRY' : 'SALES ORDER')`.
     - `custRef` now strictly resolves to `header.PurchaseOrderNumber || header.PurchaseOrderByCustomer` (trimmed) or empty string `''`.
     - In both Sales Order deep insert and Sales Inquiry header creation, `PurchaseOrderNumber` sends authentic user reference or `''` if omitted.
  2. `srv/sd/sales-inquiry/mapping/salesInquiry.mapper.js`:
     - Removed `firstItemDesc` fallback from item text.
     - `description` now resolves strictly to `rawHeader.PurchaseOrderNumber || rawHeader.PurchaseOrderByCustomer` (trimmed) or empty string `''`.
     - `PurchaseOrderByCustomer` and `PurchaseOrderNumber` are no longer contaminated with item descriptions when omitted.
  3. `test/unit/sales-inquiry/salesInquiryAdapter.test.js`:
     - Updated test to assert `PurchaseOrderNumber` remains empty string `''` when customer reference is omitted, rather than defaulting to item text.
  4. `test/unit/sales-inquiry/salesInquiryMapping.test.js`:
     - Updated test to assert `PurchaseOrderByCustomer` and `PurchaseOrderNumber` remain empty strings when omitted, rather than taking item text.
  5. `test/unit/sales-order/salesOrderAdapter.test.js`:
     - Added test asserting `PurchaseOrderNumber` in sales order deep insert payload remains empty string `''` when reference is omitted, never defaulting to item text or `'SALES ORDER'`.
- **Executed Commands and Results**:
  - `npx jest test/unit/sales-inquiry/salesInquiryAdapter.test.js test/unit/sales-inquiry/salesInquiryMapping.test.js test/unit/sales-order/salesOrderAdapter.test.js`: **3 passed, 3 total test suites; 50 passed, 50 total tests (100% green)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit customer reference default elimination to `feature/CL01`.

### 2026-09-21: XML View Defect Audit — 7 Fixes Across 6 Files
- **Problem**: User requested a sweep of all XML view/fragment files to find and fix defects. Exhaustive review of all 21 source XML files in `app/fiori-app/webapp/` identified 9 defects (7 fixed, 2 left as by-design).
- **Changes Applied**:
  1. `app/fiori-app/webapp/modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml`:
     - Removed dead `headerText="{i18n>poHeaderItems}"` from Panel that already has a `<headerToolbar>` child (headerText is silently ignored when headerToolbar is present).
  2. `app/fiori-app/webapp/modules/sd/sales-inquiry/view/CreateSalesInquiry.view.xml`:
     - Removed dead `headerText="{i18n>salesInquiryPanelItems}"` from Panel with `<headerToolbar>`.
  3. `app/fiori-app/webapp/modules/sd/sales-order/view/CreateSalesOrder.view.xml`:
     - Removed dead `headerText="{i18n>salesOrderPanelItems}"` from Panel with `<headerToolbar>`.
  4. `app/fiori-app/webapp/modules/fi/journal-entry/view/JournalEntries.view.xml`:
     - Removed unused `xmlns:f="sap.f"` namespace declaration (never referenced in the file).
     - Standardized expression binding on `icon` property from `${fiService>DebitCreditCode}` to `%{fiService>DebitCreditCode}` for consistency with the project `targetType: 'any'` convention.
  5. `app/fiori-app/webapp/modules/sd/sales-inquiry/view/SalesInquiries.view.xml`:
     - Removed unused `xmlns:f="sap.f"` namespace declaration (never referenced in the file).
  6. `app/fiori-app/webapp/modules/mm/purchase-order/view/PurchaseOrders.view.xml`:
     - Changed table `mode` from `SingleSelectMaster` to `None`. The `Navigation` type on `ColumnListItem` + `itemPress` handler already provides row-click navigation; `SingleSelectMaster` adds an unnecessary selection highlight that can cause double-fire scenarios.
- **Not Fixed (By Design)**:
  - SalesOrders table missing navigation: Intentional — each row has a "Create Delivery" action button and ColumnListItem type is `Inactive`.
  - Dashboard MessageStrip `${...}` vs `%{...}`: `visible` is a boolean property and `!!${}` coercion works correctly; `%{}` convention applies specifically to `enabled`/`state` properties.
- **Executed Commands and Results**:
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `git diff --check`: **### 2026-09-21: Sales Orders Worklist & KPI Count Fix (894 Orders Resolving Cleanly)
- **Problem**: User reported: "in KPI Cards Sales order showing 894 byt list is not showing." Investigation identified two root causes:
  1. `server.js` lacked development credentials configuration for remote service `SD_F1873_SO_WL_SRV` (while `SD_F2370_INQY_WL_SRV` and `SD_F2369_INQY_FS_SRV` were configured). As a result, `cds.connect.to('SD_F1873_SO_WL_SRV')` failed with `No credentials configured for "SD_F1873_SO_WL_SRV"`.
  2. In `SalesInquiryAdapter.js`, `getSalesOrders(query)` erroneously ran `execQuery = SELECT.from(query.SELECT.from || 'SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873')`. When the CAP request arrived from UI5, `query.SELECT.from` was `SalesOrders`, which caused the remote S/4HANA OData V2 service to reject the request with HTTP 404 (`Resource not found for the segment 'SalesOrders'`).
  3. When CDS failed, the fallback HTTP client returned raw OData V2 JSON containing `/Date(...)` timestamp strings (e.g. `"/Date(1789948800000)/"`), which violated OData V4 `Edm.Date` format and prevented UI5 OData V4 table from rendering data rows. Furthermore, `@odata.count` was not set on the returned array.
- **Changes Applied**:
  1. `server.js`:
     - Added `credsSDSO` for `SD_F1873_SO_WL_SRV` pointing to `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/SD_F1873_SO_WL_SRV` with basic authentication and SAP client header.
     - Registered `cds.env.requires.SD_F1873_SO_WL_SRV` and `cds.requires.SD_F1873_SO_WL_SRV` credentials in local development.
  2. `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`:
     - In `getSalesOrders(query)`: Strictly constructed `execQuery = SELECT.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873')` transferring `columns`, `where`, `orderBy`, `limit`, and `count` from incoming query. Never passes frontend entity name `SalesOrders` to remote service.
     - Preserves `$count` property on returned list from `this.s4hanaSO.run(execQuery)`.
     - In HTTP client fallback: Added `$inlinecount=allpages` support and normalized OData V2 `/Date(...)` dates (`CreationDate`, `SalesOrderDate`, `RequestedDeliveryDate`, `LastChangeDate`, `LastChangeDateTime`) to standard ISO `YYYY-MM-DD` strings, ensuring valid OData V4 schema compliance.
     - In `getInquiries(query)`: Fixed query builder to strictly target `'SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370'` and preserve `$count`.
  3. `test/unit/sales-order/salesOrderAdapter.test.js`:
     - Added test verifying `getSalesOrders` maps query properly to `SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873` (never querying `SalesOrders`) and preserves `$count`.
     - Added test verifying HTTP fallback normalizes `/Date(...)` strings and sets `$count`.
- **Executed Commands and Results**:
  - Live query verification via S/4HANA Client 220: HTTP 200 in 346 ms, `@odata.count: 894`, 50 rows returned, dates properly formatted as ISO `YYYY-MM-DD`.
  - `npx jest test/unit/`: **57 passed, 57 total test suites; 806 passed, 806 total tests (100% green)**.
  - `npm run lint`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.56 s; Component-preload.js generated cleanly**.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Fix Goods Receipt Hardcoded Quantity & Implement Authentic Quantities from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items (Items 1.1-1.6)
- **Change**: Eliminated hardcoded `Quantity: 10` (line 582) and synthetic defaults (`Quantity: 1`, `Unit: "KG"`, `DeliveryDocumentItem: "000010"`, `PurchaseOrderItem: "00010"`, `'Material ' + id`, `'Plant ' + id`, and `CS01` storage location fallback). Implemented authentic quantity and unit retrieval from live SAP S/4HANA OData service `MMIM_GR4PO_DL_SRV` entity `GR4PO_DL_Items` and `GR4PO_DL_Headers/Header2Items`.
- **Affected files**:
  - `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`:
    - Added `getGoodsReceiptItem(deliveryDocument, deliveryItem, purchaseOrder, purchaseOrderItem)`: performs live key lookup on `GR4PO_DL_Items` for `INBDELIV` and navigation on `GR4PO_DL_Headers/Header2Items` for `PURORD`, extracting authentic `OpenQuantity`, `OrderedQuantity`, `QuantityInEntryUnit`, `UnitOfMeasure`, and `EntryUnit`.
    - In `resolveStorageUnit()`: Removed hardcoded `Quantity: 10`. Proposes authentic SAP `OpenQuantity` (or `QuantityInEntryUnit`/`OrderedQuantity`) and returns `0` if none exists.
    - Removed synthetic name prefixes (`'Material ' + id` and `'Plant ' + id`) across all 7 tiers, returning empty string `''` when SAP provides no text.
    - Eliminated synthetic fallback to `cds.s4.storageLocation` (CS01), taking storage location from the authentic SAP item or leaving it empty for user selection.
  - `srv/wm/goods-receipt/service.cds`: Added `OpenQuantity : Decimal(13, 3);`, `OrderedQuantity : Decimal(13, 3);`, and `QuantityInEntryUnit : Decimal(13, 3);` to `type StorageUnitDetails`.
  - `app/fiori-app/webapp/modules/wm/goods-receipt/controller/GoodsReceipt.controller.js`: Removed `Quantity: 1`, `Unit: "KG"`, and item number fallbacks. Bound authentic `OpenQuantity`, `OrderedQuantity`, and `Unit` to the view model.
  - `app/fiori-app/webapp/modules/wm/goods-receipt/view/GoodsReceipt.view.xml`: Added Open Quantity label next to receipt quantity input so warehouse operators can verify what SAP expects to receive.
  - `test/unit/wm/goodsReceiptService.test.js`: Added mock fallback branches for `GR4PO_DL_Items` and `GR4PO_DL_Headers` and unit test verifying authentic open quantity and unit resolution.
  - `test/unit/wm/goodsReceiptController.test.js`: Added unit tests verifying binding of authentic open quantity and unit from SAP on scan.
- **Commands executed & results**:
  - Live probe against SAP Client 220:
    - Delivery `180000008` resolved to authentic `Quantity: 1000`, `OpenQuantity: 1000`, `OrderedQuantity: 1000`, `Unit: "KG"`, Material: `1000000029 (3-Pentanone)`.
    - PO `400000028` resolved to authentic `Quantity: 100`, `OpenQuantity: 100`, `OrderedQuantity: 100`, `Unit: "KG"`, Material: `1000000458 (Di Propylene Glycol)`.
  - `npx eslint .`: 0 errors, 0 warnings.
  - `npx cds compile srv`: Clean compilation (0 errors).
  - `cd app/fiori-app && npx ui5lint`: Success! No findings detected (0 errors).
  - `cd app/fiori-app && npm run build`: Build succeeded in 1.30 s; Component-preload.js generated cleanly.
  - `npx jest test/unit/wm/goodsReceiptService.test.js test/unit/wm/goodsReceiptController.test.js`: All 54 tests passed (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 12:30 IST — Eliminate Assumed/Invented Defaults in Sales Inquiry, Outbound Delivery, and Purchase Order Modules
- **Agent**: Antigravity
- **Change**: Eliminated synthetic and hardcoded fallbacks identified across Sales Inquiry, Outbound Delivery, and Purchase Order modules adhering to no-assumed-data and zero default policy:
  - **Sales Inquiry Screen**:
    - `app/fiori-app/webapp/modules/sd/sales-inquiry/model/SalesInquiryModel.js`:
      - Removed hardcoded `SalesInquiryType: "ZIN"`, `SalesOrganization: "1000"`, `DistributionChannel: "10"`, `OrganizationDivision: "52"`, and `TransactionCurrency: "INR"` from `createInitialModel` header defaults; initialized to `""`.
      - Removed hardcoded `OrderQuantity: 1` and `OrderQuantityUnit: "PC"` from initial line item (`createInitialModel`) and dynamically added items (`addItem`); initialized to empty `""`.
      - Removed `"PC"` fallback in `cleanForCreation` and `buildPayload`; preserving user/master data unit without injecting `"PC"`.
      - Removed hardcoded `"ZIN"`, `"1000"`, `"10"`, `"52"`, and `"INR"` fallbacks in `buildPayload`; leaving empty fields untouched when unpopulated.
    - `app/fiori-app/webapp/modules/sd/sales-inquiry/service/SalesInquiryService.js`:
      - Removed hardcoded fallback `Currency: "INR"` and `ShipToParty: sCustomer` in `getCustomerDefaults`; returns empty strings on missing input or network/OData failure.
      - Removed hardcoded fallback returning `"ZIN"`, `"1000"`, `"10"`, `"52"`, and `"INR"` on failure in `getSalesInquiryDefaults`; returns empty strings and `derived: false`.
  - **Outbound Delivery Screen**:
    - `app/fiori-app/webapp/modules/le/outbound-delivery/service/OutboundDeliveryService.js`:
      - Removed invented `{ ShippingPoint: "1120", ShippingPoints: ["1120", "1112", "1108", "1109"] }` in `getDefaultShippingPoint`; returns `{ ShippingPoint: "", ShippingPoints: [] }` on missing backend response or network failure.
    - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`:
      - Initialized `deliveryDialog` with `shippingPoint: ""` and `shippingPoints: []`; populates options and default shipping point exclusively from backend response. Removed hardcoded `"1120"` context fallback in `onCreateDeliveryPress`.
    - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`:
      - Initialized `deliveryDialog` with `shippingPoint: ""` and `shippingPoints: []`; sets shipping point from backend default or selected order context, eliminating hardcoded `"1120"`.
  - **Purchase Order Screen**:
    - `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js`:
      - Line 140: Removed `UnitOfMeasure: "PC"` from initial line item in `createInitialModel`; initialized to `""`.
      - Lines 180–182: Removed `OrderQuantity: "1"`, `UnitOfMeasure: "PC"`, and `NetPriceAmount: "0.00"` from `addItem`; new items initialize with empty `OrderQuantity: ""`, `UnitOfMeasure: ""`, and `NetPriceAmount: ""`.
      - Line 63: Preserved Excel template example column configuration as-is (`UnitOfMeasure: { ..., example: "PC" }`).
  - **Unit Tests**:
    - `test/unit/sales-inquiry/salesInquiryModel.test.js`: Updated assertions for zero default header and item values; added tests verifying empty string preservation in `buildPayload`.
    - `test/unit/sales-inquiry/createSalesInquiryController.test.js`: Configured explicit valid header setup helper in save flow tests.
    - `test/unit/sales-inquiry/salesInquiryCreationPayload.test.js`: Added unit tests verifying `getCustomerDefaults` and `getSalesInquiryDefaults` return empty strings on failure.
    - `test/unit/purchase-order/materialSelection.test.js`: Added test suite asserting empty unit and quantity initialization for initial and added items.
    - `test/unit/purchase-order/createPurchaseOrderStatus.test.js`: Updated complete item test case to set unit of measure explicitly.
    - `test/unit/le/outboundDeliveryService.test.js`: Added unit test asserting empty shipping point fallback when backend returns null or rejects.
    - `test/unit/sales-order/salesOrdersController.test.js`: Updated mock binding context for sales order to provide `ShippingPoint: "1120"`.
- **Validation Commands Executed & Results**:
  - `npx eslint .`: 0 errors, 0 warnings.
  - `cd app/fiori-app && npx ui5lint`: Success! No findings detected (0 errors).
  - `cd app/fiori-app && npm run build`: Build succeeded in 872 ms; `Component-preload.js` generated cleanly.
  - `npx cds compile srv`: Clean compilation (0 errors).
  - `npm test`: **68 passed, 68 total test suites; 863 passed, 863 total tests (100% green)** in 71.7 s.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit `test/unit/sales-order/salesOrdersController.test.js` and `WORKSTATUS.md` to `feature/CL01`.

### 2026-09-21 — Goods Issue Batch Stock Retrieval Grain Correction & Silent Zero Elimination (Item 2.1 / Audit Row 40)
- **Problem**:
  - In `GoodsIssueBatchesClient.js:62-100,150-160` and `GoodsIssueStockUnitClient.js:612-645,704-705`, stock was retrieved at the wrong grain and suffered from silent zero default.
  - Storage-location level stock from `MaterialStorLocHelps` (0 rows in SAP) or the first row of an unfiltered `C_STOCKQUANTITYVALUEBYTYPE` read was stamped onto *every* batch returned for a material.
  - When both queries failed or returned no data, `AvailableStock` silently became `0`. Because `isSelectable = nStock > 0`, valid unexpired batches were marked unselectable (`IsSelectable: false`) and shown as "No Stock".
  - In `GoodsIssueStockUnitClient.js`, scanned batch barcodes assigned storage-location stock (or fallback `0`) to `CurrentStock` and `SuStockQty`.
- **Changes Applied**:
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueBatchesClient.js`:
    - Removed storage-location level stock stamping onto all batches.
    - Implemented authentic batch-grain stock lookup via live-verified S/4HANA OData service `/sap/opu/odata/sap/MMIM_MULTIPLE_MATERIAL_SRV/MaterialMultiStockByDates` with `$filter=Material eq '${sMat}'` (and optional `Plant`/`StorageLocation`).
    - Mapped stock to each batch individually from `MaterialMultiStockByDates`.
    - If a batch has no stock record or lookup fails, `AvailableStock` is set to `null` (unknown stock). **Unknown stock never defaults to 0**.
    - Updated `isSelectable`: `(nStock === null || nStock > 0) && status.StatusState !== 'Error' && status.StatusText !== 'EXPIRED'`. Unexpired batches with unknown stock remain selectable; only confirmed zero-stock batches (`nStock === 0`) are disabled.
    - In `revalidateStockBeforePosting`: Re-reads batch-grain stock via `MaterialMultiStockByDates` with `Batch eq '${sBatch}'` when a batch is specified.
    - Removed unused `s4Config` import.
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`:
    - Initialized `currentStock = null` (not `0`).
    - When a scanned barcode directly matches an SAP batch (`directBatch` or `gs1Batch`), resolves `resolvedStock` using batch-level `AvailableStock`. Sets `CurrentStock: resolvedStock` and `SuStockQty: resolvedStock`, preserving `null` for unknown stock.
    - `MaxIssueQty`: Computed as `Math.min(resolvedStock, openQty)` when stock is known, or `openQty` when unknown (never clamped to 0).
  - `srv/integration/s4hana/wm/GoodsIssueAdapter.js`:
    - In `resolveIdentifier`: Included batches with unknown stock (`AvailableStock === null`) in `issuableBatches`.
    - Preserved `AvailableStock: null` in active item and resolution result when stock is unknown, preventing silent zero conversion.
  - `app/fiori-app/webapp/modules/wm/goods-issue/view/BatchSelectionDialog.fragment.xml`:
    - Updated Select button bindings so batches with unknown stock (`null`/`undefined`) display "Select" (not "No Stock") and remain enabled.
  - `test/unit/wm/goodsIssueClients.test.js`:
    - Updated tests to verify batch-grain stock mapping from `MaterialMultiStockByDates`.
    - Added test asserting `AvailableStock: null` and `IsSelectable: true` when batch stock is unknown (never silent zero).
    - Added test for `GoodsIssueStockUnitClient` asserting `CurrentStock` and `SuStockQty` match batch stock, and unknown stock is preserved as `null`.
    - Added test for `GoodsIssueAdapter.resolveIdentifier` verifying unknown stock preservation.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/integration/s4hana/wm/ test/unit/wm/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 817 ms; Component-preload.js generated cleanly**.
  - `npx jest test/unit/wm/goodsIssueClients.test.js`: **40 passed, 40 total tests (100% green)**.
  - `npx jest test/unit/wm/goodsIssueService.test.js`: **45 passed, 45 total tests (100% green)**.
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 201 passed, 201 total tests (100% green)**.
  - `npm test`: **68 passed, 68 total test suites; 866 passed, 866 total tests (100% green)** in 81.8 s.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Fix Goods Issue Result POSTED_IN_SAP Authentic Document Requirement (Item 43)
- **Change**: Required an authentic SAP Material Document number before marking Goods Issue as `POSTED_IN_SAP` / `Success: true`. Any non-queued response missing a non-empty `MaterialDocument` is treated as unconfirmed/failed: sets `Success: false`, `Queued: false`, `SyncStatus: "FAILED"`, `MaterialDocument: ""`, plays error audio cue, and reports that posting response did not include an authentic SAP Material Document number. Aligned `onRetrySync` and `onRetryQueueItem` to only declare success when a trimmed `MaterialDocument` is present.
- **Affected files**:
  - `app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js`:
    - In `_executePost`: Checks `sMatDoc` (trimmed `oResult.MaterialDocument`). If absent and not queued, sets `Success: false`, `SyncStatus: "FAILED"`, `MaterialDocument: ""`, plays failure beep, and displays descriptive unconfirmed message instead of assuming `POSTED_IN_SAP`.
    - In `onRetrySync`: Requires non-empty `sMatDoc` along with `oResult.Success` before transitioning to `POSTED_IN_SAP` and playing success sound.
    - In `onRetryQueueItem`: Requires non-empty `sMatDoc` along with `oResult.Success` before showing success MessageBox.
  - `test/unit/wm/goodsIssueController.test.js`:
    - Added unit test asserting that non-queued responses without `MaterialDocument` are marked `Success: false`, `SyncStatus: "FAILED"`, and report authentic SAP Material Document requirement.
    - Added unit test asserting that retry without `MaterialDocument` keeps item queued and warns user.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/ test/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.07 s; Component-preload.js generated cleanly**.
  - `npx jest test/unit/wm/goodsIssueController.test.js`: **49 passed, 49 total tests (100% green)**.

### 2026-09-21 — Fix Goods Issue Batch Submit Queued Response Status & Difference Clearing (Item 44)
- **Change**: Fixed mislabelled batch submit response when SAP posting capability is unavailable (501 / 403 / 404). Queued lines previously returned `Success: true` and `DifferenceCleared: true` (if difference quantity was entered) despite nothing being posted or cleared in SAP. Now returns `Success: false`, `Queued: true`, `DifferenceCleared: false`, and authentic `QueueReference: qRecord.QueueReference`. Single-item queued response also sets `DifferenceCleared: false`. Added `Queued` and `QueueReference` fields to `GISubmitLineResult` in `service.cds`.
- **Affected files**:
  - `srv/wm/goods-issue/handlers/goodsIssue.handler.js`:
    - In `submitGoodsIssueRequest` Dispatch Queue fallback: sets `Success: false`, `Queued: true`, `DifferenceCleared: false`, and `QueueReference: qRecord.QueueReference` on each queued item.
    - In single-item `postGoodsIssue` Dispatch Queue fallback: sets `DifferenceCleared: false` when queued.
  - `srv/wm/goods-issue/service.cds`:
    - Added `Queued: Boolean;` and `QueueReference: String(40);` to `GISubmitLineResult` type definition.
  - `test/unit/wm/goodsIssueService.test.js`:
    - Updated `fallback to Dispatch Queue on batch submitGoodsIssueRequest when posting is unavailable` test to assert `Success: false`, `Queued: true`, `DifferenceCleared: false`, and `QueueReference` defined.
- **Validation Commands Executed & Results**:
  - `npx cds compile srv/wm/goods-issue/service.cds`: **Clean (0 errors)**.
  - `npx eslint srv/ test/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 808 ms; Component-preload.js generated cleanly**.
  - `npx jest test/unit/wm/goodsIssueService.test.js`: **45 passed, 45 total tests (100% green)**.
  - `npx jest test/unit/wm/goodsIssueClients.test.js`: **40 passed, 40 total tests (100% green)**.
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 203 passed, 203 total tests (100% green)**.
  - `npx jest test/integration/wm/`: **1 passed, 1 total test suite; 5 passed, 5 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.

### 2026-09-21 — Fix Goods Issue Batch Status & SLED Handling: Eliminate Optimistic VALID/Success Default & Show "unknown" (Audit Row 41)
- **Change**: Eliminated optimistic default assumptions where missing batch status fell back to `'VALID'` / `'Success'` / `9999` days to expiry, and failed batch SLED lookups showed `"NO SLED"`. Updated handling across backend clients and UI5 controller so:
  1. A failed SAP batch lookup or missing pre-assigned batch sets `StatusText: 'unknown'`, `StatusState: 'None'`, and `DaysToExpiry: null` instead of falsely reporting `"NO SLED"`. The label `"NO SLED"` is strictly reserved for batches confirmed by SAP S/4HANA to exist with an empty shelf life expiration date (`ExpiryDate: null`).
  2. Missing status on determined/candidate batches defaults to `StatusText: 'unknown'` and `StatusState: 'None'`, never assumed as `'VALID'` or `'Success'`.
  3. UI5 controller auto-determined batch fallback maps missing `DeterminedBatchStatusText` to `"unknown"` and `DeterminedBatchStatusState` to `"None"`.
- **Affected files**:
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`:
    - Initialized pre-assigned batch status to `r.Batch ? 'unknown' : 'NO BATCH'` (with `DaysToExpiry: null`).
    - In `catch (err)` (failed SAP batch lookup) and when `!matchedBatch` (batch not found in SAP), sets `batchStatus` to `{ StatusState: 'None', StatusText: 'unknown', DaysToExpiry: null }`.
    - `'NO SLED'` is only assigned when `matchedBatch` is found from SAP and SAP confirms `ExpiryDate` is null/empty.
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`:
    - Scanned barcode direct match (`batchDirectMatch`): defaults changed from `'Success'` / `'VALID'` / `9999` to `StatusState: 'None'`, `StatusText: 'unknown'`, `DaysToExpiry: null`.
    - Usable candidate batch determination (`candidate`): fallback changed from `'None'` / `'VALID'` to `StatusState: 'None'`, `StatusText: 'unknown'`, `DaysToExpiry: null`.
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueBatchesClient.js`:
    - In `revalidateStockBeforePosting`: fallback for missing status changed from `'Success'` / `'VALID'` to `'None'` / `'unknown'`.
  - `app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js`:
    - In `_resolveSuBarcode`: fallback for missing auto-determined batch status changed from `"Success"` / `"VALID"` to `"None"` / `"unknown"`.
  - `test/unit/wm/goodsIssueClients.test.js`:
    - Added test verifying `BatchStatusText: 'unknown'` and `BatchStatusState: 'None'` when batch lookup fails (never defaulting to `"NO SLED"`).
    - Added test verifying `DeterminedBatchStatusText: 'unknown'` and `DeterminedBatchStatusState: 'None'` when determined batch has missing status (never defaulting to `"VALID"` or `"Success"`).
  - `test/unit/wm/goodsIssueController.test.js`:
    - Added test verifying auto-determined batch defaults missing status to `"unknown"` and `"None"`.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/integration/s4hana/wm/ test/unit/wm/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 815 ms; Component-preload.js generated cleanly**.
  - `npx jest test/unit/wm/goodsIssueClients.test.js test/unit/wm/goodsIssueController.test.js`: **92 passed, 92 total tests (100% green)**.
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 206 passed, 206 total tests (100% green)**.
  - `npm test` (full project test suite): **68 passed, 68 total test suites; 871 passed, 871 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Eliminate Assumed Storage Unit (SU) Data & Reconcile with Authentic SAP Warehouse Objects (Inbound Delivery, Purchase Order, and Batch)
- **Change**: Eliminated assumed "Storage Unit (SU)" terminology and data mapping across Goods Receipt and Goods Issue modules. Live S/4HANA probes against Client 220 proved that warehouse `0001` operates on standard MM-IM with 0 active EWM Handling Units (`/SCWM/PACK_OUTBDLV_SRV/HUSet` is empty `[]`, `WarehouseStorageBin` is `[]`, `WarehouseTask` is `[]`). Scanned identifiers are authentic Inbound Deliveries (`DeliveryDocument`), Purchase Orders (`PurchaseOrder`), or Batches (`Batch`).
  1. **Goods Receipt presentation layer**:
     - `app/fiori-app/webapp/i18n/i18n.properties`: Replaced "Storage Unit (101)" with "Inbound Delivery / PO (101)", "Storage Unit Barcode Scanning & Lookup" with "Inbound Document Barcode Scanning & Lookup", "Scan Material Barcode / Storage Unit Number" with "Scan Inbound Delivery / PO / Material Barcode", "Storage Unit Details" with "Receipt Details", and "Storage Unit:" with "Document Number:".
     - `app/fiori-app/webapp/modules/wm/goods-receipt/controller/GoodsReceipt.controller.js`:
       - Camera scan prompt updated to "Scan Inbound Delivery / PO Barcode".
       - Empty scan validation updated to "Please scan or enter an Inbound Delivery, Purchase Order, or Material Number."
       - `ScannedTypeLabel` and `ScannedType` default to authentic Inbound Delivery / Purchase Order.
       - Posting confirmation dialog updated: "Post Goods Receipt (101) in SAP for Inbound Delivery <doc> / Purchase Order <doc>?" instead of "Storage Unit <doc>".
  2. **Goods Issue presentation layer**:
     - `app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js`:
       - When a scanned barcode resolves to a Batch (`ResolvedType === 'BATCH'` or `'GS1_BARCODE'`), lock text and toast report "Auto-detected from Batch <batch>" instead of falsely reporting "Auto-detected from Stock Unit".
       - Step 3 Review check label reports "Batch <batch> auto-detected from scanned batch and SLED verified".
  3. **Backend Adapter & Handlers**:
     - `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`:
       - In `postGoodsReceipt`: directly accepts `PurchaseOrder` in payload along with `DeliveryDocument`.
       - Validation error updated: "Inbound Delivery or Purchase Order is required to post Goods Receipt."
       - Resolves `sDoc = DeliveryDocument || PurchaseOrder || StorageUnit`.
  4. **Unit Tests**:
     - `test/unit/wm/goodsReceiptController.test.js`: Updated assertions for empty input error message and confirmation dialog text.
     - `test/unit/wm/goodsReceiptService.test.js`: Updated assertion for postGoodsReceipt missing document error message.
     - `test/unit/wm/goodsIssueController.test.js`: Added test asserting lock text and success message report "Auto-detected from Batch" when barcode resolves to a Batch.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/integration/s4hana/wm/ test/unit/wm/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.6 s; Component-preload.js generated cleanly**.
  - `npx jest test/unit/wm/goodsReceiptController.test.js test/unit/wm/goodsReceiptService.test.js test/unit/wm/goodsIssueController.test.js`: **105 passed, 105 total (100% green)**.
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 207 passed, 207 total tests (100% green)**.
  - `npm test` (full project test suite): **68 passed, 68 total test suites; 872 passed, 872 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.
### 2026-09-21 — Eliminate Synthetic Packaging Unit Barcode `<material>-<unit>` (Audit Item 42)
- **Change**: Eliminated synthetic `Barcode: <material>-<unit>` across Goods Issue domain clients, service definitions, and fixtures. S/4HANA `MMIM_MATERIAL_DATA_SRV/Material2Auoms` (MARM) provides authentic alternative units of measure, numerators, and denominators, but does not provide barcode strings. Previously, synthetic barcodes were invented on alternative units and fallback base unit objects.
  1. **Backend Integration**:
     - `srv/integration/s4hana/wm/goods-issue/GoodsIssueBatchesClient.js`: Removed `Barcode: `${sMat}-${u.AlternativeUnit}`` from `getMaterialPackagingUnits`.
     - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`: Removed `Barcode: `${r.Product}-${baseUnit}`` from fallback base unit packaging object in `getOpenItems`.
     - `srv/wm/goods-issue/service.cds`: Removed `Barcode : String(40);` from `type PackagingUnit`.
  2. **Test & Fixture Synchronization**:
     - `test/unit/wm/fixtures/goodsIssueFixtures.js`: Removed synthetic `Barcode` fields from mock packaging units.
     - `test/unit/wm/goodsIssueClients.test.js`: Verified `units[0].Barcode` is `undefined` on mapped packaging units and fallback base units.
     - `docs/data-lineage-audit.md`: Marked audit item 42 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx cds compile srv`: **Clean (0 errors)**.
  - `npx eslint srv/integration/s4hana/wm/ test/unit/wm/`: **0 errors, 0 warnings (100% clean)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 720 ms; Component-preload.js generated**.
  - `npx jest test/unit/wm/`: **7 passed, 7 total test suites; 207 passed, 207 total tests (100% green)**.
  - `npm test` (full project test suite): **68 passed, 68 total test suites; 872 passed, 872 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit Items 15 and 16 to `feature/CL01`.

### 2026-09-21 — Eliminate Borrowed Sales Office & Sales Group in Sales Inquiry Detail (Audit Item 15)
- **Change**: Eliminated synthetic borrowing of `SalesOffice` and `SalesGroup` in `SalesInquiryAdapter.js` (`getInquiry`). Previously, if an inquiry header in SAP had blank sales office/group fields, the adapter borrowed values from other historical inquiries of the same customer (`C_InquiryWL_F2370`) or defaulted to the first office/group in value help (`C_SalesOfficeValueHelp`, `C_SalesGroupValueHelp`).
  1. **Backend Integration**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: Removed customer historical inquiry lookup and first-match value help fallback for `SalesOffice` and `SalesGroup`. If `header.SalesOffice` or `header.SalesGroup` is empty on the SAP document, it remains blank (`''`). Authentic name resolution (`SalesOfficeName`, `SalesGroupName`) is executed only when the corresponding code is present on the document.
  2. **Unit Tests**:
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Replaced test asserting borrowed office/group with test asserting `SalesOffice: ''`, `SalesOfficeName: ''`, `SalesGroup: ''`, and `SalesGroupName: ''` when SAP returns empty fields.
     - `docs/data-lineage-audit.md`: Marked audit item 15 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **0 errors, 0 warnings (100% clean)**.
  - `npx jest test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **28 passed, 28 total (100% green)**.
  - `npx jest test/unit/sales-inquiry/`: **10 passed, 10 total test suites; 132 passed, 132 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.

### 2026-09-21 — Eliminate Sold-to Substitution for Ship-to Party in Sales Inquiry Detail (Audit Item 16)
- **Change**: Eliminated substitution of `SoldToParty` for `ShipToParty` in `SalesInquiryAdapter.js` (`getInquiry`). When SAP S/4HANA returns no partner card with function 'WE', the adapter previously stamped `header.ShipToParty = header.SoldToParty` and `header.ShipToPartyName = header.OrganizationBPName1`.
  1. **Backend Integration**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: Removed `if (!header.ShipToParty && header.SoldToParty)` substitution. Leaves `ShipToParty` and `ShipToPartyName` blank (`''`) when SAP partner card returns no Ship-to party.
  2. **Frontend Presentation**:
     - `app/fiori-app/webapp/modules/sd/sales-inquiry/view/SalesInquiryDetail.view.xml`: Updated expression binding for Ship-to party to render `'-'` when `ShipToParty` and `ShipToPartyName` are empty, ensuring consistent presentation with Sales Office and Sales Group.
  3. **Unit Tests**:
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Added assertions that `ShipToParty` and `ShipToPartyName` are `''` when SAP returns no partner function 'WE'.
     - `docs/data-lineage-audit.md`: Marked audit item 16 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.05 s; Component-preload.js generated cleanly**.
  - `npx jest test/unit/sales-inquiry/`: **10 passed, 10 total test suites; 132 passed, 132 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Eliminate Derived Item Net Price in Sales Inquiry Detail (Audit Item 17)
- **Change**: Eliminated synthetic `NetPriceAmount` calculation (`NetAmount / OrderQuantity`, else `'0.00'`) in `SalesInquiryAdapter.js` (`getInquiry`). Previously, when SAP S/4HANA sent no `NetPriceAmount` on the line items, the adapter divided net amount by quantity or defaulted to `'0.00'`.
  1. **Backend Integration**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: Removed `qty > 0 ? (net / qty).toFixed(2) : '0.00'`. Leaves `NetPriceAmount` blank (`''`) when SAP sends no net price.
  2. **Unit Tests**:
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Updated assertion in `getInquiry fetches WL header, FS header, and FS items concurrently` to assert `items[0].NetPriceAmount === ''` when SAP returns no net price on line items.
     - `docs/data-lineage-audit.md`: Marked audit item 17 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx eslint srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **0 errors, 0 warnings (100% clean)**.
  - `npx jest test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **28 passed, 28 total (100% green)**.
  - `npx jest test/unit/sales-inquiry/`: **10 passed, 10 total test suites; 132 passed, 132 total tests (100% green)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Show Authentic SAP PO Status Name, Map Deletion Code L to Deleted, and Eliminate Fallthrough to "Approved" (Audit Item 4)
- **Change**: Eliminated assumed PO status text heuristic in `app/fiori-app/webapp/model/formatter.js`. Previously, deletion flag `'L'` was presented as `"Rejected"`, SAP status names like `"Sent"` or `"Follow-On Documents"` were overridden with `"Approved"`, and any unrecognized status code fell through to `return "Approved"`.
  1. **Frontend Formatter**:
     - `app/fiori-app/webapp/model/formatter.js`:
       - `_resolveDisplayStatus`: Prioritizes deletion flag `'L'` as `"Deleted"`. Returns authentic SAP status name (`sStatusName`) if present. Falls back to standard S/4HANA status code mappings (`01` -> Draft, `02` -> In Approval, `04` -> Sent, `05` -> Follow-On Documents, `38` -> Rejected). Unknown status codes display their raw code (`sStatusCode`), eliminating default fallthrough to `"Approved"`.
       - `displayStatusState`: Added case for `"Deleted"` (`Error`), `"Sent"` / `"Follow-On Documents"` (`Success`), and defaults unknown raw codes to `None`.
       - `displayStatusIcon`: Added case for `"Deleted"` (`sap-icon://decline`), `"Sent"` / `"Follow-On Documents"` (`sap-icon://accept`), and defaults unknown raw codes to `""`.
  2. **Unit Tests & Documentation**:
     - `test/unit/purchase-order/formatter.test.js`: Updated assertions to verify authentic status names (`Sent`, `Follow-On Documents`), deletion code `'L'` mapping to `"Deleted"`, and unknown codes (`"99"`, `"Z1"`) returning raw code with `None` state.
     - `docs/data-lineage-audit.md`: Marked audit item 4 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/purchase-order/formatter.test.js`: **12 passed, 12 total (100% green)**.
  - `npx jest test/unit/purchase-order/`: **15 passed, 15 total test suites; 177 passed, 177 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 904 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 — Eliminate Assumed PO KPIs: Server Count for Suppliers, Remove Completeness Rate, Live Total Count (Audit Items 5, 6 & 7)
- **Change**: Eliminated assumed and page-scoped KPI calculations in `BaseController.js`, `PurchaseOrders.view.xml`, and `PurchaseOrders.controller.js`. Previously, supplier count was counted only among loaded rows (falling back to the PO count when 0), completeness rate was calculated over loaded rows (defaulting to 100 when empty), and total count fell back to loaded rows when `$count` was absent.
  1. **BaseController**:
     - `app/fiori-app/webapp/controller/BaseController.js`: Refactored `calculateKpiMetrics` to extract `total` strictly from `oEvent.getParameter("total")` (or `"-"` if absent), eliminating loaded-row fallbacks, page-scoped supplier counting, and client completeness rate formulas.
  2. **View Cleanup**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/view/PurchaseOrders.view.xml`: Removed synthetic `<GenericTile id="kpiComplete">` (Completeness Rate). Retained authentic live KPIs: `kpiTotalOrders` and `kpiSuppliers`.
  3. **Controller Integration**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller.js`: Injected `ODataClient` and implemented `_loadServerSupplierCount()`, querying live S/4HANA unique supplier count via `/odata/v4/purchase-order/getDashboardMetrics()` (cached master data from `C_MM_SupplierValueHelp`). Wired `_loadServerSupplierCount()` into `onInit`, `_onRouteMatched`, and `onRefresh`. Removed `completeRate` from `viewModel`.
  4. **Unit Tests & Documentation**:
     - `test/unit/controller/BaseController.test.js`: Added unit tests verifying authentic total count extraction and absence of synthetic supplier/completeness counts.
     - `test/unit/purchase-order/purchaseOrdersFilterSort.test.js`: Updated controller tests with `mockODataClient` to test `_loadServerSupplierCount`, error fallback to `"-"`, `_updateKpiMetrics`, and absence of `completeRate`.
     - `docs/data-lineage-audit.md`: Marked audit items 5, 6, and 7 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/controller/BaseController.test.js test/unit/purchase-order/purchaseOrdersFilterSort.test.js`: **2 passed, 2 total test suites; 41 passed, 41 total tests (100% green)**.
  - `npx jest test/unit/purchase-order/`: **15 passed, 15 total test suites; 183 passed, 183 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.23 s; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `feature/CL01`.

### 2026-09-21 15:25 IST — Eliminate Page-Only KPI Scraping & Silent Zero Fallbacks in Sales Orders & Inquiries (Audit Items 20, 21, 22)
- **Change**: Eliminated page-only KPI calculations in `SalesOrders.controller.js` and `SalesInquiries.controller.js`, unified the definition of "Open" sales documents across the application to S/4HANA standard `OverallSDProcessStatus ne 'C'`, and fixed the silent zero error-masking bug in `salesOrder.handler.js`.
  1. **S/4HANA Gateway Integration & CAP Handlers**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: Extended `getSalesMetrics(options)` to support `options.entity === 'inquiry'`, directing the count query to `SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370` with `$filter=OverallSDProcessStatus ne 'C'` and `$inlinecount=allpages&$top=1`. Preserved default querying of `SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873` with `$filter=OverallSDProcessStatus ne 'C'` for sales orders.
     - `srv/sd/sales-order/handlers/salesOrder.handler.js`: Fixed Audit Item 22 silent zero bug. Removed catch block returning `{ openOrdersCount: 0, totalOrdersCount: 0 }`; now propagates backend errors via `req.error(error.status || 502, error.message)`.
     - `srv/sd/sales-inquiry/handlers/salesInquiry.handler.js`: Updated `getSalesOrderMetrics` handler to pass `{ entity: 'inquiry' }` to `salesInquiryAdapter.getSalesMetrics()`.
  2. **Fiori UI Presentation Layer**:
     - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`: Injected `ODataClient`. Initialized `salesOrdersView` model with `totalCount: "-"`, `openCount: "-"`, `customerCount: "-"`. In `onUpdateFinished`, eliminated loaded-row loop (`aItems.forEach`) and loaded-length fallback (`iTotal || aItems.length`); strictly sets `totalCount` via `calculateKpiMetrics(oTable, oEvent)` (displaying `"-"` when `$count` is absent). Added `_loadServerMetrics` to fetch authentic open order count from `/odata/v4/sales-order/getSalesOrderMetrics()` and active customer count from `/odata/v4/purchase-order/getDashboardMetrics()` (backed by `I_Customer_VH`). Wired `_loadServerMetrics` into `onInit`, `_onRouteMatched`, and `onRefresh`.
     - `app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiries.controller.js`: Injected `ODataClient`. Initialized `salesInquiriesView` model with `totalCount: "-"`, `openCount: "-"`, `customerCount: "-"`. In `onUpdateFinished`, eliminated loaded-row loop (`aItems.forEach`) and loaded-length fallback; strictly sets `totalCount` via `calculateKpiMetrics(oTable, oEvent)`. Added `_loadServerMetrics` to fetch authentic open inquiry count from `/odata/v4/sales-inquiry/getSalesOrderMetrics()` and active customer count from `/odata/v4/purchase-order/getDashboardMetrics()`. Wired `_loadServerMetrics` into `onInit`, `_onRouteMatched`, and `onRefresh`.
  3. **Unit Tests & Documentation**:
     - `test/unit/sales-order/salesOrderService.test.js`: Added test verifying error propagation in `getSalesOrderMetrics` handler (proving silent zero elimination).
     - `test/unit/dashboard/dashboardMetrics.test.js`: Added test verifying `getSalesMetrics({ entity: 'inquiry' })` queries `SD_F2370_INQY_WL_SRV` with `OverallSDProcessStatus ne 'C'`.
     - `test/unit/sales-order/salesOrdersController.test.js`: Updated with `calculateKpiMetrics` and `MockODataClient`. Tested initial `"-"` state, asynchronous metrics population (`openCount: 42`, `customerCount: 88`), and `totalCount` strictly reflecting binding `$count`.
     - `test/unit/sales-inquiry/salesInquiriesController.test.js`: Updated with `calculateKpiMetrics` and `MockODataClient`. Tested initial `"-"` state, asynchronous metrics population (`openCount: 15`, `customerCount: 88`), and `totalCount` strictly reflecting binding `$count`.
     - `docs/data-lineage-audit.md`: Marked items 20, 21, and 22 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/sales-order/ test/unit/sales-inquiry/`: **15 passed, 15 total test suites; 189 passed, 189 total tests (100% green)**.
  - `npx jest test/unit/purchase-order/ test/unit/controller/ test/unit/dashboard/ test/unit/wm/`: **24 passed, 24 total test suites; 426 passed, 426 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 883 ms; Component-preload.js generated**.
  - `npx eslint srv/ test/`: **Clean (0 errors, 0 warnings)**.
  - `npx cds compile srv`: **Clean (0 errors)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 15:35 IST — Relabel Journal Entries KPI to Total Line Items and Eliminate Page-Only Calculations & Forced Zeros (Audit Item 28)
- **Change**: Eliminated page-only scraped calculations and forced zero states in `JournalEntries.controller.js` and relabeled the KPI tile from "Total Documents" to "Total Line Items" to accurately describe the underlying S/4HANA `JournalEntryItems` projection on `C_GLJrnlEntryItemToBeVerified`.
  1. **i18n & Presentation**:
     - `app/fiori-app/webapp/i18n/i18n.properties` & `app/fiori-app/webapp/i18n/i18n_en.properties`: Relabeled `fiKpiTotalDocs=Total Line Items` and added `fiKpiTotalItems=Total Line Items` (with tooltip "Total line items awaiting verification").
     - `app/fiori-app/webapp/modules/fi/journal-entry/view/JournalEntries.view.xml`: Updated `<GenericTile id="kpiTotalDocs">` header binding to `{i18n>fiKpiTotalItems}` and value binding to `{fiView>/totalCount}`.
  2. **Controller Refactoring**:
     - `app/fiori-app/webapp/modules/fi/journal-entry/controller/JournalEntries.controller.js`:
       - Injected `ODataClient`.
       - `onInit`: Initialized `fiView` with `totalCount: "-"` and `glAccountCount: "-"` (eliminating forced `0` initial state). Attached route pattern match listener on route `"journalEntries"`.
       - `_onRouteMatched`: Refreshes table binding safely and triggers `_loadServerMetrics()`.
       - `_loadServerMetrics()`: Fetches authentic unique G/L account count from `/odata/v4/purchase-order/getDashboardMetrics()` (backed by cached S/4HANA `I_GLAccountStdVH` master data). On failure/error, sets `glAccountCount: "-"`, never defaulting to `0`.
       - `onUpdateFinished`: Uses `calculateKpiMetrics(oTable, oEvent)` to strictly extract the binding `$count` parameter for `totalCount` (displaying `"-"` if absent or not a number). Completely eliminated the loaded-row loop (`aItems.forEach(...)`) that counted unique G/L accounts only from the visible page.
       - `onRefresh`: Refreshes table binding, re-invokes `_loadServerMetrics()`, and shows feedback message toast.
  3. **Unit Tests & Documentation**:
     - `test/unit/fi/journalEntriesController.test.js`: Created unit test suite covering initial `"-"` states, `_onRouteMatched` lifecycle, `onUpdateFinished` binding `$count` extraction, `_loadServerMetrics` parsing and error fallback to `"-"`, multi-field search filtering, refresh, item press toast, and nav back.
     - `docs/data-lineage-audit.md`: Marked audit item 28 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/fi/journalEntriesController.test.js`: **1 passed, 1 total test suite; 11 passed, 11 total tests (100% green)**.
  - `npx jest test/unit/controller/ test/unit/purchase-order/ test/unit/sales-order/ test/unit/sales-inquiry/ test/unit/fi/`: **33 passed, 33 total test suites; 395 passed, 395 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 773 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 15:40 IST — Hardened Error Propagation & Comprehensive Tests for Sales Order Metrics (Audit Item 22 Parity)
- **Change**: Verified and hardened error propagation for `getSalesOrderMetrics` in both Sales Order and Sales Inquiry CAP handlers, ensuring full parity with S/4HANA error handling discipline.
  1. **CAP Handlers**:
     - `srv/sd/sales-order/handlers/salesOrder.handler.js`: Verified error propagation via `req.error(error.status || 502, error.message)` and error re-throwing when called without `req`, strictly eliminating the previous silent zero `{ openOrdersCount: 0, totalOrdersCount: 0 }` fallback.
     - `srv/sd/sales-inquiry/handlers/salesInquiry.handler.js`: Added error logging `LOG.error('Error fetching sales inquiry metrics:', error.message)` before returning `req.error(error.status || 502, error.message)` for consistency with `salesOrder.handler.js`.
  2. **Unit Tests**:
     - `test/unit/sales-order/salesOrderService.test.js`: Added tests verifying that `getSalesOrderMetrics` defaults to HTTP 502 when `error.status` is absent, and throws when `req` is absent.
     - `test/unit/sales-inquiry/createSalesInquiryHandler.test.js`: Added comprehensive `getSalesOrderMetrics` test suite covering adapter delegation with `{ entity: 'inquiry' }`, error propagation via `req.error`, HTTP 502 fallback, and re-throwing when `req` is absent.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/sales-order/salesOrderService.test.js test/unit/sales-inquiry/createSalesInquiryHandler.test.js`: **2 passed, 2 total test suites; 22 passed, 22 total tests (100% green)**.
  - `npx jest test/unit/sales-order/ test/unit/sales-inquiry/`: **15 passed, 15 total test suites; 195 passed, 195 total tests (100% green)**.
  - `npx jest test/unit/`: **58 passed, 58 total test suites; 856 passed, 856 total tests (100% green)**.
  - `npx eslint srv/ test/`: **0 errors, 0 warnings (100% clean)**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 15:45 IST — Eliminate Local Formula & Read Authentic NetAmount, TotalAmount, and DocumentCurrency from S/4HANA (Audit Item 26)
- **Change**: Eliminated assumed client-side `qty x price` formula and non-existent `d.NetValue` / `d.Currency` fallbacks in `SalesInquiryAdapter.js` (`createSalesDocument`). Previously, both deep insert (Sales Order) and sequential (Sales Inquiry) paths accumulated a local `totalNet = qty * price` and returned it, bypassing S/4HANA's pricing engine (discounts, taxes, condition records) and attempting to fall back to `NetValue` which does not exist in `LORD_ODATA_ORDER_SRV`.
  1. **Backend Integration**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`:
       - Inspected live S/4HANA `$metadata` for `LORD_ODATA_ORDER_SRV` `Header` and verified authentic properties: `NetAmount` (Edm.Decimal), `TotalAmount` (Edm.Decimal), `TaxAmount` (Edm.Decimal), and `DocumentCurrency` (Edm.String).
       - In deep insert branch (Sales Order), extracts `s4Header.NetAmount`, `s4Header.TotalAmount`, `s4Header.TaxAmount`, and `s4Header.DocumentCurrency` directly from the S/4HANA 201 response. Authentic SAP `NetAmount` is prioritized as `TotalNetAmount` over any local arithmetic.
       - In sequential branch (Sales Inquiry), added support for `options.readBack` to read back persisted Header from `HeaderSet('<SalesOrderID>')`, extracting authentic `NetAmount`, `TotalAmount`, `TaxAmount`, and `DocumentCurrency`.
       - Exposes structured fields `NetAmount`, `TotalAmount`, `TaxAmount`, and `TransactionCurrency` (authentically sourced from SAP's `DocumentCurrency`).
  2. **Unit Tests & Documentation**:
     - `test/unit/sales-order/salesOrderAdapter.test.js`: Added test proving that `createSalesOrder` returns SAP's authentic `NetAmount`, `TotalAmount`, `TaxAmount`, and `DocumentCurrency`, and that SAP's `NetAmount` overrides any client `qty * price` formula.
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Added test proving that `createSalesInquiry` with `readBack: true` extracts authentic `NetAmount`, `TotalAmount`, `TaxAmount`, and `DocumentCurrency` from S/4HANA.
     - `docs/data-lineage-audit.md`: Marked audit item 26 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/sales-order/salesOrderAdapter.test.js test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **2 passed, 2 total test suites; 41 passed, 41 total tests (100% green)**.
  - `npx jest test/unit/sales-order/ test/unit/sales-inquiry/`: **15 passed, 15 total test suites; 197 passed, 197 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.00 s; Component-preload.js generated**.
  - `npx eslint srv/ test/`: **Clean (0 errors, 0 warnings)**.
  - `git diff --check`: **Clean (0 errors)**.
### 2026-09-21 15:52 IST — Label Supplier Defaults as "from last PO" and Order by Most Recent PO (Audit Item 10)
- **Change**: Resolved assumed data lineage on PO creation where supplier commercial terms (Currency, PaymentTerms, Incoterms, IncotermsLocation1) were derived from an unordered `limit(1)` historical PO and presented without source attribution:
  1. **Backend CAP Service & Handler**:
     - `srv/mm/purchase-order/service.cds`: Added `source: String;` and `lastPurchaseOrder: String;` to `getSupplierDefaults` return type.
     - `srv/mm/purchase-order/handlers/purchaseOrder.handler.js`: Updated `findPoWithDefaults` to query `'PurchaseOrder'` and sort `.orderBy({ ref: ['PurchaseOrder'], sort: 'desc' })`, guaranteeing that terms are derived from the most recent historical PO. Returns `source: 'from last PO'` and `lastPurchaseOrder: po.PurchaseOrder || ''`.
  2. **Frontend Service, Model & View**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService.js`: Propagated `source` and `lastPurchaseOrder`; updated resilient fallback historical PO query to sort by `$orderby=PurchaseOrder desc` and return `source: 'from last PO'`.
     - `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js`:
       - Added `supplierDefaultsDerived`, `supplierDefaultsSource`, `supplierDefaultsLastPo`, and `supplierDefaultsMessage` to initial model.
       - In `deriveSupplierDefaults`, populates `supplierDefaultsSource` (e.g. "from last PO 4500000001") and `supplierDefaultsMessage` ("Commercial terms derived from last PO (4500000001). Verify before submitting.").
       - In `markUserModified`, automatically resets `configDerived[sField] = false` when user manually edits a derived field, clearing the derived label.
     - `app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller.js`: Updated toast notification in `_deriveSupplierData` to include `(from last PO)`.
     - `app/fiori-app/webapp/modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml`:
       - Added `ObjectStatus id="statusSupplierDefaults"` in `panelSupplierTerms` header toolbar displaying `{newPO>/supplierDefaultsSource}`.
       - Added `MessageStrip id="msgStripSupplierDefaults"` informing user that terms were derived from the last PO.
       - Dynamic field labels for Currency, Payment Terms, Incoterms, and Incoterms Location annotated with `(from last PO)` via expression binding while `configDerived` is active.
     - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`: Added `labelFromLastPo=from last PO` and `msgSupplierDefaultsFromLastPo`.
  3. **Unit Tests & Documentation**:
     - `test/unit/purchase-order/getSupplierDefaultsHandler.test.js`: Added 3 tests verifying CAP handler query ordering by `PurchaseOrder desc`, selection of `PurchaseOrder`, and source attribution.
     - `test/unit/purchase-order/poConfigDefaulting.test.js`: Added tests verifying fallback query ordering by `PurchaseOrder desc`, model source/message setting, and `markUserModified` resetting `configDerived`.
     - `docs/data-lineage-audit.md`: Marked audit item 10 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/purchase-order/`: **16 passed, 16 total test suites; 189 passed, 189 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.3 s; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Implement Audit Item 11: PO line "Net Amount" on create screen (label as estimate).

### 2026-09-21 16:00 IST — Explicitly Label PO Line Net Amount as Estimate on Create Screen (Audit Item 11)
- **Change**: Resolved assumed data lineage on Create PO where the client-side calculated `OrderQuantity x NetPriceAmount` formula in the browser was presented as "Net Amount" before S/4HANA prices the document:
  1. **Frontend i18n & View**:
     - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`:
       - Relabeled `poColNetAmount` from `Net Amount` to `Net Amount (Estimate)`.
       - Added `poTooltipNetAmountEst=Estimated value (Quantity x Net Price). Final net amount is calculated by SAP S/4HANA upon creation.`.
     - `app/fiori-app/webapp/modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml`:
       - Updated column header with width `10rem`, label `poColNetAmount`, and tooltip `poTooltipNetAmountEst`.
       - Updated disabled input with tooltip `poTooltipNetAmountEst` so hover informs user that it is a pre-creation estimate.
       - Confirmed authentic S/4HANA persisted `NetAmount` remains displayed on Detail page (`PurchaseOrderDetail.view.xml`) after save.
  2. **Model & Architecture**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js`:
       - Added `NetAmountIsEstimate: true` to line items in `createInitialModel` and `addItem`.
       - Updated `calculateItemNetAmount` to document that it is a client-side pre-creation estimate and set `NetAmountIsEstimate: true`.
  3. **Unit Tests & Documentation**:
     - `test/unit/purchase-order/poItemNetAmountEstimate.test.js`: Added 5 unit tests verifying item initialization, decimal formatting, estimate flags, and calculation logic.
     - `docs/data-lineage-audit.md`: Marked audit item 11 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/purchase-order/poItemNetAmountEstimate.test.js`: **1 passed, 1 total test suite; 5 passed, 5 total tests (100% green)**.
  - `npx jest test/unit/purchase-order/`: **17 passed, 17 total test suites; 194 passed, 194 total tests (100% green)**.
  - `cd app/fiori-app && npx ui5lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.11 s; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Implement Audit Item 12: PO document type default (require the field).

### 2026-09-21 16:15 IST — Require PO Document Type and Eliminate Hardcoded "NB" Defaults (Audit Item 12)
- **Change**: Resolved assumed data lineage where Purchase Order document type defaulted to `"NB"` in the UI initial model and fell back to `'NB'` in the backend normalization mapper:
  1. **Backend Mapper Validation**:
     - `srv/mm/purchase-order/mapping/purchaseOrder.mapper.js`:
       - Removed fallback `|| 'NB'`.
       - Added explicit validation check throwing an Error if `data.header.PurchaseOrderType` is missing or empty (`'PurchaseOrderType (Document Type) is required'`).
       - Normalized non-empty `PurchaseOrderType` with `.trim().toUpperCase()`.
  2. **Frontend UI & Model**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js`:
       - In `createInitialModel`: Changed default `header.PurchaseOrderType` from `"NB"` to `""`.
       - Initial header status set to `StatusState: "Warning"`, `StatusIcon: "sap-icon://alert"` reflecting that Document Type is unpopulated and required.
       - In `applyConfigurationDefaults`: Removed `|| sCurrentDocType === "NB"` fallback condition.
     - `app/fiori-app/webapp/modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml`:
       - Marked `<Input id="inDocType" ... required="true">` to clearly indicate requirement in Fiori UI.
  3. **Unit Tests & Documentation**:
     - `test/unit/purchase-order/domainMapping.test.js`: Added unit test asserting `normalizePurchaseOrderData` throws an error when `PurchaseOrderType` is empty.
     - `test/unit/purchase-order/createPORefreshRouting.test.js`: Updated initial model assertion expecting `PurchaseOrderType === ""` instead of `"NB"`.
     - `test/unit/purchase-order/createPurchaseOrderStatus.test.js`: Updated initial model status and error handling expectations; updated valid form submission test to explicitly provide `PurchaseOrderType: 'NB'`.
     - `docs/data-lineage-audit.md`: Updated Audit Item 12 to `RESOLVED`.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/purchase-order/createPurchaseOrderStatus.test.js`: **1 passed, 1 total test suite; 22 passed, 22 total tests (100% green)**.
  - `npx jest test/unit/purchase-order/`: **17 passed, 17 total test suites; 195 passed, 195 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 919 passed, 919 total tests (100% green)**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 728 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Implement Audit Item 23: Customer defaults on create screens (remove 'IN').

### 2026-09-21 16:30 IST — Eliminate Hardcoded 'IN' Country Fallback in Customer Defaults (Audit Item 23)
- **Change**: Resolved assumed data lineage in `SalesInquiryAdapter.js` where customer master queries defaulted `Country` to `'IN'` when `cust.Country` was absent or empty in SAP `I_Customer_VH`:
  1. **Adapter Customer Defaults**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`:
       - Changed `Country: cust.Country || 'IN'` to `Country: cust.Country || ''`.
       - Changed `sCountry = custResult.value.Country || 'IN';` to `sCountry = custResult.value.Country || '';`.
       - Authentic country from S/4HANA customer master is preserved and returned; when absent or null in S/4HANA, empty string is returned without assuming `'IN'`.
  2. **Unit Tests & Documentation**:
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Added unit test verifying `getCustomerDefaults` returns `Country: ''` when customer has no country in SAP master data, and returns authentic non-IN country (`'DE'`) when present.
     - `docs/data-lineage-audit.md`: Updated Audit Item 23 reflecting removal of hardcoded `'IN'`.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **1 passed, 1 total test suite; 27 passed, 27 total tests (100% green)**.
  - `npx jest test/unit/sales-inquiry/`: **10 passed, 10 total test suites; 140 passed, 140 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 920 passed, 920 total tests (100% green)** in 96.7 s.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 969 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 — Validate and Reject Blank Org Values and Eliminate cds.s4 Fallbacks (Audit Item 25)
- **Change**: Eliminated silent `cds.s4` fallbacks on write across all three layers (`salesInquiry.mapper.js`, `SalesInquiryMapper.js`, and `SalesInquiryAdapter.js`). Previously, if a screen or client sent blank org values (`SalesOrganization`, `DistributionChannel`, `OrganizationDivision`), docType, or currency, each layer silently filled them from `cds.s4` config before POSTing to S/4HANA. Now, all three layers validate and strictly reject missing or blank values.
  1. **Mapper & Normalization**:
     - `srv/sd/sales-inquiry/mapping/salesInquiry.mapper.js`: Removed `s4Config` import and all silent fallbacks (`s4Config.getCurrency()`, `s4Config.getSalesOrganization()`, `s4Config.getDistributionChannel()`, `s4Config.getDivision()`, `s4Config.getInquiryType()`, `s4Config.getOrderType()`). Missing fields normalize to `""` instead of injecting config values.
  2. **Backend Payload Mapper**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper.js`: Removed `s4Config` import. Added strict validation in `mapToS4InquiryPayload` throwing Error if `SalesInquiryType`, `SalesOrganization`, `DistributionChannel`, `OrganizationDivision`, or `TransactionCurrency` is missing or blank. Added identical validation in `mapToS4OrderPayload` for `SalesOrderType` and org fields.
  3. **S/4HANA Integration Adapter**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: In `createSalesDocument`, removed all `|| s4Config.get...` fallbacks for `SalesOrganization`, `DistributionChannel`, `Division`, docType, and currency. Added validation throwing an Error if docType or org fields are missing or blank. Added validation in `createSalesInquiry` and `createSalesOrder` to require non-empty docTypes before delegation.
  4. **Validation Layer**:
     - `srv/sd/sales-inquiry/validation/salesInquiry.validation.js`: Marked `TransactionCurrency` as strictly required in `validateCreateSalesDocumentPayload` (rejects missing, blank, or invalid 3-letter ISO code).
  5. **Unit Tests & Documentation**:
     - `test/unit/sales-inquiry/salesInquiryValidation.test.js`: Added `TransactionCurrency` to missing fields tests; added test verifying blank/whitespace-only required header fields are rejected.
     - `test/unit/sales-inquiry/salesInquiryMapping.test.js`: Updated tests with explicit org headers and currency; added tests asserting rejection of missing/blank org values, docType, and currency.
     - `test/unit/sales-order/salesOrderAdapter.test.js`: Updated tests with explicit org headers; added test verifying rejection of missing/blank org values in `createSalesOrder`.
     - `test/unit/sales-inquiry/salesInquiryAdapter.test.js`: Updated tests with explicit org headers; added tests verifying rejection of missing/blank org values and docType in `createSalesInquiry`.
     - `docs/data-lineage-audit.md`: Updated Audit Item 25 to `RESOLVED`.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/sales-inquiry/salesInquiryValidation.test.js test/unit/sales-inquiry/salesInquiryMapping.test.js`: **2 passed, 2 total test suites; 29 passed, 29 total tests (100% green)**.
  - `npx jest test/unit/sales-order/salesOrderAdapter.test.js`: **1 passed, 1 total test suite; 13 passed, 13 total tests (100% green)**.
  - `npx jest test/unit/sales-inquiry/salesInquiryAdapter.test.js`: **1 passed, 1 total test suite; 32 passed, 32 total tests (100% green)**.
  - `npx jest test/unit/sales-inquiry/ test/unit/sales-order/`: **15 passed, 15 total test suites; 204 passed, 204 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 926 passed, 926 total tests (100% green)** in 75.7 s.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 984 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 — Eliminate Literal Shipping Point Table and Bind Dialog to ShippingPointVH (Audit Item 32)
- **Change**: Eliminated hardcoded shipping point literal table (`DEFAULT_SHIPPING_POINTS` with invented names like `"1112 - Shipping Point 1112"`) in `OrdersDueForDelivery.controller.js` and bound the create delivery dialog ComboBox directly to `outboundDelivery>/ShippingPointVH`.
  1. **Frontend View Fragment**:
     - `app/fiori-app/webapp/modules/le/outbound-delivery/view/CreateDeliveryDialog.fragment.xml`: Bound `comboDeliveryShippingPoint` items directly to `outboundDelivery>/ShippingPointVH` with `sorter: { path: 'ShippingPoint' }`. Uses `core:ListItem` displaying authentic SAP `ShippingPoint` and `ShippingPointName` from `C_ShippingPointVH` (`text="{= ${outboundDelivery>ShippingPointName} ? ${outboundDelivery>ShippingPoint} + ' - ' + ${outboundDelivery>ShippingPointName} : ${outboundDelivery>ShippingPoint} }"` and `additionalText="{outboundDelivery>ShippingPointName}"`).
  2. **Controller Logic**:
     - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`:
       - Removed literal array `DEFAULT_SHIPPING_POINTS`.
       - Updated `_loadShippingPoints` to call `OutboundDeliveryService.getShippingPoints()` (which queries `/ShippingPointVH`), formatting entries dynamically from `ShippingPoint` and `ShippingPointName` / `ShippingPoint_Text`.
       - In `onCreateDeliveryPress`, eliminated fallback to config shipping point (`oDialogModel.getProperty("/shippingPoint")`). If the due order row has no `ShippingPoint`, the selection remains empty, requiring user selection.
     - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`:
       - Updated `_loadShippingPoints` to call `OutboundDeliveryService.getShippingPoints()`.
       - In `onCreateDeliveryPress`, eliminated fallback to config shipping point.
  3. **Unit Tests & Documentation**:
     - `test/unit/le/ordersDueForDeliveryController.test.js`: Added `getShippingPoints` mock returning authentic shipping points and names. Added tests verifying `_loadShippingPoints` loads from `getShippingPoints` without literal array and `onCreateDeliveryPress` leaves `shippingPoint` empty when row has no shipping point.
     - `test/unit/sales-order/salesOrdersController.test.js`: Added `getShippingPoints` mock to `MockOutboundDeliveryService`.
     - `docs/data-lineage-audit.md`: Updated Audit Item 32 to `RESOLVED`.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/le/ordersDueForDeliveryController.test.js test/unit/sales-order/salesOrdersController.test.js`: **2 passed, 2 total test suites; 31 passed, 31 total tests (100% green)**.
  - `npx jest test/unit/le/`: **4 passed, 4 total test suites; 48 passed, 48 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 928 passed, 928 total tests (100% green)** in 70.9 s.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 840 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 — Eliminate Fake Success Strings on Document Creation & Return 502 Errors (Audit Item 13)
- **Change**: Eliminated synthetic fake success strings (`'PO Created but no ID returned'`, `'Order Created'`, and `'Inquiry Created'`) returned as document numbers when SAP S/4HANA returns no document ID. Previously, if S/4HANA responded without a document number, the backend returned string literals which the UI treated as valid document numbers, causing misleading success dialogs ("Purchase Order Created: PO Created but no ID returned", "Sales Order Order Created has been successfully created").
  1. **Backend Handlers**:
     - `srv/mm/purchase-order/handlers/purchaseOrder.handler.js`: Replaced `return result.PurchaseOrder || 'PO Created but no ID returned';` with strict validation. If `poNumber` is falsy or blank, logs error and returns `req.error(502, 'S/4HANA Purchase Order creation succeeded but no Purchase Order document number was returned by SAP.')`.
     - `srv/sd/sales-order/handlers/salesOrder.handler.js`: Replaced `return result.SalesOrder || result.SalesDocument || 'Order Created';` with strict validation. If `orderId` is falsy or blank, logs error and returns `req.error(502, 'S/4HANA Sales Order creation succeeded but no Sales Order document number was returned by SAP.')`.
     - `srv/sd/sales-inquiry/handlers/salesInquiry.handler.js`: Replaced `return result.SalesInquiry || 'Inquiry Created';` with strict validation. If `inquiryId` is falsy or blank, logs error and returns `req.error(502, 'S/4HANA Sales Inquiry creation succeeded but no Sales Inquiry document number was returned by SAP.')`.
  2. **Automated Tests**:
     - `test/integration/purchase-order/createPurchaseOrder.test.js`: Added integration test asserting `502 Bad Gateway` when SAP returns no `PurchaseOrder` document number.
     - `test/unit/sales-order/salesOrderService.test.js`: Added unit test asserting `502 Bad Gateway` when SAP returns no `SalesOrder` document number.
     - `test/unit/sales-inquiry/createSalesInquiryHandler.test.js`: Added unit test asserting `502 Bad Gateway` when SAP returns no `SalesInquiry` document number.
  3. **Documentation**:
     - `docs/data-lineage-audit.md`: Marked audit item 13 as RESOLVED.
     - `docs/no-assumed-data-changes.md`: Marked item 3.9 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/integration/purchase-order/createPurchaseOrder.test.js test/unit/sales-order/salesOrderService.test.js test/unit/sales-inquiry/createSalesInquiryHandler.test.js`: **3 passed, 3 total test suites; 32 passed, 32 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 931 passed, 931 total tests (100% green)** in 80.7 s.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 979 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 — Build System Label Dynamically from Environment Settings in User Profile & Auth Adapter (Audit Item 46)
- **Change**: Eliminated contradictory hardcoded system labels (`"DEV - Client 220"` in `auth-service.js` vs `"PRD - Client <n>"` in `AuthAdapter.js`) for the same S/4HANA system. Replaced hardcoded string literals with centralized, dynamic label resolution in `s4Config.js` (`getSystemLabel`) driven by environment settings (`S4_SYSTEM_NAME` and `S4_CLIENT`).
  1. **Central Configuration Module**:
     - `srv/common/s4Config.js`: Added `getSystemName()` (checks `CDS_S4_SYSTEM_NAME`, `S4_SYSTEM_NAME`, `cds.s4.systemName`, falling back to `PRD` in production and `DEV` in development) and `getSystemLabel(clientOverride, systemNameOverride)` (formats `${systemName} - Client ${client}`). Added convenience getters `systemName` and `systemLabel`.
  2. **Auth Service & Auth Adapter**:
     - `srv/auth-service.js`: Replaced `"DEV - Client 220"` in `_resolveUserProfile` (line 56) and `_handleLogin` (lines 109, 123, 168) with `s4Config.getSystemLabel()`.
     - `srv/integration/s4hana/AuthAdapter.js`: Replaced hardcoded `PRD - Client ${sClient}` with `s4Config.getSystemLabel(sClient, options.systemName)`. Prioritizes `process.env.S4_CLIENT` before `s4Config.getClient()` if `options.client` is omitted.
  3. **Automated Tests**:
     - `test/unit/authAdapter.test.js`: Updated assertions from hardcoded `'PRD'` to dynamic label. Added unit tests for `S4_SYSTEM_NAME` and `S4_CLIENT` environment overrides and `options.systemName` override.
     - `test/unit/auth/authService.test.js`: Added unit test asserting dynamic system label resolution in user profile and login flow from `S4_SYSTEM_NAME` and `S4_CLIENT`.
  4. **Documentation**:
     - `docs/data-lineage-audit.md`: Marked audit item 46 as RESOLVED.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/authAdapter.test.js test/unit/auth/authService.test.js test/unit/common/s4Config.test.js`: **3 passed, 3 total test suites; 53 passed, 53 total tests (100% green)**.
  - `npm test`: **71 passed, 71 total test suites; 934 passed, 934 total tests (100% green)** in 71.3 s.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 709 ms; Component-preload.js generated**.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 17:20 IST — Fix PO Creation HTTP 400 "Property NetAmountIsEstimate does not exist in items[0]"
- **Change**: Resolved HTTP 400 error during Purchase Order creation (`Property "NetAmountIsEstimate" does not exist in items[0]`). The client-side UI flag `NetAmountIsEstimate: true` (introduced for Audit Item 11 to indicate estimated browser calculation) was leaking into the OData action payload. Because `POItem` in `service.cds` did not define this property, SAP CAP's OData V4 protocol handler rejected the action invocation before reaching domain logic.
  1. **Frontend Controller Layer**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller.js`: In `onCreatePress`, added `delete oCleanItem.NetAmountIsEstimate;` alongside `delete oCleanItem.errors;` to ensure UI-only calculation flags are stripped prior to submitting payload.
  2. **Frontend Service Layer**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService.js`: In `createPurchaseOrder`, defensively sanitized payload items by stripping `errors` and `NetAmountIsEstimate` before calling `ODataClient.post`.
  3. **Backend Service Layer (Defense-in-Depth)**:
     - `srv/mm/purchase-order/service.cds`: Added `NetAmountIsEstimate: Boolean;` to `POItem` action parameter type so CAP schema deserialization accepts the flag without throwing HTTP 400 if transmitted by direct API callers or cached client bundles. Normalized in `purchaseOrder.mapper.js` and stripped prior to S/4HANA draft payload mapping in `PurchaseOrderMapper.js`.
  4. **Component Preload & Automated Tests**:
     - `cd app/fiori-app && npm run build`: Rebuilt UI5 `dist/Component-preload.js` with sanitized controller and service code.
     - `test/unit/purchase-order/purchaseOrderPayloadSanitization.test.js`: Added unit tests verifying `PurchaseOrderService.createPurchaseOrder` cleans `NetAmountIsEstimate` and `errors`.
     - `test/integration/purchase-order/createPurchaseOrder.test.js`: Added integration test asserting that `POST /odata/v4/purchase-order/createPurchaseOrder` accepts items with `NetAmountIsEstimate: true` without schema errors (HTTP 200).
     - `test/e2e/purchase-order/createPurchaseOrderFlow.test.js`: Updated e2e test journey asserting that `NetAmountIsEstimate` is set during calculation, cleanly stripped during submission, and PO creation succeeds (HTTP 200).
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/purchase-order/purchaseOrderPayloadSanitization.test.js test/integration/purchase-order/createPurchaseOrder.test.js test/e2e/purchase-order/createPurchaseOrderFlow.test.js`: **3 passed, 3 total test suites; 18 passed, 18 total tests (100% green)**.
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 1.38 s; Component-preload.js generated**.
  - `npm test`: **72 passed, 72 total test suites; 937 passed, 937 total tests (100% green)** in 77.5 s.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-21 17:40 IST — Fix PO Creation HTTP 422 "Payment term AT01 not defined; PO header data still faulty"
- **Change**: Resolved SAP S/4HANA HTTP 422 error during Purchase Order creation (`PO header data still faulty; Payment term AT01 not defined; Can delivery date be met?; Effective price is 160.00 INR, material price is 1,500.00 INR; Enter Requester, customer; Enter Reason for ordering, customer`).
  1. **Root Cause Analysis**:
     - **Obsolete Historical Payment Terms in S/4 Client 220**: In `srv/mm/purchase-order/handlers/purchaseOrder.handler.js` (`getSupplierDefaults`), querying historical POs for supplier `100102` derived `PaymentTerms: 'AT01'` from legacy POs `300000001`–`300000010`. In S/4HANA Client 220 customizing (`T052` / `C_MM_PaymentTermValueHelp`), `AT01` does not exist (valid terms start from `0002`, `0003`, `PT00`, etc.).
     - **Frontend Value Help Selection Did Not Update Model**: In `app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller.js` (`_handleValueHelpSelected`), selecting from Value Help dialogs called change handlers without calling `oModel.setProperty("/header/<field>", sKey)` for `inPaymentTerms`, `inDocType`, `inCompanyCode`, `inPurchOrg`, `inPurchGrp`, `inCurrency`, and `inIncoterms`. When users selected a valid payment term via Value Help dialog, the invalid derived `AT01` remained in the model.
     - **Error Details Included Non-Blocking Warnings**: In `srv/integration/s4hana/S4ErrorMapper.js` (`_filterErrorDetails`), all messages in `errordetails` were concatenated indiscriminately. The actual blocking error was `Payment term AT01 not defined` (`severity: 'error'`), while `Can delivery date be met?`, `Effective price is ...`, `Enter Requester, customer`, and `Enter Reason for ordering, customer` were standard SAP warnings (`severity: 'warning'`), confusing the user on what prevented document creation.
  2. **Frontend Controller Layer**:
     - `app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller.js`: In `_handleValueHelpSelected`, added explicit `oModel.setProperty("/header/<field>", sKey)` and `PurchaseOrderModel.markUserModified(oModel, "<field>", true)` for `inDocType`, `inCompanyCode`, `inPurchOrg`, `inPurchGrp`, `inSupplier`, `inCurrency`, `inPaymentTerms`, and `inIncoterms`. Also added `markUserModified` to `onDocTypeSelect`, `onCompanyCodeSelect`, `onPurchOrgSelect`, and `onPurchGrpSelect`.
  3. **Integration Adapter Layer**:
     - `srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter.js`: Implemented `getValidPaymentTerms(options)` querying `MM_PUR_PO_MAINT_V2_SRV/C_MM_PaymentTermValueHelp?$select=PaymentTerms` with internal set caching. Reset in `clearMetricsCache()`.
  4. **Backend CAP Handler Layer**:
     - `srv/mm/purchase-order/handlers/purchaseOrder.handler.js`: In `getSupplierDefaults`, validated `po.PaymentTerms` against `purchaseOrderAdapter.getValidPaymentTerms()`. Filtered obsolete payment terms (`AT01`, `AT05`, `AT06`) so invalid terms are never defaulted to the frontend or payload.
  5. **S/4 Error Mapper Layer**:
     - `srv/integration/s4hana/S4ErrorMapper.js`: In `_filterErrorDetails`, prioritized `severity === 'error'` items when present, filtering out non-blocking warnings so root blocking validation failures are clearly presented.
  6. **Automated Unit & Integration Tests**:
     - `test/unit/purchase-order/headerValueHelpSelection.test.js`: Added 8 unit tests verifying that selecting values in Value Help dialogs properly writes to `/header/<field>` and flags `userModified`.
     - `test/unit/purchase-order/getSupplierDefaultsHandler.test.js`: Added unit tests verifying obsolete `AT01` is omitted and valid terms are verified against `getValidPaymentTerms()`.
     - `test/unit/errorMapping.test.js`: Added unit test verifying that warnings are isolated and omitted when error severities exist.
  7. **Live S/4HANA Backend Verification (Non-Negotiable Protocol)**:
     - Executed live PO draft creation and activation against SAP S/4HANA Client 220 with valid payment terms `0002` and verified persistence:
     - **Created Purchase Order**: `400000334` in S/4HANA Client 220.
     - **Direct Read-Back**: Verified document persistence via `C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs('400000334')` returning Supplier `100102`, PaymentTerms `0002`.
- **Validation Commands Executed & Results**:
  - `cd app/fiori-app && npm run lint`: **Success! 0 findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 2.26 s; Component-preload.js generated**.
  - `npx cds compile srv --to json > /dev/null`: **Succeeded with 0 errors**.
  - `npx jest test/unit/purchase-order/headerValueHelpSelection.test.js test/unit/purchase-order/getSupplierDefaultsHandler.test.js test/unit/errorMapping.test.js`: **3 passed, 3 total test suites; 31 passed, 31 total tests (100% green)**.
  - `npm test`: **73 passed, 73 total test suites; 948 passed, 948 total tests (100% green)** in 81.2 s.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

### 2026-09-22 09:30 IST — Fix Journal Entries View Layout, KPI Digit Truncation & Amount Formatting
- **Change**: Resolved UI defects in `app/fiori-app/webapp/modules/fi/journal-entry/view/JournalEntries.view.xml`, amount formatting in `formatter.js`, and detail dialog.
  1. **Root Cause Analysis**:
     - **NumericContent 4-Character Truncation**: Default `truncateValueTo` in UI5 `NumericContent` is 4 characters. Large counts like `174,187` and `33,784` were clipped to `1741` and `3378`. Added `truncateValueTo="10"` on all 4 KPI tiles.
     - **OData V4 Decimal Formatter String Parsing**: UI5 OData V4 formatters output pre-formatted numeric strings with grouping commas (e.g. `"2,958.600"`). Calling `parseFloat` directly on strings with commas failed inside currency formatting, rendering blank cells with only `"INR"`. Updated `formatAmount` to strip commas prior to parsing and formatting with `NumberFormat`.
     - **IconTabBar Wrapper Removal**: Removed redundant outer `<IconTabBar>` wrapping `<Table>` to match SAP Fiori floorplan standards and `PurchaseOrders.view.xml`.
     - **Line Item Text Column Width**: Fixed column header wrap in `Line Item Text` by specifying `width="12rem"` and rebuilding `Component-preload.js`.
  2. **Files Modified**:
     - `app/fiori-app/webapp/modules/fi/journal-entry/view/JournalEntries.view.xml`
     - `app/fiori-app/webapp/modules/fi/journal-entry/view/JournalEntryDetailDialog.fragment.xml`
     - `app/fiori-app/webapp/modules/fi/journal-entry/model/formatter.js`
     - `app/fiori-app/webapp/modules/fi/journal-entry/controller/JournalEntries.controller.js`
     - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`
     - `test/unit/fi/journalEntryFormatter.test.js`
  3. **Validation**:
     - `npx jest test/unit/fi/`: **2 passed, 2 total test suites; 30 passed, 30 total tests (100% green)**.
     - `cd app/fiori-app && npm run lint`: **0 errors, 0 warnings**.
     - `cd app/fiori-app && npm run build`: Succeeded.
     - Chrome DevTools MCP live verification: verified 174,187 count rendered in full without ellipsis; amounts formatted as `2,958.60 INR` and `5,514,142.00 INR`; screenshots saved to artifacts.

### 2026-09-22 09:50 IST — Fix Login Form Enter-Submit, Input Control Synchronization & Misleading Placeholders
- **Change**: Resolved login failures where pressing Enter in password input or using browser autofill displayed `"Username and password are required."`, and aligned login placeholders with actual personas.
  1. **Root Cause Analysis**:
     - **Enter Key Submit vs Blur Desynchronization**: Two-way data binding on SAPUI5 `<Input>` only writes to the model on `change` (blur). When users hit Enter to submit the form, `onsapenter` fired `submit` while the field still held focus. `onLogin` read from `oViewModel.getProperty("/password")`, which remained empty `""`, triggering validation failure `"Username and password are required."`.
     - **Browser Autofill Desynchronization**: Browser credential autofill populates native DOM element values without firing UI5 synthetic change events, leaving view model properties blank.
     - **Misleading Placeholders**: Placeholder `e.g. s4admin or purchaser` prompted users to input non-existent personas, which failed with S/4 Gateway HTTP 401.
  2. **Code Changes**:
     - `app/fiori-app/webapp/view/Login.view.xml`: Added `valueLiveUpdate="true"` to both `inputUsername` and `inputPassword`.
     - `app/fiori-app/webapp/controller/Login.controller.js`: In `onLogin`, prioritized live control values (`this.byId("inputUsername").getValue()`, `this.byId("inputPassword").getValue()`) and synchronized back to the view model before validation. Also synchronized control values in `onInputChange` and cleared the password control on success.
     - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`: Updated `loginUsernamePlaceholder` to `e.g. alice, khushal, or S/4 username`, and updated demo account strings with 100% key-for-key parity.
     - `test/unit/controller/loginController.test.js`: Added 6 unit tests covering initialization, live control synchronization, Enter key submission, validation errors, and authentication rejection.
  3. **Validation Commands Executed & Results**:
     - `npx jest test/unit/controller/loginController.test.js`: **1 passed, 1 total test suites; 6 passed, 6 total tests (100% green)**.
     - `cd app/fiori-app && npm run lint`: **Success! 0 findings detected (0 errors, 0 warnings)**.
     - `cd app/fiori-app && npm run build`: **Build succeeded in 781 ms; Component-preload.js generated**.
     - `npx cds compile srv`: **Succeeded with 0 errors**.
     - `npm test`: **74 passed, 74 total test suites; 967 passed, 967 total tests (100% green)** in 79.5 s.
     - `git diff --check`: **Clean (0 errors)**.
     - Chrome DevTools MCP live verification: verified `alice` / `alice` and `khushal` / `khushal` log in via Enter key and redirect to `#/dashboard` with tokens and roles; screenshots saved to artifacts.
- **Next recommended action**: Stage and commit to `origin/feature/CL01`.

### 2026-09-22 09:55 IST — Fix SAPUI5 MessageToast Dock Position Validation Error (SAP DINC0487249)
- **Change**: Resolved browser console validation error `"center bottom" is not of type "sap.ui.core.Popup.Dock" on sap.m.MessageToast._validateDockPosition` triggered twice upon calling `sap.m.MessageToast.show(...)` throughout the application.
  1. **Root Cause Analysis**:
     - **UI5 Framework Type Normalization**: In SAPUI5 1.136.0, `core.Popup` updated the `sap.ui.core.Popup.Dock` enum to use PascalCase strings (`CenterBottom: "CenterBottom"`) with identical keys and values, registered via `DataType.registerEnum("sap.ui.core.Popup.Dock", Popup.Dock)`.
     - **MessageToast Default Settings Discrepancy**: `sap.m.MessageToast._mSettings` in UI5 1.136.0 still defaulted `my` and `at` to legacy lowercase `"center bottom"`. When `MessageToast.show()` was called without explicit dock options, `MessageToast._validateDockPosition` called `DataType.getType("sap.ui.core.Popup.Dock").isValid(sDock)`. Because `"center bottom"` did not match `"CenterBottom"`, UI5 logged assertion errors for both `my` and `at`.
     - **Upstream Fix Alignment**: SAP officially addressed this regression under incident `DINC0487249` (OpenUI5 commit `0fb0b865`) in patch release `1.136.10` and subsequent releases (`1.136.22` LTS).
  2. **Frontend UI5 CDN Update**:
     - `app/fiori-app/webapp/index.html`: Updated pinned CDN bootstrap from initial zero-patch `https://ui5.sap.com/1.136.0/resources/sap-ui-core.js` to current stable maintenance patch `https://ui5.sap.com/1.136.22/resources/sap-ui-core.js`.
  3. **Frontend Component Layer (Defensive Normalization)**:
     - `app/fiori-app/webapp/Component.js`: Added `normalizeMessageToastDock()` executed at module load and in `init()`. Checks `MessageToast._mSettings` and updates `my` and `at` from `"center bottom"` to `"CenterBottom"`. Defensively wraps `MessageToast.show` so any explicit caller options with lowercase `"center bottom"` are sanitized to `"CenterBottom"` before passing to UI5 core.
  4. **Documentation & Bundling**:
     - `README.md`: Updated SAPUI5 version badges and tech stack table from `1.136.0` to `1.136.22 (Pinned LTS)`.
     - `cd app/fiori-app && npm run build`: Rebuilt `dist/Component-preload.js` with normalized component logic.
  5. **Automated Tests**:
     - `test/unit/controller/messageToastDockNormalization.test.js`: Added 4 unit tests verifying that `_mSettings` defaults are converted from `"center bottom"` to `"CenterBottom"`, explicit options in `MessageToast.show` are normalized, non-default dock positions are preserved, and normalization is idempotent.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/controller/messageToastDockNormalization.test.js`: **1 passed, 1 total test suites; 4 passed, 4 total tests (100% green)** in 0.88 s.
  - `npx jest test/unit/controller/`: **3 passed, 3 total test suites; 16 passed, 16 total tests (100% green)**.
  - `cd app/fiori-app && npm run lint`: **Success! 0 findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 759 ms; Component-preload.js generated**.
  - `npx cds compile srv`: **Succeeded with 0 errors**.
  - `npm test`: **75 passed, 75 total test suites; 971 passed, 971 total tests (100% green)** in 87.7 s.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage and commit to `origin/feature/CL01`.

### 2026-09-22 10:05 IST — Fix S/4 Password Authentication for Development User (srv/auth-service.js)
- **Change**: Resolved authentication failure (`Invalid username or password.`) when logging in as `KHUSHAL` with authentic SAP S/4HANA credentials.
  1. **Root Cause Analysis**:
     - In `srv/auth-service.js` (`_handleLogin`), `sUserLower === "khushal"` was grouped into `isMockUser` alongside `alice` and `bob`.
     - When `isMockUser` was true, the handler tested strictly against `process.env.LOCAL_DEV_PASSWORD || sUserLower` (`"khushal"`). When the password did not match `"khushal"`, it immediately returned `{ authenticated: false, message: "Invalid username or password." }` without checking `process.env.S4_PASSWORD` or falling back to the live S/4 Gateway via `authAdapter.validateCredentials(username, password)`.
     - Consequently, entering the real S/4 password was always intercepted and rejected by the mock user check before reaching the S/4 credential validation.
  2. **Authentication Flow Separation**:
     - `srv/auth-service.js`: Separated pure mock users (`alice`, `bob`) from development users. For `khushal` (and `sEnvDevUser`), checks the local development password first, and if not matched, evaluates `process.env.S4_PASSWORD` and delegates to `authAdapter.validateCredentials(username, password)`.
  3. **Automated Tests**:
     - `test/unit/auth/authService.test.js`: Added test case asserting that `KHUSHAL` can authenticate with either local mock password or real `process.env.S4_PASSWORD`.
  4. **Live Verification**:
     - Tested live HTTP POST to `http://localhost:4004/odata/v4/auth/login` with `KHUSHAL` and `S4_PASSWORD`: Verified HTTP 200, `authenticated: true`, `system: "S4HANA_DEV - Client 220"`, valid JWT token, and 8 enterprise roles.
- **Validation Commands Executed & Results**:
  - `npx jest test/unit/auth/`: **3 passed, 3 total test suites; 38 passed, 38 total tests (100% green)** in 3.4 s.
  - `npm test`: **75 passed, 75 total test suites; 971 passed, 971 total tests (100% green)** in 75.3 s.
  - `git diff --check`: **Clean (0 errors)**.
### 2026-09-22 10:18 IST — Fix Sales Inquiry KPI Authentic Data Lineage: Open Inquiries from C_InquiryWL_F2370 (Audit Row 21)
- **Change**: Resolved misleading data where the "Open Inquiries" tile on the Sales Inquiries screen called `getSalesOrderMetrics()` and displayed `openOrdersCount`. Replaced with authentic Sales Inquiry metrics queried directly from `SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370`.
  1. **Root Cause Analysis**:
     - `app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiries.controller.js` (`_loadServerMetrics`) called `/odata/v4/sales-inquiry/getSalesOrderMetrics()` and extracted `openOrdersCount` instead of inquiry metrics.
     - `srv/sd/sales-inquiry/service.cds` exposed `getSalesOrderMetrics()` returning `openOrdersCount: Integer` rather than a dedicated inquiry metrics function.
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js` returned `{ openOrdersCount, totalOrdersCount }` even when querying `C_InquiryWL_F2370` with `entity: 'inquiry'`.
  2. **CAP Service Definition Layer**:
     - `srv/sd/sales-inquiry/service.cds`: Declared authentic function `getSalesInquiryMetrics() returns { openInquiriesCount: Integer; totalInquiriesCount: Integer; };`. Extended `getSalesOrderMetrics()` to return both inquiry and order count properties for backwards compatibility.
  3. **Integration Adapter Layer**:
     - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`: In `getSalesMetrics`, when `entity === 'inquiry'`, returns `{ openInquiriesCount, totalInquiriesCount, openOrdersCount, totalOrdersCount }` from `SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370` where `$filter=OverallSDProcessStatus ne 'C'`. Added dedicated helper `getInquiryMetrics(options)`.
  4. **Backend CAP Handler Layer**:
     - `srv/sd/sales-inquiry/handlers/salesInquiry.handler.js`: Registered `getSalesInquiryMetrics` and `getSalesOrderMetrics` handlers delegating to `salesInquiryAdapter.getInquiryMetrics()`, properly propagating errors via `req.error(error.status || 502, error.message)`.
  5. **Frontend Controller & Service Layer**:
     - `app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiries.controller.js`: In `_loadServerMetrics`, updated inquiry metrics call to `/odata/v4/sales-inquiry/getSalesInquiryMetrics()`, binding `data.openInquiriesCount` to `salesInquiriesView>/openCount`, setting `"-"` on error.
     - `cd app/fiori-app && npm run build`: Rebuilt `dist/Component-preload.js`.
  6. **Automated Tests & Audit Documentation**:
     - `test/unit/sales-inquiry/salesInquiriesController.test.js`: Updated `MockODataClient` to recognize `getSalesInquiryMetrics` returning `{ openInquiriesCount: 15, totalInquiriesCount: 50 }`.
     - `test/unit/sales-inquiry/createSalesInquiryHandler.test.js`: Added test suite for `getSalesInquiryMetrics` verifying delegation to adapter and error propagation.
     - `test/unit/dashboard/dashboardMetrics.test.js`: Updated inquiry metrics assertions to verify `openInquiriesCount` and added `getInquiryMetrics` test suite.
     - `tools/probe-cap.py`: Added `getSalesInquiryMetrics()` to probe functions list.
     - `docs/data-lineage-audit.md`: Updated Row 21 status to **Fixed** with verification notes.
- **Validation Commands Executed & Results**:
  - `npx cds compile srv`: **Succeeded with 0 errors**.
  - `cd app/fiori-app && npm run lint`: **Success! No findings detected (0 errors, 0 warnings)**.
  - `cd app/fiori-app && npm run build`: **Build succeeded in 807 ms; Component-preload.js generated**.
  - `npx jest test/unit/sales-inquiry test/unit/dashboard`: **11 passed, 11 total test suites; 179 passed, 179 total tests (100% green)**.
  - `npm test`: **75 passed, 75 total test suites; 974 passed, 974 total tests (100% green)** in 73.5 s.
  - `git diff --check`: **Clean (0 errors)**.
- **Next recommended action**: Stage, commit, and push changes to `origin/feature/CL01`.

## 2026-09-22 10:15 IST
- **Agent**: Antigravity
- **Change**: Sales KPI Customer Master Count Relabeling across Sales Inquiries and Sales Orders screens:
  - Relabeled `salesInquiriesKpiActiveCustomers` and `salesOrdersKpiActiveCustomers` in both English property bundles from "Active Customers / Distinct Sold-to Parties" to "Customers", with subtitle "Customer records in SAP".
  - Reflected the authentic data lineage that `getDashboardMetrics()` retrieves total customer master count (891 records) from `I_Customer_VH`, eliminating confusion with active sold-to parties on loaded orders/inquiries.
  - Maintained 100% exact key-for-key parity between `i18n.properties` and `i18n_en.properties`.
  - Rebuilt `dist/Component-preload.js`.
- **Files modified**:
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
- **Validation**:
  - `cd app/fiori-app && npm run lint`: Success! No findings detected.
  - `cd app/fiori-app && npm run build`: Succeeded; `Component-preload.js` generated.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Proceed to Goods Issue handling unit unknown stock bug fix.

## 2026-09-22 10:25 IST
- **Agent**: Antigravity
- **Change**: Goods Issue Handling Unit Unknown Stock Bug Fix (Audit Row 40 Residual (b)):
  - Fixed JavaScript `null` coercion gotchas in `GoodsIssueStockUnitClient.js` where `currentStock <= 0` evaluated to `true` when `currentStock === null` (unknown stock from SAP), causing false "SAP reports no stock" HTTP 422 rejections.
  - Fixed line 1018 `Math.min(currentStock, openQty)` evaluating to `0` when `currentStock === null`.
  - Guarded step 6 checks with explicit `currentStock !== null && currentStock !== undefined`, and defined `availableStock` so `maxIssueQty` falls back cleanly to `openQty` without 0-clamping when stock is unknown.
  - Added unit test suite in `test/unit/wm/goodsIssueClients.test.js` validating unknown stock preservation, `suQty` constraint when stock is unknown, and authentic HTTP 422 rejection when SAP explicitly returns 0 stock.
  - Updated `docs/data-lineage-audit.md` marking Row 40 residual (b) as resolved.
- **Files modified**:
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`
  - `test/unit/wm/goodsIssueClients.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npx jest test/unit/wm/goodsIssueClients.test.js`: 45 passed, 45 total tests.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Address Open quantity ignoring dispatch queue (Audit Row 38).

## 2026-09-22 10:35 IST
- **Agent**: Antigravity
- **Change**: Goods Issue Open Quantity Dispatch Queue Deduction & Double-Issue Prevention (Audit Row 38):
  - In `GoodsIssueQueueManager.js`: Added `getPendingItems(reservationNo)`, `getPendingQueueMap(reservationNo)`, and `getPendingQueuedQty(reservationNo, reservationItem)` to query and aggregate pending queued quantities and final issue flags for reservation items where `SyncStatus !== 'POSTED_IN_SAP'`.
  - In `srv/wm/goods-issue/service.cds`: Added `QueuedQty : Decimal(13, 3);` to `entity GIItems` and `type GIComponentItem`.
  - In `srv/integration/s4hana/wm/GoodsIssueAdapter.js`: Injected `this.queueManager` into `GoodsIssueReservationsClient` and `GoodsIssueStockUnitClient`.
  - In `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`:
    - `getOpenReservations`: Deducted pending queued quantity (`openQty = isFinalQueued ? 0 : Math.max(0, reqQty - wdnQty - queuedQty)`); excluded reservations where all items are queued and aligned `ItemCount` to open items.
    - `getOpenItems`: Deducted pending queued quantity, attached `QueuedQty: queuedQty`, and filtered out items with `OpenQty <= 0` (preventing double-issuance of queued items).
  - In `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`:
    - Deducted pending queued quantity in `resolveStockUnitForGoodsIssue`.
    - Threw HTTP 400 when no open quantity remains (`Reservation <resv> item <item> has no open quantity remaining (already fully issued or queued in dispatch)`).
    - Constrained `maxIssueQty` and `ReservationRemainingQty` by unqueued remaining quantity.
  - In `docs/data-lineage-audit.md`: Updated Row 38 status to **RESOLVED** and removed from Open residuals list.
  - Added unit tests across `test/unit/wm/goodsIssueQueueManager.test.js` and `test/unit/wm/goodsIssueClients.test.js`.
- **Files modified**:
  - `srv/wm/goods-issue/GoodsIssueQueueManager.js`
  - `srv/wm/goods-issue/service.cds`
  - `srv/integration/s4hana/wm/GoodsIssueAdapter.js`
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`
  - `test/unit/wm/goodsIssueQueueManager.test.js`
  - `test/unit/wm/goodsIssueClients.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `npx jest test/unit/wm/goodsIssueQueueManager.test.js`: 11 passed, 11 total tests.
  - `npx jest test/unit/wm/goodsIssueClients.test.js`: 49 passed, 49 total tests.
  - `npx jest test/unit/wm/goodsIssueService.test.js test/unit/wm/goodsIssueController.test.js test/integration/wm/goodsIssueQueue.test.js`: 101 passed, 101 total tests (3 test suites).
  - `cd app/fiori-app && npm run lint`: Success! No findings detected.
  - `cd app/fiori-app && npm run build`: Build succeeded in 1.76 s; `dist/Component-preload.js` generated.
  - `git diff --check`: Clean (0 errors).
## 2026-09-22 10:50 IST
- **Agent**: Antigravity
- **Change**: Fix Approval Lookup Failure Masking Unapproved Orders as Approved (Audit Row 31):
  - **Root Cause Analysis**:
    - In `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js` (line 283), `_fetchApprovalStatusMap` caught Gateway read errors from `SD_F1873_SO_WL_SRV` and returned either `this._approvalCache.map` (stale cache) or `new Map()` (empty map).
    - Unapproved orders missing from the returned map received `SalesDocApprovalStatus: ''` ("Not Relevant" / Approved).
    - In `OrdersDueForDelivery.view.xml` and `SalesOrders.view.xml`, button enablement expression `(%{...SalesDocApprovalStatus} === 'B' || !%{...SalesDocApprovalStatus})` evaluated to `true`, enabling the Create Delivery button for unverified/unapproved orders, which subsequently failed in S/4HANA with `V2/478`.
  - **Backend Adapter Layer**:
    - `OutboundDeliveryAdapter.js`:
      - In `_fetchApprovalStatusMap`: On catch, cleared cached map (`this._approvalCache = { timestamp: 0, map: new Map() }`) and returned `null`.
      - In `_formatOrderResults`: When `approvalStatusMap === null`, mapped `SalesDocApprovalStatus = 'unknown'`.
      - In `createDeliveryFromOrder`: Unless `options.skipApprovalCheck` is explicitly set, verified approval status before calling S/4HANA `C_DelivWthRefQuickCreate`. Throws HTTP 502 if approval lookup failed (`null`) and HTTP 400 if order is unapproved (`'A'`, `'C'`, or `'D'`).
  - **CAP Service Definition Layer**:
    - `srv/le/outbound-delivery/service.cds`: Widened `OrdersDueForDelivery.SalesDocApprovalStatus` from `String(1)` to `String(10)` to accommodate `'unknown'`.
  - **UI5 Views and Controllers**:
    - `OrdersDueForDelivery.view.xml`: Rendered `'unknown'` with `Warning` status in `ObjectStatus`; added `%{outboundDelivery>SalesDocApprovalStatus} !== 'unknown'` to `Button enabled` condition; updated tooltip expression.
    - `OrdersDueForDelivery.controller.js`: In `onCreateDeliveryPress`, guarded against `sApprovalStatus === "unknown"` with warning `MessageBox` and blocked dialog.
    - `SalesOrders.view.xml`: Added `%{salesOrder>SalesDocApprovalStatus} !== 'unknown'` to `Button enabled` condition and updated tooltip expression.
    - `SalesOrders.controller.js`: In `onCreateDeliveryPress`, guarded against `sApprovalStatus === "unknown"` with warning `MessageBox` and blocked dialog.
  - **i18n Localization**:
    - Added `statusApprovalUnknown`, `tooltipOrderApprovalUnknown`, and `msgOrderApprovalUnknown` to both `i18n.properties` and `i18n_en.properties` maintaining 100% exact key-for-key parity (831 lines each).
  - **Rebuilt Bundle**:
    - Rebuilt `dist/Component-preload.js` via `npm --prefix app/fiori-app run build`.
  - **Automated Tests**:
    - `test/unit/le/outboundDeliveryAdapter.test.js`:
      - Verified `getOrdersDueForDelivery` sets `SalesDocApprovalStatus: 'unknown'` and invalidates cache when approval lookup fails.
      - Verified `createDeliveryFromOrder` blocks with 502 when approval status check fails from Gateway.
      - Verified `createDeliveryFromOrder` blocks with 400 when order is unapproved (`A`, `C`, `D`).
      - Verified `createDeliveryFromOrder` bypasses approval check when `skipApprovalCheck: true`.
    - `test/unit/le/ordersDueForDeliveryController.test.js`:
      - Verified `onCreateDeliveryPress` warns and blocks when `SalesDocApprovalStatus === "unknown"`.
    - `test/unit/sales-order/salesOrdersController.test.js`:
      - Verified `onCreateDeliveryPress` warns and blocks when `SalesDocApprovalStatus === "unknown"`.
  - **Audit Documentation**:
    - Updated `docs/data-lineage-audit.md` Row 31 status to **RESOLVED** and removed OutboundDeliveryAdapter from the Section 6 "Substitute a value that looks like data" table.
- **Files modified**:
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`
  - `srv/le/outbound-delivery/service.cds`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/view/OrdersDueForDelivery.view.xml`
  - `app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/view/SalesOrders.view.xml`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller.js`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/le/outboundDeliveryAdapter.test.js`
  - `test/unit/le/ordersDueForDeliveryController.test.js`
  - `test/unit/sales-order/salesOrdersController.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npx cds compile srv/le/outbound-delivery/service.cds`: Succeeded with 0 errors.
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Succeeded; `dist/Component-preload.js` generated.
  - `npm test -- test/unit/le/`: 4 passed, 4 total test suites; 53 passed, 53 total tests (100% green).
  - `npm test -- test/unit/sales-order/salesOrdersController.test.js`: 17 passed, 17 total tests (100% green).
  - `npm run test:unit`: 64 passed, 64 total test suites; 937 passed, 937 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:05 IST
- **Agent**: Antigravity
- **Change**: Fix Sales Order HTTP fallback dropping user's filter and ignoring pagination/sorting (Audit Row 19) — implemented AST-to-OData v2 query translator, preserved filters/pagination/ordering in HTTP fallback, and enforced refusal-to-drop policy.
  - **OData V2 Query Translation**:
    - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`:
      - Implemented `_formatODataV2Literal(val)` formatting strings, numbers, booleans, dates, and GUIDs into OData v2 literal syntax.
      - Implemented `_cqnOrderByToOData(orderBy)` translating CQN orderBy AST to OData v2 `$orderby` syntax.
      - Implemented `_cqnWhereToODataFilter(where)` translating CQN WHERE AST (predicates, operators `=, !=, >, >=, <, <=, and, or, not`, string functions `contains`/`substringof`, `startswith`, `endswith`, entity prefix stripping `SalesOrders/`, `C_SalesOrderWl_F1873/`, and parentheses nesting) and plain filter dictionaries to valid OData v2 `$filter` expressions.
      - Exported helper methods on `SalesInquiryAdapter.prototype`, `defaultAdapter`, and `module.exports`.
  - **HTTP Fallback Filter & Pagination Preservation**:
    - In `SalesInquiryAdapter.getSalesOrders(query, options)`:
      - Preserves `$top` and `$skip` from `query.SELECT.limit` (`limit.rows`, `limit.offset`) or query options, defaulting to `$top=50` and `$skip=0`.
      - Preserves `$orderby` from `query.SELECT.orderBy` or fallback options, defaulting to `CreationDate desc,SalesOrder desc`.
      - Preserves `$inlinecount=allpages` when count requested (`query.SELECT.count` or `$count=true`).
      - Preserves `$filter` from `options.filter`, `query._queryOptions.$filter`, or translated CQN WHERE.
      - **Refusal-to-drop policy**: If a filter requirement is present on the query but cannot be safely translated to OData v2, throws HTTP 500 (`Cannot safely translate sales order query filter to OData HTTP fallback; refusing to return unfiltered results.`) rather than silently returning unfiltered results.
  - **Automated Unit Tests**:
    - `test/unit/sales-order/salesOrderAdapter.test.js`:
      - Verified single condition `$filter` preservation (`SoldToParty eq '10082'`).
      - Verified compound `$filter` preservation (`substringof('500', SalesOrder) and OverallSDProcessStatus ne 'C'`).
      - Verified custom `$top=20`, `$skip=40`, and `$orderby=SalesOrder asc` preservation.
      - Verified HTTP 500 error thrown and HTTP execution prevented when filter is unparseable.
      - Verified `_cqnWhereToODataFilter` unit tests across AST tokens, operators, parentheses, entity prefix stripping, and plain objects.
  - **Audit Documentation**:
    - Updated `docs/data-lineage-audit.md`: Marked Row 19 as **RESOLVED**, updated Section 6 error handling note for row 19, and updated Re-scan table.
- **Files modified**:
  - `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js`
  - `test/unit/sales-order/salesOrderAdapter.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm test -- test/unit/sales-order/salesOrderAdapter.test.js`: 18 passed, 18 total tests (100% green).
  - `npm run test:unit`: 64 passed, 64 total test suites; 942 passed, 942 total tests (100% green).
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:15 IST
- **Agent**: Antigravity
- **Change**: Fix Goods Issue reservation list 2,000 cap silent truncation (Audit Row 37) — pushed reservation and order filters server-side into SAP OData `$filter` before paging, eliminated silent truncation with diagnostic logging and metadata flags (`IsTruncated`, `ItemCountPartial`, `TruncationNote`), and surfaced visual warnings and toasts in UI5.
  - **Server-Side Filter Pushdown & Configurable Limits**:
    - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`:
      - Updated `getOpenReservations(movementType = '261', plant = '', options = {})`:
        - Pushes `options.reservationNo` and `options.orderNo` server-side into SAP Gateway `$filter`: `(Reservation eq '...' or Reservation eq '...')` and `(OrderID eq '...' or OrderID eq '...')`, allowing specific reservation/order lookups to return in page 1 without scanning arbitrary items.
        - Supports configurable `maxItems` (defaults to 2000 for unconstrained queries, 10000 for targeted lookups) and `pageSize`.
        - Detects truncation non-silently when `allResults.length >= maxItems`: logs explicit diagnostic warning (`LOG.warn`) detailing scanned count, plant, movement type, and advising specific plant/reservation/order filters.
        - Attaches `IsTruncated: true`, `TruncationNote`, and `ItemCountPartial` indicator for the reservation at the cutoff boundary whose items may span across unread pages. Formats `DisplayText` with `${v.ItemCount}+ items (partial)` for the boundary reservation.
        - Exposes non-enumerable metadata properties `isTruncated` and `totalScannedItems` on returned array.
    - `srv/integration/s4hana/wm/GoodsIssueAdapter.js`:
      - Updated `getOpenReservations(movementType = '261', plant = '', options)` to forward `options` to `this.reservations.getOpenReservations`.
    - `srv/wm/goods-issue/handlers/goodsIssue.handler.js`:
      - Extracted `ReservationNo` and `OrderNo` and passed them into `GoodsIssueAdapter.getOpenReservations(mvtType, plant, { reservationNo, orderNo })` so SAP filters server-side before paging.
    - `srv/wm/goods-issue/service.cds`:
      - Added `IsTruncated: Boolean;`, `ItemCountPartial: Boolean;`, `TruncationNote: String(120);` to `OpenReservations` entity.
  - **Frontend Truncation Awareness & Value Help Resilience**:
    - `app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js`:
      - Set `reservationsTruncated` and `reservationsTruncatedMsg` on `giView` model based on `aResvs[0].IsTruncated`.
      - Updated `onRefreshReservations` toast to inform user: `"{0} open reservations loaded (first 2,000 items scanned from SAP)"` when truncated.
      - Allowed manual numeric entry of reservation numbers in combobox not present in the initial 2,000 items to load directly from SAP via `_loadReservationDetails`.
    - `app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue.view.xml`:
      - Added `MessageStrip` (`msgStripResvTruncated`) displaying `reservationsTruncatedMsg` above reservation combobox when truncated.
    - `app/fiori-app/webapp/modules/wm/goods-issue/view/ReservationValueHelpDialog.fragment.xml`:
      - Updated item description to show `${giView>ItemCount}+ items (partial)` when `ItemCountPartial` is true.
    - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`:
      - Added `giReservationsTruncatedMsg` and `giReservationsTruncatedToast` with 100% key parity.
  - **Automated Tests**:
    - `test/unit/wm/goodsIssueClients.test.js`:
      - Verified server-side filter generation when `reservationNo` and `orderNo` are provided.
      - Verified non-silent truncation detection, `LOG.warn` call, boundary reservation `ItemCountPartial: true` and `1+ items (partial)` in `DisplayText`, and `TruncationNote`.
    - `test/unit/wm/goodsIssueService.test.js`:
      - Verified `READ:OpenReservations` passes `ReservationNo` and `OrderNo` server-side to adapter.
  - **Audit Documentation**:
    - Updated `docs/data-lineage-audit.md` Row 37 to **RESOLVED** and added to Re-scan table.
- **Files modified**:
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`
  - `srv/integration/s4hana/wm/GoodsIssueAdapter.js`
  - `srv/wm/goods-issue/service.cds`
  - `srv/wm/goods-issue/handlers/goodsIssue.handler.js`
  - `app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js`
  - `app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue.view.xml`
  - `app/fiori-app/webapp/modules/wm/goods-issue/view/ReservationValueHelpDialog.fragment.xml`
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `test/unit/wm/goodsIssueClients.test.js`
  - `test/unit/wm/goodsIssueService.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm test -- test/unit/wm/goodsIssueClients.test.js`: 51 passed, 51 total tests (100% green).
  - `npm test -- test/unit/wm/goodsIssueService.test.js`: 46 passed, 46 total tests (100% green).
  - `npm run test:unit`: 64 passed, 64 total test suites; 945 passed, 945 total tests (100% green).
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Succeeded in 842 ms; `Component-preload.js` generated.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:35 IST
- **Agent**: Antigravity
- **Change**: Goods Receipt Scan S/4HANA Outage Propagation, Authentic Null Quantities on Missing Item Reads, and Pick List Error Surfacing (Audit Rows 33, 34, 35).
  - **Audit Row 33 (Outage Masking in Scan Resolution)**:
    - In `GoodsReceiptAdapter.js`: Added `_isOutage(err)` and `static _isOutage(err)` to identify S/4HANA backend outages (500, 502, 503, 504, 401, 403, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET, destination configuration failure, network drop).
    - Removed empty `catch (_) {}` blocks across Tiers 1-6 (`HMmimGr4inbdelSet`, `PoHelpSet`, `I_Batch`, `MMIMProductionOrderVH`, and fallback scan). Outages are rethrown immediately instead of falling through to Tier 7 validation error.
    - In `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js`: Updated `getStorageUnitDetails` catch block to check `_isOutage(err)` and reject with `502/503/504` instead of defaulting to `404`.
    - In `GoodsReceipt.controller.js`: Distinguishes `502/503/504` backend outages from genuine 404 "Document Not Found", presenting an explicit "S/4HANA Backend Outage / Service Unavailable" MessageBox.
  - **Audit Row 34 (Quantity 0 vs Blank / Null on Missing/Failed Item Reads)**:
    - In `GoodsReceiptAdapter.js`: Updated `getGoodsReceiptItem` and `resolveStorageUnit` so missing or failed item reads return authentic `null` for `Quantity`, `OpenQuantity`, `OrderedQuantity`, and `QuantityInEntryUnit` instead of default `0`.
    - In `GoodsReceipt.controller.js`: Updated initial state model, `onResetWorkflow`, and `resolveStorageUnit` mapping to keep `OpenQuantity`, `OrderedQuantity`, `QuantityInEntryUnit` as `null` and `Quantity` as `""` (not `0`).
    - In `GoodsReceipt.view.xml`: Updated `txtOpenQty` text binding expression to check `!== null && !== ''`, ensuring unknown quantities remain blank.
  - **Audit Row 35 (Pick Lists Returning Silent Empty Arrays on Error)**:
    - In `GoodsReceiptAdapter.js`: `getMaterialStorageLocations` and `getMaterialBatches` now log and rethrow on S/4HANA outages and backend errors instead of catching `_` and returning `[]`.
    - CAP handlers in `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js` for `MaterialStorageLocations` and `MaterialBatches` reject with `502` on backend failure, correctly surfacing errors to the Fiori UI.
  - **Automated Tests**:
    - `test/unit/wm/goodsReceiptService.test.js`: Added 5 unit tests verifying outage propagation in `resolveStorageUnit`, authentic `null` quantities on failed/missing item reads, throwing errors in `getMaterialStorageLocations` and `getMaterialBatches`, and CAP 502 rejection on backend outage.
    - `test/unit/wm/goodsReceiptController.test.js`: Added unit tests verifying preservation of `null` quantities and display of the S/4HANA backend outage MessageBox.
  - **Audit Documentation**:
    - Updated `docs/data-lineage-audit.md` Rows 33, 34, and 35 to **RESOLVED**, updated Section 6 error classification table, and updated Re-scan table.
- **Files modified**:
  - `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`
  - `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js`
  - `app/fiori-app/webapp/modules/wm/goods-receipt/controller/GoodsReceipt.controller.js`
  - `app/fiori-app/webapp/modules/wm/goods-receipt/view/GoodsReceipt.view.xml`
  - `test/unit/wm/goodsReceiptService.test.js`
  - `test/unit/wm/goodsReceiptController.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm test -- test/unit/wm/goodsReceiptService.test.js`: 41 passed, 41 total tests (100% green).
  - `npm test -- test/unit/wm/goodsReceiptController.test.js`: 20 passed, 20 total tests (100% green).
  - `npm run test:unit`: 64 passed, 64 total test suites; 952 passed, 952 total tests (100% green).
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Build succeeded in 910 ms; `Component-preload.js` generated.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:45 IST
- **Agent**: Antigravity
- **Change**: Goods Receipt Storage-Location Picker Dead Source Elimination & Authentic SAP Plant Value Help Integration (Audit Row 35 / Option 2C):
  - **Root Cause Analysis**:
    - `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` returns 0 rows in SAP S/4HANA (DS4 Client 220) across all materials and plants (SAP master data not maintained at material-to-storage-location grain).
    - As a result, `GoodsReceiptAdapter.getMaterialStorageLocations` returned `[]`, setting `grView>/availableStorageLocations = []` in `GoodsReceipt.controller.js`.
    - In `GoodsReceipt.view.xml`, `<Select id="selectStorageLocation" items="{grView>/availableStorageLocations}">` had 0 items. In SAPUI5, `Select` cannot display `selectedKey` without a matching `<core:Item>`, rendering the picker permanently empty and unselectable, even though `GR4PO_DL_Items` already held authentic transactional storage location data (`StorageLocation: "CS01"`).
  - **Backend Integration & Adapter Layer**:
    - `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`: Dropped dead source `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps`. Replaced with live SAP Storage Location Value Help `MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp` (696 records in SAP Client 220) filtered by `Plant`.
    - Removed dead `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` call in `getMaterialBatches`.
    - In `getStorageUnitDetails`: Extracted and prioritized authentic `StorageLocation` and `StorageLocationName` from `GR4PO_DL_Items`. Guaranteed that the document's authentic storage location is always present in `AvailableStorageLocations`, preventing an empty dropdown.
  - **CAP Service & Handler Layer**:
    - `srv/wm/goods-receipt/service.cds`: Updated `MaterialStorageLocations` entity schema with `key Plant`, `key StorageLocation`, and `PlantName`.
    - `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js`: Updated `READ MaterialStorageLocations` handler to validate `!sMaterial && !sPlant` and delegate plant-level queries to the adapter.
  - **Frontend Service Layer**:
    - `app/fiori-app/webapp/modules/wm/goods-receipt/service/GoodsReceiptService.js`: Updated `fetchMaterialStorageLocations` to dynamically construct filters for `Plant`, `Material`, or both.
    - Rebuilt `dist/Component-preload.js`.
  - **Automated Tests & Audit Documentation**:
    - `test/unit/wm/goodsReceiptService.test.js`: Updated mock service path for `C_MM_StorLocValueHelp`, updated test descriptions, and added assertions verifying `StorageLocation` is populated and present in `AvailableStorageLocations`.
    - `docs/data-lineage-audit.md`: Updated Row 35 and re-scan table to document the transition to `C_MM_StorLocValueHelp` and elimination of the empty picker bug.
- **Files modified**:
  - `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`
  - `srv/wm/goods-receipt/service.cds`
  - `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js`
  - `app/fiori-app/webapp/modules/wm/goods-receipt/service/GoodsReceiptService.js`
  - `test/unit/wm/goodsReceiptService.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npx cds compile srv --to json > /dev/null`: Succeeded with 0 errors.
  - `npm test -- test/unit/wm/goodsReceiptService.test.js`: 41 passed, 41 total tests (100% green).
  - `npm test -- test/unit/wm/goodsReceiptController.test.js`: 20 passed, 20 total tests (100% green).
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Build succeeded in 989 ms; `Component-preload.js` generated.
  - `npm run test:unit`: 64 passed, 64 total test suites; 952 passed, 952 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:50 IST
- **Agent**: Antigravity
- **Change**: Dashboard FI Tile Relabeling to "Items to be verified" (Audit Row 2):
  - **Root Cause & Rationale**:
    - The Dashboard FI card unit text was labeled "FI Documents", but its backing query in `PurchaseOrderAdapter.js` reads `FAC_GL_JOURNALENTRY_VER_SRV/C_GLJrnlEntryItemToBeVerified`.
    - In S/4HANA, this entity set contains General Ledger line items awaiting verification (174,153 items in SAP DS4 Client 220), not distinct accounting documents.
    - Relabeled `dashboardKpiFIDocs` from "FI Documents" to "Items to be verified" across both English property bundles (`i18n.properties` and `i18n_en.properties`) to reflect the authentic data lineage.
    - Preserved 100% key-for-key parity between property files.
    - Rebuilt `dist/Component-preload.js`.
    - Updated `docs/data-lineage-audit.md` marking Row 2 as **RESOLVED** and incrementing cleanly live scorecard.
- **Files modified**:
  - `app/fiori-app/webapp/i18n/i18n.properties`
  - `app/fiori-app/webapp/i18n/i18n_en.properties`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Build succeeded in 1.31 s; `Component-preload.js` generated.
  - `npm test -- test/unit/dashboard/dashboardMetrics.test.js`: 31 passed, 31 total tests (100% green).
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Stage and commit changes to `origin/feature/CL01`.

## 2026-09-22 11:55 IST
- **Agent**: Antigravity
- **Change**: Removal of Non-Production Default URL `http://localhost:5000` for `FAC_GL_JOURNALENTRY_VER_SRV`:
  - **Root Cause & Rationale**:
    - `package.json` had a hardcoded default `"credentials": { "url": "http://localhost:5000" }` on `FAC_GL_JOURNALENTRY_VER_SRV` that applied when `S4_DESTINATION_URL` was unset.
    - This caused requests to silently target local port 5000 rather than failing loudly when S/4HANA destination/credentials were not configured.
    - Removed `credentials: { url: "http://localhost:5000" }` from `package.json:144`.
    - Enhanced `srv/fi/journal-entry/service.js` with structured logging via `getLogger('journal-entry')` and proper HTTP error status propagation (502 / error status) when remote calls fail.
    - Added unit tests in `test/unit/fi/journalEntryService.test.js` validating package.json configuration, immediate fail-loud behavior (`No credentials configured for "FAC_GL_JOURNALENTRY_VER_SRV"`), and error forwarding.
    - Updated `docs/data-lineage-audit.md` documenting elimination of non-production default URL.
- **Files modified**:
  - `package.json`
  - `srv/fi/journal-entry/service.js`
  - `docs/data-lineage-audit.md`
  - `test/unit/fi/journalEntryService.test.js` (new)
- **Validation**:
  - `npm run test:unit`: **65 passed, 65 total test suites; 955 passed, 955 total tests (100% green)** in 35.5 s.
  - `npm test -- test/unit/fi/journalEntriesController.test.js test/unit/fi/journalEntryFormatter.test.js test/integration/fi/journalEntry.test.js`: 33 passed, 33 total.
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `npm --prefix app/fiori-app run lint`: 0 findings.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Commit changes to `feature/CL01`.

## 2026-09-22 12:05 IST
- **Agent**: Antigravity
- **Change**: PO Status: Elimination of Synthetic Completeness Fallback to "Approved" & Live SAP Code Table Verification (Audit Row 4):
  - **Root Cause & Rationale**:
    - `webapp/model/formatter.js:40-42` contained a last-resort fallback: `if (bCompleteness === true) return "Approved"`.
    - Live S/4HANA verification proved this heuristic was false: PO `300000001` has `PurchasingCompletenessStatus: true`, but its authentic SAP status is `PurchasingDocumentStatus: '01'`, `PurchasingDocumentStatusName: 'Draft'`. Displaying "Approved" was misleading.
    - Previously only 5 codes were hardcoded (`01`, `02`, `04`, `05`, `38`) without backend verification.
    - Queried live SAP Gateway entity set `/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_PurchasingDocumentStatusText?$filter=Language eq 'EN'` and retrieved all 33 verified status codes and English names (`01: Draft`, `02: In Approval`, `03: Not Yet Sent`, `04: Sent`, `05: Follow-On Documents`, `06: Release Orders Exist`, `07: Expiring Soon`, `08: Released`, `09: Expired`, `10: Deleted`, `11: Paid`, `12: Unpaid`, `13: Blocked`, `14: Canceled`, `15: Partially Paid`, `16: Release Refused`, `21: Invoice Completed`, `22: Completed`, `23: Ordered`, `24: Quantity Mismatch`, `25: Value Mismatch`, `26: Missing Confirmation`, `27: Created`, `31: Reversed`, `32: With Errors`, `33: Correct`, `34: Parked and Held`, `35: Entered and Held`, `36: Empty Item`, `37: Output Error`, `38: Rejected`, `39: Marked for Deletion`, `40: Not Yet Relevant`).
    - Added `SAP_PURCHASING_DOCUMENT_STATUS` table to `formatter.js`.
    - `_resolveDisplayStatus` strictly shows:
      1) `"Deleted"` if `sDeletionCode === "L"`
      2) SAP's authentic status name (`sStatusName`) if present
      3) Verified SAP name for `sStatusCode` from `SAP_PURCHASING_DOCUMENT_STATUS`, or raw code if unrecognized
      4) Empty string `""` if no status information is present (zero guessing from `bCompleteness` or `bReleaseNotCompleted`).
    - Changed `completenessText` in `formatter.js` to return `"Complete"` / `"Incomplete"` instead of `"Approved"` / `"Draft"`.
    - Rebuilt `dist/Component-preload.js` with `ui5 build --all`.
    - Updated `test/unit/purchase-order/formatter.test.js` asserting verified SAP status codes and asserting `""` (no guessing) for completeness/release boolean flags.
    - Updated `docs/data-lineage-audit.md` Row 4.
- **Files modified**:
  - `app/fiori-app/webapp/model/formatter.js`
  - `app/fiori-app/webapp/dist/Component-preload.js`
  - `test/unit/purchase-order/formatter.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm test -- test/unit/purchase-order/formatter.test.js`: **12 passed, 12 total tests (100% green)**.
  - `npm test -- test/unit/purchase-order/`: **19 suites passed, 207 passed, 207 total tests (100% green)**.
  - `npm test -- test/unit/dashboard/dashboardMetrics.test.js test/unit/fi/`: **4 suites passed, 64 total tests (100% green)**.
  - `npm --prefix app/fiori-app run lint`: 0 findings.
  - `npm --prefix app/fiori-app run build`: Succeeded in 1.82 s; preload bundle rebuilt.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Commit changes to `feature/CL01`.

## 2026-09-22 12:30 IST
- **Agent**: Antigravity
- **Change**: Elimination of Hardcoded Defaults from Create Sales Order (Audit Row 24):
  - **Root Cause & Requirements**:
    - `SalesOrderModel.js`, `SalesOrderService.js`, and `CreateSalesOrder.controller.js` previously hardcoded literal values `ZDOM`, `1000`, `10`, `52`, `INR`, `KG`, plant `1120`/`"1000"`, `quantity || 1`, and `delivery date today + 7`.
    - Requirement: Defaults only from `getSalesOrderDefaults()`; empty on failure.
  - **Implementation**:
    - `SalesOrderModel.js`:
      - `createInitialModel`: All organizational, currency, plant, unit, and item quantity fields start as empty strings (`""`). Creation dates (`SalesOrderDate`, `CustomerPurchaseOrderDate`) initialize to today's date.
      - `createEmptyItem`: Removed hardcoded `1.000` quantity, `KG` unit, and `1120` plant fallbacks; now default to empty strings unless explicitly passed.
      - `applyMaterialDefaults`: Removed `|| "KG"` fallback unit; unit is now set only from material master data.
      - `applyServerDefaults(oModel, oDefaults)`: Added method to apply server-sourced defaults from `getSalesOrderDefaults()` to empty fields only without overwriting user inputs.
      - `buildPayload`: Removed all hardcoded fallbacks (`ZDOM`, `1000`, `10`, `52`, `INR`, `KG`, `1120`). Empty fields remain empty strings, ensuring validation catches missing data before submission.
    - `SalesOrderService.js`:
      - `getSalesOrderDefaults`: On catch/failure, returns empty strings for all fields with `derived: false` instead of hardcoded fallbacks.
      - `getCustomerDefaults`: Removed hardcoded `Currency: "INR"` on empty customer and on catch/failure; returns `Currency: ""` with `derived: false`.
    - `CreateSalesOrder.controller.js`:
      - `_loadConfigurationAndDefaults`: Asynchronously calls `SalesOrderService.getSalesOrderDefaults()` and applies defaults via `SalesOrderModel.applyServerDefaults(oModel, oDefaults)`.
      - Replaced `itm.Plant === "1000"` check with `!itm.Plant`.
      - `onAddItem`: Removed `|| "1000"` plant fallback; uses `(aItems[0] && aItems[0].Plant) || ""`.
    - `test/unit/sales-order/salesOrderModel.test.js`:
      - Updated assertions for empty initial model.
      - Added unit test for `applyServerDefaults`.
      - Updated `buildPayload` tests verifying clean payloads with and without defaults.
    - `test/unit/sales-order/createSalesOrderController.test.js`:
      - Updated `onSave` unit test to populate required header fields.
      - Added unit test for `_loadConfigurationAndDefaults` verifying server defaults are loaded and applied.
    - `docs/data-lineage-audit.md`: Updated Row 24 to `RESOLVED` in main table and `Fixed` in summary table.
- **Files modified**:
  - `app/fiori-app/webapp/modules/sd/sales-order/model/SalesOrderModel.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/service/SalesOrderService.js`
  - `app/fiori-app/webapp/modules/sd/sales-order/controller/CreateSalesOrder.controller.js`
  - `test/unit/sales-order/salesOrderModel.test.js`
  - `test/unit/sales-order/createSalesOrderController.test.js`
  - `docs/data-lineage-audit.md`
- **Validation**:
  - `npm test -- test/unit/sales-order/`: **5 passed, 5 total test suites; 69 passed, 69 total tests (100% green)** in 2.05 s.
  - `npm test`: **76 passed, 76 total test suites; 1010 passed, 1010 total tests (100% green)** in 113.3 s.
  - `npm --prefix app/fiori-app run lint`: Success! No findings detected (0 errors, 0 warnings).
  - `npm --prefix app/fiori-app run build`: Succeeded in 1.66 s; preload bundle rebuilt.
  - `npx cds compile srv`: Succeeded with 0 errors.
  - `git diff --check`: Clean (0 errors).
- **Next recommended action**: Commit changes to `feature/CL01`.

## 2026-09-22 12:50 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 13 — "Due Orders" KPI tile on Orders Due for Delivery relabeled to **Due Schedule Lines** / "Order schedule lines open for shipping"; "Shipping Points" subtitle changed to "Distinct in loaded rows" (`app/fiori-app/webapp/i18n/i18n.properties`, `i18n_en.properties`).
  - **Reason**: `ordersDueView>/totalCount` is the row count of `C_SalesOrderDueForDeliveryVH` (key SalesOrder+Item+ScheduleLine), not a count of orders; the shipping-point figure is computed from the rows loaded on the current page only. Labels now say what the numbers are. No logic change.
  - **Validation**: see gate run at 12:56 IST below.

## 2026-09-22 12:51 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 22 — Goods Issue queue-tray count shows `-` instead of `0` when the queue summary call fails or returns no numeric `QueuedCount` (`app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller.js` `_refreshQueueCount`).
  - **Reason**: `0` presented an unknown queue length as an empty queue. View bindings already use `(${giView>/queuedCount} || 0) > 0`, so a string is safe; the promise still resolves `0` for internal callers.
  - **Validation**: see gate run at 12:56 IST below.

## 2026-09-22 12:52 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 23 — removed display fallbacks `'261'` / `'GI for order'` for `MovementType` / `MovementTypeName` in `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js` (2 places), `srv/integration/s4hana/wm/GoodsIssueAdapter.js` (resolved-reservation mapper) and `GoodsIssue.controller.js` (`/resolved` model); values now come only from SAP `GoodsMovementType` / `GoodsMovementTypeName` and are blank when SAP omits them. The list-filter default in `srv/wm/goods-issue/handlers/goodsIssue.handler.js` is kept but named `GI_MOVEMENT_TYPE = '261'` with a comment that it is the app's posting parameter, not SAP data.
  - **Validation**: unit mocks already supply `'261'`/`'GI for order'` (`test/unit/wm/goodsIssueClients.test.js`, fixtures); live test for order 1000040 still asserts `'261'` from SAP. See gate run at 12:56 IST below.

## 2026-09-22 12:53 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 24 — `'101'` literals in `srv/integration/s4hana/wm/GoodsReceiptAdapter.js` (GR posting item mapper, 2 places) replaced by named constant `GR_MOVEMENT_TYPE = '101'` with a comment that it is the movement type this app posts, not SAP-sourced data. Behaviour unchanged.
  - **Validation**: see gate run at 12:56 IST below.

## 2026-09-22 12:54 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 26 — `postGoodsIssue` in `app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssueService.js` no longer substitutes `"PC"` when `Unit` is missing; it rejects with "Unit of measure is missing on the SAP reservation item; cannot post Goods Issue" (same pattern as the existing ReservationNo/IssueQty checks).
  - **Validation**: see gate run at 12:56 IST below.

## 2026-09-22 12:54 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 27 — removed the 25-line "secondary fallback for unit test mocks" that read `MMIM_MATERIAL_DATA_SRV/MaterialBatchHelps` at runtime in `srv/integration/s4hana/wm/goods-issue/GoodsIssueBatchesClient.js`. Batch stock now comes only from `MaterialMultiStockByDates`; no test referenced the fallback (`grep MaterialBatchHelps test/` → 0 hits).
  - **Validation**: see gate run at 12:56 IST below.

## 2026-09-22 12:55 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 40 — `docs/quotation-metadata/*.xml` (217 files, 161 MB, generated by `tools/verify-quotation-services.py`) untracked with `git rm -r --cached` and added to `.gitignore`; `docs/quotation-metadata/REPORT.txt` stays tracked. Files remain on disk. History still contains them (commit 377032d); no history rewrite was done.
  - **Validation**: `git ls-files docs/quotation-metadata` → only `REPORT.txt`; `git check-ignore` confirms the XML rule. See gate run at 12:56 IST below.

## 2026-09-22 12:55 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 41 — reference metadata not used by any `cds.requires` model or code moved out of `srv/external/` to `docs/sap-metadata-reference/` with `git mv`: `LORD_ODATA_ORDER_SRV.csn`, `LORD_ODATA_ORDER_SRV.edmx`, `MMIM_GR4PO_DL_SRV.edmx`, `simple_inb_dlv_metadata.xml`, `sap_all_services.json`. `srv/external/` now holds only the six models in `package.json` `cds.requires` plus `all_catalog_services.json` (read by `tools/catalog.py`, `tools/verify-catalog-depth.py`, `tools/build-creatable-xlsx.py`). `tools/find-creatable.py --selftest` path updated to the new LORD location.
  - **Validation**: `python3 tools/find-creatable.py --selftest` → `selftest ok`. See gate run at 12:56 IST below.

## 2026-09-22 12:56 IST
- **Agent**: Claude (Cowork)
- **Change**: Audit item 42 — rotated `WORKSTATUS.md` (365 KB): the 55 entries from 2026-09-16 11:30 IST to 2026-09-19 18:12 IST moved verbatim to `logs/2026-09-16-to-19-archive.md` (173 KB); pointer at the top of this file updated. Nothing deleted. `WORKSTATUS.md` is now 193 KB with entries from 2026-09-21 onward.
- **Gate run (Mac, Node v22.23.1, 12:56 IST, after all nine changes above)**:
  - `npx cds compile srv` → OK
  - `npm run lint` (eslint .) → exit 0, no findings
  - `npx jest test/unit` → 65 suites / 959 tests passed (36.1 s; includes live DS4 client 220 tests)
  - `cd app/fiori-app && npx ui5lint` → "Success! No findings detected."
  - `cd app/fiori-app && npm run build` → "Build succeeded in 825 ms" (`dist/Component-preload.js` regenerated)
  - `git diff --check` and `git diff --cached --check` → clean
- **Not done / left as-is**: `DifferenceStorageType '999'` (5 places) untouched pending WM owner confirmation of the real interim storage type; `PlantName: \`Plant ${activeItem.Plant}\`` in `GoodsIssueAdapter.js` is still a synthesized label (not in this batch).
- **Commit state**: intentionally **not committed** (user request). Code edits are unstaged; the untracking (`git rm --cached`) and moves (`git mv`) are staged in the index. `git status` shows 12 modified files, 5 renames, 217 staged deletions, 1 new file (`logs/2026-09-16-to-19-archive.md`).

## 2026-09-22 13:05 IST
- **Agent**: Claude (Cowork)
- **Change**: `DifferenceStorageType '999'` removed from all 5 places. New `s4Config.getDifferenceStorageType()` (`srv/common/s4Config.js`) reads `cds.s4.differenceStorageType` / `S4_DIFFERENCE_STORAGE_TYPE` and throws `ConfigurationError` when unset — no default. `GoodsIssuePostingClient.postGoodsIssue` uses the caller value, else the configured value, and only when `DifferenceQty > 0` (HTTP 400 with the configuration message if a difference is posted and nothing is configured); when no difference is posted the field is sent empty. `goodsIssue.handler.js` queue fallback, `GoodsIssue.controller.js` payload and `GoodsIssueService.js` (2 places) no longer inject `999`. `.env.example` documents `S4_DIFFERENCE_STORAGE_TYPE` (value to be confirmed by the WM owner; SAP standard is 999).
  - **Tests**: `test/unit/common/s4Config.test.js` +2 (throws when unset, reads env); `test/unit/wm/goodsIssueController.test.js` expectation no longer asserts `'999'`.
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:06 IST
- **Agent**: Claude (Cowork)
- **Change**: `PlantName: \`Plant ${activeItem.Plant}\`` in `srv/integration/s4hana/wm/GoodsIssueAdapter.js` (resolved-reservation mapper) → `''`. It was a synthesized label, not SAP's plant name; no view displays it.
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:07 IST
- **Agent**: Claude (Cowork)
- **Change**: `srv/auth-service.js` — (a) local mock users (`alice`, `bob`, and the `khushal` mock branch) authenticate only against `LOCAL_DEV_PASSWORD`; the username is never accepted as the password, and mock login returns "Local mock users are disabled: set LOCAL_DEV_PASSWORD…" when it is unset. `khushal` / `S4_USERNAME` with `S4_PASSWORD` or S/4 Gateway credentials is unchanged. (b) The hardcoded 8-role Admin fallback is gone: roles come only from `cds.requires.auth.users` (package.json `[development]`/`[test]` already list alice/bob/khushal), anyone unlisted gets `Viewer`. Production gate (`NODE_ENV=production` / dev-token issuer off → 403) unchanged.
  - **Tests**: `test/unit/auth/authService.test.js` — 4 tests now set `LOCAL_DEV_PASSWORD`; +1 test (mock user rejected when unset); custom `S4_USERNAME` asserted to receive `Viewer` only.
  - **Operational note**: local mock logins now need `LOCAL_DEV_PASSWORD` in the environment.
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:08 IST
- **Agent**: Claude (Cowork)
- **Change**: `srv/integration/s4hana/S4HttpClient.js` — every request config (GET, POST, CSRF probe) carries `timeout: S4HttpClient.requestTimeoutMs()` (`S4_HTTP_TIMEOUT_MS`, default 30000 ms) so a hung S/4 call fails with an `S4HttpError` instead of blocking the CAP request. No automatic retry, by design: POSTs (goods movements, deliveries, orders) are not idempotent.
  - **Tests**: `test/unit/s4HttpClient.test.js` — 3 exact-config expectations include `timeout: 30000`; +1 test for the env override / bad value.
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:10 IST
- **Agent**: Claude (Cowork)
- **Change**: UI silent `catch` blocks (12 found): `service/ODataClient.js` (now imports `sap/base/Log`) and `service/AuthService.js` log a warning when the stored auth session is unreadable instead of swallowing it; 7 guards that are intentional (storage unavailable in private mode, autoplay rejection in `BarcodeScanService`, i18n bundle missing in `SalesOrders`/`OrdersDueForDelivery` `_text`, AuthService not loaded in the three model `getCurrentUserName` helpers) now carry a comment saying so. The remaining 2 (`SalesOrders.controller.js` and `OrdersDueForDelivery.controller.js` `_loadShippingPoints().catch(() => {})`) were dead code — the list it built (`deliveryDialog>/shippingPoints`) was never bound; the dialog ComboBox reads `outboundDelivery>/ShippingPointVH` directly — so the function, its calls and the model property were removed from both controllers.
  - **Tests**: `test/unit/le/ordersDueForDeliveryController.test.js` — dead `_loadShippingPoints` test removed.
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:12 IST
- **Agent**: Claude (Cowork)
- **Change**: Orders Due for Delivery KPI tiles now come from the server over the full due set instead of the loaded page. New `function getOrdersDueMetrics() returns { scheduleLineCount, shippingPointCount }` in `srv/le/outbound-delivery/service.cds`; handler reads `outboundDeliveryAdapter.getOrdersDueForDelivery({})` (unpaged, same SAP read as the worklist) and counts rows and distinct `ShippingPoint`; errors go to `req.error` (never zero counts). `OutboundDeliveryService.getOrdersDueMetrics()` added in the UI service (rejects when figures are missing). Controller: `_loadServerMetrics` (called on init and route match) sets `/totalCount` and `/shippingPointCount`, `"-"` on failure; the page-level `onUpdateFinished` computation and the view's `updateFinished` binding were removed; initial model values are `"-"`. i18n `ordersDueKpiShippingPointsSub` → "Distinct across all due lines".
  - **Tests**: `test/unit/le/outboundDeliveryHandler.test.js` +2 (counts, error path); `test/unit/le/ordersDueForDeliveryController.test.js` — page-level KPI test replaced by 2 server-metrics tests (values, `"-"` on failure).
  - **Validation**: see gate run at 13:16 IST below.

## 2026-09-22 13:13 IST
- **Agent**: Claude (Cowork)
- **Change**: Status banner added to the two quotation-era SAP change requests, `docs/sap-inquiry-service-extension-spec.md` and `docs/ticket-vtaa-copy-control-zin-zqt.md`: the application-side quotation feature is removed; the documents remain as SAP-side (ABAP/Basis) requests only. `docs/ticket-gateway-remediation-ds4.md` left untouched — it is the live Basis ticket (system aliases, `API_MATERIAL_DOCUMENT_SRV`, `ZUI_GI_ORDER_RSV_O4`).
- **Gate run (Mac, Node v22.23.1, 13:14–13:16 IST, after all changes above)**:
  - `npx cds compile srv` → OK
  - `npm run lint` (eslint .) → exit 0, no findings
  - `npx jest test/unit` → first run 3 failures (tests encoding the old `'999'` / username-as-password behaviour, updated as listed above); rerun 65 suites / 965 tests passed (36.6 s; includes live DS4 client 220 tests)
  - `cd app/fiori-app && npx ui5lint` → "Success! No findings detected."
  - `cd app/fiori-app && npm run build` → "Build succeeded in 657 ms" (`dist/Component-preload.js` regenerated; no UI source changed after the build)
  - `git diff --check` → clean
- **Commit state**: intentionally **not committed** (user request); all changes unstaged.
- **Still open (needs a person, not code)**: the real value for `S4_DIFFERENCE_STORAGE_TYPE` from the WM owner; Basis ticket `docs/ticket-gateway-remediation-ds4.md`; ABAP ticket `docs/ticket-vtaa-copy-control-zin-zqt.md`.

## 2026-09-22 13:30 IST
- **Agent**: Claude (Cowork)
- **Change (Master Data, audit row 9)**: sales material value help no longer hardcodes `MaterialType = 'ZFRT' or 'FERT'`. `s4Config.getSalesMaterialTypes()` reads `cds.s4.salesMaterialTypes` / `S4_SALES_MATERIAL_TYPES` (package.json now lists `["ZFRT","FERT"]`, `.env.example` documents the override); `SalesInquiryAdapter.getMaterials` builds the OR filter from it. The scope is stated on screen: material placeholders on Create Sales Order / Create Sales Inquiry read "Finished goods only (configured material types)".
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:33 IST
- **Agent**: Claude (Cowork)
- **Change (Master Data / SD, audit row 23)**: `SalesInquiryAdapter.getCustomerDefaults` — currency no longer starts from the configured `INR`; office, group and currency come only from the customer's previous inquiries (`C_InquiryWL_F2370`) and set `derived: true`. The two "first row of the value help" heuristics (first sales office for the sales area, first sales group of that office) are removed; only the office name of a known office is still resolved (master lookup). Ship-to is no longer proposed as the sold-to (`ShipToParty: ''`) — S/4HANA partner determination sets it on create. Sales-area parameters are kept in the signature for API compatibility (`_sOrg`, `_sChannel`, `_sDivision`).
  - **UI**: Create Sales Order / Create Sales Inquiry show a toast when `derived` is true ("Currency, sales office and sales group were taken from this customer's previous sales documents. Verify before submitting.") — same pattern as the PO "from last PO" note. New i18n keys `msgCustomerDefaultsFromHistory`, `msgCustomerDefaultsUnavailable`, `msgOrderDefaultsUnavailable`.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:36 IST
- **Agent**: Claude (Cowork)
- **Change (SD, audit row 24 residual)**: no proposed dates. `getSalesOrderDefaults` no longer returns `RequestedDeliveryDate = today + 7`; `getSalesInquiryDefaults` no longer returns `BindingPeriodValidityEndDate = today + 30`; `SalesInquiryModel.createInitialModel` no longer pre-fills the +30 validity end. S/4HANA derives the requested delivery date from customizing when the field is left blank; the validity end is entered by the user.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:40 IST
- **Agent**: Claude (Cowork)
- **Change (SD, audit row 26)**: document totals after create come only from the real `LORD_ODATA_ORDER_SRV` HeaderSet fields (`NetAmount`, `TotalAmount`, `TaxAmount`, `DocumentCurrency` — verified against `docs/sap-metadata-reference/LORD_ODATA_ORDER_SRV.edmx`; `NetValue` and `Currency` do not exist there). Removed in both branches of `createSalesDocument`: the `NetAmount ?? TotalAmount ?? NetValue` cascade (tax-inclusive total was shown as net), the locally computed `totalNet` (qty × price) fallback, and the `header.TransactionCurrency || s4Config.getCurrency()` currency fallback. Inquiry branch: the header POST answers before items exist, so the header is now read back by default (`options.readBack !== false`) and totals are reported only from that read-back; otherwise blank.
  - **Tests**: `salesOrderAdapter.test.js` mocks use the real field names; 3-step inquiry tests expect 3 POSTs + 1 read-back GET; `salesInquiryAdapter.test.js` header mock carries `DocumentCurrency` and a 4th read-back mock with `NetAmount`.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:43 IST
- **Agent**: Claude (Cowork)
- **Change (SD UI)**: `SalesOrderService.getCustomerDefaults` / `getSalesOrderDefaults` and `SalesInquiryService.getCustomerDefaults` / `getSalesInquiryDefaults` no longer swallow failures into blank objects (which were indistinguishable from "SAP has no data"); they reject, and the create controllers show "Customer data could not be loaded from SAP." / "Order defaults could not be loaded from SAP. Enter the organisational data manually.".
  - **Tests**: `salesInquiryCreationPayload.test.js` — two tests now assert rejection instead of silent blanks.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:47 IST
- **Agent**: Claude (Cowork)
- **Change (WM – Goods Receipt, audit rows 33–35 residuals)**: `GoodsReceiptAdapter.resolveStorageUnit` no longer pre-selects anything from pick lists: storage location / bin were the FIRST row of the plant's 696-row value help, the batch was `batches[0]`, and the unit fell back to the first storage location's or batch's unit. Now: storage location, bin and batch come only from the scanned object or the document item (`GR4PO_DL_Items`), and the batch's SLED/status is taken from the matching batch row; unit only from the scan or the document item. `Quantity` (proposed) is SAP's `OpenQuantity` and nothing else — the old cascade proposed `QuantityInEntryUnit` / `OrderedQuantity` again when open was 0. `StorageLocationName` is no longer filled with the code. Non-outage lookup failures (storage locations, batches, open quantity) are returned in a new `LookupWarnings` array (`service.cds` `StorageUnitDetails`) and shown by the GR screen in a warning dialog ("Some SAP data could not be read"); outages still throw as before.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:50 IST
- **Agent**: Claude (Cowork)
- **Change (WM – Goods Issue, audit rows 40(a), 41 residual)**: `GoodsIssueBatchesClient` sums `MaterialMultiStockByDates` rows per batch (a batch in several storage locations was previously reported with the LAST row's stock only); when rows disagree on storage location the batch's location is left blank (or the requested one). `DaysToExpiry` for "NO SLED" / "SU BATCH NOT STATED" is `null` instead of the synthetic `9999` (`srv/common/batchUtils.js`, `GoodsIssueReservationsClient.js`, `GoodsIssueStockUnitClient.js` ×2). SU-not-found response in `goodsIssue.handler.js` returns `CurrentStock` / `SuStockQty` `null` instead of `0` and `DeterminedBatchDaysToExpiry` `null` instead of `0`.
  - **Tests**: `test/unit/common/batchUtils.test.js` expects `null`.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:54 IST
- **Agent**: Claude (Cowork)
- **Change (Cross-module, audit row 1 caveat)**: dashboard figures say how old they are. `PurchaseOrderAdapter.getDashboardMetrics` adds `asOf` (ISO time SAP was read; a cached answer keeps its original `asOf`). Dashboard header shows "S/4HANA connected · figures as of HH:MM (server cache: 30 s transactional, 5 min master data)" (`dashboardConnectionOkAsOf`); without `asOf` the old text is kept.
  - **Tests**: `dashboardMetrics.test.js` +1 (asOf rendered), adapter test asserts `asOf` is a valid time.
  - **Validation**: see gate run at 13:59 IST below.

## 2026-09-22 13:57 IST
- **Agent**: Claude (Cowork)
- **Change (MM – Purchase Order)**: a failed supplier-history lookup is no longer reported as "no history". `purchaseOrder.handler.js` `getSupplierDefaults` returns `source: 'lookup failed'` when the S/4 read throws; `PurchaseOrderService.getSupplierDefaults` (UI) does the same in its final catch; `CreatePurchaseOrder` shows "Supplier history could not be read from SAP. Enter currency, payment terms and Incoterms manually." and applies nothing.
  - **Tests**: `poConfigDefaulting.test.js` expects `source: 'lookup failed'` on a rejected read.
- **Gate run (Mac, Node v22.23.1, 13:58–13:59 IST, after all changes above)**:
  - `npx cds compile srv` → OK
  - `npm run lint` (eslint .) → exit 0, no findings
  - `npx jest test/unit` → 65 suites / 966 tests passed (35.2 s; includes live DS4 client 220 tests). Earlier runs surfaced 7 tests that encoded the old behaviour (3-call counts, `9999`, `NetValue`/`Currency` mocks, silent-blank defaults, `source: ''`); each was updated as listed above.
  - `cd app/fiori-app && npx ui5lint` → "Success! No findings detected."
  - `cd app/fiori-app && npm run build` → "Build succeeded" (`dist/Component-preload.js` regenerated; no UI source changed after the build)
  - `git diff --check` → clean
- **Verified, nothing to change**: FI — journal-entry READ propagates errors (`req.error`), KPI labels "Total Line Items" / "G/L Accounts – Chart of Accounts" are accurate; MM — `formatter.js` never synthesises a PO status from completeness/release flags; SD row 18 — `SDDocumentCategory 'A'` is the query's own filter (both sources return inquiry types only), not an assumption.
- **Commit state**: intentionally **not committed** (user request); all changes unstaged.
- **Still open (needs a person, not code)**: `S4_DIFFERENCE_STORAGE_TYPE` value from the WM owner; `LOCAL_DEV_PASSWORD` in the local environment for mock logins; Basis ticket `docs/ticket-gateway-remediation-ds4.md`; ABAP ticket `docs/ticket-vtaa-copy-control-zin-zqt.md`.

## 2026-09-22 14:30 IST
- **Agent**: Claude (Cowork)
- **Change**: evidence-only search for a service that creates **Sales Contracts** (user request). `tools/verify-quotation-services.py` made reusable via env `PATTERN` / `OUT` / `DIRECT` (defaults unchanged, quotation behaviour identical) and run with a sales-contract pattern; results in `docs/sales-contract-service-findings.md` (new), machine report `docs/contract-metadata/REPORT.txt` (new), raw metadata `docs/contract-metadata/*.xml` (gitignored, `.gitignore` updated). `docs/ticket-gateway-remediation-ds4.md` gained **Item 4 — Register `API_SALES_CONTRACT_SRV`**.
  - **Executed (Mac, GET only, 14:15–14:25 IST)**: `$metadata` of 1,242 services (1,237 live V2 from `catalog-audit.csv` + 5 direct probes); `I_SalesDocumentType` (category G); `C_SalesContractWl_F1851` count; `C_SalesContractTypeValueHelp`.
  - **Result**: no registered service exposes a creatable sales-contract entity set or a create function import (9 services name sales contracts, all `sap:creatable="false"`). `API_SALES_CONTRACT_SRV` → HTTP 403 `/IWFND/MED/170` (not registered); V4 `API_SALESCONTRACT` / `UI_SALESCONTRACTMANAGE` → 404 `/IWBEP/CM_V4_COS/014` (not published). `LORD_ODATA_ORDER_SRV` metadata does not mention contracts; untested. Client 220: 12 contract types, only `ZGCQ` unlocked; 52 contracts exist (latest 3000051–3000053, type ZGCQ).
  - **Validation**: `python3 -c "import ast; ast.parse(...)"` on the script → OK; the quotation default path is unchanged (`PATTERN` unset ⇒ same regex, same direct probes). No SAP POST was made.
  - **Next**: Basis registers `API_SALES_CONTRACT_SRV` (ticket item 4), then re-run the scan with `DIRECT='API_SALES_CONTRACT_SRV=/sap/opu/odata/sap/API_SALES_CONTRACT_SRV'` to verify `A_SalesContract` is creatable before any application work.

## 2026-09-22 14:50 IST
- **Agent**: Claude (Cowork)
- **Change**: SD module — verified creatable services (user picked SD). `$metadata` of 8 SD services fetched live (GET only) and saved to `docs/sd-metadata/*.xml` (gitignored); function imports with parameters and creatable entity sets recorded in `docs/sd-creatable-services.md` (new). Result: PGI (`SD_SOFM_CREDIT_BLOCK_SRV.PostGoodsIssue`), billing (`SD_CUSTOMER_INVOICES_CREATE.CreateBillingDocuments`, `SD_SOFM_INVOICE_SRV.createInvoice/postToAccount`), credit release and delivery-without-reference are creatable per metadata and untested; quotation/contract remain blocked SAP-side.
  - **Validation**: HTTP 200 on all 8 metadata calls; no POST made. Next recommended build: PGI + billing from a delivery.

## 2026-09-22 14:55 IST
- **Agent**: Claude (Cowork)
- **Change**: **Post Goods Issue → Create Billing Document from a delivery** (SD, user request). Services and parameters taken from the live metadata saved in `docs/sd-metadata/` (22 Sep), not assumed.
  - `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`: `postGoodsIssue(delivery)` → POST `SD_SOFM_CREDIT_BLOCK_SRV/PostGoodsIssue?DeliveryNumber='…'`, success only when SAP's `PostGoodsReturnInfo.Done=true` and `ErrorAny!=true`, otherwise 422 naming the true `Error*` flags (SAP returns no material document number, so none is shown); `getBillingDocumentTypes(delivery)` → POST `SD_CUSTOMER_INVOICES_CREATE/GetBillingDocumentTypes?ReferenceSDDocument='…'`; `createBillingDocument({deliveryDocument, billingDocumentType, billingDocumentDate})` → POST `CreateBillingDocuments?ReferenceSDDocument=…&ReferenceSDDocumentCategory='J'&BillingDocumentType=…[&BillingDocumentDate=YYYYMMDD]`, billing number only from SAP's `FunctionImportResult`, SAP messages returned verbatim, 422 when no number. `'J'` = SAP document category of an outbound delivery (fixed domain value, commented).
  - `srv/le/outbound-delivery/service.cds` + handler: action `postGoodsIssue`, function `getBillingDocumentTypes`, action `createBillingDocument` (roles: PGI = warehouse/sales manager/admin; billing = sales rep/manager/admin).
  - UI (`OutboundDeliveryService.js`, `OrdersDueForDelivery.controller.js/.view.xml`, i18n ×2): "Delivery follow-up" panel — delivery number (pre-filled after Create Delivery), Post Goods Issue (confirm dialog), Load Billing Types (Select filled only from SAP), optional billing date, Create Billing Document (confirm). Success/error texts carry SAP's message verbatim.
  - **Tests**: `outboundDeliveryAdapter.test.js` +6 (URL shape, Done/ErrorAny handling, type filtering, category J + date, no-number → error); `outboundDeliveryHandler.test.js` +2.
- **Gate run (Mac, Node v22.23.1, 14:54–14:55 IST)**: `cds compile` OK · eslint 0 · jest 65 suites / 974 tests passed · ui5lint no findings · ui5 build succeeded (`Component-preload.js` regenerated) · `git diff --check` clean.
- **Not done**: no live POST was made. First live PGI and billing run needs an explicit delivery number from the user (13000526 is a candidate if it is picked and unposted in VL03N) — the app now shows exactly what SAP answers.
- **Commit state**: uncommitted (user request).

## 2026-09-22 15:05 IST
- **Agent**: Claude (Cowork)
- **Change**: PGI → billing made proper ("Fix All Make a proper"). (1) New `getDeliveryStatus(DeliveryDocument)` (adapter + cds function + handler + UI service): reads the delivery header from `SD_SOF/I_DeliveryDocument` by `$filter` (verified live; the single-key read fails with `LCX_INVALID_SECTION_TYPE`) — type, ship-to, `OverallPickingStatus`, `OverallGoodsMovementStatus`, `OverallDelivReltdBillgStatus`, goods-movement date; 404 when SAP has no such delivery. (2) The follow-up panel loads it on entering a delivery number and on each success; buttons are gated on SAP's statuses only — PGI needs picking `C` and goods movement ≠ `C`; billing needs goods movement `C` and billing ≠ `C`. Status line shows the SAP codes with the STATV meaning (A not started / B partial / C complete). (3) `BillingDocumentType` is optional: live `GetBillingDocumentTypes` returned an empty list for goods-issued delivery 13000522 and for 13000526, so the type Select is optional and when empty `CreateBillingDocuments` is called without a type and S/4HANA determines it from copy control (as VF01 does).
  - **Live checks (GET / non-modifying, 15:00 IST)**: `I_DeliveryDocument` — 13000526 (created by this app) is `ZLF`, picking A, goods movement A → PGI not possible yet (needs picking); PGI-ready deliveries in client 220: 13000515, 13000498, 13000487, 13000449, 13000017 (picking C, goods movement A); billable (goods movement C, billing A): 13000522. `LE_SHP_OUTBOUND_DELIVERY_FS` and `LE_SHP_DELIVERY_PICK` answer 500 `/IWFND/CM_COS/064` (no system alias — Basis ticket item 1). `GetBillingDocumentTypes` → HTTP 200, `results: []` for both deliveries.
  - **Tests**: adapter +1 (status read / null), handler +1 (status / 404), adapter billing test covers the no-type URL; controller mock gained `getDeliveryStatus`.
- **Gate run (Mac, Node v22.23.1, 15:04–15:05 IST)**: `cds compile` OK · eslint 0 · jest 65 suites / 976 tests passed · ui5lint no findings · ui5 build succeeded · `git diff --check` clean.
- **Not done**: no PGI or billing POST has been made — both change stock/accounting in client 220 and are waiting for the user's go on a specific delivery (PGI: 13000515; billing: 13000522).
- **Commit state**: uncommitted (user request).

## 2026-09-22 15:18 IST
- **Agent**: Claude (Cowork)
- **Change**: end-to-end check of the new screen in the running app (`cds serve` on the Mac, built-in browser, dev login `alice` with a throw-away `LOCAL_DEV_PASSWORD` set only for that server process; server stopped afterwards). Backend verified live: `getDeliveryStatus` 13000515 → picking C / goods movement A; 13000526 → A / A; 99999999 → 404; `getOrdersDueMetrics` → 234 lines / 2 shipping points; `getBillingDocumentTypes` 13000522 → `[]`.
  - **Bug found & fixed (all modules)**: opening the app on a deep link before login (e.g. `#/le/orders-due`, or a browser refresh after the session expired) left every list on that OData V4 service empty after login — the V4 model had fetched `$metadata` with HTTP 401 and caches that failure for its lifetime, so `changeHttpHeaders` after login cannot repair it (KPIs, which use plain fetch, still worked — the screen showed "234" and "No orders found" at once). `Login.controller.js` now reloads the page to `#dashboard` after a successful login instead of `navTo`, re-creating all models with the stored session. Test added (`loginController.test.js`); the existing navTo path stays as fallback without `window`.
  - **Also fixed**: `onLoadDeliveryStatus` reads the live Input value before the two-way binding writes the model (Enter can fire `submit` first).
  - **Verified in the browser after rebuild**: deep link → login → list shows 234 due lines; follow-up panel for 13000515 shows "Type ZLF · Ship-to 10358 · Picking C (complete) · Goods movement A (not started) · Billing A (not started)", Post Goods Issue enabled, billing disabled; for 13000522 goods movement C → Create Billing Document enabled, SAP returns no billing types (type left to SAP). No PGI/billing POST made.
- **Gate run (15:17 IST)**: eslint 0 · jest 65 suites / 977 tests · ui5lint no findings · `cds compile` OK · `git diff --check` clean · UI5 build 15:15 (preload regenerated).
- **Commit state**: uncommitted (user request).

## Current Status
- **2026-09-22 13:59 IST (uncommitted)**: module-by-module pass closed the remaining audit residuals — Master Data (material-type scope config, customer defaults history-only, cache age shown), SD (no proposed dates/ship-to, totals only from real HeaderSet fields, no silent blank defaults), WM (GR no first-row proposals + lookup warnings, GI batch stock summed, no synthetic 9999/0), MM (failed supplier lookup flagged). Gates green (cds compile, eslint, jest 966/966, ui5lint, ui5 build, diff --check).
- **2026-09-22 13:16 IST (uncommitted)**: remaining audit items closed — `999` default removed (config required), synthesized PlantName, dev-auth username-as-password and implicit Admin, S/4 HTTP timeout, UI silent catches, Orders Due KPIs server-side, doc banners. Gates green (cds compile, eslint, jest 965/965, ui5lint, ui5 build, diff --check).
- **2026-09-22 12:56 IST (uncommitted)**: audit items 13, 22, 23, 24, 26, 27, 40, 41, 42 applied; all gates green (cds compile, eslint, jest 959/959, ui5lint, ui5 build, diff --check). `999` DifferenceStorageType still open.
- **Branch**: `feature/CL01`
- **Build Status**: **100% Green** across repository test suites:
  - `npm test`: **76 passed, 76 total test suites; 1010 passed, 1010 total tests (100% green)**.
  - `npm test -- test/unit/sales-order/`: **5 passed, 5 total test suites; 69 passed, 69 total tests (100% green)**.
  - `npm test -- test/unit/purchase-order/`: **19 suites passed, 207 passed, 207 total tests (100% green)**.
  - `npm test -- test/unit/purchase-order/formatter.test.js`: **12 passed, 12 total tests (100% green)**.
  - `npm test -- test/unit/fi/journalEntryService.test.js`: **3 passed, 3 total tests (100% green)**.
  - `npm test -- test/unit/dashboard/dashboardMetrics.test.js`: **31 passed, 31 total tests (100% green)**.
  - `npm test -- test/unit/wm/goodsReceiptService.test.js`: **41 passed, 41 total tests (100% green)**.
  - `npm test -- test/unit/wm/goodsReceiptController.test.js`: **20 passed, 20 total tests (100% green)**.
  - `npm --prefix app/fiori-app run lint`: 0 findings.
  - `npm --prefix app/fiori-app run build`: Succeeded; `Component-preload.js` generated.
  - `npx cds compile srv`: 0 errors.
  - `git diff --check`: Clean (0 errors).
- **Elimination of Hardcoded Defaults from Create Sales Order (Audit Row 24)**:
  - Eliminated hardcoded literals (`ZDOM`, `1000`, `10`, `52`, `INR`, `KG`, `1120`, plant `"1000"`, `quantity || 1`, `delivery date today + 7`) across `SalesOrderModel.js`, `SalesOrderService.js`, and `CreateSalesOrder.controller.js`.
  - Initial model starts empty; defaults sourced exclusively from server `getSalesOrderDefaults()` via `applyServerDefaults()`. Empty on failure.
- **PO Status Verification & Elimination of Completeness Fallback (Audit Row 4)**:
  - Integrated 33 verified status codes from SAP Gateway `C_PURCHASEORDER_FS_SRV/I_PurchasingDocumentStatusText`.
  - Eliminated synthetic guessing (`completeness = true -> Approved`, `completeness = false -> Draft`, `releaseNotCompleted -> In Approval`). Status strictly shows SAP status name or verified code lookup.
- **External Service Configuration Hardening (FAC_GL_JOURNALENTRY_VER_SRV Default URL Removal)**:
  - Removed non-production `http://localhost:5000` default from `package.json`.
  - Service fails loudly with explicit missing credentials error when `S4_DESTINATION_URL` is unset, matching architecture standards.
- **Dashboard FI Tile Relabeling (Audit Row 2)**:
  - Relabeled `dashboardKpiFIDocs` to "Items to be verified" across `i18n.properties` and `i18n_en.properties`.
  - Reflects authentic data lineage of `FAC_GL_JOURNALENTRY_VER_SRV/C_GLJrnlEntryItemToBeVerified` line items awaiting verification.
- **Goods Receipt Storage-Location Picker Dead Source Elimination (Audit Row 35 / Option 2C)**:
  - Dead service `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` (0 rows in SAP) dropped.
  - Replaced with live SAP Storage Location Value Help `MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp` (696 records in SAP Client 220) filtered by `Plant`.
  - In `GoodsReceiptAdapter.getStorageUnitDetails`: Authentically extracts and prioritizes `StorageLocation` and `StorageLocationName` from `GR4PO_DL_Items`. Document storage location is guaranteed in `AvailableStorageLocations`.
  - UI `<Select id="selectStorageLocation">` in `GoodsReceipt.view.xml` renders with the document's authentic storage location pre-selected (`CS01 - Chemical Store`) and valid plant storage locations available for selection.
- **Goods Receipt Outage Propagation, Null Quantities, and Pick List Error Handling (Audit Rows 33, 34, 35)**:
  - In `GoodsReceiptAdapter.js`: `_isOutage` added; empty catch blocks across Tiers 1-6 replaced to rethrow backend outages immediately.
  - CAP handler `getStorageUnitDetails` rejects with 502/503/504 on backend outage instead of masking as 404 "barcode not found".
  - Fiori Goods Receipt UI distinguishes backend outages and displays an explicit S/4HANA backend outage dialog.
  - Missing/failed item reads return `Quantity: null`, `OpenQuantity: null`, `OrderedQuantity: null`, `QuantityInEntryUnit: null` rather than coercing to 0.
  - `getMaterialStorageLocations` and `getMaterialBatches` throw on S/4HANA outages/errors; CAP handlers reject with 502, surfacing SAP failures instead of silently returning `[]`.
- **Goods Issue Reservation List 2,000 Cap Truncation Fix (Audit Row 37)**:
  - In `GoodsIssueReservationsClient.js`: `getOpenReservations` pushes `reservationNo` and `orderNo` server-side into SAP OData filter before paging, ensuring specific reservation/order lookups bypass arbitrary item limits.
  - Non-silent truncation: When 2,000 items are reached, backend logs diagnostic warning, sets `IsTruncated: true`, sets `TruncationNote`, and marks cutoff reservation with `ItemCountPartial: true` and `${ItemCount}+ items (partial)`.
  - Frontend displays `MessageStrip` notification, updates toast to inform user of the 2,000 item scan, and allows manual numeric reservation selection.
- **Sales Order HTTP Fallback Filter Preservation (Audit Row 19)**:
  - In `SalesInquiryAdapter.js`: `getSalesOrders` HTTP fallback dynamically constructs `$top`, `$skip`, `$orderby`, `$inlinecount`, and `$filter`.
  - CQN WHERE clauses, operators, parentheses, string functions, and plain objects translated to valid OData v2 filter syntax via `_cqnWhereToODataFilter`.
  - Refusal-to-drop policy: Throws HTTP 500 when filter cannot be safely translated, guaranteeing no unfiltered data is returned when the user requested filtered sales orders.
- **Fix Approval Lookup Failure Masking Unapproved Orders (Audit Row 31)**:
  - In `OutboundDeliveryAdapter.js`: `_fetchApprovalStatusMap` clears cache and returns `null` on lookup error (never stale cache or empty map).
  - `_formatOrderResults`: Maps `SalesDocApprovalStatus = 'unknown'` when `approvalStatusMap === null`.
  - `createDeliveryFromOrder`: Blocks delivery creation with HTTP 502 if approval lookup failed (`null`) and HTTP 400 if order is unapproved (`A`, `C`, `D`).
  - `service.cds`: `OrdersDueForDelivery.SalesDocApprovalStatus` widened to `String(10)`.
  - UI5 Views & Controllers: `OrdersDueForDelivery` and `SalesOrders` show `Warning` ("Unknown") badge, disable Create Delivery button, and warn in `onCreateDeliveryPress`.
  - Added localization keys to `i18n.properties` and `i18n_en.properties` with 100% key parity.
- **Goods Issue Open Quantity Queue Deduction & Double-Issue Prevention (Audit Row 38)**:
  - Deducts pending quantities in local CAP dispatch queue (`openQty = isFinalQueued ? 0 : Math.max(0, reqQty - wdnQty - queuedQty)`).
  - Exposes `QueuedQty` on OData `GIItems` and `GIComponentItem`.
  - Excludes fully queued items from `getOpenItems` and `getOpenReservations`.
  - Rejects SU resolution with HTTP 400 when an item is already fully issued or queued.
- **Goods Issue Handling Unit Unknown Stock Bug Fix (Audit Row 40 Residual (b))**:
  - `currentStock !== null` checks prevent treating unknown SAP stock as zero.
  - Prevents false HTTP 422 "SAP reports no stock" and prevents `Math.min(null, openQty) = 0`.
- **Customer Master Tile Relabeling across Sales Screens**:
  - Relabeled "Active Customers" tile to "Customers" (subtitle "Customer records in SAP") across Sales Orders and Sales Inquiries, reflecting authentic S/4HANA server customer master count (891).
- **Development User Authentication Support**:
  - Fixed credential validation so `KHUSHAL` can authenticate with both local mock credentials and authentic S/4HANA credentials (`S4_PASSWORD` / S/4 Gateway).
- **MessageToast Dock Position Normalization (SAP DINC0487249)**:
  - Fixed `"center bottom" is not of type "sap.ui.core.Popup.Dock"` console validation errors on `MessageToast.show`.
  - Pinned UI5 CDN updated to LTS maintenance patch `1.136.22`.
  - Added module-level and runtime defensive normalization in `Component.js`.

## Next Steps
1. Review the uncommitted 2026-09-22 13:30–14:55 IST changes (`git status`, `git diff`), then stage, commit, and push to `origin/feature/CL01`.
2. Supervised live test: PGI on one picked, unposted delivery, then Load Billing Types + Create Billing Document on it; record SAP's numbers/messages here.
2. Set `LOCAL_DEV_PASSWORD` in the local environment (mock logins) and, once the WM owner confirms the interim storage type, `S4_DIFFERENCE_STORAGE_TYPE` (needed only for Goods Issue differences).
3. Proceed to the next data lineage item from `docs/data-lineage-audit.md`.
