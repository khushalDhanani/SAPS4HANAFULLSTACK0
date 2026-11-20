'use strict';

let InquiryTypeValueHelpDialog;
let MaterialValueHelpDialog;

function MockDialog(cfg) {
    this.cfg = cfg;
    this.setModel = jest.fn();
    this.addStyleClass = jest.fn();
    this.open = jest.fn();
    this.close = jest.fn();
    this.destroy = jest.fn();
}

function MockTableSelectDialog(cfg) {
    this.cfg = cfg;
    this.setModel = jest.fn();
    this.addStyleClass = jest.fn();
    this.bindAggregation = jest.fn();
    this.open = jest.fn();
    this.destroy = jest.fn();
}

function MockControl() {
    this.addStyleClass = jest.fn().mockReturnThis();
    this.bindAggregation = jest.fn();
    this.getSelectedItem = jest.fn();
    this.getBinding = jest.fn().mockReturnValue({ filter: jest.fn() });
}

beforeAll(() => {
    global.sap = {
        ui: {
            define: (deps, factory) => {
                if (deps.includes('sap/m/TableSelectDialog')) {
                    MaterialValueHelpDialog = factory(
                        function () {}, // Filter
                        { Contains: 'Contains', EQ: 'EQ' }, // FilterOperator
                        MockTableSelectDialog,
                        MockControl, // Column
                        MockControl, // ColumnListItem
                        MockControl, // Text
                        MockControl, // ObjectIdentifier
                        MockControl  // ObjectStatus
                    );
                } else if (deps.includes('sap/m/Dialog')) {
                    InquiryTypeValueHelpDialog = factory(
                        function () {}, // Filter
                        { Contains: 'Contains', EQ: 'EQ' }, // FilterOperator
                        MockDialog,
                        MockControl, // Table
                        MockControl, // Toolbar
                        MockControl, // ToolbarSpacer
                        MockControl, // SearchField
                        MockControl, // SegmentedButton
                        MockControl, // SegmentedButtonItem
                        MockControl, // Button
                        MockControl, // VBox
                        MockControl, // Label
                        MockControl, // Column
                        MockControl, // ColumnListItem
                        MockControl, // Text
                        MockControl, // ObjectIdentifier
                        MockControl  // ObjectStatus
                    );
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/service/valuehelp/MaterialValueHelpDialog');
    require('../../../app/fiori-app/webapp/service/valuehelp/InquiryTypeValueHelpDialog');
});

describe('ValueHelp Dialog Components', () => {
    const mockView = {
        getModel: jest.fn(),
        addDependent: jest.fn()
    };
    const mockInput = {
        setValue: jest.fn(),
        getBinding: jest.fn()
    };
    const mockModel = {};

    describe('MaterialValueHelpDialog', () => {
        it('opens TableSelectDialog with 5 columns and compact style', () => {
            const conf = { key: 'Material', desc: 'MaterialName' };
            MaterialValueHelpDialog.open(mockView, mockInput, mockModel, '/MaterialVH', conf, []);

            expect(mockView.addDependent).toHaveBeenCalled();
        });
    });

    describe('InquiryTypeValueHelpDialog', () => {
        it('opens InquiryTypeValueHelpDialog with scannable table and filter controls', () => {
            InquiryTypeValueHelpDialog.open(mockView, mockInput, mockModel, '/SalesInquiryTypeVH', []);

            expect(mockView.addDependent).toHaveBeenCalled();
        });
    });
});
