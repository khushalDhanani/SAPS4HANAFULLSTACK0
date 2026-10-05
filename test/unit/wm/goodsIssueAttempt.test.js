/**
 * Posting-attempt log for Movement 201: the attempt is persisted before S/4HANA is called, the
 * re-check job resolves attempts SAP did not confirm, and queue replay respects the attempt status.
 * Runs against the in-memory SQLite database of the test profile; S/4HANA is always mocked.
 */
const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { ATTEMPT_ENTITY } = attempts;
const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const { SELECT, DELETE } = cds.ql;
const MIN = 60000;

function fakeService() {
  const handlers = {};
  const srv = { on: jest.fn((event, fn) => { handlers[event] = fn; }) };
  GoodsIssueHandler.init(srv);
  PerTypeGoodsIssueHandler.init(srv);
  return handlers;
}
const req = (data) => ({ data, user: { id: 'TESTER' }, error: jest.fn((code, msg) => ({ code, message: msg })) });
const allAttempts = () => cds.db.run(SELECT.from(ATTEMPT_ENTITY));
const payload = { CostCenter: '1011101301', Material: '8000006645', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS', PostingDate: '2026-09-30' };
const base = { MovementType: '201', Material: '8000006645', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS', CostCenter: '1011101301', PostingDate: '2026-09-30', User: 'TESTER' };
const sapDoc = { MaterialDocument: '4900049865', MaterialDocumentYear: '2026' };

describe('Goods Issue 201 posting attempts', () => {
  const handlers = fakeService();

  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({ StockReadSuccess: true, StockSufficient: true });
  });
  afterEach(() => jest.restoreAllMocks());

  describe('handler: the attempt is persisted before SAP is called', () => {
    test('row exists with status sending and the header reference when the adapter is invoked, then becomes posted', async () => {
      let seenDuringCall;
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockImplementation(async (d) => {
        seenDuringCall = await attempts.getByReference(d.ReferenceDocument);
        return { MaterialDocument: '4900055001', MaterialDocYear: '2026', Success: true };
      });
      await handlers.postGoodsIssue201(req(payload));

      expect(seenDuringCall).toMatchObject({ Status: 'sending', MovementType: '201', Material: '8000006645', CostCenter: '1011101301', PostingUser: 'TESTER' });
      const [row] = await allAttempts();
      expect(row).toMatchObject({ ReferenceDocument: seenDuringCall.ReferenceDocument, Status: 'posted', MaterialDocument: '4900055001' });
      expect(row.ResolvedAt).toBeTruthy();
    });

    test.each([
      ['never_reached (503)', Object.assign(new Error('service offline'), { status: 503 }), 503, 'rejected', /service unreachable/i],
      ['never_reached (501)', Object.assign(new Error('posting capability unavailable'), { status: 501 }), 503, 'rejected', /service unreachable or posting capability unavailable/i],
      ['rejected_by_sap (400)', Object.assign(new Error('Cost center does not exist'), { status: 400 }), 400, 'rejected', /Cost center does not exist/],
      ['auth_error (403)', Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 }), 403, 'rejected', /SU53/],
      ['unknown_outcome (504)', Object.assign(new Error('may still appear'), { status: 504, code: 'GI_POSTING_UNCONFIRMED' }), 504, 'unconfirmed', /unconfirmed/i]
    ])('classifies error %s properly to HTTP %i and attempt status %s', async (_label, err, expectedStatus, expectedAttemptStatus, msgPattern) => {
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(err);
      const r = req(payload);
      await handlers.postGoodsIssue201(r);
      expect(r.error).toHaveBeenCalledWith(expectedStatus, expect.stringMatching(msgPattern));
      expect((await allAttempts())[0].Status).toBe(expectedAttemptStatus);
    });

    test('a pre-check rejection ends as rejected without calling SAP', async () => {
      GoodsIssueAdapter.revalidateStockBeforePosting.mockResolvedValue({ StockReadSuccess: true, StockSufficient: false, Message: 'Insufficient stock' });
      const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');
      await handlers.postGoodsIssue201(req(payload));
      expect(post).not.toHaveBeenCalled();
      expect((await allAttempts())[0].Status).toBe('rejected');
    });

    test('a failing attempt insert blocks the posting (503) and SAP is not called', async () => {
      jest.spyOn(attempts, 'create').mockRejectedValue(new Error('insert failed'));
      const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');
      const r = req(payload);
      await handlers.postGoodsIssue201(r);
      expect(r.error).toHaveBeenCalledWith(503, expect.stringContaining('NOT sent to SAP'));
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('re-check job', () => {
    const lookup = () => jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference');
    const statusOf = async (ref) => (await attempts.getByReference(ref)).Status;

    test('crash case: an attempt left in sending becomes posted once SAP shows the document', async () => {
      await attempts.create({ ...base, ReferenceDocument: 'GICRASH0001' });
      const find = lookup().mockResolvedValueOnce(null).mockResolvedValueOnce(sapDoc);

      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 1 * MIN)).toMatchObject({ Checked: 0 }); // younger than 3 min
      expect(find).not.toHaveBeenCalled();
      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 4 * MIN)).toMatchObject({ Checked: 1, StillOpen: 1 });
      expect(await statusOf('GICRASH0001')).toBe('sending');
      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 5 * MIN)).toMatchObject({ Posted: 1 });

      expect(await attempts.getByReference('GICRASH0001')).toMatchObject({ Status: 'posted', MaterialDocument: '4900049865', MaterialDocYear: '2026' });
      expect(find).toHaveBeenCalledWith('GICRASH0001', '201', '2026-09-30');
    });

    test('nothing found past the second threshold becomes not_posted; before it the status is unchanged', async () => {
      await attempts.create({ ...base, ReferenceDocument: 'GILOST00001' });
      await attempts.setStatus('GILOST00001', 'unconfirmed');
      lookup().mockResolvedValue(null);

      await attempts.recheck(GoodsIssueAdapter, Date.now() + 14 * MIN);
      expect(await statusOf('GILOST00001')).toBe('unconfirmed');
      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 16 * MIN)).toMatchObject({ NotPosted: 1 });
      expect(await attempts.getByReference('GILOST00001')).toMatchObject({ Status: 'not_posted' });
    });

    test('a lookup error leaves the status unchanged', async () => {
      await attempts.create({ ...base, ReferenceDocument: 'GIERR000001' });
      lookup().mockRejectedValue(new Error('socket hang up'));
      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 60 * MIN)).toMatchObject({ Checked: 1, Errors: 1, NotPosted: 0 });
      expect(await statusOf('GIERR000001')).toBe('sending');
    });

    test('resolved attempts are not looked up again', async () => {
      await attempts.create({ ...base, ReferenceDocument: 'GIDONE00001' });
      await attempts.setStatus('GIDONE00001', 'rejected');
      const find = lookup();
      expect(await attempts.recheck(GoodsIssueAdapter, Date.now() + 60 * MIN)).toMatchObject({ Checked: 0 });
      expect(find).not.toHaveBeenCalled();
    });
  });
});

describe('unconfirmed documents and re-confirm job', () => {
  const handlers = fakeService();

  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    attempts.clearMemoryStore();
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
  });

  test('unconfirmed documents are stored on attempt as unconfirmed', async () => {
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({
      MaterialDocument: '4900088888',
      MaterialDocYear: '2026',
      Success: true,
      Confirmed: false,
      ConfirmationStatus: 'POSTED_CONFIRMATION_PENDING'
    });
    const res201 = await handlers.postGoodsIssue201(req(payload));
    expect(res201).toBeDefined();
    expect(res201.Confirmed).toBe(false);

    const attList = await allAttempts();
    const att201 = attList.find((a) => a.MovementType === '201');
    expect(att201).toBeDefined();
    expect(att201.Status).toBe('unconfirmed');
    expect(att201.MaterialDocument).toBe('4900088888');
    expect(att201.MaterialDocYear).toBe('2026');
  });

  test('reconfirmUnconfirmed retries read-back for unconfirmed documents and clears the flag', async () => {
    // 1. Setup attempt in 'unconfirmed' status
    const refDoc = 'GICONFIRM001';
    await attempts.create({
      ReferenceDocument: refDoc,
      MovementType: '201',
      Material: '1000000514',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 10,
      Unit: 'KG'
    });
    await attempts.setStatus(refDoc, 'unconfirmed', {
      MaterialDocument: '4900099999',
      MaterialDocYear: '2026'
    });

    // 2. Mock adapter.readBackDocument to confirm
    jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
      MaterialDocument: '4900099999',
      MaterialDocYear: '2026',
      Confirmed: true,
      Status: 'confirmed'
    });

    // 3. Run reconfirmUnconfirmed job
    const summary = await attempts.reconfirmUnconfirmed(GoodsIssueAdapter);
    expect(summary.Checked).toBe(1);
    expect(summary.Confirmed).toBe(1);

    // 4. Verify attempt is now 'posted'
    const updatedAttempt = await attempts.getByReference(refDoc);
    expect(updatedAttempt.Status).toBe('posted');
  });

  test('reconfirmUnconfirmed marks attempt needs-attention past maximum age', async () => {
    // 1. Setup attempt in 'unconfirmed' status
    const refDoc = 'GICONFIRM002';
    await attempts.create({
      ReferenceDocument: refDoc,
      MovementType: '201',
      Material: '1000000980',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 1,
      Unit: 'NOS'
    });
    await attempts.setStatus(refDoc, 'unconfirmed', {
      MaterialDocument: '4900088888',
      MaterialDocYear: '2026'
    });

    // 2. Mock adapter.readBackDocument to return unconfirmed (e.g. still commit lag or not found)
    jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
      MaterialDocument: '4900088888',
      MaterialDocYear: '2026',
      Confirmed: false,
      Status: 'posted, confirmation pending'
    });

    // 3. Run reconfirmUnconfirmed job past max age (e.g. 35 minutes later)
    const maxAge = attempts.constructor.unconfirmedMaxAgeMs();
    const pastMaxAgeTime = Date.now() + maxAge + 5000;
    const summary = await attempts.reconfirmUnconfirmed(GoodsIssueAdapter, pastMaxAgeTime);
    expect(summary.Checked).toBe(1);
    expect(summary.MarkedNeedsAttention).toBe(1);

    // 4. Verify attempt is now 'needs-attention'
    const updatedAttempt = await attempts.getByReference(refDoc);
    expect(updatedAttempt.Status).toBe('needs-attention');
    expect(updatedAttempt.LastError).toContain('marked needs-attention');
  });
});

describe('Movement 201 idempotent posting attempts and outcome mapping', () => {
  const handlers = fakeService();
  const request201 = {
    MovementType: '201',
    CostCenter: '1011101301',
    Material: '8000006645',
    Plant: '1120',
    StorageLocation: 'HS01',
    IssueQty: 1,
    Unit: 'NOS',
    PostingDate: '2026-10-03'
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    attempts.clearMemoryStore();
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({ StockReadSuccess: true, StockSufficient: true });
  });
  afterEach(() => jest.restoreAllMocks());

  test('an identical retry after posting returns the existing SAP document without reposting', async () => {
    const postPayloads = [];
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockImplementation(async (data) => {
      postPayloads.push({ ...data });
      return {
        MaterialDocument: '4900099911',
        MaterialDocYear: '2026',
        Success: true,
        Confirmed: true,
        ConfirmationStatus: 'CONFIRMED'
      };
    });

    const firstReq = req({ ...request201, ClientAttemptId: 'ATTEMPT-201-1' });
    const first = await handlers.postGoodsIssue201(firstReq);
    expect(postPayloads).toHaveLength(1);
    const firstPostedPayload = postPayloads[0];
    const storedAttempts = await allAttempts();
    const persisted = storedAttempts.find((attempt) => attempt.ReferenceDocument === firstPostedPayload.ReferenceDocument);
    const retry = await handlers.postGoodsIssue201(req({ ...request201, ClientAttemptId: 'ATTEMPT-201-1' }));

    expect(firstReq.error.mock.calls).toEqual([]);
    expect(storedAttempts.map((attempt) => attempt.ReferenceDocument)).toEqual([firstPostedPayload.ReferenceDocument]);
    expect(persisted).toMatchObject({
      ReferenceDocument: firstPostedPayload.ReferenceDocument,
      RequestHash: firstPostedPayload.RequestHash,
      Status: 'posted'
    });
    expect(first).toMatchObject({ MaterialDocument: '4900099911', MaterialDocYear: '2026' });
    expect(retry).toMatchObject({
      MaterialDocument: '4900099911',
      MaterialDocYear: '2026',
      Success: true,
      ConfirmationStatus: 'CONFIRMED',
      PostingStatus: 'POSTED'
    });
    expect(postPayloads).toHaveLength(1);
    expect((await allAttempts()).filter((attempt) => attempt.MovementType === '201')).toHaveLength(1);
  });

  test('two deliberate postings with distinct ClientAttemptId are separate attempts, same id replays', async () => {
    let docNo = 0;
    const postPayloads = [];
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockImplementation(async (data) => {
      postPayloads.push({ ...data });
      docNo += 1;
      return {
        MaterialDocument: `490009991${docNo}`,
        MaterialDocYear: '2026',
        Success: true,
        Confirmed: true,
        ConfirmationStatus: 'CONFIRMED'
      };
    });

    const first = await handlers.postGoodsIssue201(req({ ...request201, ClientAttemptId: 'GIA-ATTEMPT-1' }));
    const second = await handlers.postGoodsIssue201(req({ ...request201, ClientAttemptId: 'GIA-ATTEMPT-2' }));
    const replay = await handlers.postGoodsIssue201(req({ ...request201, ClientAttemptId: 'GIA-ATTEMPT-2' }));

    // Same item/qty/day, different attempt ids: two real SAP posts with distinct references.
    expect(postPayloads).toHaveLength(2);
    expect(postPayloads[0].ReferenceDocument).not.toBe(postPayloads[1].ReferenceDocument);
    expect(first).toMatchObject({ MaterialDocument: '4900099911' });
    expect(second).toMatchObject({ MaterialDocument: '4900099912' });
    // Replaying the same attempt id must NOT post again.
    expect(replay).toMatchObject({ MaterialDocument: '4900099912', PostingStatus: 'POSTED' });
    expect(postPayloads).toHaveLength(2);
  });

  test.each([
    ['queued', 'QUEUED'],
    ['sending', 'UNKNOWN'],
    ['unconfirmed', 'UNKNOWN'],
    ['rejected', 'FAILED'],
    ['not_posted', 'FAILED'],
    ['posted', 'POSTED']
  ])('maps persisted attempt status %s to explicit PostingStatus %s', (attemptStatus, expectedStatus) => {
    const result = PerTypeGoodsIssueHandler.attemptResponse({
      Status: attemptStatus,
      MaterialDocument: attemptStatus === 'queued' ? 'must-not-escape' : '4900000001',
      MaterialDocYear: '2026',
      LastError: 'SAP rejected the request'
    });

    expect(result.PostingStatus).toBe(expectedStatus);
    expect(result.Success).toBe(expectedStatus === 'POSTED');
    if (expectedStatus === 'QUEUED') {
      expect(result.MaterialDocument).toBe('');
      expect(result.Message).toMatch(/queued.*SAP has not yet created/i);
    }
  });

  test('returns POSTED only when the SAP material document is confirmed', async () => {
    const result = await PerTypeGoodsIssueHandler.postDirect(
      req({}),
      { MovementType: '201' },
      async () => ({ MaterialDocument: '4900000091', MaterialDocYear: '2026', Success: true, Confirmed: true })
    );

    expect(result).toMatchObject({
      PostingStatus: 'POSTED',
      Success: true,
      Confirmed: true,
      MaterialDocument: '4900000091'
    });
  });

  test('returns UNKNOWN rather than Success when SAP returned a document but read-back is pending', async () => {
    const result = await PerTypeGoodsIssueHandler.postDirect(
      req({}),
      { MovementType: '201' },
      async () => ({ MaterialDocument: '4900000092', MaterialDocYear: '2026', Success: true, Confirmed: false })
    );

    expect(result).toMatchObject({
      PostingStatus: 'UNKNOWN',
      Success: true,
      Confirmed: false,
      MaterialDocument: '4900000092'
    });
  });

  test.each([
    [Object.assign(new Error('Deficit of stock'), { status: 422 }), 422, 'Deficit of stock'],
    [Object.assign(new Error('timeout'), { status: 504 }), 504, 'timeout']
  ])('uses stable status for an SAP outcome', async (sapError, expectedStatus, expectedSnippet) => {
    const request = req({});
    await PerTypeGoodsIssueHandler.postDirect(
      request,
      { MovementType: '201' },
      async () => { throw sapError; }
    );

    expect(request.error).toHaveBeenCalledWith(expectedStatus, expect.stringContaining(expectedSnippet));
  });
});

