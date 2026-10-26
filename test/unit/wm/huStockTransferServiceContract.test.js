'use strict';

/**
 * HuStockTransferService HTTP contract [mock only, not SAP verification]:
 *  - precheck fields (TransferPath, BlockerDetails, WarningDetails) are part of the OData contract;
 *  - plant scope is enforced server-side for plant-scoped users (dave: 1130, carol: 1120, alice: Admin);
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
    const v = await GET(`${base}/validateUnit(reservation='529960',item='1',unitNumber='HU1')`, as('alice'));
    expect(v.data.BlockerDetails[0]).toMatchObject({ key: 'blockerOpenDeliveryExists', params: ['80000097', '529960', '1'] });
    expect(v.data.WarningDetails[0]).toMatchObject({ key: 'warningNoT319ARow', severity: 'warning' });
    const c = await GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, as('alice'));
    expect(c.data.TransferPath).toBe('A');
  });

  it('denies a plant-scoped user (dave, 1130) every reservation-keyed read and the posting action for a plant-1120 reservation', async () => {
    const exec = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({ Success: true, MaterialDocument: '1' });
    const bins = jest.spyOn(HuStockTransferAdapter.prototype, 'getStorageBins').mockResolvedValue([]);
    const dave = as('dave');
    await expect(GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, dave)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/getStorageBins(reservation='529960',item='1')`, dave)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/rackLayout(warehouse='W01',storageType='',rackPrefix='',reservation='',item='')`, dave)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(`${base}/getOpenReservations(plant='1120',storageLocation='',movementType='311',requester='',reservation='',material='',status='open',includeDeleted=false)`, dave))
      .rejects.toMatchObject({ response: { status: 403 } });
    await expect(POST(`${base}/executeHuStockTransfer`, { ReservationNo: '529960', ReservationItem: '1', UnitNumber: '2000019372', TransferQty: 1, ClientAttemptId: 'scope-1' }, dave))
      .rejects.toMatchObject({ response: { status: 403 } });
    expect(exec).not.toHaveBeenCalled();
    expect(bins).not.toHaveBeenCalled();
  });

  it('allows the plant-scoped clerk of plant 1120 (carol) and the Admin (alice)', async () => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'getStorageBins').mockResolvedValue([]);
    const carol = await GET(`${base}/getStorageBins(reservation='529960',item='1')`, as('carol'));
    expect(carol.status).toBe(200);
    const alice = await GET(`${base}/getCockpitDetail(reservation='529960',item='1')`, as('alice'));
    expect(alice.data.Plant).toBe('1120');
  });

  it("records 'unconfirmed' with the document when the adapter reports an unknown SAP outcome, 'rejected' otherwise", async () => {
    const setStatus = jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockResolvedValue();
    jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockResolvedValue({ created: true, row: {} });
    const unconfirmed = Object.assign(new Error('Stock transfer outcome is unconfirmed in SAP'), { status: 502, sapWriteAttempted: true, materialDocument: '4900012345', materialDocYear: '2026' });
    const exec = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockRejectedValueOnce(unconfirmed)
      .mockRejectedValueOnce(Object.assign(new Error('SAP rejected stock transfer'), { status: 422 }));
    const body = { ReservationNo: '529960', ReservationItem: '1', UnitNumber: '2000019372', TransferQty: 1, ClientAttemptId: 'unc-1' };

    await expect(POST(`${base}/executeHuStockTransfer`, body, as('alice'))).rejects.toMatchObject({ response: { status: 502 } });
    expect(setStatus).toHaveBeenLastCalledWith(expect.any(String), 'unconfirmed', expect.objectContaining({ MaterialDocument: '4900012345', MaterialDocYear: '2026' }));

    await expect(POST(`${base}/executeHuStockTransfer`, { ...body, ClientAttemptId: 'unc-2' }, as('alice'))).rejects.toMatchObject({ response: { status: 422 } });
    expect(setStatus).toHaveBeenLastCalledWith(expect.any(String), 'rejected', expect.objectContaining({ LastError: 'SAP rejected stock transfer' }));
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

// HTTP posts below target only the local CAP test server; all SAP posting is mocked.
describe('multi-HU posting HTTP regressions', () => {
  const body = { ReservationNo: '529960', ReservationItem: '1', ClientAttemptId: 'selection-regression', Selections: [
    { UnitNumber: 'HU1', TransferQty: 1 }, { UnitNumber: 'HU2', TransferQty: 1 }, { UnitNumber: 'HU3', TransferQty: 1 }
  ] };
  let validate, execute, claim, status;
  beforeEach(() => {
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ Plant: '1120' });
    validate = jest.spyOn(HuStockTransferAdapter.prototype, 'validateHuStockTransferSelection').mockResolvedValue({ Valid: true });
    execute = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({ MaterialDocument: '4900012345', MaterialDocYear: '2026', Success: true });
    claim = jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockResolvedValue({ created: true });
    status = jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['dave', 'bob'])('denies out-of-scope/role user %s before validation or claims', async (user) => {
    await expect(POST(`${base}/executeHuStockTransferSelection`, body, as(user))).rejects.toMatchObject({ response: { status: 403 } });
    expect(validate).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects missing attempt ID and failed selection prevalidation before claims', async () => {
    await expect(POST(`${base}/executeHuStockTransferSelection`, { ...body, ClientAttemptId: '' }, as('alice'))).rejects.toMatchObject({ response: { status: 400 } });
    validate.mockRejectedValue(Object.assign(new Error('selection exceeds open quantity'), { status: 422 }));
    await expect(POST(`${base}/executeHuStockTransferSelection`, body, as('carol'))).rejects.toMatchObject({ response: { status: 422 } });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('posts sequentially after validation and uses a distinct claim per HU', async () => {
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('carol'));
    expect(data).toMatchObject({ Success: true, PostedCount: 3, FailedCount: 0, SkippedCount: 0 });
    expect(data.Items.map((item) => item.UnitNumber)).toEqual(['HU1', 'HU2', 'HU3']);
    expect(execute.mock.calls.map(([payload]) => payload.ClientAttemptId)).toEqual(['selection-regression-1', 'selection-regression-2', 'selection-regression-3']);
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(claim.mock.invocationCallOrder[0]);
    expect(status.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[1]);
    expect(new Set(claim.mock.calls.map(([row]) => row.ReferenceDocument)).size).toBe(3);
  });

  it('keeps posted results, records unknown outcome, and leaves later HUs untouched', async () => {
    execute.mockResolvedValueOnce({ MaterialDocument: '4900012345', MaterialDocYear: '2026' }).mockRejectedValueOnce(Object.assign(new Error('read-back unavailable'), { sapWriteAttempted: true, status: 502 }));
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('alice'));
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
    const { data } = await POST(`${base}/executeHuStockTransferSelection`, body, as('alice'));
    expect(data).toMatchObject({ Success: false, PostedCount: 0, FailedCount: 1, SkippedCount: 2 });
    expect(execute).not.toHaveBeenCalled();
  });
});
