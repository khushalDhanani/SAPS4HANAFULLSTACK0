'use strict';

const fs = require('fs');
const path = require('path');
const { realBlockSubmit } = require('../helpers/realBlockSubmit');

const WEBAPP = path.join(__dirname, '../../../app/fiori-app/webapp');
const block = realBlockSubmit();
const NOTE = 'NOTE';
const controller = { getText: (key, _args, fallback) => (key === 'msgSubmitBlockedNotConfirmed' && fallback ? NOTE : key) };
const model = () => { const data = {}; return { data, setProperty: (p, v) => { data[p] = v; } }; };

describe('BaseController.blockSubmitIfNotConfirmed', () => {
  // The exact wording the server sends: if one changes, a form silently stops blocking.
  it.each([
    ['an unanswered write', 'SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again.'],
    ['a customer return', 'SAP created customer return 4500099, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.'],
    ['a packing instruction', "SAP accepted packing instruction 'BOX1' (PI-1), but it could not be read back, so it is NOT confirmed. Check it in SAP before creating it again."],
    ['a handling unit', 'Create handling unit: SAP may have saved this change to handling unit 2000020166, but it could not be read back, so it is NOT confirmed. Check it in SAP before trying again.'],
    ['a failed commit', 'SAP created inquiry 0001500200 but the commit failed: Update terminated. Check it in SAP before creating it again.'],
    ['a partly created inquiry', 'Sales Inquiry 1000529 was created in SAP S/4HANA, but adding item 000010 failed: blocked. Do not retry: check or complete it in SAP.']
  ])('turns submit off and adds the note after %s', (_name, message) => {
    const m = model();

    expect(block.call(controller, m, message)).toBe(`${message}\n\n${NOTE}`);
    expect(m.data['/submitBlocked']).toBe(true);
  });

  it.each([
    ['a business error', 'Supplier is blocked for purchasing'],
    ['a changed document', 'The document was changed by another user'],
    ['nothing was posted', 'The plant of delivery 1 could not be read from SAP; nothing was posted (NOT posted). Try again.'],
    ['no message', undefined]
  ])('leaves submit on after %s', (_name, message) => {
    const m = model();

    expect(block.call(controller, m, message)).toBeNull();
    expect(m.data['/submitBlocked']).toBeUndefined();
  });

  it('has the note in both text files', () => {
    for (const file of ['i18n.properties', 'i18n_en.properties']) {
      expect(fs.readFileSync(path.join(WEBAPP, 'i18n', file), 'utf8')).toMatch(/^msgSubmitBlockedNotConfirmed=\S/m);
    }
  });

  it.each([
    ['modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml', 'newPO', 1],
    ['modules/sd/sales-inquiry/view/CreateSalesInquiry.view.xml', 'newInquiry', 1],
    ['modules/sd/sales-order/view/CreateSalesOrder.view.xml', 'newOrder', 1],
    ['modules/sd/customer-return/view/CreateCustomerReturn.view.xml', 'createReturnModel', 2],
    ['modules/wm/packing-instruction/view/CreatePackingInstructionDialog.fragment.xml', 'piCreate', 1],
    ['modules/wm/handling-unit/view/CreateHandlingUnitDialog.fragment.xml', 'huCreate', 1],
    ['modules/le/outbound-delivery/view/CreateDeliveryNoRefDialog.fragment.xml', 'deliveryNoRefDialog', 1]
  ])('%s turns its submit button off from the %s model', (file, name, count) => {
    const xml = fs.readFileSync(path.join(WEBAPP, file), 'utf8');

    expect(xml.split(`!${'$'}{${name}>/submitBlocked}`).length - 1).toBe(count);
  });
});

describe('Packing instruction dialog after a not-confirmed answer', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const notConfirmed = "SAP accepted packing instruction 'BOX1' (PI-1), but it could not be read back, so it is NOT confirmed. Check it in SAP before creating it again.";
  let proto;
  const odata = { post: jest.fn(), get: jest.fn() };

  beforeAll(() => {
    const file = path.join(WEBAPP, 'modules/wm/packing-instruction/controller/PackingInstructions.controller.js');
    const sap = { ui: { define: (_deps, factory) => factory({ extend: (_n, p) => { proto = p; return p; } }, function JSONModel() {}, odata, {}, { show: jest.fn() }) } };
    new Function('sap', fs.readFileSync(file, 'utf8'))(sap); // eslint-disable-line no-new-func
  });

  it('shows the warning, turns submit off, and a second press sends nothing', async () => {
    const data = { externalName: 'BOX1', weightUnit: 'KG', pkgMaterial: '2000000041', pkgQty: 1, pkgUnit: 'NOS', materials: [] };
    const form = { getData: () => data, getProperty: (p) => data[p.slice(1)], setProperty: (p, v) => { data[p.slice(1)] = v; } };
    const c = Object.assign(Object.create(proto), { getModel: () => form, getText: (_k, _a, fallback) => fallback || _k, blockSubmitIfNotConfirmed: realBlockSubmit() });
    odata.post.mockRejectedValueOnce(new Error(notConfirmed));

    c.onSubmitCreate();
    await flush();

    expect(data.submitBlocked).toBe(true);
    expect(data.error).toContain(notConfirmed);
    expect(data.error).toContain('Create is turned off');

    c.onSubmitCreate();

    expect(odata.post).toHaveBeenCalledTimes(1);
  });
});
