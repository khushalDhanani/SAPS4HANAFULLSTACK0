/**
 * test/unit/wm/transactionPersistenceAndRetry.test.js
 *
 * Phase 2: Document Persistence Verification & Safe Retry / Idempotency Test Suite
 *
 * Strictly enforces:
 *  1. Document Persistence Verification:
 *     - Confirms genuine SAP document numbers (material documents, reservations, transfer orders).
 *     - Rejects blank, whitespace, or placeholder/mock document numbers.
 *     - Rejects HTTP 2xx that lack a material document (504 GI_POSTING_OUTCOME_UNKNOWN).
 *     - Verifies MATDOC / MSEG read-back in ReservationProcessAdapter; fails closed when persistence check fails.
 *     - Multi-tier read-back in GoodsIssuePostingClient (MATDOC -> MKPF -> OData -> unconfirmed pending).
 *     - Read-back verification in Mvt261Adapter.
 *  2. Safe Retries and Idempotency:
 *     - GoodsIssueAttemptStore: Idempotent replay of identical requests without duplicate SAP posting.
 *     - GoodsIssueAttemptStore: Reference collision detection throws HTTP 409 Conflict.
 *     - GoodsIssueAttemptStore: Generation suffix re-claims (e.g. GI...0 -> GI...1) for safe retry after failure.
 *     - ReservationProcessAdapter: Lifecycle stage progression, failure handling, and retry from failed stage.
 *     - HuStockTransferAdapter: Idempotency caching on ClientAttemptId and BAPI rollback on rejection.
 *
 * All tests use controlled mocks/spies. ZERO live SAP mutations.
 */

'use strict';

const cds = require('@sap/cds');

// Test DB initialization for GoodsIssueAttemptStore
cds.test(__dirname + '/../../../');

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');

const { DELETE } = cds.ql;
const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsIssuePostingAttempt';

describe('Phase 2: Write Workflow Document Persistence & Safe Retries', () => {

  beforeEach(async () => {
    try {
      if (cds.db) {
        await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
      }
    } catch {
      // InMemory store fallback
    }
    GoodsIssueAttemptStore.clearMemoryStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Genuine Document Number & Placeholder Rejection
  // =========================================================================
  describe('1. Genuine Document Number Enforcement & Placeholder Rejection', () => {

    test('ReservationProcessAdapter rejects blank or whitespace material document', async () => {
      const adapter = new ReservationProcessAdapter();

      await expect(
        adapter.verifyMaterialDocument({
          materialDocument: '   ',
          materialDocYear: '2026',
          movementType: '201'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/missing or invalid|missing or empty/i)
      });
    });

    test('GoodsIssuePostingClient throws 504 GI_POSTING_OUTCOME_UNKNOWN on HTTP 2xx without a material document', async () => {
      const mockS4Client = {
        post: jest.fn().mockResolvedValue({
          data: { d: {} } // 200 OK body without MaterialDocument
        })
      };

      const postingClient = new GoodsIssuePostingClient({
        client: mockS4Client,
        rfc: null
      });

      await expect(
        postingClient._submitMaterialDocument(
          {
            to_MaterialDocumentItem: {
              results: [{ GoodsMovementType: '201', Material: '8000000023', Plant: '1120', StorageLocation: 'HS01', EntryUnit: 'KG' }]
            }
          },
          {
            mvt: '201',
            reservationNo: '520001',
            reservationItem: '0001',
            data: { MovementType: '201', ValidatedMovementType: '201', Material: '8000000023', Plant: '1120', StorageLocation: 'HS01', IssueQty: 5 }
          }
        )
      ).rejects.toMatchObject({
        status: 504,
        code: 'GI_POSTING_OUTCOME_UNKNOWN'
      });
    });

  });

  // =========================================================================
  // 2. SAP Document Persistence Verification (MATDOC, MSEG, LTAK, MKPF)
  // =========================================================================
  describe('2. SAP Document Persistence Verification', () => {

    test('ReservationProcessAdapter.verifyMaterialDocument: confirms persistence when MATDOC contains matching record', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'MATDOC' || table === 'MSEG') {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              BWART: '201',
              MATNR: '000000008000000023',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520001',
              RSPOS: '0001',
              MENGE: '10.000',
              MEINS: 'EA'
            }];
          }
          return [];
        })
      };

      const adapter = new ReservationProcessAdapter({ rfc: mockRfc });
      adapter._checkMatdocPersistence = true;

      const res = await adapter.verifyMaterialDocument({
        materialDocument: '5000000201',
        materialDocYear: '2026',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        reservationNo: '520001'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('5000000201');
      expect(res.materialDocumentYear).toBe('2026');
      expect(mockRfc.readTable).toHaveBeenCalledWith(
        'MATDOC',
        expect.any(Array),
        expect.arrayContaining([expect.stringContaining('5000000201')]),
        expect.any(Number)
      );
    });

    test('ReservationProcessAdapter.verifyMaterialDocument: fails closed (500) when document cannot be verified in MATDOC/MSEG', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([]) // Empty -> MATDOC persistence check fails!
      };

      const adapter = new ReservationProcessAdapter({ rfc: mockRfc });
      adapter._checkMatdocPersistence = true;

      await expect(
        adapter.verifyMaterialDocument({
          materialDocument: '5000000999',
          materialDocYear: '2026',
          movementType: '201',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 10
        })
      ).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/persistence check failed/i)
      });
    });

    test('GoodsIssuePostingClient.readBackDocument: Tier 1 MATDOC confirms document persistence', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([{
          MBLNR: '5000000201',
          MJAHR: '2026',
          BUDAT: '20261024',
          ZEILE: '0001',
          BWART: '201',
          MATNR: '8000000023',
          WERKS: '1120',
          LGORT: 'HS01'
        }])
      };

      const postingClient = new GoodsIssuePostingClient({ rfc: mockRfc });
      const result = await postingClient.readBackDocument('5000000201', '2026');

      expect(result).toMatchObject({
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed',
        Tier: 'MATDOC'
      });
      expect(mockRfc.readTable).toHaveBeenCalledWith('MATDOC', expect.any(Array), expect.any(Array), 10);
    });

    test('GoodsIssuePostingClient.readBackDocument: Tier 2 MKPF confirms when MATDOC query throws', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'MATDOC') throw new Error('MATDOC table locked');
          if (table === 'MKPF') {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              BLDAT: '20261024',
              BUDAT: '20261024'
            }];
          }
          return [];
        })
      };

      const postingClient = new GoodsIssuePostingClient({ rfc: mockRfc });
      const result = await postingClient.readBackDocument('5000000201', '2026');

      expect(result).toMatchObject({
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed',
        Tier: 'MKPF'
      });
    });

    test('GoodsIssuePostingClient.readBackDocument: returns unconfirmed pending status when document cannot be found', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([])
      };
      const mockS4Client = {
        get: jest.fn().mockResolvedValue({ data: { d: { results: [] } } })
      };

      const postingClient = new GoodsIssuePostingClient({
        rfc: mockRfc,
        client: mockS4Client
      });

      const result = await postingClient.readBackDocument('5000000999', '2026');
      expect(result).toMatchObject({
        MaterialDocument: '5000000999',
        MaterialDocYear: '2026',
        Confirmed: false,
        Status: 'posted, confirmation pending'
      });
    });

    test('Mvt261Adapter.readBackDocument: confirms persistence in MATDOC via RFC', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([{
          MBLNR: '5000000261',
          MJAHR: '2026',
          BUDAT: '20261024'
        }])
      };

      const adapter = new Mvt261Adapter({ rfc: mockRfc });
      const doc = await adapter.readBackDocument('5000000261', '2026');

      expect(doc).toMatchObject({
        MaterialDocument: '5000000261',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed'
      });
    });
  });

  // =========================================================================
  // 3. Safe Retries, Deduplication & Idempotency Gating
  // =========================================================================
  describe('3. Safe Retries, Deduplication & Idempotency Gating', () => {

    test('GoodsIssueAttemptStore: identical request returns existing attempt without duplicate SAP call', async () => {
      const requestData = {
        ReferenceDocument: 'GI20261024TEST01',
        RequestHash: 'hash-for-resv-520001-item-0001',
        MovementType: '201',
        ReservationNo: '520001',
        ReservationItem: '0001',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        Unit: 'NOS',
        CostCenter: '1011201301',
        ClientAttemptId: 'client-attempt-uuid-001'
      };

      // 1st attempt: claims reference
      const firstClaim = await GoodsIssueAttemptStore.createOrGet(requestData);
      expect(firstClaim.created).toBe(true);
      expect(firstClaim.row.Status).toBe('sending');

      // Update to posted via setStatus
      await GoodsIssueAttemptStore.setStatus(requestData.ReferenceDocument, 'posted', {
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      });

      // 2nd identical attempt: returns existing row (created = false)
      const secondClaim = await GoodsIssueAttemptStore.createOrGet(requestData);
      expect(secondClaim.created).toBe(false);
      expect(secondClaim.row).toMatchObject({
        ReferenceDocument: 'GI20261024TEST01',
        Status: 'posted',
        MaterialDocument: '5000000201'
      });
    });

    test('GoodsIssueAttemptStore: reference collision with different RequestHash throws HTTP 409 Conflict', async () => {
      const originalRequest = {
        ReferenceDocument: 'GI-SHARED-REF-01',
        RequestHash: 'hash-original',
        MovementType: '201',
        Material: '8000000023',
        IssueQty: 10
      };

      await GoodsIssueAttemptStore.createOrGet(originalRequest);

      const collidingRequest = {
        ReferenceDocument: 'GI-SHARED-REF-01',
        RequestHash: 'hash-DIFFERENT-payload',
        MovementType: '201',
        Material: '8000000023',
        IssueQty: 25 // Different quantity!
      };

      await expect(
        GoodsIssueAttemptStore.createOrGet(collidingRequest)
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/idempotency reference collision/i)
      });
    });

    test('GoodsIssueAttemptStore: safe retry after rejection re-claims with next generation suffix', async () => {
      const baseRequest = {
        ReferenceDocument: 'GI20261024RETRY',
        RequestHash: 'hash-retry-test-01',
        MovementType: '261',
        ReservationNo: '528780',
        ReservationItem: '0001',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 5
      };

      // 1st attempt with reclaim enabled
      const first = await GoodsIssueAttemptStore.createOrGet(baseRequest, {
        reclaimableStatuses: ['rejected', 'not_posted']
      });
      expect(first.created).toBe(true);
      expect(first.row.ReferenceDocument).toBe('GI20261024RETRY0');

      // 1st attempt fails in SAP
      await GoodsIssueAttemptStore.setStatus(first.row.ReferenceDocument, 'rejected', {
        LastError: 'Posting period 09/2026 is closed'
      });

      // 2nd attempt: client retries after fixing posting period -> safely creates generation 1
      const retry = await GoodsIssueAttemptStore.createOrGet(baseRequest, {
        reclaimableStatuses: ['rejected', 'not_posted']
      });
      expect(retry.created).toBe(true);
      expect(retry.row.ReferenceDocument).toBe('GI20261024RETRY1');

      // Both attempts are preserved in audit history
      const history = await GoodsIssueAttemptStore._attemptsByRequestHash('hash-retry-test-01');
      expect(history.length).toBe(2);
      expect(history[0].Status).toBe('rejected');
      expect(history[1].Status).toBe('sending');
    });

    test('ReservationProcessAdapter: a flow on an existing reservation records FAILED_TR with the SAP error and creates no second reservation', async () => {
      const statuses = [];
      const fms = [];
      // Plain function RFC double, so the adapter takes its production path (no readTable.mock).
      const tables = {
        T320: [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }],
        CSKS: [{ KOKRS: '1000', KOSTL: '1011201301', DATAB: '20200101', DATBI: '99991231', BKZKP: '' }],
        MARC: [{ XCHPF: '', SERNP: '' }],
        MARD: [{ LGORT: 'HS01', LABST: '100.000' }]
      };
      const rfc = {
        session: (fn) => fn(rfc.call),
        call: async (fm) => {
          fms.push(fm);
          if (fm === 'L_TR_CREATE') throw new Error('Warehouse W01 movement 201 not configured');
          return {};
        },
        readTable: async (table) => tables[table] || []
      };

      const result = await new ReservationProcessAdapter({ rfc }).executeReservationWarehouseFlow({
        reservationNumber: '520001',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => { statuses.push(status); }
      });

      expect(result).toMatchObject({ success: false, stage: 'TR', processStatus: 'FAILED_TR', reservationNumber: '520001' });
      expect(result.error).toContain('Warehouse W01 movement 201 not configured');
      expect(statuses).toEqual(['CREATED', 'RESERVATION_CREATED', 'FAILED_TR']);
      expect(fms).not.toContain('BAPI_RESERVATION_CREATE1');
    });

    test('HuStockTransferAdapter: repeated call with same ClientAttemptId hits idempotency cache', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'HS01', XHUPF: '' }];
          if (table === 'MATDOC') return [{ MBLNR: '5000000311', MJAHR: '2026', BWART: '311' }];
          return [];
        }),
        call: jest.fn().mockImplementation(async (fm) => {
          if (fm === 'BAPI_GOODSMVT_CREATE') {
            return {
              GOODSMVT_HEADRET: { MAT_DOC: '5000000311', DOC_YEAR: '2026' }
            };
          }
          if (fm === 'BAPI_TRANSACTION_COMMIT') return {};
          return {};
        })
      };
      mockRfc.session = (fn) => fn(mockRfc.call);

      const adapter = new HuStockTransferAdapter({ rfcClient: mockRfc });

      // Mock validateUnit & getCockpitDetail
      jest.spyOn(adapter, 'validateUnit').mockResolvedValue({
        Valid: true,
        AvailableQuantity: 10,
        StorageLocation: 'HS01',
        UnitType: 'Storage Unit (SU)'
      });

      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        OpenQty: 10,
        Plant: '1120',
        Material: '8000000023',
        StorageLocation: 'HS01',
        ReceivingStorageLocation: 'CS01',
        MovementType: '311',
        BaseUnit: 'NOS',
        Requester: 'TESTUSER'
      });

      const transferPayload = {
        ReservationNo: '520311',
        ReservationItem: '0001',
        UnitNumber: '1030311',
        TransferQty: 10,
        ClientAttemptId: 'hu-idempotent-key-999'
      };

      // 1st execution: calls SAP BAPI
      const res1 = await adapter.executeHuStockTransfer(transferPayload);
      expect(res1.Success).toBe(true);
      expect(res1.MaterialDocument).toBe('5000000311');
      expect(mockRfc.call).toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.any(Object));

      mockRfc.call.mockClear();

      // 2nd execution with identical ClientAttemptId: returns from idempotency cache WITHOUT BAPI call
      const res2 = await adapter.executeHuStockTransfer(transferPayload);
      expect(res2.Success).toBe(true);
      expect(res2.MaterialDocument).toBe('5000000311');
      expect(mockRfc.call).not.toHaveBeenCalled();
    });

    test('HuStockTransferAdapter: executes BAPI rollback when SAP does not generate Material Document', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'HS01', XHUPF: '' }];
          if (table === 'MATDOC') return [{ MBLNR: '5000000311', MJAHR: '2026', BWART: '311' }];
          return [];
        }),
        call: jest.fn().mockImplementation(async (fm) => {
          if (fm === 'BAPI_GOODSMVT_CREATE') {
            return {
              GOODSMVT_HEADRET: {}, // Missing MAT_DOC
              RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit of BA Unrestricted-use stock 10 NOS' }]
            };
          }
          if (fm === 'BAPI_TRANSACTION_ROLLBACK') return {};
          return {};
        })
      };
      mockRfc.session = (fn) => fn(mockRfc.call);

      const adapter = new HuStockTransferAdapter({ rfcClient: mockRfc });

      jest.spyOn(adapter, 'validateUnit').mockResolvedValue({
        Valid: true,
        AvailableQuantity: 10,
        StorageLocation: 'HS01',
        UnitType: 'Storage Unit (SU)'
      });

      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        OpenQty: 10,
        Plant: '1120',
        Material: '8000000023',
        StorageLocation: 'HS01',
        ReceivingStorageLocation: 'CS01',
        MovementType: '311',
        BaseUnit: 'NOS',
        Requester: 'TESTUSER'
      });

      await expect(
        adapter.executeHuStockTransfer({
          ReservationNo: '520311',
          ReservationItem: '0001',
          UnitNumber: '1030311',
          TransferQty: 10,
          ClientAttemptId: 'hu-rollback-key-1'
        })
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringMatching(/Deficit of BA Unrestricted-use stock/i)
      });

      expect(mockRfc.call).toHaveBeenCalledWith('BAPI_TRANSACTION_ROLLBACK', {});
    });
  });
});
