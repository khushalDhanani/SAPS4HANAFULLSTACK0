# Repository Codebase Analysis & File Size Audit Report

**Repository:** `SAPS4HANAFULLSTACK0`  
**Active Branch:** `feature01`  
**Execution Timestamp:** 2026-11-20 15:45 IST  
**Corrected:** 2026-11-21 — figures re-validated against commit `1ef485dd`; see Sections 8.3 and 8.4 for what changed.\
**Compliance Standard:** Mandatory adherence to `AGENTS.md` & `WORKSTATUS.md`  
**Audit Scope:** Comprehensive line count audit (`wc -l`), architectural decomposition, tight-coupling analysis, and safest refactoring sequencing across all first-party application source code, integration adapters, backend handlers, utilities, and test suites.

---

## 1. Executive Summary

This report delivers an exhaustive, evidence-based architectural code audit of the `SAPS4HANAFULLSTACK0` repository on branch `feature01`. The primary objective is to identify, categorize, analyze, and provide modularization blueprints for every first-party source file exceeding **300 lines** (measured strictly via POSIX `wc -l`), without introducing breaking changes, regression risks, or violating SAP S/4HANA integration contracts.

### 1.1 Methodology & Strict Exclusion Protocol
To guarantee total precision, files were evaluated under strict discovery rules per `AGENTS.md` and the audit specification:
- **Included Scopes:** First-party source code across Frontend (`app/fiori-app/webapp/`, `app/router/`), Backend CAP services and database persistence (`srv/`, `db/`), S/4HANA Integration layer (`srv/integration/s4hana/`), Shared Utilities & Tooling (`srv/common/`, `tools/`), automated Test suites (`test/unit/`, `test/integration/`, `test/e2e/`, `test/performance/`, `test/a11y/`, `test/support/`), and root runtime/build descriptors (`server.js`, `mta.yaml`, `xs-security.json`).
- **Excluded Categories:**
  1. `node_modules/` (Third-party npm packages).
  2. Build & Packaging Outputs: `gen/` (CAP compiled staging), `mta_archives/` (deployable MTAR), `app/fiori-app/dist/` (UI5 build output), `coverage/`, `test-results/`, and `.system_generated/`.
  3. Machine-Generated Code: `srv/external/` (`.csn`, `.cds`, `.edmx`, `.xml` generated via `cds import`), `Component-preload.js`, and local databases/logs (`db.sqlite`, `*.log`, `*.db-shm`, `*.db-wal`).
  4. Minified Files: `*.min.js`, `*.min.css` (e.g. `jspdf.umd.min.js`).
  5. Third-Party Vendored Libraries: `app/fiori-app/webapp/thirdparty/*` (jsPDF) and `app/fiori-app/webapp/modules/wm/handling-unit/util/QrCode.js` (Kazuhiko Arase QR Code library).
  6. Archived Files: `docs/archive/` (historical change logs rotated from `WORKSTATUS.md`) and `tools/archive/` (archived syslog and SAP investigation scripts).
  7. Lock & Descriptor Lock Files: All `package-lock.json` files.
  8. Static Documentation & Raw Evidence: `docs/` (`docs/evidence/` JSON snapshots, `docs/sap-metadata-reference/`, `docs/abap/`, `docs/api/`, architectural Markdown documents), root Markdown files (`WORKSTATUS.md`, `AGENTS.md`, `README.md`, `SAP_SYSLOG_DISCOVERY.md`), example configs (`.env.example`), and binary assets (`.png`, `.pdf`, `.xlsx`, `.svg`).

### 1.2 Summary of Scan Results
- **Total Tracked Files in Git:** 1,067 files (`git ls-files | wc -l`, 2026-11-21).
- **Total Non-Excluded Repository Artifacts (including docs/evidence):** 834 files.
- **Total First-Party Source Files Scanned:** **722 files** (715 at the original scan plus the 7 sub-modules added on 2026-11-21; increased from initial 558).
- **Total First-Party Source Files Exceeding 300 Lines:** **94 files** (down from 137 files).
- **Application & Integration Source Files Exceeding 300 Lines:** **34 files** (20 Frontend, 7 Integrations, 3 Backend, 3 Utilities, 1 Schema Config).
- **Automated Test Suites Exceeding 300 Lines:** **60 files** (53 Unit test suites, 3 Integration test suites, 4 Browser E2E/support suites).

### 1.3 Modularization Accomplishments (Phases 1 to 5 & Phase 2 — 100% PASS)
Through the systematic execution of Phases 1 through 5, **41 major monolithic modules were completely knocked below the 300-line threshold**, while retaining 100% backward compatibility and test coverage:
1. **`PurchaseOrders.controller.js`:** Slashed from **1,836 lines down to 293 lines** (-1,543 lines, **-84.0%**). Extracted 7 dedicated submodules (`PurchaseOrderAiChat.js` [212], `PurchaseOrderAiDataFetcher.js` [240], `PurchaseOrderAiIntent.js` [265], `PurchaseOrderAiPrompt.js` [290], `PurchaseOrderAiStream.js` [196], `PurchaseOrderAiWidget.js` [197], `PurchaseOrderTableFilter.js` [262]). All 28 test suites (545 tests) PASS.
2. **`Dashboard.controller.js`:** Slashed from **1,475 lines down to 275 lines** (-1,200 lines, **-81.4%**). Extracted 8 dedicated submodules (`AdminLockMonitorSection.js` [115], `AdminLogsSection.js` [102], `AdminUserBulkSection.js` [258], `AdminUserDetailSection.js` [223], `AdminUserFilterSection.js` [129], `AdminUserFormatters.js` [138], `AdminUserListSection.js` [234], `DashboardMetricsSection.js` [77]). All 109 tests PASS.
3. **`CreatePurchaseOrder.controller.js`:** Slashed from **1,223 lines down to 223 lines** (-1,000 lines, **-81.8%**). Extracted 5 dedicated submodules (`CreatePurchaseOrderContextFilter.js` [237], `CreatePurchaseOrderHeaderSync.js` [284], `CreatePurchaseOrderItemManager.js` [153], `CreatePurchaseOrderMessages.js` [223], `CreatePurchaseOrderValueHelp.js` [128]). All 28 test suites (545 tests) PASS.
4. **`CreateSalesOrder.controller.js`:** Slashed from **979 lines down to 280 lines** (-699 lines, **-71.4%**). Extracted 5 dedicated submodules (`CreateSalesOrderHeaderSync.js` [169], `CreateSalesOrderItemManager.js` [278], `CreateSalesOrderMessages.js` [78], `CreateSalesOrderPartnerManager.js` [180], `CreateSalesOrderValueHelp.js` [194]). All 7 sales-order suites (123 tests) PASS.
5. **`CreateSalesInquiry.controller.js`:** Slashed from **911 lines down to 271 lines** (-640 lines, **-70.3%**). Extracted 5 dedicated submodules (`CreateSalesInquiryHeaderSync.js` [163], `CreateSalesInquiryCustomerManager.js` [127], `CreateSalesInquiryItemManager.js` [252], `CreateSalesInquiryMessages.js` [114], `CreateSalesInquiryValueHelp.js` [180]). All 15 sales-inquiry suites (198 tests) PASS.
6. **`OrdersDueForDelivery.controller.js`:** Slashed from **760 lines down to 178 lines** (-582 lines, **-76.6%**). Extracted 4 dedicated submodules (`OrdersDueTableManager.js` [253], `OrdersDueDeliveryCreator.js` [201], `OrdersDueDeliveryNoRef.js` [176], `OrdersDueDeliveryFollowUp.js` [133]). All 6 Outbound Delivery suites (179 tests) PASS.
7. **`HandlingUnits.controller.js`:** Slashed from **643 lines down to 268 lines** (-375 lines, **-58.3%**). Extracted 4 dedicated submodules (`HandlingUnitLabelActions.js` [229], `HandlingUnitQrManager.js` [165], `HandlingUnitLabelReader.js` [116], `HandlingUnitCreateManager.js` [84]). All 30 WM test suites (652 tests) PASS.
8. **`CreateCustomerReturn.controller.js`:** Slashed from **668 lines down to 219 lines** (-449 lines, **-67.2%**). Extracted 4 dedicated submodules (`CreateCustomerReturnValueHelp.js` [200], `CreateCustomerReturnReferenceDoc.js` [162], `CreateCustomerReturnItemManager.js` [125], `CreateCustomerReturnSubmitter.js` [121]). All 11 Customer Return suites (214 tests) PASS.
9. **`GoodsReceipt.controller.js`:** Slashed from **613 lines down to 275 lines** (-338 lines, **-55.1%**). Extracted 3 dedicated submodules (`GoodsReceiptPostingCoordinator.js` [135], `GoodsReceiptReferenceSearch.js` [259], `GoodsReceiptItemManager.js` [73]). All 30 WM test suites (652 tests; 26/26 in `goodsReceiptController.test.js`) PASS.
10. **`MibLabel.controller.js`:** Slashed from **588 lines down to 171 lines** (-417 lines, **-70.9%**). Extracted 3 dedicated submodules (`MibLabelPreviewManager.js` [265], `MibLabelActionCoordinator.js` [182], `MibLabelTableManager.js` [111]). All 30 WM test suites (652 tests; 18/18 in `mibLabelController.test.js`) PASS.
11. **`QuarantineLabels.controller.js`:** Slashed from **540 lines down to 143 lines** (-397 lines, **-73.5%**). Extracted 3 dedicated submodules (`QuarantineLabelActionCoordinator.js` [193], `QuarantineLabelPreviewManager.js` [229], `QuarantineLabelTableManager.js` [126]). All 30 WM test suites (652 tests; 38/38 in `quarantineLabelsController.test.js`) and UI5 linter PASS.
12. **`CustomerInvoices.controller.js`:** Slashed from **540 lines down to 131 lines** (-409 lines, **-75.7%**). Extracted 3 dedicated submodules (`CustomerInvoiceActionCoordinator.js` [253], `CustomerInvoiceFilterManager.js` [205], `CustomerInvoiceFormatters.js` [71]). All 11 SD test suites (214 tests; 23/23 in `customerInvoicesController.test.js`) and UI5 linter PASS.
13. **`SalesOrders.controller.js`:** Slashed from **407 lines down to 157 lines** (-250 lines, **-61.4%**). Extracted 3 dedicated submodules (`SalesOrderDeliveryActions.js` [164], `SalesOrderTableManager.js` [109], `SalesOrderFormatters.js` [93]). All 7 sales-order test suites (123 tests; 20/20 in `salesOrdersController.test.js`) and UI5 linter PASS.
14. **`CustomerReturns.controller.js`:** Slashed from **378 lines down to 146 lines** (-232 lines, **-61.4%**). Extracted 3 dedicated submodules (`CustomerReturnFormatters.js` [89], `CustomerReturnItemsDialog.js` [81], `CustomerReturnTableManager.js` [137]). All 11 Customer Return test suites (214 tests; 20/20 in `customerReturnsController.test.js`) and UI5 linter PASS.
15. **`App.controller.js`:** Slashed from **366 lines down to 87 lines** (-279 lines, **-76.2%**). Extracted 2 dedicated submodules (`AppShellRouteTitleManager.js` [229], `AppShellNavigationManager.js` [101]). All 12 shell controller tests in `AppController.test.js` and UI5 linter PASS.
16. **`MibLabelPdf.js`:** Slashed from **811 lines down to 264 lines** (-547 lines, **-67.4%**). Extracted 4 dedicated submodules (`MibBarcodeLayout.js` [94], `MibLabelRows.js` [132], `MibStandardSticker.js` [187], `MibLabelLayout.js` [250]). All 25 WM tests PASS.
17. **`ValueHelpService.js`:** Slashed from **669 lines down to 285 lines** (-384 lines, **-57.4%**). Extracted 2 dedicated dialog submodules (`InquiryTypeValueHelpDialog.js` [277], `MaterialValueHelpDialog.js` [131]). All 36 frontend test suites PASS.
18. **`filterUtils.js`:** Slashed from **349 lines down to 214 lines** (-135 lines, **-38.7%**). Extracted `cqnFilterEvaluator.js` [167]. All common tests PASS.
19. **`SalesOrderModel.js`:** Slashed from **668 lines down to 137 lines** (-531 lines, **-79.5%**). Extracted 2 dedicated submodules (`SalesOrderValidator.js` [268], `SalesOrderPayloadBuilder.js` [240]). All 7 sales-order test suites (123 tests) and all 33 SD suites (535 tests) PASS, UI5 linter 0 findings.
20. **`SalesInquiryModel.js`:** Slashed from **669 lines down to 122 lines** (-547 lines, **-81.8%**). Extracted 2 dedicated submodules (`SalesInquiryValidator.js` [257], `SalesInquiryPayloadBuilder.js` [297]). All 15 sales-inquiry suites (198 tests) and all 33 SD suites (535 tests) PASS, UI5 linter 0 findings.
21. **`PurchaseOrderModel.js`:** Slashed from **634 lines down to 233 lines** (-401 lines, **-63.2%**). Extracted 2 dedicated submodules (`PurchaseOrderInitialState.js` [161], `PurchaseOrderOperations.js` [148]). All 28 purchase-order test suites (545 tests) PASS, UI5 linter 0 findings.
22. **`PurchaseOrderDefaults.js`:** Slashed from **620 lines down to 199 lines** (-421 lines, **-67.9%**). Extracted 3 dedicated submodules (`PurchaseOrderSupplierDefaults.js` [164], `PurchaseOrderConfigDefaults.js` [169], `PurchaseOrderDocTypeDefaults.js` [275]). All 28 purchase-order test suites (545 tests) PASS, UI5 linter 0 findings.
23. **`HandlingUnitAdapter.js`:** Slashed from **765 lines down to 99 lines** (-666 lines, **-87.1%**). Extracted 5 dedicated submodules and 1 shared utility (`HandlingUnitBapiWriter.js` [145], `HandlingUnitDetailReader.js` [139], `HandlingUnitHierarchyKpiReader.js` [127], `HandlingUnitListReader.js` [174], `HandlingUnitSerialReader.js` [118], `handlingUnitUtils.js` [71]). All 30 WM test suites (652 tests; 53/53 in `handlingUnitAdapter.test.js`) PASS, ESLint 0 errors, UI5 linter 0 findings.
24. **`OutboundDeliveryAdapter.js`:** Slashed from **762 lines down to 106 lines** (-656 lines, **-86.1%**). Extracted 4 dedicated submodules and 1 date utility (`OutboundDeliveryShippingPoints.js` [223], `OutboundDeliveryOrdersDue.js` [258], `OutboundDeliveryCreator.js` [128], `OutboundDeliveryBilling.js` [168], `outboundDeliveryDateUtils.js` [41]). All 6 Outbound Delivery test suites (179 tests; 55/55 in `outboundDeliveryAdapter.test.js`) PASS, ESLint 0 errors, UI5 linter 0 findings.
25. **`CustomerReturnAdapter.js`:** Slashed from **683 lines down to 72 lines** (-611 lines, **-89.5%**). Extracted 3 dedicated submodules and 1 shared utility (`CustomerReturnReader.js` [116], `CustomerReturnValueHelp.js` [218], `CustomerReturnWriter.js` [269], `customerReturnUtils.js` [175]). All 6 Customer Return test suites (136 tests; 40/40 in `customerReturnAdapter.test.js`) PASS, ESLint 0 errors, UI5 linter 0 findings.
26. **`GoodsReceiptAdapter.js`:** Slashed from **573 lines down to 159 lines** (-414 lines, **-72.3%**). Extracted 2 dedicated submodules (`GoodsReceiptItemReader.js` [224], `GoodsReceiptMasterDataReader.js` [166]). All 5 Goods Receipt test suites (141 tests) and all 30 WM test suites (652 tests) PASS, ESLint 0 errors, UI5 linter 0 findings.
27. **`salesInquiryDocumentCreator.js`:** Slashed from **632 lines down to 68 lines** (-564 lines, **-89.2%**). Extracted 2 dedicated submodules (`SalesOrderDocumentCreator.js` [298], `SalesInquirySequentialCreator.js` [277]). All 22 sales-inquiry and sales-order test suites (321 tests) PASS, ESLint 0 errors, UI5 linter 0 findings.
28. **`GoodsReceiptPostingHelper.js`:** Slashed from **547 lines down to 11 lines** (-536 lines, **-98.0%**). Extracted 4 dedicated submodules (`GoodsReceiptBapiErrorClassifier.js` [44], `GoodsReceiptDocFinder.js` [32], `GoodsReceiptODataPoster.js` [202], `GoodsReceiptBapiPoster.js` [293]). All 30 WM test suites (652 tests; 147/147 in Goods Receipt suites) PASS, ESLint 0 errors, UI5 linter 0 findings.
29. **`AuthService.js`:** Slashed from **549 lines down to 291 lines** (-258 lines, **-47.0%**). Extracted 2 dedicated submodules (`AuthUserHelper.js` [96], `AuthModelSync.js` [35]). All 8 auth test suites (121 tests) and all 7 controller suites (78 tests) PASS, UI5 linter 0 findings.
30. **`AuthStorage.js`:** Slashed from **322 lines down to 222 lines** (-100 lines, **-31.1%**). Preserved all 10 storage methods and security invariants (volatile sessionStorage vs persistent localStorage, token expiry checks, legacy disk sanitization). All 8 auth test suites (121 tests) PASS, UI5 linter 0 findings.
31. **`SystemLogAdapter.js`:** Slashed from **532 lines down to 212 lines** (-320 lines, **-60.2%**). Extracted 3 dedicated submodules (`SystemLogSanitizer.js` [179], `SystemLogTemplateParser.js` [116], `SystemLogTimeUtil.js` [81]). All 82 admin log unit tests PASS, ESLint 0 errors, UI5 linter 0 findings.
32. **`UserManagementAdapter.js`:** Slashed from **530 lines down to 273 lines** (-257 lines, **-48.5%**; previously 797 lines, total **-65.7%**). Extracted 4 dedicated submodules (`UserDetailReader.js` [105], `UserListEnricher.js` [114], `UserLockCoordinator.js` [56], `UserTableReader.js` [109]). All 64 UserManagementAdapter unit tests PASS, ESLint 0 errors, UI5 linter 0 findings.
33. **`lockNotifier.js`:** Slashed from **509 lines down to 263 lines** (-246 lines, **-48.3%**; previously 650 lines, total **-59.5%**). Extracted 4 dedicated submodules (`LockAppContext.js` [119], `LockNotificationSender.js` [122], `LockNotifierConfig.js` [52], `LockNotifierStatus.js` [91]). All 65 lockNotifier unit tests and 46 queue integration tests PASS, ESLint 0 errors, UI5 linter 0 findings.
34. **`GoodsReceiptStorageUnitResolver.js`:** Slashed from **495 lines down to 47 lines** (-448 lines, **-90.5%**). Extracted 4 dedicated submodules (`GoodsReceiptBarcodeMatcher.js` [62], `GoodsReceiptDocumentMatcher.js` [187], `GoodsReceiptItemEnricher.js` [191], `GoodsReceiptObjectMatcher.js` [209]). All 30 WM test suites (652 tests) PASS, ESLint 0 errors.
35. **`BusinessConfigResolver.js`:** Slashed from **449 lines down to 268 lines** (-181 lines, **-40.3%**). Extracted 2 dedicated submodules (`BusinessConfigCustomizer.js` [144], `BusinessConfigOverrides.js` [77]). All 10 common test suites (132 tests) PASS, ESLint 0 errors.
36. **`service.js` (`UserManagementService`):** Slashed from **448 lines down to 113 lines** (-335 lines, **-74.8%**). Extracted 3 dedicated submodules (`AdminPasswordExpiryHandler.js` [145], `AdminUserLockHandler.js` [177], `AdminUserQueryHandler.js` [123]). All 25 UserManagementService tests PASS, ESLint 0 errors.
37. **`S4HttpClient.js`:** Slashed from **441 lines down to 225 lines** (-216 lines, **-49.0%**). Extracted 3 dedicated submodules (`S4DestinationResolver.js` [84], `S4HttpErrors.js` [106], `S4HttpUtils.js` [101]). All 38 S4HttpClient tests and WM/integration tests PASS, ESLint 0 errors.
38. **`integrationDiagnostics.js`:** Slashed from **436 lines down to 116 lines** (-320 lines, **-73.4%**). Extracted 3 dedicated submodules (`integrationDiagnosticsUtil.js` [58], `ODataDiagnostics.js` [165], `RfcDiagnostics.js` [141]). All 11 diagnostic tests and UserManagementService tests PASS, ESLint 0 errors.
39. **`MibLabelAdapter.js`:** Slashed from **420 lines down to 118 lines** (-302 lines, **-71.9%**). Extracted 2 dedicated submodules (`MibLabelDataReader.js` [247], `MibLabelUtils.js` [111]). All 23 MibLabelAdapter tests PASS, ESLint 0 errors.
40. **`QuarantineLabelAdapter.js`:** Slashed from **419 lines down to 130 lines** (-289 lines, **-69.0%**). Extracted 2 dedicated submodules (`QuarantineLabelDataReader.js` [215], `QuarantineLabelUtils.js` [123]). All 55 QuarantineLabelAdapter tests PASS, ESLint 0 errors.
41. **`GoodsReceiptAttemptStore.js`:** Slashed from **416 lines down to 254 lines** (-162 lines, **-38.9%**). Extracted 2 dedicated submodules (`GoodsReceiptAttemptConfig.js` [49], `GoodsReceiptRecheckService.js` [191]). All 42 Goods Receipt attempt tests PASS, ESLint 0 errors.
42. **`SalesInquiryAdapter.js`:** Reduced from **1,434 to 676 lines**, then on 2026-11-21 to **224 lines** by moving method groups verbatim into `salesInquiryConnection.js` [100], `salesInquiryCatalogReader.js` [258], and `salesInquiryMasterData.js` [121], mixed into the adapter prototype. Full Jest suite PASS.
43. **`PurchaseOrderValidator.js`:** Reduced from **1,140 to 930 lines**, then on 2026-11-21 to **285 lines** by extracting `PurchaseOrderValidationLimits.js` [30], `PurchaseOrderFieldValidator.js` [286], `PurchaseOrderFormValidator.js` [251], and `PurchaseOrderHeaderValidator.js` [257] behind the unchanged facade. All 28 purchase-order suites (545 tests) PASS.

---

## 2. Repository Inventory Breakdown

### 2.1 Distribution of >300 Line Files by Architectural Layer

| Architectural Layer | Files > 300 Lines | % of Oversized Files | Primary File Types & Responsibilities |
| :--- | :---: | :---: | :--- |
| **Tests** | **60** | 63.8% | Unit, integration, and Playwright E2E suites verifying MM, SD, WM, LE, Admin, and Auth. |
| **Frontend** (`app/fiori-app/`) | **20** | 21.3% | UI5 Controllers (0), Models/Services/Utilities `.js` (9), XML Views (7), i18n Resources (2), `manifest.json` (1), CSS (1). |
| **Integrations** (`srv/integration/s4hana/`) | **7** | 7.4% | S/4HANA OData and RFC adapters, `RfcClient`, `S4ErrorMapper`, `sm21-templates.json`. |
| **Backend** (`srv/admin/`, `srv/wm/`) | **3** | 3.2% | `goodsReceipt.handler.js`, `lockEventStore.js`, `lockEmail.js`. |
| **Utilities** (`tools/`) | **3** | 3.2% | `check-label-pdf.py`, `test-po-creation-all-types.js`, `sandbox-discovery.js`. |
| **Config / Root Schema** | **1** | 1.1% | Business configuration schema (`config/schema/purchaseOrderRules.json`). |
| **TOTAL** | **94** | **100.0%** | Matches the Section 4 inventory. |

### 2.2 Distribution of >300 Line Files by Extension

| File Extension | Count | Percentage | Description |
| :--- | :---: | :---: | :--- |
| `.js` | **80** | 85.1% | JavaScript source files (Models, Services, Adapters, Handlers, Jest & Playwright tests). |
| `.xml` | **7** | 7.4% | SAPUI5 XML Views (`Dashboard`, `PurchaseOrderDetail`, `PurchaseOrders`, `CreateSalesOrder`, etc.). |
| `.json` | **3** | 3.2% | Static templates & descriptors (`sm21-templates.json`, `purchaseOrderRules.json`, `manifest.json`). |
| `.properties` | **2** | 2.1% | Internationalization resource bundles (`i18n.properties`, `i18n_en.properties`). |
| `.css` | **1** | 1.1% | Application styling rules (`app/fiori-app/webapp/css/style.css`). |
| `.py` | **1** | 1.1% | Python label visual verification tool (`tools/check-label-pdf.py`). |
| **TOTAL** | **94** | **100.0%** | |

---

## 3. Top 20 Largest Files Inventory

The following table presents the 20 largest first-party source files across the entire repository, ordered strictly by line count (`wc -l`):

| Rank | Lines | File Path | Layer | Category | Core Responsibilities |
| :---: | :---: | :--- | :---: | :---: | :--- |
| **1** | **2,167** | `srv/integration/s4hana/admin/sm21-templates.json` | Integrations | Static Template | Dictionary of SAP SM21 System Log message templates and variable placeholders. |
| **2** | **1,457** | `app/fiori-app/webapp/i18n/i18n.properties` | Frontend | i18n Resource | Default internationalization translation strings across all business modules. |
| **3** | **1,449** | `app/fiori-app/webapp/i18n/i18n_en.properties` | Frontend | i18n Resource | English internationalization translation strings (mirrors `i18n.properties`). |
| **4** | **1,058** | `test/unit/sales-order/salesOrderAdapter.test.js` | Tests | Unit Test Suite | Comprehensive unit tests for `SalesOrderAdapter` covering OData reads, RFC fallback, errors. |
| **5** | **1,033** | `test/unit/purchase-order/headerValueHelpSelection.test.js` | Tests | Unit Test Suite | Unit tests for PO header value helps (Vendor, Purchasing Org, Plant, Company Code). |
| **6** | **1,005** | `test/e2e/shell/verifyShellScreens.e2e.js` | Tests | Browser E2E | Playwright browser test verifying shell navigation, title bars, and screen rendering. |
| **7** | **992** | `test/unit/le/ordersDueForDeliveryController.test.js` | Tests | Unit Test Suite | Unit tests for Outbound Delivery list controller, shipping point scoping, delivery creation. |
| **8** | **977** | `test/integration/lockNotification.test.js` | Tests | Integration Suite | CAP integration test verifying user lock notifications, SMTP dispatch, snapshot diffing. |
| **9** | **973** | `test/unit/admin/UserManagementAdapter.test.js` | Tests | Unit Test Suite | Unit tests for SU01 user management adapter, RFC table reads (`USR02`, `USH02`), locks. |
| **10** | **908** | `test/unit/admin/adminDashboardList.test.js` | Tests | Unit Test Suite | Unit tests for Admin dashboard tabs, SU01 user list, filter/search, role assignments. |
| **11** | **903** | `test/unit/purchase-order/purchaseOrdersAskAI.test.js` | Tests | Unit Test Suite | Unit tests for PO Ask AI drawer, SSE streaming handler, suggestion chips, error states. |
| **12** | **876** | `test/unit/le/outboundDeliveryAdapter.test.js` | Tests | Unit Test Suite | Unit tests for `OutboundDeliveryAdapter`, OData V2 date conversions, plant scope filters. |
| **13** | **866** | `tools/check-label-pdf.py` | Utilities | CLI Tool | PyMuPDF-based CLI tool verifying 4x6 label PDF layout, Aether SVG logo, Code 128 barcodes. |
| **14** | **815** | `test/unit/sales-inquiry/createSalesInquiryController.test.js` | Tests | Unit Test Suite | Unit tests for Create Sales Inquiry controller, customer defaults, pricing simulation. |
| **15** | **790** | `app/fiori-app/webapp/css/style.css` | Frontend | Stylesheet | Application styling rules, Fiori theme customizations, responsive grid layouts. |
| **16** | **741** | `app/fiori-app/webapp/view/Dashboard.view.xml` | Frontend | XML View | Dashboard view layout, tiles, tab containers, responsive layouts. |
| **17** | **724** | `test/unit/dashboard/dashboardMetrics.test.js` | Tests | Unit Test Suite | Unit tests for dashboard metrics loader, live SAP figures, and tile state formatters. |
| **18** | **712** | `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js` | Frontend | PO Rules | Authoritative schema rules for 16 PO types (machine-generated from JSON schema). |
| **19** | **695** | `test/unit/wm/goodsReceiptService.test.js` | Tests | Unit Test Suite | Unit tests for the Goods Receipt CAP service. |
| **20** | **679** | `test/unit/purchase-order/purchaseOrdersFilterSort.test.js` | Tests | Unit Test Suite | Unit tests for the Purchase Orders list filter and sort logic. |

*(Note: Prior top-tier monoliths `PurchaseOrders.controller.js` [now 293 lines], `Dashboard.controller.js` [now 275 lines], `CreatePurchaseOrder.controller.js` [now 223 lines], `CreateSalesOrder.controller.js` [now 280 lines], `CreateSalesInquiry.controller.js` [now 271 lines], `OrdersDueForDelivery.controller.js` [now 178 lines], `OutboundDeliveryAdapter.js` [now 106 lines], `CustomerReturnAdapter.js` [now 72 lines], `HandlingUnitAdapter.js` [now 99 lines], `GoodsReceiptAdapter.js` [now 159 lines], `salesInquiryDocumentCreator.js` [now 68 lines], `GoodsReceiptPostingHelper.js` [now 11 lines], `AuthService.js` [now 291 lines], `AuthStorage.js` [now 222 lines], `SystemLogAdapter.js` [now 212 lines], `UserManagementAdapter.js` [now 273 lines], `lockNotifier.js` [now 263 lines], `GoodsReceiptStorageUnitResolver.js` [now 47 lines], `BusinessConfigResolver.js` [now 268 lines], `service.js` (UserManagementService) [now 113 lines], `S4HttpClient.js` [now 225 lines], `integrationDiagnostics.js` [now 116 lines], `MibLabelAdapter.js` [now 118 lines], `QuarantineLabelAdapter.js` [now 130 lines], `GoodsReceiptAttemptStore.js` [now 254 lines], and `SalesInquiryAdapter.js` [now 676 lines] have all been completely eliminated from the top tier).*

---

## 4. Complete Inventory of All 94 Files Exceeding 300 Lines

The table below lists every single first-party file exceeding 300 lines in descending order of exact `wc -l` line count:

| Rank | Lines | File Path | Architectural Layer |
| :---: | :---: | :--- | :---: |
| **1** | **2,167** | `srv/integration/s4hana/admin/sm21-templates.json` | Integrations |
| **2** | **1,457** | `app/fiori-app/webapp/i18n/i18n.properties` | Frontend |
| **3** | **1,449** | `app/fiori-app/webapp/i18n/i18n_en.properties` | Frontend |
| **4** | **1,058** | `test/unit/sales-order/salesOrderAdapter.test.js` | Tests |
| **5** | **1,033** | `test/unit/purchase-order/headerValueHelpSelection.test.js` | Tests |
| **6** | **1,005** | `test/e2e/shell/verifyShellScreens.e2e.js` | Tests |
| **7** | **992** | `test/unit/le/ordersDueForDeliveryController.test.js` | Tests |
| **8** | **977** | `test/integration/lockNotification.test.js` | Tests |
| **9** | **973** | `test/unit/admin/UserManagementAdapter.test.js` | Tests |
| **10** | **908** | `test/unit/admin/adminDashboardList.test.js` | Tests |
| **11** | **903** | `test/unit/purchase-order/purchaseOrdersAskAI.test.js` | Tests |
| **12** | **876** | `test/unit/le/outboundDeliveryAdapter.test.js` | Tests |
| **13** | **866** | `tools/check-label-pdf.py` | Utilities |
| **14** | **815** | `test/unit/sales-inquiry/createSalesInquiryController.test.js` | Tests |
| **15** | **790** | `app/fiori-app/webapp/css/style.css` | Frontend |
| **16** | **741** | `app/fiori-app/webapp/view/Dashboard.view.xml` | Frontend |
| **17** | **724** | `test/unit/dashboard/dashboardMetrics.test.js` | Tests |
| **18** | **712** | `app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js` | Frontend |
| **19** | **695** | `test/unit/wm/goodsReceiptService.test.js` | Tests |
| **20** | **679** | `test/unit/purchase-order/purchaseOrdersFilterSort.test.js` | Tests |
| **21** | **675** | `test/unit/wm/zquarLabel.test.js` | Tests |
| **22** | **652** | `tools/test-po-creation-all-types.js` | Utilities |
| **23** | **641** | `test/unit/wm/goodsReceiptController.test.js` | Tests |
| **24** | **635** | `test/unit/sd/customerReturnAdapter.test.js` | Tests |
| **25** | **556** | `test/unit/sd/createCustomerReturnController.test.js` | Tests |
| **26** | **551** | `test/unit/wm/handlingUnitAdapter.test.js` | Tests |
| **27** | **522** | `test/unit/sales-order/salesOrdersController.test.js` | Tests |
| **28** | **506** | `test/unit/admin/SystemLogAdapter.test.js` | Tests |
| **29** | **497** | `test/unit/purchase-order/poConfigDefaulting.test.js` | Tests |
| **30** | **490** | `test/unit/purchase-order/createPurchaseOrderStatus.test.js` | Tests |
| **31** | **485** | `test/unit/sd/customerInvoicesController.test.js` | Tests |
| **32** | **478** | `test/unit/sales-order/createSalesOrderController.test.js` | Tests |
| **33** | **476** | `test/unit/purchase-order/poTypeDynamicRules.test.js` | Tests |
| **34** | **470** | `test/unit/sd/customerReturnsController.test.js` | Tests |
| **35** | **465** | `test/unit/sales-inquiry/salesInquiryModel.test.js` | Tests |
| **36** | **459** | `test/unit/sales-inquiry/salesInquiryAdapter.test.js` | Tests |
| **37** | **444** | `app/fiori-app/webapp/modules/mm/purchase-order/view/PurchaseOrderDetail.view.xml` | Frontend |
| **38** | **437** | `test/unit/sales-order/salesOrderModel.test.js` | Tests |
| **39** | **436** | `app/fiori-app/webapp/modules/wm/quarantine-label/util/ZquarLabelLayout.js` | Frontend |
| **40** | **436** | `test/unit/sd/customerInvoiceAdapter.test.js` | Tests |
| **41** | **429** | `test/unit/wm/quarantineLabelAdapter.test.js` | Tests |
| **42** | **417** | `config/schema/purchaseOrderRules.json` | Config / Schema |
| **43** | **416** | `app/fiori-app/webapp/service/BarcodeScanService.js` | Frontend |
| **44** | **416** | `test/e2e/negative/verifyActionFailures.e2e.js` | Tests |
| **45** | **411** | `app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService.js` | Frontend |
| **46** | **411** | `test/unit/purchase-order/purchaseOrderDetail.test.js` | Tests |
| **47** | **410** | `app/fiori-app/webapp/manifest.json` | Frontend |
| **48** | **407** | `test/integration/userManagement.test.js` | Tests |
| **49** | **405** | `test/integration/lockNotificationQueue.test.js` | Tests |
| **50** | **399** | `test/unit/sales-inquiry/salesInquiryMapping.test.js` | Tests |
| **51** | **397** | `test/unit/auth/frontendAuthStorage.test.js` | Tests |
| **52** | **386** | `app/fiori-app/webapp/modules/sd/sales-order/service/SalesOrderService.js` | Frontend |
| **53** | **386** | `srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter.js` | Integrations |
| **54** | **384** | `test/unit/s4HttpClient.test.js` | Tests |
| **55** | **383** | `test/unit/le/outboundDeliveryHandler.test.js` | Tests |
| **56** | **382** | `srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter.js` | Integrations |
| **57** | **381** | `test/unit/admin/SapLogsService.test.js` | Tests |
| **58** | **380** | `test/unit/wm/mibLabelPdf.test.js` | Tests |
| **59** | **379** | `test/e2e/wm/verifyMibLabels.e2e.js` | Tests |
| **60** | **378** | `test/unit/wm/mibLabelAdapter.test.js` | Tests |
| **61** | **374** | `test/unit/le/deliveryNoRefAdapter.test.js` | Tests |
| **62** | **373** | `test/unit/wm/quarantineLabelsController.test.js` | Tests |
| **63** | **372** | `app/fiori-app/webapp/service/ODataClient.js` | Frontend |
| **64** | **372** | `srv/integration/s4hana/RfcClient.js` | Integrations |
| **65** | **370** | `app/fiori-app/webapp/modules/mm/purchase-order/view/PurchaseOrders.view.xml` | Frontend |
| **66** | **369** | `app/fiori-app/webapp/modules/sd/sales-inquiry/service/SalesInquiryService.js` | Frontend |
| **67** | **365** | `tools/sandbox-discovery.js` | Utilities |
| **68** | **363** | `srv/admin/lockEventStore.js` | Backend |
| **69** | **360** | `srv/integration/s4hana/le/delivery-no-ref/DeliveryNoRefAdapter.js` | Integrations |
| **70** | **360** | `test/unit/admin/UserManagementService.test.js` | Tests |
| **71** | **359** | `test/unit/common/BusinessConfigResolver.test.js` | Tests |
| **72** | **358** | `test/unit/admin/passwordExpiryStore.test.js` | Tests |
| **73** | **355** | `test/unit/wm/goodsReceiptAttempt.test.js` | Tests |
| **74** | **354** | `test/unit/wm/mibLabelController.test.js` | Tests |
| **75** | **353** | `test/unit/admin/lockNotifierRules.test.js` | Tests |
| **76** | **351** | `app/fiori-app/webapp/modules/sd/sales-inquiry/view/CreateSalesInquiry.view.xml` | Frontend |
| **77** | **351** | `srv/integration/s4hana/admin/SecurityAuditLogAdapter.js` | Integrations |
| **78** | **350** | `app/fiori-app/webapp/modules/sd/sales-order/view/CreateSalesOrder.view.xml` | Frontend |
| **79** | **347** | `app/fiori-app/webapp/modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml` | Frontend |
| **80** | **346** | `test/unit/wm/auditTraceability.test.js` | Tests |
| **81** | **335** | `app/fiori-app/webapp/modules/admin/sap-logs/util/SapLogsLogic.js` | Frontend |
| **82** | **331** | `test/unit/sales-order/salesOrderService.test.js` | Tests |
| **83** | **330** | `test/unit/sales-inquiry/salesInquiriesController.test.js` | Tests |
| **84** | **328** | `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js` | Backend |
| **85** | **327** | `app/fiori-app/webapp/modules/sd/customer-invoice/view/CustomerInvoices.view.xml` | Frontend |
| **86** | **325** | `app/fiori-app/webapp/modules/admin/user-management/util/UserListLogic.js` | Frontend |
| **87** | **325** | `test/e2e/support/screenCheck.js` | Tests |
| **88** | **322** | `test/unit/purchase-order/materialSelection.test.js` | Tests |
| **89** | **310** | `test/unit/admin/SecurityAuditLogAdapter.test.js` | Tests |
| **90** | **309** | `srv/admin/lockEmail.js` | Backend |
| **91** | **309** | `test/unit/auth/authService.test.js` | Tests |
| **92** | **308** | `test/unit/sd/customerInvoiceHandler.test.js` | Tests |
| **93** | **307** | `test/unit/purchase-order/purchaseOrderValidator.test.js` | Tests |
| **94** | **306** | `srv/integration/s4hana/S4ErrorMapper.js` | Integrations |

---

## 5. Architectural Analysis & Modularization Blueprints of Qualifying Modules

Below is the detailed architectural evaluation for each qualifying first-party file across Frontend, Integrations, Backend, Utilities, and Configuration.

### 5.1 Completed Modularizations (Phases 1 through 5 — 100% PASS)

1. **`PurchaseOrders.controller.js` (Completed):**
   - Slashed from 1,836 lines down to **293 lines** (-1,543 lines, **-84.0%**).
   - Modularized into `PurchaseOrderAiChat.js` (212), `PurchaseOrderAiDataFetcher.js` (240), `PurchaseOrderAiIntent.js` (265), `PurchaseOrderAiPrompt.js` (290), `PurchaseOrderAiStream.js` (196), `PurchaseOrderAiWidget.js` (197), and `PurchaseOrderTableFilter.js` (262).
   - Zero regression across 28 test suites (545 tests) and UI5 linter (0 findings).
2. **`Dashboard.controller.js` (Completed):**
   - Slashed from 1,475 lines down to **275 lines** (-1,200 lines, **-81.4%**).
   - Modularized into `AdminLockMonitorSection.js` (115), `AdminLogsSection.js` (102), `AdminUserBulkSection.js` (258), `AdminUserDetailSection.js` (223), `AdminUserFilterSection.js` (129), `AdminUserFormatters.js` (138), `AdminUserListSection.js` (234), and `DashboardMetricsSection.js` (77).
   - Preserved verbatim contractual regex `var METRIC_KEYS = [...]` and all 31 view press/select handlers.
   - Zero regression across 109 unit tests and UI5 linter (0 findings).
3. **`CreatePurchaseOrder.controller.js` (Completed):**
   - Slashed from 1,223 lines down to **223 lines** (-1,000 lines, **-81.8%**).
   - Modularized into `CreatePurchaseOrderContextFilter.js` (237), `CreatePurchaseOrderHeaderSync.js` (284), `CreatePurchaseOrderItemManager.js` (153), `CreatePurchaseOrderMessages.js` (223), and `CreatePurchaseOrderValueHelp.js` (128).
   - Preserved all value helps, defaulting cascades, and error focus targets.
   - Zero regression across 28 test suites (545 tests) and UI5 linter (0 findings).
4. **`CreateSalesOrder.controller.js` (Completed):**
   - Slashed from 979 lines down to **280 lines** (-699 lines, **-71.4%**).
   - Modularized into `CreateSalesOrderHeaderSync.js` (169), `CreateSalesOrderItemManager.js` (278), `CreateSalesOrderMessages.js` (78), `CreateSalesOrderPartnerManager.js` (180), and `CreateSalesOrderValueHelp.js` (194).
   - Preserved all partner defaulting, item calculation, value help routing, and submit guard logic.
   - Zero regression across 7 test suites (123 tests) and UI5 linter (0 findings).
5. **`CreateSalesInquiry.controller.js` (Completed):**
   - Slashed from 911 lines down to **271 lines** (-640 lines, **-70.3%**).
   - Modularized into `CreateSalesInquiryHeaderSync.js` (163), `CreateSalesInquiryCustomerManager.js` (127), `CreateSalesInquiryItemManager.js` (252), `CreateSalesInquiryMessages.js` (114), and `CreateSalesInquiryValueHelp.js` (180).
   - Preserved customer defaulting, item line calculations, MessagePopover, and submit flow.
   - Zero regression across 15 test suites (198 tests) and UI5 linter (0 findings).
6. **`OrdersDueForDelivery.controller.js` (Completed):**
   - Slashed from 760 lines down to **178 lines** (-582 lines, **-76.6%**).
   - Modularized into `OrdersDueTableManager.js` (253), `OrdersDueDeliveryCreator.js` (201), `OrdersDueDeliveryNoRef.js` (176), and `OrdersDueDeliveryFollowUp.js` (133).
   - Preserved all 17 event handlers, plant context defaulting, worklist filter scoping, delivery creation dialogs, and billing follow-up.
   - Zero regression across all 6 LE test suites (179 tests) and UI5 linter (0 findings).
7. **`HandlingUnits.controller.js` (Completed):**
   - Slashed from 643 lines down to **268 lines** (-375 lines, **-58.3%**).
   - Modularized into `HandlingUnitLabelActions.js` (229), `HandlingUnitQrManager.js` (165), `HandlingUnitLabelReader.js` (116), and `HandlingUnitCreateManager.js` (84).
   - Preserved all 21 event handlers, size dialog integration, QR SVG injection, parallel chunked label retrieval, and Excel export.
   - Zero regression across all 30 WM test suites (652 tests) and UI5 linter (0 findings).
8. **`CreateCustomerReturn.controller.js` (Completed):**
   - Slashed from 668 lines down to **219 lines** (-449 lines, **-67.2%**).
   - Modularized into `CreateCustomerReturnValueHelp.js` (200), `CreateCustomerReturnReferenceDoc.js` (162), `CreateCustomerReturnItemManager.js` (125), and `CreateCustomerReturnSubmitter.js` (121).
   - Preserved all value helps, reference billing/order doc lookups, line item calculations, and return submission.
   - Zero regression across 11 test suites (214 tests) and UI5 linter (0 findings).
9. **`GoodsReceipt.controller.js` (Completed):**
   - Slashed from 613 lines down to **275 lines** (-338 lines, **-55.1%**).
   - Modularized into `GoodsReceiptPostingCoordinator.js` (135), `GoodsReceiptReferenceSearch.js` (259), and `GoodsReceiptItemManager.js` (73).
   - Preserved all 10 event handlers, barcode scanning, value help, storage location/batch change with SLED expiry hard-stop, and 101 Goods Receipt posting with 409 stale data handling.
   - Zero regression across all 30 WM test suites (652 tests; 26/26 in `goodsReceiptController.test.js`) and UI5 linter (0 findings).
10. **`MibLabel.controller.js` (Completed):**
   - Slashed from 588 lines down to **171 lines** (-417 lines, **-70.9%**).
   - Modularized into `MibLabelPreviewManager.js` (265), `MibLabelActionCoordinator.js` (182), and `MibLabelTableManager.js` (111).
   - Preserved all 14 event handlers, warehouse and TO validation, RFC sticker generation with client fallback, transfer order worklist querying (up to 31 days), row-level preview and actions, and bulk PDF download/print (up to 20 documents).
   - Zero regression across all 30 WM test suites (652 tests; 18/18 in `mibLabelController.test.js`) and UI5 linter (0 findings).
11. **`MibLabelPdf.js` (Completed):**
   - Slashed from 811 lines down to **264 lines** (-547 lines, **-67.4%**).
   - Modularized into `MibBarcodeLayout.js` (94), `MibLabelRows.js` (132), `MibStandardSticker.js` (187), and `MibLabelLayout.js` (250).
   - 100% test pass on all 25 WM tests and layout suites.
12. **`ValueHelpService.js` (Completed):**
   - Slashed from 669 lines down to **285 lines** (-384 lines, **-57.4%**).
   - Modularized into `InquiryTypeValueHelpDialog.js` (277) and `MaterialValueHelpDialog.js` (131).
   - Preserved `oValueHelpConfig` contract dictionary verbatim.
13. **`filterUtils.js` (Completed):**
   - Slashed from 349 lines down to **214 lines** (-135 lines, **-38.7%**).
   - Modularized into `cqnFilterEvaluator.js` (167).

14. **`QuarantineLabels.controller.js` (Completed):**
   - Slashed from 540 lines down to **143 lines** (-397 lines, **-73.5%**).
   - Modularized into `QuarantineLabelActionCoordinator.js` (193), `QuarantineLabelPreviewManager.js` (229), and `QuarantineLabelTableManager.js` (126).
   - All 38 tests in `quarantineLabelsController.test.js` PASS.
15. **`CustomerInvoices.controller.js` (Completed):**
   - Slashed from 540 lines down to **131 lines** (-409 lines, **-75.7%**).
   - Modularized into `CustomerInvoiceActionCoordinator.js` (253), `CustomerInvoiceFilterManager.js` (205), and `CustomerInvoiceFormatters.js` (71).
   - All 23 tests in `customerInvoicesController.test.js` PASS.
16. **`SalesOrders.controller.js` (Completed):**
   - Slashed from 407 lines down to **157 lines** (-250 lines, **-61.4%**).
   - Modularized into `SalesOrderDeliveryActions.js` (164), `SalesOrderTableManager.js` (109), and `SalesOrderFormatters.js` (93).
   - All 20 tests in `salesOrdersController.test.js` PASS.
17. **`CustomerReturns.controller.js` (Completed):**
   - Slashed from 378 lines down to **146 lines** (-232 lines, **-61.4%**).
   - Modularized into `CustomerReturnFormatters.js` (89), `CustomerReturnItemsDialog.js` (81), and `CustomerReturnTableManager.js` (137).
   - All 20 tests in `customerReturnsController.test.js` PASS.
18. **`App.controller.js` (Completed):**
   - Slashed from 366 lines down to **87 lines** (-279 lines, **-76.2%**).
   - Modularized into `AppShellRouteTitleManager.js` (229) and `AppShellNavigationManager.js` (101).
   - All 12 tests in `AppController.test.js` PASS.
19. **`SalesOrderModel.js` (Completed):**
   - Slashed from 668 lines down to **137 lines** (-531 lines, **-79.5%**).
   - Modularized into `SalesOrderValidator.js` (268) and `SalesOrderPayloadBuilder.js` (240).
   - Preserved `getCurrentUserName`, `createInitialModel`, `createEmptyItem`, `calculateTotals`, `applyCustomerDefaults`, `applyMaterialDefaults`, `applyServerDefaults`, `validateForm`, `getIncompletionGaps`, `buildPayload`, `validateSingleField`, and `clearErrors`.
   - All 7 sales-order suites (123 tests) and all 33 SD suites (535 tests) PASS, UI5 linter 0 findings.
20. **`SalesInquiryModel.js` (Completed):**
   - Slashed from 669 lines down to **122 lines** (-547 lines, **-81.8%**).
   - Modularized into `SalesInquiryValidator.js` (257) and `SalesInquiryPayloadBuilder.js` (297).
   - Preserved `getCurrentUserName`, `createInitialModel`, `markUserModified`, `setFieldValidation`, `applyConfigurationDefaults`, `deriveCustomerDefaults`, `addItem`, `deleteItem`, `applyMaterialDefaults`, `calculateTotals`, `applyCapabilities`, `getIncompletionGaps`, `updateStatus`, `validateForm`, `validateSingleField`, `clearErrors`, and `buildPayload`.
   - All 15 sales-inquiry suites (198 tests) and all 33 SD suites (535 tests) PASS, UI5 linter 0 findings.
21. **`PurchaseOrderModel.js` (Completed):**
   - Slashed from 634 lines down to **233 lines** (-401 lines, **-63.2%**).
   - Modularized into `PurchaseOrderInitialState.js` (161) and `PurchaseOrderOperations.js` (148).
   - Preserved `getCurrentUserName`, `DEFAULT_DOC_TYPE`, `HEADER_FIELD_CONFIG`, `ITEM_FIELD_CONFIG`, `setTextResolver`, `getText`, `createInitialModel`, `addItem`, `deleteItem`, `calculateItemNetAmount`, `computeStatus`, `updateStatus`, `markUserModified`, and all delegated facades to `_validator` and `_defaults`.
   - All 28 purchase-order suites (545 tests) PASS, UI5 linter 0 findings.

### 5.2 Remaining Frontend UI5 Controllers (>300 lines)

**ZERO (0) UI5 controllers remain exceeding 300 lines.** Phase 5 is 100% COMPLETE. Every single UI5 controller in the application has been decomposed below the strict 300-line threshold while preserving all event bindings, models, and zero UI5 linter findings.

---

## 6. Dynamic References & Coupling Analysis

Audited across seven architectural layers to guarantee zero breaking changes during modularization:

### 6.1 UI5 Controller XML View Event Bindings
- **Pattern:** UI5 XML views declare event handlers via string attribute values (e.g. `press=".onAskAiPress"`, `search=".onSearchUsers"`).
- **Coupling Mechanism:** Breaking or renaming a method breaks UI interaction without triggering build-time errors.
- **Refactoring Guardrail:** Controller prototypes must maintain backward-compatible delegating forwarders for every XML-bound event handler.

### 6.2 UI5 Model Property Path Bindings
- **Pattern:** Controls bind to JSONModel properties using string paths (e.g. `{poView>/isAiDrawerOpen}`, `{adminView>/selectedTab}`, `{orderView>/items}`).
- **Coupling Mechanism:** Restructuring model schemas or renaming internal keys breaks UI reactivity silently without runtime exceptions.
- **Refactoring Guardrail:** Model schemas must remain invariant, or view paths and controller setters must be updated atomically.

### 6.3 UI5 Dynamic Fragment Loading & Scoped Control IDs
- **Pattern:** Controllers load XML fragments via `this.loadFragment({ name: "saps4hana.fiori.view.SapLogs" })` and access controls via `this.byId("controlId")`.
- **Coupling Mechanism:** IDs within fragments are automatically prefixed with the view ID unless instantiated without prefix.
- **Refactoring Guardrail:** Never change control IDs in XML views/fragments without verifying all `byId()` calls across controllers and test fixtures.

### 6.4 S/4HANA RFC Call Dispatch & DDIC Field Names
- **Pattern:** RFC clients dynamically invoke backend ABAP function modules using string names (e.g. `client.call("BAPI_PO_CREATE1", ...)` or `client.call("RFC_READ_TABLE", ...)`).
- **Coupling Mechanism:** ABAP parameter structures (`BAPIMEPOHEADER`, `BAPIMEPOITEM`) and table field names (`EBELN`, `MATNR`, `WERKS`, `LGORT`, `MENGE`, `NETPR`) are strict uppercase DDIC identifiers.
- **Refactoring Guardrail:** Adapters translate between camelCase domain models and uppercase SAP DDIC parameters. Parameter mappings must not be refactored without live or fixture-backed RFC parity testing.

### 6.5 S/4HANA OData V2 Date Formats & EDM Metadata
- **Pattern:** S/4 OData V2 services serialize dates as `/Date(1700000000000)/` and require strict EDM property names (`PurchaseOrder`, `PurchaseOrderItem`).
- **Coupling Mechanism:** Adapters (`S4HttpClient`, `OutboundDeliveryAdapter`, `CustomerReturnAdapter`) contain dedicated parsers (`_parseODataV2Date`, `_formatODataV2Date`).
- **Refactoring Guardrail:** Shared date transformation logic must be standardized in `srv/common/dateUtils.js` rather than duplicated across adapters.

### 6.6 Distributed Locking with Atomic Compare-And-Swap (CAS)
- **Pattern:** `GoodsReceiptAttemptStore.js` and `lockNotifier.js` coordinate multi-instance Cloud Foundry execution (`CF_INSTANCE_INDEX`) using atomic CAS updates on `LastError` (`lease:${workerId}:${expiresAtIso}`).
- **Coupling Mechanism:** The database record acts as a distributed mutex across horizontally scaled app containers.
- **Refactoring Guardrail:** Any refactoring of attempt stores must strictly preserve atomic transactional leasing rules (`db.tx({ user: cds.User.privileged })`).

### 6.7 Dual-Boundary Authentication & Request-Scoped Token Caching
- **Pattern:** Express bootstrap layer (`server.js`) and CAP protocol middleware (`srv/auth/localTokenUtil.js`) share `req._verifiedBearerToken` and `req.user` by reference.
- **Coupling Mechanism:** Eliminates redundant HMAC SHA-256 validation and prevents identity drift between Express endpoints (`/ai/chat/stream`, `/admin/diagnostics/sap`) and OData V4 services.
- **Refactoring Guardrail:** Neither authentication boundary may be removed or altered independently.

---

## 7. Safest Recommended Refactoring Roadmap

To ensure zero downtime, zero regression, and 100% preservation of S/4 integration contracts, refactoring proceeds in a dependency-ordered, risk-tiered sequence:

```text
Phase 1: Leaf Utilities & Pure Logic [COMPLETED - PASS]
   ↓
Phase 2: S/4 Integration Adapters [COMPLETED - PASS]
   ↓
Phase 3: Backend CAP Services & Attempt Stores [COMPLETED - PASS]
   ↓
Phase 4: Frontend View Models & Non-UI Services [COMPLETED - PASS]
   ↓
Phase 5: UI5 Controllers & XML View Fragment Modularization [COMPLETED - PASS]
   ↓
Phase 6: Documentation, Final Verification & Test Suite Decomposition [CURRENT]
```

### Phase 1: Pure Utilities and Leaf Validation Logic (STATUS: COMPLETED — PASS)
- Slashed `filterUtils.js` (from 349 to 214 lines) by extracting `cqnFilterEvaluator.js` (167 lines).
- Slashed `PurchaseOrderValidator.js` (from 1,140 to 930 lines) by extracting `PurchaseOrderBackendErrorMapper.js` (258 lines); then to 285 lines (2026-11-21) via `PurchaseOrderValidationLimits.js`, `PurchaseOrderFieldValidator.js`, `PurchaseOrderFormValidator.js`, and `PurchaseOrderHeaderValidator.js`.
- Added dedicated unit test suites; 100% pass across all tests.

### Phase 2: S/4 Integration Adapters (STATUS: COMPLETED — PASS)
- Slashed `SalesInquiryAdapter.js` (from 1,434 to 676 lines) by extracting `salesInquiryDetailReader.js`, `salesInquiryWorklistReader.js`, `salesInquiryCustomerDefaults.js`, and `salesOrderReader.js`; then to 224 lines (2026-11-21) via `salesInquiryConnection.js`, `salesInquiryCatalogReader.js`, and `salesInquiryMasterData.js`.
- Slashed `UserManagementAdapter.js` (from 797 to 530 lines) by extracting `UserHistoryReader.js` and `UserPasswordExpiryUtil.js`.
- 100% backward compatibility via prototype delegation; all 20 adapter suites passed.

### Phase 3: Backend CAP Handlers & Background Daemons (STATUS: COMPLETED — PASS)
- Slashed `srv/admin/lockNotifier.js` (from 650 to 509 lines) by extracting `LockDiffEngine.js` (195 lines).
- Added dedicated test suite `lockDiffEngine.test.js`; 100% pass.

### Phase 4: Frontend View Models & Client Services (STATUS: COMPLETED — PASS)
- Slashed `MibLabelPdf.js` (from 811 to 264 lines) by extracting `MibBarcodeLayout.js`, `MibLabelRows.js`, `MibStandardSticker.js`, and `MibLabelLayout.js`.
- Slashed `ValueHelpService.js` (from 669 to 285 lines) by extracting `InquiryTypeValueHelpDialog.js` and `MaterialValueHelpDialog.js`.
- Slashed `SalesOrderModel.js` (from 668 to 137 lines) by extracting `SalesOrderValidator.js` (268 lines) and `SalesOrderPayloadBuilder.js` (240 lines).
- Slashed `SalesInquiryModel.js` (from 669 to 122 lines) by extracting `SalesInquiryValidator.js` (257 lines) and `SalesInquiryPayloadBuilder.js` (297 lines).
- Slashed `PurchaseOrderModel.js` (from 634 to 233 lines) by extracting `PurchaseOrderInitialState.js` (161 lines) and `PurchaseOrderOperations.js` (148 lines).
- Added dedicated test suites; all 36 frontend test suites passed.

### Phase 5: UI5 Controllers & XML Views (STATUS: COMPLETED — PASS)
- Slashed `PurchaseOrders.controller.js` (from 1,836 to 293 lines, -84.0%) by extracting 7 submodules.
- Slashed `Dashboard.controller.js` (from 1,475 to 275 lines, -81.4%) by extracting 8 submodules.
- Slashed `CreatePurchaseOrder.controller.js` (from 1,223 to 223 lines, -81.8%) by extracting 5 submodules.
- Slashed `CreateSalesOrder.controller.js` (from 979 to 280 lines, -71.4%) by extracting 5 submodules.
- Slashed `CreateSalesInquiry.controller.js` (from 911 to 271 lines, -70.3%) by extracting 5 submodules.
- Slashed `OrdersDueForDelivery.controller.js` (from 760 to 178 lines, -76.6%) by extracting 4 submodules.
- Slashed `HandlingUnits.controller.js` (from 643 to 268 lines, -58.3%) by extracting 4 submodules.
- Slashed `CreateCustomerReturn.controller.js` (from 668 to 219 lines, -67.2%) by extracting 4 submodules.
- Slashed `GoodsReceipt.controller.js` (from 613 to 275 lines, -55.1%) by extracting 3 submodules.
- Slashed `MibLabel.controller.js` (from 588 to 171 lines, -70.9%) by extracting 3 submodules.
- Slashed `QuarantineLabels.controller.js` (from 540 to 143 lines, -73.5%) by extracting 3 submodules (`QuarantineLabelActionCoordinator.js`, `QuarantineLabelPreviewManager.js`, `QuarantineLabelTableManager.js`).
- Slashed `CustomerInvoices.controller.js` (from 540 to 131 lines, -75.7%) by extracting 3 submodules (`CustomerInvoiceActionCoordinator.js`, `CustomerInvoiceFilterManager.js`, `CustomerInvoiceFormatters.js`).
- Slashed `SalesOrders.controller.js` (from 407 to 157 lines, -61.4%) by extracting 3 submodules (`SalesOrderDeliveryActions.js`, `SalesOrderTableManager.js`, `SalesOrderFormatters.js`).
- Slashed `CustomerReturns.controller.js` (from 378 to 146 lines, -61.4%) by extracting 3 submodules (`CustomerReturnFormatters.js`, `CustomerReturnItemsDialog.js`, `CustomerReturnTableManager.js`).
- Slashed `App.controller.js` (from 366 to 87 lines, -76.2%) by extracting 2 submodules (`AppShellRouteTitleManager.js`, `AppShellNavigationManager.js`).
- Preserved `METRIC_KEYS` regex contract, all XML view event bindings, and all data/routing models.
- All 29 newly created/refactored controller files are strictly $\le 300$ lines.
- UI5 linter 0 findings; all purchase order, dashboard, and sales order test suites passed (777 tests).

### Phase 6: Automated Test Suite Decomposition & Verification (STATUS: IN PROGRESS)
- Target: 60 test suites exceeding 300 lines (e.g. `salesOrderAdapter.test.js` [1,058], `headerValueHelpSelection.test.js` [1,033], `verifyShellScreens.e2e.js` [1,005]).
- Action: Separate monolithic test files into focused test files grouped by happy path, boundary validation, and error recovery.

---

## 8. Verification & Audit Trail

### 8.1 Verification Commands Executed
- Scanned all tracked repository files: `git ls-files` (1,067 tracked files as of 2026-11-21).
- Verified repository status: `git status -uall`.
- Measured line counts using exact POSIX counts: `wc -l <file>`.
- Verified UI5 Linter: `npm --prefix app/fiori-app run lint` (0 findings).
- Verified ESLint: `npm run lint` (0 errors).
- Verified Unit Tests: `npx jest test/unit/sales-order/ test/unit/purchase-order/ test/unit/admin/adminDashboardList.test.js test/unit/dashboard/dashboardMetrics.test.js` (777 tests passed).

### 8.2 Working Tree Status
The `git status` snapshot originally printed here was stale: those files were committed later. On 2026-11-21 the working tree was clean at commit `1ef485dd` before this correction.

### 8.3 Re-validation on 2026-11-21 (commit `1ef485dd`)
- **Inventory — CONFIRMED:** recount with `git ls-files` + `wc -l` gives 96 files over 300 lines; every line count in Section 4 matches.
- **Full Jest suite (`npx jest`) — FAIL as found:** 2 failed, 3,504 passed, 13 skipped. Both failures were in `test/unit/purchase-order/createPORefreshRouting.test.js`: its `sap.ui.define` mock injected 4 of `AuthService`'s 7 dependencies, so after the `AuthModelSync.js` extraction (commit `082df8d0`) header sync was a silent no-op in the test. The "100% PASS" / "zero regression" statements in this report were based on targeted suites and did not cover this one.
- **After the test fix — PASS:** 212 suites, 3,506 passed, 13 skipped, 0 failed.
- **Linters:** ESLint 0 errors, 8 warnings; UI5 linter 0 findings.
- **Corrected in this report:** tracked-file count (911 → 1,067), Section 1.2 layer and test-type split, Section 2 tables (119 → 96), Top 20 rank 17/20, Section 4 rank numbering (gaps removed), Phase 2 status, Section 8.2.
- **Not re-verified:** the "834 non-excluded" and "715 scanned" totals (a recount with an approximated exclusion filter gave 706), Playwright E2E, CDS compile, MTA validation.

### 8.4 Splits of the two largest code files (2026-11-21)
- `PurchaseOrderValidator.js` 930 → 285 and `SalesInquiryAdapter.js` 676 → 224; all 7 new files are under 300 lines. Inventory is now 94 files over 300 lines.
- Code was moved by exact line ranges; no rule, message, query, or SAP payload was changed.
- `npx jest`: 212 suites, 3,506 passed, 13 skipped, 0 failed. ESLint 0 errors / 8 warnings; UI5 linter 0 findings.
- Old-vs-new validator comparison on randomized inputs: 56,000 comparisons, identical output and model state.
- `node test/e2e/runAllE2E.js --sap-free`: 6/6 suites passed (includes the Create Purchase Order empty-submit validation in the browser).
- Not verified: SAP-connected E2E and live SAP reads through the moved adapter methods.

---
*Line counts verified with POSIX `wc -l`; validation status is as recorded in Section 8.3.*
