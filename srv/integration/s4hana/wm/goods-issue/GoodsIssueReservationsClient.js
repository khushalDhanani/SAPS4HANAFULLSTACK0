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
    this.queueManager = options.queueManager || (this.adapter && this.adapter.queueManager) || null;
  }

  /**
   * Resolve the queue manager instance if available.
   * @returns {Object|null}
   */
  _getQueueManager() {
    if (this.queueManager) return this.queueManager;
    if (this.adapter && this.adapter.queueManager) return this.adapter.queueManager;
    try {
      return require('../../../../wm/goods-issue/GoodsIssueQueueManager');
    } catch {
      return null;
    }
  }

  /**
   * Helper to retrieve map of pending queued items.
   * @param {string} [reservationNo]
   * @returns {Promise<Map<string, { queuedQty: number, finalIssue: boolean }>>}
   */
  async _getPendingQueueMap(reservationNo) {
    try {
      const qm = this._getQueueManager();
      if (qm && typeof qm.getPendingQueueMap === 'function') {
        return await qm.getPendingQueueMap(reservationNo);
      }
    } catch (err) {
      LOG.warn(`Could not read pending queue map in reservations client: ${err.message}`);
    }
    return new Map();
  }

  /**
   * Fetch distinct open reservations for Goods Issue directly from UI_RESERVATION_ITM_MNG_V2
   * @param {string} [movementType='261']
   * @param {string} [plant]
   * @param {object|string} [options] - Options object or reservationNo string
   * @param {string} [options.reservationNo] - Server-side filter by Reservation
   * @param {string} [options.orderNo] - Server-side filter by OrderID
   * @param {number} [options.maxItems=2000] - Maximum raw items to scan (0 = unconstrained)
   * @param {number} [options.pageSize=100] - OData page size
   * @returns {Promise<Array>}
   */
  async getOpenReservations(movementType = '261', plant = '', options = {}) {
    const sPlant = plant ? String(plant).trim() : '';
    const opts = typeof options === 'string' ? { reservationNo: options } : (options || {});
    const sResv = opts.reservationNo ? String(opts.reservationNo).trim() : '';
    const sOrder = opts.orderNo ? String(opts.orderNo).trim() : '';
    const pageSize = typeof opts.pageSize === 'number' && opts.pageSize > 0 ? opts.pageSize : 100;
    // If targeted reservation or order is specified, default to high/unconstrained ceiling
    const defaultMax = (sResv || sOrder) ? 10000 : 2000;
    const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : defaultMax;

    let filter = `ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
    if (movementType) {
      filter += ` and (GoodsMovementType eq '${encodeURIComponent(movementType)}' or GoodsMovementType eq '261' or GoodsMovementType eq '201' or GoodsMovementType eq '531')`;
    }
    if (sPlant) {
      filter += ` and Plant eq '${encodeURIComponent(sPlant)}'`;
    }
    if (sResv) {
      const sResClean = sResv.replace(/^0+/, '');
      const sResPadded = sResv.padStart(10, '0');
      filter += ` and (Reservation eq '${encodeURIComponent(sResClean)}' or Reservation eq '${encodeURIComponent(sResPadded)}')`;
    }
    if (sOrder) {
      const sOrderClean = sOrder.replace(/^0+/, '');
      const sOrderPadded = sOrder.padStart(12, '0');
      filter += ` and (OrderID eq '${encodeURIComponent(sOrderClean)}' or OrderID eq '${encodeURIComponent(sOrderPadded)}')`;
    }

    try {
      const pendingQueueMap = await this._getPendingQueueMap(sResv);
      let skip = 0;
      const allResults = [];
      let isTruncated = false;

      while (true) {
        const page = await this._get(
          '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
          `$filter=${encodeURIComponent(filter)}&$top=${pageSize}&$skip=${skip}&$format=json`
        );
        const items = Array.isArray(page) ? page : [];
        allResults.push(...items);

        if (items.length < pageSize) {
          break;
        }

        if (maxItems > 0 && allResults.length >= maxItems) {
          isTruncated = true;
          LOG.warn(
            `Open reservations item scan reached limit of ${maxItems} items from SAP S/4HANA (plant: '${sPlant || 'all'}', movementType: '${movementType || 'all'}'). ` +
            `List is partial (scanned ${allResults.length} items). Filter by plant, reservation, or order for complete results.`
          );
          break;
        }

        skip += pageSize;
      }

      if (allResults.length > 0) {
        const resvMap = new Map();
        const boundaryResvNo = (isTruncated && allResults.length > 0) ? allResults[allResults.length - 1].Reservation : null;

        for (const r of allResults) {
          const sRes = r.Reservation || '';
          if (!sRes) continue;

          const sResClean = sRes.replace(/^0+/, '');
          const sItemClean = String(r.ReservationItem || '').trim().replace(/^0+/, '');
          const qEntry = pendingQueueMap.get(`${sResClean}:${sItemClean}`);
          const queuedQty = qEntry ? qEntry.queuedQty : 0;
          const isFinalQueued = qEntry ? qEntry.finalIssue : false;

          // Derive OpenQty — deduct SAP withdrawn qty AND local queued qty
          const reqQty = Number(r.ResvnItmRequiredQtyInBaseUnit) || 0;
          const wdnQty = Number(r.ResvnItmWithdrawnQtyInBaseUnit) || 0;
          const openQty = isFinalQueued ? 0 : Math.max(0, reqQty - wdnQty - queuedQty);
          if (openQty <= 0) continue;

          if (!resvMap.has(sRes)) {
            resvMap.set(sRes, {
              ReservationNo: sRes,
              OrderNo: r.OrderID || '',
              Plant: r.Plant || '',
              MovementType: r.GoodsMovementType || '',
              MovementTypeName: r.GoodsMovementTypeName || '',
              ItemCount: 1,
              ItemCountPartial: false,
              SampleMaterial: r.Product || '',
              SampleMaterialDesc: r.ProductName || ''
            });
          } else {
            const entry = resvMap.get(sRes);
            entry.ItemCount++;
            if (!entry.OrderNo && r.OrderID) entry.OrderNo = r.OrderID;
          }
        }

        // If truncated, flag the reservation sitting at the cutoff boundary as having potentially partial ItemCount
        if (isTruncated && boundaryResvNo && resvMap.has(boundaryResvNo)) {
          resvMap.get(boundaryResvNo).ItemCountPartial = true;
        }

        const resultArray = Array.from(resvMap.values()).map(v => {
          let desc = `Reservation ${v.ReservationNo}`;
          if (v.OrderNo) {
            desc += ` (Order ${v.OrderNo}`;
          } else {
            desc += ` (${v.MovementTypeName || 'Goods Issue'}`;
          }
          if (v.Plant) {
            desc += ` • Plant ${v.Plant}`;
          }
          if (v.ItemCountPartial) {
            desc += ` • ${v.ItemCount}+ items (partial))`;
          } else {
            desc += ` • ${v.ItemCount} ${v.ItemCount === 1 ? 'item' : 'items'})`;
          }

          return {
            ...v,
            IsTruncated: isTruncated,
            TruncationNote: isTruncated
              ? `Showing reservations from first ${allResults.length} SAP items. Filter by plant or order for complete list.`
              : '',
            DisplayText: desc
          };
        }).sort((a, b) => Number(b.ReservationNo) - Number(a.ReservationNo));

        Object.defineProperty(resultArray, 'isTruncated', { value: isTruncated, enumerable: false, writable: true });
        Object.defineProperty(resultArray, 'totalScannedItems', { value: allResults.length, enumerable: false, writable: true });

        return resultArray;
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
      const pendingQueueMap = await this._getPendingQueueMap(rawReserv);

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
        const sResClean = String(r.Reservation || '').trim().replace(/^0+/, '');
        const sItemClean = String(r.ReservationItem || '').trim().replace(/^0+/, '');
        const qEntry = pendingQueueMap.get(`${sResClean}:${sItemClean}`);
        const queuedQty = qEntry ? qEntry.queuedQty : 0;
        const isFinalQueued = qEntry ? qEntry.finalIssue : false;

        const reqQty = Number(r.ResvnItmRequiredQtyInBaseUnit || 0);
        const wdnQty = Number(r.ResvnItmWithdrawnQtyInBaseUnit || 0);
        const openQty = isFinalQueued ? 0 : Math.max(0, reqQty - wdnQty - queuedQty);

        // Fetch live packaging units (MARM)
        let packagingUnits = await getPackagingUnitsFn(r.Product);
        const baseUnit = r.BaseUnit || r.ResvnItemComponentUnit || r.EntryUnit || r.UnitOfMeasure || '';
        if ((!packagingUnits || packagingUnits.length === 0) && baseUnit) {
          packagingUnits = [
            {
              Unit: baseUnit,
              Description: `Base Unit (${baseUnit})`,
              Numerator: 1,
              Denominator: 1,
              FactorToBase: 1.0,
              IsBaseUnit: true
            }
          ];
        } else if (!packagingUnits) {
          packagingUnits = [];
        }

        // Batch status evaluation if item has a pre-assigned batch
        let batchStatus = { StatusState: 'None', StatusText: r.Batch ? 'unknown' : 'NO BATCH', DaysToExpiry: null };
        let expiryDate = null;
        if (r.Batch) {
          try {
            const batchList = await getBatchesFn(r.Product, r.Plant);
            const matchedBatch = batchList && batchList.find(b => b.Batch === r.Batch);
            if (matchedBatch) {
              expiryDate = matchedBatch.ExpiryDate || null;
              if (matchedBatch.StatusText) {
                batchStatus = {
                  StatusState: matchedBatch.StatusState || 'None',
                  StatusText: matchedBatch.StatusText,
                  DaysToExpiry: matchedBatch.DaysToExpiry !== undefined ? matchedBatch.DaysToExpiry : null
                };
              } else if (matchedBatch.ExpiryDate) {
                batchStatus = this._enrichBatchStatus(matchedBatch.ExpiryDate);
              } else {
                batchStatus = { StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: null };
              }
            } else {
              batchStatus = { StatusState: 'None', StatusText: 'unknown', DaysToExpiry: null };
            }
          } catch (err) {
            LOG.warn(`Could not enrich batch status for item ${r.ReservationItem} batch ${r.Batch}: ${err.message}`);
            batchStatus = { StatusState: 'None', StatusText: 'unknown', DaysToExpiry: null };
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
          Batch: r.Batch || '',
          ExpiryDate: expiryDate,
          BatchStatusState: batchStatus.StatusState,
          BatchStatusText: batchStatus.StatusText,
          Unit: baseUnit,
          RequiredQty: reqQty,
          WithdrawnQty: wdnQty,
          QueuedQty: queuedQty,
          OpenQty: openQty,
          MovementType: r.GoodsMovementType || '',
          MovementTypeName: r.GoodsMovementTypeName || '',
          PackagingUnits: packagingUnits
        };
      }));

      // Return strictly open lines — no fallback to closed items
      return mappedItems.filter(i => i.OpenQty > 0);
    }

    return [];
  }
}

module.exports = GoodsIssueReservationsClient;
