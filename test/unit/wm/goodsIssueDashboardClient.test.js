'use strict';

const GoodsIssueDashboardClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueDashboardClient');

describe('GoodsIssueDashboardClient Unit Tests', () => {
  let mockRfc;
  let mockReservationsClient;
  let mockQueueManager;
  let client;

  beforeEach(() => {
    mockRfc = {
      readTable: jest.fn()
    };
    mockReservationsClient = {
      getOpenReservations: jest.fn()
    };
    mockQueueManager = {
      getAll: jest.fn().mockResolvedValue([])
    };

    client = new GoodsIssueDashboardClient({
      rfc: mockRfc,
      reservationsClient: mockReservationsClient,
      queueManager: mockQueueManager
    });
  });

  describe('Validation & Parameter Sanitization', () => {
    it('rejects invalid plant codes exceeding 4 chars or containing invalid characters', async () => {
      await expect(client.getDashboardData({ plant: 'TOOLONG' }))
        .rejects.toThrow("Invalid plant code 'TOOLONG'");
      await expect(client.getDashboardData({ plant: '11@0' }))
        .rejects.toThrow("Invalid plant code '11@0'");
    });

    it('defaults invalid or negative days to 30', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable.mockResolvedValue([]);

      const result = await client.getDashboardData({ days: -5 });
      expect(result.Days).toBe(30);
      expect(result.Trend.length).toBe(30);
    });

    it('clamps days exceeding 90 to 30', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable.mockResolvedValue([]);

      const result = await client.getDashboardData({ days: 120 });
      expect(result.Days).toBe(30);
      expect(result.Trend.length).toBe(30);
    });
  });

  describe('Caching Behavior', () => {
    it('returns cached data on subsequent call without invoking RFC again within TTL', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable
        .mockResolvedValueOnce([{ MBLNR: '1001', BWART: '261' }]) // all-time totals
        .mockResolvedValueOnce([]); // window rows

      const res1 = await client.getDashboardData({ days: 7, plant: '1120' });
      expect(res1.Kpis.Mvt261.TotalCount).toBe(1);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(2);

      // Second call with same parameters should hit cache
      const res2 = await client.getDashboardData({ days: 7, plant: '1120' });
      expect(res2).toBe(res1);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(2);
    });

    it('bypasses cache when forceRefresh is true', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable
        .mockResolvedValueOnce([{ MBLNR: '1001', BWART: '261' }])
        .mockResolvedValueOnce([]);

      await client.getDashboardData({ days: 7, plant: '1120' });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(2);

      mockRfc.readTable
        .mockResolvedValueOnce([{ MBLNR: '1001', BWART: '261' }, { MBLNR: '1002', BWART: '301' }])
        .mockResolvedValueOnce([]);

      const refreshed = await client.getDashboardData({ days: 7, plant: '1120', forceRefresh: true });
      expect(refreshed.Kpis.Mvt301.TotalCount).toBe(1);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(4);
    });
  });

  describe('Aggregation & S/4HANA Data Mapping', () => {
    it('aggregates MATDOC postings correctly across 201, 261, 301, 311 and overall', async () => {
      mockReservationsClient.getOpenReservations
        .mockImplementation((type) => {
          if (type === '201') return Promise.resolve([{ ReservationNo: 'R201' }]);
          if (type === '261') return Promise.resolve([{ ReservationNo: 'R1' }, { ReservationNo: 'R2' }]);
          if (type === '301') return Promise.resolve([{ ReservationNo: 'R3' }]);
          return Promise.resolve([]);
        });

      mockQueueManager.getAll.mockResolvedValue([
        { MovementType: '201', ItemId: 'Q0' },
        { MovementType: '261', ItemId: 'Q1' },
        { MovementType: '311', ItemId: 'Q2' }
      ]);

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayYMD = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

      // All-time rows
      const allRows = [
        { MBLNR: '1000', BWART: '201' },
        { MBLNR: '1001', BWART: '261' },
        { MBLNR: '1002', BWART: '261' },
        { MBLNR: '1003', BWART: '301' },
        { MBLNR: '1004', BWART: '311' }
      ];

      // Window rows including today's posting
      const windowRows = [
        {
          MBLNR: '0000001000',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '201',
          MATNR: '000000000000000421',
          WERKS: '1110',
          LGORT: 'RD01',
          CHARG: 'CH01',
          MENGE: '2.000',
          MEINS: 'EA',
          BUDAT: todayYMD,
          USNAM: 'NARESH',
          KOSTL: '1011103001',
          AUFNR: '',
          RSNUM: '',
          RSPOS: '',
          SHKZG: 'H'
        },
        {
          MBLNR: '0000001001',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '261',
          MATNR: '000000000000000514',
          WERKS: '1120',
          LGORT: '1121',
          CHARG: 'B1',
          MENGE: '10.500',
          MEINS: 'EA',
          BUDAT: todayYMD,
          USNAM: 'ALICE',
          KOSTL: '',
          AUFNR: '000001000856',
          RSNUM: '00000168779',
          RSPOS: '0001',
          SHKZG: 'H'
        },
        {
          MBLNR: '0000001002',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '301',
          MATNR: '000000000000000515',
          WERKS: '1120',
          LGORT: '1121',
          CHARG: '',
          MENGE: '5.000',
          MEINS: 'KG',
          BUDAT: '20260901',
          USNAM: 'BOB',
          KOSTL: '',
          AUFNR: '',
          RSNUM: '',
          RSPOS: '',
          SHKZG: 'S'
        }
      ];

      mockRfc.readTable
        .mockResolvedValueOnce(allRows) // 1. MATDOC all-time
        .mockResolvedValueOnce(windowRows) // 2. MATDOC window rows
        .mockResolvedValueOnce([{ MATNR: '000000000000000514', MAKTX: 'Flange Steel 514' }]) // MAKT for 514
        .mockResolvedValueOnce([{ MATNR: '000000000000000421', MAKTX: 'Macbook Air M3' }]) // MAKT for 421
        .mockResolvedValueOnce([{ MATNR: '000000000000000515', MAKTX: 'Pipe Copper 515' }]); // MAKT for 515

      const data = await client.getDashboardData({ days: 30, plant: '1120' });

      // KPI Checks
      expect(data.Kpis.Mvt201.TotalCount).toBe(1);
      expect(data.Kpis.Mvt201.OpenPendingCount).toBe(2); // 1 reservation + 1 queued
      expect(data.Kpis.Mvt201.TodayPostingsCount).toBe(1);

      expect(data.Kpis.Mvt261.TotalCount).toBe(2);
      expect(data.Kpis.Mvt261.OpenPendingCount).toBe(3); // 2 reservations + 1 queued
      expect(data.Kpis.Mvt261.TodayPostingsCount).toBe(1);

      expect(data.Kpis.Mvt301.TotalCount).toBe(1);
      expect(data.Kpis.Mvt301.OpenPendingCount).toBe(1); // 1 reservation + 0 queued
      expect(data.Kpis.Mvt301.TodayPostingsCount).toBe(0);

      expect(data.Kpis.Mvt311.TotalCount).toBe(1);
      expect(data.Kpis.Mvt311.OpenPendingCount).toBe(1); // 0 reservation + 1 queued
      expect(data.Kpis.Mvt311.TodayPostingsCount).toBe(0);

      expect(data.Kpis.Overall.TotalCount).toBe(5);
      expect(data.Kpis.Overall.OpenPendingCount).toBe(7);
      expect(data.Kpis.Overall.TodayPostingsCount).toBe(2);

      // Distribution checks
      expect(data.Distribution.length).toBe(4);
      const dist201 = data.Distribution.find((d) => d.MovementType === '201');
      expect(dist201.Count).toBe(1);
      expect(dist201.Percentage).toBe(20);

      const dist261 = data.Distribution.find((d) => d.MovementType === '261');
      expect(dist261.Count).toBe(2);
      expect(dist261.Percentage).toBe(40);

      // Recent documents check with CostCenter and enriched MAKT descriptions
      expect(data.RecentDocuments.length).toBe(3);
      expect(data.RecentDocuments[0].MaterialDocument).toBe('1001');
      expect(data.RecentDocuments[0].Material).toBe('514');
      expect(data.RecentDocuments[0].MaterialDesc).toBe('Flange Steel 514');
      expect(data.RecentDocuments[0].Quantity).toBe(10.5);
      expect(data.RecentDocuments[0].OrderNo).toBe('1000856');

      expect(data.RecentDocuments[1].MaterialDocument).toBe('1000');
      expect(data.RecentDocuments[1].CostCenter).toBe('1011103001');
      expect(data.RecentDocuments[1].MaterialDesc).toBe('Macbook Air M3');
    });

    it('falls back to MSEG when MATDOC table read throws an error', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockQueueManager.getAll.mockResolvedValue([]);

      mockRfc.readTable
        .mockRejectedValueOnce(new Error('MATDOC table not active')) // MATDOC all-time fails
        .mockResolvedValueOnce([{ MBLNR: '2001', BWART: '311' }]) // MSEG all-time succeeds
        .mockRejectedValueOnce(new Error('MATDOC window read fails')) // MATDOC window fails
        .mockResolvedValueOnce([{
          MBLNR: '2001',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '311',
          MATNR: '514',
          WERKS: '1120',
          LGORT: '1121',
          CHARG: '',
          MENGE: '20',
          MEINS: 'EA',
          BUDAT: '20260920',
          USNAM: 'ALICE'
        }]); // MSEG window succeeds

      const data = await client.getDashboardData({ days: 7, plant: '1120' });
      expect(data.Kpis.Mvt311.TotalCount).toBe(1);
      expect(data.RecentDocuments.length).toBe(1);
      expect(data.RecentDocuments[0].MaterialDocument).toBe('2001');
    });
  });

  describe('MovementType Server-Side Filtering (per-type Recent Postings)', () => {
    it('rejects an invalid movement type', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      await expect(client.getDashboardData({ movementType: '999' }))
        .rejects.toThrow("Invalid movement type '999'");
    });

    it('queries BWART = <type> (not the combined IN clause) when movementType is given', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable.mockResolvedValue([]);

      await client.getDashboardData({ days: 30, plant: '1120', movementType: '301' });

      const totalWhere = mockRfc.readTable.mock.calls[0][2];
      expect(totalWhere[0]).toBe("BWART = '301'");
      expect(totalWhere.join(' ')).not.toContain("IN ('201','261','301','311')");

      const windowWhere = mockRfc.readTable.mock.calls[1][2];
      expect(windowWhere[0]).toBe("BWART = '301'");
    });

    it('returns RecentDocuments containing only the requested type, with ReceivingPlant/ReceivingStorageLocation mapped from UMWRK/UMLGO', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);

      const windowRows = [
        {
          MBLNR: '3001', MJAHR: '2026', ZEILE: '0001', BWART: '301', MATNR: '000000000000000515',
          WERKS: '1120', LGORT: '1121', CHARG: '', MENGE: '25', MEINS: 'M', BUDAT: '20260926',
          USNAM: 'BOB', KOSTL: '', AUFNR: '', RSNUM: '', RSPOS: '', SHKZG: 'S',
          UMWRK: '1130', UMLGO: 'MT01'
        }
      ];

      mockRfc.readTable
        .mockResolvedValueOnce([{ MBLNR: '3001', BWART: '301' }]) // all-time totals
        .mockResolvedValueOnce(windowRows) // window rows
        .mockResolvedValueOnce([{ MATNR: '000000000000000515', MAKTX: 'Copper Pipe 515' }]); // MAKT

      const data = await client.getDashboardData({ days: 30, plant: '1120', movementType: '301' });

      expect(data.RecentDocuments.length).toBe(1);
      expect(data.RecentDocuments[0].MovementType).toBe('301');
      expect(data.RecentDocuments[0].ReceivingPlant).toBe('1130');
      expect(data.RecentDocuments[0].ReceivingStorageLocation).toBe('MT01');
    });

    it('caches per movementType independently - a 201 call does not serve a 261 call\'s cache', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockRfc.readTable.mockResolvedValue([]);

      await client.getDashboardData({ days: 30, plant: '1120', movementType: '201' });
      const callsAfterFirst = mockRfc.readTable.mock.calls.length;

      await client.getDashboardData({ days: 30, plant: '1120', movementType: '261' });
      expect(mockRfc.readTable.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });
});
