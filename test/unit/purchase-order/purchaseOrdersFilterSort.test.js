/**
 * Unit Tests for Purchase Orders FilterBar & Table Sorting
 * Covers:
 * - Filter criteria construction (all individual fields and combinations)
 * - Global search + FilterBar combination
 * - DateRange formatting and filtering (EQ, BT, GE)
 * - Completeness status boolean filter
 * - FilterBar clear action
 * - Column sorting toggle and column switching (OData $orderby mapping)
 * - State preservation on refresh
 * - Value help and autocomplete delegation
 */

let ControllerClass;

// Mock UI5 classes and environment
class MockFilter {
    constructor(sPathOrConfig, sOperator, vValue1, vValue2) {
        if (typeof sPathOrConfig === "object" && sPathOrConfig !== null) {
            this.aFilters = sPathOrConfig.filters || [];
            this.bAnd = sPathOrConfig.and !== undefined ? sPathOrConfig.and : true;
        } else {
            this.sPath = sPathOrConfig;
            this.sOperator = sOperator;
            this.oValue1 = vValue1;
            this.oValue2 = vValue2;
        }
    }
}

const FilterOperator = {
    Contains: "Contains",
    EQ: "EQ",
    BT: "BT",
    GE: "GE",
    LE: "LE"
};

class MockSorter {
    constructor(sPath, bDescending) {
        this.sPath = sPath;
        this.bDescending = !!bDescending;
    }
}

const coreLibrary = {
    SortOrder: {
        Ascending: "Ascending",
        Descending: "Descending",
        None: "None"
    }
};

const mockValueHelpService = {
    openValueHelp: jest.fn(),
    applySuggestionFilter: jest.fn()
};

// Setup sap.ui.define mock
global.sap = {
    ui: {
        define: function (deps, factory) {
            function MockBaseController() {}
            MockBaseController.extend = function (sName, oMembers) {
                function Controller() {
                    if (oMembers.onInit) {
                        this.onInit = oMembers.onInit;
                    }
                }
                Object.assign(Controller.prototype, oMembers);
                return Controller;
            };

            ControllerClass = factory(
                MockBaseController,
                class MockJSONModel {
                    constructor(oData) {
                        this.data = Object.assign({}, oData);
                    }
                    setProperty(path, val) {
                        this.data[path.replace("/", "")] = val;
                    }
                    getProperty(path) {
                        return this.data[path.replace("/", "")];
                    }
                },
                MockFilter,
                FilterOperator,
                MockSorter,
                coreLibrary,
                { error: jest.fn(), information: jest.fn() },
                mockValueHelpService
            );
        }
    }
};

// Require the controller under test
require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller');

describe('PurchaseOrders Controller - FilterBar & Table Sorting UI', () => {
    let controller;
    let mockControls;
    let mockBinding;
    let mockColumns;
    let mockView;
    let mockViewModel;

    const createInputMock = (sInitial = "") => {
        let val = sInitial;
        return {
            getValue: jest.fn(() => val),
            setValue: jest.fn(v => { val = v; })
        };
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockBinding = {
            filter: jest.fn(),
            sort: jest.fn(),
            refresh: jest.fn()
        };

        mockColumns = [
            {
                id: "colPO",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "PurchaseOrder" })
            },
            {
                id: "colSup",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "SupplierName" })
            },
            {
                id: "colCo",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "CompanyCode" })
            },
            {
                id: "colOrg",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "PurchasingOrganization" })
            },
            {
                id: "colDate",
                sIndicator: "Descending",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "CreationDate" })
            },
            {
                id: "colCreatedBy",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "CreatedByUser" })
            },
            {
                id: "colStat",
                sIndicator: "None",
                setSortIndicator: jest.fn(function (ind) { this.sIndicator = ind; }),
                getHeader: () => ({ data: () => "PurchasingCompletenessStatus" })
            }
        ];

        let dRangeStart = null;
        let dRangeEnd = null;
        let sRangeVal = "";
        let sStatusKey = "";

        mockControls = {
            searchField: createInputMock(""),
            fbPO: createInputMock(""),
            fbSupplier: createInputMock(""),
            fbCompanyCode: createInputMock(""),
            fbPurchasingOrg: createInputMock(""),
            fbPurchasingGroup: createInputMock(""),
            fbDocType: createInputMock(""),
            fbCreatedBy: createInputMock(""),
            fbDateRange: {
                getValue: jest.fn(() => sRangeVal),
                setValue: jest.fn(v => { sRangeVal = v; }),
                getDateValue: jest.fn(() => dRangeStart),
                setDateValue: jest.fn(d => { dRangeStart = d; }),
                getSecondDateValue: jest.fn(() => dRangeEnd),
                setSecondDateValue: jest.fn(d => { dRangeEnd = d; })
            },
            fbStatus: {
                getSelectedKey: jest.fn(() => sStatusKey),
                setSelectedKey: jest.fn(k => { sStatusKey = k; })
            },
            purchaseOrdersTable: {
                getBinding: jest.fn().mockReturnValue(mockBinding),
                getColumns: jest.fn().mockReturnValue(mockColumns),
                attachEventOnce: jest.fn(),
                attachUpdateFinished: jest.fn()
            }
        };

        controller = new ControllerClass();
        controller.byId = jest.fn(id => mockControls[id] || null);

        mockViewModel = {
            data: {},
            setProperty: jest.fn(function (k, v) { this.data[k] = v; }),
            getProperty: jest.fn(function (k) { return this.data[k]; })
        };

        mockView = {
            setModel: jest.fn(),
            getModel: jest.fn().mockReturnValue(mockViewModel)
        };

        controller.getView = jest.fn(() => mockView);

        controller.onInit();
    });

    describe('Initial State', () => {
        it('should initialize default sort state to CreationDate descending (latest entered data first)', () => {
            expect(controller._sCurrentSortProperty).toBe("CreationDate");
            expect(controller._bCurrentSortDescending).toBe(true);
        });

        it('should return empty filter list when all controls are empty', () => {
            const aFilters = controller._buildFilterCriteria();
            expect(aFilters).toEqual([]);
        });
    });

    describe('FilterBar - Individual Field Filtering', () => {
        it('should filter by PurchaseOrder using Contains', () => {
            mockControls.fbPO.getValue.mockReturnValue("4500000001");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("PurchaseOrder");
            expect(aFilters[0].sOperator).toBe(FilterOperator.Contains);
            expect(aFilters[0].oValue1).toBe("4500000001");
        });

        it('should filter by Supplier ID or Supplier Name', () => {
            mockControls.fbSupplier.getValue.mockReturnValue("10300001");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters.length).toBe(2);
            expect(aFilters[0].aFilters[0].sPath).toBe("Supplier");
            expect(aFilters[0].aFilters[1].sPath).toBe("SupplierName");
        });

        it('should filter by CompanyCode using EQ', () => {
            mockControls.fbCompanyCode.getValue.mockReturnValue("1010");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("CompanyCode");
            expect(aFilters[0].sOperator).toBe(FilterOperator.EQ);
            expect(aFilters[0].oValue1).toBe("1010");
        });

        it('should filter by PurchasingOrganization using EQ', () => {
            mockControls.fbPurchasingOrg.getValue.mockReturnValue("1010");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("PurchasingOrganization");
            expect(aFilters[0].sOperator).toBe(FilterOperator.EQ);
            expect(aFilters[0].oValue1).toBe("1010");
        });

        it('should filter by PurchasingGroup using EQ', () => {
            mockControls.fbPurchasingGroup.getValue.mockReturnValue("001");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("PurchasingGroup");
            expect(aFilters[0].sOperator).toBe(FilterOperator.EQ);
            expect(aFilters[0].oValue1).toBe("001");
        });

        it('should filter by PurchaseOrderType using EQ', () => {
            mockControls.fbDocType.getValue.mockReturnValue("NB");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("PurchaseOrderType");
            expect(aFilters[0].sOperator).toBe(FilterOperator.EQ);
            expect(aFilters[0].oValue1).toBe("NB");
        });

        it('should filter by CreationDate with BT when start and end dates differ', () => {
            mockControls.fbDateRange.getDateValue.mockReturnValue(new Date(2026, 8, 1));
            mockControls.fbDateRange.getSecondDateValue.mockReturnValue(new Date(2026, 8, 5));

            const aFilters = controller._buildFilterCriteria();
            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("CreationDate");
            expect(aFilters[0].sOperator).toBe(FilterOperator.BT);
            expect(aFilters[0].oValue1).toBe("2026-09-01");
            expect(aFilters[0].oValue2).toBe("2026-09-05");
        });

        it('should filter by CreationDate with EQ when start and end dates are identical', () => {
            mockControls.fbDateRange.getDateValue.mockReturnValue(new Date(2026, 8, 1));
            mockControls.fbDateRange.getSecondDateValue.mockReturnValue(new Date(2026, 8, 1));

            const aFilters = controller._buildFilterCriteria();
            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("CreationDate");
            expect(aFilters[0].sOperator).toBe(FilterOperator.EQ);
            expect(aFilters[0].oValue1).toBe("2026-09-01");
        });

        it('should filter by CreationDate with GE when only start date is provided', () => {
            mockControls.fbDateRange.getDateValue.mockReturnValue(new Date(2026, 8, 1));
            mockControls.fbDateRange.getSecondDateValue.mockReturnValue(null);

            const aFilters = controller._buildFilterCriteria();
            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe("CreationDate");
            expect(aFilters[0].sOperator).toBe(FilterOperator.GE);
            expect(aFilters[0].oValue1).toBe("2026-09-01");
        });

        it('should filter by Display Status Approved', () => {
            mockControls.fbStatus.getSelectedKey.mockReturnValue("Approved");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters.length).toBe(3);
            expect(aFilters[0].aFilters[0].sPath).toBe("PurchasingDocumentStatus");
            expect(aFilters[0].aFilters[0].oValue1).toBe("04");
            expect(aFilters[0].aFilters[1].sPath).toBe("PurchasingDocumentStatus");
            expect(aFilters[0].aFilters[1].oValue1).toBe("05");
            expect(aFilters[0].aFilters[2].sPath).toBe("PurchasingCompletenessStatus");
            expect(aFilters[0].aFilters[2].oValue1).toBe(true);
        });

        it('should filter by Display Status Draft', () => {
            mockControls.fbStatus.getSelectedKey.mockReturnValue("Draft");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters.length).toBe(2);
            expect(aFilters[0].aFilters[0].sPath).toBe("PurchasingDocumentStatus");
            expect(aFilters[0].aFilters[0].oValue1).toBe("01");
            expect(aFilters[0].aFilters[1].sPath).toBe("PurchasingCompletenessStatus");
            expect(aFilters[0].aFilters[1].oValue1).toBe(false);
        });

        it('should filter by Display Status In Approval', () => {
            mockControls.fbStatus.getSelectedKey.mockReturnValue("In Approval");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters[0].sPath).toBe("PurchasingDocumentStatus");
            expect(aFilters[0].aFilters[0].oValue1).toBe("02");
            expect(aFilters[0].aFilters[1].sPath).toBe("ReleaseIsNotCompleted");
            expect(aFilters[0].aFilters[1].oValue1).toBe(true);
        });

        it('should filter by Display Status Rejected', () => {
            mockControls.fbStatus.getSelectedKey.mockReturnValue("Rejected");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters[0].sPath).toBe("PurchasingDocumentStatus");
            expect(aFilters[0].aFilters[0].oValue1).toBe("38");
            expect(aFilters[0].aFilters[1].sPath).toBe("PurchasingDocumentDeletionCode");
            expect(aFilters[0].aFilters[1].oValue1).toBe("L");
        });

        it('should filter by CreatedByUser (matching user ID or full name)', () => {
            mockControls.fbCreatedBy.getValue.mockReturnValue("SANDHLE");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters.length).toBe(2);
            expect(aFilters[0].aFilters[0].sPath).toBe("CreatedByUser");
            expect(aFilters[0].aFilters[0].sOperator).toBe(FilterOperator.Contains);
            expect(aFilters[0].aFilters[0].oValue1).toBe("SANDHLE");
            expect(aFilters[0].aFilters[1].sPath).toBe("UserFullName");
            expect(aFilters[0].aFilters[1].sOperator).toBe(FilterOperator.Contains);
            expect(aFilters[0].aFilters[1].oValue1).toBe("SANDHLE");
        });
    });

    describe('Global Toolbar Search & Combined Queries', () => {
        it('should create OR filter across PO, Supplier, SupplierName, CompanyCode, CreatedByUser, and UserFullName for global search', () => {
            mockControls.searchField.getValue.mockReturnValue("SAP");
            const aFilters = controller._buildFilterCriteria();

            expect(aFilters.length).toBe(1);
            expect(aFilters[0].bAnd).toBe(false);
            expect(aFilters[0].aFilters.length).toBe(6);
            expect(aFilters[0].aFilters[0].sPath).toBe("PurchaseOrder");
            expect(aFilters[0].aFilters[1].sPath).toBe("Supplier");
            expect(aFilters[0].aFilters[2].sPath).toBe("SupplierName");
            expect(aFilters[0].aFilters[3].sPath).toBe("CompanyCode");
            expect(aFilters[0].aFilters[4].sPath).toBe("CreatedByUser");
            expect(aFilters[0].aFilters[5].sPath).toBe("UserFullName");
        });

        it('should combine global search AND multiple FilterBar fields', () => {
            mockControls.searchField.getValue.mockReturnValue("SAP");
            mockControls.fbPO.getValue.mockReturnValue("4500000001");
            mockControls.fbCompanyCode.getValue.mockReturnValue("1010");
            mockControls.fbStatus.getSelectedKey.mockReturnValue("true");

            const aFilters = controller._buildFilterCriteria();
            expect(aFilters.length).toBe(4);

            controller._applyFilters();
            expect(mockBinding.filter).toHaveBeenCalledTimes(1);
            const appliedFilter = mockBinding.filter.mock.calls[0][0];
            expect(appliedFilter.bAnd).toBe(true);
            expect(appliedFilter.aFilters.length).toBe(4);
        });

        it('should pass empty array to binding when all filters are cleared', () => {
            controller._applyFilters();
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });
    });

    describe('FilterBar Clear Action', () => {
        it('should clear all control values and re-apply filters to binding', () => {
            mockControls.fbPO.setValue("4500000001");
            mockControls.fbSupplier.setValue("10300001");
            mockControls.fbCompanyCode.setValue("1010");
            mockControls.fbPurchasingOrg.setValue("1010");
            mockControls.fbPurchasingGroup.setValue("001");
            mockControls.fbDocType.setValue("NB");
            mockControls.fbCreatedBy.setValue("SANDHLE");
            mockControls.fbStatus.setSelectedKey("true");

            controller.onFilterBarClear();

            expect(mockControls.fbPO.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbSupplier.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbCompanyCode.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbPurchasingOrg.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbPurchasingGroup.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbDocType.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbCreatedBy.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbDateRange.setValue).toHaveBeenCalledWith("");
            expect(mockControls.fbDateRange.setDateValue).toHaveBeenCalledWith(null);
            expect(mockControls.fbDateRange.setSecondDateValue).toHaveBeenCalledWith(null);
            expect(mockControls.fbStatus.setSelectedKey).toHaveBeenCalledWith("");

            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });
    });

    describe('Column Sorting (OData $orderby)', () => {
        const createSortEvent = (sProperty) => ({
            getSource: () => ({
                data: (k) => k === "sortProperty" ? sProperty : null
            })
        });

        it('should toggle from descending to ascending when clicking the current sort column', () => {
            expect(controller._sCurrentSortProperty).toBe("CreationDate");
            expect(controller._bCurrentSortDescending).toBe(true);

            controller.onSortColumn(createSortEvent("CreationDate"));

            expect(controller._bCurrentSortDescending).toBe(false);
            expect(mockBinding.sort).toHaveBeenCalledWith([
                expect.objectContaining({ sPath: "CreationDate", bDescending: false }),
                expect.objectContaining({ sPath: "PurchaseOrder", bDescending: false })
            ]);

            const colDate = mockColumns.find(c => c.id === "colDate");
            expect(colDate.setSortIndicator).toHaveBeenCalledWith("Ascending");
        });

        it('should switch sort property and default to descending when clicking a new column', () => {
            controller.onSortColumn(createSortEvent("SupplierName"));

            expect(controller._sCurrentSortProperty).toBe("SupplierName");
            expect(controller._bCurrentSortDescending).toBe(true);
            expect(mockBinding.sort).toHaveBeenCalledWith([
                expect.objectContaining({ sPath: "SupplierName", bDescending: true })
            ]);

            const colSup = mockColumns.find(c => c.id === "colSup");
            const colDate = mockColumns.find(c => c.id === "colDate");
            expect(colSup.setSortIndicator).toHaveBeenCalledWith("Descending");
            expect(colDate.setSortIndicator).toHaveBeenCalledWith("None");
        });

        it('should support sorting for all table columns', () => {
            const columns = [
                "PurchaseOrder",
                "SupplierName",
                "CompanyCode",
                "PurchasingOrganization",
                "CreationDate",
                "CreatedByUser",
                "PurchasingCompletenessStatus"
            ];

            columns.forEach(prop => {
                controller.onSortColumn(createSortEvent(prop));
                expect(controller._sCurrentSortProperty).toBe(prop);
                const aLastCall = mockBinding.sort.mock.calls[mockBinding.sort.mock.calls.length - 1][0];
                expect(aLastCall[0].sPath).toBe(prop);
                if (prop === "CreationDate") {
                    expect(aLastCall.length).toBe(2);
                    expect(aLastCall[1].sPath).toBe("PurchaseOrder");
                } else {
                    expect(aLastCall.length).toBe(1);
                }
            });
        });

        it('should ignore event if sortProperty customData is missing', () => {
            const oEvent = {
                getSource: () => ({
                    data: () => null
                })
            };

            controller.onSortColumn(oEvent);
            expect(mockBinding.sort).not.toHaveBeenCalled();
        });
    });

    describe('Table Refresh & State Preservation', () => {
        it('should invoke binding refresh without altering filter or sort criteria', () => {
            // Set initial state
            controller._sCurrentSortProperty = "SupplierName";
            controller._bCurrentSortDescending = true;

            controller.onRefresh();

            expect(mockBinding.refresh).toHaveBeenCalledTimes(1);
            // State remains intact
            expect(controller._sCurrentSortProperty).toBe("SupplierName");
            expect(controller._bCurrentSortDescending).toBe(true);
        });
    });

    describe('Value Help and Suggestion Delegation', () => {
        it('should delegate valueHelpRequest to ValueHelpService.openValueHelp', () => {
            const mockInput = { id: "input" };
            const oEvent = { getSource: () => mockInput };

            controller.onValueHelpRequest(oEvent);
            expect(mockValueHelpService.openValueHelp).toHaveBeenCalledWith(
                controller.getView(),
                mockInput
            );
        });

        it('should delegate suggest event to ValueHelpService.applySuggestionFilter', () => {
            const mockInput = { id: "input" };
            const oEvent = {
                getSource: () => mockInput,
                getParameter: jest.fn().mockReturnValue("101")
            };

            controller.onSuggest(oEvent);
            expect(mockValueHelpService.applySuggestionFilter).toHaveBeenCalledWith(
                mockInput,
                "101"
            );
        });
    });

    describe('Navigation to Purchase Order Detail', () => {
        it('should navigate to purchaseOrderDetail route when table item is pressed', () => {
            const mockNavTo = jest.fn();
            controller.getOwnerComponent = () => ({
                getRouter: () => ({
                    navTo: mockNavTo
                })
            });

            const mockContext = {
                getProperty: jest.fn().mockReturnValue("300000001")
            };
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({
                    getBindingContext: () => mockContext
                })
            };

            controller.onItemPress(oEvent);

            expect(mockNavTo).toHaveBeenCalledWith("purchaseOrderDetail", {
                PurchaseOrder: "300000001"
            });
        });

        it('should not navigate if item context is missing', () => {
            const mockNavTo = jest.fn();
            controller.getOwnerComponent = () => ({
                getRouter: () => ({
                    navTo: mockNavTo
                })
            });

            const oEvent = {
                getParameter: jest.fn().mockReturnValue(null)
            };

            controller.onItemPress(oEvent);
            expect(mockNavTo).not.toHaveBeenCalled();
        });
    });
});
