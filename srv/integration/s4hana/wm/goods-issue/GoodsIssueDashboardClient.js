'use strict';

const LOG = require('../../logger')('goods-issue-dashboard');
const { RfcClient } = require('../../RfcClient');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

const MOVEMENT_TYPE_NAMES = {
  '201': 'Goods Issue for Cost Center',
  '261': 'Goods Issue to Order',
  '301': 'Plant-to-Plant Transfer',
  '311': 'Storage Location Transfer'
};

const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const sapDate = (v) => (/^\d{8}$/.test(v || '') && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '');

function sapNum(v) {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = s.includes('-');
  s = s.replace(/[-\s]/g, '');
  const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const n = i < 0 ? Number(s) : Number(`${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`);
  return neg ? -n : n;
}

function formatDateToYMD(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

class GoodsIssueDashboardClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.rfc = options.rfc || new RfcClient();
    this.reservationsClient = options.reservationsClient || (this.adapter && this.adapter.reservations) || null;
    this.queueManager = options.queueManager || (this.adapter && this.adapter.queueManager) || null;
    this._cache = new Map();
  }

  _getQueueManager() {
    if (this.queueManager) return this.queueManager;
    if (this.adapter && this.adapter.queueManager) return this.adapter.queueManager;
    try {
      return require('../../../../wm/goods-issue/GoodsIssueQueueManager');
    } catch {
      return null;
    }
  }

  async _getPendingQueueCounts() {
    const counts = { '201': 0, '261': 0, '301': 0, '311': 0, total: 0 };
    try {
      const qm = this._getQueueManager();
      if (qm && typeof qm.getAll === 'function') {
        const items = await qm.getAll();
        if (Array.isArray(items)) {
          for (const item of items) {
            const mvt = String(item.MovementType || '261').trim();
            if (counts[mvt] !== undefined) {
              counts[mvt]++;
            }
            counts.total++;
          }
        }
      }
    } catch (err) {
      LOG.warn(`Could not read pending queue counts: ${err.message}`);
    }
    return counts;
  }

  async _descriptions(matnrs) {
    const out = {};
    const unique = [...new Set(matnrs.filter(Boolean))];
    for (const m of unique) {
      try {
        const sMat = String(m).trim();
        const rows = await this.rfc.readTable(
          'MAKT',
          ['MATNR', 'MAKTX'],
          [`MATNR = '${sMat.padStart(18, '0')}'`, "AND SPRAS = 'E'"]
        );
        if (rows && rows[0]) {
          out[sMat] = rows[0].MAKTX || '';
          out[alphaOut(sMat)] = rows[0].MAKTX || '';
        }
      } catch (err) {
        LOG.warn(`Could not fetch description for material ${m}: ${err.message}`);
      }
    }
    return out;
  }

  /**
   * Aggregate complete Goods Issue Dashboard data.
   * Cached with short TTL. Returns real S/4HANA figures.
   *
   * @param {Object} [options]
   * @param {number} [options.days=30] - Lookback window in days (7 or 30)
   * @param {string} [options.plant=''] - Optional plant filter
   * @param {boolean} [options.forceRefresh=false] - Bypass cache
   * @returns {Promise<Object>} Dashboard payload
   */
  async getDashboardData({ days = 30, plant = '', forceRefresh = false, movementType = '' } = {}) {
    let nDays = Number(days);
    if (isNaN(nDays) || nDays <= 0 || nDays > 90) {
      nDays = 30;
    }
    const sPlant = String(plant || '').trim().toUpperCase();
    if (sPlant && !/^[A-Z0-9]{1,4}$/.test(sPlant)) {
      const err = new Error(`Invalid plant code '${sPlant}'`);
      err.status = 400;
      throw err;
    }

    const sMovementType = String(movementType || '').trim();
    if (sMovementType && !['201', '261', '301', '311'].includes(sMovementType)) {
      const err = new Error(`Invalid movement type '${sMovementType}'`);
      err.status = 400;
      throw err;
    }

    const cacheKey = `${nDays}_${sPlant}_${sMovementType}`;
    const now = Date.now();
    if (!forceRefresh && this._cache.has(cacheKey)) {
      const entry = this._cache.get(cacheKey);
      if (now - entry.timestamp < CACHE_TTL_MS) {
        return entry.data;
      }
    }

    // 1. Fetch Open Reservations in parallel for 201, 261, 301, 311
    let r201 = [];
    let r261 = [];
    let r301 = [];
    let r311 = [];
    if (this.reservationsClient && typeof this.reservationsClient.getOpenReservations === 'function') {
      try {
        [r201, r261, r301, r311] = await Promise.all([
          this.reservationsClient.getOpenReservations('201', sPlant).catch((e) => {
            LOG.warn(`Failed reading open 201 reservations: ${e.message}`);
            return [];
          }),
          this.reservationsClient.getOpenReservations('261', sPlant).catch((e) => {
            LOG.warn(`Failed reading open 261 reservations: ${e.message}`);
            return [];
          }),
          this.reservationsClient.getOpenReservations('301', sPlant).catch((e) => {
            LOG.warn(`Failed reading open 301 reservations: ${e.message}`);
            return [];
          }),
          this.reservationsClient.getOpenReservations('311', sPlant).catch((e) => {
            LOG.warn(`Failed reading open 311 reservations: ${e.message}`);
            return [];
          })
        ]);
      } catch (err) {
        LOG.warn(`Reservation aggregation error: ${err.message}`);
      }
    }

    // 2. Fetch pending queue items
    const queueCounts = await this._getPendingQueueCounts();

    const openPending201 = (r201 ? r201.length : 0) + queueCounts['201'];
    const openPending261 = (r261 ? r261.length : 0) + queueCounts['261'];
    const openPending301 = (r301 ? r301.length : 0) + queueCounts['301'];
    const openPending311 = (r311 ? r311.length : 0) + queueCounts['311'];
    const openPendingOverall = openPending201 + openPending261 + openPending301 + openPending311;

    // 3. Query all-time total counts from MATDOC/MSEG
    const totalWhere = [sMovementType ? `BWART = '${sMovementType}'` : "BWART IN ('201','261','301','311')"];
    if (sPlant) {
      totalWhere.push(`AND WERKS = '${sPlant}'`);
    }

    let allTimeTotals = { '201': 0, '261': 0, '301': 0, '311': 0, overall: 0 };
    try {
      const allRows = await this.rfc.readTable('MATDOC', ['MBLNR', 'BWART'], totalWhere);
      if (Array.isArray(allRows)) {
        for (const row of allRows) {
          const mvt = row.BWART;
          if (allTimeTotals[mvt] !== undefined) {
            allTimeTotals[mvt]++;
          }
          allTimeTotals.overall++;
        }
      }
    } catch (err) {
      LOG.warn(`MATDOC all-time read failed: ${err.message}. Trying MSEG fallback.`);
      try {
        const msegRows = await this.rfc.readTable('MSEG', ['MBLNR', 'BWART'], totalWhere);
        if (Array.isArray(msegRows)) {
          for (const row of msegRows) {
            const mvt = row.BWART;
            if (allTimeTotals[mvt] !== undefined) {
              allTimeTotals[mvt]++;
            }
            allTimeTotals.overall++;
          }
        }
      } catch (msegErr) {
        LOG.error(`Both MATDOC and MSEG all-time queries failed: ${msegErr.message}`);
      }
    }

    // 4. Query recent window postings from MATDOC
    const todayObj = new Date();
    const todayYMD = formatDateToYMD(todayObj);

    const startDateObj = new Date();
    startDateObj.setDate(todayObj.getDate() - nDays);
    const startYMD = formatDateToYMD(startDateObj);

    const windowWhere = [
      sMovementType ? `BWART = '${sMovementType}'` : "BWART IN ('201','261','301','311')",
      `AND BUDAT >= '${startYMD}'`
    ];
    if (sPlant) {
      windowWhere.push(`AND WERKS = '${sPlant}'`);
    }

    const windowFields = [
      'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT',
      'CHARG', 'MENGE', 'MEINS', 'BUDAT', 'USNAM', 'KOSTL', 'AUFNR', 'RSNUM', 'RSPOS', 'SHKZG',
      'UMWRK', 'UMLGO'
    ];

    let windowRows = [];
    try {
      windowRows = await this.rfc.readTable('MATDOC', windowFields, windowWhere);
    } catch (matdocErr) {
      LOG.warn(`MATDOC window query failed: ${matdocErr.message}. Attempting MSEG/MKPF read.`);
      try {
        windowRows = await this.rfc.readTable('MSEG', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'MEINS', 'KOSTL', 'AUFNR', 'RSNUM', 'RSPOS', 'SHKZG', 'UMWRK', 'UMLGO'], windowWhere);
      } catch (msegErr) {
        LOG.error(`Window postings query failed: ${msegErr.message}`);
      }
    }

    // Sort descending by BUDAT then MBLNR then ZEILE
    windowRows.sort((a, b) => {
      const cmpDate = (b.BUDAT || '').localeCompare(a.BUDAT || '');
      if (cmpDate !== 0) return cmpDate;
      const cmpDoc = (b.MBLNR || '').localeCompare(a.MBLNR || '');
      if (cmpDoc !== 0) return cmpDoc;
      return (a.ZEILE || '').localeCompare(b.ZEILE || '');
    });

    // 5. Today's postings calculation
    const todayCounts = { '201': 0, '261': 0, '301': 0, '311': 0, overall: 0 };
    for (const r of windowRows) {
      if (r.BUDAT === todayYMD) {
        if (todayCounts[r.BWART] !== undefined) {
          todayCounts[r.BWART]++;
        }
        todayCounts.overall++;
      }
    }

    // 6. Movement type distribution (based on all-time totals, or window rows if all-time is 0)
    const distTotal = allTimeTotals.overall > 0 ? allTimeTotals.overall : windowRows.length;
    const distribution = ['201', '261', '301', '311'].map((mvt) => {
      const count = allTimeTotals.overall > 0 ? (allTimeTotals[mvt] || 0) : windowRows.filter((r) => r.BWART === mvt).length;
      const percentage = distTotal > 0 ? Number(((count / distTotal) * 100).toFixed(2)) : 0;
      return {
        MovementType: mvt,
        MovementTypeName: MOVEMENT_TYPE_NAMES[mvt] || mvt,
        Count: count,
        Percentage: percentage
      };
    });

    // 7. Daily trend generation (for each date in lookback window)
    const trendMap = new Map();
    for (let i = nDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayObj.getDate() - i);
      const ymd = formatDateToYMD(d);
      const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      const label = `${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
      trendMap.set(ymd, {
        PostingDate: iso,
        DateLabel: label,
        Count201: 0,
        Count261: 0,
        Count301: 0,
        Count311: 0,
        Total: 0
      });
    }

    for (const r of windowRows) {
      const bdate = r.BUDAT;
      if (trendMap.has(bdate)) {
        const item = trendMap.get(bdate);
        if (r.BWART === '201') item.Count201++;
        else if (r.BWART === '261') item.Count261++;
        else if (r.BWART === '301') item.Count301++;
        else if (r.BWART === '311') item.Count311++;
        item.Total++;
      }
    }
    const trend = Array.from(trendMap.values());

    // 8. Recent documents table (top 50) with enriched material descriptions
    const topRecent = windowRows.slice(0, 50);
    const matnrs = topRecent.map((r) => r.MATNR).filter(Boolean);
    const descriptions = await this._descriptions(matnrs);

    const recentDocuments = topRecent.map((r) => {
      const sMatClean = alphaOut(r.MATNR);
      return {
        MaterialDocument: alphaOut(r.MBLNR),
        MaterialDocYear: r.MJAHR || '',
        Item: r.ZEILE || '0001',
        MovementType: r.BWART || '',
        MovementTypeName: MOVEMENT_TYPE_NAMES[r.BWART] || r.BWART || '',
        Material: sMatClean,
        MaterialDesc: descriptions[r.MATNR] || descriptions[sMatClean] || '',
        Plant: r.WERKS || '',
        StorageLocation: r.LGORT || '',
        Batch: r.CHARG || '',
        Quantity: sapNum(r.MENGE),
        Unit: r.MEINS || '',
        PostingDate: sapDate(r.BUDAT),
        User: r.USNAM || '',
        CostCenter: alphaOut(r.KOSTL),
        OrderNo: alphaOut(r.AUFNR),
        ReservationNo: alphaOut(r.RSNUM),
        ReservationItem: alphaOut(r.RSPOS),
        DebitCredit: r.SHKZG || '',
        ReceivingPlant: r.UMWRK || '',
        ReceivingStorageLocation: r.UMLGO || ''
      };
    });

    const result = {
      Kpis: {
        Mvt201: {
          TotalCount: allTimeTotals['201'],
          OpenPendingCount: openPending201,
          TodayPostingsCount: todayCounts['201']
        },
        Mvt261: {
          TotalCount: allTimeTotals['261'],
          OpenPendingCount: openPending261,
          TodayPostingsCount: todayCounts['261']
        },
        Mvt301: {
          TotalCount: allTimeTotals['301'],
          OpenPendingCount: openPending301,
          TodayPostingsCount: todayCounts['301']
        },
        Mvt311: {
          TotalCount: allTimeTotals['311'],
          OpenPendingCount: openPending311,
          TodayPostingsCount: todayCounts['311']
        },
        Overall: {
          TotalCount: allTimeTotals.overall,
          OpenPendingCount: openPendingOverall,
          TodayPostingsCount: todayCounts.overall
        }
      },
      Distribution: distribution,
      Trend: trend,
      RecentDocuments: recentDocuments,
      LastUpdated: new Date().toISOString(),
      PlantFilter: sPlant,
      Days: nDays
    };

    this._cache.set(cacheKey, { timestamp: now, data: result });
    return result;
  }
}

module.exports = GoodsIssueDashboardClient;
