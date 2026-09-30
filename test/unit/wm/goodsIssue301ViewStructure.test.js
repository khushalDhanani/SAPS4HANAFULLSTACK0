/**
 * Unit Tests for Movement 301 View Structure, Declarative Bindings, and Manifest Routing
 */

const fs = require('fs');
const path = require('path');

describe('Movement 301: View Structure, Declarative Bindings & Manifest Contract', () => {
    const sPendingViewPath = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue301Pending.view.xml');
    const sExecViewPath = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/view/GoodsIssue301.view.xml');
    const sManifestPath = path.join(__dirname, '../../../app/fiori-app/webapp/manifest.json');
    const sI18nPath = path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n.properties');
    const sI18nEnPath = path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n_en.properties');

    const sPendingXml = fs.readFileSync(sPendingViewPath, 'utf8');
    const sExecXml = fs.readFileSync(sExecViewPath, 'utf8');
    const oManifest = JSON.parse(fs.readFileSync(sManifestPath, 'utf8'));
    const sI18n = fs.readFileSync(sI18nPath, 'utf8');
    const sI18nEn = fs.readFileSync(sI18nEnPath, 'utf8');

    describe('GoodsIssue301Pending.view.xml structure & naming discipline', () => {
        test('pending view file exists and is populated', () => {
            expect(sPendingXml).toBeDefined();
            expect(sPendingXml.length).toBeGreaterThan(100);
        });

        test('page title binds strictly to gi301OpenTransfersTitle ("Open Transfers (301)")', () => {
            expect(sPendingXml).toContain('title="{i18n>gi301OpenTransfersTitle}"');
            expect(sI18n).toContain('gi301OpenTransfersTitle=Open Transfers (301)');
            expect(sI18nEn).toContain('gi301OpenTransfersTitle=Open Transfers (301)');
        });

        test('enforces naming discipline: zero user-facing "Pending" text in view XML', () => {
            // Controller/file naming can contain Pending, but user-facing text and attributes must not contain "Pending"
            const textMatches = sPendingXml.match(/text="[^"]*Pending[^"]*"/gi);
            const titleMatches = sPendingXml.match(/title="[^"]*Pending[^"]*"/gi);
            expect(textMatches).toBeNull();
            expect(titleMatches).toBeNull();
        });

        test('contains responsive table with items bound to gi301p>/items', () => {
            expect(sPendingXml).toContain('items="{gi301p>/items}"');
            expect(sPendingXml).toContain('press=".onOpenReservation"');
        });

        test('table columns bind to all required localized column headers', () => {
            const expectedHeaders = [
                'gi301OpenTransfersColReservation',
                'gi301OpenTransfersColMaterial',
                'gi301OpenTransfersColPlant',
                'gi301OpenTransfersColReceivingPlant',
                'gi301OpenTransfersColIssuingSLoc',
                'gi301OpenTransfersColReceivingSLoc',
                'gi301OpenTransfersColCreatedBy',
                'gi301OpenTransfersColItems'
            ];
            expectedHeaders.forEach((key) => {
                expect(sPendingXml).toContain(`{i18n>${key}}`);
                expect(sI18n).toContain(`${key}=`);
                expect(sI18nEn).toContain(`${key}=`);
            });
        });

        test('contains completion outcome message strip with close handler', () => {
            expect(sPendingXml).toContain('visible="{= !!${gi301p>/resultText} }"');
            expect(sPendingXml).toContain('text="{gi301p>/resultText}"');
            expect(sPendingXml).toContain("type=\"{= ${gi301p>/resultState} === 'None' ? 'Information' : ${gi301p>/resultState} }\"");
            expect(sPendingXml).toContain('close=".onCloseResult"');
        });

        test('contains error message strip with retry link', () => {
            expect(sPendingXml).toContain('visible="{= !!${gi301p>/error} }"');
            expect(sPendingXml).toContain('text="{gi301p>/error}"');
        });

        test('navButtonPress binds to onNavBack', () => {
            expect(sPendingXml).toContain('navButtonPress=".onNavBack"');
        });
    });

    describe('GoodsIssue301.view.xml execution UX & conditional bindings', () => {
        test('execution submit button text toggles between gi301BtnComplete and gi301BtnPost', () => {
            expect(sExecXml).toContain("${gi301>/fromReservation} ? ${i18n>gi301BtnComplete} : ${i18n>gi301BtnPost}");
        });

        test('execution submit button icon toggles between accept and save icons', () => {
            expect(sExecXml).toContain("${gi301>/fromReservation} ? 'sap-icon://accept' : 'sap-icon://save'");
        });

        test('locks ReservationNo input when fromReservation is active', () => {
            expect(sExecXml).toContain('id="inReservationNo301"');
            expect(sExecXml).toContain('showValueHelp="{= !${gi301>/fromReservation} }"');
        });

        test('locks ReservationItem input when fromReservation is active', () => {
            expect(sExecXml).toContain('id="inReservationItem301"');
            expect(sExecXml).toContain('editable="{= !${gi301>/fromReservation} }"');
        });
    });

    describe('manifest.json Routing & Target Contract for Movement 301', () => {
        const aRoutes = oManifest['sap.ui5'].routing.routes;
        const oTargets = oManifest['sap.ui5'].routing.targets;

        test('registers wmGoodsIssue301Pending route with query pattern', () => {
            const oRoute = aRoutes.find((r) => r.name === 'wmGoodsIssue301Pending');
            expect(oRoute).toBeDefined();
            expect(oRoute.pattern).toBe('wm/goods-issue/301/open-transfers:?query:');
            expect(oRoute.target).toBe('TargetGoodsIssue301Pending');
        });

        test('updates wmGoodsIssue301 route pattern to support query prefill (?query:)', () => {
            const oRoute = aRoutes.find((r) => r.name === 'wmGoodsIssue301');
            expect(oRoute).toBeDefined();
            expect(oRoute.pattern).toBe('wm/goods-issue/plant-transfer-301:?query:');
            expect(oRoute.target).toBe('TargetGoodsIssue301');
        });

        test('registers TargetGoodsIssue301Pending pointing to GoodsIssue301Pending view', () => {
            const oTarget = oTargets.TargetGoodsIssue301Pending;
            expect(oTarget).toBeDefined();
            expect(oTarget.name).toBe('GoodsIssue301Pending');
            expect(oTarget.path).toBe('saps4hana.fiori.modules.wm.goods-issue.view');
        });
    });
});
