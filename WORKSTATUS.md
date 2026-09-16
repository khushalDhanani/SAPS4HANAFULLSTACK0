
# Changes Log

> **Historical changes**: See [logs/2026-09-archive.md](logs/2026-09-archive.md) for all entries prior to 2026-09-16 12:00 IST.

## 2026-09-16 11:30 IST
- **Agent**: Antigravity
- **Change**: Frontend data layer unification and UI5 version pinning — declared OData V4 models for WM and EWM in `manifest.json`, pinned UI5 CDN to `1.136.0`, enabled preload bundle generation (`Component-preload.js`), wired V4 models in `Component.js`, and enabled V4 list binding reads with backward-compatible fallbacks in WM/EWM services while preserving `ODataClient` for actions.
  - **Files modified**:
    - `app/fiori-app/webapp/index.html`: Pinned bootstrap CDN to `https://ui5.sap.com/1.136.0/resources/sap-ui-core.js` and removed `data-sap-ui-preload=""`.
    - `app/fiori-app/webapp/manifest.json`: Declared `goodsIssueService`, `goodsReceiptService`, and `warehouseManagementService` dataSources and `goodsIssue`, `goodsReceipt`, and `warehouseMgmt` models with `operationMode: "Server"` and `autoExpandSelect: true`.
    - `app/fiori-app/webapp/Component.js`: Injected `goodsIssue`, `goodsReceipt`, and `warehouseMgmt` models into `GoodsIssueService`, `GoodsReceiptService`, and `EwmService` during component initialization.
    - `app/fiori-app/webapp/modules/ewm/warehouse-cockpit/service/EwmService.js`: Implemented `setModel`/`getModel`, `_readEntitySet`, dual-mode parameter handling, and clean filter operator fallbacks adhering to `ui5lint` `no-globals`.
    - `app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssueService.js`: Implemented `setModel`/`getModel`, `_readEntitySet`, dual-mode parameter handling for entity set queries, and clean filter operator fallbacks.
    - `app/fiori-app/webapp/modules/wm/goods-receipt/service/GoodsReceiptService.js`: Implemented `setModel`/`getModel`, `_readEntitySet`, dual-mode parameter handling for entity set queries, and clean filter operator fallbacks.
  - **Validation**:
    - `npm test`: **72 passed, 72 total test suites; 941 passed, 941 total tests (100% green)** in 44.1 s.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `cd app/fiori-app && npm run build`: Build succeeded in 689 ms; `Component-preload.js` generated at 535 KB.
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit frontend unification to `feature/CL01`.

## 2026-09-16 12:00 IST
- **Agent**: Antigravity
- **Change**: Repository hygiene cleanup — moved root-level S/4 metadata dumps to `srv/external/`, rotated WORKSTATUS.md (876 KB / 9,034 lines → archived to `logs/2026-09-archive.md`), untracked 28 PNG screenshots (8.3 MB) from `docs/`, updated `.gitignore` with screenshot and trace rules.
  - **Files moved**:
    - `simple_inb_dlv_metadata.xml` → `srv/external/simple_inb_dlv_metadata.xml` (228 KB)
    - `sap_all_services.json` → `srv/external/sap_all_services.json` (124 KB)
  - **Files archived**:
    - `WORKSTATUS.md` changes log (239 entries, lines 2–7985) → `logs/2026-09-archive.md` (856 KB)
    - Embedded AGENTS.md copy (lines 7986–9034) stripped — redundant with standalone `AGENTS.md`
  - **Files untracked from git**:
    - 28 PNG files in `docs/` and `docs/screenshots/` (~8.3 MB total)
    - Files remain on disk locally but are excluded from future commits
  - **`.gitignore` updated**:
    - Added `docs/screenshots/`, `docs/*.png`, `dev_*`, `rfc*.trc` rules
  - **Root cause**: WORKSTATUS.md at 876 KB was approaching 1 MB, metadata dumps at root cluttered the project structure, tracked screenshots inflated the repo by 8.3 MB, and the last push failed until the git buffer was raised.
  - **Validation**:
    - `npm test`: **72 passed, 72 total test suites; 941 passed, 941 total tests (100% green)** in 46.1 s.
    - `cd app/fiori-app && npm run lint`: 0 findings detected.
    - `cd app/fiori-app && npm run build`: Succeeded in 1.09 s.
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit hygiene cleanup to `feature/CL01`.

## 2026-09-16 12:15 IST
- **Agent**: Antigravity
- **Change**: Complete Frontend Data Layer Unification, UI5 Version Pinning, Component Preload, and OData V4 Model Integration across WM, EWM, MM, and SD modules.
  - **Part C — UI5 Version Pinning & Preload**:
    - `app/fiori-app/webapp/index.html`: Pinned SAPUI5 CDN bootstrap from open-ended `@latest` to official stable release `https://ui5.sap.com/1.136.0/resources/sap-ui-core.js`. Removed `data-sap-ui-preload=""` attribute so that the UI5 core loads `Component-preload.js` in production and test environments.
  - **Part A — Missing OData V4 DataSources & Models in Manifest**:
    - `app/fiori-app/webapp/manifest.json`: Declared `goodsIssueService` (`/odata/v4/goods-issue/`), `goodsReceiptService` (`/odata/v4/goods-receipt/`), and `warehouseManagementService` (`/odata/v4/warehouse-management/`) dataSources. Configured corresponding `goodsIssue`, `goodsReceipt`, and `warehouseMgmt` OData V4 models with `operationMode: "Server"` and `autoExpandSelect: true`.
  - **Part B — Service Refactoring & Controller Wiring**:
    - `app/fiori-app/webapp/service/ODataClient.js`: Marked `ODataClient.get()` as `@deprecated` for entity reads, directing callers to use OData V4 model bindings (`bindList` / `requestContexts`). Preserved `ODataClient.post()` for transactional CAP unbound actions (`postGoodsIssue`, `postGoodsReceipt`, `createWarehouseTask`, etc.).
    - `app/fiori-app/webapp/controller/BaseController.js`: Added `getModel(sName)` convenience helper resolving models from view hierarchy or owner component.
    - `app/fiori-app/webapp/Component.js`: Injected V4 models (`goodsIssue`, `goodsReceipt`, `warehouseMgmt`, `purchaseOrder`, `salesInquiry`) into their corresponding singleton services (`GoodsIssueService`, `GoodsReceiptService`, `EwmService`, `PurchaseOrderService`, `SalesInquiryService`) during `init()`.
    - **WM / EWM Services & Controllers**:
      - `GoodsIssueService.js`: Added `setModel`/`getModel`, `_readEntitySet` via V4 list bindings, dual-mode parameter handling for `fetchOpenReservations`, `fetchOpenItems`, and `fetchMaterialBatches`, with safe fallback to `ODataClient.get()`.
      - `GoodsReceiptService.js`: Added `setModel`/`getModel`, `_readEntitySet`, dual-mode parameter handling for `fetchOpenInboundDeliveries`, `fetchMaterialStorageLocations`, and `fetchMaterialBatches`.
      - `EwmService.js`: Added `setModel`/`getModel`, `_readEntitySet`, dual-mode parameter handling for all entity set reads (`getWarehouses`, `getWarehouseTasks`, `getStorageTypes`, `getStorageBins`, etc.). Clean filter operator fallbacks avoiding `sap` global for `ui5lint` compliance.
      - Controllers updated to pass models: `GoodsIssue.controller.js`, `GoodsReceipt.controller.js`, `WarehouseCockpit.controller.js`, `CreateWarehouseTask.controller.js`, `RfTerminal.controller.js`.
    - **MM / SD Services & Controllers**:
      - `PurchaseOrderService.js`: Added `setModel`/`getModel`, `_readEntitySet` for entity queries with dual-mode parameter handling.
      - `CreatePurchaseOrder.controller.js`: Updated lines 347 and 541 to pass `this.getModel("purchaseOrder")` to `PurchaseOrderService.getMaterialDetails`.
      - `SalesInquiryService.js`: Added `setModel`/`getModel`, `_readEntitySet` for entity queries with dual-mode parameter handling.
      - `SalesInquiries.controller.js`: Passed `this.getModel("salesInquiry")` to `SalesInquiryService.getSalesInquiry`.
      - `SalesInquiryDetail.controller.js`: Passed `this.getModel("salesInquiry")` to `SalesInquiryService.getSalesInquiry`.
      - `CreateSalesInquiry.controller.js`: Passed `this.getModel("salesInquiry")` to `SalesInquiryService.loadConfiguration` and `getMaterialDetails`.
  - **Part D — Test Suite Updates & Coverage**:
    - `test/unit/wm/goodsIssueController.test.js`: Added `mockGoodsIssueModel` to mock base controller; verified all 45 tests pass.
    - `test/unit/wm/goodsReceiptController.test.js`: Added `mockGoodsReceiptModel` to mock base controller; verified all 17 tests pass.
    - `test/unit/ewm/warehouseCockpitController.test.js`: Added `warehouseMgmt` mock model; verified all 10 tests pass.
    - `test/unit/ewm/createWarehouseTask.test.js`: Added `warehouseMgmt` mock model; verified all 19 tests pass.
    - `test/unit/ewm/rfTerminalController.test.js`: Added `warehouseMgmt` mock model; verified all 18 tests pass.
    - `test/unit/ewm/ewmService.test.js`: Added V4 Model Integration test suite verifying `setModel`, `getModel`, `bindList` invocation, filter propagation, and ODataClient fallback.
    - `test/unit/wm/goodsIssueService.test.js`: Added Frontend GoodsIssueService V4 Model Operations test suite verifying `bindList` invocation on `/OpenReservations`, `/GIItems`, `/MaterialBatches`, and fallback.
    - `test/unit/wm/goodsReceiptService.test.js`: Added Frontend GoodsReceiptService V4 Model Operations test suite verifying `bindList` invocation on `/OpenInboundDeliveries`, `/MaterialStorageLocations`, `/MaterialBatches`, and fallback.
  - **Validation**:
    - `npm test`: **72 passed, 72 total test suites; 956 passed, 956 total tests (100% green)** in 50.4 s.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `cd app/fiori-app && npm run build`: Build succeeded in 721 ms; `dist/Component-preload.js` generated (540 KB).
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit unified frontend changes to `feature/CL01`.

## 2026-09-16 12:45 IST
- **Agent**: Antigravity
- **Change**: Full Frontend Internationalization (i18n) Completion & Bundle Synchronization
  - **Bundle Parity**: Synchronized `app/fiori-app/webapp/i18n/i18n.properties` and `app/fiori-app/webapp/i18n/i18n_en.properties` from a 427-key deficit (639 vs 212) to **800 keys each with 100% exact key-for-key parity** (`diff -u` outputs 0 differences).
  - **Hard-coded Labels Elimination**: Externalized all hard-coded labels, titles, table headers, placeholders, tooltips, and status texts into semantic i18n properties across 14 XML views and fragments:
    - `CreatePurchaseOrder.view.xml` (45 strings): Panel headers, organizational & commercial inputs, item table column titles, add/create/cancel buttons, and placeholders.
    - `CreateSalesInquiry.view.xml` (60 strings): Panel headers, organizational data, customer & commercial terms, validity date labels, line items table headers, suggestion columns, footer action buttons, and placeholders.
    - `CreateQuoteFromInquiryDialog.fragment.xml` (26 strings): Dialog title, source inquiry panel headers, reference document labels, quotation parameters, referenced items table columns, create/cancel buttons, and placeholders.
    - `SalesInquiries.view.xml` (24 strings): Header toolbar, subtitle, KPI tile headers/subheaders, table columns, search placeholder, empty state text, create quote button and tooltip.
    - `RfTerminal.view.xml` (12 strings): Operator/resource/queue labels, empty queue message strip, cockpit navigation button, barcode scan simulation buttons/tooltips, and return button.
    - `CreateWarehouseTask.view.xml` (5 strings): Back button tooltip, draft status, issue count link, task status label, and unassigned status.
    - `WarehouseCockpit.view.xml` (2 strings): Supplier and ship-to party ID prefixes.
    - `GoodsIssue.view.xml` (8 strings): Plant/location label, difference reasons 01-04, storage type 999 description, location & bin label, queue record details title.
    - `BatchSelectionDialog.fragment.xml` (2 strings): Action column header and select button.
    - `GoodsReceipt.view.xml` (3 strings): Audio toggle tooltip, reset workflow tooltip, camera scan tooltip.
    - `QueueTrayDialog.fragment.xml` (2 strings): Reservation and order prefixes.
    - `ShortPickDialog.fragment.xml` (1 string): Storage bin / plant label.
    - `Login.view.xml` (1 string): Enterprise portal title.
    - `Dashboard.view.xml` (1 string): Welcome greeting prefix.
  - **Audit Results**:
    - Default bundle key count: 800
    - English bundle key count: 800
    - Missing in English bundle: 0
    - Remaining unbound user-facing strings in XML views: 0
  - **Validation**:
    - `npm test`: **72 passed, 72 total test suites; 956 passed, 956 total tests (100% green)** in 45.0 s.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `cd app/fiori-app && npm run build`: Build succeeded in 661 ms; `Component-preload.js` generated without errors.
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors, no trailing whitespace, proper Unicode escapes).
    - `diff -u i18n.properties i18n_en.properties`: Clean (0 differences).
  - **Next recommended action**: Stage and commit internationalization changes to `feature/CL01`.

## 2026-09-16 13:00 IST
- **Agent**: Antigravity
- **Change**: Added GitHub Actions CI Pipeline, Root ESLint Configuration, Node 22 Engines Declaration, and MTA Validation Setup
  - **Pipeline (`.github/workflows/ci.yml`)**:
    - Created GitHub Actions CI workflow triggering on `push` (`main`, `feature/**`), `pull_request` (`main`), and manual `workflow_dispatch`.
    - Configured `actions/setup-node@v4` with Node 22 and dual lockfile caching (`package-lock.json` and `app/fiori-app/package-lock.json`).
    - Configured complete pipeline execution steps:
      1. Repository checkout (`actions/checkout@v4`).
      2. Node.js 22 setup with npm cache.
      3. Root dependency installation (`npm ci`).
      4. UI5 dependency installation (`cd app/fiori-app && npm ci`).
      5. Root backend ESLint verification (`npm run lint`).
      6. UI5 linter check (`cd app/fiori-app && npm run lint`).
      7. Automated Jest test suites (`npm test`).
      8. UI5 application build with Component-preload (`cd app/fiori-app && npm run build`).
      9. MTA descriptor validation (`npm run validate:mta`).
  - **Root Package Configuration (`package.json`)**:
    - Added `"engines": { "node": ">=22.0.0" }`.
    - Added `"lint": "eslint ."` under `scripts`.
    - Added `eslint`, `globals`, and `mbt` to `devDependencies`.
  - **Root ESLint Configuration (`eslint.config.js`)**:
    - Modern flat configuration for Node.js 22 backend (`srv/`, `config/`, `server.js`) and Jest test suites (`test/`).
    - Configured `@eslint/js` recommended rules, CommonJS module parsing, Node globals (`globals.node`), CAP CQL query globals (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `cds`), and Jest globals (`globals.jest`, `fail`).
    - Excluded UI5 frontend (`app/**`), build artifacts (`dist/**`, `gen/**`, `mta_archives/**`), and logs (`logs/**`, `coverage/**`).
  - **Test File Hygiene**:
    - `test/unit/ewm/warehouseCockpitController.test.js`: Declared `let WarehouseCockpitController;` to prevent implicit global leakage under ESLint `no-undef`.
  - **Validation**:
    - `npm run lint`: **0 errors**, 24 warnings.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `npm test`: **72 passed, 72 total test suites; 956 passed, 956 total tests (100% green)** in 54.7 s.
    - `cd app/fiori-app && npm run build`: Build succeeded in 949 ms; `Component-preload.js` generated cleanly.
    - `npm run validate:mta`: Succeeded with `[INFO] validating the MTA project` (exit code 0).
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit CI pipeline, ESLint configuration, and Node 22 engines declaration to `feature/CL01`.

## 2026-09-16 13:15 IST
- **Agent**: Antigravity
- **Change**: Comprehensive README.md Documentation Realignment and Drift Resolution
  - **Scope Expansion**: Replaced procurement-only narrative with the canonical **SAP S/4HANA Enterprise Full-Stack Platform**, detailing all 5 active business domains: Materials Management (MM), Warehouse Management (WM), Extended Warehouse Management (EWM), Sales & Distribution (SD), and Financial Accounting (FI).
  - **Test Metrics Realignment**: Corrected badges and testing section from obsolete "18 Suites, 116 Tests" to **72 Suites, 956 Tests (100% Green)**.
  - **Authoritative 8-Role RBAC Matrix**: Documented all 8 application roles from `xs-security.json` (`Viewer`, `Admin`, `PurchasingManager`, `FinanceViewer`, `SalesRepresentative`, `SalesManager`, `WarehouseClerk`, `WarehouseManager`), defining scopes, role collections, domain access permissions, and resolving the prior 2-role truncation.
  - **Architecture & Technical Stack Refresh**:
    - Updated architecture Mermaid diagram depicting presentation routing across MM, WM, EWM, SD, and FI, CAP OData V4 services, S/4 integration adapters, HDI dispatch queue persistence (`saps4hana-db`), and Gateway services.
    - Updated tech stack versions: SAPUI5 pinned to `1.136.0`, Node.js to `>=22.0.0` (v22 LTS), ESLint flat config, and `@ui5/linter`.
    - Added dedicated Continuous Integration (CI/CD) section detailing `.github/workflows/ci.yml`.
    - Updated Local Development launchpad navigation paths for all 7 application views (`#/dashboard`, `#/purchase-orders`, `#/goods-issue`, `#/goods-receipt`, `#/warehouse-cockpit`, `#/rf-terminal`, `#/sales-inquiries`, `#/journal-entries`) and OData V4 metadata endpoints.
    - Updated Project Structure tree to reflect modules under `app/fiori-app/webapp/modules/`, services under `srv/`, and root configurations.
  - **Validation**:
    - `npm run lint`: **0 errors**, 24 warnings.
    - `cd app/fiori-app && npm run lint`: Success! No findings detected (0 errors, 0 warnings).
    - `npm test`: **72 passed, 72 total test suites; 956 passed, 956 total tests (100% green)** in 43.2 s.
    - `cd app/fiori-app && npm run build`: Build succeeded in 664 ms; `Component-preload.js` generated cleanly.
    - `npm run validate:mta`: Succeeded with `[INFO] validating the MTA project` (exit code 0).
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit updated documentation to `feature/CL01`.