'use strict';

const GoodsIssueDashboardClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueDashboardClient');

// All-time counts now come from a SAP-side OData $count (client.getText), not from an RFC MATDOC
// row scan. This helper returns the per-movement-type count based on the $filter, mirroring SAP.
function countByType(map) {
  return (path, opts) => {
    const f = decodeURIComponent((opts && opts.query) || '');
    const m = f.match(/GoodsMovementType eq '(\d+)'/);
    const t = m ? m[1] : '';
    return Promise.resolve(String(map[t] != null ? map[t] : 0));
  };
}

describe('GoodsIssueDashboardClient Unit Tests', () => {
  let mockRfc;
  let mockClient;
  let mockReservationsClient;
  let client;

  beforeEach(() => {
    mockRfc = {
      readTable: jest.fn()
    };
    // OData client used for the all-time $count (getText -> raw count string).
    mockClient = {
      getText: jest.fn().mockResolvedValue('0')
    };
    mockReservationsClient = {
      getOpenReservations: jest.fn()
    };

    client = new GoodsIssueDashboardClient({
      rfc: mockRfc,
      client: mockClient,
      reservationsClient: mockReservationsClient
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
      mockClient.getText.mockImplementation(countByType({ '261': 1 })); // all-time counts via OData $count
      mockRfc.readTable.mockResolvedValue([]); // window rows (no materials -> no MAKT read)

      const res1 = await client.getDashboardData({ days: 7, plant: '1120' });
      expect(res1.Kpis.Mvt261.TotalCount).toBe(1);
      expect(mockClient.getText).toHaveBeenCalledTimes(4); // one $count per movement type
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1); // window only

      // Second call with same parameters should hit cache
      const res2 = await client.getDashboardData({ days: 7, plant: '1120' });
      expect(res2).toBe(res1);
      expect(mockClient.getText).toHaveBeenCalledTimes(4);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);
    });

    it('bypasses cache when forceRefresh is true', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockClient.getText.mockImplementation(countByType({ '261': 1 }));
      mockRfc.readTable.mockResolvedValue([]);

      await client.getDashboardData({ days: 7, plant: '1120' });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);

      mockClient.getText.mockImplementation(countByType({ '261': 1, '301': 1 }));
      const refreshed = await client.getDashboardData({ days: 7, plant: '1120', forceRefresh: true });
      expect(refreshed.Kpis.Mvt301.TotalCount).toBe(1);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(2); // window re-read on forced refresh
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

      // All-time counts now come from the SAP-side OData $count (per movement type).
      mockClient.getText.mockImplementation(countByType({ '201': 1, '261': 2, '301': 1, '311': 1 }));

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayYMD = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

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
        .mockResolvedValueOnce(windowRows) // 1. MATDOC window rows
        .mockResolvedValueOnce([ // 2. MAKT descriptions — now a single batched read for all materials
          { MATNR: '000000000000000514', MAKTX: 'Flange Steel 514' },
          { MATNR: '000000000000000421', MAKTX: 'Macbook Air M3' },
          { MATNR: '000000000000000515', MAKTX: 'Pipe Copper 515' }
        ]);

      const data = await client.getDashboardData({ days: 30, plant: '1120' });

      // KPI Checks — OpenPendingCount reflects open reservations directly
      expect(data.Kpis.Mvt201.TotalCount).toBe(1);
      expect(data.Kpis.Mvt201.OpenPendingCount).toBe(1); // 1 reservation
      expect(data.Kpis.Mvt201.TodayPostingsCount).toBe(1);

      expect(data.Kpis.Mvt261.TotalCount).toBe(2);
      expect(data.Kpis.Mvt261.OpenPendingCount).toBe(2); // 2 reservations
      expect(data.Kpis.Mvt261.TodayPostingsCount).toBe(1);

      expect(data.Kpis.Mvt301.TotalCount).toBe(1);
      expect(data.Kpis.Mvt301.OpenPendingCount).toBe(1); // 1 reservation
      expect(data.Kpis.Mvt301.TodayPostingsCount).toBe(0);

      expect(data.Kpis.Mvt311.TotalCount).toBe(1);
      expect(data.Kpis.Mvt311.OpenPendingCount).toBe(0); // 0 reservations
      expect(data.Kpis.Mvt311.TodayPostingsCount).toBe(0);

      expect(data.Kpis.Overall.TotalCount).toBe(5);
      expect(data.Kpis.Overall.OpenPendingCount).toBe(4); // 1 + 2 + 1 + 0 = 4
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
      // OData $count unavailable -> the all-time count falls back to the RFC MATDOC/MSEG row-count path.
      mockClient.getText.mockRejectedValue(new Error('OData $count not available'));

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

    it('queries only the requested type (not the combined set) when movementType is given', async () => {
      mockReservationsClient.getOpenReservations.mockResolvedValue([]);
      mockClient.getText.mockImplementation(countByType({ '301': 0 }));
      mockRfc.readTable.mockResolvedValue([]);

      await client.getDashboardData({ days: 30, plant: '1120', movementType: '301' });

      // All-time count: a single OData $count for movement type 301 only (not 4 calls).
      expect(mockClient.getText).toHaveBeenCalledTimes(1);
      const countFilter = decodeURIComponent(mockClient.getText.mock.calls[0][1].query);
      expect(countFilter).toContain("GoodsMovementType eq '301'");
      expect(countFilter).toContain("Plant eq '1120'");

      // Window read (readTable call 0) is scoped to BWART = '301', not the combined IN clause.
      const windowWhere = mockRfc.readTable.mock.calls[0][2];
      expect(windowWhere[0]).toBe("BWART = '301'");
      expect(windowWhere.join(' ')).not.toContain("IN ('201','261','301','311')");
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

      mockClient.getText.mockImplementation(countByType({ '301': 1 })); // all-time count via OData $count
      mockRfc.readTable
        .mockResolvedValueOnce(windowRows) // window rows
        .mockResolvedValueOnce([{ MATNR: '000000000000000515', MAKTX: 'Copper Pipe 515' }]); // MAKT (batched)

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
