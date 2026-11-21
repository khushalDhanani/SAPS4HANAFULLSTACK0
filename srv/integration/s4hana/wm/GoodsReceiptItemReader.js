const LOG = require('../logger')('goods-receipt-adapter');
const { sapKey } = require('../sapKey');

const toNum = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);

class GoodsReceiptItemReader {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get rfc() {
    return this.adapter?.rfc;
  }

  /**
   * Delivery item facts from LIPS/LIKP (read-only RFC_READ_TABLE): the authoritative quantity, unit, storage
   * location, batch, warehouse number/bin, goods movement status and delivery date of an inbound delivery item.
   * Returns null when RFC is unavailable or the item does not exist.
   */
  async _readDeliveryItemFacts(deliveryDocument, deliveryItem) {
    if (!this.rfc || typeof this.rfc.readTable !== 'function') return null;
    const vbeln = sapKey(deliveryDocument, 'vbeln').padStart(10, '0');
    const posnr = sapKey(deliveryItem, 'posnr').padStart(6, '0');
    try {
      const rows = await this.rfc.readTable('LIPS', ['VBELN', 'POSNR', 'WERKS', 'LGORT', 'CHARG', 'LFIMG', 'MEINS', 'VRKME', 'UMVKZ', 'UMVKN', 'LGNUM', 'LGPLA', 'WBSTA'], [
        `VBELN = '${vbeln}' AND POSNR = '${posnr}'`
      ]);
      if (!rows.length) return null;
      const li = rows[0];
      const likp = await this.rfc.readTable('LIKP', ['VBELN', 'LFDAT'], [`VBELN = '${vbeln}'`]);
      const lfdat = (likp[0] && likp[0].LFDAT) || '';
      return {
        Plant: li.WERKS || '',
        StorageLocation: li.LGORT || '',
        Batch: li.CHARG || '',
        DeliveryQuantity: toNum(li.LFIMG),
        Unit: li.VRKME || li.MEINS || '',
        BaseUnit: li.MEINS || '',
        FactorNumerator: toNum(li.UMVKZ),
        FactorDenominator: toNum(li.UMVKN),
        WarehouseNumber: li.LGNUM || '',
        WarehouseStorageBin: li.LGPLA || '',
        GoodsMovementStatus: li.WBSTA || '',
        DeliveryDate: /^\d{8}$/.test(lfdat) && lfdat !== '00000000' ? `${lfdat.slice(0, 4)}-${lfdat.slice(4, 6)}-${lfdat.slice(6, 8)}` : ''
      };
    } catch (err) {
      if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) throw err;
      LOG.warn(`Delivery item read (LIPS/LIKP) failed for ${vbeln}/${deliveryItem}: ${err.message}`);
      return null;
    }
  }

  /** The plant SAP holds for an inbound delivery item; '' when it cannot be read. */
  async readDeliveryPlant(deliveryDocument, deliveryItem) {
    const facts = await this._readDeliveryItemFacts(deliveryDocument, deliveryItem);
    return facts ? facts.Plant : '';
  }

  /**
   * The plant SAP holds for a purchase order item, read from MMIM_GR4PO_DL_SRV (GR4PO_DL_Headers/Header2Items,
   * entity GR4PO_DL_Item, property Plant: docs/sap-metadata-reference/MMIM_GR4PO_DL_SRV.edmx). '' when the item
   * is not among the order's open receipt items. Only the exact item counts: no fallback to another item.
   */
  async readPurchaseOrderItemPlant(purchaseOrder, purchaseOrderItem) {
    const order = String(purchaseOrder || '').trim();
    const item = String(purchaseOrderItem || '').trim().replace(/^0+(?=.)/, '');
    if (!/^[A-Za-z0-9]{1,12}$/.test(order) || !/^[0-9]{1,6}$/.test(item)) return '';
    const res = await this.adapter._get(
      `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers(InboundDelivery='${order}',SourceOfGR='PURORD')/Header2Items`, '$format=json');
    const items = Array.isArray(res) ? res : (res?.results ? res.results : (res ? [res] : []));
    const match = items.find((i) => String(i.DeliveryDocumentItem || '').trim().replace(/^0+(?=.)/, '') === item);
    return match ? String(match.Plant || '').trim() : '';
  }

  /**
   * Retrieves authentic Goods Receipt item data (OpenQuantity, OrderedQuantity, UnitOfMeasure, EntryUnit, etc.)
   * from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items and GR4PO_DL_Headers, completed with the delivery item itself (LIPS/LIKP).
   * Eliminates hardcoded quantities in strict compliance with AGENTS.md.
   */
  async getGoodsReceiptItem(deliveryDocument = '', deliveryItem = '', purchaseOrder = '', purchaseOrderItem = '') {
    // 1. Inbound Delivery: GR4PO_DL_Items key lookup (SourceOfGR='INBDELIV') + LIPS/LIKP facts.
    //    Live finding (180000006): the OData item comes back as an empty shell (no material, no unit, 0.000 quantities),
    //    so the delivery item in LIPS is the source for SLoc, batch, quantity, unit and WM data.
    if (deliveryDocument) {
      const delivDoc = String(deliveryDocument).trim();
      const sItem = deliveryItem ? String(deliveryItem).padStart(6, '0') : '000010';
      let odata = null;
      try {
        const itemKey = `InboundDelivery='${delivDoc}',DeliveryDocumentItem='${sItem}',SourceOfGR='INBDELIV',AccountAssignmentNumber='',ReferenceLineID=''`;
        const res = await this.adapter._get(
          `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Items(${itemKey})`,
          '$format=json'
        );
        odata = (Array.isArray(res) ? res[0] : res) || null;
      } catch (err) {
        if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) {
          throw err;
        }
        LOG.warn(`Goods receipt item lookup failed for delivery ${delivDoc}: ${err.message}`);
      }
      const facts = await this._readDeliveryItemFacts(delivDoc, sItem);
      const it = odata || {};
      const openQty = toNum(it.OpenQuantity);
      const ordQty = toNum(it.OrderedQuantity);
      const entryQty = toNum(it.QuantityInEntryUnit);
      const odataUnit = it.UnitOfMeasure || it.EntryUnit || it.OrderedQuantityUnit || '';
      const hasODataItem = (openQty !== null && openQty > 0) || (ordQty !== null && ordQty > 0) || !!(odataUnit && odataUnit.trim());
      if (hasODataItem || facts) {
        const unit = odataUnit || (facts && facts.Unit) || '';
        // ponytail: a partially received item (status B) is not netted against EKBE; open = delivery quantity until status C.
        let open = openQty;
        if (!(openQty !== null && openQty > 0) && facts) {
          open = facts.GoodsMovementStatus === 'C' ? 0 : facts.DeliveryQuantity;
        }
        return {
          SourceOfGR: 'INBDELIV',
          InboundDelivery: it.InboundDelivery || delivDoc,
          DeliveryDocumentItem: it.DeliveryDocumentItem || sItem,
          OpenQuantity: open,
          OrderedQuantity: ordQty,
          QuantityInEntryUnit: entryQty,
          Unit: unit ? unit.trim().toUpperCase() : '',
          StorageLocation: it.StorageLocation || (facts && facts.StorageLocation) || '',
          StorageLocationName: it.StorageLocationName || '',
          WarehouseStorageBin: it.WarehouseStorageBin || (facts && facts.WarehouseStorageBin) || '',
          WarehouseNumber: (facts && facts.WarehouseNumber) || '',
          Batch: it.Batch || (facts && facts.Batch) || '',
          DeliveryQuantity: facts ? facts.DeliveryQuantity : null,
          DeliveryDate: (facts && facts.DeliveryDate) || '',
          GoodsMovementStatus: (facts && facts.GoodsMovementStatus) || '',
          Material: it.Material || '',
          MaterialName: it.MaterialName || it.PurchaseOrderItemText || '',
          Plant: it.Plant || '',
          PlantName: it.PlantName || ''
        };
      }
    }

    // 2. Try Purchase Order via Header2Items navigation and GR4PO_DL_Items key lookup (SourceOfGR='PURORD')
    if (purchaseOrder) {
      const poDoc = String(purchaseOrder).trim();
      const sPoItem = purchaseOrderItem ? String(purchaseOrderItem).trim() : '';

      // 2a. Query GR4PO_DL_Headers(...)/Header2Items which returns all open PO items
      try {
        const headerNav = `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers(InboundDelivery='${poDoc}',SourceOfGR='PURORD')/Header2Items`;
        const resNav = await this.adapter._get(headerNav, '$format=json');
        const items = Array.isArray(resNav) ? resNav : (resNav?.results ? resNav.results : (resNav ? [resNav] : []));
        if (items.length > 0) {
          let matched = null;
          if (sPoItem) {
            matched = items.find(i =>
              i.DeliveryDocumentItem === sPoItem ||
              i.DeliveryDocumentItem === sPoItem.padStart(5, '0') ||
              i.DeliveryDocumentItem === sPoItem.padStart(6, '0')
            );
          }
          if (!matched) {
            matched = items.find(i => Number(i.OpenQuantity) > 0) || items[0];
          }
          if (matched) {
            const openQty = (matched.OpenQuantity !== undefined && matched.OpenQuantity !== null && matched.OpenQuantity !== '') ? Number(matched.OpenQuantity) : null;
            const ordQty = (matched.OrderedQuantity !== undefined && matched.OrderedQuantity !== null && matched.OrderedQuantity !== '') ? Number(matched.OrderedQuantity) : null;
            const entryQty = (matched.QuantityInEntryUnit !== undefined && matched.QuantityInEntryUnit !== null && matched.QuantityInEntryUnit !== '') ? Number(matched.QuantityInEntryUnit) : null;
            const unit = matched.UnitOfMeasure || matched.EntryUnit || matched.OrderedQuantityUnit || '';
            return {
              SourceOfGR: 'PURORD',
              InboundDelivery: matched.InboundDelivery || poDoc,
              DeliveryDocumentItem: matched.DeliveryDocumentItem || sPoItem,
              OpenQuantity: openQty !== null && !isNaN(openQty) ? openQty : null,
              OrderedQuantity: ordQty !== null && !isNaN(ordQty) ? ordQty : null,
              QuantityInEntryUnit: entryQty !== null && !isNaN(entryQty) ? entryQty : null,
              Unit: unit ? unit.trim().toUpperCase() : '',
              StorageLocation: matched.StorageLocation || '',
              StorageLocationName: matched.StorageLocationName || '',
              WarehouseStorageBin: matched.WarehouseStorageBin || '',
              Batch: matched.Batch || '',
              Material: matched.Material || '',
              MaterialName: matched.MaterialName || matched.PurchaseOrderItemText || '',
              Plant: matched.Plant || '',
              PlantName: matched.PlantName || ''
            };
          }
        }
      } catch (err) {
        if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) {
          throw err;
        }
        LOG.warn(`Header2Items query failed for PO ${poDoc}: ${err.message}`);
      }

      // 2b. Query GR4PO_DL_Items by key for PO
      const candItems = sPoItem ? [sPoItem.padStart(5, '0'), sPoItem.padStart(6, '0')] : ['00010', '000010'];
      for (const cand of candItems) {
        try {
          const itemKey = `InboundDelivery='${poDoc}',DeliveryDocumentItem='${cand}',SourceOfGR='PURORD',AccountAssignmentNumber='',ReferenceLineID=''`;
          const res = await this.adapter._get(
            `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Items(${itemKey})`,
            '$format=json'
          );
          const it = Array.isArray(res) ? res[0] : res;
          if (it) {
            const openQty = (it.OpenQuantity !== undefined && it.OpenQuantity !== null && it.OpenQuantity !== '') ? Number(it.OpenQuantity) : null;
            const ordQty = (it.OrderedQuantity !== undefined && it.OrderedQuantity !== null && it.OrderedQuantity !== '') ? Number(it.OrderedQuantity) : null;
            const entryQty = (it.QuantityInEntryUnit !== undefined && it.QuantityInEntryUnit !== null && it.QuantityInEntryUnit !== '') ? Number(it.QuantityInEntryUnit) : null;
            const unit = it.UnitOfMeasure || it.EntryUnit || it.OrderedQuantityUnit || '';
            if ((openQty !== null && openQty > 0) || (ordQty !== null && ordQty > 0) || (unit && unit.trim())) {
              return {
                SourceOfGR: 'PURORD',
                InboundDelivery: it.InboundDelivery || poDoc,
                DeliveryDocumentItem: it.DeliveryDocumentItem || cand,
                OpenQuantity: openQty !== null && !isNaN(openQty) ? openQty : null,
                OrderedQuantity: ordQty !== null && !isNaN(ordQty) ? ordQty : null,
                QuantityInEntryUnit: entryQty !== null && !isNaN(entryQty) ? entryQty : null,
                Unit: unit ? unit.trim().toUpperCase() : '',
                StorageLocation: it.StorageLocation || '',
                StorageLocationName: it.StorageLocationName || '',
                WarehouseStorageBin: it.WarehouseStorageBin || '',
                Batch: it.Batch || '',
                Material: it.Material || '',
                MaterialName: it.MaterialName || it.PurchaseOrderItemText || '',
                Plant: it.Plant || '',
                PlantName: it.PlantName || ''
              };
            }
          }
        } catch (err) {
          if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) {
            throw err;
          }
          LOG.warn(`GR4PO_DL_Items query failed for PO ${poDoc} item ${cand}: ${err.message}`);
        }
      }
    }

    return null;
  }
}

module.exports = GoodsReceiptItemReader;
