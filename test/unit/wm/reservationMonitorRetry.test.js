'use strict';

/**
 * Unit Test Suite for Chunk 6: Monitor App, Retry Actions & SLG1 Application Log
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

cds.test(__dirname + '/../../../');

const { seedLocalWmData } = require('../../wmSeedHelper');

describe('Chunk 6: Monitor App, Retry Handling & SLG1 Integration', () => {
  beforeAll(async () => {
    await seedLocalWmData();
  });

  let adapter;

  beforeEach(() => {
    adapter = new ReservationProcessAdapter();
    jest.spyOn(RfcClient.prototype, 'readTable').mockResolvedValue([]);
    jest.spyOn(RfcClient.prototype, 'session').mockImplementation(async (fn) => fn(async (fm) => {
      if (fm === 'BAL_LOG_CREATE') return { E_LOG_HANDLE: 'MOCK_LOG_HANDLE' };
      if (fm === 'BAL_GLB_SEARCH_LOG') return { E_T_LOG_HANDLE: [] };
      return {};
    }));
    jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('1. Backend SLG1 Application Log Wrapper in ReservationProcessAdapter', () => {
    test('writeApplicationLog creates structured log entry with LogHandle and ExternalId', async () => {
      const result = await adapter.writeApplicationLog({
        object: 'ZWM_RES',
        subObject: 'TRACK',
        externalId: '0000524979/0001',
        reservationNo: '0000524979',
        reservationItem: '0001',
        step: 'MB21',
        messageText: 'Reservation created'
      });

      expect(result.success).toBe(true);
      expect(result.logHandle).toBeDefined();
      expect(result.logHandle.length).toBeLessThanOrEqual(22);
      expect(result.externalId).toBe('0000524979/0001');
      expect(result.object).toBe('ZWM_RES');
      expect(result.subObject).toBe('TRACK');
    });

    test('readApplicationLogs queries logs by externalId or handle', async () => {
      const result = await adapter.readApplicationLogs({
        externalId: '0000524979/0001',
        object: 'ZWM_RES',
        subObject: 'TRACK'
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });

});
