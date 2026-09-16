const crypto = require('crypto');
const http = require('http');
const https = require('https');
const httpClient = require('@sap-cloud-sdk/http-client');

/**
 * OData V4 client for the SAP service group UI_SALESQUOTATIONMANAGE ("Sales Quotation - Manage"),
 * verified as published and operational in DS4 client 220.
 *
 * The service implements SAP__session.StickySessionSupported:
 *   NewAction (from inquiry)  CreateWithRefFromSlsInquiry   bound to SalesQuotationManage
 *   SaveAction                SaveChanges                   bound to SalesQuotationManage
 *   DiscardAction             DiscardChanges                action import
 * A session is opened by a New action sent with "SAP-ContextId-Accept: header"; SAP answers with
 * an SAP-ContextId header that every later request of the same session must carry, together with
 * the session cookies and the CSRF token. SaveChanges is called only on explicit user confirmation.
 *
 * DO NOT assume the document exists only in the session. In DS4 a $batch containing
 * CreateWithRefFromSlsInquiry and DiscardChanges, without SaveChanges, committed quotation 2000434.
 * Treat CreateWithRefFromSlsInquiry as a potentially persisting write, never as a preview, and never
 * send it through $batch.
 *
 * Session loss: DS4 intermittently answers a request inside the session with HTTP 400 "Session not
 * found" (raised by ICF/ICM, before Gateway), even when the same SAP-ContextId, cookies and TCP
 * connection are used. The cause is SAP-side and not yet proven (Basis investigation). The lost
 * session keeps its lock on the inquiry (V2/042) for about 5 minutes. All requests of one session
 * still go over one dedicated keep-alive socket, which removed failures seen with a shared pool.
 * Nothing is ever retried: every uncertain outcome is reported as "check SAP".
 */

const SERVICE_PATH = '/sap/opu/odata4/sap/ui_salesquotationmanage/srvd/sap/ui_salesquotationmanage/0001';
const NAMESPACE = 'com.sap.gateway.srvd.ui_salesquotationmanage.v0001';
const ENTITY_SET = 'SalesQuotationManage';

/** Session key of a quotation that is not yet saved. */
const NEW_DOCUMENT_KEY = `${ENTITY_SET}(SalesQuotation='')`;

/**
 * Header properties of SalesQuotationManageType that exist in $metadata and are not listed in
 * NonUpdatableProperties. Anything else is left to SAP's copy control from the inquiry.
 */
const UPDATABLE_HEADER_FIELDS = [
  'SalesQuotationDate',
  'BindingPeriodValidityStartDate',
  'BindingPeriodValidityEndDate',
  'PurchaseOrderByCustomer'
];

/** SAP message: the reference document is incomplete and cannot be referenced. */
const INCOMPLETE_REFERENCE_CODE = 'SLS_LORD/166';
const INCOMPLETE_DOCUMENT_CODE = 'SLS_LORD/009';

/** An error reported by SAP for business reasons, carrying the SAP message code. */
class SapQuotationError extends Error {
  constructor(message, { status = 500, sapCode = '', sapMessage = '', salesQuotation = '' } = {}) {
    super(message);
    this.name = 'SapQuotationError';
    this.status = status;
    this.sapCode = sapCode;
    this.sapMessage = sapMessage;
    this.salesQuotation = salesQuotation;
  }
}

/** Reads the HTTP response from a Cloud SDK error, whichever way the SDK version wraps it. */
function responseOf(err) {
  return err?.response || err?.cause?.response || err?.rootCause?.response || null;
}

/** Extracts the OData V4 error code and message from a failed response. */
function parseSapError(err) {
  const response = responseOf(err);
  let body = response?.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const error = body?.error || {};
  return {
    status: response?.status || 500,
    code: error.code || '',
    message: error.message || err?.message || String(err)
  };
}

/** Normalises a date input to Edm.Date (YYYY-MM-DD); returns undefined when empty or invalid. */
function toEdmDate(value) {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Keeps only verified updatable header fields that carry a value, formatting dates as Edm.Date. */
function buildHeaderChanges(input = {}) {
  const changes = {};
  for (const field of UPDATABLE_HEADER_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    changes[field] = field === 'PurchaseOrderByCustomer'
      ? String(value).trim().slice(0, 35)
      : toEdmDate(value);
    if (changes[field] === undefined) delete changes[field];
  }
  return changes;
}

/** Short one-way hash of a session token: correlates requests in logs without revealing the token. */
function hashToken(value) {
  return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12) : 'none';
}

/** SAP message code of a response: OData error code, or the first code in the sap-messages header. */
function sapCodeOf(response) {
  let body = response?.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (body?.error?.code) return body.error.code;
  const header = response?.headers?.['sap-messages'];
  if (header) {
    try { return [].concat(JSON.parse(header))[0]?.code || ''; } catch (e) { return ''; }
  }
  return '';
}

/**
 * One diagnostic line per SAP request. Contains no credentials, Authorization header, cookie values,
 * CSRF token or response payload; the context ID appears only as a hash.
 */
function logSapRequest(session, { operation, method, path, status, startedAt, response, error }) {
  const sessionLost = error && isSessionNotFound(error);
  const code = sessionLost ? 'SESSION_NOT_FOUND' : sapCodeOf(response);
  console.info(`[SalesQuotationManageClient] quotation-flow ${session.flowId} ${operation.padEnd(9)}`
    + ` ${method.toUpperCase()} ${path.split('?')[0]}`
    + ` status=${response?.status ?? (error ? `none(${error.code || 'no response'})` : 'n/a')}`
    + ` ms=${Date.now() - startedAt}`
    + ` context=${session.contextId ? `present#${hashToken(session.contextId)}` : 'none'}`
    + ` cookies=${session._cookies.size ? `present(${session._cookies.size})` : 'none'}`
    + ` csrf=${session._csrfToken ? 'present' : 'none'}`
    + ` etag=${session.etag ? 'present' : 'none'}`
    + (code ? ` sap=${code}` : ''));
}

/** True when ICF reports that the stateful session no longer exists. */
function isSessionNotFound(err) {
  const response = responseOf(err);
  return response?.status === 400 && typeof response?.data === 'string' && /Session not found/i.test(response.data);
}

/** One SAP sticky session: CSRF token, cookies and SAP-ContextId shared by all its requests. */
class QuotationSession {
  constructor(destination, executeFn, flowId) {
    this._destination = destination;
    this._execute = executeFn;
    // Correlates every log line of one quotation flow.
    this.flowId = flowId || crypto.randomBytes(4).toString('hex');
    this._cookies = new Map();
    this._csrfToken = '';
    this.contextId = '';
    // Latest ETag of the unsaved quotation; PATCH and SaveChanges must be conditional (HTTP 428 otherwise).
    this.etag = '';
    // One socket for the whole session: ICM binds the stateful session to the connection.
    this._httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    this._httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  }

  /** Closes the session's dedicated socket. */
  close() {
    this._httpAgent.destroy();
    this._httpsAgent.destroy();
  }

  _captureResponse(res) {
    const headers = res?.headers || {};
    const setCookie = headers['set-cookie'];
    for (const cookie of [].concat(setCookie || [])) {
      const pair = String(cookie).split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > 0) this._cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
    }
    const token = headers['x-csrf-token'];
    if (token && String(token).toLowerCase() !== 'required') this._csrfToken = token;
    const contextId = headers['sap-contextid'];
    if (contextId) this.contextId = contextId;
    const etag = (res?.data && typeof res.data === 'object' && res.data['@odata.etag']) || headers.etag;
    if (etag) this.etag = etag;
  }

  async _request(operation, method, path, { data, headers = {} } = {}) {
    const requestHeaders = {
      Accept: 'application/json',
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(this._cookies.size ? { Cookie: [...this._cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...(this._csrfToken ? { 'x-csrf-token': this._csrfToken } : {}),
      ...(this.contextId ? { 'SAP-ContextId': this.contextId } : {}),
      ...headers
    };
    const startedAt = Date.now();
    const logPath = path.replace(`${NAMESPACE}.`, '');
    try {
      const res = await this._execute(this._destination, {
        method,
        url: `${SERVICE_PATH}${path}`,
        headers: requestHeaders,
        httpAgent: this._httpAgent,
        httpsAgent: this._httpsAgent,
        // A redirect could change host or path and silently leave the stateful session; fail instead.
        maxRedirects: 0,
        ...(data !== undefined ? { data } : {})
      }, { fetchCsrfToken: false });
      this._captureResponse(res);
      logSapRequest(this, { operation, method, path: logPath, startedAt, response: res });
      return res;
    } catch (err) {
      const response = responseOf(err);
      this._captureResponse(response);
      logSapRequest(this, { operation, method, path: logPath, startedAt, response, error: err });
      throw err;
    }
  }

  /** Fetches the CSRF token (and session cookies) from the service root. */
  async fetchCsrfToken() {
    await this._request('GET-CSRF', 'get', '/', { headers: { 'x-csrf-token': 'Fetch' } });
    if (!this._csrfToken) {
      throw new SapQuotationError('SAP did not return a CSRF token for UI_SALESQUOTATIONMANAGE.');
    }
  }

  /** Opens the sticky session by creating a quotation with reference to an inquiry. */
  async createWithRefFromSlsInquiry(salesInquiry, salesQuotationType) {
    const res = await this._request('CREATE', 'post', `/${ENTITY_SET}/${NAMESPACE}.CreateWithRefFromSlsInquiry`, {
      data: { SalesInquiry: salesInquiry, SalesQuotationType: salesQuotationType },
      headers: { 'SAP-ContextId-Accept': 'header' }
    });
    if (!this.contextId) {
      throw new SapQuotationError('SAP did not open a sticky session (no SAP-ContextId returned).');
    }
    return res.data;
  }

  /** Read-only check that SAP still knows the session opened by create, before anything is changed. */
  async checkSession(quotationKey) {
    const key = String(quotationKey ?? '').replace(/'/g, "''");
    return this._request('SESSION-CHECK', 'get', `/${ENTITY_SET}(SalesQuotation='${key}')?$select=SalesQuotation`);
  }

  /** Applies header changes to the unsaved quotation inside the session. */
  async updateHeader(changes) {
    return this._request('PATCH', 'patch', `/${NEW_DOCUMENT_KEY}`, {
      data: changes,
      headers: { 'If-Match': this.etag || '*' }
    });
  }

  /** Persists the quotation. Creates a real SAP document. */
  async saveChanges() {
    const res = await this._request('SAVE', 'post', `/${NEW_DOCUMENT_KEY}/${NAMESPACE}.SaveChanges`, {
      data: {},
      headers: { 'If-Match': this.etag || '*' }
    });
    return res.data;
  }

  /** Asks SAP to end the session and release its locks. Not a guarantee that nothing is persisted. */
  async discardChanges() {
    return this._request('DISCARD', 'post', '/DiscardChanges', { data: {} });
  }
}

class SalesQuotationManageClient {
  /**
   * @param {Object} deps
   * @param {Object} deps.destination       Cloud SDK destination for DS4 client 220
   * @param {Function} [deps.executeHttpRequest]
   */
  constructor({ destination, executeHttpRequest } = {}) {
    this._destination = destination;
    this._execute = executeHttpRequest || httpClient.executeHttpRequest;
  }

  /**
   * Creates and saves a Sales Quotation with reference to a Sales Inquiry, then reads it back from SAP.
   *
   * Call only after the user has confirmed creation. CreateWithRefFromSlsInquiry is treated as a
   * potentially persisting operation: nothing in this flow is ever retried, and any failure whose
   * outcome SAP did not state explicitly is reported as "outcome unknown - verify in SAP".
   * DiscardChanges is sent after a failure only to release the inquiry lock; it is not a rollback.
   *
   * @param {Object} input
   * @param {string} input.salesInquiry
   * @param {string} input.salesQuotationType
   * @param {Object} [input.header]  Values for UPDATABLE_HEADER_FIELDS
   * @returns {Promise<{ SalesQuotation: string, verified: true }>}
   */
  async createFromInquiry({ salesInquiry, salesQuotationType, header = {} }) {
    const inquiryKey = String(salesInquiry).trim();
    if (inFlightInquiries.has(inquiryKey)) {
      throw new SapQuotationError(
        `A Sales Quotation for inquiry ${inquiryKey} is already being created. Wait for it to finish and check SAP`
        + ' before trying again.',
        { status: 409, sapCode: OUTCOME.IN_PROGRESS }
      );
    }
    inFlightInquiries.add(inquiryKey);

    const session = new QuotationSession(this._destination, this._execute);
    let step = STEP.CSRF;
    let sessionOpen = false;

    console.info(`[SalesQuotationManageClient] quotation-flow ${session.flowId} start: create Sales Quotation with reference to inquiry`
      + ` | Inquiry ${salesInquiry} | Sales Quotation Type ${salesQuotationType}`
      + ` | Endpoint ${this._destination?.url || ''}${SERVICE_PATH}/`
      + ` | SAP user ${this._destination?.username || '(from destination)'}`
      + ` | Action ${ENTITY_SET}/${NAMESPACE}.CreateWithRefFromSlsInquiry then SaveChanges, then read-back`
      + ' | SAP-ContextId: requested via SAP-ContextId-Accept, captured from response, sent on every later request'
      + ' | CSRF: fetched once with x-csrf-token: Fetch, sent on every modifying request'
      + ' | ETag: captured from responses, sent as If-Match on PATCH and SaveChanges'
      + ' | One dedicated keep-alive socket, no redirects, no $batch, no retry');

    try {
      await session.fetchCsrfToken();

      step = STEP.CREATE;
      const draft = await session.createWithRefFromSlsInquiry(salesInquiry, salesQuotationType);
      sessionOpen = true;
      if (!draft || typeof draft !== 'object') {
        throw new SapQuotationError('SAP opened the quotation session but returned no quotation data.',
          { status: 502, sapCode: OUTCOME.UNKNOWN });
      }

      step = STEP.SESSION_CHECK;
      await this._postCreateSessionCheck(session, salesInquiry, draft.SalesQuotation);

      const changes = buildHeaderChanges(header);
      if (Object.keys(changes).length > 0) {
        step = STEP.PATCH;
        await session.updateHeader(changes);
      }

      step = STEP.SAVE;
      const saved = await session.saveChanges();
      sessionOpen = false;
      const salesQuotation = String(saved?.SalesQuotation || '').trim();
      if (!salesQuotation) {
        throw new SapQuotationError('SAP accepted SaveChanges but returned no Sales Quotation number.',
          { status: 502, sapCode: OUTCOME.UNKNOWN });
      }

      step = STEP.VERIFY;
      await this._verifyQuotationExists(salesQuotation, salesInquiry, session.flowId);
      console.info(`[SalesQuotationManageClient] quotation-flow ${session.flowId} done: Sales Quotation ${salesQuotation} created from inquiry ${salesInquiry}`
        + ' and verified by reading it back from SAP.');
      return { SalesQuotation: salesQuotation, verified: true };
    } catch (err) {
      logStepFailure(session.flowId, step, salesInquiry, err);
      const quotationError = toQuotationError(err, salesInquiry, step);
      if (quotationError.sapCode === OUTCOME.SESSION_LOST || quotationError.sapCode === OUTCOME.UNKNOWN) {
        console.error(`[SalesQuotationManageClient] quotation-flow ${session.flowId} Inquiry ${salesInquiry}: outcome of step '${step}' is not confirmed by SAP.`
          + ' Stopping without retry. Check SAP for a quotation created from this inquiry before trying again.');
      }
      if (sessionOpen && step !== STEP.VERIFY) {
        // Releases the inquiry lock held by the open session (otherwise V2/042 for about 5 minutes). Not a rollback.
        await session.discardChanges().catch(discardErr => logStepFailure(session.flowId, 'DiscardChanges', salesInquiry, discardErr));
      }
      throw quotationError;
    } finally {
      session.close();
      inFlightInquiries.delete(inquiryKey);
    }
  }

  /** Runs the post-create session check and logs its outcome; rethrows so the flow stops on failure. */
  async _postCreateSessionCheck(session, salesInquiry, quotationKey) {
    const logResult = (status, result) => console.info('[SalesQuotationManageClient] quotation-flow: post-create session check'
      + ` flow=${session.flowId} inquiry=${salesInquiry} quotation=${quotationKey ? quotationKey : "''"}`
      + ` status=${status ?? 'none'} context=${session.contextId ? `present#${hashToken(session.contextId)}` : 'none'}`
      + ` result=${result}`);
    try {
      const res = await session.checkSession(quotationKey);
      logResult(res?.status, 'SESSION_VALID');
    } catch (err) {
      logResult(responseOf(err)?.status, isSessionNotFound(err) ? 'SESSION_NOT_FOUND' : 'NOT_CONFIRMED');
      throw err;
    }
  }

  /** Reads the saved quotation back from SAP in a new, stateless request. */
  async _verifyQuotationExists(salesQuotation, salesInquiry, flowId) {
    const reader = new QuotationSession(this._destination, this._execute, flowId);
    try {
      const key = String(salesQuotation).replace(/'/g, "''");
      const res = await reader._request('READ-BACK', 'get',
        `/${ENTITY_SET}('${key}')?$select=SalesQuotation,SalesQuotationType,SoldToParty`);
      if (String(res?.data?.SalesQuotation || '').trim() !== salesQuotation) {
        throw new Error(`read-back returned ${JSON.stringify(res?.data?.SalesQuotation)}`);
      }
    } catch (err) {
      throw new SapQuotationError(
        `Do not create it again. Check quotation ${salesQuotation} in VA23.`
        + ` (SAP returned Sales Quotation ${salesQuotation} for inquiry ${salesInquiry}, but reading it back failed: ${parseSapError(err).message}.)`,
        { status: 502, sapCode: OUTCOME.SAVED_NOT_VERIFIED, salesQuotation }
      );
    } finally {
      reader.close();
    }
  }
}

/** Steps of the creation flow, used to classify failures. */
const STEP = {
  CSRF: 'fetch CSRF token',
  CREATE: 'CreateWithRefFromSlsInquiry',
  SESSION_CHECK: 'post-create session check',
  PATCH: 'update header',
  SAVE: 'SaveChanges',
  VERIFY: 'read back saved quotation'
};

/** Outcome codes reported for failures that are not plain SAP business rejections. */
const OUTCOME = {
  SESSION_LOST: 'ICF_SESSION_NOT_FOUND',
  UNKNOWN: 'OUTCOME_UNKNOWN',
  SAVED_NOT_VERIFIED: 'SAVED_NOT_VERIFIED',
  IN_PROGRESS: 'CREATION_IN_PROGRESS'
};

/**
 * Inquiries with a creation in flight in this process; blocks a second, parallel creation.
 * ponytail: Single-instance ceiling — inFlightInquiries is a per-process in-memory Set.
 * Cross-instance concurrency across multiple Cloud Foundry application containers would
 * require a distributed mutex or HDI row lock (like GoodsIssueQueueManager); this runtime
 * is constrained to a single-instance ceiling for stateful quotation creation sessions.
 */
const inFlightInquiries = new Set();

/** Logs a failed step with SAP code and message only; no payload, cookies, tokens or credentials. */
function logStepFailure(flowId, step, salesInquiry, err) {
  const response = responseOf(err);
  const { code, message } = parseSapError(err);
  const detail = isSessionNotFound(err)
    ? 'ICF: Session not found'
    : (code ? `${code} ${message}` : (response ? `non-OData response (${typeof response.data === 'string' ? 'text' : 'object'})` : message));
  console.error(`[SalesQuotationManageClient] quotation-flow ${flowId} Inquiry ${salesInquiry}: step '${step}' failed`
    + ` (HTTP ${response?.status ?? 'none'}): ${String(detail).slice(0, 300)}`);
}

/**
 * Converts a failure into a SapQuotationError.
 *
 * Only an OData error with an SAP message code in a 4xx response counts as an explicit SAP business
 * rejection. Everything else after the create request was sent (no response, timeout, 5xx, non-OData
 * body, lost session) leaves the SAP outcome unconfirmed.
 */
function toQuotationError(err, salesInquiry, step) {
  if (err instanceof SapQuotationError) return err;
  const { status, code, message } = parseSapError(err);
  const response = responseOf(err);
  const notConfirmed = 'SAP did not confirm the result. Do not retry; check SAP.';

  if (code === INCOMPLETE_REFERENCE_CODE || (code === INCOMPLETE_DOCUMENT_CODE && step === STEP.CREATE)) {
    return new SapQuotationError(
      `Inquiry ${salesInquiry} is incomplete in SAP and cannot be converted to a Sales Quotation.`
      + ' Complete the inquiry in VA22 before creating the quotation.',
      { status: 400, sapCode: code, sapMessage: message }
    );
  }
  if (isSessionNotFound(err)) {
    return new SapQuotationError(
      `${notConfirmed} (Inquiry ${salesInquiry}: SAP reported "Session not found" at step '${step}'.)`,
      { status: 502, sapCode: OUTCOME.SESSION_LOST, sapMessage: 'Session not found' }
    );
  }
  if (response && status >= 400 && status < 500 && code) {
    return new SapQuotationError(`${message} (SAP ${code})`, { status: 400, sapCode: code, sapMessage: message });
  }
  if (step === STEP.CSRF) {
    return new SapQuotationError(
      `Could not start the SAP quotation request (${message}). Nothing was sent to create a quotation.`,
      { status: 502, sapCode: '', sapMessage: message }
    );
  }
  return new SapQuotationError(
    `${notConfirmed} (Inquiry ${salesInquiry}: step '${step}', ${response ? `HTTP ${status}` : 'no response'}: ${message}.)`,
    { status: 502, sapCode: OUTCOME.UNKNOWN, sapMessage: message }
  );
}

module.exports = {
  SalesQuotationManageClient,
  OUTCOME,
  SapQuotationError,
  toEdmDate,
  buildHeaderChanges,
  parseSapError,
  toQuotationError,
  STEP,
  INCOMPLETE_REFERENCE_CODE,
  INCOMPLETE_DOCUMENT_CODE,
  SERVICE_PATH,
  NAMESPACE,
  ENTITY_SET,
  UPDATABLE_HEADER_FIELDS
};
