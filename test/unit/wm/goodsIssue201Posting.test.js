const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const GoodsIssueStockUnitClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient');

describe('Movement 201 Backend Posting, Reversal & Serial Stock Pre-Check', () => {
  describe('GoodsIssuePostingClient: Movement 201 & CancelHeader Reversal', () => {
    it('successfully posts an unplanned 201 Goods Issue directly to Cost Center without reservation', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({
          MaterialDocument: '4900055001',
          MaterialDocumentYear: '2026'
        })
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const res = await client.postGoodsIssue(
        '', // No reservation
        '', // No reservation item
        '8000009753',
        1,
        'EA',
        '',
        0,
        '',
        '',
        false,
        '1120',
        'HS01',
        {
          movementType: '201',
          costCenter: '1011101301',
          glAccount: '0000400000',
          serialNumbers: ['MACBOOK-004']
        }
      );

      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [path, payload] = mockAdapter._post.mock.calls[0];
      expect(path).toBe('/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
      expect(payload.GoodsMovementCode).toBe('03');
      expect(payload.MaterialDocumentHeaderText).toBe('GI CC 1011101301');

      const item = payload.to_MaterialDocumentItem.results[0];
      expect(item.GoodsMovementType).toBe('201');
      expect(item.CostCenter).toBe('1011101301');
      // GLAccount is system-determined via OBYC/GBB-VBR for 201 and must never be forwarded to
      // SAP, even if a caller (or a caller bypassing validation) supplied one.
      expect(item.GLAccount).toBeUndefined();
      expect(item.Reservation).toBeUndefined();
      expect(item.to_SerialNumbers.results).toEqual([{ SerialNumber: 'MACBOOK-004' }]);

      expect(res).toMatchObject({
        Success: true,
        MaterialDocument: '4900055001',
        MaterialDocYear: '2026'
      });
      expect(res.Message).toContain('Goods Issue to Cost Center 201 posted successfully');
    });

    it('throws the real SAP business error when sap-message reports severity error despite an HTTP success response', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        // SAP Gateway can answer HTTP 2xx while the backend BAPI rejected the posting; the real
        // outcome is only in the sap-message header, and no MaterialDocument is present.
        _post: jest.fn().mockResolvedValue({
          _headers: {
            'sap-message': JSON.stringify({
              severity: 'error',
              message: 'Cost center 4110 is blocked for actual postings',
              code: 'KI234'
            })
          }
        })
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      await expect(
        client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        )
      ).rejects.toMatchObject({
        // 422, so the handler surfaces it instead of queueing it as "capability unavailable".
        status: 422,
        message: expect.stringContaining('Cost center 4110 is blocked for actual postings')
      });
    });

    it('rejects instead of silently resolving when SAP returns no material document and no sap-message error', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({}) // no MaterialDocument, no sap-message
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      await expect(
        client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        )
      ).rejects.toMatchObject({
        // HTTP success without a document: SAP may have posted, so the outcome is unknown.
        status: 504,
        code: 'GI_POSTING_OUTCOME_UNKNOWN',
        message: expect.stringContaining('did not return a material document')
      });
    });

    it('propagates a genuine SAP business rejection (e.g. locked cost center, 422) instead of masking it as capability-unavailable', async () => {
      const businessErr = new Error('Cost center 4110 is blocked for actual postings (message no. KI234)');
      businessErr.status = 422;
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockRejectedValue(businessErr)
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      await expect(
        client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        )
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('Cost center 4110 is blocked for actual postings')
      });
    });

    it('surfaces a plain HTTP 403 as an authorization failure instead of queueing it', async () => {
      const authErr = new Error('HTTP 403 Forbidden');
      authErr.status = 403;
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockRejectedValue(authErr)
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const err = await client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        ).catch((e) => e);
      expect(err.status).toBe(403);
      expect(err.message).toContain('NOT posted');
      expect(err.message).not.toContain('Unavailable');
    });

    it.each([
      ['an unregistered service (HTTP 403 + /IWFND/MED/170)', Object.assign(new Error("/IWFND/MED/170 No service found for namespace '', name 'API_MATERIAL_DOCUMENT_SRV', version '0001'"), { status: 403 })],
      ['an inactive service (HTTP 404)', Object.assign(new Error('HTTP 404 Not Found'), { status: 404 })],
      ['a refused connection', Object.assign(new Error('connect ECONNREFUSED'), { status: 502, code: 'ECONNREFUSED' })]
    ])('wraps %s as "Backend Posting Capability Unavailable" (501) for the dispatch queue', async (_label, unavailableErr) => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockRejectedValue(unavailableErr)
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      await expect(
        client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        )
      ).rejects.toMatchObject({
        status: 501,
        message: expect.stringContaining('Backend Posting Capability Unavailable')
      });
    });

    it.each([
      ['a request timeout', Object.assign(new Error('timeout of 30000ms exceeded'), { status: 502, code: 'ECONNABORTED' })],
      ['a connection reset', Object.assign(new Error('read ECONNRESET'), { status: 502, code: 'ECONNRESET' })],
      ['a bare socket hang up', new Error('socket hang up')]
    ])('reports %s as an unknown outcome (504) that must never be queued', async (_label, networkErr) => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockRejectedValue(networkErr)
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const err = await client.postGoodsIssue(
          '', '', '8000009753', 1, 'EA', '', 0, '', '', false, '1120', 'HS01',
          { movementType: '201', costCenter: '4110' }
        ).catch((e) => e);
      expect(err.status).toBe(504);
      expect(err.code).toBe('GI_POSTING_OUTCOME_UNKNOWN');
      expect(err.message).toContain('do not post again');
      expect(err.message).not.toContain('Unavailable');
    });

    describe('idempotency reference (ReferenceDocument)', () => {
      const data = {
        MovementType: '201', Material: '8000006645', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS',
        CostCenter: '1011101301', ReferenceDocument: 'GIMUP29CU1'
      };
      const timeout = () => Object.assign(new Error('timeout of 30000ms exceeded'), { status: 502, code: 'ECONNABORTED' });
      // Shape verified live: the 202 reversal copies the reference of the original 201.
      const original = { MaterialDocument: '4900049865', MaterialDocumentYear: '2026', to_MaterialDocumentItem: { results: [{ GoodsMovementType: '201' }] } };
      const reversal = { MaterialDocument: '4900049866', MaterialDocumentYear: '2026', to_MaterialDocumentItem: { results: [{ GoodsMovementType: '202' }] } };
      const adapter = (overrides) => Object.assign({ _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }) }, overrides);
      const savedDelays = process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;

      beforeAll(() => { process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '0,0'; });
      afterAll(() => {
        if (savedDelays === undefined) delete process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
        else process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = savedDelays;
      });

      it('reads the lookup delays from GI_REFERENCE_LOOKUP_DELAYS_MS and defaults to 2/4/8 s', () => {
        expect(GoodsIssuePostingClient.referenceLookupDelaysMs()).toEqual([0, 0]);
        process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '500, 1500';
        expect(GoodsIssuePostingClient.referenceLookupDelaysMs()).toEqual([500, 1500]);
        process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = 'soon';
        expect(GoodsIssuePostingClient.referenceLookupDelaysMs()).toEqual([2000, 4000, 8000]);
        delete process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
        expect(GoodsIssuePostingClient.referenceLookupDelaysMs()).toEqual([2000, 4000, 8000]);
        process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '0,0';
      });

      it('filters the lookup on reference and posting date, ignores a 202-only hit and tolerates several 201 hits', async () => {
        const second = { MaterialDocument: '4900049870', MaterialDocumentYear: '2026', to_MaterialDocumentItem: { results: [{ GoodsMovementType: '201' }] } };
        const mock = adapter({ _get: jest.fn().mockResolvedValueOnce([reversal]).mockResolvedValueOnce([second, reversal, original]) });
        const client = new GoodsIssuePostingClient({ adapter: mock });

        expect(await client.findPostedByReference('GIMUP29CU1', '201', '2026-09-30')).toBeNull();
        expect(await client.findPostedByReference('GIMUP29CU1', '201', '2026-09-30')).toMatchObject({ MaterialDocument: '4900049865' });
        expect(decodeURIComponent(mock._get.mock.calls[0][1])).toContain("ReferenceDocument eq 'GIMUP29CU1' and PostingDate eq datetime'2026-09-30T00:00:00'");
      });

      it('sends the reference on the header, cut to 16 characters', async () => {
        const mock = adapter({ _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900055001', MaterialDocumentYear: '2026' }) });
        await new GoodsIssuePostingClient({ adapter: mock }).post201({ ...data, ReferenceDocument: 'GI345678901234567890' });
        expect(mock._post.mock.calls[0][1].ReferenceDocument).toBe('GI34567890123456');
      });

      it('returns the document SAP posted when the POST timed out but the reference is found on a later check', async () => {
        const mock = adapter({
          _post: jest.fn().mockRejectedValue(timeout()),
          _get: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([reversal, original])
        });
        const res = await new GoodsIssuePostingClient({ adapter: mock }).post201(data);
        expect(res).toMatchObject({ Success: true, MaterialDocument: '4900049865', MaterialDocYear: '2026' });
        expect(mock._get).toHaveBeenCalledTimes(2);
        expect(mock._get.mock.calls[0][1]).toContain(encodeURIComponent("ReferenceDocument eq 'GIMUP29CU1'"));
      });

      it('reports an unconfirmed outcome (504 GI_POSTING_UNCONFIRMED), never "can be posted again", when every check comes back empty', async () => {
        const mock = adapter({ _post: jest.fn().mockRejectedValue(timeout()), _get: jest.fn().mockResolvedValue([reversal]) });
        const err = await new GoodsIssuePostingClient({ adapter: mock }).post201(data).catch((e) => e);
        expect(err).toMatchObject({ status: 504, code: 'GI_POSTING_UNCONFIRMED' });
        expect(err.message).toContain('may still appear');
        expect(err.message).toContain('do not post again');
        expect(err.message).not.toMatch(/can be posted again|NOT posted/);
        expect(err.message).not.toContain('Unavailable');
        expect(mock._get).toHaveBeenCalledTimes(2);
      });

      it('maps a closed posting period to a clear 400 that keeps the SAP text in details', async () => {
        const sapText = 'Posting only possible in periods 2026/06 and 2026/05 in company code 1000';
        const sapErr = Object.assign(new Error(`S/4HANA POST /sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader failed: HTTP 400 - ${sapText}`), { status: 400 });
        const mock = adapter({ _post: jest.fn().mockRejectedValue(sapErr), _get: jest.fn() });
        const err = await new GoodsIssuePostingClient({ adapter: mock }).post201(data).catch((e) => e);
        expect(err).toMatchObject({ status: 400, code: 'POSTING_PERIOD_CLOSED' });
        expect(err.message).toContain('posting period');
        expect(err.message).toContain('MMPV');
        expect(err.message).toContain('2026/06 and 2026/05');
        expect(err.details[0].message).toBe(sapText);
        expect(mock._get).not.toHaveBeenCalled();
      });

      it('keeps the manual-check unknown-outcome error when the lookup itself fails', async () => {
        const mock = adapter({ _post: jest.fn().mockRejectedValue(timeout()), _get: jest.fn().mockRejectedValue(new Error('socket hang up')) });
        const err = await new GoodsIssuePostingClient({ adapter: mock }).post201(data).catch((e) => e);
        expect(err).toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
      });

      it('does not look anything up for a business rejection', async () => {
        const mock = adapter({ _post: jest.fn().mockRejectedValue(Object.assign(new Error('Cost center does not exist'), { status: 400 })), _get: jest.fn() });
        await expect(new GoodsIssuePostingClient({ adapter: mock }).post201(data)).rejects.toMatchObject({ status: 400 });
        expect(mock._get).not.toHaveBeenCalled();
      });

      it('queue replay does not post again when the reference already exists in SAP', async () => {
        const mock = adapter({ _post: jest.fn(), _get: jest.fn().mockResolvedValue([original]) });
        const res = await new GoodsIssuePostingClient({ adapter: mock }).postByMovementType(data);
        expect(res).toMatchObject({ Success: true, MaterialDocument: '4900049865' });
        expect(mock._post).not.toHaveBeenCalled();
      });

      it('queue replay posts with the stored reference when SAP has no document for it', async () => {
        const mock = adapter({ _post: jest.fn().mockResolvedValue({ MaterialDocument: '4900055002', MaterialDocumentYear: '2026' }), _get: jest.fn().mockResolvedValue([]) });
        const res = await new GoodsIssuePostingClient({ adapter: mock }).postByMovementType(data);
        expect(res.MaterialDocument).toBe('4900055002');
        expect(mock._post.mock.calls[0][1].ReferenceDocument).toBe('GIMUP29CU1');
      });
    });

        it('successfully reverses a Material Document via CancelHeader FunctionImport', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({
          MaterialDocument: '4900055002',
          MaterialDocumentYear: '2026'
        })
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const res = await client.reverseGoodsIssue('4900055001', '2026', '2026-09-29');

      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [url] = mockAdapter._post.mock.calls[0];
      expect(url).toContain("Cancel?MaterialDocument='4900055001'");
      expect(url).toContain("MaterialDocumentYear='2026'");

      expect(res).toMatchObject({
        OriginalMaterialDocument: '4900055001',
        OriginalMaterialDocYear: '2026',
        ReversalMaterialDocument: '4900055002',
        ReversalMaterialDocYear: '2026',
        Success: true
      });
      expect(res.Message).toContain('reversed successfully in S/4HANA via Cancel');
    });

    it('rejects reversal when MaterialDocument or Year is missing', async () => {
      const client = new GoodsIssuePostingClient();
      await expect(client.reverseGoodsIssue('', '2026')).rejects.toMatchObject({ status: 400 });
      await expect(client.reverseGoodsIssue('4900055001', '')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('GoodsIssueStockUnitClient: Serial Status Pre-Check (ESTO In-Stock)', () => {
    it('passes validation when serial is in unrestricted stock (InventoryStockType 01)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '1120',
            StorageLocation: 'HS01',
            InventoryStockType: '01',
            InventoryStockType_Text: 'Unrestricted-Use Stock'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      const res = await suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004']);
      expect(res).toEqual({ valid: true });
    });

    it('rejects with 422 when serial number is not in unrestricted stock or already issued (ESTO failure)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '1120',
            StorageLocation: 'HS01',
            InventoryStockType: '02', // Blocked or quality inspection or already issued
            InventoryStockType_Text: 'Quality Inspection'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      await expect(
        suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004'])
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('already issued or not in unrestricted stock (Status: Quality Inspection)')
      });
    });

    it('rejects with 409 when serial number belongs to a different plant or storage location', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '2200', // Different plant
            StorageLocation: 'HS01',
            InventoryStockType: '01'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      await expect(
        suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004'])
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('located in Plant 2200, but Goods Issue requires Plant 1120')
      });
    });

    it('fails CLOSED (502) when the serial status cannot be read at all (no silent pass)', async () => {
      const mockAdapter = {
        // OData serial-master read errors...
        _get: jest.fn().mockRejectedValue(new Error('serial master service unavailable'))
      };
      // ...and the RFC fallback returns nothing -> the serial's status is genuinely unverifiable.
      const mockRfc = { readTable: jest.fn().mockResolvedValue([]) };
      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter, rfc: mockRfc });
      await expect(
        suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004'])
      ).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining('could not be verified in SAP')
      });
    });
  });
});
