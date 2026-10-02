/**
 * Unit Tests for Movement 311 View Structure, Declarative Bindings, and Manifest Routing
 */

const fs = require('fs');
const path = require('path');

describe('Movement 311: View Structure, Declarative Bindings & Manifest Contract', () => {
    const sPendingViewPath = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue311Pending.view.xml');
    const sExecViewPath = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue311.view.xml');
    const sManifestPath = path.join(__dirname, '../../../app/fiori-app/webapp/manifest.json');
    const sI18nPath = path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n.properties');
    const sI18nEnPath = path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n_en.properties');

const sPendingXml = fs.readFileSync(sPendingViewPath, 'utf8');
const sAppController = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/controller/App.controller.js'), 'utf8');
const sExecXml = fs.readFileSync(sExecViewPath, 'utf8');
const oManifest = JSON.parse(fs.readFileSync(sManifestPath, 'utf8'));
const sI18n = fs.readFileSync(sI18nPath, 'utf8');
const sI18nEn = fs.readFileSync(sI18nEnPath, 'utf8');

    describe('GoodsIssue311Pending.view.xml structure & naming discipline', () => {
        test('pending view file exists and is populated', () => {
            expect(sPendingXml).toBeDefined();
            expect(sPendingXml.length).toBeGreaterThan(100);
        });

        test('page title binds strictly to gi311OpenTransfersTitle ("Open Transfers (311)")', () => {
            // The title is shown by the application ShellBar (App.controller), like on every other page.
            expect(sPendingXml).toContain('showHeader="false"');
            expect(sAppController).toContain('wmGoodsIssue311Pending: "gi311OpenTransfersTitle"');
            expect(sI18n).toContain('gi311OpenTransfersTitle=Open Transfers (311)');
            expect(sI18nEn).toContain('gi311OpenTransfersTitle=Open Transfers (311)');
        });

        test('enforces naming discipline: zero user-facing "Pending" text in view XML', () => {
            // Controller/file naming can contain Pending, but user-facing text and attributes must not contain "Pending"
            const textMatches = sPendingXml.match(/text="[^"]*Pending[^"]*"/gi);
            const titleMatches = sPendingXml.match(/title="[^"]*Pending[^"]*"/gi);
            expect(textMatches).toBeNull();
            expect(titleMatches).toBeNull();
        });

        test('contains responsive table with items bound to gi311p>/items', () => {
            expect(sPendingXml).toContain('items="{gi311p>/items}"');
            expect(sPendingXml).toContain('press=".onOpenReservation"');
        });

        test('table columns bind to all required localized column headers', () => {
            const expectedHeaders = [
                'gi311OpenTransfersColReservation',
                'gi311OpenTransfersColMaterial',
                'gi311OpenTransfersColPlant',
                'gi311OpenTransfersColIssuingSLoc',
                'gi311OpenTransfersColReceivingSLoc',
                'gi311OpenTransfersColCreatedBy',
                'gi311OpenTransfersColItems'
            ];
            expectedHeaders.forEach((key) => {
                expect(sPendingXml).toContain(`{i18n>${key}}`);
                expect(sI18n).toContain(`${key}=`);
                expect(sI18nEn).toContain(`${key}=`);
            });
        });

        test('issuing storage location binds ObjectStatus with Select at Issue fallback', () => {
            expect(sPendingXml).toContain('text="{= ${gi311p>StorageLocation} ? ${gi311p>StorageLocation} : ${i18n>gi311OpenTransfersSLocSelectAtIssue} }"');
            expect(sPendingXml).toContain("state=\"{= ${gi311p>StorageLocation} ? 'None' : 'Information' }\"");
            expect(sI18n).toContain('gi311OpenTransfersSLocSelectAtIssue=Select at Issue');
            expect(sI18nEn).toContain('gi311OpenTransfersSLocSelectAtIssue=Select at Issue');
        });

        test('contains completion outcome message strip with close handler', () => {
            expect(sPendingXml).toContain('visible="{= !!${gi311p>/resultText} }"');
            expect(sPendingXml).toContain('text="{gi311p>/resultText}"');
            expect(sPendingXml).toContain("type=\"{= ${gi311p>/resultState} === 'None' ? 'Information' : ${gi311p>/resultState} }\"");
            expect(sPendingXml).toContain('close=".onCloseResult"');
        });

        test('contains error message strip with retry link', () => {
            expect(sPendingXml).toContain('visible="{= !!${gi311p>/error} }"');
            expect(sPendingXml).toContain('text="{gi311p>/error}"');
            expect(sPendingXml).toContain('press=".onRefresh"');
        });

        test('back navigation is owned by the ShellBar (no second back button on the page)', () => {
            expect(sPendingXml).not.toContain('showNavButton');
            expect(sAppController).toMatch(/case "wmGoodsIssue311Pending":/);
        });
    });

    describe('GoodsIssue311.view.xml execution UX & conditional bindings', () => {
        test('execution submit button text toggles between gi311BtnComplete and gi311BtnPost', () => {
            expect(sExecXml).toContain("${gi311>/fromReservation} ? ${i18n>gi311BtnComplete} : ${i18n>gi311BtnPost}");
        });

        test('execution submit button icon toggles between accept and save icons', () => {
            expect(sExecXml).toContain("${gi311>/fromReservation} ? 'sap-icon://accept' : 'sap-icon://save'");
        });

        test('locks ReservationNo input when fromReservation is active', () => {
            expect(sExecXml).toContain('id="inReservationNo311"');
            expect(sExecXml).toContain('showValueHelp="{= !${gi311>/fromReservation} }"');
        });

        test('locks ReservationItem input when fromReservation is active', () => {
            expect(sExecXml).toContain('id="inReservationItem311"');
            expect(sExecXml).toContain('editable="{= !${gi311>/fromReservation} }"');
        });
    });

    describe('manifest.json routing registration', () => {
        const aRoutes = oManifest['sap.ui5'].routing.routes;
        const oTargets = oManifest['sap.ui5'].routing.targets;

        test('registers wmGoodsIssue311Pending route with open-transfers pattern and query parameter', () => {
            const oRoute = aRoutes.find((r) => r.name === 'wmGoodsIssue311Pending');
            expect(oRoute).toBeDefined();
            expect(oRoute.pattern).toBe('wm/goods-issue/311/open-transfers:?query:');
            expect(oRoute.target).toBe('TargetGoodsIssue311Pending');
        });

        test('registers TargetGoodsIssue311Pending target referencing GoodsIssue311Pending view', () => {
            const oTarget = oTargets.TargetGoodsIssue311Pending;
            expect(oTarget).toBeDefined();
            expect(oTarget.name).toBe('GoodsIssue311Pending');
            expect(oTarget.path).toBe('saps4hana.fiori.modules.wm.goods-issue.view');
        });

        test('updates wmGoodsIssue311 pattern to accept optional :?query: for ?resv= prefill', () => {
            const oRoute = aRoutes.find((r) => r.name === 'wmGoodsIssue311');
            expect(oRoute).toBeDefined();
            expect(oRoute.pattern).toBe('wm/goods-issue/sloc-transfer-311:?query:');
        });
    });
});
