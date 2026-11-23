const LOG = require('../../../../common/logger')('customer-return-adapter');
const { mapS4Error } = require('../../S4ErrorMapper');
const { sapKey } = require('../../sapKey');
const { resolveCustomerSalesArea } = require('../customerSalesArea');
const { CustomerReturnRfcCreator } = require('./CustomerReturnRfcCreator');
const {
  TRANSACTIONAL_SERVICE_PATH,
  DEFAULT_RETURN_TYPE,
  MAX_READBACK_ATTEMPTS,
  READBACK_DELAYS_MS,
  _cleanOptions,
  _sleep,
  _unconfirmedReturn,
  _sameNumber
} = require('./customerReturnUtils');

class CustomerReturnWriter {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter?.client;
  }

  get rfc() {
    return this.adapter?.rfc;
  }

  async getCustomerReturn(customerReturn, options) {
    if (this.adapter && typeof this.adapter.getCustomerReturn === 'function') {
      return this.adapter.getCustomerReturn(customerReturn, options);
    }
    throw new Error('getCustomerReturn is not available on adapter');
  }

  /**
   * Creates a Customer Return document in S/4HANA via transactional LORD_ODATA_ORDER_SRV
   * (Lean Order framework) deep insert, then confirms persistence via direct readback from SD_F2651_CRT_CREATE_SRV.
   *
   * @param {Object} payload
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async createCustomerReturn(payload = {}, options = {}) {
    if (!payload.SoldToParty) {
      const err = new Error('SoldToParty is mandatory for Customer Return creation');
      err.code = 400;
      throw err;
    }
    if (!payload.ReturnsOrderReason) {
      const err = new Error('ReturnsOrderReason is mandatory for Customer Return creation');
      err.code = 400;
      throw err;
    }

    const cleanOpts = _cleanOptions(options);
    const returnType = payload.CustomerReturnType || DEFAULT_RETURN_TYPE;

    // 1. Build Deep Items for LORD_ODATA_ORDER_SRV
    const rawItems = Array.isArray(payload.Items) && payload.Items.length > 0
      ? payload.Items
      : [{ Material: payload.Material, OrderQuantity: payload.OrderQuantity, OrderQuantityUnit: payload.OrderQuantityUnit, ProductionPlant: payload.ProductionPlant }];

    // Every org/business value must come from the caller (resolved upstream); nothing is assumed here.
    const missing = (what) => { const e = new Error(`${what} is required to create a Customer Return; no default is assumed`); e.code = 400; e.status = 400; throw e; };
    const deepItems = rawItems.filter(it => it && it.Material).map(it => {
      const material = String(it.Material).trim();
      const plant = String(it.ProductionPlant || it.Plant || '').trim();
      if (!plant) missing(`Plant for item ${material}`);
      if (!(Number(it.OrderQuantity) > 0)) missing(`Order quantity for item ${material}`);
      if (!String(it.OrderQuantityUnit || '').trim()) missing(`Order quantity unit for item ${material}`);
      const itemObj = {
        MaterialID: material,
        OrderQty: String(it.OrderQuantity),
        SalesUnit: String(it.OrderQuantityUnit).trim(),
        Plant: plant
      };
      if (it.UnitPrice && !isNaN(Number(it.UnitPrice))) {
        if (!String(it.Currency || '').trim()) missing(`Currency for the unit price of item ${material}`);
        itemObj.PriceCondSet = [
          {
            CondTypeCode: 'ZPR1', // shortcut: condition type still hard-coded, resolve via BusinessConfigResolver.conditionType in Phase 2 step 2
            AmountInternal: String(it.UnitPrice),
            RateUnitExternal: String(it.Currency).trim()
          }
        ];
      }
      return itemObj;
    });

    if (deepItems.length === 0) {
      const err = new Error('At least one line item with a Material is required to create a Customer Return');
      err.code = 400;
      throw err;
    }

    // Plants must exist in SAP (T001W); the sales area must be one maintained for the customer (KNVV). Read-only.
    for (const plant of new Set(deepItems.map((it) => it.Plant))) {
      let t001w;
      try {
        t001w = await this.rfc.readTable('T001W', ['WERKS'], [`WERKS = '${sapKey(plant, 'plant', 'Plant')}'`], 1);
      } catch (e) {
        if (e.status === 400) throw Object.assign(e, { code: 400 });
        throw Object.assign(new Error(`Plant ${plant} could not be verified in SAP (T001W): ${e.message}`), { status: 502, code: 502, cause: e });
      }
      if (!t001w || !t001w.length) { const e = new Error(`Plant ${plant} does not exist in SAP (T001W)`); e.status = 400; e.code = 400; throw e; }
    }
    const salesArea = await resolveCustomerSalesArea(this.rfc, payload.SoldToParty, {
      salesOrganization: payload.SalesOrganization,
      distributionChannel: payload.DistributionChannel,
      division: payload.OrganizationDivision
    });

    // 2. Assemble Deep Insert Payload for Lean Order Framework
    const deepPayload = {
      SalesOrderTypeCode: returnType,
      SalesOrganization: salesArea.salesOrganization,
      DistributionChannel: salesArea.distributionChannel,
      Division: salesArea.division,
      SoldToPartyID: String(payload.SoldToParty).trim(),
      PurchaseOrderNumber: payload.PurchaseOrderByCustomer
        ? String(payload.PurchaseOrderByCustomer).trim()
        : `RET-${Date.now().toString().slice(-6)}`,
      ItemSet: deepItems
    };

    if (payload.CustomerReturnDate) {
      const d = new Date(payload.CustomerReturnDate);
      if (!isNaN(d.getTime())) {
        deepPayload.PurchaseOrderDate = `/Date(${d.getTime()})/`;
        deepPayload.RequestedDeliveryDate = `/Date(${d.getTime()})/`;
      }
    }

    const endpoint = `${TRANSACTIONAL_SERVICE_PATH}/HeaderSet`;

    try {
      LOG.info(`Creating Customer Return via LORD_ODATA_ORDER_SRV deep insert: POST ${endpoint}`, deepPayload);

      const response = await this.client.post(endpoint, { data: deepPayload }, cleanOpts);
      const createdHeader = response?.data?.d || response?.data;
      const returnNumber = String(createdHeader?.SalesOrderID || '').trim();

      if (!returnNumber) {
        const error = new Error('Sales Order / Customer Return number not returned from SAP S/4HANA');
        error.code = 502;
        throw error;
      }

      LOG.info(`Customer Return successfully created in S/4HANA with document number: ${returnNumber}`);

      // 3. Mandatory Readback Loop: Confirm Real S/4HANA Database Persistence from SD_F2651_CRT_CREATE_SRV
      let verifiedDoc = null;
      for (let attempt = 0; attempt < MAX_READBACK_ATTEMPTS; attempt++) {
        const delay = READBACK_DELAYS_MS[attempt];
        if (delay > 0) await _sleep(delay);

        try {
          verifiedDoc = await this.getCustomerReturn(returnNumber, cleanOpts);
          if (verifiedDoc && _sameNumber(verifiedDoc.CustomerReturn, returnNumber)) {
            LOG.info(`Customer Return ${returnNumber} verified in S/4HANA database (attempt ${attempt + 1})`);
            break;
          }
        } catch (readErr) {
          LOG.warn(`Readback attempt ${attempt + 1} failed for ${returnNumber}: ${readErr.message}`);
        }
      }

      if (!verifiedDoc || !_sameNumber(verifiedDoc.CustomerReturn, returnNumber)) {
        throw _unconfirmedReturn(`SAP created customer return ${returnNumber}, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.`, returnNumber);
      }

      const totalNet = verifiedDoc?.TotalNetAmount ?? (createdHeader?.TotalAmount ? Number(createdHeader.TotalAmount) : (createdHeader?.NetAmount ? Number(createdHeader.NetAmount) : null));
      const currency = verifiedDoc?.TransactionCurrency || createdHeader?.DocumentCurrency || null; // document already exists in SAP: report what SAP returned, never invent a currency

      return {
        CustomerReturn: returnNumber,
        CustomerReturnType: returnType,
        SoldToParty: deepPayload.SoldToPartyID,
        TotalNetAmount: totalNet,
        TransactionCurrency: currency,
        Success: true,
        Message: `Customer Return ${returnNumber} successfully created and verified in SAP S/4HANA.`
      };
    } catch (err) {
      if (err.code === 400 || err.code === 403 || err.code === 502) {
        throw err;
      }
      LOG.error(`Failed to create Customer Return in S/4HANA`, err);
      throw mapS4Error(err, 'Failed to create Customer Return in S/4HANA');
    }
  }

  /**
   * Creates a customer return through BAPI_CUSTOMERRETURN_CREATE (RFC) and checks in SAP what was stored.
   *
   * @param {Object} payload
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async createCustomerReturnViaRfc(payload = {}, options = {}) {
    const bad = (message) => { const e = new Error(message); e.code = 400; e.status = 400; return e; };
    if (!payload.SoldToParty) throw bad('SoldToParty is mandatory for Customer Return creation');
    if (!payload.ReturnsOrderReason) throw bad('ReturnsOrderReason is mandatory for Customer Return creation');

    const returnType = payload.CustomerReturnType || DEFAULT_RETURN_TYPE;
    const items = (Array.isArray(payload.Items) && payload.Items.length > 0
      ? payload.Items
      : [{ Material: payload.Material, OrderQuantity: payload.OrderQuantity, OrderQuantityUnit: payload.OrderQuantityUnit, ProductionPlant: payload.ProductionPlant }]
    ).filter((it) => it && it.Material);
    if (items.length === 0) throw bad('At least one line item with a Material is required to create a Customer Return');

    // Plants must exist in SAP (T001W); the sales area must be one maintained for the customer (KNVV). Read-only.
    for (const plant of new Set(items.map((it) => String(it.ProductionPlant || it.Plant || '').trim()).filter(Boolean))) {
      const t001w = await this.rfc.readTable('T001W', ['WERKS'], [`WERKS = '${sapKey(plant, 'plant', 'Plant')}'`], 1);
      if (!t001w || !t001w.length) throw bad(`Plant ${plant} does not exist in SAP (T001W)`);
    }
    const salesArea = await resolveCustomerSalesArea(this.rfc, payload.SoldToParty, {
      salesOrganization: payload.SalesOrganization,
      distributionChannel: payload.DistributionChannel,
      division: payload.OrganizationDivision
    });

    const creator = options.creator || new CustomerReturnRfcCreator({ rfc: this.rfc });
    const full = { ...payload, CustomerReturnType: returnType, Items: items };
    const created = await creator.create(full, salesArea, { testRun: options.testRun === true });
    if (created.testRun) return created;

    const stored = await creator.readBack(created.CustomerReturn);
    const partial = (message) => _unconfirmedReturn(message, created.CustomerReturn);
    if (!stored) throw partial(`SAP committed customer return ${created.CustomerReturn}, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.`);

    // Persistence check: everything the user entered that the BAPI route is meant to carry must be in SAP
    const missing = [];
    const sameKey = (a, b) => String(a || '').trim().replace(/^0+/, '') === String(b || '').trim().replace(/^0+/, '');
    if (String(stored.header.AUGRU || '').trim() !== String(payload.ReturnsOrderReason).trim()) missing.push(`order reason (stored "${String(stored.header.AUGRU || '').trim()}")`);
    const item = stored.items[0] || {};
    const wantItem = items[0];
    const wantRef = String(wantItem.ReferenceSDDocument || payload.ReferenceSDDocument || '').trim();
    if (wantRef && !sameKey(item.VGBEL || stored.header.VGBEL, wantRef)) missing.push(`reference document ${wantRef}`);
    const wantSloc = String(wantItem.StorageLocation || '').trim().toUpperCase();
    if (wantSloc && String(item.LGORT || '').trim().toUpperCase() !== wantSloc) missing.push(`storage location ${wantSloc}`);
    if (missing.length) throw partial(`SAP created customer return ${created.CustomerReturn}, but did not store: ${missing.join(', ')}`);

    let net = null;
    let currency = null;
    try {
      const doc = await this.getCustomerReturn(String(created.CustomerReturn).replace(/^0+/, ''), _cleanOptions(options));
      net = doc && doc.TotalNetAmount !== undefined ? doc.TotalNetAmount : null;
      currency = (doc && doc.TransactionCurrency) || null;
    } catch (e) {
      LOG.warn(`Totals of customer return ${created.CustomerReturn} could not be read: ${e.message}`);
    }
    // The BAPI returns the 10-digit number (0004500185); CAP keys and the UI use it without leading zeros, as the Lean Order route did
    const number = String(created.CustomerReturn).replace(/^0+/, '');
    return {
      CustomerReturn: number,
      CustomerReturnType: returnType,
      SoldToParty: String(payload.SoldToParty).trim(),
      TotalNetAmount: net,
      TransactionCurrency: currency,
      Success: true,
      Message: `Customer Return ${number} successfully created and verified in SAP S/4HANA.`
    };
  }
}

module.exports = CustomerReturnWriter;
