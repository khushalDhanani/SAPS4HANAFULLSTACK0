const LOG = require('../../logger')('goods-issue-staging');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

function clean(v) {
  return String(v || '').trim();
}

function wmAlphaIn(v) {
  const s = clean(v);
  return /^\d+$/.test(s) ? s.padStart(18, '0') : s;
}

function wmNum(v) {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  if (s.endsWith('-')) return -parseFloat(s.slice(0, -1)) || 0;
  return parseFloat(s) || 0;
}

class GoodsIssuePhase6StagingClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.rfc = options.rfc || (options.adapter && options.adapter.rfc) || null;
  }

  /**
   * Resolve target staging bin and storage type for a material / plant / sloc / warehouse.
   */
  async findStagingTarget(material, plant, sloc, warehouse = '') {
    const sMat = clean(material);
    const sPlant = clean(plant);
    const sSloc = clean(sloc);
    let sLgnum = clean(warehouse);

    if (!sLgnum && this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const t320 = await this.rfc.readTable('T320', ['LGNUM'], [`WERKS = '${sPlant}'`, `AND LGORT = '${sSloc}'`], 1);
        if (t320 && t320[0] && t320[0].LGNUM) {
          sLgnum = clean(t320[0].LGNUM);
        }
      } catch (err) {
        LOG.warn(`T320 lookup failed in findStagingTarget: ${err.message || err}`);
      }
    }

    // 1. Control Cycle (PKHD)
    if (this.rfc && typeof this.rfc.readTable === 'function' && sMat) {
      try {
        const matnrIn = wmAlphaIn(sMat);
        const where = [`WERKS = '${sPlant}'`];
        if (sLgnum) where.push(`AND LGNUM = '${sLgnum}'`);
        where.push(`AND ( MATNR = '${matnrIn}' OR MATNR = '${sMat}' OR MATNR = '' )`);

        const pkhdRows = await this.rfc.readTable('PKHD', ['PRVBE', 'WERKS', 'LGNUM', 'LGTYP', 'LGPLA'], where, 10);
        if (Array.isArray(pkhdRows) && pkhdRows.length > 0) {
          const match = pkhdRows.find((r) => r.LGTYP && r.LGPLA) || pkhdRows[0];
          if (match && (match.LGTYP || match.LGPLA)) {
            return {
              targetType: clean(match.LGTYP) || '100',
              targetBin: clean(match.LGPLA) || 'STAGE-BIN',
              stagingSource: 'PKHD_CONTROL_CYCLE',
              psa: clean(match.PRVBE),
              warehouse: clean(match.LGNUM) || sLgnum
            };
          }
        }
      } catch (err) {
        LOG.warn(`PKHD lookup failed in findStagingTarget: ${err.message || err}`);
      }
    }

    // 2. MLGN (Material Data for Warehouse)
    if (this.rfc && typeof this.rfc.readTable === 'function' && sMat && sLgnum) {
      try {
        const matnrIn = wmAlphaIn(sMat);
        const mlgnRows = await this.rfc.readTable('MLGN', ['LGNUM', 'LVSMS', 'LGBKZ'], [`MATNR = '${matnrIn}'`, `AND LGNUM = '${sLgnum}'`], 1);
        if (mlgnRows && mlgnRows[0]) {
          const lvsms = clean(mlgnRows[0].LVSMS);
          if (lvsms) {
            return {
              targetType: '100',
              targetBin: `STAGE-${lvsms}`,
              stagingSource: 'MLGN_STAGING_INDICATOR',
              warehouse: sLgnum
            };
          }
        }
      } catch (err) {
        LOG.warn(`MLGN lookup failed: ${err.message || err}`);
      }
    }

    // 3. Fallback based on warehouse config
    if (sLgnum) {
      return {
        targetType: '100',
        targetBin: 'STAGE-BIN',
        stagingSource: 'DEFAULT_STAGING_CONFIG',
        warehouse: sLgnum
      };
    }

    return {
      targetType: '',
      targetBin: '',
      stagingSource: 'NONE',
      warehouse: ''
    };
  }

  /**
   * Find transfer requirement (TBNUM) associated with a reservation or reservation item.
   */
  async findTransferRequirement(resNo, item = '', matnr = '', plant = '', lgnum = '') {
    if (!this.rfc || typeof this.rfc.readTable !== 'function') return '';
    const sRes = clean(resNo);
    if (!sRes) return '';
    const resPadded = sRes.padStart(10, '0');

    try {
      const where = [`RSNUM = '${resPadded}'`];
      if (clean(item)) {
        where.push(`AND RSPOS = '${clean(item).padStart(4, '0')}'`);
      }
      const tbpeRows = await this.rfc.readTable('TBPE', ['TBNUM', 'TBPOS', 'RSNUM', 'RSPOS'], where, 5);
      if (tbpeRows && tbpeRows.length > 0 && tbpeRows[0].TBNUM) {
        return clean(tbpeRows[0].TBNUM);
      }
    } catch (e) {
      LOG.warn(`TBPE lookup failed for reservation ${sRes}: ${e.message || e}`);
    }

    try {
      const where = [`RSNUM = '${resPadded}'`];
      const tbpkRows = await this.rfc.readTable('TBPK', ['TBNUM', 'LGNUM', 'RSNUM', 'STATUS'], where, 5);
      if (tbpkRows && tbpkRows.length > 0 && tbpkRows[0].TBNUM) {
        return clean(tbpkRows[0].TBNUM);
      }
    } catch (e) {
      LOG.warn(`TBPK lookup failed for reservation ${sRes}: ${e.message || e}`);
    }

    return '';
  }

  /**
   * Check staging completeness for a component.
   * Requirement 5: If staged qty < required: block Complete, and return 400 before calling SAP with:
   * "Only X of Y UOM staged in <type>/<bin>. Transfer requirement <TBNUM> needs a confirmed transfer order (LT04/LT12) first."
   * Show planned-but-unconfirmed quantity (EINME) separately as "TO created, not confirmed".
   */
  async checkStaging({
    material,
    plant,
    sloc,
    warehouse = '',
    targetType = '',
    targetBin = '',
    requiredQty = 0,
    uom = 'PC',
    tbnum = '',
    resNo = '',
    resItem = ''
  }) {
    const sMat = clean(material);
    const sPlant = clean(plant);
    const sSloc = clean(sloc);
    const reqQty = Number(requiredQty) || 0;

    let sType = clean(targetType);
    let sBin = clean(targetBin);
    let sLgnum = clean(warehouse);
    let sTbnum = clean(tbnum);

    if (!sType || !sBin) {
      const target = await this.findStagingTarget(sMat, sPlant, sSloc, sLgnum);
      sType = target.targetType;
      sBin = target.targetBin;
      if (!sLgnum && target.warehouse) sLgnum = target.warehouse;
    }

    if (!sType || !sBin) {
      return {
        isStaged: true,
        isStagingRequired: false,
        stagedQty: reqQty,
        requiredQty: reqQty,
        plannedUnconfirmedQty: 0
      };
    }

    if (!sTbnum && resNo) {
      sTbnum = await this.findTransferRequirement(resNo, resItem, sMat, sPlant, sLgnum);
    }

    let stagedQty = 0;
    let plannedUnconfirmedQty = 0;

    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const matnrIn = wmAlphaIn(sMat);
        const where = [
          `LGTYP = '${sType}'`,
          `AND LGPLA = '${sBin}'`,
          `AND ( MATNR = '${matnrIn}' OR MATNR = '${sMat}' )`
        ];
        if (sPlant) where.push(`AND WERKS = '${sPlant}'`);
        if (sLgnum) where.push(`AND LGNUM = '${sLgnum}'`);

        const lquaRows = await this.rfc.readTable('LQUA', ['LGNUM', 'LGTYP', 'LGPLA', 'VERME', 'EINME', 'MEINS'], where, 50);
        if (Array.isArray(lquaRows)) {
          for (const row of lquaRows) {
            stagedQty += wmNum(row.VERME);
            plannedUnconfirmedQty += wmNum(row.EINME);
          }
        }
      } catch (err) {
        LOG.warn(`LQUA staging check failed: ${err.message || err}`);
      }
    }

    stagedQty = Math.round(stagedQty * 1000) / 1000;
    plannedUnconfirmedQty = Math.round(plannedUnconfirmedQty * 1000) / 1000;

    const isFullyStaged = stagedQty >= reqQty;
    const isStaged = isFullyStaged;

    let error = '';
    if (!isFullyStaged) {
      const binLocation = sType ? `${sType}/${sBin}` : sBin;
      error = `Only ${stagedQty} of ${reqQty} ${uom} staged in ${binLocation}.`;
      if (plannedUnconfirmedQty > 0) {
        error += ` (${plannedUnconfirmedQty} ${uom} TO created, not confirmed).`;
      }
      error += ` Transfer requirement ${sTbnum || 'N/A'} needs a confirmed transfer order (LT04/LT12) first.`;
    }

    return {
      isStaged,
      isFullyStaged,
      isStagingRequired: true,
      stagedQty,
      requiredQty: reqQty,
      plannedUnconfirmedQty,
      targetType: sType,
      targetBin: sBin,
      warehouse: sLgnum,
      tbnum: sTbnum,
      uom,
      error: error || undefined
    };
  }

  /**
   * Check staging for a specific reservation item end-to-end.
   */
  async getStagingForReservation(reservationNo, reservationItem) {
    const sResv = clean(reservationNo);
    const sItem = clean(reservationItem);
    if (!sResv || !sItem) return { isStaged: true, isStagingRequired: false };

    let itemData = null;

    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const resvPadded = sResv.padStart(10, '0');
        const itemPadded = sItem.padStart(4, '0');
        const where = [`RSNUM = '${resvPadded}'`, `AND RSPOS = '${itemPadded}'`, `AND XLOEK = ''`, `AND KZEAR = ''`];
        const resbRows = await this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'AUFNR', 'LGTYP', 'PRVBE'], where, 1);
        if (resbRows && resbRows[0]) {
          itemData = {
            Material: clean(resbRows[0].MATNR),
            Plant: clean(resbRows[0].WERKS),
            StorageLocation: clean(resbRows[0].LGORT),
            RequiredQty: wmNum(resbRows[0].BDMNG),
            WithdrawnQty: wmNum(resbRows[0].ENMNG),
            BaseUnit: clean(resbRows[0].MEINS) || 'PC',
            TargetType: clean(resbRows[0].LGTYP),
            Psa: clean(resbRows[0].PRVBE)
          };
        }
      } catch (err) {
        LOG.warn(`RESB read failed in getStagingForReservation: ${err.message || err}`);
      }
    }

    if (!itemData && this.adapter && typeof this.adapter._get === 'function') {
      try {
        const filter = `Reservation eq '${sResv}' and ReservationItem eq '${sItem.padStart(4, '0')}'`;
        const res = await this.adapter._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`);
        if (Array.isArray(res) && res[0]) {
          const r = res[0];
          itemData = {
            Material: clean(r.Product || r.Material),
            Plant: clean(r.Plant),
            StorageLocation: clean(r.StorageLocation),
            RequiredQty: parseFloat(r.ResvnItmRequiredQtyInBaseUnit) || 0,
            WithdrawnQty: parseFloat(r.ResvnItmWithdrawnQtyInBaseUnit) || 0,
            BaseUnit: clean(r.BaseUnit) || 'PC'
          };
        }
      } catch (err) {
        LOG.warn(`ReservationDocumentItem read failed in getStagingForReservation: ${err.message || err}`);
      }
    }

    if (!itemData) {
      return { isStaged: true, isStagingRequired: false };
    }

    const netOpen = Math.max(0, itemData.RequiredQty - itemData.WithdrawnQty);
    return this.checkStaging({
      material: itemData.Material,
      plant: itemData.Plant,
      sloc: itemData.StorageLocation,
      targetType: itemData.TargetType || '',
      requiredQty: netOpen,
      uom: itemData.BaseUnit,
      resNo: sResv,
      resItem: sItem
    });
  }
}

module.exports = GoodsIssuePhase6StagingClient;
