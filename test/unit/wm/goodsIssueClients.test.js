const BaseGoodsIssueClient = require('../../../srv/integration/s4hana/wm/goods-issue/BaseGoodsIssueClient');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

function mockStrictReadBack(client, movementType) {
  client.readBackDocument = jest.fn(async (document, year) => ({
    MaterialDocument: document, MaterialDocYear: year, Confirmed: true,
    Items: [{ GoodsMovementType: movementType }]
  }));
}

describe('Goods Issue Domain Clients Unit Tests', () => {
  describe('BaseGoodsIssueClient', () => {
    it('should correctly detect backend outages and network errors in _isOutage', () => {
      const client = new BaseGoodsIssueClient();

      expect(client._isOutage(null)).toBe(false);
      expect(client._isOutage({ status: 502 })).toBe(true);
      expect(client._isOutage({ status: 503 })).toBe(true);
      expect(client._isOutage({ status: 504 })).toBe(true);
      expect(client._isOutage({ code: 'ECONNREFUSED' })).toBe(true);
      expect(client._isOutage({ code: 'ETIMEDOUT' })).toBe(true);
      expect(client._isOutage({ code: 'DESTINATION_NOT_CONFIGURED' })).toBe(true);
      expect(client._isOutage({ message: 'Network Error: connection refused' })).toBe(true);
      expect(client._isOutage({ status: 404, message: 'Not found' })).toBe(false);
    });

    it('should format dates and enrich batch status using shared utilities', () => {
      const client = new BaseGoodsIssueClient();
      expect(client._formatDate('/Date(1767225600000)/')).toBe('2026-01-01');

      const expiredStatus = client._enrichBatchStatus('2020-01-01');
      expect(expiredStatus.StatusState).toBe('Error');
      expect(expiredStatus.StatusText).toBe('EXPIRED');

      const validStatus = client._enrichBatchStatus('2035-01-01');
      expect(validStatus.StatusState).toBe('Success');
      expect(validStatus.StatusText).toBe('VALID');
    });
  });


  describe('GoodsIssuePostingClient', () => {
    it.each(['', '   '])('rejects a 201 with missing or whitespace-only CostCenter before HTTP submit [MOCK]', async (costCenter) => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'MOCK_S4' }),
        _post: jest.fn(() => { throw new Error('unexpected HTTP POST reached from invalid input'); })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      let caught;
      try {
        await postingClient.postGoodsIssue('', '1', 'MAT01', 10, 'KG', '', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter });
      } catch (err) {
        caught = err;
      }

      expect(mockAdapter._post).not.toHaveBeenCalled();
      expect(caught?.status).toBe(400);
      expect(caught?.message).toContain('Property CostCenter is mandatory for GoodsMovementType 201');
    });

    it('rejects zero and negative quantities before HTTP submit [MOCK]', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'MOCK_S4' }),
        _post: jest.fn(() => { throw new Error('unexpected HTTP POST'); })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      await expect(postingClient.postGoodsIssue('10001', '1', 'MAT01', 0, 'KG', '', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' }))
        .rejects.toThrow('IssueQty must be a positive decimal number');
      await expect(postingClient.postGoodsIssue('10001', '1', 'MAT01', -5, 'KG', '', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' }))
        .rejects.toThrow('IssueQty must be a positive decimal number');
      expect(mockAdapter._post).not.toHaveBeenCalled();
    });

    it('should block posting if batch is expired', async () => {
      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: false, reason: 'Batch EXPIRED01 has expired.' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      await expect(
        postingClient.postGoodsIssue('10001', '1', 'MAT01', 10, 'KG', 'EXPIRED01', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' })
      ).rejects.toThrow('Batch EXPIRED01 has expired.');
    });

    const postedWithBatch = async () => {
      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900009999', MaterialDocYear: '2026', TransferOrder: '123' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      mockStrictReadBack(postingClient, '201');
      const res = await postingClient.postGoodsIssue('10001', '1', 'MAT01', 10, 'KG', 'B01', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: '1011101301' });
      return { res, body: mockAdapter._post.mock.calls[0][1] };
    };

    it('should send the requested batch on the posted item', async () => {
      const { body } = await postedWithBatch();
      expect(body.to_MaterialDocumentItem.results[0].Batch).toBe('B01');
    });

    it('should report no difference clearing on a single-line posting', async () => {
      const { res } = await postedWithBatch();
      expect(res.DifferenceCleared).toBe(false);
      expect(res.DifferenceQty).toBe(0);
    });

    it('posts a 311 transfer via API_MATERIAL_DOCUMENT_SRV (code 04, receiving plant/sloc)', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900012345', MaterialDocumentYear: '2026' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      mockStrictReadBack(postingClient, '311');
      const res = await postingClient.postGoodsIssue(
        '519366', '1', '8000001648', 21, 'EA', '', 0, '', '', false, '1120', 'HS01',
        { movementType: '311', validatedMovementType: '311', receivingPlant: '1120', receivingStorageLocation: 'CS02' }
      );
      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [path, body] = mockAdapter._post.mock.calls[0];
      expect(path).toContain('API_MATERIAL_DOCUMENT_SRV');
      expect(body.GoodsMovementCode).toBe('04');
      expect(body.to_MaterialDocumentItem.results[0]).toMatchObject({
        GoodsMovementType: '311', Reservation: '519366', ReservationItem: '0001',
        Plant: '1120', StorageLocation: 'HS01', IssuingOrReceivingPlant: '1120', IssuingOrReceivingStorageLoc: 'CS02'
      });
      expect(res).toMatchObject({ Success: true, MaterialDocument: '4900012345' });
      expect(res.Message).toMatch(/Transfer posting 311/);
    });

    it('posts a 201 goods issue to cost center via API_MATERIAL_DOCUMENT_SRV (code 03, CostCenter)', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900012346', MaterialDocumentYear: '2026' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      mockStrictReadBack(postingClient, '201');
      const res = await postingClient.postGoodsIssue(
        '519658', '1', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'RD01',
        { movementType: '201', validatedMovementType: '201', costCenter: '1011103001' }
      );
      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [path, body] = mockAdapter._post.mock.calls[0];
      expect(path).toContain('API_MATERIAL_DOCUMENT_SRV');
      expect(body.GoodsMovementCode).toBe('03');
      expect(body.MaterialDocumentHeaderText).toContain('GI CC');
      expect(body.to_MaterialDocumentItem.results[0]).toMatchObject({
        GoodsMovementType: '201', Reservation: '519658', ReservationItem: '0001',
        Plant: '1120', StorageLocation: 'RD01', CostCenter: '1011103001'
      });
      expect(res).toMatchObject({ Success: true, MaterialDocument: '4900012346' });
      expect(res.Message).toMatch(/Goods Issue to Cost Center 201/);
    });

    it('rejects movement types other than 201 / 301 / 311', async () => {
      await expect(new GoodsIssuePostingClient().postGoodsIssue('1', '1', 'M', 1, 'KG', '', 0, '', '', false, '', '', { movementType: '551' }))
        .rejects.toMatchObject({ status: 400 });
    });

    it('rejects missing movement type on the legacy replay signature before SAP POST', async () => {
      const mockAdapter = { _post: jest.fn() };
      await expect(new GoodsIssuePostingClient({ adapter: mockAdapter }).postGoodsIssue(
        '1', '1', 'M', 1, 'KG', '', 0, '', '', false, '1120', 'HS01', { costCenter: 'CC1' }
      )).rejects.toMatchObject({ status: 400 });
      expect(mockAdapter._post).not.toHaveBeenCalled();
    });

    it('posts goods issue with serial numbers mapped to to_SerialNumbers in API_MATERIAL_DOCUMENT_SRV', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900012350', MaterialDocumentYear: '2026' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      mockStrictReadBack(postingClient, '201');
      const res = await postingClient.postGoodsIssue(
        '519658', '1', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
        { movementType: '201', validatedMovementType: '201', costCenter: '1011101301', serialNumbers: ['MACBOOK-004'] }
      );
      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [path, body] = mockAdapter._post.mock.calls[0];
      expect(path).toContain('API_MATERIAL_DOCUMENT_SRV');
      expect(body.GoodsMovementCode).toBe('03');
      const item = body.to_MaterialDocumentItem.results[0];
      expect(item).toMatchObject({
        GoodsMovementType: '201',
        CostCenter: '1011101301',
        Reservation: '519658',
        ReservationItem: '0001'
      });
      expect(item.to_SerialNumbers).toBeDefined();
      expect(item.to_SerialNumbers.results).toEqual([{ SerialNumber: 'MACBOOK-004' }]);
      expect(res.Success).toBe(true);
      expect(res.MaterialDocument).toBe('4900012350');
    });

    it('should throw validation error when an item is missing Unit in postGoodsIssue', async () => {
      const postingClient = new GoodsIssuePostingClient();
      await expect(postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, '', '', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' }))
        .rejects.toThrow(/Unit of measure \(EntryUnit\) is required for Goods Issue/);
    });

    it('should surface a plain 403 in postGoodsIssue as an authorization failure instead of queueing it', async () => {
      const v2Err = new Error('HTTP 403 Forbidden');
      v2Err.status = 403;

      const mockPost = jest.fn().mockRejectedValue(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' });
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        // A plain 403 (no /IWFND/MED/170) is an authorization/CSRF refusal: surfaced, never queued.
        expect(err.status).toBe(403);
        expect(err.message).toContain('NOT posted');
        expect(err.message).toContain('SU53');
        expect(err.message).not.toContain('Unavailable');
      }
    });

    it('should read a 403 carrying /IWFND/MED/170 as NOT REGISTERED, not as an authorization failure', async () => {
      // Verbatim shape DS4 client 220 returns for an unregistered service.
      const v2Err = new Error("/IWFND/MED/170 No service found for namespace '', name 'API_MATERIAL_DOCUMENT_SRV', version '0001'");
      v2Err.status = 403;

      const mockPost = jest.fn().mockRejectedValue(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' });
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        expect(err.status).toBe(501);
        expect(err.message).toContain('NOT REGISTERED');
        expect(err.message).toContain('/IWFND/MAINT_SERVICE');
        expect(err.message).toContain('registration task, not an authorization grant');
        expect(err.message).not.toContain('Security must grant S_SERVICE');
      }
    });

    it('should report an unknown outcome when the error carries no HTTP status', async () => {
      const v2Err = new Error('socket hang up');      // no .status

      const mockPost = jest.fn().mockRejectedValue(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const savedDelays = process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
      process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '0';
      // The unknown-outcome recovery tries a MATDOC read-back; an unreadable lookup must
      // keep the original unknown-outcome error.
      const postingClient = new GoodsIssuePostingClient({
        adapter: mockAdapter,
        rfc: { readTable: jest.fn().mockRejectedValue(new Error('RFC unavailable')) }
      });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01', 0, '', '', false, '1120', 'HS01', { movementType: '201', validatedMovementType: '201', costCenter: 'CC1' });
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        // No response at all: SAP may have posted, so this is an unknown outcome, never queued.
        expect(err.status).toBe(504);
        expect(err.code).toBe('GI_POSTING_OUTCOME_UNKNOWN');
        expect(err.message).toContain('socket hang up');
        expect(err.message).not.toContain('Unavailable');
        expect(err.message).not.toContain('NOT PUBLISHED');
        expect(err.message).not.toContain('NOT REGISTERED');
      } finally {
        if (savedDelays === undefined) delete process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
        else process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = savedDelays;
      }
    });
  });

});
