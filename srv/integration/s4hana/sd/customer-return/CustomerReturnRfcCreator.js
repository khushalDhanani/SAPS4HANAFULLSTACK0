'use strict';

const LOG = require('../../../../common/logger')('customer-return-rfc');
const { RfcClient } = require('../../RfcClient');
const { failure, clean, sapDate, partnerNumber, materialNumber, documentNumber, todaySap, runCreateBapi } = require('../salesDocBapi');

/**
 * Creates a customer return through the remote-enabled BAPI_CUSTOMERRETURN_CREATE.
 * LORD_ODATA_ORDER_SRV (the app's current route) has no field for the order reason, the reference document or the
 * storage location, so a return created through it lacks them (SAP requires the order reason for ZRET). This BAPI
 * carries them: header ORD_REASON / REF_DOC / REFDOC_CAT, item PLANT / STORE_LOC / REF_DOC / REF_DOC_IT / REF_DOC_CA.
 *
 * Interface and field names were read from the live dictionary (FUPARAREF / DD03L) on 2026-10-29. NOT yet verified by a
 * TESTRUN: the schedule line (quantity travels in it), the partner roles, and whether the defaults for currency /
 * exchange-rate type / pricing date make the return complete.
 */

const BAPI = 'BAPI_CUSTOMERRETURN_CREATE';
// Pricing type for items copied from a reference document (BAPISDLS-PRICING, domain KNPRS). Copy control (TVCPA, ZTAM -> ZREN) says 'D'
// (copy price elements unchanged), but the BAPI itself refused it live on 2026-10-29 ("D is not allowed for LOGIC_SWITCH-PRICING"), so 'G'
// (copy price elements unchanged and redetermine taxes) is used: UNVERIFIED until a live save; 'B' (new pricing) is the other candidate.
const REFERENCE_PRICING = 'G';
const isBlankKey = (v) => /^0*$/.test(clean(v)); // the UI sends item reference '0' / '000000' when there is none

/** Header fields -> [BAPI field, value]; blank values are not sent and get no update flag. */
function headerFields(p, salesArea, returnType) {
    return [
        ['DOC_TYPE', returnType],
        ['SALES_ORG', clean(salesArea.salesOrganization)],
        ['DISTR_CHAN', clean(salesArea.distributionChannel)],
        ['DIVISION', clean(salesArea.division)],
        ['ORD_REASON', clean(p.ReturnsOrderReason)],
        ['REF_DOC', documentNumber(p.ReferenceSDDocument)],
        ['REFDOC_CAT', clean(p.ReferenceSDDocumentCategory)],
        ['PURCH_NO_C', clean(p.PurchaseOrderByCustomer)],
        ['DOC_DATE', sapDate(p.CustomerReturnDate, 'CustomerReturnDate')]
    ].filter(([, v]) => v !== '');
}

/**
 * @param {object} payload the createCustomerReturn payload (CAP action data, with CustomerReturnType resolved)
 * @param {{ salesOrganization, distributionChannel, division }} salesArea the sales area resolved for the sold-to party
 */
function buildInput(payload, salesArea) {
    if (!payload || typeof payload !== 'object') throw failure('Customer return data is required for the return BAPI', 400);
    if (!clean(payload.SoldToParty)) throw failure('SoldToParty is required for the return BAPI (partner role AG)', 400);
    if (!clean(payload.ReturnsOrderReason)) throw failure('ReturnsOrderReason is required for the return BAPI (SAP: order reason is mandatory for ZRET)', 400);
    const returnType = clean(payload.CustomerReturnType);
    if (!returnType) throw failure('CustomerReturnType is required for the return BAPI', 400);
    const items = Array.isArray(payload.Items) ? payload.Items.filter((it) => it && clean(it.Material)) : [];
    if (items.length === 0) throw failure('At least one item with a Material is required for the return BAPI', 400);
    if (!salesArea || !clean(salesArea.salesOrganization)) throw failure('The sales area is required for the return BAPI', 400);

    const fields = headerFields(payload, salesArea, returnType);
    const docDate = sapDate(payload.CustomerReturnDate, 'CustomerReturnDate') || todaySap();
    const headerRef = documentNumber(payload.ReferenceSDDocument);
    const headerCat = clean(payload.ReferenceSDDocumentCategory);

    const itemsIn = [];
    const itemsInx = [];
    const schedules = [];
    items.forEach((it, i) => {
        const itm = String((i + 1) * 10).padStart(6, '0');
        const qty = Number(it.OrderQuantity);
        if (!(qty > 0)) throw failure(`OrderQuantity must be greater than 0 for item ${itm}`, 400);
        const unit = clean(it.OrderQuantityUnit).toUpperCase();
        if (!unit) throw failure(`OrderQuantityUnit is required for item ${itm}`, 400);
        const plant = clean(it.ProductionPlant || it.Plant).toUpperCase();
        if (!plant) throw failure(`Plant is required for item ${itm}`, 400);
        // An item reason that differs from the header reason has no verified BAPI field: refuse instead of dropping it
        if (clean(it.ReturnReason) && clean(it.ReturnReason) !== clean(payload.ReturnsOrderReason)) {
            throw failure(`Item ${itm}: a return reason that differs from the header reason cannot be sent by the return BAPI route yet; nothing was created`, 400);
        }
        const row = { ITM_NUMBER: itm, MATERIAL_LONG: materialNumber(it.Material), PLANT: plant, SALES_UNIT: unit };
        if (clean(it.StorageLocation)) row.STORE_LOC = clean(it.StorageLocation).toUpperCase();
        const refDoc = documentNumber(it.ReferenceSDDocument) || headerRef;
        if (refDoc) {
            row.REF_DOC = refDoc;
            if (!isBlankKey(it.ReferenceSDDocumentItem)) row.REF_DOC_IT = clean(it.ReferenceSDDocumentItem).padStart(6, '0');
            if (headerCat) row.REF_DOC_CA = headerCat;
        }
        itemsIn.push(row);
        const flags = { ITM_NUMBER: itm, UPDATEFLAG: 'I' };
        Object.keys(row).filter((k) => k !== 'ITM_NUMBER').forEach((k) => { flags[k] = 'X'; });
        itemsInx.push(flags);
        // The quantity of an SD item travels in its dated schedule line (VBEP), as on the complete reference documents
        schedules.push({ ITM_NUMBER: itm, SCHED_LINE: '0001', REQ_DATE: docDate, REQ_QTY: qty });
    });

    const referenced = Boolean(headerRef) || itemsIn.some((r) => r.REF_DOC);
    return {
        ...(referenced ? { LOGIC_SWITCH: { PRICING: REFERENCE_PRICING } } : {}),
        RETURN_HEADER_IN: Object.fromEntries(fields),
        RETURN_HEADER_INX: { UPDATEFLAG: 'I', ...Object.fromEntries(fields.map(([k]) => [k, 'X'])) },
        RETURN_PARTNERS: [{ PARTN_ROLE: 'AG', PARTN_NUMB: partnerNumber(payload.SoldToParty) }],
        RETURN_ITEMS_IN: itemsIn,
        RETURN_ITEMS_INX: itemsInx,
        RETURN_SCHEDULES_IN: schedules,
        RETURN_SCHEDULES_INX: schedules.map((s) => ({ ITM_NUMBER: s.ITM_NUMBER, SCHED_LINE: s.SCHED_LINE, UPDATEFLAG: 'I', REQ_DATE: 'X', REQ_QTY: 'X' }))
    };
}

class CustomerReturnRfcCreator {
    constructor(options = {}) {
        this.rfc = options.rfc || new RfcClient();
    }

    /** @returns {Promise<{ CustomerReturn?: string, testRun: boolean, messages: object[] }>} testRun = BAPI simulation, never committed */
    async create(payload, salesArea, { testRun = false } = {}) {
        const input = buildInput(payload, salesArea);
        const out = await runCreateBapi(this.rfc, BAPI, input, {
            testRun, log: LOG, labels: { noun: 'customer return', partialName: 'PartialCustomerReturnError', keyProp: 'CustomerReturn' }
        });
        return out.testRun ? out : { CustomerReturn: out.documentNumber, testRun: false, messages: out.messages };
    }

    /** What SAP stored for the document (VBAK header + VBAP items), for the caller's persistence check. */
    async readBack(docNo) {
        const vbeln = clean(docNo).padStart(10, '0');
        const [head] = await this.rfc.readTable('VBAK', ['VBELN', 'AUART', 'AUGRU', 'KUNNR', 'VGBEL'], [`VBELN = '${vbeln}'`], 1);
        if (!head) return null;
        const items = await this.rfc.readTable('VBAP', ['POSNR', 'MATNR', 'KWMENG', 'VRKME', 'WERKS', 'LGORT', 'VGBEL', 'VGPOS'], [`VBELN = '${vbeln}'`], 50);
        return { header: head, items };
    }
}

module.exports = { CustomerReturnRfcCreator, buildInput, BAPI };
