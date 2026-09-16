const LOG = require('../../logger')('goods-issue-reservations');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

/**
 * Domain client for SAP S/4HANA Goods Issue Reservations and Open Items.
 * Queries UI_RESERVATION_ITM_MNG_V2 (ReservationDocumentItem).
 */
class GoodsIssueReservationsClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.batchesClient = options.batchesClient || (this.adapter && this.adapter.batches) || null;
  }

  /**
   * Fetch distinct open reservations for Goods Issue directly from UI_RESERVATION_ITM_MNG_V2
   * @param {string} [movementType='261']
   * @param {string} [plant]
   * @returns {Promise<Array>}
   */
  async getOpenReservations(movementType = '261', plant = '') {
    const sPlant = plant ? String(plant).trim() : '';
    let filter = `ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
    if (movementType) {
      filter += ` and (GoodsMovementType eq '${encodeURIComponent(movementType)}' or GoodsMovementType eq '261' or GoodsMovementType eq '201')`;
    }
    if (sPlant) {
      filter += ` and Plant eq '${encodeURIComponent(sPlant)}'`;
    }

    try {
      const results = await this._get(
        '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
        `$filter=${encodeURIComponent(filter)}&$top=100&$format=json`
      );

      if (Array.isArray(results) && results.length > 0) {
        const resvMap = new Map();
        for (const r of results) {
          const sResv = r.Reservation || '';
          if (!sResv) continue;

          if (!resvMap.has(sResv)) {
            resvMap.set(sResv, {
              ReservationNo: sResv,
              OrderNo: r.OrderID || '',
              Plant: r.Plant || '',
              MovementType: r.GoodsMovementType || '261',
              MovementTypeName: r.GoodsMovementTypeName || 'GI for order',
              ItemCount: 1,
              SampleMaterial: r.Product || '',
              SampleMaterialDesc: r.ProductName || ''
            });
          } else {
            const entry = resvMap.get(sResv);
            entry.ItemCount++;
            if (!entry.OrderNo && r.OrderID) entry.OrderNo = r.OrderID;
          }
        }

        return Array.from(resvMap.values()).map(v => {
          let desc = `Reservation ${v.ReservationNo}`;
          if (v.OrderNo) {
            desc += ` (Order ${v.OrderNo}`;
          } else {
            desc += ` (${v.MovementTypeName || 'Goods Issue'}`;
          }
          if (v.Plant) {
            desc += ` • Plant ${v.Plant}`;
          }
          desc += ` • ${v.ItemCount} ${v.ItemCount === 1 ? 'item' : 'items'})`;

          return {
            ...v,
            DisplayText: desc
          };
        }).sort((a, b) => Number(b.ReservationNo) - Number(a.ReservationNo));
      }
    } catch (err) {
      LOG.warn(`Failed to query open reservations from S/4HANA: ${err.message}`);
      throw err;
    }

    return [];
  }

  /**
   * Fetch open reservation component items for scanned Order or Reservation number via UI_RESERVATION_ITM_MNG_V2
   * @param {string} orderNo
   * @param {string} reservNo
   * @returns {Promise<Array>}
   */
  async getOpenItems(orderNo, reservNo) {
    const rawOrder = (orderNo || '').trim();
    const rawReserv = (reservNo || '').trim();

    if (!rawOrder && !rawReserv) {
      return [];
    }

    const sOrderClean = rawOrder.replace(/^0+/, '');
    const sReservClean = rawReserv.replace(/^0+/, '');

    const sOrderPadded = rawOrder ? rawOrder.padStart(12, '0') : '';
    const sReservPadded = rawReserv ? rawReserv.padStart(10, '0') : '';

    const filterParts = [];
    if (sOrderClean) {
      filterParts.push(`OrderID eq '${sOrderClean}' or OrderID eq '${sOrderPadded}'`);
    }
    if (sReservClean) {
      filterParts.push(`Reservation eq '${sReservClean}' or Reservation eq '${sReservPadded}'`);
    }

    const fullFilter = `(${filterParts.join(' or ')}) and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
    const results = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(fullFilter)}&$format=json`);

    if (Array.isArray(results) && results.length > 0) {
      const getPackagingUnitsFn = (mat) => {
        if (this.adapter && typeof this.adapter.getMaterialPackagingUnits === 'function') {
          return this.adapter.getMaterialPackagingUnits(mat);
        }
        if (this.batchesClient && typeof this.batchesClient.getMaterialPackagingUnits === 'function') {
          return this.batchesClient.getMaterialPackagingUnits(mat);
        }
        return [];
      };

      const getBatchesFn = (mat, plant) => {
        if (this.adapter && typeof this.adapter.getMaterialBatches === 'function') {
          return this.adapter.getMaterialBatches(mat, plant);
        }
        if (this.batchesClient && typeof this.batchesClient.getMaterialBatches === 'function') {
          return this.batchesClient.getMaterialBatches(mat, plant);
        }
        return [];
      };

      const mappedItems = await Promise.all(results.map(async (r) => {
        const reqQty = Number(r.ResvnItmRequiredQtyInBaseUnit || 0);
        const wdnQty = Number(r.ResvnItmWithdrawnQtyInBaseUnit || 0);
        const openQty = Math.max(0, reqQty - wdnQty);

        // Fetch live packaging units (MARM)
        let packagingUnits = await getPackagingUnitsFn(r.Product);
        if (!packagingUnits || packagingUnits.length === 0) {
          const baseUnit = r.BaseUnit || 'PC';
          packagingUnits = [
            {
              Unit: baseUnit,
              Description: `Base Unit (${baseUnit})`,
              Numerator: 1,
              Denominator: 1,
              FactorToBase: 1.0,
              IsBaseUnit: true,
              Barcode: `${r.Product}-${baseUnit}`
            }
          ];
        }

        // Batch status evaluation if item has a pre-assigned batch
        let batchStatus = { StatusState: 'None', StatusText: r.Batch ? 'NO SLED' : 'NO BATCH', DaysToExpiry: 9999 };
        let expiryDate = null;
        if (r.Batch) {
          try {
            const batchList = await getBatchesFn(r.Product, r.Plant);
            const matchedBatch = batchList.find(b => b.Batch === r.Batch);
            if (matchedBatch) {
              expiryDate = matchedBatch.ExpiryDate;
              batchStatus = this._enrichBatchStatus(matchedBatch.ExpiryDate);
            }
          } catch (err) {
            LOG.warn(`Could not enrich batch status for item ${r.ReservationItem} batch ${r.Batch}: ${err.message}`);
          }
        }

        return {
          ReservationNo: r.Reservation || '',
          ReservationItem: (r.ReservationItem || '').padStart(4, '0'),
          OrderNo: r.OrderID || '',
          Material: r.Product || '',
          MaterialDesc: r.ProductName || '',
          Plant: r.Plant || '',
          StorageLocation: r.StorageLocation || '',
          StorageBin: r.StorageLocationName || '',
          Batch: r.Batch || '',
          ExpiryDate: expiryDate,
          BatchStatusState: batchStatus.StatusState,
          BatchStatusText: batchStatus.StatusText,
          Unit: r.BaseUnit || 'PC',
          RequiredQty: reqQty,
          WithdrawnQty: wdnQty,
          OpenQty: openQty,
          MovementType: r.GoodsMovementType || '261',
          MovementTypeName: r.GoodsMovementTypeName || 'GI for order',
          PackagingUnits: packagingUnits
        };
      }));

      // Return open lines
      const openLines = mappedItems.filter(i => i.OpenQty > 0);
      return openLines.length > 0 ? openLines : mappedItems;
    }

    return [];
  }
}

module.exports = GoodsIssueReservationsClient;
