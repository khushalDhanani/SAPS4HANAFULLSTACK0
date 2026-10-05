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

    it('returns UNKNOWN without staged quantity when the LQUA read fails', async () => {
      const rfc = mockRfc({ LQUA: () => { throw new Error('SAP RFC error AD 718'); } });
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });
      const res = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        targetType: 'IP1', targetBin: 'SAP-BIN', requiredQty: 40, uom: 'KG'
      });

      expect(res).toMatchObject({ isVerified: false, isStaged: false, stagingStatus: 'UNKNOWN' });
      expect(res.error).toContain('LQUA read failed: SAP RFC error AD 718');
      expect(res).not.toHaveProperty('stagedQty');
      expect(res).not.toHaveProperty('plannedUnconfirmedQty');
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
        'Only 15 of 40 KG staged in W01/100/STAGE-01. 25 of 40 KG in transfer; 15 KG confirmed in the bin. Transfer requirement 0000000789 needs a confirmed transfer order (LT04/LT12).'
      );
    });

    it('reports plannedUnconfirmedQty (EINME) separately from confirmed bin stock', async () => {
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
      expect(res.error).toContain('40 of 40 KG in transfer; 0 KG confirmed in the bin.');
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

    it('returns UNKNOWN for a dynamic target rather than deriving it from order number', async () => {
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
        targetBin: '',
        status: 'UNKNOWN',
        stagingSource: 'PKHD_DYNAMIC_BIN',
        warehouse: 'W01',
        error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
      });
    });

    it('returns UNKNOWN instead of deriving a dynamic bin from a 12-character SAP order number', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          PKHD: [{
            MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01',
            LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X'
          }]
        })
      });

      await expect(client.findStagingTarget(
        '1000000867', '1000', '1100', 'W01', 'PSA-LINE1', '000001002599', 'IP1'
      )).resolves.toMatchObject({
        status: 'UNKNOWN', targetBin: '', stagingSource: 'PKHD_DYNAMIC_BIN',
        error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
      });
    });

    it('returns UNKNOWN instead of deriving a dynamic bin from a 10-digit order number', async () => {
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc: mockRfc({
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X' }]
      }) });
      await expect(client.findStagingTarget('1000000867', '1000', '1100', 'W01', 'PSA-LINE1', '1234567890', 'IP1'))
        .resolves.toMatchObject({
          status: 'UNKNOWN', targetBin: '', stagingSource: 'PKHD_DYNAMIC_BIN',
          error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
        });
    });

    it('returns UNKNOWN for a dynamic-bin reservation with a nonnumeric order number', async () => {
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc: mockRfc({
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X' }]
      }) });
      await expect(client.findStagingTarget('1000000867', '1000', '1100', 'W01', 'PSA-LINE1', 'ORDER-99', 'IP1'))
        .resolves.toMatchObject({
          status: 'UNKNOWN', stagingSource: 'PKHD_DYNAMIC_BIN', targetBin: '',
          error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
        });
    });

    it('returns UNKNOWN for a dynamic-bin reservation with an overlong order number', async () => {
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc: mockRfc({
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X' }]
      }) });
      await expect(client.findStagingTarget('1000000867', '1000', '1100', 'W01', 'PSA-LINE1', '123456789012', 'IP1'))
        .resolves.toMatchObject({
          status: 'UNKNOWN', stagingSource: 'PKHD_DYNAMIC_BIN', targetBin: '',
          error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
        });
    });

    it('does not read LQUA or report zero staged when a dynamic target has no TR', async () => {
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        PKHD: [{
          MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01',
          LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X'
        }]
      });
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });
      const result = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        requiredQty: 10, uom: 'KG', resNo: '519366', resItem: '1', orderNo: '000001002599'
      });

      expect(result).toMatchObject({
        isVerified: true, isStaged: false, stagingStatus: 'NOT_STAGED',
        targetBin: '', error: 'No transfer requirement found for reservation 519366.'
      });
      expect(result).not.toHaveProperty('stagedQty');
      expect(rfc.readTable.mock.calls.some(([table]) => table === 'LQUA')).toBe(false);
    });

    it('returns UNKNOWN with SAP error code and table when LTBK read fails during checkStaging', async () => {
      const rfc = {
        readTable: jest.fn((table) => {
          if (table === 'T320') return Promise.resolve([{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }]);
          if (table === 'PKHD') return Promise.resolve([{
            MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01',
            LGTYP: 'IP1', LGPLA: '', BERKZ: '1', NKDYN: 'X'
          }]);
          if (table === 'LTBK') {
            const err = new Error('SAP RFC communication failure');
            err.code = 'RFC_COMM_FAILURE';
            return Promise.reject(err);
          }
          return Promise.resolve([]);
        })
      };
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });
      const result = await client.checkStaging({
        material: '1000000867', plant: '1000', sloc: '1100', warehouse: 'W01',
        requiredQty: 10, uom: 'KG', resNo: '519366', resItem: '1', orderNo: '000001002599'
      });

      expect(result).toMatchObject({
        isVerified: false, isStaged: false, stagingStatus: 'UNKNOWN',
        targetBin: '', error: expect.stringContaining('LTBK read failed')
      });
      expect(result).not.toHaveProperty('stagedQty');
    });

    it('uses an explicit bin unchanged for another storage type with a different bin length', async () => {
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc: mockRfc({
        PKHD: [{ MATNR: '000000001000000867', PRVBE: 'PSA-LINE1', WERKS: '1000', LGNUM: 'W01', LGTYP: 'R01', LGPLA: 'R-12', BERKZ: '1', NKDYN: 'X' }]
      }) });
      await expect(client.findStagingTarget('1000000867', '1000', '1100', 'W01', 'PSA-LINE1', '000001002599', 'R01'))
        .resolves.toMatchObject({ targetType: 'R01', targetBin: 'R-12', stagingSource: 'PKHD_CONTROL_CYCLE' });
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

    it('returns NOT_STAGED when WM reservation has no PKHD bin and no LTBK TR', async () => {
      const rfc = mockRfc({
        T320: [{ LGNUM: 'W01', WERKS: '1000', LGORT: '1100' }],
        RESB: [{
          MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
          BDMNG: '50', ENMNG: '0', MEINS: 'KG', LGTYP: '100', PRVBE: 'PSA-LINE1'
        }],
        PKHD: []
      });
      const client = new GoodsIssuePhase6StagingClient({ adapter: mockAdapter(), rfc });

      await expect(client.getStagingForReservation('519366', '0001')).resolves.toMatchObject({
        stagingStatus: 'NOT_STAGED',
        isStaged: false,
        transferRequirementStatus: 'NOT_FOUND',
        targetBin: ''
      });
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
      expect(result.error).toContain('20 of 10 KG in transfer; 4 KG confirmed in the bin.');
    });

    it('includes warehouse and unknown transfer status when TR table reads fail', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LTBK: () => { throw new Error('Table unavailable'); },
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
      expect(result.error).toContain('Transfer requirement status unknown; check whether a TR/TO exists, and confirm the TO if one is open.');
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

  describe('reservation transfer requirement and target resolution', () => {
    it('resolves TR destination from LTBK by RSNUM when TR found', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LTBK: [
            { TBNUM: '0000000789', RSNUM: '0000012345', LGNUM: 'W01', NLTYP: 'IP1', NLPLA: 'STAGE-01' }
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

    it('returns NOT_FOUND when LTBK returns an empty read (no TR)', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({ LTBK: [] })
      });

      const res = await client.findTransferRequirement('12345', '1', '', '', 'W01', true);
      expect(res.status).toBe('NOT_FOUND');
      expect(res.error).toContain('No transfer requirement found');
    });

    it('returns UNKNOWN with SAP error code and table when LTBK read fails', async () => {
      const err = new Error('ID:DA Type:E Number:131 LTBK');
      err.code = 'DA_131';
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LTBK: () => { throw err; }
        })
      });

      const res = await client.findTransferRequirement('12345', '1', '', '', 'W01', true);
      expect(res.status).toBe('UNKNOWN');
      expect(res.table).toBe('LTBK');
      expect(res.errorCode).toBe('DA_131');
      expect(res.error).toContain('Cannot verify staging: SAP LTBK read failed (DA_131).');
    });

    it('returns UNKNOWN with multiple destinations when multiple TRs have different destinations', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          LTBK: [
            { TBNUM: '0000000789', RSNUM: '0000012345', LGNUM: 'W01', NLTYP: 'IP1', NLPLA: 'STAGE-01' },
            { TBNUM: '0000000790', RSNUM: '0000012345', LGNUM: 'W01', NLTYP: 'IP2', NLPLA: 'STAGE-02' }
          ]
        })
      });

      const res = await client.findTransferRequirement('12345', '1', '', '', 'W01', true);
      expect(res.status).toBe('UNKNOWN');
      expect(res.error).toContain('multiple destinations');
    });

    it('returns NOT_WM_MANAGED when plant/sloc has no T320 warehouse mapping', async () => {
      const client = new GoodsIssuePhase6StagingClient({
        adapter: mockAdapter(),
        rfc: mockRfc({
          T320: [],
          RESB: [{
            RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000',
            LGORT: '1100', BDMNG: '50.000', ENMNG: '10.000', MEINS: 'KG',
            AUFNR: '0000001001', LGTYP: '', PRVBE: ''
          }]
        })
      });

      const res = await client.getStagingForReservation('519366', '0001');
      expect(res.stagingStatus).toBe('NOT_WM_MANAGED');
      expect(res.isStagingRequired).toBe(false);
      expect(res.isVerified).toBe(true);
      expect(res.isStaged).toBe(true);
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
