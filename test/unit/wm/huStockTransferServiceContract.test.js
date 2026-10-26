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
