const LOG = require('../../logger')('goods-issue-batches');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

/**
 * Domain client for SAP S/4HANA Goods Issue Batches, Packaging Units, and Stock Revalidation.
 * Handles LO_BM_BATCH_SRV (I_Batch), MMIM_MATERIAL_DATA_SRV (Material2Auoms, MaterialStorLocHelps),
 * SLED checks, and pre-posting stock verification.
 */
class GoodsIssueBatchesClient extends BaseGoodsIssueClient {
  /**
   * Fetch alternative packaging units (MARM) for a material via MMIM_MATERIAL_DATA_SRV
   * @param {string} material
   * @returns {Promise<Array>}
   */
  async getMaterialPackagingUnits(material) {
    if (!material) return [];
    const sMat = String(material).trim();

    try {
      const navPath = `/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialHeaders('${encodeURIComponent(sMat)}')/Material2Auoms`;
      const auoms = await this._get(navPath, '$format=json');
      if (Array.isArray(auoms) && auoms.length > 0) {
        return auoms.map(u => {
          const num = Number(u.Numerator || 1);
          const den = Number(u.Denominator || 1);
          const factor = den > 0 ? (num / den) : num;
          return {
            Unit: u.AlternativeUnit || '',
            Description: u.AlternativeUnitName || u.AlternativeUnit || '',
            Numerator: num,
            Denominator: den,
            FactorToBase: factor,
            IsBaseUnit: Boolean(u.IsBaseUnit)
          };
        });
      }
    } catch (err) {
      LOG.warn(`Failed to fetch alternative packaging units for material ${sMat}: ${err.message}`);
    }

    return [];
  }

  /**
   * Fetch available batches for a material with real SLED information, FEFO sort, and storage location stock
   * Directly queries LO_BM_BATCH_SRV/I_Batch and MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps
   * Excludes batches that are marked for deletion, in restricted-use stock, or expired.
   * @param {string} material
   * @param {string} [plant]
   * @param {string} [storageLocation]
   * @returns {Promise<Array>}
   */
  async getMaterialBatches(material, plant, storageLocation) {
    if (!material) return [];
    const sMat = String(material).trim();
    const sPlant = plant ? String(plant).trim() : '';
    const sSLoc = storageLocation ? String(storageLocation).trim() : '';

    // 1. Fetch authentic batches from LO_BM_BATCH_SRV/I_Batch
    let filter = `Material eq '${encodeURIComponent(sMat)}'`;
    if (sPlant) {
      filter += ` and (Plant eq '${encodeURIComponent(sPlant)}' or Plant eq '')`;
    }

    const results = await this._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=${filter}&$format=json`);
    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }

    // 2. Deduplicate batches by batch identifier (merging plant and client master records)
    const batchMap = new Map();
    for (const b of results) {
      const batchId = b.Batch ? String(b.Batch).trim() : '';
      if (!batchId) continue;
      const existing = batchMap.get(batchId);
      if (!existing || (!existing.Plant && b.Plant)) {
        const expDate = b.ShelfLifeExpirationDate || (existing && existing.ShelfLifeExpirationDate);
        const mfgDate = b.ManufactureDate || (existing && existing.ManufactureDate);
        const isDel = Boolean(b.BatchIsMarkedForDeletion || (existing && existing.BatchIsMarkedForDeletion));
        const isRestr = Boolean(b.MatlBatchIsInRstrcdUseStock || (existing && existing.MatlBatchIsInRstrcdUseStock));
        batchMap.set(batchId, {
          ...b,
          Batch: batchId,
          Plant: b.Plant || (existing && existing.Plant) || sPlant,
          ShelfLifeExpirationDate: expDate,
          ManufactureDate: mfgDate,
          BatchIsMarkedForDeletion: isDel,
          MatlBatchIsInRstrcdUseStock: isRestr
        });
      }
    }

    // 3. Fetch authentic batch-grain stock via MMIM_MULTIPLE_MATERIAL_SRV/MaterialMultiStockByDates
    const batchStockMap = new Map();
    let stockReadOk = false;
    try {
      let stockFilter = `Material eq '${encodeURIComponent(sMat)}'`;
      if (sPlant) {
        stockFilter += ` and Plant eq '${encodeURIComponent(sPlant)}'`;
      }
      if (sSLoc) {
        stockFilter += ` and StorageLocation eq '${encodeURIComponent(sSLoc)}'`;
      }
      const stockRes = await this._get(
        '/sap/opu/odata/sap/MMIM_MULTIPLE_MATERIAL_SRV/MaterialMultiStockByDates',
        `$filter=${encodeURIComponent(stockFilter)}&$format=json`
      );
      if (Array.isArray(stockRes)) {
        stockReadOk = true;
        for (const row of stockRes) {
          const bId = row.Batch ? String(row.Batch).trim() : '';
          const specialStock = String(row.InventorySpecialStockType || '').trim();
          const stockSegment = String(row.StockSegment || '').trim();
          if (bId && !specialStock && !stockSegment) {
            const rowStock = row.CurrentStock !== undefined && row.CurrentStock !== null ? Number(row.CurrentStock) : null;
            const prev = batchStockMap.get(bId);
            if (!prev) {
              batchStockMap.set(bId, {
                CurrentStock: rowStock,
                BaseUnit: row.BaseUnit || '',
                StorageLocation: row.StorageLocation || sSLoc || '',
                StorageLocationName: row.StorageLocationName || ''
              });
            } else {
              // Same batch in several storage locations / stock rows: stock is the sum, location is no longer a single one.
              prev.CurrentStock = (prev.CurrentStock === null || rowStock === null) ? null : prev.CurrentStock + rowStock;
              if ((row.StorageLocation || '') !== prev.StorageLocation) {
                prev.StorageLocation = sSLoc || '';
                prev.StorageLocationName = '';
              }
            }
          }
        }
      }
    } catch (err) {
      LOG.warn(`Batch stock lookup failed via MaterialMultiStockByDates for material ${sMat}: ${err.message}`);
    }

    // 4. Filter usable batches: exclude deleted, restricted, and expired batches
    const usableBatches = [];
    for (const b of batchMap.values()) {
      if (b.BatchIsMarkedForDeletion) continue;
      if (b.MatlBatchIsInRstrcdUseStock) continue;

      const formattedExp = this._formatDate(b.ShelfLifeExpirationDate);
      const formattedMfg = this._formatDate(b.ManufactureDate);
      const status = this._enrichBatchStatus(formattedExp);

      // Exclude expired batches from usable selection list
      if (status.StatusState === 'Error' || status.StatusText === 'EXPIRED') {
        continue;
      }

      // Batch-level stock lookup: if no stock record exists, stock is UNKNOWN (null), never silent 0
      const stockInfo = batchStockMap.get(b.Batch);
      let nStock = null;
      if (stockInfo && stockInfo.CurrentStock !== undefined && stockInfo.CurrentStock !== null) {
        nStock = Number(stockInfo.CurrentStock);
      } else if (b.AvailableStock !== undefined && b.AvailableStock !== null) {
        nStock = Number(b.AvailableStock);
      }

      // The storage-location stock read returned rows for this material but none for this batch -> the batch
      // holds no stock there. (Live: 518021 / 1000001002 / 1130-CS02 listed 3 empty batches as selectable.)
      // An entirely empty answer stays "unknown" (null): the service may simply not cover the material.
      if (nStock === null && stockReadOk && sSLoc && batchStockMap.size > 0) nStock = 0;

      // Selectable if stock is positive or unknown (null); blocked only if confirmed 0 or expired
      const isSelectable = (nStock === null || nStock > 0) && status.StatusState !== 'Error' && status.StatusText !== 'EXPIRED';

      usableBatches.push({
        Material: sMat,
        Plant: b.Plant || sPlant,
        Batch: b.Batch,
        ExpiryDate: formattedExp,
        ManufactDate: formattedMfg,
        AvailableStock: nStock,
        IsSelectable: isSelectable,
        Unit: (stockInfo && stockInfo.BaseUnit) || b.Unit || b.BaseUnit || '',
        StorageLocation: (stockInfo && stockInfo.StorageLocation) || sSLoc || b.StorageLocation || '',
        StorageLocationName: (stockInfo && stockInfo.StorageLocationName) || '',
        StatusState: status.StatusState,
        StatusText: status.StatusText,
        DaysToExpiry: status.DaysToExpiry
      });
    }

    // 5. Sort usable batches by earliest SLED (FEFO)
    usableBatches.sort((a, b) => {
      if (!a.ExpiryDate) return 1;
      if (!b.ExpiryDate) return -1;
      return new Date(a.ExpiryDate) - new Date(b.ExpiryDate);
    });

    return usableBatches;
  }

  /**
   * Validate that a batch is authentic, unexpired, non-deleted, and unrestricted in SAP S/4HANA
   * @param {string} material
   * @param {string} batch
   * @param {string} [plant]
   * @returns {Promise<{ valid: boolean, reason?: string }>}
   */
  async validateBatch(material, batch, plant) {
    if (!material || !batch) return { valid: true };
    const sMat = String(material).trim();
    const sBatch = String(batch).trim();
    const sPlant = plant ? String(plant).trim() : '';

    const getBatchesFn = (mat, plt) => {
      if (this.adapter && typeof this.adapter.getMaterialBatches === 'function') {
        return this.adapter.getMaterialBatches(mat, plt);
      }
      return this.getMaterialBatches(mat, plt);
    };

    // First check via getMaterialBatches if mocked in unit test environment
    try {
      const batches = await getBatchesFn(sMat, sPlant);
      const found = Array.isArray(batches) ? batches.find(b => b.Batch && b.Batch.toUpperCase() === sBatch.toUpperCase()) : null;
      if (found) {
        if (found.StatusState === 'Error' || found.StatusText === 'EXPIRED') {
          return { valid: false, reason: `Batch ${sBatch} has expired on ${found.ExpiryDate || 'unknown date'}. Goods issue is blocked (SLED Exceeded).` };
        }
      }
    } catch (err) {
      if (this._isOutage(err)) {
        LOG.error(`validateBatch (getMaterialBatches) failed due to S/4HANA outage for batch ${sBatch}, material ${sMat}: ${err.message}`, err);
        const outageErr = new Error(`S/4HANA batch validation service unavailable: ${err.message}`);
        outageErr.status = err.status || 502;
        throw outageErr;
      }
      LOG.warn(`validateBatch (getMaterialBatches) warning for batch ${sBatch}, material ${sMat}: ${err.message}`);
    }

    // Direct check against SAP I_Batch for real backend deletion, restricted status, and expiry
    let filter = `Material eq '${encodeURIComponent(sMat)}' and Batch eq '${encodeURIComponent(sBatch)}'`;
    if (sPlant) {
      filter += ` and (Plant eq '${encodeURIComponent(sPlant)}' or Plant eq '')`;
    }

    try {
      const results = await this._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=${filter}&$format=json`);
      if (Array.isArray(results) && results.length > 0) {
        for (const b of results) {
          if (b.BatchIsMarkedForDeletion) {
            return { valid: false, reason: `Batch ${sBatch} is marked for deletion in SAP S/4HANA.` };
          }
          if (b.MatlBatchIsInRstrcdUseStock) {
            return { valid: false, reason: `Batch ${sBatch} is in restricted-use stock in SAP S/4HANA.` };
          }
          const exp = this._formatDate(b.ShelfLifeExpirationDate);
          if (exp) {
            const status = this._enrichBatchStatus(exp);
            if (status.StatusState === 'Error' || status.StatusText === 'EXPIRED') {
              return { valid: false, reason: `Batch ${sBatch} has expired on ${exp}. Goods issue is blocked (SLED Exceeded).` };
            }
          }
        }
      }
    } catch (err) {
      if (this._isOutage(err)) {
        LOG.error(`validateBatch failed due to S/4HANA outage for batch ${sBatch}, material ${sMat}: ${err.message}`, err);
        const outageErr = new Error(`S/4HANA batch validation service unavailable: ${err.message}`);
        outageErr.status = err.status || 502;
        throw outageErr;
      }
      LOG.warn(`validateBatch warning for batch ${sBatch}, material ${sMat}: ${err.message}`);
    }

    return { valid: true };
  }

  /**
   * Validate one batch for a posting using SAP batch master, SLED, and stock scoped to the issuing
   * plant/storage location. Unknown stock or an unavailable unit conversion is a verification
   * failure, not permission to post.
   */
  async validateBatchForPosting(material, plant, storageLocation, batch, requiredQty, entryUnit) {
    const sMat = String(material || '').trim();
    const sPlant = String(plant || '').trim();
    const sSLoc = String(storageLocation || '').trim();
    const sBatch = String(batch || '').trim();
    if (!sMat || !sPlant || !sSLoc || !sBatch) {
      return { valid: false, status: 400, reason: 'Material, plant, storage location, and batch are required for batch validation.' };
    }

    const candidates = await this.getMaterialBatches(sMat, sPlant, sSLoc);
    const batchItem = Array.isArray(candidates)
      ? candidates.find((candidate) => String(candidate.Batch || '').trim().toUpperCase() === sBatch.toUpperCase())
      : null;
    if (!batchItem) {
      return {
        valid: false,
        status: 422,
        reason: `Batch ${sBatch} is not usable for material ${sMat} at plant ${sPlant}, storage location ${sSLoc}; it may be unknown, expired, deleted, or restricted in SAP.`
      };
    }

    if (String(batchItem.StorageLocation || '').trim().toUpperCase() !== sSLoc.toUpperCase()) {
      return { valid: false, status: 422, reason: `Batch ${sBatch} has no verified stock in storage location ${sSLoc}.` };
    }
    if (batchItem.StatusState === 'Error' || batchItem.StatusText === 'EXPIRED' || batchItem.IsSelectable === false) {
      return { valid: false, status: 422, reason: `Batch ${sBatch} is expired, restricted, deleted, or has no usable stock in SAP.` };
    }

    const stock = Number(batchItem.AvailableStock);
    if (batchItem.AvailableStock === null || batchItem.AvailableStock === undefined || !Number.isFinite(stock)) {
      const err = new Error(`Current SAP stock for batch ${sBatch} in plant ${sPlant}, storage location ${sSLoc} could not be verified.`);
      err.status = 502;
      throw err;
    }

    const stockUnit = String(batchItem.Unit || '').trim().toUpperCase();
    const unit = String(entryUnit || '').trim().toUpperCase();
    let requiredBaseQty = Number(requiredQty);
    if (!Number.isFinite(requiredBaseQty) || requiredBaseQty <= 0) {
      return { valid: false, status: 400, reason: 'Issue quantity must be positive for batch stock validation.' };
    }
    if (unit !== stockUnit) {
      let units;
      try {
        units = await this.getMaterialPackagingUnits(sMat);
      } catch (err) {
        const unitErr = new Error(`SAP unit conversion could not be read for material ${sMat}: ${err.message}`);
        unitErr.status = err.status || 502;
        throw unitErr;
      }
      const baseUnit = Array.isArray(units)
        ? units.find((candidate) => candidate.IsBaseUnit && String(candidate.Unit || '').trim().toUpperCase() === stockUnit)
        : null;
      const entry = Array.isArray(units)
        ? units.find((candidate) => String(candidate.Unit || '').trim().toUpperCase() === unit)
        : null;
      const factor = Number(entry && entry.FactorToBase);
      if (!baseUnit || !entry || !Number.isFinite(factor) || factor <= 0) {
        const err = new Error(`SAP cannot verify conversion from ${unit || '(blank)'} to batch stock unit ${stockUnit || '(unknown)'} for material ${sMat}.`);
        err.status = 502;
        throw err;
      }
      requiredBaseQty *= factor;
    }

    if (stock < requiredBaseQty) {
      return {
        valid: false,
        status: 422,
        reason: `Batch ${sBatch} has ${stock} ${stockUnit} available in storage location ${sSLoc}; ${requiredBaseQty} ${stockUnit} is required.`
      };
    }
    return { valid: true, availableStock: stock, requiredBaseQty, stockUnit };
  }

  /**
   * Revalidate SAP stock immediately before Goods Issue posting.
   * Prevents stale-data posting by re-reading MaterialStorLocHelps and I_Batch.
   *
   * @param {string} material
   * @param {string} plant
   * @param {string} storageLocation
   * @param {string} batch
   * @param {number} requiredQty - The quantity the user intends to issue
   * @returns {Promise<Object>} StockRevalidationResult
   */
  async revalidateStockBeforePosting(material, plant, storageLocation, batch, requiredQty) {
    if (!material) {
      const err = new Error('Material is required for stock revalidation.');
      err.status = 400;
      throw err;
    }

    const sMat = String(material).trim();
    const sPlant = plant ? String(plant).trim() : '';
    const sSLoc = storageLocation ? String(storageLocation).trim() : '';
    const sBatch = batch ? String(batch).trim() : '';
    const nRequiredQty = Number(requiredQty) || 0;

    // Re-read current stock from SAP
    let currentStock = null;
    let baseUnit = '';
    let stockReadSuccess = false;

    // 1. If batch is specified, read authentic batch stock first
    if (sBatch) {
      try {
        let batchStockFilter = `Material eq '${encodeURIComponent(sMat)}' and Batch eq '${encodeURIComponent(sBatch)}'`;
        if (sPlant) batchStockFilter += ` and Plant eq '${encodeURIComponent(sPlant)}'`;
        if (sSLoc) batchStockFilter += ` and StorageLocation eq '${encodeURIComponent(sSLoc)}'`;

        const bStockRes = await this._get(
          '/sap/opu/odata/sap/MMIM_MULTIPLE_MATERIAL_SRV/MaterialMultiStockByDates',
          `$filter=${encodeURIComponent(batchStockFilter)}&$format=json`
        );
        if (Array.isArray(bStockRes) && bStockRes.length > 0) {
          const match = bStockRes.find(r => r.Batch && r.Batch.trim().toUpperCase() === sBatch.toUpperCase()) || bStockRes[0];
          if (match && match.CurrentStock !== undefined && match.CurrentStock !== null) {
            currentStock = Number(match.CurrentStock);
            baseUnit = match.BaseUnit || '';
            stockReadSuccess = true;
          }
        }
      } catch (err) {
        if (this._isOutage(err)) {
          const connErr = new Error(`SAP connection failure during pre-posting stock revalidation: ${err.message}`);
          connErr.status = err.status || 502;
          throw connErr;
        }
        LOG.warn(`MaterialMultiStockByDates query failed during revalidation for batch ${sBatch}: ${err.message}`);
      }
    }

    // 2. Storage location fallback if not found at batch level or batch not specified
    if (!stockReadSuccess && sPlant && sSLoc) {
      try {
        const slocFilter = `Material eq '${encodeURIComponent(sMat)}' and Plant eq '${encodeURIComponent(sPlant)}' and StorageLocation eq '${encodeURIComponent(sSLoc)}'`;
        const slocRes = await this._get(
          '/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps',
          `$filter=${slocFilter}&$format=json`
        );
        if (Array.isArray(slocRes) && slocRes.length > 0 && slocRes[0].CurrentStock !== undefined && slocRes[0].CurrentStock !== null) {
          currentStock = Number(slocRes[0].CurrentStock);
          baseUnit = (slocRes[0] && slocRes[0].BaseUnit) || '';
          stockReadSuccess = true;
        }
      } catch (err) {
        if (this._isOutage(err)) {
          const connErr = new Error(`SAP connection failure during pre-posting stock revalidation: ${err.message}`);
          connErr.status = err.status || 502;
          throw connErr;
        }
      }
    }

    if (!stockReadSuccess && sPlant) {
      try {
        let stockFilter = `Material eq '${encodeURIComponent(sMat)}' and Plant eq '${encodeURIComponent(sPlant)}'`;
        if (sSLoc) stockFilter += ` and StorageLocation eq '${encodeURIComponent(sSLoc)}'`;
        const stockRes = await this._get(
          '/sap/opu/odata/sap/C_STOCKQUANTITYVALUEBYTYPE_CDS/C_STOCKQUANTITYVALUEBYTYPE',
          `$filter=${encodeURIComponent(stockFilter)}&$top=1&$format=json`
        );
        if (Array.isArray(stockRes) && stockRes.length > 0 && stockRes[0].MatlWrhsStkQtyInMatlBaseUnit !== undefined && stockRes[0].MatlWrhsStkQtyInMatlBaseUnit !== null) {
          currentStock = Number(stockRes[0].MatlWrhsStkQtyInMatlBaseUnit);
          baseUnit = stockRes[0].MaterialBaseUnit || '';
          stockReadSuccess = true;
        }
      } catch (err) {
        if (this._isOutage(err)) {
          const connErr = new Error(`SAP connection failure during pre-posting stock revalidation: ${err.message}`);
          connErr.status = err.status || 502;
          throw connErr;
        }
      }
    }

    // Re-validate batch if specified
    let batchValid = true;
    let batchStatusState = 'None';
    let batchStatusText = '';
    let batchExpiry = null;

    if (sBatch) {
      try {
        const validateBatchFn = (mat, bch, plt) => {
          if (this.adapter && typeof this.adapter.validateBatch === 'function') {
            return this.adapter.validateBatch(mat, bch, plt);
          }
          return this.validateBatch(mat, bch, plt);
        };
        const getBatchesFn = (mat, plt, sloc) => {
          if (this.adapter && typeof this.adapter.getMaterialBatches === 'function') {
            return this.adapter.getMaterialBatches(mat, plt, sloc);
          }
          return this.getMaterialBatches(mat, plt, sloc);
        };

        const valResult = await validateBatchFn(sMat, sBatch, sPlant);
        batchValid = valResult.valid;
        if (!batchValid) {
          batchStatusState = 'Error';
          batchStatusText = valResult.reason || 'Batch is invalid or expired';
        } else {
          // Get current batch details
          const batches = await getBatchesFn(sMat, sPlant, sSLoc);
          const found = batches.find(b => b.Batch && b.Batch.toUpperCase() === sBatch.toUpperCase());
          if (found) {
            batchStatusState = found.StatusState || 'None';
            batchStatusText = found.StatusText || 'unknown';
            batchExpiry = found.ExpiryDate || null;
          } else {
            batchStatusState = 'None';
            batchStatusText = 'unknown';
          }
        }
      } catch (err) {
        const connErr = new Error(`SAP connection failure during batch revalidation: ${err.message}`);
        connErr.status = err.status || 502;
        throw connErr;
      }
    }

    const stockSufficient = stockReadSuccess && currentStock !== null ? currentStock >= nRequiredQty : false;

    return {
      Material: sMat,
      Plant: sPlant,
      StorageLocation: sSLoc,
      Batch: sBatch,
      CurrentStock: currentStock,
      BaseUnit: baseUnit,
      StockReadSuccess: stockReadSuccess,
      StockSufficient: stockSufficient,
      RequestedQty: nRequiredQty,
      BatchValid: batchValid,
      BatchStatusState: batchStatusState,
      BatchStatusText: batchStatusText,
      BatchExpiry: batchExpiry,
      Valid: stockReadSuccess && stockSufficient && batchValid,
      Message: !stockReadSuccess
        ? 'Could not read current stock from SAP. Posting blocked.'
        : (!stockSufficient
          ? `Stock changed: current SAP stock (${currentStock} ${baseUnit}) is less than requested quantity (${nRequiredQty} ${baseUnit}). Posting blocked.`
          : (!batchValid
            ? `Batch ${sBatch} is no longer valid: ${batchStatusText}. Posting blocked.`
            : 'Stock and batch revalidation passed.'))
    };
  }
}

module.exports = GoodsIssueBatchesClient;
