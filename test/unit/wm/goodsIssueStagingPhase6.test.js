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
    it('marks a verified non-WM location as not requiring WM staging', async () => {
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

      expect(res.isVerified).toBe(true);
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
            MEINS: 'KG',
            BESTQ: '',
            SOBKZ: '',
            SKZUA: '',
            SKZSA: '',
            SKZSI: ''
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

      expect(res.isVerified).toBe(true);
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
            MEINS: 'KG',
            BESTQ: '',
            SOBKZ: '',
            SKZUA: '',
            SKZSA: '',
            SKZSI: ''
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
        'Only 15 of 40 KG staged in W01/100/STAGE-01. (25 KG TO created, not confirmed). Transfer requirement 0000000789 needs a confirmed transfer order (LT04/LT12).'
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
            MEINS: 'KG',
            BESTQ: '',
            SOBKZ: '',
            SKZUA: '',
            SKZSA: '',
            SKZSI: ''
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
      expect(res.error).toContain('Only 0 of 40 KG staged in W01/100/STAGE-01');
      expect(res.error).toContain('(40 KG TO created, not confirmed)');
      expect(res.error).toContain('Transfer requirement 0000000999 needs a confirmed transfer order (LT04/LT12).');
    });
  });

  describe('getStagingForReservation', () => {
    it('resolves staging requirements end-to-end for reservation item', async () => {
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        RESB: [{
          RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000',
          LGORT: '1100', BDMNG: '50.000', ENMNG: '10.000', MEINS: 'KG',
          AUFNR: '0000001001', LGTYP: '100', PRVBE: 'PSA-LINE1'
        }],
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01' }],
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
            MEINS: 'KG',
            BESTQ: '',
            SOBKZ: '',
            SKZUA: '',
            SKZSA: '',
            SKZSI: ''
          }
        ]
      });

      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc
      });

      const res = await client.getStagingForReservation('519366', '0001');
      expect(res.isStagingRequired).toBe(true);
      expect(res.isVerified).toBe(true);
      expect(res.isFullyStaged).toBe(true);
      expect(res.targetType).toBe('100');
      expect(res.targetBin).toBe('STAGE-01');
      expect(res.stagedQty).toBe(40);
      expect(res.requiredQty).toBe(40); // 50 - 10 withdrawn
    });

    it('converts the submitted issue quantity into the SAP reservation base unit', async () => {
      const adapter = mockAdapter();
      adapter.getMaterialPackagingUnits = jest.fn().mockResolvedValue([
        { Unit: 'KG', IsBaseUnit: true, FactorToBase: 1 },
        { Unit: 'EA', IsBaseUnit: false, FactorToBase: 2 }
      ]);
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        RESB: [{
          RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000',
          LGORT: '1100', BDMNG: '50.000', ENMNG: '10.000', MEINS: 'KG',
          AUFNR: '0000001001', LGTYP: '100', PRVBE: 'PSA-LINE1'
        }],
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01' }],
        LQUA: [{
          LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01', MATNR: '000000001000000867',
          WERKS: '1000', LGORT: '1100', VERME: '4.000', EINME: '0.000', MEINS: 'KG',
          BESTQ: '', SOBKZ: '', SKZUA: '', SKZSA: '', SKZSI: ''
        }]
      });
      const client = new GoodsIssuePhase6StagingClient({ adapter, rfc });

      const res = await client.getStagingForReservation('519366', '0001', { issueQty: 2, issueUnit: 'EA' });

      expect(adapter.getMaterialPackagingUnits).toHaveBeenCalledWith('1000000867');
      expect(res).toMatchObject({ isVerified: true, isStaged: true, requiredQty: 4, uom: 'KG' });
    });

    it('derives the dynamic staging bin only from the matching SAP control-cycle flags', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          PKHD: [
            { MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: '100', LGPLA: '', BERKZ: '1', NKDYN: 'X' },
            { MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: '100', LGPLA: '', BERKZ: '1', NKDYN: 'X' }
          ]
        })
      });

      await expect(client.findStagingTarget(
        '1000000867', '1000', '1100', 'W01', 'PSA-LINE1', '1001', '100'
      )).resolves.toMatchObject({
        isWm: true,
        targetType: '100',
        targetBin: '0000001001',
        stagingSource: 'PKHD_DYNAMIC_BIN',
        warehouse: 'W01'
      });
    });
  });

  describe('fail-closed WM staging verification', () => {
    it('rejects a WM reservation when SAP RESB has no staging type', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
          RESB: [{
            MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
            BDMNG: '50', ENMNG: '0', MEINS: 'KG', LGTYP: ''
          }]
        })
      });

      await expect(client.getStagingForReservation('519366', '0001'))
        .rejects.toThrow('no staging type for WM-managed reservation');
    });

    it('rejects a WM mapping when no SAP target bin/type is configured', async () => {
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        RESB: [{
          MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
          BDMNG: '50', ENMNG: '0', MEINS: 'KG', LGTYP: '100', PRVBE: 'PSA-LINE1'
        }],
        PKHD: []
      });
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });

      await expect(client.getStagingForReservation('519366', '0001')).rejects.toMatchObject({ status: 502 });
    });

    it('fails closed when the live SAP WM mapping cannot be read', async () => {
      const rfc = {
        readTable: jest.fn((table) => {
          if (table === 'RESB') {
            return Promise.resolve([{
              MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
              BDMNG: '50', ENMNG: '0', MEINS: 'KG', LGTYP: '100', PRVBE: 'PSA-LINE1'
            }]);
          }
          if (table === 'T320') return Promise.reject(new Error('SAP RFC unavailable'));
          return Promise.resolve([]);
        })
      };
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });

      await expect(client.getStagingForReservation('519366', '0001')).rejects.toThrow('SAP RFC unavailable');
    });

    it('counts only unrestricted, non-special, unblocked staged stock', async () => {
      const baseQuant = {
        LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01', MATNR: '000000001000000867',
        WERKS: '1000', LGORT: '1100', VERME: '20', EINME: '0', MEINS: 'KG',
        BESTQ: '', SOBKZ: '', SKZUA: '', SKZSA: '', SKZSI: ''
      };
      const rows = [
        { ...baseQuant, VERME: '6' },
        { ...baseQuant, BESTQ: 'Q' },
        { ...baseQuant, SOBKZ: 'E' },
        { ...baseQuant, SKZUA: 'X' },
        { ...baseQuant, SKZSA: 'X' },
        { ...baseQuant, SKZSI: 'X' }
      ];
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({ LQUA: rows })
      });

      const res = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: '100', targetBin: 'STAGE-01', requiredQty: 10, uom: 'KG'
      });
      expect(res.isVerified).toBe(true);
      expect(res.stagedQty).toBe(6);
      expect(res.isStaged).toBe(false);
    });

    it.each([
      ['LGTYP', '200'],
      ['LGPLA', 'OTHER-BIN']
    ])('rejects an SAP quant returned outside the requested %s staging scope', async (field, value) => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LQUA: [{
            LGNUM: 'W01', LGTYP: field === 'LGTYP' ? value : '100',
            LGPLA: field === 'LGPLA' ? value : 'STAGE-01',
            MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
            VERME: '100', EINME: '0', MEINS: 'KG',
            BESTQ: '', SOBKZ: '', SKZUA: '', SKZSA: '', SKZSI: ''
          }]
        })
      });

      await expect(client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: '100', targetBin: 'STAGE-01', requiredQty: 10, uom: 'KG'
      })).rejects.toThrow('outside the requested staging target');
    });

    it('does not treat planned EINME as available staging stock for 261', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LQUA: [{
            LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01', MATNR: '000000001000000867',
            WERKS: '1000', LGORT: '1100', VERME: '4', EINME: '20', MEINS: 'KG',
            BESTQ: '', SOBKZ: '', SKZUA: '', SKZSA: '', SKZSI: ''
          }]
        })
      });

      const result = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: '100', targetBin: 'STAGE-01', requiredQty: 10, uom: 'KG'
      });

      expect(result).toMatchObject({
        isVerified: true,
        isStaged: false,
        stagedQty: 4,
        requiredQty: 10,
        plannedUnconfirmedQty: 20
      });
      expect(result.error).toContain('TO created, not confirmed');
    });

    it('includes warehouse and unknown transfer status when TR table reads fail', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          TBPE: () => { throw new Error('Table unavailable'); },
          TBPK: () => { throw new Error('Table unavailable'); },
          LQUA: []
        })
      });
      const result = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: 'IP1', targetBin: 'STAGE-01', requiredQty: 40, uom: 'KG',
        resNo: '12345', resItem: '1'
      });

      expect(result.transferRequirementStatus).toBe('UNKNOWN');
      expect(result.error).toContain('0 of 40 KG staged in W01/IP1/STAGE-01.');
      expect(result.error).toContain('Transfer requirement status unknown');
    });

    it('fails closed when staged stock is reported in a different unit', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LQUA: [{
            LGNUM: 'W01', LGTYP: '100', LGPLA: 'STAGE-01', MATNR: '000000001000000867',
            WERKS: '1000', LGORT: '1100', VERME: '50', EINME: '0', MEINS: 'PC',
            BESTQ: '', SOBKZ: '', SKZUA: '', SKZSA: '', SKZSI: ''
          }]
        })
      });

      await expect(client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: '100', targetBin: 'STAGE-01', requiredQty: 10, uom: 'KG'
      })).rejects.toThrow('does not match reservation unit');
    });
  });

  describe('reservation transfer requirement', () => {
    it('preserves the existing transfer-number result and resolves an exact SAP destination when requested', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          TBPE: [{ TBNUM: '0000000789', TBPOS: '0001', RSNUM: '0000012345', RSPOS: '0001' }],
          LTBK: [
            { TBNUM: '0000000789', LGNUM: 'W01', NLTYP: 'IP1', NLPLA: 'STAGE-01' },
            { TBNUM: '0000000789', LGNUM: 'W02', NLTYP: 'IP2', NLPLA: 'OTHER-BIN' }
          ]
        })
      });

      await expect(client.findTransferRequirement('12345', '1')).resolves.toBe('0000000789');
      await expect(client.findTransferRequirement('12345', '1', '', '', 'W01', true)).resolves.toEqual({
        tbnum: '0000000789',
        status: 'FOUND',
        targetType: 'IP1',
        targetBin: 'STAGE-01'
      });
    });

    it('reports UNKNOWN when TBPE and TBPK reads fail, and NOT_FOUND when both reads succeed empty', async () => {
      const failedClient = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          TBPE: () => { throw new Error('Table unavailable'); },
          TBPK: () => { throw new Error('Table unavailable'); }
        })
      });
      const emptyClient = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc: mockRfc() });

      await expect(failedClient.findTransferRequirement('12345', '1', '', '', 'W01', true))
        .resolves.toEqual({ tbnum: '', status: 'UNKNOWN' });
      await expect(emptyClient.findTransferRequirement('12345', '1', '', '', 'W01', true))
        .resolves.toEqual({ tbnum: '', status: 'NOT_FOUND' });
    });
  });

  describe('GoodsIssueAdapter integration', () => {
    it('shares its configured RFC client with staging and stock-unit clients', () => {
      expect(GoodsIssueAdapter.rfc).toBeDefined();
      expect(GoodsIssueAdapter.stagingClient.rfc).toBe(GoodsIssueAdapter.rfc);
      expect(GoodsIssueAdapter.stockUnits.rfc).toBe(GoodsIssueAdapter.rfc);
    });

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
