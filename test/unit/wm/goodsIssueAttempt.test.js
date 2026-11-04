/**
 * Posting-attempt log: the re-check job resolves attempts SAP did not confirm.
 * Runs against the in-memory SQLite database of the test profile; S/4HANA is always mocked.
 */
const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { ATTEMPT_ENTITY } = attempts;
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const { DELETE } = cds.ql;
const MIN = 60000;

const base = { MovementType: '201', Material: '8000006645', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS', CostCenter: '1011101301', PostingDate: '2026-09-30', User: 'TESTER' };
const sapDoc = { MaterialDocument: '4900049865', MaterialDocumentYear: '2026' };

describe('Posting attempts re-check', () => {
  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
  });
  afterEach(() => jest.restoreAllMocks());

  describe('re-check job', () => {
    let delivSpy;
    beforeEach(() => {
      delivSpy = jest.spyOn(GoodsIssueAdapter, 'findDeliveryByReference').mockResolvedValue(null);
    });
    afterEach(() => {
      if (delivSpy) delivSpy.mockRestore();
    });

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
  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    attempts.clearMemoryStore();
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

