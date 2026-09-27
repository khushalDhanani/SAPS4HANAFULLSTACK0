const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

describe('TrToAdapter Unit Tests', () => {
  let mockClient;
  let adapter;

  beforeEach(() => {
    mockClient = {
      destinationName: 'S4HANA_PO_API',
      get: jest.fn(),
      post: jest.fn()
    };
    adapter = new TrToAdapter({ client: mockClient });
  });

  describe('getTR', () => {
    it('should reject when tbnum is missing or empty', async () => {
      await expect(adapter.getTR('')).rejects.toThrow('Transfer Requirement number (tbnum) is required');
      await expect(adapter.getTR(null)).rejects.toThrow('Transfer Requirement number (tbnum) is required');
    });

    it('should successfully fetch and format TR header and items', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          d: {
            Lgnum: 'W01',
            Tbnum: '0001000663',
            Bwlvs: '319',
            Betyp: 'P',
            Benum: '0001002749',
            Rsnum: '0000517858',
            Bdatu: '/Date(1758585600000)/',
            Statu: '',
            Nltyp: '100',
            Nlpla: 'PROD-01',
            ToItems: {
              results: [
                {
                  Lgnum: 'W01',
                  Tbnum: '0001000663',
                  Tbpos: '0001',
                  Matnr: '000000001000000867',
                  Maktx: 'IPA, Extra Pure',
                  Werks: '1120',
                  Lgort: 'CS01',
                  Charg: 'IN25003572',
                  Menge: '17323.200',
                  Tamen: '0.000',
                  Meins: 'KG',
                  Elikz: ''
                },
                {
                  Lgnum: 'W01',
                  Tbnum: '0001000663',
                  Tbpos: '0002',
                  Matnr: '000000001000000869',
                  Maktx: 'SOLVESSO 108',
                  Werks: '1120',
                  Lgort: 'CS01',
                  Charg: '',
                  Menge: '13929.600',
                  Tamen: '1000.000',
                  Meins: 'KG',
                  Elikz: ''
                }
              ]
            }
          }
        }
      });

      const result = await adapter.getTR('1000663', 'W01');

      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("TRHeaderSet(Lgnum='W01',Tbnum='0001000663')?$expand=ToItems")
      );
      expect(result.Tbnum).toBe('0001000663');
      expect(result.Benum).toBe('0001002749');
      expect(result.Items).toHaveLength(2);
      expect(result.Items[0].Material).toBe('000000001000000867');
      expect(result.Items[0].MaterialDesc).toBe('IPA, Extra Pure');
      expect(result.Items[0].OpenQty).toBe(17323.2);
      expect(result.Items[1].OpenQty).toBe(12929.6);
    });

    it('should throw 404 when TR is not returned by S/4HANA', async () => {
      mockClient.get.mockResolvedValueOnce({ data: { d: null } });

      await expect(adapter.getTR('0001000999', 'W01')).rejects.toThrow(
        'Transfer Requirement 0001000999 not found in warehouse W01'
      );
    });

    it('should translate S/4HANA Gateway error messages cleanly', async () => {
      const s4Error = new Error('HTTP request failed');
      s4Error.status = 500;
      s4Error.response = {
        status: 500,
        data: {
          error: {
            message: { value: 'Transfer Requirement is currently locked by user OPERATOR1' }
          }
        }
      };
      mockClient.get.mockRejectedValueOnce(s4Error);

      await expect(adapter.getTR('0001000663', 'W01')).rejects.toThrow(
        'Failed to retrieve Transfer Requirement 0001000663: Transfer Requirement is currently locked by user OPERATOR1'
      );
    });
  });

  describe('checkSU', () => {
    it('should reject when lenum is missing', async () => {
      await expect(adapter.checkSU('', '0001000663')).rejects.toThrow('Storage Unit number (lenum) is required');
      await expect(adapter.checkSU(null, '0001000663')).rejects.toThrow('Storage Unit number (lenum) is required');
    });

    it('should return valid Storage Unit and quants when matched in SAP', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              {
                Lgnum: 'W01',
                Lenum: '00000000001000043935',
                Tbnum: '0001000663',
                Lgtyp: 'OH1',
                Lgpla: 'ONHOLD',
                Letyp: 'E3',
                IsValid: true,
                ErrorCode: 'VALID',
                ErrorMessage: 'Storage Unit verified successfully in bin ONHOLD.',
                ToQuants: {
                  results: [
                    {
                      Lgnum: 'W01',
                      Lqnum: '0001035375',
                      Lenum: '00000000001000043935',
                      Matnr: '000000001000000867',
                      Maktx: 'IPA, Extra Pure',
                      Werks: '1120',
                      Lgort: 'CS01',
                      Charg: 'IN25003572',
                      Verme: '11210.000',
                      Meins: 'KG',
                      Lgtyp: 'OH1',
                      Lgpla: 'ONHOLD'
                    }
                  ]
                }
              }
            ]
          }
        }
      });

      const result = await adapter.checkSU('1000043935', '1000663', 'W01');

      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining('StorageUnitSet?$filter=')
      );
      expect(result.IsValid).toBe(true);
      expect(result.StorageUnit).toBe('00000000001000043935');
      expect(result.Quants).toHaveLength(1);
      expect(result.Quants[0].AvailableStock).toBe(11210.0);
      expect(result.Quants[0].Material).toBe('000000001000000867');
    });

    it('should return IsValid: false when Storage Unit is not found', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { d: { results: [] } }
      });

      const result = await adapter.checkSU('9999999999', '1000663', 'W01');
      expect(result.IsValid).toBe(false);
      expect(result.ErrorCode).toBe('SU_NOT_FOUND');
      expect(result.Quants).toEqual([]);
    });
  });

  describe('createTO', () => {
    it('should validate mandatory parameters', async () => {
      await expect(adapter.createTO({})).rejects.toThrow('Transfer Requirement number (tbnum) is required');
      await expect(adapter.createTO({ tbnum: '1000663' })).rejects.toThrow('Storage Unit number (lenum) is required');
      await expect(adapter.createTO({ tbnum: '1000663', lenum: '1000043935' })).rejects.toThrow(
        'Quantity must be greater than zero'
      );
      await expect(adapter.createTO({ tbnum: '1000663', lenum: '1000043935', qty: 0 })).rejects.toThrow(
        'Quantity must be greater than zero'
      );
    });

    it('should synchronously create and confirm Transfer Order in 1 step', async () => {
      mockClient.post.mockResolvedValueOnce({
        data: {
          d: {
            Tanum: '0000012345',
            Success: 'S',
            Message: 'Transfer Order 0000012345 created and confirmed in 1 step.',
            Confirmed: true
          }
        }
      });

      const result = await adapter.createTO({
        lgnum: 'W01',
        tbnum: '0001000663',
        tbpos: '0001',
        lenum: '00000000001000043935',
        qty: 500,
        unit: 'KG',
        confirmImmediate: true
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/sap/opu/odata/sap/ZWM_RF_TRTO_SRV/CreateTO',
        {
          Lgnum: 'W01',
          Tbnum: '0001000663',
          Tbpos: '0001',
          Lenum: '00000000001000043935',
          Qty: '500',
          Unit: 'KG',
          ConfirmImmediate: 'X'
        }
      );
      expect(result.TransferOrder).toBe('0000012345');
      expect(result.Success).toBe(true);
      expect(result.Confirmed).toBe(true);
    });

    it('should throw synchronously on SAP error without queuing', async () => {
      mockClient.post.mockResolvedValueOnce({
        data: {
          d: {
            Tanum: '',
            Success: 'E',
            Message: 'Transfer Requirement is already completed.'
          }
        }
      });

      await expect(
        adapter.createTO({
          lgnum: 'W01',
          tbnum: '0001000663',
          lenum: '00000000001000043935',
          qty: 100
        })
      ).rejects.toThrow('Transfer Requirement is already completed.');
    });
  });
});
