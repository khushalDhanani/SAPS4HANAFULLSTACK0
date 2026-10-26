'use strict';

/**
 * HuStockTransferAdapter — Backend integration adapter for ZRF_RES_HU_DNR ("RF & Desktop HU Stock Transfer").
 *
 * Implements the verified SAP business workflow:
 * - Query open reservations (RESB / RKPF) with requester contact enrichment (USR21/ADRP/ADCP/ADR6/ADR2).
 * - Resolve warehouse mapping (T320) and picking strategy (MLGN / T334T / MLGT / LQUA).
 * - Authoritative unit validation (Handling Unit via VEKP/VEPO or Storage Unit via LQUA).
 * - Serial number mapping (SER06 -> OBJK) and SUT mapping (T307T).
   * - Storage bin stock with strict floor/rack/position parsing and SAP bin-master sections.
 * - Dual posting engine:
 *     * Path A (HU-Managed source SLoc: T001L-XHUPF = 'X'): HU_CREATE_GOODS_MOVEMENT (Event 0006, Mvt 311); no BAPI fallback.
 *     * Path B (Non-HUM source SLoc / Storage Unit): BAPI_GOODSMVT_CREATE (GM_CODE 06, Mvt 311, reservation ref, commit) in one LUW.
 * - Every posting is read back from MATDOC/MSEG (BWART 311) before success is reported.
 * - Idempotency protection to prevent duplicate postings.
 */

const cds = require('@sap/cds');
const LOG = cds.log('hu-stock-transfer-adapter');
const { RfcClient } = require('../RfcClient');
const parseRackBinName = require('./parseRackBinName');
const {
  classifyTransferPath,
  isShippingManaged,
  precheckPathA,
  assignHuToCompetingReservations,
  rankCompetingReservations,
  resolveHuStorageTypeRules
} = require('./transferPathHelper');
const businessConfigResolver = require('../../../common/BusinessConfigResolver');
const HU_STOCK_TRANSFER_MOVEMENT_TYPE = '311';
const NO_STORAGE_RULES = Object.freeze({ isPickable: () => false, isOnHold: () => false, isInterim: () => false });

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** RFC_READ_TABLE OPTIONS are raw Open SQL text; a quote in a caller value would change the query. */
function assertSapOptionValue(name, value) {
  if (/['\\]/.test(String(value ?? ''))) throw httpError(400, `${name} contains an unsupported character.`);
}

class HuStockTransferAdapter {
  constructor({ rfcClient = null, businessConfigResolver: bcr = null, storageTypeRules = null } = {}) {
    this.rfc = rfcClient || new RfcClient();
    this.businessConfigResolver = bcr || businessConfigResolver;
    this._injectedStorageTypeRules = storageTypeRules || null;
    this._storageTypeRules = new Map(); // plant|warehouse -> resolved rules
    this._attemptCache = new Map(); // In-memory idempotency cache
  }

  /**
   * Helper: Zero-pad numeric strings to target length.
   */
  _pad(val, length) {
    if (!val) return '';
    const str = String(val).trim();
    if (!/^\d+$/.test(str)) return str;
    return str.padStart(length, '0');
  }

  /**
   * Helper: Strip leading zeros for display.
   */
  _unpad(val) {
    if (!val) return '';
    const str = String(val).trim();
    return str.replace(/^0+/, '') || '0';
  }

  /**
   * Reads open reservations matching selection criteria (Screen 1000 + ALV grid).
   */
  async getOpenReservations(filters = {}) {
    const {
      plant,
      storageLocation,
      movementType,
      requester,
      reservation,
      material,
      status = 'open',
      includeDeleted = false
    } = filters;
    Object.entries({ plant, storageLocation, movementType, requester, reservation, material })
      .forEach(([name, value]) => assertSapOptionValue(name, value));
    if (!plant) throw httpError(400, 'plant is required');

    const conditions = [];
    if (plant) conditions.push(`WERKS = '${plant}'`);
    if (storageLocation) conditions.push(`LGORT = '${storageLocation}'`);
    if (movementType) conditions.push(`BWART = '${movementType}'`);
    else conditions.push(`( BWART = '311' OR BWART = '301' OR BWART = '201' OR BWART = '261' )`);
    if (reservation) conditions.push(`RSNUM = '${this._pad(reservation, 10)}'`);
    if (material) conditions.push(`MATNR = '${this._pad(material, 18)}'`);

    const whereClauses = [];
    conditions.forEach((cond, idx) => {
      if (idx === 0) {
        whereClauses.push(cond);
      } else {
        whereClauses.push(`AND ${cond}`);
      }
    });

    let resbRows = [];
    try {
      resbRows = await this.rfc.readTable(
        'RESB',
        ['RSNUM', 'RSPOS', 'BWART', 'MATNR', 'CHARG', 'BDMNG', 'ENMNG', 'MEINS', 'WERKS', 'LGORT', 'UMLGO', 'BDTER', 'KZEAR', 'XLOEK'],
        whereClauses,
        500
      );
    } catch (e) {
      LOG.error('Failed to read RESB:', e.message);
      throw httpError(502, `SAP error reading reservations: ${e.message}`);
    }

    if (!resbRows || !resbRows.length) {
      return { TotalCount: 0, Items: [] };
    }

    // Filter deleted items if requested
    let activeRows = resbRows;
    if (!includeDeleted) {
      activeRows = activeRows.filter((r) => r.XLOEK !== 'X');
    }

    // Filter status (open vs completed vs all)
    if (status.toLowerCase() === 'open') {
      activeRows = activeRows.filter((r) => r.KZEAR !== 'X' && (parseFloat(r.BDMNG || 0) - parseFloat(r.ENMNG || 0)) > 0);
    } else if (status.toLowerCase() === 'completed') {
      activeRows = activeRows.filter((r) => r.KZEAR === 'X' || (parseFloat(r.BDMNG || 0) - parseFloat(r.ENMNG || 0)) <= 0);
    }

    if (!activeRows.length) {
      return { TotalCount: 0, Items: [] };
    }

    // Batch read RKPF headers for requester (chunked OR queries to stay <= 72 chars per line)
    const rsnums = [...new Set(activeRows.map((r) => r.RSNUM))].filter(Boolean);
    const rkpfMap = new Map();
    if (rsnums.length) {
      for (let i = 0; i < rsnums.length; i += 8) {
        const chunk = rsnums.slice(i, i + 8);
        const rkpfWhere = [];
        chunk.forEach((r, idx) => {
          rkpfWhere.push(`${idx === 0 ? '( ' : 'OR '}RSNUM = '${r}'`);
        });
        rkpfWhere.push(')');
        try {
          const rkpfRows = await this.rfc.readTable('RKPF', ['RSNUM', 'USNAM', 'BWART'], rkpfWhere, 500);
          for (const row of rkpfRows) {
            rkpfMap.set(row.RSNUM, row);
          }
        } catch (e) {
          LOG.warn('Could not read RKPF headers chunk:', e.message);
        }
      }
    }

    // Filter by requester if specified
    if (requester) {
      const sReq = requester.trim().toUpperCase();
      activeRows = activeRows.filter((r) => {
        const header = rkpfMap.get(r.RSNUM);
        return header && header.USNAM && header.USNAM.trim().toUpperCase() === sReq;
      });
    }

    // Batch read Material Descriptions from MAKT (chunked OR queries)
    const matnrs = [...new Set(activeRows.map((r) => r.MATNR))].filter(Boolean);
    const maktMap = new Map();
    if (matnrs.length) {
      for (let i = 0; i < matnrs.length; i += 8) {
        const chunk = matnrs.slice(i, i + 8);
        const maktWhere = [];
        chunk.forEach((m, idx) => {
          maktWhere.push(`${idx === 0 ? '( ' : 'OR '}MATNR = '${m}'`);
        });
        maktWhere.push(')');
        maktWhere.push(`AND SPRAS = 'E'`);
        try {
          const maktRows = await this.rfc.readTable('MAKT', ['MATNR', 'MAKTX'], maktWhere, 500);
          for (const m of maktRows) {
            maktMap.set(m.MATNR, m.MAKTX);
          }
        } catch (e) {
          LOG.warn('Could not read MAKT chunk:', e.message);
        }
      }
    }

    // Batch resolve Warehouse mapping (T320)
    const whseMap = new Map();
    try {
      const t320Rows = await this.rfc.readTable('T320', ['WERKS', 'LGORT', 'LGNUM'], [`WERKS = '${plant}'`], 100);
      for (const t of t320Rows) {
        whseMap.set(`${t.WERKS}|${t.LGORT}`, t.LGNUM);
      }
    } catch (e) {
      LOG.warn('Could not read T320:', e.message);
    }

    // Batch read Requester full names & contact from USR21 + ADRP (chunked OR queries)
    const userIds = [...new Set([...rkpfMap.values()].map((h) => h.USNAM).filter(Boolean))];
    const userContactMap = new Map();
    if (userIds.length) {
      for (let i = 0; i < userIds.length; i += 8) {
        const chunk = userIds.slice(i, i + 8);
        const uWhere = [];
        chunk.forEach((u, idx) => {
          uWhere.push(`${idx === 0 ? '( ' : 'OR '}BNAME = '${u}'`);
        });
        uWhere.push(')');
        try {
          const usr21Rows = await this.rfc.readTable('USR21', ['BNAME', 'PERSNUMBER', 'ADDRNUMBER'], uWhere, 100);
          const persnums = usr21Rows.map((u) => u.PERSNUMBER).filter(Boolean);
          if (persnums.length) {
            for (let j = 0; j < persnums.length; j += 8) {
              const pChunk = persnums.slice(j, j + 8);
              const pWhere = [];
              pChunk.forEach((p, idx) => {
                pWhere.push(`${idx === 0 ? '( ' : 'OR '}PERSNUMBER = '${p}'`);
              });
              pWhere.push(')');
              try {
                const adrpRows = await this.rfc.readTable('ADRP', ['PERSNUMBER', 'NAME_TEXT'], pWhere, 100);
                const adrpMap = new Map(adrpRows.map((a) => [a.PERSNUMBER, a.NAME_TEXT]));
                for (const u of usr21Rows) {
                  userContactMap.set(u.BNAME, {
                    nameText: adrpMap.get(u.PERSNUMBER) || u.BNAME,
                    phone: '',
                    email: '' // only ADR6 (cockpit read) is a real address; nothing is derived from the user name
                  });
                }
              } catch (e) {
                LOG.warn('Could not read ADRP chunk:', e.message);
              }
            }
          }
        } catch (e) {
          LOG.warn('Could not read user master info:', e.message);
        }
      }
    }

    // Build OpenReservationItem array
    const items = activeRows.map((row) => {
      const header = rkpfMap.get(row.RSNUM) || {};
      const usnam = header.USNAM || '';
      const contact = userContactMap.get(usnam) || { nameText: usnam, phone: '', email: '' };
      const reqQty = parseFloat(row.BDMNG || 0);
      const withQty = parseFloat(row.ENMNG || 0);
      const openQty = Math.max(0, reqQty - withQty);
      const isDeleted = row.XLOEK === 'X';
      const isFinal = row.KZEAR === 'X' || openQty <= 0;

      let statusKey = 'Open';
      let statusText = 'Open';
      let statusState = 'Information';
      if (isDeleted) {
        statusKey = 'Deleted';
        statusText = 'Deleted';
        statusState = 'Error';
      } else if (isFinal) {
        statusKey = 'Completed';
        statusText = 'Completed';
        statusState = 'Success';
      } else if (withQty > 0) {
        statusKey = 'Partial';
        statusText = 'Partially Open';
        statusState = 'Warning';
      }

      const whse = whseMap.get(`${row.WERKS}|${row.LGORT}`) || '';

      return {
        ReservationNo: this._unpad(row.RSNUM),
        ReservationItem: this._unpad(row.RSPOS),
        MovementType: row.BWART || header.BWART || '',
        RequirementDate: row.BDTER || null,
        Requester: usnam,
        RequesterName: contact.nameText,
        RequesterPhone: contact.phone,
        RequesterEmail: contact.email,
        Material: this._unpad(row.MATNR),
        MaterialDesc: maktMap.get(row.MATNR) || '',
        Batch: row.CHARG || '',
        RequiredQty: reqQty,
        WithdrawnQty: withQty,
        OpenQty: openQty,
        BaseUnit: row.MEINS || '',
        Plant: row.WERKS || '',
        StorageLocation: row.LGORT || '',
        ReceivingStorageLocation: row.UMLGO || '',
        Warehouse: whse,
        AvailableUnitCount: 0, // Enriched on-demand in cockpit
        TotalAvailableStock: 0,
        PreferredStorageType: '',
        SutIndicator: 'Standard',
        StorageUnitType: '',
        StorageUnitTypeDesc: '',
        Status: statusKey,
        StatusText: statusText,
        StatusState: statusState,
        IsDeleted: isDeleted,
        IsFinalIssue: isFinal
      };
    });

    return {
      TotalCount: items.length,
      Items: items
    };
  }

  /**
   * Retrieves Transfer Cockpit details for one selected reservation item (Screen 2000).
   */
  async getCockpitDetail(reservationNo, reservationItem) {
    if (!reservationNo) throw httpError(400, 'Reservation number is required');
    assertSapOptionValue('reservation', reservationNo);
    assertSapOptionValue('item', reservationItem);
    const s4Rsnum = this._pad(reservationNo, 10);
    const s4Rspos = this._pad(reservationItem || '1', 4);

    let resbRows = [];
    try {
      resbRows = await this.rfc.readTable(
        'RESB',
        ['RSNUM', 'RSPOS', 'BWART', 'MATNR', 'CHARG', 'BDMNG', 'ENMNG', 'MEINS', 'WERKS', 'LGORT', 'UMLGO', 'BDTER', 'KZEAR', 'XLOEK'],
        [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`],
        1
      );
    } catch (e) {
      throw httpError(502, `Failed to read reservation ${reservationNo}: ${e.message}`);
    }

    if (!resbRows || !resbRows.length) {
      throw httpError(404, `Reservation ${reservationNo} item ${reservationItem} not found in SAP`);
    }

    const row = resbRows[0];
    const reqQty = parseFloat(row.BDMNG || 0);
    const withQty = parseFloat(row.ENMNG || 0);
    const openQty = Math.max(0, reqQty - withQty);

    // Read header for requester
    let usnam = '';
    try {
      const rkpfRows = await this.rfc.readTable('RKPF', ['USNAM', 'BWART'], [`RSNUM = '${s4Rsnum}'`], 1);
      if (rkpfRows.length) usnam = rkpfRows[0].USNAM || '';
    } catch (e) {
      LOG.warn('Could not read RKPF header:', e.message);
    }

    // Material description
    let maktx = '';
    try {
      const maktRows = await this.rfc.readTable('MAKT', ['MAKTX'], [`MATNR = '${row.MATNR}'`, `AND SPRAS = 'E'`], 1);
      if (maktRows.length) maktx = maktRows[0].MAKTX || '';
    } catch (e) {
      LOG.warn('Could not read MAKT:', e.message);
    }

    // Contact info
    let requesterName = usnam;
    let requesterEmail = '';
    let requesterPhone = '';
    if (usnam) {
      try {
        const usr = await this.rfc.readTable('USR21', ['PERSNUMBER', 'ADDRNUMBER'], [`BNAME = '${usnam}'`], 1);
        if (usr.length) {
          const adrp = await this.rfc.readTable('ADRP', ['NAME_TEXT'], [`PERSNUMBER = '${usr[0].PERSNUMBER}'`], 1);
          if (adrp.length) requesterName = adrp[0].NAME_TEXT || usnam;
          const adr6 = await this.rfc.readTable('ADR6', ['SMTP_ADDR'], [`PERSNUMBER = '${usr[0].PERSNUMBER}'`], 1);
          if (adr6.length && adr6[0].SMTP_ADDR) requesterEmail = adr6[0].SMTP_ADDR;
        }
      } catch (e) {
        LOG.warn('Could not read requester contact:', e.message);
      }
    }

    // Warehouse & Preferred Storage Type Strategy (determine_whse_and_pref_stg)
    let warehouse = '';
    try {
      const t320 = await this.rfc.readTable('T320', ['LGNUM'], [`WERKS = '${row.WERKS}'`, `AND LGORT = '${row.LGORT}'`], 1);
      if (t320.length) warehouse = t320[0].LGNUM || '';
    } catch (e) {
      LOG.warn('Could not read T320:', e.message);
    }

    let prefStorageType = ''; // only MLGN/T334T decide; blank means no picking strategy was found
    if (warehouse && row.MATNR) {
      try {
        const mlgn = await this.rfc.readTable('MLGN', ['LTKZA', 'LTKZE'], [`MATNR = '${row.MATNR}'`, `AND LGNUM = '${warehouse}'`], 1);
        if (mlgn.length && mlgn[0].LTKZA) {
          const t334t = await this.rfc.readTable('T334T', ['LGTY0'], [`LGNUM = '${warehouse}'`, `AND KZEAR = 'A'`, `AND LGTKZ = '${mlgn[0].LTKZA}'`], 1);
          if (t334t.length && t334t[0].LGTY0) prefStorageType = t334t[0].LGTY0;
        }
      } catch (e) {
        LOG.warn('Could not read picking strategy:', e.message);
      }
    }

    // Count in-stock HUs (VEKP/VEPO) and SUs (LQUA) in source location
    let availCount = 0;
    let availStock = 0;
    try {
      const vepoWhere = [
        `MATNR = '${row.MATNR}'`,
        `AND WERKS = '${row.WERKS}'`,
        `AND LGORT = '${row.LGORT}'`
      ];
      if (row.CHARG) vepoWhere.push(`AND CHARG = '${row.CHARG}'`);
      const vepoRows = await this.rfc.readTable('VEPO', ['VENUM', 'VEMNG'], vepoWhere, 200);
      const inStockRows = await this._excludeGoodsIssuedHus(vepoRows);
      availCount = new Set(inStockRows.map((v) => v.VENUM)).size;
      availStock = inStockRows.reduce((acc, v) => acc + parseFloat(v.VEMNG || 0), 0);

      // If no HUs, check LQUA Storage Units
      if (availCount === 0 && warehouse) {
        const lquaWhere = [
          `MATNR = '${row.MATNR}'`,
          `AND LGNUM = '${warehouse}'`,
          `AND LGORT = '${row.LGORT}'`
        ];
        if (row.CHARG) lquaWhere.push(`AND CHARG = '${row.CHARG}'`);
        const lquaRows = await this.rfc.readTable('LQUA', ['LENUM', 'GESME'], lquaWhere, 200);
        const nonZeroRows = lquaRows.filter((q) => this._parseSapQty(q.GESME) > 0);
        availCount = nonZeroRows.length;
        availStock = nonZeroRows.reduce((acc, q) => acc + this._parseSapQty(q.GESME), 0);
      }
    } catch (e) {
      LOG.warn('Could not calculate available unit count:', e.message);
    }

    // Inspect T001L for HUM flag (XHUPF) and shipping management (VSTEL)
    let isHuManaged = false;
    let xhupf = '';
    let transferPath = 'standard';
    if (row.WERKS && row.LGORT) {
      try {
        const t001lRows = await this.rfc.readTable(
          'T001L',
          ['WERKS', 'LGORT', 'XHUPF', 'VSTEL'],
          [`WERKS = '${row.WERKS}'`, `AND LGORT = '${row.LGORT}'`],
          1
        );
        if (t001lRows.length) {
          xhupf = t001lRows[0].XHUPF || '';
          isHuManaged = xhupf === 'X';
          transferPath = classifyTransferPath(t001lRows[0]);
        }
      } catch (e) {
        LOG.warn('Could not read T001L for cockpit:', e.message);
      }
    }

    const oversizeHuSelectionBehavior = await this.businessConfigResolver.resolveOversizeHuSelectionBehavior({
      plant: row.WERKS,
      warehouse
    });

    return {
      ReservationNo: this._unpad(row.RSNUM),
      ReservationItem: this._unpad(row.RSPOS),
      MovementType: row.BWART || '',
      Requester: usnam,
      RequesterName: requesterName,
      RequesterPhone: requesterPhone,
      RequesterEmail: requesterEmail,
      Material: this._unpad(row.MATNR),
      MaterialDesc: maktx,
      Batch: row.CHARG || '',
      OpenQty: openQty,
      BaseUnit: row.MEINS || '',
      Plant: row.WERKS || '',
      StorageLocation: row.LGORT || '',
      ReceivingStorageLocation: row.UMLGO || '',
      Warehouse: warehouse,
      PreferredStorageType: prefStorageType,
      TotalAvailableStock: availStock,
      AvailableUnitCount: availCount,
      SutMode: 'Standard Item',
      IsHuManaged: isHuManaged,
      Xhupf: xhupf,
      TransferPath: transferPath,
      OversizeHuSelectionBehavior: oversizeHuSelectionBehavior
    };
  }

  /**
   * Authoritative Unit Validation (implements ABAP FORM validate_handling_unit).
   * Validates both Handling Units (VEKP/VEPO) and Storage Units (LQUA).
   */
  async validateUnit(reservationNo, reservationItem, unitNumber) {
    if (!unitNumber) throw httpError(400, 'Unit number (HU or SU) is required');
    assertSapOptionValue('unitNumber', unitNumber);

    // Retrieve reservation context
    const cockpit = await this.getCockpitDetail(reservationNo, reservationItem);
    const s4Unit = String(unitNumber).trim();
    const s4UnitAlpha = this._pad(s4Unit, 20);

    let unitType = 'HU';
    let matnr = '';
    let charg = '';
    let qty = 0;
    let meins = '';
    let werks = '';
    let lgort = '';
    let lgnum = cockpit.Warehouse || '';
    let lgtyp = '';
    let lgpla = '';
    let letyp = '';
    let letyt = '';
    let sernr = '';

    // 1. Check if Unit is a Handling Unit in VEKP
    let vekpRows = [];
    try {
      vekpRows = await this.rfc.readTable(
        'VEKP',
        ['VENUM', 'STATUS', 'WERKS', 'LGORT', 'EXIDV', 'VHART', 'VHILM'],
        [`EXIDV = '${s4UnitAlpha}'`],
        1
      );
      if (!vekpRows.length) {
        vekpRows = await this.rfc.readTable(
          'VEKP',
          ['VENUM', 'STATUS', 'WERKS', 'LGORT', 'EXIDV', 'VHART', 'VHILM'],
          [`EXIDV = '${s4Unit}'`],
          1
        );
      }
    } catch (e) {
      LOG.warn('Could not read VEKP:', e.message);
    }

    if (vekpRows.length > 0) {
      unitType = 'Handling Unit (HU)';
      const vekp = vekpRows[0];

      // Rejection: HU is already goods-issued (status 0050)
      if (vekp.STATUS === '0050') {
        return {
          Valid: false,
          UnitNumber: s4Unit,
          UnitType: unitType,
          StatusState: 'Error',
          StatusMessage: `Handling Unit ${s4Unit} is already Goods Issued (Status 0050). Please select an in-stock HU.`
        };
      }

      // Check contents in VEPO
      let vepoRows = [];
      try {
        vepoRows = await this.rfc.readTable(
          'VEPO',
          ['MATNR', 'CHARG', 'VEMNG', 'VEMEH', 'WERKS', 'LGORT'],
          [`VENUM = '${vekp.VENUM}'`],
          1
        );
      } catch (e) {
        LOG.warn('Could not read VEPO:', e.message);
      }

      if (!vepoRows.length) {
        return {
          Valid: false,
          UnitNumber: s4Unit,
          UnitType: unitType,
          StatusState: 'Error',
          StatusMessage: `Handling Unit ${s4Unit} is empty (no material items found in VEPO).`
        };
      }

      const vepo = vepoRows[0];
      matnr = this._unpad(vepo.MATNR);
      charg = vepo.CHARG || '';
      qty = parseFloat(vepo.VEMNG || 0);
      meins = vepo.VEMEH || '';
      werks = vepo.WERKS || vekp.WERKS || '';
      lgort = vepo.LGORT || vekp.LGORT || '';

      // Serial resolution from SER06 + OBJK
      try {
        const ser06 = await this.rfc.readTable('SER06', ['OBKNR'], [`EXIDV = '${vekp.EXIDV}'`], 1);
        if (ser06.length && ser06[0].OBKNR) {
          const objk = await this.rfc.readTable('OBJK', ['SERNR'], [`OBKNR = '${ser06[0].OBKNR}'`], 1);
          if (objk.length) sernr = objk[0].SERNR || '';
        }
      } catch (e) {
        LOG.warn('Could not read serials for HU:', e.message);
      }

      // Query LQUA for bin and SUT
      try {
        const lqua = await this.rfc.readTable(
          'LQUA',
          ['LGNUM', 'LGTYP', 'LGPLA', 'LETYP'],
          [`LENUM = '${s4UnitAlpha}'`],
          1
        );
        if (lqua.length) {
          lgnum = lqua[0].LGNUM || lgnum;
          lgtyp = lqua[0].LGTYP || '';
          lgpla = lqua[0].LGPLA || '';
          letyp = lqua[0].LETYP || '';
        }
      } catch (e) {
        LOG.warn('Could not read LQUA for HU:', e.message);
      }

    } else {
      // 2. Check if Unit is a Storage Unit (SU) in LQUA or Storage Bin (LGPLA)
      let lquaRows = [];
      let isSuMatch = false;
      const s4MatPad = cockpit.Material ? this._pad(cockpit.Material, 18) : '';
      const isAllZeros = /^0+$/.test(s4Unit);

      if (!isAllZeros) {
        try {
          const suWhere = [
            `( LENUM = '${s4UnitAlpha}' OR LENUM = '${s4Unit}' )`,
            `AND GESME > 0`
          ];
          if (cockpit.Warehouse) suWhere.push(`AND LGNUM = '${cockpit.Warehouse}'`);
          if (s4MatPad) suWhere.push(`AND MATNR = '${s4MatPad}'`);
          lquaRows = await this.rfc.readTable(
            'LQUA',
            ['MATNR', 'CHARG', 'GESME', 'MEINS', 'WERKS', 'LGORT', 'LGNUM', 'LGTYP', 'LGPLA', 'LETYP', 'LENUM'],
            suWhere,
            1
          );
          if (lquaRows.length) isSuMatch = true;
        } catch (e) {
          LOG.warn('Could not read LQUA for SU:', e.message);
        }
      }

      if (!lquaRows.length) {
        try {
          const binWhere = [
            `LGPLA = '${s4Unit}'`,
            `AND GESME > 0`
          ];
          if (cockpit.Warehouse) binWhere.push(`AND LGNUM = '${cockpit.Warehouse}'`);
          if (s4MatPad) binWhere.push(`AND MATNR = '${s4MatPad}'`);
          lquaRows = await this.rfc.readTable(
            'LQUA',
            ['MATNR', 'CHARG', 'GESME', 'MEINS', 'WERKS', 'LGORT', 'LGNUM', 'LGTYP', 'LGPLA', 'LETYP', 'LENUM'],
            binWhere,
            1
          );
        } catch (e) {
          LOG.warn('Could not read LQUA for bin:', e.message);
        }
      }

      if (lquaRows.length > 0 && parseFloat(lquaRows[0].GESME || 0) > 0) {
        const lq = lquaRows[0];
        unitType = isSuMatch ? 'Storage Unit (SU)' : 'Storage Bin Stock';
        matnr = this._unpad(lq.MATNR);
        charg = lq.CHARG || '';
        qty = parseFloat(lq.GESME || 0);
        meins = lq.MEINS || '';
        werks = lq.WERKS || '';
        lgort = lq.LGORT || '';
        lgnum = lq.LGNUM || lgnum;
        lgtyp = lq.LGTYP || '';
        lgpla = lq.LGPLA || '';
        letyp = lq.LETYP || '';
      } else {
        return {
          Valid: false,
          UnitNumber: s4Unit,
          UnitType: 'Unknown',
          StatusState: 'Error',
          StatusMessage: `Scanned unit or bin "${s4Unit}" does not exist in VEKP (HU) or LQUA (Storage Unit / Bin).`
        };
      }
    }

    // Resolve SUT description from T307T
    if (letyp && lgnum) {
      try {
        const t307t = await this.rfc.readTable(
          'T307T',
          ['LETYT'],
          [`SPRAS = 'E'`, `AND LGNUM = '${lgnum}'`, `AND LETYP = '${letyp}'`],
          1
        );
        if (t307t.length) letyt = t307t[0].LETYT || '';
      } catch (e) {
        LOG.warn('Could not read T307T:', e.message);
      }
    }

    // 3. Validation Rules vs Selected Reservation
    // Rule A: Storage location match
    if (cockpit.StorageLocation && lgort && lgort !== cockpit.StorageLocation) {
      return {
        Valid: false,
        UnitNumber: s4Unit,
        UnitType: unitType,
        StatusState: 'Error',
        StatusMessage: `Storage Location Mismatch: ${unitType} is located in SLoc ${lgort}, but Reservation requires Source SLoc ${cockpit.StorageLocation}.`
      };
    }

    // Rule B: Material match
    if (cockpit.Material && matnr && matnr !== cockpit.Material) {
      return {
        Valid: false,
        UnitNumber: s4Unit,
        UnitType: unitType,
        StatusState: 'Error',
        StatusMessage: `Material Mismatch: ${unitType} contains material ${matnr}, but Reservation requires ${cockpit.Material}.`
      };
    }

    // Rule C: Batch match (if reservation specifies a batch)
    if (cockpit.Batch && charg && charg !== cockpit.Batch) {
      return {
        Valid: false,
        UnitNumber: s4Unit,
        UnitType: unitType,
        StatusState: 'Error',
        StatusMessage: `Batch Mismatch: ${unitType} contains batch ${charg}, but Reservation requires batch ${cockpit.Batch}.`
      };
    }

    // Rule D: Quantity calculation (default transfer qty = min(unitQty, openQty))
    const defaultTransferQty = Math.min(qty, cockpit.OpenQty);

    // Rule E: Evaluate Storage Type status via BusinessConfigResolver (no hardcoded literals)
    // Without a WM warehouse there is no storage type to classify; no rules are resolved (no default warehouse).
    const storageRules = lgnum ? await this.getStorageTypeRules({ plant: werks, warehouse: lgnum, isTrusted: true }) : NO_STORAGE_RULES;
    const isOnHold = storageRules.isOnHold(lgtyp, lgpla);
    const isInProcess = storageRules.isInterim(lgtyp);
    const isPreferred = storageRules.isPickable(lgtyp) || (cockpit.PreferredStorageType && lgtyp === cockpit.PreferredStorageType);

    let statusState = 'Success';
    let statusMessage = `${unitType} ${s4Unit} validated! In Storage Type ${lgtyp} (Bin: ${lgpla}), Available: ${qty} ${meins}.`;

    if (isOnHold) {
      statusState = 'Warning';
      statusMessage = `Warning: Scanned ${unitType} ${s4Unit} is ON-HOLD in Storage Type ${lgtyp} (Bin: ${lgpla})!`;
    } else if (isInProcess) {
      statusState = 'Information';
      statusMessage = `Notice: Scanned ${unitType} ${s4Unit} is IN-PROCESS in Storage Type ${lgtyp} (Bin: ${lgpla}).`;
    } else if (isPreferred) {
      statusState = 'Success';
      statusMessage = `${unitType} ${s4Unit} verified in Preferred Storage Type ${lgtyp} (Bin: ${lgpla})! Available: ${qty} ${meins}.`;
    }

    let precheckResult = null;
    if (cockpit.TransferPath === 'A') {
      const vRow = vekpRows[0] || {};
      precheckResult = await this.precheckPathA(
        cockpit,
        reservationItem,
        {
          unitNumber: s4Unit,
          inStock: qty > 0 && !isOnHold,
          availableStock: qty,
          warehouse: lgnum,
          packagingType: vRow.VHART || '',
          packagingMaterial: vRow.VHILM || '',
          serials: sernr ? [sernr] : []
        }
      );

      if (!precheckResult.valid) {
        return {
          Valid: false,
          UnitNumber: s4Unit,
          UnitType: unitType,
          StatusState: 'Error',
          StatusMessage: precheckResult.blockers.join('; '),
          Blockers: precheckResult.blockers,
          BlockerDetails: precheckResult.blockerDetails,
          Warnings: precheckResult.warnings || [],
          WarningDetails: precheckResult.warningDetails || []
        };
      }

      if (precheckResult.warnings && precheckResult.warnings.length > 0) {
        statusState = 'Warning';
        statusMessage = precheckResult.warnings.join('; ');
      }
    }

    return {
      Valid: true,
      UnitNumber: s4Unit,
      UnitType: unitType,
      SutCode: letyp,
      SutDescription: letyt,
      SerialNumber: sernr,
      Batch: charg,
      AvailableQuantity: qty,
      BaseUnit: meins,
      Plant: werks,
      StorageLocation: lgort,
      Warehouse: lgnum,
      StorageType: lgtyp,
      StorageBin: lgpla,
      IsOnHold: isOnHold,
      IsInProcess: isInProcess,
      IsPreferredStorage: isPreferred,
      StatusState: statusState,
      StatusMessage: statusMessage,
      DefaultTransferQty: defaultTransferQty,
      Warnings: (precheckResult && precheckResult.warnings) ? precheckResult.warnings : [],
      WarningDetails: (precheckResult && precheckResult.warningDetails) ? precheckResult.warningDetails : []
    };
  }

  /** Read-only validation for a multi-HU reservation selection. No posting method is called. */
  async validateHuStockTransferSelection(payload = {}) {
    const reservationNo = String(payload.ReservationNo || '').trim();
    const reservationItem = String(payload.ReservationItem || '0001').trim();
    const selections = payload.Selections;
    if (!reservationNo || !reservationItem) throw httpError(400, 'Reservation number and item are required');
    if (!Array.isArray(selections) || selections.length === 0 || selections.length > 50) {
      throw httpError(400, 'Select between 1 and 50 handling units.');
    }

    const cockpit = await this.getCockpitDetail(reservationNo, reservationItem);
    // Oversize-HU setting: “default BLOCK, pending the user's confirmation”.
    const behavior = String(cockpit.OversizeHuSelectionBehavior || 'BLOCK').trim().toUpperCase();
    if (!['BLOCK', 'WARN'].includes(behavior)) throw httpError(503, 'Oversize HU selection policy is invalid.');
    const seen = new Set();
    const items = [];
    const warnings = [];
    let selectedTotal = 0;
    let remaining = Number(cockpit.OpenQty);
    if (!Number.isFinite(remaining) || remaining < 0) throw httpError(503, 'Open reservation quantity is unavailable.');

    for (const selected of selections) {
      const unitNumber = String(selected?.UnitNumber || '').trim();
      const transferQty = Number(selected?.TransferQty);
      if (!/^[A-Z0-9._/-]{1,20}$/i.test(unitNumber)) throw httpError(400, 'Handling unit number is missing or invalid.');
      if (seen.has(unitNumber.toUpperCase())) throw httpError(400, `Handling unit ${unitNumber} is selected more than once.`);
      seen.add(unitNumber.toUpperCase());
      if (!Number.isFinite(transferQty) || transferQty <= 0) throw httpError(400, `Transfer quantity for HU ${unitNumber} must be greater than zero.`);

      const validation = await this.validateUnit(reservationNo, reservationItem, unitNumber);
      if (!validation.Valid || !String(validation.UnitType || '').includes('HU')) {
        throw httpError(422, validation.StatusMessage || `Unit ${unitNumber} is not a valid in-stock handling unit.`);
      }
      const available = Number(validation.AvailableQuantity);
      if (!Number.isFinite(available) || available <= 0 || transferQty > available) {
        throw httpError(422, `Transfer quantity for HU ${unitNumber} exceeds its available stock (${available || 0}).`);
      }
      if (available > remaining) {
        const warning = `HU ${unitNumber} has ${available} ${validation.BaseUnit || ''} available, above the remaining reservation quantity ${remaining}.`;
        if (behavior === 'BLOCK') throw httpError(422, `${warning} Selection is blocked by the current warehouse policy.`);
        warnings.push(warning);
      }
      if (transferQty > remaining) {
        throw httpError(422, `Selected HU quantities exceed the remaining reservation quantity (${remaining}).`);
      }

      items.push({
        UnitNumber: unitNumber,
        TransferQty: transferQty,
        AvailableQuantity: available,
        BaseUnit: validation.BaseUnit,
        StorageType: validation.StorageType,
        StorageBin: validation.StorageBin
      });
      selectedTotal += transferQty;
      remaining -= transferQty;
    }

    return {
      Valid: true,
      ReservationNo: cockpit.ReservationNo,
      ReservationItem: cockpit.ReservationItem,
      OpenQuantity: Number(cockpit.OpenQty),
      SelectedQuantity: selectedTotal,
      RemainingQuantity: remaining,
      OversizeHuSelectionBehavior: behavior,
      Items: items,
      Warnings: warnings
    };
  }

  /** Drops VEPO rows whose VEKP status is 0050 (goods issued); other statuses are kept (semantics Not verified). */
  async _excludeGoodsIssuedHus(vepoRows) {
    const venums = [...new Set(vepoRows.map((v) => v.VENUM).filter(Boolean))];
    const issued = new Set();
    for (let i = 0; i < venums.length; i += 8) {
      const where = venums.slice(i, i + 8).map((v, idx) => `${idx === 0 ? '( ' : 'OR '}VENUM = '${v}'`).concat(')');
      const vekpRows = await this.rfc.readTable('VEKP', ['VENUM', 'STATUS'], where, 100);
      for (const h of vekpRows) if (h.STATUS === '0050') issued.add(h.VENUM);
    }
    return vepoRows.filter((v) => !issued.has(v.VENUM));
  }

  _parseSapQty(val) {
    if (!val) return 0;
    const s = String(val).trim();
    if (s.endsWith('-')) {
      return -parseFloat(s.slice(0, -1)) || 0;
    }
    return parseFloat(s) || 0;
  }

  /**
   * Retrieves storage bins and quants for the reservation material (Screen 2000 "View Storage Bins & Units").
   */
  async getStorageBins(reservationNo, reservationItem) {
    const cockpit = await this.getCockpitDetail(reservationNo, reservationItem);
    const s4Mat = this._pad(cockpit.Material, 18);

    const lquaWhere = [
      `MATNR = '${s4Mat}'`,
      `AND WERKS = '${cockpit.Plant}'`
    ];
    if (cockpit.Warehouse) lquaWhere.push(`AND LGNUM = '${cockpit.Warehouse}'`);
    if (cockpit.StorageLocation) lquaWhere.push(`AND LGORT = '${cockpit.StorageLocation}'`);

    let lquaRows = [];
    try {
      lquaRows = await this.rfc.readTable(
        'LQUA',
        ['LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'LENUM', 'CHARG', 'GESME', 'MEINS', 'LETYP', 'KZHUQ'],
        lquaWhere,
        200
      );
    } catch (e) {
      LOG.warn('Could not read LQUA for storage bins:', e.message);
    }

    const nonZeroLqua = lquaRows.filter((q) => this._parseSapQty(q.GESME) > 0);

    // Enrich only stock bins returned by LQUA. This does not create or infer empty bins.
    const locationKeys = [...new Set(nonZeroLqua.map((q) => `${q.LGNUM}|${q.LGTYP}`))];
    const lagpMap = new Map();
    const sectionNameMap = new Map();
    await Promise.all(locationKeys.map(async (locationKey) => {
      const [warehouse, storageType] = locationKey.split('|');
      let locationRows = [];
      let sectionRows = [];
      try {
        locationRows = await this.rfc.readTable('LAGP', ['LGNUM', 'LGTYP', 'LGPLA', 'LGBER', 'LPTYP'], [
          `LGNUM = '${warehouse}'`, `AND LGTYP = '${storageType}'`
        ]);
      } catch (e) {
        LOG.warn('Could not read LAGP bin master data:', e.message);
      }
      try {
        sectionRows = await this.rfc.readTable('T302T', ['LGNUM', 'LGTYP', 'LGBER', 'SPRAS', 'LBERT'], [
          `LGNUM = '${warehouse}'`, `AND LGTYP = '${storageType}'`, "AND SPRAS = 'E'"
        ]);
      } catch (e) {
        LOG.warn('Could not read T302T section descriptions:', e.message);
      }
      for (const row of locationRows) {
        lagpMap.set(`${row.LGNUM}|${row.LGTYP}|${row.LGPLA}`, row);
      }
      for (const row of sectionRows) {
        sectionNameMap.set(`${row.LGNUM}|${row.LGTYP}|${row.LGBER}`, row.LBERT || '');
      }
    }));

    // Read Storage Type descriptions from T301T
    const t301tMap = new Map();
    try {
      const t301tRows = await this.rfc.readTable('T301T', ['LGNUM', 'LGTYP', 'LTYPT'], [`SPRAS = 'E'`], 200);
      for (const t of t301tRows) t301tMap.set(`${t.LGNUM}|${t.LGTYP}`, t.LTYPT);
    } catch (e) {
      LOG.warn('Could not read T301T:', e.message);
    }

    // Read SUT descriptions from T307T
    const t307tMap = new Map();
    try {
      const t307tRows = await this.rfc.readTable('T307T', ['LGNUM', 'LETYP', 'LETYT'], [`SPRAS = 'E'`], 200);
      for (const t of t307tRows) t307tMap.set(`${t.LGNUM}|${t.LETYP}`, t.LETYT);
    } catch (e) {
      LOG.warn('Could not read T307T:', e.message);
    }

    // Rules per quant warehouse (LQUA-LGNUM); no default warehouse.
    const rulesByWarehouse = new Map();
    for (const wh of new Set(nonZeroLqua.map((q) => q.LGNUM).filter(Boolean))) {
      rulesByWarehouse.set(wh, await this.getStorageTypeRules({ plant: cockpit.Plant, warehouse: wh, isTrusted: true }));
    }

    return nonZeroLqua.map((q) => {
      const storageRules = rulesByWarehouse.get(q.LGNUM) || NO_STORAGE_RULES;
      const location = lagpMap.get(`${q.LGNUM}|${q.LGTYP}|${q.LGPLA}`);
      const rackParts = parseRackBinName(q.LGPLA);
      const sectionCode = location && location.LGBER || '';
      const sectionName = sectionCode
        ? sectionNameMap.get(`${q.LGNUM}|${q.LGTYP}|${sectionCode}`) || ''
        : '';
      const isOnHold = storageRules.isOnHold(q.LGTYP, q.LGPLA);
      const isInProcess = storageRules.isInterim(q.LGTYP);
      const isPref = storageRules.isPickable(q.LGTYP) || (cockpit.PreferredStorageType && q.LGTYP === cockpit.PreferredStorageType);

      let stgStatus = 'Available';
      let sortPrio = 2;
      if (isPref) {
        stgStatus = `Available (${q.LGTYP})`;
        sortPrio = 1;
      } else if (isOnHold) {
        stgStatus = 'On-Hold';
        sortPrio = 4;
      } else if (isInProcess) {
        stgStatus = `In-Process (${q.LGTYP})`;
        sortPrio = 3;
      }

      return {
        StorageStatus: stgStatus,
        UnitCategory: q.KZHUQ === 'X' ? 'HU' : (q.LENUM && this._unpad(q.LENUM) ? 'SU' : 'BIN'),
        UnitNumber: this._unpad(q.LENUM) || q.LGPLA,
        SutCode: q.LETYP || '',
        SutDescription: t307tMap.get(`${q.LGNUM}|${q.LETYP}`) || '',
        StorageType: q.LGTYP,
        StorageTypeDesc: t301tMap.get(`${q.LGNUM}|${q.LGTYP}`) || '',
        StorageSection: sectionCode,
        StorageSectionDesc: sectionName,
        StorageBin: q.LGPLA,
        BinPosition: rackParts.Position,
        Floor: rackParts.Floor,
        Rack: rackParts.Rack,
        Position: rackParts.Position,
        IsRackBin: rackParts.IsRackBin,
        BinType: location && location.LPTYP || '',
        SectionCode: sectionCode,
        SectionName: sectionName,
        BinMasterFound: Boolean(location),
        SerialNumber: '',
        AvailableStock: this._parseSapQty(q.GESME),
        BaseUnit: q.MEINS,
        Batch: q.CHARG || '',
        Warehouse: q.LGNUM,
        StorageLocation: q.LGORT,
        SortPriority: sortPrio
      };
    }).sort((a, b) => a.SortPriority - b.SortPriority);
  }

  /**
   * Compatibility mapping for the former visual-rack operation. Physical levels,
   * bays and rack references are deliberately left blank because they are unverified.
   */
  async getVisualRack(reservationNo, reservationItem) {
    const bins = await this.getStorageBins(reservationNo, reservationItem);

    return bins.map((b) => ({
      ActualStorageBin: b.StorageBin,
      RackReference: '',
      FloorId: b.Floor,
      RackNumber: b.Rack,
      BinPosition: b.Position,
      Position: b.Position,
      ShelfLevelDesc: '',
      LevelCode: '',
      LevelNumber: null,
      StorageSectionDesc: b.SectionName,
      UnitNumber: b.UnitNumber,
      UnitType: b.UnitCategory,
      SutCode: b.SutCode,
      SutDescription: b.SutDescription,
      SerialNumber: b.SerialNumber,
      AvailableQuantity: b.AvailableStock,
      BaseUnit: b.BaseUnit,
      Batch: b.Batch,
      StorageStatus: b.StorageStatus,
      StorageType: b.StorageType,
      StorageTypeDesc: b.StorageTypeDesc,
      StorageSection: b.SectionCode,
      Warehouse: b.Warehouse,
      StorageLocation: b.StorageLocation,
      SortPriority: b.SortPriority,
      IsRackBin: b.IsRackBin,
      BinType: b.BinType,
      SectionCode: b.SectionCode,
      SectionName: b.SectionName,
      BinMasterFound: b.BinMasterFound
    }));
  }

  /**
   * Helper: deterministic paging for LAGP bins using ROWCOUNT and ROWSKIPS,
   * with automatic keyset-paging fallback if ROWSKIPS fails or is rejected.
   */
  async _readLagpPaged(warehouse, storageType, rackPrefix, pageSize = 100) {
    const whereBase = [`LGNUM = '${warehouse}'`];
    if (storageType) whereBase.push(`AND LGTYP = '${storageType}'`);
    if (rackPrefix) {
      const cleanPrefix = String(rackPrefix).trim().replace(/-+$/, '');
      whereBase.push(`AND LGPLA LIKE '${cleanPrefix}-%'`);
    }

    const fields = ['LGNUM', 'LGTYP', 'LGPLA', 'LGBER', 'LPTYP'];
    const allRows = [];
    let page = 0;
    let hasMore = true;
    let supportsRowSkips = true;

    while (hasMore) {
      try {
        const rows = await this.rfc.readTable(
          'LAGP',
          fields,
          whereBase,
          pageSize,
          page * pageSize
        );
        allRows.push(...rows);
        if (!rows || rows.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (err) {
        LOG.warn('Offset paging with ROWSKIPS failed or unsupported, falling back to keyset paging:', err.message);
        supportsRowSkips = false;
        hasMore = false;
      }
    }

    if (!supportsRowSkips) {
      allRows.length = 0;
      let lastLgpla = '';
      hasMore = true;
      while (hasMore) {
        const whereClauses = [...whereBase];
        if (lastLgpla) {
          whereClauses.push(`AND LGPLA > '${lastLgpla}'`);
        }
        const rows = await this.rfc.readTable('LAGP', fields, whereClauses, pageSize);
        allRows.push(...rows);
        if (!rows || rows.length < pageSize) {
          hasMore = false;
        } else {
          lastLgpla = rows[rows.length - 1].LGPLA;
        }
      }
    }

    return allRows;
  }

  /**
   * rackLayout: Bin visualizer where LAGP is the bin universe.
   * - Enumerate maintained locations from LAGP (deterministic paging).
   * - Query T302T for section descriptions.
   * - Query LQUA for positive stock quants, excluding negative and zero quants.
   * - Overlay positive quants onto matching LAGP bins (exact key match: LGNUM, LGTYP, LGPLA).
   * - Two cell states only: 'empty' or 'occupied'. No "no bin maintained" state.
   * - Separate list for non-rack bins (IsRackBin === false, e.g. 921/TRANSFER).
   * - Checks T001L-XHUPF to determine whether source SLoc is HU-managed.
   */
  async rackLayout(params = {}) {
    let {
      warehouse,
      storageType,
      rackPrefix,
      reservation,
      item = '1',
      pageSize = 100
    } = params;

    Object.entries({ warehouse, storageType, rackPrefix }).forEach(([name, value]) => assertSapOptionValue(name, value));
    let cockpit = null;
    let plant = '';
    let sloc = '';
    let material = '';

    if (reservation) {
      cockpit = await this.getCockpitDetail(reservation, item);
      warehouse = warehouse || cockpit.Warehouse;
      storageType = storageType || cockpit.PreferredStorageType || '';
      plant = cockpit.Plant;
      sloc = cockpit.StorageLocation;
      material = cockpit.Material;
    }

    if (!warehouse) throw httpError(400, 'Warehouse could not be determined (no T320 mapping for the reservation plant/storage location, and none was given).');

    // 1. Inspect T001L for HUM flag (XHUPF)
    let isHuManaged = false;
    let xhupf = '';
    if (cockpit) {
      isHuManaged = cockpit.IsHuManaged || false;
      xhupf = cockpit.Xhupf || '';
    } else if (plant && sloc) {
      try {
        const t001lRows = await this.rfc.readTable(
          'T001L',
          ['WERKS', 'LGORT', 'XHUPF'],
          [`WERKS = '${plant}'`, `AND LGORT = '${sloc}'`],
          1
        );
        if (t001lRows.length) {
          xhupf = t001lRows[0].XHUPF || '';
          isHuManaged = xhupf === 'X';
        }
      } catch (e) {
        LOG.warn('Could not read T001L for rackLayout:', e.message);
      }
    }

    // 2. Query LQUA for positive quants (overlay occupancy)
    const lquaWhere = [`LGNUM = '${warehouse}'`];
    if (storageType) {
      lquaWhere.push(`AND LGTYP = '${storageType}'`);
    }
    if (material) {
      const s4Mat = this._pad(material, 18);
      lquaWhere.push(`AND MATNR = '${s4Mat}'`);
    }
    if (plant) lquaWhere.push(`AND WERKS = '${plant}'`);
    if (sloc) lquaWhere.push(`AND LGORT = '${sloc}'`);

    let lquaRows = [];
    try {
      lquaRows = await this.rfc.readTable(
        'LQUA',
        ['LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'LENUM', 'CHARG', 'GESME', 'MEINS', 'LETYP', 'KZHUQ', 'MATNR'],
        lquaWhere,
        500
      );
    } catch (e) {
      LOG.warn('Could not read LQUA for rackLayout:', e.message);
    }

    // Exclude negative and zero quants
    const nonZeroLqua = lquaRows.filter((q) => this._parseSapQty(q.GESME) > 0);

    // If rackPrefix / storage type were not supplied, the first rack quant of the material scopes the grid
    if ((!rackPrefix || !storageType) && nonZeroLqua.length > 0) {
      const rackQuant = nonZeroLqua.find((q) => parseRackBinName(q.LGPLA).IsRackBin);
      if (rackQuant) {
        const p = parseRackBinName(rackQuant.LGPLA);
        rackPrefix = rackPrefix || `${p.Floor}-${p.Rack}`;
        storageType = storageType || rackQuant.LGTYP;
      }
    }

    // 3. Enumerate maintained bins from LAGP as the bin universe; an unscoped grid (no storage type, no
    //    rack) would page the whole warehouse, so it is not enumerated and only quant-based rows are returned.
    const lagpRows = (storageType || rackPrefix)
      ? await this._readLagpPaged(warehouse, storageType, rackPrefix, pageSize)
      : [];

    // 4. Section descriptions from T302T
    const sectionNameMap = new Map();
    try {
      const sectionRows = await this.rfc.readTable(
        'T302T',
        ['LGNUM', 'LGTYP', 'LGBER', 'SPRAS', 'LBERT'],
        [`LGNUM = '${warehouse}'`, ...(storageType ? [`AND LGTYP = '${storageType}'`] : []), "AND SPRAS = 'E'"],
        100
      );
      for (const row of sectionRows) {
        sectionNameMap.set(`${row.LGNUM}|${row.LGTYP}|${row.LGBER}`, row.LBERT || '');
      }
    } catch (e) {
      LOG.warn('Could not read T302T section descriptions:', e.message);
    }

    // Storage type descriptions from T301T
    const t301tMap = new Map();
    try {
      const t301tRows = await this.rfc.readTable('T301T', ['LGNUM', 'LGTYP', 'LTYPT'], [`SPRAS = 'E'`], 200);
      for (const t of t301tRows) t301tMap.set(`${t.LGNUM}|${t.LGTYP}`, t.LTYPT);
    } catch (e) {
      LOG.warn('Could not read T301T:', e.message);
    }

    // Also read secondary non-rack stock from LQUA if material is present
    let secondaryLqua = [];
    if (material && plant && sloc) {
      const s4Mat = this._pad(material, 18);
      try {
        const allMatLqua = await this.rfc.readTable(
          'LQUA',
          ['LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'LENUM', 'CHARG', 'GESME', 'MEINS', 'LETYP', 'KZHUQ', 'MATNR'],
          [`LGNUM = '${warehouse}'`, `AND MATNR = '${s4Mat}'`, `AND WERKS = '${plant}'`, `AND LGORT = '${sloc}'`],
          500
        );
        secondaryLqua = allMatLqua.filter((q) => this._parseSapQty(q.GESME) > 0);
      } catch (e) {
        LOG.warn('Could not read secondary LQUA:', e.message);
      }
    }

    // Map LQUA by LGNUM|LGTYP|LGPLA
    const lquaMap = new Map();
    for (const q of nonZeroLqua) {
      const key = `${q.LGNUM}|${q.LGTYP}|${q.LGPLA}`;
      if (!lquaMap.has(key)) {
        lquaMap.set(key, []);
      }
      lquaMap.get(key).push(q);
    }

    // Distinct section codes to assign color slots
    const distinctSections = [...new Set(lagpRows.map((r) => r.LGBER).filter(Boolean))].sort();

    const cells = [];
    const nonRackBins = [];

    // Process LAGP bins (the bin universe)
    for (const lagp of lagpRows) {
      const rackParts = parseRackBinName(lagp.LGPLA);
      const sectionCode = lagp.LGBER || '';
      const sectionName = sectionCode
        ? sectionNameMap.get(`${lagp.LGNUM}|${lagp.LGTYP}|${sectionCode}`) || ''
        : '';
      const secIdx = distinctSections.indexOf(sectionCode);
      const colorSlot = secIdx < 0 ? 0 : (secIdx % 24) + 1;

      const quants = lquaMap.get(`${lagp.LGNUM}|${lagp.LGTYP}|${lagp.LGPLA}`) || [];
      const isOccupied = quants.length > 0;
      const primaryQuant = quants[0] || null;

      if (rackParts.IsRackBin) {
        cells.push({
          StorageBin: lagp.LGPLA,
          Floor: rackParts.Floor,
          Rack: rackParts.Rack,
          Position: rackParts.Position,
          IsRackBin: true,
          Status: isOccupied ? 'occupied' : 'empty',
          Occupied: isOccupied,
          StorageType: lagp.LGTYP,
          StorageSection: sectionCode,
          StorageSectionDesc: sectionName,
          SectionCode: sectionCode,
          SectionName: sectionName,
          SectionColorSlot: colorSlot,
          BinType: lagp.LPTYP || '',
          UnitNumber: primaryQuant ? (this._unpad(primaryQuant.LENUM) || primaryQuant.LGPLA) : '',
          UnitCategory: primaryQuant ? (primaryQuant.KZHUQ === 'X' ? 'HU' : (primaryQuant.LENUM ? 'SU' : 'BIN')) : '',
          Material: primaryQuant ? this._unpad(primaryQuant.MATNR) : '',
          Batch: primaryQuant ? (primaryQuant.CHARG || '') : '',
          AvailableStock: primaryQuant ? this._parseSapQty(primaryQuant.GESME) : 0,
          BaseUnit: primaryQuant ? (primaryQuant.MEINS || '') : '',
          HandlingUnitId: primaryQuant ? (primaryQuant.LENUM || '') : ''
        });
      } else {
        // Non-rack bin from LAGP
        nonRackBins.push({
          StorageBin: lagp.LGPLA,
          StorageType: lagp.LGTYP,
          StorageTypeDesc: t301tMap.get(`${lagp.LGNUM}|${lagp.LGTYP}`) || '',
          StorageSection: sectionCode,
          StorageSectionDesc: sectionName,
          SectionCode: sectionCode,
          SectionName: sectionName,
          UnitNumber: primaryQuant ? (this._unpad(primaryQuant.LENUM) || primaryQuant.LGPLA) : '',
          UnitCategory: primaryQuant ? (primaryQuant.KZHUQ === 'X' ? 'HU' : (primaryQuant.LENUM ? 'SU' : 'BIN')) : '',
          Material: primaryQuant ? this._unpad(primaryQuant.MATNR) : '',
          Batch: primaryQuant ? (primaryQuant.CHARG || '') : '',
          AvailableStock: primaryQuant ? this._parseSapQty(primaryQuant.GESME) : 0,
          BaseUnit: primaryQuant ? (primaryQuant.MEINS || '') : '',
          IsRackBin: false
        });
      }
    }

    // Sort cells by Position in ascending numeric order
    cells.sort((a, b) => a.Position.localeCompare(b.Position, undefined, { numeric: true }));

    // Also include any non-rack stock from LQUA that wasn't in lagpRows (e.g. 921/TRANSFER)
    const existingNonRack = new Set(nonRackBins.map((b) => `${b.StorageType}|${b.StorageBin}`));
    for (const q of [...nonZeroLqua, ...secondaryLqua]) {
      const parts = parseRackBinName(q.LGPLA);
      if (!parts.IsRackBin && !existingNonRack.has(`${q.LGTYP}|${q.LGPLA}`)) {
        existingNonRack.add(`${q.LGTYP}|${q.LGPLA}`);
        nonRackBins.push({
          StorageBin: q.LGPLA,
          StorageType: q.LGTYP,
          StorageTypeDesc: t301tMap.get(`${q.LGNUM}|${q.LGTYP}`) || '',
          StorageSection: '',
          StorageSectionDesc: '',
          SectionCode: '',
          SectionName: '',
          UnitNumber: this._unpad(q.LENUM) || q.LGPLA,
          UnitCategory: q.KZHUQ === 'X' ? 'HU' : (q.LENUM ? 'SU' : 'BIN'),
          Material: this._unpad(q.MATNR),
          Batch: q.CHARG || '',
          AvailableStock: this._parseSapQty(q.GESME),
          BaseUnit: q.MEINS || '',
          IsRackBin: false
        });
      }
    }

    return {
      Warehouse: warehouse,
      StorageType: storageType,
      RackPrefix: rackPrefix || '',
      Plant: plant,
      StorageLocation: sloc,
      IsHuManaged: isHuManaged,
      Xhupf: xhupf,
      Cells: cells,
      NonRackBins: nonRackBins
    };
  }

  /**
   * Dual Posting Engine: Executes Stock Transfer (Movement 311).
   *
   * Preserves the two verified ABAP paths:
   * - Check T001L-XHUPF:
   *     * If 'X' (HU-Managed): Path A -> HU_CREATE_GOODS_MOVEMENT (Event 0006) + RESB updates.
   *     * If '' (Non-HUM / SU): Path B -> BAPI_GOODSMVT_CREATE (GM_CODE 06) + BAPI_TRANSACTION_COMMIT.
   */
  async executeHuStockTransfer(payload = {}) {
    const {
      ReservationNo,
      ReservationItem,
      UnitNumber,
      TransferQty,
      _IsFullUnit = true,
      ClientAttemptId
    } = payload;

    if (!ReservationNo) throw httpError(400, 'Reservation number is required');
    if (!UnitNumber) throw httpError(400, 'Unit number (HU or SU) is required');
    const transferQtyNum = parseFloat(TransferQty || 0);
    if (transferQtyNum <= 0) throw httpError(400, 'Transfer quantity must be greater than 0');

    // 1. Idempotency Check
    const attemptKey = ClientAttemptId || `${ReservationNo}-${ReservationItem}-${UnitNumber}-${transferQtyNum}`;
    if (this._attemptCache.has(attemptKey)) {
      LOG.info(`Idempotent hit for attempt key ${attemptKey}; returning cached result.`);
      return this._attemptCache.get(attemptKey);
    }

    // 2. Authoritative Unit Re-Validation
    const v = await this.validateUnit(ReservationNo, ReservationItem, UnitNumber);
    if (!v.Valid) {
      throw httpError(422, v.StatusMessage);
    }

    const cockpit = await this.getCockpitDetail(ReservationNo, ReservationItem);
    if (transferQtyNum > v.AvailableQuantity) {
      throw httpError(422, `Transfer quantity (${transferQtyNum}) exceeds available unit stock (${v.AvailableQuantity}).`);
    }
    if (transferQtyNum > cockpit.OpenQty) {
      throw httpError(422, `Transfer quantity (${transferQtyNum}) exceeds open reservation balance (${cockpit.OpenQty}).`);
    }

    const sourceSLoc = v.StorageLocation || cockpit.StorageLocation;
    const destSLoc = cockpit.ReceivingStorageLocation;
    if (!destSLoc) {
      throw httpError(400, `Reservation ${ReservationNo} has no receiving storage location (UMLGO) defined.`);
    }

    // 3. Inspect T001L for Source Storage Location HUM Flag (XHUPF)
    let isHuManaged = false;
    try {
      const t001lRows = await this.rfc.readTable(
        'T001L',
        ['WERKS', 'LGORT', 'XHUPF'],
        [`WERKS = '${cockpit.Plant}'`, `AND LGORT = '${sourceSLoc}'`],
        1
      );
      if (t001lRows.length && t001lRows[0].XHUPF === 'X') {
        isHuManaged = true;
      }
    } catch (e) {
      LOG.warn('Could not read T001L XHUPF; defaulting to standard BAPI path:', e.message);
    }

    const s4Rsnum = this._pad(ReservationNo, 10);
    const s4Rspos = this._pad(ReservationItem || '1', 4);
    const s4Matnr = this._pad(cockpit.Material, 18);
    const s4UnitAlpha = this._pad(UnitNumber, 20);

    let matDoc = '';
    let matDocYear = String(new Date().getFullYear());
    let postingPath = '';

    if (isHuManaged) {
      // ─────────────────────────────────────────────────────────────
      // PATH A: HU-Managed Storage Location (HU_CREATE_GOODS_MOVEMENT, Event 0006, IF_COMMIT X)
      // An HU-managed source is posted only through the HUM function. BAPI_GOODSMVT_CREATE carries no
      // handling-unit data, and posting it on an HU-managed storage location is not a verified capability,
      // so a missing HUM document fails closed instead of falling back (the ABAP program's fallback runs
      // inside SAP and has never been proven for this case).
      // ─────────────────────────────────────────────────────────────
      postingPath = 'HU_MANAGED_0006';
      if (!v.UnitType.includes('HU')) {
        throw httpError(422, `Storage location ${sourceSLoc} is HU-managed (T001L-XHUPF = X); only a handling unit can be transferred from it, not ${v.UnitType}.`);
      }
      LOG.info(`Executing HUM goods movement for HU ${UnitNumber} from ${sourceSLoc} to ${destSLoc}`);

      let humRes;
      try {
        humRes = await this.rfc.call('HU_CREATE_GOODS_MOVEMENT', {
          IF_EVENT: '0006',
          IF_COMMIT: 'X',
          IT_EXTERNAL_ID: [s4UnitAlpha],
          IT_MOVE_TO: [{
            HUWBEVENT: '0006',
            WERKS: cockpit.Plant,
            LGORT: destSLoc,
            BWART: HU_STOCK_TRANSFER_MOVEMENT_TYPE
          }]
        });
      } catch (humErr) {
        // FU_NOT_FOUND: SAP could not invoke the function, so nothing was posted (fail closed, not unconfirmed).
        // Any other RFC failure after IF_COMMIT = 'X' may already have posted: report it as unconfirmed.
        if (/FU_NOT_FOUND/i.test(`${humErr.key || ''} ${humErr.message || ''}`)) {
          throw httpError(501, `HU_CREATE_GOODS_MOVEMENT is not callable via RFC on this system (FU_NOT_FOUND); the HU-managed storage location ${sourceSLoc} cannot be posted by this service. Nothing was posted. Run tools/check-hu-fm-rfc.js (READ-ONLY) to record the function's RFC status.`);
        }
        throw this._unconfirmedError(`HU_CREATE_GOODS_MOVEMENT failed after the call was sent: ${humErr.message}`);
      }

      if (humRes && humRes.ES_EMKPF && humRes.ES_EMKPF.MBLNR) {
        matDoc = humRes.ES_EMKPF.MBLNR;
        matDocYear = humRes.ES_EMKPF.MJAHR || matDocYear;
      } else {
        const msgs = [humRes?.ES_MESSAGE, ...(humRes?.ET_MESSAGES || [])]
          .filter((m) => m && /[EA]/.test(String(m.MSGTY || '')))
          .map((m) => `${m.MSGID || ''}-${m.MSGNO || ''} ${[m.MSGV1, m.MSGV2, m.MSGV3, m.MSGV4].filter(Boolean).join(' ')}`.trim());
        throw httpError(422, `SAP did not post the HU movement for ${UnitNumber}: ${msgs.length ? msgs.join('; ') : 'HU_CREATE_GOODS_MOVEMENT returned no material document'}. Nothing was posted.`);
      }
    } else {
      // ─────────────────────────────────────────────────────────────
      // PATH B: Non-HU-Managed Storage Location / Storage Unit (BAPI_GOODSMVT_CREATE)
      // ─────────────────────────────────────────────────────────────
      postingPath = 'STANDARD_BAPI_06';
    }

    if (!matDoc) {
      LOG.info(`Posting via BAPI_GOODSMVT_CREATE (GM_CODE 06) for reservation ${ReservationNo} item ${ReservationItem}`);

      const headerText = `ST:${this._unpad(ReservationNo)} ${UnitNumber}`.slice(0, 25);
      const isComplete = transferQtyNum >= cockpit.OpenQty;

      const gmHeader = {
        PSTNG_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        DOC_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        HEADER_TXT: headerText
      };

      const gmCode = { GM_CODE: '06' };

      const gmItem = {
        MATERIAL: s4Matnr,
        PLANT: cockpit.Plant,
        STGE_LOC: sourceSLoc,
        BATCH: v.Batch || cockpit.Batch || '',
        MOVE_TYPE: HU_STOCK_TRANSFER_MOVEMENT_TYPE,
        ENTRY_QNT: transferQtyNum,
        ENTRY_UOM: cockpit.BaseUnit,
        MOVE_PLANT: cockpit.Plant,
        MOVE_STLOC: destSLoc,
        MOVE_BATCH: v.Batch || cockpit.Batch || '',
        RESERV_NO: s4Rsnum,
        RES_ITEM: s4Rspos,
        NO_MORE_GR: isComplete ? 'X' : ''
      };

      try {
        // BAPI and COMMIT must share one connection (one LUW); rfc.call() opens a new connection per call.
        const headret = await this.rfc.session(async (call) => {
          const bapiRes = await call('BAPI_GOODSMVT_CREATE', {
            GOODSMVT_HEADER: gmHeader,
            GOODSMVT_CODE: gmCode,
            GOODSMVT_ITEM: [gmItem]
          });
          const ret = bapiRes?.GOODSMVT_HEADRET || {};
          if (ret.MAT_DOC) {
            await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
            return ret;
          }
          await call('BAPI_TRANSACTION_ROLLBACK', {});
          const messages = bapiRes?.RETURN || [];
          const errMsgs = messages.filter((r) => r.TYPE === 'E' || r.TYPE === 'A').map((r) => `[${r.ID}-${r.NUMBER}] ${r.MESSAGE}`).join('; ');
          throw httpError(422, `SAP rejected stock transfer: ${errMsgs || 'Material Document not generated'}`);
        });
        matDoc = headret.MAT_DOC;
        matDocYear = headret.DOC_YEAR || matDocYear;
      } catch (bapiErr) {
        if (bapiErr.status) throw bapiErr;
        throw this._unconfirmedError(`SAP BAPI communication error: ${bapiErr.message}`);
      }
    }

    await this._readBackMaterialDocument(matDoc, matDocYear);

    const updatedOpenQty = Math.max(0, cockpit.OpenQty - transferQtyNum);
    const isFinal = updatedOpenQty === 0;

    const result = {
      Success: true,
      ReservationNo: this._unpad(ReservationNo),
      ReservationItem: this._unpad(ReservationItem),
      MaterialDocument: matDoc,
      MaterialDocYear: matDocYear,
      PostingPath: postingPath,
      TransferredQty: transferQtyNum,
      BaseUnit: cockpit.BaseUnit,
      UnitNumber: UnitNumber,
      UpdatedOpenQty: updatedOpenQty,
      UpdatedStatus: isFinal ? 'Completed' : 'Partially Open',
      IsFinalIssue: isFinal,
      ReadBackVerified: true,
      RequesterAlertSent: false, // no notification is sent by this service
      Message: `Stock transfer posted and read back from SAP. Material Document: ${matDoc} / ${matDocYear}.`
    };

    // Store in idempotency cache
    this._attemptCache.set(attemptKey, result);

    return result;
  }

  /** Error for a write whose SAP outcome is unknown; the handler records it as 'unconfirmed', not 'rejected'. */
  _unconfirmedError(detail, matDoc = '', matDocYear = '') {
    const err = httpError(502, `Stock transfer outcome is unconfirmed in SAP (${detail}). Do not post again; check the material document list first.`);
    err.sapWriteAttempted = true;
    if (matDoc) {
      err.materialDocument = matDoc;
      err.materialDocYear = matDocYear;
    }
    return err;
  }

  /** Reads the posted document back from MATDOC (MSEG fallback) and requires every row to be a 311. */
  async _readBackMaterialDocument(matDoc, matDocYear) {
    const where = [`MBLNR = '${this._pad(matDoc, 10)}'`, `AND MJAHR = '${matDocYear}'`];
    let rows = [];
    let readError = '';
    for (const table of ['MATDOC', 'MSEG']) {
      try {
        rows = await this.rfc.readTable(table, ['MBLNR', 'MJAHR', 'BWART'], where, 10);
      } catch (e) {
        readError = e.message;
        rows = [];
      }
      if (rows.length) break;
    }
    if (!rows.length) {
      throw this._unconfirmedError(`material document ${matDoc}/${matDocYear} was returned by SAP but could not be read back from MATDOC/MSEG${readError ? `: ${readError}` : ''}`, matDoc, matDocYear);
    }
    const wrong = rows.filter((r) => String(r.BWART || '').trim() !== HU_STOCK_TRANSFER_MOVEMENT_TYPE);
    if (wrong.length) {
      throw this._unconfirmedError(`material document ${matDoc}/${matDocYear} carries movement type ${wrong.map((r) => r.BWART || '(blank)').join(', ')} instead of ${HU_STOCK_TRANSFER_MOVEMENT_TYPE}`, matDoc, matDocYear);
    }
  }

  /**
   * Classifies transfer path: 'A' (shipping-managed), 'B' (HUM non-shipping), or 'standard'.
   */
  classifyTransferPath(t001lRow) {
    return classifyTransferPath(t001lRow);
  }

  /**
   * Pre-checks Path A delivery completion flow for blockers.
   */
  async precheckPathA(reservation, item, hu, context = {}) {
    return precheckPathA(reservation, item, hu, { rfc: this.rfc, ...context });
  }

  /**
   * Resolves storage type rules dynamically via BusinessConfigResolver (fail closed, no literals).
   */
  async getStorageTypeRules(context = {}) {
    if (this._injectedStorageTypeRules && !context.refreshRules) {
      return this._injectedStorageTypeRules;
    }
    const plant = context.plant || context.WERKS || '';
    const warehouse = context.warehouse || context.LGNUM || '';
    if (!warehouse) throw httpError(400, 'Warehouse number is required to resolve storage type rules.');
    const cacheKey = `${plant}|${warehouse}`;
    if (!context.refreshRules && this._storageTypeRules.has(cacheKey)) {
      return this._storageTypeRules.get(cacheKey);
    }
    const resolver = this.businessConfigResolver || businessConfigResolver;
    const rules = await resolveHuStorageTypeRules({ isTrusted: true, ...context, plant, warehouse }, resolver);
    this._storageTypeRules.set(cacheKey, rules);
    return rules;
  }

  /**
   * Evaluates if a storage location is shipping-managed using shared pure-T001L rule.
   */
  isShippingManaged(t001lRow) {
    return isShippingManaged(t001lRow);
  }

  /**
   * Assigns an available HU to competing reservations by prioritization rule (default: earliest BDTER, then RSNUM).
   */
  assignHuToCompetingReservations(hu, reservations, comparator) {
    return assignHuToCompetingReservations(hu, reservations, comparator);
  }

  /**
   * Ranks competing reservations by priority.
   */
  rankCompetingReservations(reservations, comparator) {
    return rankCompetingReservations(reservations, comparator);
  }
}

HuStockTransferAdapter.classifyTransferPath = classifyTransferPath;
HuStockTransferAdapter.isShippingManaged = isShippingManaged;
HuStockTransferAdapter.precheckPathA = precheckPathA;
HuStockTransferAdapter.assignHuToCompetingReservations = assignHuToCompetingReservations;
HuStockTransferAdapter.rankCompetingReservations = rankCompetingReservations;
HuStockTransferAdapter.resolveHuStorageTypeRules = resolveHuStorageTypeRules;

module.exports = HuStockTransferAdapter;
