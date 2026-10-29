'use strict';

/**
 * Shared pieces of the SD "create document" BAPIs called over RFC (BAPI_INQUIRY_CREATEFROMDATA2,
 * BAPI_CUSTOMERRETURN_CREATE, ...): value formatting, RETURN message handling and the one-LUW create flow
 * (call, check RETURN, then COMMIT with WAIT or ROLLBACK).
 */

const failure = (message, status, extra = {}) => Object.assign(new Error(message), { status }, extra);
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

/** SD document numbers (VBELN) are CHAR10 with leading zeros; the BAPIs do not convert a short number (the first TESTRUN reported the
 * reference document "5000446" as having no document category). */
const documentNumber = (v) => (/^\d+$/.test(clean(v)) ? clean(v).padStart(10, '0') : clean(v));

const todaySap = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

/** RETURN rows -> messages with SAP's variables / parameter / row / field, needed to locate a warning or error. */
const messages = (ret) => (Array.isArray(ret) ? ret : [])
    .filter((r) => r && r.MESSAGE)
    .map((r) => ({
        type: r.TYPE, id: r.ID, number: r.NUMBER, text: String(r.MESSAGE).trim(),
        vars: [r.MESSAGE_V1, r.MESSAGE_V2, r.MESSAGE_V3, r.MESSAGE_V4].map((v) => String(v || '').trim()).filter(Boolean),
        parameter: r.PARAMETER ? String(r.PARAMETER).trim() : undefined,
        row: r.ROW ? Number(r.ROW) : undefined,
        field: r.FIELD ? String(r.FIELD).trim() : undefined
    }));
const errorsOf = (msgs) => msgs.filter((m) => m.type === 'E' || m.type === 'A');
/** 'Document is incomplete [VBAPKOM, 000010] (KWMENG) @VBUVKOM': the SAP text plus where SAP says it applies. */
const describe = (m) => `${m.text}${m.vars && m.vars.length ? ` [${m.vars.join(', ')}]` : ''}${m.field ? ` (${m.field})` : ''}${m.parameter ? ` @${m.parameter}` : ''}`;

/**
 * One LUW on one RFC connection. `labels`: { noun: 'inquiry', partialName: 'PartialSalesInquiryError', keyProp: 'SalesInquiry' }.
 * Returns { documentNumber, testRun, messages }; throws with SAP's messages on any E/A message, a missing number
 * or a failed commit. A test run is never committed (closing the session discards the LUW).
 */
async function runCreateBapi(rfc, bapi, input, { testRun = false, labels, log } = {}) {
    return rfc.session(async (call) => {
        const res = await call(bapi, { ...input, TESTRUN: testRun ? 'X' : '' });
        const msgs = messages(res && res.RETURN);
        const errs = errorsOf(msgs);
        const docNo = String((res && res.SALESDOCUMENT) || '').trim();

        if (testRun) {
            if (errs.length) throw failure(`SAP rejected the ${labels.noun} (test run): ${errs.map(describe).slice(0, 3).join(' | ')}`, 400, { messages: msgs });
            return { testRun: true, messages: msgs };
        }
        if (errs.length || !docNo) {
            await call('BAPI_TRANSACTION_ROLLBACK', {});
            if (log) log.warn(`${bapi} rejected: ${JSON.stringify(msgs)}`);
            const why = errs.length ? errs.map(describe).slice(0, 3).join(' | ') : 'SAP returned no document number';
            throw failure(`SAP rejected the ${labels.noun}: ${why}`, errs.length ? 400 : 502, { messages: msgs });
        }

        const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        const commitErrors = errorsOf(messages([].concat((commit && commit.RETURN) || [])));
        if (commitErrors.length) {
            await call('BAPI_TRANSACTION_ROLLBACK', {});
            throw failure(`SAP created ${labels.noun} ${docNo} but the commit failed: ${commitErrors[0].text}`, 502, { [labels.keyProp]: docNo, name: labels.partialName });
        }
        if (log) log.info(`${labels.noun} ${docNo} committed via ${bapi}`);
        return { documentNumber: docNo, testRun: false, messages: msgs };
    });
}

module.exports = { failure, clean, sapDate, partnerNumber, materialNumber, documentNumber, todaySap, messages, errorsOf, describe, runCreateBapi };
