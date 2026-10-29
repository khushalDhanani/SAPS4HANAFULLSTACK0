'use strict';

const LOG = require('../../../../common/logger')('sales-inquiry-rfc');
const { RfcClient } = require('../../RfcClient');

/**
 * Creates a sales inquiry through the remote-enabled BAPI_INQUIRY_CREATEFROMDATA2.
 * The Lean Order OData service (LORD_ODATA_ORDER_SRV) refuses inquiry document types on this system
 * ("does not belong to group 'Sales Order'"), so inquiries need this function module.
 *
 * One RFC session = one LUW: BAPI call, RETURN check, then COMMIT (WAIT) or ROLLBACK. The new document is read back
 * from VBAK before success is reported. Interface and field names were read from the live dictionary (FUPARAREF /
 * DD03L) on 2026-10-29; the schedule line below and the partner roles AG / WE are NOT verified against a TESTRUN yet.
 */

const BAPI = 'BAPI_INQUIRY_CREATEFROMDATA2';
// Domain fields the BAPI interface has no confirmed field for: refuse instead of dropping them silently.
// Schedule line category of the complete inquiry 1500124 (VBEP-ETTYP). UNVERIFIED as the right default for every inquiry:
// it should come from the item category's schedule line determination once confirmed by a TESTRUN.
const SCHEDULE_LINE_CATEGORY = 'AT';
const UNSUPPORTED_HEADER_FIELDS = ['PortOfLoading', 'PortOfDischarge', 'ContactPerson'];

function failure(message, status, extra = {}) {
    return Object.assign(new Error(message), { status }, extra);
}

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** 'YYYY-MM-DD' (or 'YYYYMMDD') -> 'YYYYMMDD'; '' stays ''. */
function sapDate(value, label) {
    const v = clean(value);
    if (!v) return '';
    const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
    if (!m) throw failure(`${label} is not a date: ${v}`, 400);
    return `${m[1]}${m[2]}${m[3]}`;
}

/** Customer / partner numbers are stored with leading zeros (VBPA KUNNR 0000020004). */
const partnerNumber = (v) => (/^\d+$/.test(clean(v)) ? clean(v).padStart(10, '0') : clean(v));
/** Numeric materials are stored 18 digits wide (VBAP MATNR 000000004000000033). */
const materialNumber = (v) => (/^\d+$/.test(clean(v)) ? clean(v).padStart(18, '0') : clean(v));

/** Header fields -> [BAPI field, value]; blank values are not sent and get no update flag. */
function headerFields(h) {
    return [
        ['DOC_TYPE', clean(h.SalesInquiryType)],
        ['SALES_ORG', clean(h.SalesOrganization)],
        ['DISTR_CHAN', clean(h.DistributionChannel)],
        ['DIVISION', clean(h.OrganizationDivision)],
        ['CURRENCY', clean(h.TransactionCurrency).toUpperCase()],
        ['SALES_OFF', clean(h.SalesOffice)],
        ['SALES_GRP', clean(h.SalesGroup)],
        ['PURCH_NO_C', clean(h.PurchaseOrderByCustomer)],
        ['PURCH_DATE', sapDate(h.CustomerPurchaseOrderDate, 'CustomerPurchaseOrderDate')],
        ['DOC_DATE', sapDate(h.SalesInquiryDate, 'SalesInquiryDate')],
        ['QT_VALID_F', sapDate(h.BindingPeriodValidityStartDate, 'BindingPeriodValidityStartDate')],
        ['QT_VALID_T', sapDate(h.BindingPeriodValidityEndDate, 'BindingPeriodValidityEndDate')],
        ['PMNTTRMS', clean(h.PaymentTerms || h.PaymentTermCode)],
        ['INCOTERMS1', clean(h.INCO1 || h.Incoterms)],
        ['INCOTERMS2L', clean(h.INCO2_L || h.IncotermsLocation1)],
        ['CUST_GRP2', clean(h.CustomerGroup2)]
    ].filter(([, v]) => v !== '');
}

/** The BAPI tables / structures for one inquiry (header, update flags, partners, items, schedule lines). */
function buildInput(header, items) {
    if (!header || typeof header !== 'object') throw failure('Header data is required for the inquiry BAPI', 400);
    if (!Array.isArray(items) || items.length === 0) throw failure('At least one item is required for the inquiry BAPI', 400);
    const unsupported = UNSUPPORTED_HEADER_FIELDS.filter((f) => clean(header[f]) !== '');
    if (unsupported.length) {
        throw failure(`${unsupported.join(', ')} cannot be sent to SAP by the inquiry BAPI route yet (no verified BAPI field); nothing was created`, 400);
    }
    if (!clean(header.SoldToParty)) throw failure('SoldToParty is required for the inquiry BAPI (partner role AG)', 400);

    const fields = headerFields(header);
    ['DOC_TYPE', 'SALES_ORG', 'DISTR_CHAN', 'DIVISION'].forEach((f) => {
        if (!fields.some(([k]) => k === f)) throw failure(`${f} is required for the inquiry BAPI`, 400);
    });

    const partners = [{ PARTN_ROLE: 'AG', PARTN_NUMB: partnerNumber(header.SoldToParty) }];
    if (clean(header.ShipToParty)) partners.push({ PARTN_ROLE: 'WE', PARTN_NUMB: partnerNumber(header.ShipToParty) });

    const scheduleDate = sapDate(header.SalesInquiryDate, 'SalesInquiryDate') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const itemsIn = [];
    const itemsInx = [];
    const schedules = [];
    items.forEach((item, i) => {
        const itm = (clean(item.SalesInquiryItem) || String((i + 1) * 10)).padStart(6, '0');
        const qty = Number(item.OrderQuantity);
        if (!(qty > 0)) throw failure(`OrderQuantity must be greater than 0 for item ${itm}`, 400);
        const unit = clean(item.OrderQuantityUnit).toUpperCase();
        if (!unit) throw failure(`OrderQuantityUnit is required for item ${itm}`, 400);
        if (!clean(item.Material)) throw failure(`Material is required for item ${itm}`, 400);

        // Variant #4 (mirrors complete inquiry 1500124: ZMENG = 0, VRKME = KG, quantity only in the schedule line): the unit is the
        // item's SALES_UNIT (BAPISDITM / BAPISDITMX both have it) and there is no TARGET_QTY / TARGET_QU.
        const row = { ITM_NUMBER: itm, MATERIAL_LONG: materialNumber(item.Material), SALES_UNIT: unit };
        if (clean(item.Plant)) row.PLANT = clean(item.Plant).toUpperCase();
        if (clean(item.SalesInquiryItemText)) row.SHORT_TEXT = clean(item.SalesInquiryItemText);
        itemsIn.push(row);
        const flags = { ITM_NUMBER: itm, UPDATEFLAG: 'I' };
        Object.keys(row).filter((k) => k !== 'ITM_NUMBER').forEach((k) => { flags[k] = 'X'; });
        itemsInx.push(flags);
        // A complete ZAFN item (inquiry 1500124) carries its quantity in a DATED schedule line (VBEP EDATU, WMENG); a line without a
        // date leaves VBAP-KWMENG empty, which item incompletion group Z2 requires. The date is the inquiry date (ASSUMPTION: to be
        // confirmed by a TESTRUN; no requested-delivery-date field exists in the inquiry payload).
        schedules.push({ ITM_NUMBER: itm, SCHED_LINE: '0001', SCHED_TYPE: SCHEDULE_LINE_CATEGORY, REQ_DATE: scheduleDate, REQ_QTY: qty });
    });

    const headerIn = Object.fromEntries(fields);
    const headerInx = { UPDATEFLAG: 'I', ...Object.fromEntries(fields.map(([k]) => [k, 'X'])) };
    return {
        INQUIRY_HEADER_IN: headerIn,
        INQUIRY_HEADER_INX: headerInx,
        INQUIRY_PARTNERS: partners,
        INQUIRY_ITEMS_IN: itemsIn,
        INQUIRY_ITEMS_INX: itemsInx,
        INQUIRY_SCHEDULES_IN: schedules,
        INQUIRY_SCHEDULES_INX: schedules.map((s) => ({ ITM_NUMBER: s.ITM_NUMBER, SCHED_LINE: s.SCHED_LINE, UPDATEFLAG: 'I', SCHED_TYPE: 'X', REQ_DATE: 'X', REQ_QTY: 'X' }))
    };
}

const messages = (ret) => (Array.isArray(ret) ? ret : [])
    .filter((r) => r && r.MESSAGE)
    .map((r) => ({
        type: r.TYPE, id: r.ID, number: r.NUMBER, text: String(r.MESSAGE).trim(),
        // where SAP says the problem is: needed to tell which item / field a warning such as "not yet complete" refers to
        vars: [r.MESSAGE_V1, r.MESSAGE_V2, r.MESSAGE_V3, r.MESSAGE_V4].map((v) => String(v || '').trim()).filter(Boolean),
        parameter: r.PARAMETER ? String(r.PARAMETER).trim() : undefined,
        row: r.ROW ? Number(r.ROW) : undefined,
        field: r.FIELD ? String(r.FIELD).trim() : undefined
    }));
const errorsOf = (msgs) => msgs.filter((m) => m.type === 'E' || m.type === 'A');
/** 'Document is incomplete [VBAPKOM, 000010] (KWMENG) @VBUVKOM': the SAP text plus where SAP says it applies. */
const describe = (m) => `${m.text}${m.vars && m.vars.length ? ` [${m.vars.join(', ')}]` : ''}${m.field ? ` (${m.field})` : ''}${m.parameter ? ` @${m.parameter}` : ''}`;

class SalesInquiryRfcCreator {
    constructor(options = {}) {
        this.rfc = options.rfc || new RfcClient();
    }

    /**
     * @param {object} header mapped inquiry header (SalesInquiryMapper output)
     * @param {object[]} items mapped inquiry items
     * @param {{ testRun?: boolean }} options testRun = BAPI simulation, never committed
     * @returns {Promise<{ SalesInquiry?: string, testRun: boolean, messages: object[] }>}
     */
    async create(header, items, { testRun = false } = {}) {
        const input = buildInput(header, items);
        return this.rfc.session(async (call) => {
            const res = await call(BAPI, { ...input, TESTRUN: testRun ? 'X' : '' });
            const msgs = messages(res && res.RETURN);
            const errs = errorsOf(msgs);
            const docNo = String((res && res.SALESDOCUMENT) || '').trim();

            if (testRun) {
                // Simulation: nothing is committed; closing the session discards the LUW.
                if (errs.length) throw failure(`SAP rejected the inquiry (test run): ${errs.map(describe).slice(0, 3).join(' | ')}`, 400, { messages: msgs });
                return { testRun: true, messages: msgs };
            }
            if (errs.length || !docNo) {
                await call('BAPI_TRANSACTION_ROLLBACK', {});
                LOG.warn(`${BAPI} rejected: ${JSON.stringify(msgs)}`);
                const why = errs.length ? errs.map(describe).slice(0, 3).join(' | ') : 'SAP returned no document number';
                throw failure(`SAP rejected the inquiry: ${why}`, errs.length ? 400 : 502, { messages: msgs });
            }

            const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
            const commitErrors = errorsOf(messages([].concat((commit && commit.RETURN) || [])));
            if (commitErrors.length) {
                await call('BAPI_TRANSACTION_ROLLBACK', {});
                throw failure(`SAP created inquiry ${docNo} but the commit failed: ${commitErrors[0].text}`, 502, { SalesInquiry: docNo, name: 'PartialSalesInquiryError' });
            }
            LOG.info(`Sales inquiry ${docNo} committed via ${BAPI}`);
            return { SalesInquiry: docNo, testRun: false, messages: msgs };
        });
    }

    /** Confirms the committed document exists in SAP (VBAK) before the caller reports success. */
    async readBack(docNo) {
        const rows = await this.rfc.readTable('VBAK', ['VBELN', 'AUART', 'VBTYP', 'KUNNR'], [`VBELN = '${docNo}'`], 1);
        return rows && rows[0] ? rows[0] : null;
    }
}

module.exports = { SalesInquiryRfcCreator, buildInput, BAPI, UNSUPPORTED_HEADER_FIELDS };
