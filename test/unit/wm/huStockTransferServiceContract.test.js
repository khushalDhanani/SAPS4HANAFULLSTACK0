'use strict';

/**
 * HuStockTransferService HTTP contract [mock only, not SAP verification]:
 *  - precheck fields (TransferPath, BlockerDetails, WarningDetails) are part of the OData contract;
 *  - plant scope is enforced server-side for plant-scoped users (test-clerk-1130: 1130, test-clerk-1120: 1120, khushal: Admin);
 *  - a write with unknown SAP outcome is recorded as 'unconfirmed', a definitive SAP rejection as 'rejected'.
 */
const cds = require('@sap/cds');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const { GET, POST } = cds.test(__dirname + '/../../../');
const as = (username) => ({ auth: { username, password: '' } });
const base = '/odata/v4/hu-stock-transfer';

describe('HuStockTransferService contract, plant scope and attempt status', () => {
  beforeEach(() => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({
      ReservationNo: '529960', ReservationItem: '1', Plant: '1120', StorageLocation: 'CS02', OpenQty: 3,
      TransferPath: 'A', IsHuManaged: true, Xhupf: 'X'
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('exposes TransferPath, Blockers, BlockerDetails, Warnings and WarningDetails', async () => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'validateUnit').mockResolvedValue({
      Valid: false, UnitNumber: 'HU1', UnitType: 'Handling Unit (HU)', StatusState: 'Error', StatusMessage: 'blocked',
      Blockers: ['b'], BlockerDetails: [{ code: 'OPEN_DELIVERY_EXISTS', key: 'blockerOpenDeliveryExists', message: 'm', params: ['80000097', '529960', '1'] }],
      Warnings: ['w'], WarningDetails: [{ code: 'NO_T319A_ROW', key: 'warningNoT319ARow', severity: 'warning', message: 'wm', params: ['Z007', 'W01'] }]
    });
    const v = await GET(`${base}/validateUnit(reservation='529960',item='1',unitNumber='HU1')`, as('khushal'));
    expect(v.data.BlockerDetails[0]).toMatchObject({ key: 'blockerOpenDeliveryExists', params: ['80000097', '529960', '1'] });
    expect(v.data.WarningDetails[0]).toMatchObject({ key: 'warningNoT319ARow', severity: 'warning' });
    const c = await GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, as('khushal'));
    expect(c.data.TransferPath).toBe('A');
  });

  it('denies a plant-scoped user (test-clerk-1130, 1130) every reservation-keyed read and the posting action for a plant-1120 reservation', async () => {
    const exec = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({ Success: true, MaterialDocument: '1' });
    const bins = jest.spyOn(HuStockTransferAdapter.prototype, 'getStorageBins').mockResolvedValue([]);
    const clerk1130 = as('test-clerk-1130');
    await expect(GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, clerk1130)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/getStorageBins(reservation='529960',item='1')`, clerk1130)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/rackLayout(warehouse='W01',storageType='',rackPrefix='',reservation='',item='')`, clerk1130)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/getOpenReservations(plant='1120',storageLocation='',movementType='311',requester='',reservation='',material='',status='open',includeDeleted=false)`, clerk1130))
      .rejects.toMatchObject({ response: { status: 403 } });
    await expect(POST(`${base}/executeHuStockTransfer`, { ReservationNo: '529960', ReservationItem: '1', UnitNumber: '2000019372', TransferQty: 1, ClientAttemptId: 'scope-1' }, clerk1130))
      .rejects.toMatchObject({ response: { status: 403 } });
    expect(exec).not.toHaveBeenCalled();
    expect(bins).not.toHaveBeenCalled();
  });

  it('allows the plant-scoped clerk of plant 1120 (test-clerk-1120) and the Admin (khushal)', async () => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'getStorageBins').mockResolvedValue([]);
    const clerk1120 = await GET(`${base}/getStorageBins(reservation='529960',item='1')`, as('test-clerk-1120'));
    expect(clerk1120.status).toBe(200);
    const khushal = await GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, as('khushal'));
    expect(khushal.data.Plant).toBe('1120');
  });

  it("records 'unconfirmed' with the document when the adapter reports an unknown SAP outcome, 'rejected' otherwise", async () => {
    const setStatus = jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockResolvedValue();
    jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockResolvedValue({ created: true, row: { ReferenceDocument: 'HUTEST0' } });
    const unconfirmed = Object.assign(new Error('Stock transfer outcome is unconfirmed in SAP'), { status: 502, sapWriteAttempted: true, materialDocument: '4900012345', materialDocYear: '2026' });
    const exec = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockRejectedValueOnce(unconfirmed)
      .mockRejectedValueOnce(Object.assign(new Error('SAP rejected stock transfer'), { status: 422 }));
    const body = { ReservationNo: '529960', ReservationItem: '1', UnitNumber: '2000019372', TransferQty: 1, ClientAttemptId: 'unc-1' };

    await expect(POST(`${base}/executeHuStockTransfer`, body, as('khushal'))).rejects.toMatchObject({ response: { status: 502 } });
    expect(setStatus).toHaveBeenLastCalledWith('HUTEST0', 'unconfirmed', expect.objectContaining({ MaterialDocument: '4900012345', MaterialDocYear: '2026' }));

    await expect(POST(`${base}/executeHuStockTransfer`, { ...body, ClientAttemptId: 'unc-2' }, as('khushal'))).rejects.toMatchObject({ response: { status: 422 } });
    expect(setStatus).toHaveBeenLastCalledWith('HUTEST0', 'rejected', expect.objectContaining({ LastError: 'SAP rejected stock transfer' }));
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

// HTTP posts below target only the local CAP test server; all SAP posting is mocked.
describe('HU double-post guard, with the real attempt table [SAP mocked]', () => {
  const GoodsIssuePostingAttempt = GoodsIssueAttemptStore.ATTEMPT_ENTITY;
  const { SELECT, DELETE } = cds.ql;
  const transfer = { ReservationNo: '529960', ReservationItem: '1', UnitNumber: '2000019372', TransferQty: 1 };
  const send = (ClientAttemptId, overrides = {}) => POST(`${base}/executeHuStockTransfer`, { ...transfer, ...overrides, ClientAttemptId }, as('khushal'));
  const statusOf = (err) => err.response.status;
  let exec;

  beforeEach(async () => {
    await cds.run(DELETE.from(GoodsIssuePostingAttempt));
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ Plant: '1120' });
    exec = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer')
      .mockResolvedValue({ Success: true, MaterialDocument: '4900012345', MaterialDocYear: '2026' });
  });
  afterEach(() => jest.restoreAllMocks());

  const rows = () => cds.run(SELECT.from(GoodsIssuePostingAttempt));
  const noAnswer = () => Object.assign(new Error('Stock transfer outcome is NOT confirmed in SAP (timeout).'), { status: 502, sapWriteAttempted: true, $sanitize: false });

  it('records posted on the claimed row and gives the adapter that reference and date', async () => {
    await send('id-1');

    const [row] = await rows();
    expect(row).toMatchObject({ Status: 'posted', MaterialDocument: '4900012345', MaterialDocYear: '2026' });
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ ReferenceDocument: row.ReferenceDocument, PostingDate: row.PostingDate }));
    expect(row.ReferenceDocument.length).toBeLessThanOrEqual(16);
  });

  it('refuses a repeat with the same ID and names the document, without calling SAP', async () => {
    await send('id-1');

    const err = await send('id-1').catch((e) => e);

    expect(statusOf(err)).toBe(409);
    expect(err.response.data.error.message).toMatch(/already posted \(material document 4900012345\/2026\)/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('allows a further transfer with a new ID once the earlier one is confirmed posted', async () => {
    await send('id-1');
    await send('id-2');

    expect(exec).toHaveBeenCalledTimes(2);
    expect((await rows()).map((r) => r.Status)).toEqual(['posted', 'posted']);
  });

  it('refuses a new ID while the earlier outcome is not confirmed, and the text turns the screen off', async () => {
    exec.mockRejectedValueOnce(noAnswer());
    await send('id-1').catch(() => {});
    expect((await rows())[0].Status).toBe('unconfirmed');

    const err = await send('id-2').catch((e) => e);

    expect(statusOf(err)).toBe(409);
    expect(err.response.data.error.message).toMatch(/NOT confirmed.*Check it in SAP before/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('keeps refusing after the recheck calls an unknown outcome not_posted', async () => {
    exec.mockRejectedValueOnce(noAnswer());
    await send('id-1').catch(() => {});
    const [{ ReferenceDocument }] = await rows();
    await GoodsIssueAttemptStore.setStatus(ReferenceDocument, 'not_posted', { LastError: 'not found' });

    const err = await send('id-2').catch((e) => e);

    expect(statusOf(err)).toBe(409);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a definite SAP rejection, on a new reference', async () => {
    exec.mockRejectedValueOnce(Object.assign(new Error('SAP rejected stock transfer'), { status: 422 }));
    await send('id-1').catch(() => {});

    await send('id-1');

    expect(exec).toHaveBeenCalledTimes(2);
    const all = await rows();
    expect(all.map((r) => r.Status).sort()).toEqual(['posted', 'rejected']);
    expect(new Set(all.map((r) => r.ReferenceDocument)).size).toBe(2);
  });

  it('treats a zero-padded unit, reservation and item as the same request', async () => {
    await send('id-1').catch(() => {});
    exec.mockClear();
    exec.mockRejectedValueOnce(noAnswer());
    await send('id-2', { UnitNumber: '2000019999' }).catch(() => {}); // a different unit is not blocked

    const err = await send('id-3', { UnitNumber: '0002000019999', ReservationNo: '0000529960', ReservationItem: '0001' }).catch((e) => e);

    expect(statusOf(err)).toBe(409);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('lets one of two overlapping requests with different IDs reach SAP while the first is still posting', async () => {
    exec.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ Success: true, MaterialDocument: '4900012345', MaterialDocYear: '2026' }), 200)));

    await Promise.all([send('id-1').catch((e) => e), send('id-2').catch((e) => e)]);

    expect(exec.mock.calls.length).toBeLessThanOrEqual(1);
  });

  describe.each(['sending', 'posted'])('a claim that passed its check just before another claim was written (%s)', (status) => {
    const claim = (ReferenceDocument) => GoodsIssueAttemptStore.createOrGet(
      { ReferenceDocument, RequestHash: 'same-hu-and-quantity', MovementType: '311', IssueQty: 1 },
      { reclaimableStatuses: ['rejected'], isReclaimable: (latest) => latest.Status === 'posted' }
    );

    it('steps back, is recorded as not sent, and returns the other attempt', async () => {
      const first = await claim('HUFIRST');
      await GoodsIssueAttemptStore.setStatus(first.row.ReferenceDocument, status);
      // The second request's check ran before the first request's row was written.
      jest.spyOn(GoodsIssueAttemptStore, '_attemptsByRequestHash').mockResolvedValueOnce([]);

      const second = await claim('HUSECOND');

      expect(second.created).toBe(false);
      expect(second.row.ReferenceDocument).toBe(first.row.ReferenceDocument);
      expect((await GoodsIssueAttemptStore.getByReference('HUSECOND0')).Status).toBe('rejected');
    });
  });
});

describe('multi-HU posting HTTP regressions', () => {
  const body = { ReservationNo: '529960', ReservationItem: '1', ClientAttemptId: 'selection-regression', Selections: [
    { UnitNumber: 'HU1', TransferQty: 1 }, { UnitNumber: 'HU2', TransferQty: 1 }, { UnitNumber: 'HU3', TransferQty: 1 }
  ] };
  let validate, execute, claim, status;
  beforeEach(() => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ Plant: '1120' });
    validate = jest.spyOn(HuStockTransferAdapter.prototype, 'validateHuStockTransferSelection').mockResolvedValue({ Valid: true });
    execute = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({ MaterialDocument: '4900012345', MaterialDocYear: '2026', Success: true });
    claim = jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockImplementation(async (attempt) => ({ created: true, row: { ...attempt, ReferenceDocument: `${attempt.ReferenceDocument}0` } }));
    status = jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['test-clerk-1130', 'test-viewer-1120'])('denies out-of-scope/role user %s before validation or claims', async (user) => {
    await expect(POST(`${base}/executeHuStockTransferSelection`, body, as(user))).rejects.toMatchObject({ response: { status: 403 } });
    expect(validate).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects missing attempt ID and failed selection prevalidation before claims', async () => {
    await expect(POST(`${base}/executeHuStockTransferSelection`, { ...body, ClientAttemptId: '' }, as('khushal'))).rejects.toMatchObject({ response: { status: 400 } });
    validate.mockRejectedValue(Object.assign(new Error('selection exceeds open quantity'), { status: 422 }));
    await expect(POST(`${base}/executeHuStockTransferSelection`, body, as('test-clerk-1120'))).rejects.toMatchObject({ response: { status: 422 } });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('posts sequentially after validation and uses a distinct claim per HU', async () => {
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('test-clerk-1120'));
    expect(data).toMatchObject({ Success: true, PostedCount: 3, FailedCount: 0, SkippedCount: 0 });
    expect(data.Items.map((item) => item.UnitNumber)).toEqual(['HU1', 'HU2', 'HU3']);
    expect(execute.mock.calls.map(([payload]) => payload.ClientAttemptId)).toEqual(['selection-regression-1', 'selection-regression-2', 'selection-regression-3']);
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(claim.mock.invocationCallOrder[0]);
    expect(status.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[1]);
    expect(new Set(claim.mock.calls.map(([row]) => row.ReferenceDocument)).size).toBe(3);
  });

  it('keeps posted results, records unknown outcome, and leaves later HUs untouched', async () => {
    execute.mockResolvedValueOnce({ MaterialDocument: '4900012345', MaterialDocYear: '2026' }).mockRejectedValueOnce(Object.assign(new Error('read-back unavailable'), { sapWriteAttempted: true, status: 502 }));
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('khushal'));
    expect(data).toMatchObject({ Success: false, PostedCount: 1, FailedCount: 1, SkippedCount: 1 });
    expect(data.Items).toEqual([
      expect.objectContaining({ UnitNumber: 'HU1', Success: true, MaterialDocument: '4900012345' }),
      expect.objectContaining({ UnitNumber: 'HU2', Success: false, Message: 'read-back unavailable' })
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(status.mock.calls.map((call) => call[1])).toEqual(['posted', 'unconfirmed']);
  });

  it('blocks posting when attempt logging is unavailable', async () => {
    claim.mockRejectedValue(new Error('database unavailable'));
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('khushal'));
    expect(data).toMatchObject({ Success: false, PostedCount: 0, FailedCount: 1, SkippedCount: 2 });
    expect(execute).not.toHaveBeenCalled();
  });
});
