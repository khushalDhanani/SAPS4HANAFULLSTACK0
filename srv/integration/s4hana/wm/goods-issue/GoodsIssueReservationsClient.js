const LOG = require('../../logger')('goods-issue-reservations');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

// Only the fields the reservation list needs: the full entity is ~60 fields per item, which made
// the 2,000-item scan slow. Newest reservations first, so a truncated list keeps the recent ones.
const OPEN_RESV_SELECT = [
  'Reservation', 'ReservationItem', 'OrderID', 'Plant', 'StorageLocation', 'GoodsMovementType', 'GoodsMovementTypeName',
  'Product', 'ProductName', 'ResvnItmRequiredQtyInBaseUnit', 'ResvnItmWithdrawnQtyInBaseUnit'
].join(',');

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
   * Fetch reservation header information (UserID) via UI_RESERVATION_ITM_MNG_V2/ReservationDocument
   * @param {string} [movementType]
   * @param {string} [sResv]
   * @returns {Promise<Map<string, string>>}
   */
  async _fetchReservationHeaderUsers(movementType, sResv) {
    let filter = '';
    if (sResv) {
      const sResClean = sResv.replace(/^0+/, '');
      const sResPadded = sResv.padStart(10, '0');
      filter = `(Reservation eq '${encodeURIComponent(sResClean)}' or Reservation eq '${encodeURIComponent(sResPadded)}')`;
    } else if (movementType) {
      const mvts = String(movementType).split(',').map((m) => m.trim()).filter(Boolean);
      filter = `(${mvts.map((m) => `GoodsMovementType eq '${encodeURIComponent(m)}'`).join(' or ')})`;
    }

    let queryParams = `$select=Reservation,UserID&$orderby=${encodeURIComponent('Reservation desc')}&$top=500&$format=json`;
    if (filter) {
      queryParams += `&$filter=${encodeURIComponent(filter)}`;
    }

    const headers = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocument', queryParams);
    const userMap = new Map();
    if (Array.isArray(headers)) {
      for (const h of headers) {
        const resNo = h.Reservation || '';
        const userId = h.UserID || '';
        if (resNo && userId) {
          userMap.set(resNo, userId);
          userMap.set(resNo.replace(/^0+/, ''), userId);
          userMap.set(resNo.padStart(10, '0'), userId);
        }
      }
    }
    return userMap;
  }

  /**
   * Receiving plant / storage location of transfer reservations (301/311). They exist only on the
   * reservation header (UI_RESERVATION_HDR_MNG_V2/C_ReservationDocTP_F4839), not on the item entity.
   * ponytail: newest 500 headers per call (open and closed); page it if older open transfers show blank.
   * @returns {Promise<Map<string,{ReceivingPlant:string,ReceivingStorageLocation:string}>>} keyed by unpadded reservation
   */
  async _fetchReservationHeaderReceiving(movementType, sResv) {
    const mvts = String(movementType || '').split(',').map((m) => m.trim()).filter(Boolean);
    let filter = 'IsActiveEntity eq true';
    if (mvts.length) filter += ` and (${mvts.map((m) => `GoodsMovementType eq '${encodeURIComponent(m)}'`).join(' or ')})`;
    if (sResv) {
      filter += ` and (Reservation eq '${encodeURIComponent(sResv.replace(/^0+/, ''))}' or Reservation eq '${encodeURIComponent(sResv.padStart(10, '0'))}')`;
    }
    const headers = await this._get(
      '/sap/opu/odata/sap/UI_RESERVATION_HDR_MNG_V2/C_ReservationDocTP_F4839',
      `$select=Reservation,IssuingOrReceivingPlant,IssuingOrReceivingStorageLoc&$orderby=${encodeURIComponent('Reservation desc')}&$top=500&$filter=${encodeURIComponent(filter)}&$format=json`
    );
    const map = new Map();
    for (const h of Array.isArray(headers) ? headers : []) {
      if (!h.Reservation) continue;
      map.set(String(h.Reservation).replace(/^0+/, ''), {
        ReceivingPlant: h.IssuingOrReceivingPlant || '',
        ReceivingStorageLocation: h.IssuingOrReceivingStorageLoc || ''
      });
    }
    return map;
  }

  /**
   * Fetch distinct open reservations for Goods Issue directly from UI_RESERVATION_ITM_MNG_V2
   * @param {string} [movementType='261']
   * @param {string} [plant]
   * @param {object|string} [options] - Options object or reservationNo string
   * @param {string} [options.reservationNo] - Server-side filter by Reservation
   * @param {string} [options.orderNo] - Server-side filter by OrderID
   * @param {number} [options.maxItems=2000] - Maximum raw items to scan (0 = unconstrained)
   * @param {number} [options.pageSize=1000] - OData page size
   * @returns {Promise<Array>}
   */
  async getOpenReservations(movementType = '261', plant = '', options = {}) {
    const sPlant = plant ? String(plant).trim() : '';
    const opts = typeof options === 'string' ? { reservationNo: options } : (options || {});
    const sResv = opts.reservationNo ? String(opts.reservationNo).trim() : '';
    const sOrder = opts.orderNo ? String(opts.orderNo).trim() : '';
    const pageSize = typeof opts.pageSize === 'number' && opts.pageSize > 0 ? opts.pageSize : 1000;
    // If targeted reservation or order is specified, default to high/unconstrained ceiling
    const defaultMax = (sResv || sOrder) ? 10000 : 2000;
    const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : defaultMax;

    let filter = `ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
    if (movementType) {
      // Only the movement type this screen posts. 201 (cost center) and 531 (by-product RECEIPT) were listed
      // too, but posting always uses 261, which SAP rejects against a reservation of another movement type.
      // Comma list allowed ("301,311" for the transfer block); values are trusted-listed by the handler.
      const mvts = String(movementType).split(',').map((m) => m.trim()).filter(Boolean);
      filter += ` and (${mvts.map((m) => `GoodsMovementType eq '${encodeURIComponent(m)}'`).join(' or ')})`;
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
          `$select=${OPEN_RESV_SELECT}&$orderby=${encodeURIComponent('Reservation desc')}&$filter=${encodeURIComponent(filter)}&$top=${pageSize}&$skip=${skip}&$format=json`
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
              StorageLocation: r.StorageLocation || '',
              ReceivingPlant: '',
              ReceivingStorageLocation: '',
              MovementType: r.GoodsMovementType || '',
              MovementTypeName: r.GoodsMovementTypeName || '',
              CreatedByUser: r.CreatedByUser || r.UserID || '',
              ItemCount: 1,
              ItemCountPartial: false,
              SampleMaterial: r.Product || '',
              SampleMaterialDesc: r.ProductName || ''
            });
          } else {
            const entry = resvMap.get(sRes);
            entry.ItemCount++;
            if (!entry.OrderNo && r.OrderID) entry.OrderNo = r.OrderID;
            if (!entry.StorageLocation && r.StorageLocation) entry.StorageLocation = r.StorageLocation;
            if (!entry.CreatedByUser && (r.CreatedByUser || r.UserID)) entry.CreatedByUser = r.CreatedByUser || r.UserID;
          }
        }

        // Enrich reservation header creator username from ReservationDocument if missing
        const needsUserEnrichment = Array.from(resvMap.values()).some(v => !v.CreatedByUser);
        if (needsUserEnrichment && opts.fetchUserDetails !== false) {
          try {
            const userMap = await this._fetchReservationHeaderUsers(movementType, sResv);
            if (userMap && userMap.size > 0) {
              for (const [sRes, entry] of resvMap.entries()) {
                if (!entry.CreatedByUser) {
                  const sResClean = sRes.replace(/^0+/, '');
                  const sResPadded = sRes.padStart(10, '0');
                  entry.CreatedByUser = userMap.get(sRes) || userMap.get(sResClean) || userMap.get(sResPadded) || '';
                }
              }
            }
          } catch (uErr) {
            LOG.warn(`Could not enrich reservation user headers: ${uErr.message}`);
          }
        }

        // Transfers (301/311): receiving plant / storage location from the reservation header
        if (/\b(301|311)\b/.test(String(movementType || ''))) {
          try {
            const recvMap = await this._fetchReservationHeaderReceiving(movementType, sResv);
            for (const [sRes, entry] of resvMap.entries()) {
              Object.assign(entry, recvMap.get(sRes.replace(/^0+/, '')));
            }
          } catch (rErr) {
            LOG.warn(`Could not read receiving plant / storage location from reservation headers: ${rErr.message}`);
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

      // In SAP S/4HANA, CostCenter and the receiving plant / storage location of a transfer are
      // stored at the reservation header level (UI_RESERVATION_HDR_MNG_V2), not on the item.
      let sHeaderCostCenter = '';
      let sHeaderRecvPlant = '';
      let sHeaderRecvSLoc = '';
      const isTransfer = (r) => r.GoodsMovementType === '301' || r.GoodsMovementType === '311';
      const needsHeader = results.some(r => r.GoodsMovementType === '201' || isTransfer(r));
      if (needsHeader && rawReserv) {
        try {
          const sResClean = String(rawReserv).trim().replace(/^0+/, '');
          const hdr = await this._get(
            `/sap/opu/odata/sap/UI_RESERVATION_HDR_MNG_V2/C_ReservationDocTP_F4839(Reservation='${sResClean}',IsActiveEntity=true)`,
            '$select=CostCenter,IssuingOrReceivingPlant,IssuingOrReceivingStorageLoc'
          );
          if (hdr && hdr.CostCenter) {
            sHeaderCostCenter = String(hdr.CostCenter).trim().replace(/^0+/, '');
          }
          sHeaderRecvPlant = String((hdr && hdr.IssuingOrReceivingPlant) || '').trim();
          sHeaderRecvSLoc = String((hdr && hdr.IssuingOrReceivingStorageLoc) || '').trim();
        } catch (hdrErr) {
          LOG.warn(`Could not fetch CostCenter / receiving location from UI_RESERVATION_HDR_MNG_V2 for reservation ${rawReserv}: ${hdrErr.message}`);
        }
      }

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

      // Serial number profile (MARC-SERNP), read once per material/plant. Unreadable -> false: the
      // screen then asks for no serials and SAP itself rejects a serial-managed posting without them.
      const serialFlags = new Map();
      const isSerialManagedFn = (mat, plant) => {
        if (!(this.adapter && typeof this.adapter.isSerialManaged === 'function')) return false;
        const key = `${mat}|${plant}`;
        if (!serialFlags.has(key)) {
          serialFlags.set(key, Promise.resolve().then(() => this.adapter.isSerialManaged(mat, plant)).catch((err) => {
            LOG.warn(`Could not read the serial number profile of material ${mat} in plant ${plant}: ${err.message}`);
            return false;
          }));
        }
        return serialFlags.get(key);
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
          // 301/311: receiving side of the transfer (field name differs between SAP service versions)
          ReceivingPlant: r.IssuingOrReceivingPlant || r.ReceivingPlant || (isTransfer(r) ? sHeaderRecvPlant : ''),
          ReceivingStorageLocation: r.IssuingOrReceivingStorageLoc || r.ReceivingStorageLocation || (isTransfer(r) ? sHeaderRecvSLoc : ''),
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
          CostCenter: r.CostCenter || (r.GoodsMovementType === '201' ? sHeaderCostCenter : ''),
          IsSerialManaged: Boolean(await isSerialManagedFn(r.Product, r.Plant)),
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
