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

function stagingError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

class GoodsIssuePhase6StagingClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.rfc = options.rfc || (options.adapter && options.adapter.rfc) || null;
  }

  /**
   * Resolve target staging bin and storage type for a material / plant / sloc / warehouse.
   */
  async findStagingTarget(material, plant, sloc, warehouse = '', psa = '', _orderNo = '', targetType = '') {
    const sMat = clean(material);
    const sPlant = clean(plant);
    const sSloc = clean(sloc);
    let sLgnum = clean(warehouse);

    if (!this.rfc || typeof this.rfc.readTable !== 'function') {
      throw stagingError('SAP RFC table access is unavailable; the WM staging target cannot be verified.');
    }
    if (!sLgnum) {
      let t320;
      try {
        t320 = await this.rfc.readTable(
          'T320', ['WERKS', 'LGORT', 'LGNUM'],
          [`WERKS = '${sPlant}'`, `AND LGORT = '${sSloc}'`], 2
        );
      } catch (err) {
        return { isWm: false, targetType: '', targetBin: '', stagingSource: 'T320_READ_FAILED', warehouse: '', status: 'UNKNOWN', error: `Cannot verify staging: SAP T320 read failed: ${err.message || err}` };
      }
      if (t320.length > 1) throw stagingError(`SAP returned ambiguous WM warehouse mappings for ${sPlant}/${sSloc}.`);
      sLgnum = clean(t320[0]?.LGNUM);
    }
    if (!sLgnum) {
      return { isWm: false, targetType: '', targetBin: '', stagingSource: 'T320_NO_WM_MAPPING', warehouse: '', status: 'NOT_WM_MANAGED' };
    }

    const matnrIn = wmAlphaIn(sMat);
    const where = [`WERKS = '${sPlant}'`, `AND LGNUM = '${sLgnum}'`];
    if (psa) where.push(`AND PRVBE = '${psa}'`);
    let pkhdRows = sMat
      ? await this.rfc.readTable(
        'PKHD', ['MATNR', 'PRVBE', 'WERKS', 'LGNUM', 'LGTYP', 'LGPLA', 'BERKZ', 'NKDYN'],
        [...where, `AND MATNR = '${matnrIn}'`], 100
      )
      : [];
    if (!pkhdRows.length) {
      pkhdRows = await this.rfc.readTable(
      'PKHD', ['MATNR', 'PRVBE', 'WERKS', 'LGNUM', 'LGTYP', 'LGPLA', 'BERKZ', 'NKDYN'],
        [...where, "AND MATNR = ''"], 100
      );
    }
    const plantRows = pkhdRows.filter((row) =>
      clean(row.WERKS) === sPlant &&
      clean(row.LGNUM) === sLgnum &&
      (!psa || clean(row.PRVBE) === psa)
    );
    const materialRows = plantRows.filter((row) => clean(row.MATNR) === matnrIn);
    const specificRows = materialRows.length ? materialRows : plantRows.filter((row) => !clean(row.MATNR));
    const candidates = targetType && specificRows.some((row) => clean(row.LGTYP) === clean(targetType))
      ? specificRows.filter((row) => clean(row.LGTYP) === clean(targetType))
      : specificRows;
    const dynamicRows = candidates.filter((row) =>
      clean(row.LGTYP) && !clean(row.LGPLA) && clean(row.NKDYN).toUpperCase() === 'X'
    );
    const targets = candidates.map((row) => {
      const configuredType = clean(row.LGTYP);
      const configuredBin = clean(row.LGPLA);
      if (configuredType && configuredBin) {
        return { targetType: configuredType, targetBin: configuredBin, stagingSource: 'PKHD_CONTROL_CYCLE', psa: clean(row.PRVBE) };
      }
      return null;
    }).filter(Boolean);

    const uniqueTargets = [...new Map(targets.map((target) =>
      [`${target.targetType}|${target.targetBin}`, target]
    )).values()];
    if (uniqueTargets.length !== 1) {
      if (uniqueTargets.length === 0 && dynamicRows.length > 0) {
        const dynamicTypes = [...new Set(dynamicRows.map((row) => clean(row.LGTYP)))];
        return {
          isWm: true,
          targetType: dynamicTypes.length === 1 ? dynamicTypes[0] : '',
          targetBin: '',
          status: 'UNKNOWN',
          stagingSource: 'PKHD_DYNAMIC_BIN',
          warehouse: sLgnum,
          error: 'PKHD control cycle has dynamic bin (NKDYN=X) with no configured storage bin.'
        };
      }
      return {
        isWm: true,
        targetType: '',
        targetBin: '',
        stagingSource: 'PKHD_UNRESOLVED',
        warehouse: sLgnum,
        error: uniqueTargets.length
          ? `SAP returned multiple staging targets for material ${sMat} at ${sPlant}/${sSloc}.`
          : `SAP staging type/bin could not be resolved for material ${sMat} at ${sPlant}/${sSloc}${psa ? ` supply area ${psa}` : ''}.`
      };
    }
    return { isWm: true, ...uniqueTargets[0], warehouse: sLgnum };
  }

  /**
   * Find transfer requirement (TBNUM) associated with a reservation or reservation item via LTBK.
   * TBPE/TBPK do not exist in DDIC in this release.
   */
  async findTransferRequirement(resNo, item = '', _material = '', _plant = '', warehouse = '', includeTarget = false) {
    if (!this.rfc || typeof this.rfc.readTable !== 'function') {
      throw stagingError('SAP RFC table access is unavailable; reservation transfer requirement cannot be verified.');
    }
    const sRes = clean(resNo);
    if (!sRes) return includeTarget ? { tbnum: '', status: 'UNKNOWN' } : '';
    const resPadded = sRes.padStart(10, '0');

    let ltbkRows;
    try {
      const where = [`RSNUM = '${resPadded}'`];
      ltbkRows = await this.rfc.readTable(
        'LTBK',
        ['TBNUM', 'RSNUM', 'LGNUM', 'NLTYP', 'NLPLA', 'STATU', 'BWLVS'],
        where,
        20
      );
    } catch (e) {
      LOG.warn(`LTBK lookup failed for reservation ${sRes}: ${e.message || e}`);
      const errCode = e.code || (typeof e.message === 'string' && e.message.match(/ID:\w+\s+Type:\w+\s+Number:\d+/)?.[0]) || 'READ_FAILED';
      const msg = `Cannot verify staging: SAP LTBK read failed (${errCode}).`;
      return includeTarget
        ? { tbnum: '', status: 'UNKNOWN', error: msg, table: 'LTBK', errorCode: errCode }
        : '';
    }

    if (!ltbkRows || ltbkRows.length === 0) {
      return includeTarget
        ? { tbnum: '', status: 'NOT_FOUND', error: `No transfer requirement found for reservation ${sRes}.` }
        : '';
    }

    const validRows = ltbkRows.filter((row) =>
      clean(row.RSNUM) === resPadded &&
      (!clean(warehouse) || clean(row.LGNUM) === clean(warehouse))
    );

    if (validRows.length === 0) {
      return includeTarget
        ? { tbnum: '', status: 'NOT_FOUND', error: `No transfer requirement found in warehouse ${warehouse} for reservation ${sRes}.` }
        : '';
    }

    // Per-item TR resolution: LTBP (TR item) carries RSPOS, so each reservation item can be
    // mapped to ITS transfer requirement instead of merging every TR of the reservation.
    // Live-verified on this release: LTBP is readable only with the narrow field list
    // TBNUM/TBPOS/RSPOS and an LGNUM + TBNUM predicate; wider field lists or a RSNUM
    // predicate return AD 718. On any LTBP read failure we fall back to the previous
    // reservation-level resolution, which fails closed on conflicting destinations.
    let rowsForItem = validRows;
    const sItemPadded = clean(item) ? clean(item).padStart(4, '0') : '';
    if (sItemPadded) {
      const tbnums = [...new Set(validRows.map((row) => clean(row.TBNUM)))];
      const matchingTrs = new Set();
      let ltbpFailed = false;
      for (const tb of tbnums) {
        const lg = clean(validRows.find((row) => clean(row.TBNUM) === tb)?.LGNUM);
        try {
          const ltbpRows = await this.rfc.readTable(
            'LTBP', ['TBNUM', 'TBPOS', 'RSPOS'],
            [`LGNUM = '${lg}'`, `AND TBNUM = '${tb}'`], 100
          );
          if ((ltbpRows || []).some((pos) => clean(pos.RSPOS) === sItemPadded)) {
            matchingTrs.add(tb);
          }
        } catch (e) {
          LOG.warn(`LTBP item mapping failed for TR ${tb} (${e.message || e}); falling back to reservation-level TR resolution.`);
          ltbpFailed = true;
          break;
        }
      }
      if (!ltbpFailed) {
        rowsForItem = validRows.filter((row) => matchingTrs.has(clean(row.TBNUM)));
        if (rowsForItem.length === 0) {
          return includeTarget
            ? { tbnum: '', status: 'NOT_FOUND', error: `No transfer requirement found for reservation ${sRes} item ${sItemPadded}.` }
            : '';
        }
      }
    }

    const tbnum = clean(rowsForItem[0].TBNUM);
    if (!includeTarget) return tbnum;

    const destRows = rowsForItem.filter((row) => clean(row.NLTYP) && clean(row.NLPLA));
    const destinations = [...new Map(destRows.map((row) => [
      `${clean(row.NLTYP)}|${clean(row.NLPLA)}`,
      { targetType: clean(row.NLTYP), targetBin: clean(row.NLPLA), tbnum: clean(row.TBNUM) }
    ])).values()];

    if (destinations.length > 1) {
      const destList = destinations.map((d) => `${d.targetType}/${d.targetBin}`).join(', ');
      return {
        tbnum,
        status: 'UNKNOWN',
        error: `Cannot verify staging: multiple destinations found in transfer requirements (${destList}).`
      };
    }

    if (destinations.length === 1) {
      return {
        tbnum: destinations[0].tbnum || tbnum,
        status: 'FOUND',
        targetType: destinations[0].targetType,
        targetBin: destinations[0].targetBin
      };
    }

    return {
      tbnum,
      status: 'NOT_FOUND',
      error: `Transfer requirement ${tbnum} has no staging destination in LTBK.`
    };
  }

  /**
   * Check staging completeness for a component.
   * Requirement 5: If staged qty < required: block Complete, and return 400 before calling SAP with:
   * "Only X of Y UOM staged in <type>/<bin>. Transfer requirement <TBNUM> needs a confirmed transfer order (LT04/LT12) first."
   * Show planned/in-transfer quantity (EINME) separately from confirmed target-bin stock.
   */
  async checkStaging({
    material,
    plant,
    sloc,
    warehouse = '',
    targetType = '',
    targetBin = '',
    psa = '',
    orderNo = '',
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
    let transferRequirementStatus = sTbnum ? 'FOUND' : 'UNKNOWN';

    if (!sType || !sBin) {
      let target;
      try {
        target = await this.findStagingTarget(sMat, sPlant, sSloc, sLgnum, psa, orderNo, sType);
      } catch (err) {
        return {
          isVerified: false,
          isStaged: false,
          isFullyStaged: false,
          isStagingRequired: true,
          stagingStatus: 'UNKNOWN',
          targetType: sType,
          targetBin: '',
          warehouse: sLgnum,
          error: `Cannot verify staging: SAP staging target read failed: ${err.message || err}`
        };
      }
      if (!target.isWm) {
        return {
          isVerified: true,
          isStaged: true,
          isFullyStaged: true,
          isStagingRequired: false,
          stagingStatus: 'NOT_WM_MANAGED',
          stagedQty: reqQty,
          requiredQty: reqQty,
          plannedUnconfirmedQty: 0
        };
      }
      sLgnum = target.warehouse || sLgnum;
      if (target.targetType && target.targetBin && target.stagingSource === 'PKHD_CONTROL_CYCLE') {
        sType = target.targetType;
        sBin = target.targetBin;
      } else if (resNo) {
        const transfer = await this.findTransferRequirement(resNo, resItem, sMat, sPlant, sLgnum, true);
        sTbnum = transfer.tbnum || '';
        transferRequirementStatus = transfer.status || 'UNKNOWN';
        if (transfer.status === 'UNKNOWN') {
          return {
            isVerified: false,
            isStaged: false,
            isFullyStaged: false,
            isStagingRequired: true,
            stagingStatus: 'UNKNOWN',
            targetType: transfer.targetType || sType,
            targetBin: '',
            warehouse: sLgnum,
            error: transfer.error
          };
        }
        if (transfer.status === 'NOT_FOUND') {
          return {
            isVerified: true,
            isStaged: false,
            isFullyStaged: false,
            isStagingRequired: true,
            stagingStatus: 'NOT_STAGED',
            targetType: sType,
            targetBin: '',
            warehouse: sLgnum,
            error: transfer.error || `No transfer requirement found for reservation ${resNo}.`
          };
        }
        if (transfer.targetType && transfer.targetBin) {
          sType = transfer.targetType;
          sBin = transfer.targetBin;
        }
      }

      if (!sType || !sBin) {
        return {
          isVerified: false,
          isStaged: false,
          isFullyStaged: false,
          isStagingRequired: true,
          stagingStatus: 'UNKNOWN',
          warehouse: sLgnum,
          error: target.error || `SAP staging target could not be resolved for material ${sMat}.`
        };
      }
    }

    if (!sTbnum && resNo) {
      const transfer = await this.findTransferRequirement(resNo, resItem, sMat, sPlant, sLgnum, true);
      sTbnum = transfer.tbnum || '';
      transferRequirementStatus = transfer.status || 'UNKNOWN';
    }

    let stagedQty = 0;
    let plannedUnconfirmedQty = 0;

    if (!this.rfc || typeof this.rfc.readTable !== 'function') {
      throw stagingError('SAP RFC table access is unavailable; staged stock cannot be verified.');
    }
    const matnrIn = wmAlphaIn(sMat);
    const where = [
      `LGNUM = '${sLgnum}'`,
      `AND LGTYP = '${sType}'`,
      `AND LGPLA = '${sBin}'`,
      `AND MATNR = '${matnrIn}'`,
      `AND WERKS = '${sPlant}'`,
      `AND LGORT = '${sSloc}'`
    ];
    let lquaRows;
    try {
      lquaRows = await this.rfc.readTable(
        'LQUA',
        ['LGNUM', 'LGTYP', 'LGPLA', 'MATNR', 'WERKS', 'LGORT', 'VERME', 'EINME', 'MEINS', 'BESTQ', 'SOBKZ', 'SKZUA', 'SKZSA', 'SKZSI'],
        where, 500
      );
    } catch (err) {
      return {
        isVerified: false,
        isStaged: false,
        isStagingRequired: true,
        stagingStatus: 'UNKNOWN',
        targetType: sType,
        targetBin: sBin,
        warehouse: sLgnum,
        error: `Cannot verify staging: LQUA read failed: ${err.message || err}`
      };
    }
    for (const row of lquaRows || []) {
      if (
        clean(row.LGNUM) !== sLgnum || clean(row.LGTYP) !== sType || clean(row.LGPLA) !== sBin ||
        clean(row.MATNR).replace(/^0+/, '') !== sMat.replace(/^0+/, '') ||
        clean(row.WERKS) !== sPlant || clean(row.LGORT) !== sSloc
      ) {
        throw stagingError('SAP returned a WM quant outside the requested staging target; staged stock cannot be verified.');
      }
      if (clean(row.MEINS).toUpperCase() !== clean(uom).toUpperCase()) {
        throw stagingError(`SAP staged stock unit ${clean(row.MEINS) || '(blank)'} does not match reservation unit ${uom || '(blank)'}.`);
      }
      plannedUnconfirmedQty += wmNum(row.EINME);
      if (
        !clean(row.BESTQ) && !clean(row.SOBKZ) &&
        !clean(row.SKZUA) && !clean(row.SKZSA) && !clean(row.SKZSI)
      ) {
        stagedQty += wmNum(row.VERME);
      }
    }

    stagedQty = Math.round(stagedQty * 1000) / 1000;
    plannedUnconfirmedQty = Math.round(plannedUnconfirmedQty * 1000) / 1000;

    const isFullyStaged = stagedQty >= reqQty;
    const isStaged = isFullyStaged;

    let error = '';
    if (!isFullyStaged) {
      const binLocation = [sLgnum, sType ? `${sType}/${sBin}` : sBin].filter(Boolean).join('/');
      error = `Only ${stagedQty} of ${reqQty} ${uom} staged in ${binLocation}.`;
      if (plannedUnconfirmedQty > 0) {
        error += ` ${plannedUnconfirmedQty} of ${reqQty} ${uom} in transfer; ${stagedQty} ${uom} confirmed in the bin.`;
      }
      if (transferRequirementStatus === 'FOUND' && sTbnum) {
        error += ` Transfer requirement ${sTbnum} needs a confirmed transfer order (LT04/LT12).`;
      } else if (transferRequirementStatus === 'UNKNOWN') {
        error += ' Transfer requirement status unknown; check whether a TR/TO exists, and confirm the TO if one is open.';
      } else {
        error += ' No reservation-linked transfer requirement was found; verify the warehouse requirement before proceeding.';
      }
    }

    return {
      isVerified: true,
      isStaged,
      isFullyStaged,
      isStagingRequired: true,
      stagingStatus: isFullyStaged ? 'OK' : (plannedUnconfirmedQty > 0 ? 'IN_TRANSFER' : 'NOT_STAGED'),
      stagedQty,
      requiredQty: reqQty,
      plannedUnconfirmedQty,
      targetType: sType,
      targetBin: sBin,
      warehouse: sLgnum,
      tbnum: sTbnum,
      transferRequirementStatus,
      uom,
      error: error || undefined
    };
  }

  /**
   * Check staging for a specific reservation item end-to-end.
   */
  async getStagingForReservation(reservationNo, reservationItem, { issueQty, issueUnit } = {}) {
    const sResv = clean(reservationNo);
    const sItem = clean(reservationItem);
    if (!sResv || !sItem) throw stagingError('Reservation number and item are required to verify WM staging.', 400);

    let itemData = null;
    let resbFound = false;

    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const resvPadded = sResv.padStart(10, '0');
        const itemPadded = sItem.padStart(4, '0');
        const where = [`RSNUM = '${resvPadded}'`, `AND RSPOS = '${itemPadded}'`, `AND XLOEK = ''`, `AND KZEAR = ''`];
        const resbRows = await this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'AUFNR', 'LGTYP', 'PRVBE'], where, 1);
        if (resbRows && resbRows[0]) {
          resbFound = true;
          itemData = {
            Material: clean(resbRows[0].MATNR).replace(/^0+/, ''),
            Plant: clean(resbRows[0].WERKS),
            StorageLocation: clean(resbRows[0].LGORT),
            RequiredQty: wmNum(resbRows[0].BDMNG),
            WithdrawnQty: wmNum(resbRows[0].ENMNG),
            BaseUnit: clean(resbRows[0].MEINS) || 'PC',
            TargetType: clean(resbRows[0].LGTYP),
            Psa: clean(resbRows[0].PRVBE),
            OrderNo: clean(resbRows[0].AUFNR)
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
      throw stagingError(`Reservation ${sResv} item ${sItem} could not be read from SAP to verify WM staging.`);
    }

    if (!itemData.Material || !itemData.Plant || !itemData.StorageLocation) {
      throw stagingError(`SAP returned incomplete reservation context for ${sResv} item ${sItem}; WM staging cannot be verified.`);
    }

    if (!this.rfc || typeof this.rfc.readTable !== 'function') {
      throw stagingError('SAP RFC table access is unavailable; WM-managed storage cannot be verified.');
    }
    const mappings = await this.rfc.readTable(
      'T320', ['WERKS', 'LGORT', 'LGNUM'],
      [`WERKS = '${itemData.Plant}'`, `AND LGORT = '${itemData.StorageLocation}'`], 2
    );
    if (mappings.length > 1) {
      throw stagingError(`SAP returned ambiguous WM warehouse mappings for ${itemData.Plant}/${itemData.StorageLocation}.`);
    }
    const warehouse = clean(mappings[0]?.LGNUM);
    if (!warehouse) {
      return {
        isVerified: true,
        isStaged: true,
        isFullyStaged: true,
        isStagingRequired: false,
        stagingStatus: 'NOT_WM_MANAGED',
        stagedQty: 0,
        requiredQty: Number(issueQty ?? Math.max(0, itemData.RequiredQty - itemData.WithdrawnQty)),
        plannedUnconfirmedQty: 0,
        warehouse: ''
      };
    }

    if (!resbFound) {
      throw stagingError(`WM warehouse ${warehouse} is configured for ${itemData.Plant}/${itemData.StorageLocation}, but SAP RESB staging data for reservation ${sResv} item ${sItem} could not be verified.`);
    }
    if (!itemData.TargetType) {
      throw stagingError(`SAP RESB has no staging type for WM-managed reservation ${sResv} item ${sItem}; staging requirement cannot be verified.`);
    }

    const netOpen = Math.max(0, itemData.RequiredQty - itemData.WithdrawnQty);
    const requestedQty = issueQty == null ? netOpen : Number(issueQty);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      throw stagingError(`Issue quantity ${issueQty} is invalid for WM staging verification.`, 400);
    }
    let requiredBaseQty = requestedQty;
    const requestedUnit = clean(issueUnit || itemData.BaseUnit).toUpperCase();
    const baseUnit = clean(itemData.BaseUnit).toUpperCase();
    if (!baseUnit || !requestedUnit) {
      throw stagingError(`SAP reservation unit could not be verified for ${sResv} item ${sItem}.`);
    }
    if (requestedUnit !== baseUnit) {
      if (!this.adapter || typeof this.adapter.getMaterialPackagingUnits !== 'function') {
        throw stagingError(`SAP unit conversion is unavailable from ${requestedUnit} to ${baseUnit} for material ${itemData.Material}.`);
      }
      const units = await this.adapter.getMaterialPackagingUnits(itemData.Material);
      const entry = Array.isArray(units)
        ? units.find((candidate) => clean(candidate.Unit).toUpperCase() === requestedUnit)
        : null;
      const base = Array.isArray(units)
        ? units.find((candidate) => clean(candidate.Unit).toUpperCase() === baseUnit && candidate.IsBaseUnit)
        : null;
      const factor = Number(entry?.FactorToBase);
      if (!entry || !base || !Number.isFinite(factor) || factor <= 0) {
        throw stagingError(`SAP unit conversion from ${requestedUnit} to reservation base unit ${baseUnit} could not be verified for material ${itemData.Material}.`);
      }
      requiredBaseQty *= factor;
    }
    if (requiredBaseQty > netOpen + 1e-9) {
      throw stagingError(`Requested staging quantity ${requiredBaseQty} ${baseUnit} exceeds SAP reservation open quantity ${netOpen} ${baseUnit}.`, 422);
    }

    // Resolve target bin: PKHD-LGPLA if set, else LTBK NLTYP/NLPLA by RSNUM/RSPOS
    const pkhdTarget = await this.findStagingTarget(
      itemData.Material, itemData.Plant, itemData.StorageLocation, warehouse,
      itemData.Psa, itemData.OrderNo, itemData.TargetType
    );
    let target = null;
    let transfer = { tbnum: '', status: 'UNKNOWN' };

    if (pkhdTarget && pkhdTarget.targetType && pkhdTarget.targetBin && pkhdTarget.stagingSource === 'PKHD_CONTROL_CYCLE') {
      target = pkhdTarget;
      try {
        transfer = await this.findTransferRequirement(sResv, sItem, '', '', warehouse, true);
      } catch (_e) {
        // non-blocking when PKHD static target is already resolved
      }
    } else {
      transfer = await this.findTransferRequirement(sResv, sItem, '', '', warehouse, true);
      if (transfer.status === 'UNKNOWN') {
        return {
          isVerified: false,
          isStaged: false,
          isFullyStaged: false,
          isStagingRequired: true,
          stagingStatus: 'UNKNOWN',
          targetType: transfer.targetType || itemData.TargetType || '',
          targetBin: '',
          warehouse,
          transferRequirementStatus: 'UNKNOWN',
          error: transfer.error
        };
      }
      if (transfer.targetType && transfer.targetBin) {
        target = {
          isWm: true,
          targetType: transfer.targetType,
          targetBin: transfer.targetBin,
          stagingSource: 'TRANSFER_REQUIREMENT',
          warehouse,
          tbnum: transfer.tbnum
        };
      } else if (transfer.status === 'NOT_FOUND') {
        return {
          isVerified: true,
          isStaged: false,
          isFullyStaged: false,
          isStagingRequired: true,
          stagingStatus: 'NOT_STAGED',
          targetType: itemData.TargetType || '',
          targetBin: '',
          warehouse,
          transferRequirementStatus: 'NOT_FOUND',
          error: transfer.error || `No transfer requirement found for reservation ${sResv}.`
        };
      }
    }

    if (!target || !target.targetType || !target.targetBin) {
      if (target?.status === 'UNKNOWN') {
        return {
          isVerified: false,
          isStaged: false,
          isFullyStaged: false,
          isStagingRequired: true,
          stagingStatus: 'UNKNOWN',
          targetType: target?.targetType || '',
          targetBin: '',
          warehouse,
          transferRequirementStatus: transfer.status || 'UNKNOWN',
          error: target.error || 'SAP staging target could not be resolved.'
        };
      }
      throw stagingError(target?.error || `SAP staging target could not be resolved for reservation ${sResv} item ${sItem}.`);
    }
    return this.checkStaging({
      material: itemData.Material,
      plant: itemData.Plant,
      sloc: itemData.StorageLocation,
      warehouse,
      targetType: target.targetType,
      targetBin: target.targetBin,
      psa: itemData.Psa,
      orderNo: itemData.OrderNo,
      requiredQty: requiredBaseQty,
      uom: baseUnit,
      tbnum: transfer.tbnum,
      resNo: sResv,
      resItem: sItem
    });
  }
}

module.exports = GoodsIssuePhase6StagingClient;
