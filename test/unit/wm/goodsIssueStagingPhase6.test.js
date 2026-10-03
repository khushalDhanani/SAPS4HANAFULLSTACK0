const { GoodsIssuePhase6StagingClient } = require('../../../srv/integration/s4hana/wm/goods-issue');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

describe('GoodsIssuePhase6StagingClient – Staging Validation (Phase 6)', () => {
  const mockRfc = (overrides = {}) => ({
    readTable: jest.fn((table, fields, where) => {
      if (overrides[table]) {
        return Promise.resolve(typeof overrides[table] === 'function' ? overrides[table](where) : overrides[table]);
      }
      return Promise.resolve([]);
    })
  });

  const mockAdapter = (overrides = {}) => ({
    _get: jest.fn((path) => {
      if (overrides[path]) return Promise.resolve(overrides[path]);
      if (path.includes('ReservationDocumentItem')) {
        return Promise.resolve([
          {
            Reservation: '519366',
            ReservationItem: '0001',
            Product: '1000000867',
            Plant: '1000',
            StorageLocation: '1100',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '50',
            ResvnItmWithdrawnQtyInBaseUnit: '10'
          }
        ]);
      }
      return Promise.resolve([]);
    })
  });

  describe('checkStaging', () => {
    it('returns isStagingRequired: false when target bin/type cannot be resolved', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc()
      });

      const res = await client.checkStaging({
        material: '1000000867',
        plant: '1000',
        sloc: '1100',
        requiredQty: 40,
        uom: 'KG'
      });

      expect(res.isStaged).toBe(true);
      expect(res.isStagingRequired).toBe(false);
    });

    it('returns isFullyStaged: true when staged stock (VERME) in staging bin satisfies requiredQty', async () => {
      const rfc = mockRfc({
        LQUA: [
          {
            LGNUM: 'W01',
            LGTYP: '100',
            LGPLA: 'STAGE-01',
            MATNR: '000000001000000867',
            WERKS: '1000',
            LGORT: '1100',
            VERME: '50.000',
            EINME: '0.000',
            MEINS: 'KG'
          }
        ]
      });

      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc
      });

      const res = await client.checkStaging({
        material: '1000000867',
        plant: '1000',
        sloc: '1100',
        warehouse: 'W01',
        targetType: '100',
        targetBin: 'STAGE-01',
        requiredQty: 40,
        uom: 'KG',
        tbnum: '0000000789'
      });

      expect(res.isStaged).toBe(true);
      expect(res.isFullyStaged).toBe(true);
      expect(res.stagedQty).toBe(50);
      expect(res.requiredQty).toBe(40);
      expect(res.targetType).toBe('100');
      expect(res.targetBin).toBe('STAGE-01');
    });

    it('blocks and returns requirement 5 error message when staged qty < required qty', async () => {
      const rfc = mockRfc({
        LQUA: [
          {
            LGNUM: 'W01',
            LGTYP: '100',
            LGPLA: 'STAGE-01',
            MATNR: '000000001000000867',
            WERKS: '1000',
            LGORT: '1100',
            VERME: '15.000',
            EINME: '25.000',
            MEINS: 'KG'
          }
        ]
      });

      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc
      });

      const res = await client.checkStaging({
        material: '1000000867',
        plant: '1000',
        sloc: '1100',
        warehouse: 'W01',
        targetType: '100',
        targetBin: 'STAGE-01',
        requiredQty: 40,
        uom: 'KG',
        tbnum: '0000000789'
      });

      expect(res.isStaged).toBe(false);
      expect(res.isFullyStaged).toBe(false);
      expect(res.stagedQty).toBe(15);
      expect(res.requiredQty).toBe(40);
      expect(res.plannedUnconfirmedQty).toBe(25);
      expect(res.tbnum).toBe('0000000789');
      expect(res.error).toBe(
        'Only 15 of 40 KG staged in 100/STAGE-01. (25 KG TO created, not confirmed). Transfer requirement 0000000789 needs a confirmed transfer order (LT04/LT12) first.'
      );
    });

    it('reports plannedUnconfirmedQty (EINME) separately as TO created, not confirmed', async () => {
      const rfc = mockRfc({
        LQUA: [
          {
            LGNUM: 'W01',
            LGTYP: '100',
            LGPLA: 'STAGE-01',
            MATNR: '000000001000000867',
            WERKS: '1000',
            LGORT: '1100',
            VERME: '0.000',
            EINME: '40.000',
            MEINS: 'KG'
          }
        ]
      });

      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc
      });

      const res = await client.checkStaging({
        material: '1000000867',
        plant: '1000',
        sloc: '1100',
        warehouse: 'W01',
        targetType: '100',
        targetBin: 'STAGE-01',
        requiredQty: 40,
        uom: 'KG',
        tbnum: '0000000999'
      });

      expect(res.isStaged).toBe(false);
      expect(res.stagedQty).toBe(0);
      expect(res.plannedUnconfirmedQty).toBe(40);
      expect(res.error).toContain('Only 0 of 40 KG staged in 100/STAGE-01');
      expect(res.error).toContain('(40 KG TO created, not confirmed)');
      expect(res.error).toContain('Transfer requirement 0000000999 needs a confirmed transfer order (LT04/LT12) first.');
    });
  });

  describe('getStagingForReservation', () => {
    it('resolves staging requirements end-to-end for reservation item', async () => {
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        PKHD: [{ PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01' }],
        LQUA: [
          {
            LGNUM: 'W01',
            LGTYP: '100',
            LGPLA: 'STAGE-01',
            MATNR: '000000001000000867',
            WERKS: '1000',
            LGORT: '1100',
            VERME: '40.000',
            EINME: '0.000',
            MEINS: 'KG'
          }
        ]
      });

      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc
      });

      const res = await client.getStagingForReservation('519366', '0001');
      expect(res.isStagingRequired).toBe(true);
      expect(res.isFullyStaged).toBe(true);
      expect(res.targetType).toBe('100');
      expect(res.targetBin).toBe('STAGE-01');
      expect(res.stagedQty).toBe(40);
      expect(res.requiredQty).toBe(40); // 50 - 10 withdrawn
    });
  });

  describe('GoodsIssueAdapter integration', () => {
    it('exposes checkStagingForReservation on GoodsIssueAdapter', async () => {
      const origClient = GoodsIssueAdapter.stagingClient;
      try {
        GoodsIssueAdapter.stagingClient = {
          getStagingForReservation: jest.fn().mockResolvedValue({
            isStaged: false,
            isFullyStaged: false,
            error: 'Only 0 of 10 PC staged in 100/BIN-1. Transfer requirement 001 needs a confirmed transfer order (LT04/LT12) first.'
          })
        };

        const result = await GoodsIssueAdapter.checkStagingForReservation('1234', '1');
        expect(result.isStaged).toBe(false);
        expect(result.error).toContain('Transfer requirement 001');
      } finally {
        GoodsIssueAdapter.stagingClient = origClient;
      }
    });
  });
});
