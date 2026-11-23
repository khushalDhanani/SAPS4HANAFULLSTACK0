'use strict';

/**
 * Decommission guard: the Goods Receipt feature (movement 101) was removed on 2026-11-21.
 * These checks fail if any part of it comes back: API, model, UI route, source files, timers.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cds = require('@sap/cds');

const { axios } = cds.test(__dirname + '/../../');
const ROOT = path.join(__dirname, '../..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const OPTIONS = { auth: { username: 'khushal', password: '' }, validateStatus: () => true };
const call = (method, url, data) => (method === 'post' ? axios.post(url, data, OPTIONS) : axios.get(url, OPTIONS));

describe('Goods Receipt is decommissioned', () => {
  describe('CAP API', () => {
    it.each([
      ['get', '/odata/v4/goods-receipt/'],
      ['get', '/odata/v4/goods-receipt/$metadata'],
      ['get', '/odata/v4/goods-receipt/OpenInboundDeliveries'],
      ['get', '/odata/v4/goods-receipt/MaterialStorageLocations'],
      ['get', '/odata/v4/goods-receipt/MaterialBatches'],
      ['get', "/odata/v4/goods-receipt/getStorageUnitDetails(StorageUnit='1')"],
      ['post', '/odata/v4/goods-receipt/postGoodsReceipt'],
      ['post', '/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit']
    ])('%s %s is not served', async (method, url) => {
      const res = await call(method, url, method === 'post' ? {} : undefined);

      expect(res.status).toBe(404);
    });

    it('no served service has a goods-receipt path or a Goods Receipt operation', () => {
      const services = cds.services ? Object.values(cds.services) : [];
      const paths = services.map((s) => s.path).filter(Boolean);
      const model = cds.model.definitions;
      const own = Object.keys(model).filter((name) => !/_SRV(\.|$)/.test(name));

      expect(paths.filter((p) => /goods-?receipt/i.test(p))).toEqual([]);
      expect(own.filter((name) => /goods.?receipt|OpenInboundDeliveries|MaterialStorageLocations|MaterialBatches|getStorageUnitDetails/i.test(name))).toEqual([]);
    });

    it('other services are still served', async () => {
      for (const service of ['purchase-order', 'sales-inquiry', 'sales-order', 'customer-invoice', 'customer-return', 'outbound-delivery',
        'handling-unit', 'packing-instruction', 'quarantine-label', 'mib-label', 'user-management']) {
        const res = await call('get', `/odata/v4/${service}/$metadata`);
        expect([service, res.status]).toEqual([service, 200]);
      }
    });
  });

  describe('persistence model', () => {
    it('has no posting-attempt entity, and keeps the administrator monitoring entities', () => {
      const names = Object.keys(cds.model.definitions);

      expect(names.filter((n) => /PostingAttempt/i.test(n))).toEqual([]);
      expect(names).toEqual(expect.arrayContaining(['saps4hana.admin.UserLockMonitor', 'saps4hana.admin.UserLockNotification', 'saps4hana.admin.PasswordExpiryMonitor']));
    });
  });

  describe('frontend', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/manifest.json'), 'utf8'));
    const ui5 = manifest['sap.ui5'];

    it('has no Goods Receipt data source, model, route or target', () => {
      const text = JSON.stringify(manifest);

      expect(Object.keys(manifest['sap.app'].dataSources).filter((k) => /goodsReceipt/i.test(k))).toEqual([]);
      expect(Object.keys(ui5.models).filter((k) => /goodsReceipt/i.test(k))).toEqual([]);
      expect(ui5.routing.routes.filter((r) => /goods-?receipt/i.test(`${r.name} ${r.pattern}`))).toEqual([]);
      expect(Object.keys(ui5.routing.targets).filter((k) => /goodsReceipt/i.test(k))).toEqual([]);
      expect(text).not.toMatch(/goods-receipt/i);
    });

    it('has no Goods Receipt tile or navigation on the dashboard', () => {
      const view = fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/view/Dashboard.view.xml'), 'utf8');
      const controller = fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/controller/Dashboard.controller.js'), 'utf8');

      expect(view).not.toMatch(/GoodsReceipt/i);
      expect(controller).not.toMatch(/GoodsReceipt/i);
    });

    it('every route target still points at a view that exists', () => {
      for (const [name, target] of Object.entries(ui5.routing.targets)) {
        const base = String(target.path || target.viewPath || ui5.routing.config.path || ui5.routing.config.viewPath).replace(/^saps4hana\.fiori\.?/, '').split('.').join('/');
        const file = path.join(ROOT, 'app/fiori-app/webapp', base, `${target.name || target.viewName}.view.xml`);
        expect([name, fs.existsSync(file)]).toEqual([name, true]);
      }
    });
  });

  describe('source tree', () => {
    it('tracks no Goods Receipt source, test or tool file outside the documentation', () => {
      const left = tracked.filter((f) => /goods-?receipt|gr-su-post/i.test(f) && !f.startsWith('docs/') && f !== 'test/integration/goodsReceiptDecommissioned.test.js');

      expect(left).toEqual([]);
    });

    it('no application code imports a Goods Receipt module or calls its SAP posting interfaces', () => {
      const code = tracked.filter((f) => /^(srv|app\/fiori-app\/webapp|db|server\.js)/.test(f) && /\.(js|cds|xml|json)$/.test(f) && !f.startsWith('srv/external/') && !f.includes('/thirdparty/'));
      const hits = [];
      for (const file of code) {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (/goods-receipt\/|GoodsReceipt(Adapter|AttemptStore|RecheckService|Service)\b|BAPI_INB_DELIVERY_CONFIRM_DEC|MMIM_GR4PO_DL_SRV|postGoodsReceipt|RECEIPT_RECHECK/.test(text)) hits.push(file);
      }

      expect(hits).toEqual([]);
    });
  });

  describe('background processing', () => {
    it('starts no recheck timer and has no service module that could start one', () => {
      expect(fs.existsSync(path.join(ROOT, 'srv/wm/goods-receipt'))).toBe(false);
      const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
      expect(serverJs).not.toMatch(/recheck|GoodsReceipt/i);
    });
  });
});
