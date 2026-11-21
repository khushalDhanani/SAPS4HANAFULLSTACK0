const s4Config = require('../s4Config');

const GR_MOVEMENT_TYPE = '101';

/**
 * The SAP document a receipt request is posted against, whichever request field names it:
 * { document, source: 'INBDELIV' (inbound delivery) | 'PURORD' (purchase order), item }.
 * The poster and the plant authorization both use this, so they cannot disagree about the target.
 */
function receiptTarget(payload = {}) {
  const { DeliveryDocument, PurchaseOrder, StorageUnit } = payload;
  const document = String(DeliveryDocument || PurchaseOrder || StorageUnit || '').trim();
  const isPurchaseOrder = PurchaseOrder && !DeliveryDocument && document === String(PurchaseOrder).trim();
  return {
    document,
    source: payload.SourceOfGR || (isPurchaseOrder ? 'PURORD' : 'INBDELIV'),
    item: String(payload.DeliveryDocumentItem || payload.PurchaseOrderItem || '').trim()
  };
}

async function postGoodsReceipt(adapter, payload = {}, options = {}) {
  const {
    StorageUnit,
    DeliveryDocument,
    PurchaseOrder,
    Material,
    Plant,
    StorageLocation,
    Batch,
    Quantity,
    ExpiryDate
  } = payload;

  if (!StorageUnit && !DeliveryDocument && !PurchaseOrder) {
    throw new Error('Inbound Delivery or Purchase Order is required to post Goods Receipt.');
  }
  if (!Material) {
    throw new Error('Material is required to post Goods Receipt.');
  }
  if (!Plant) {
    throw new Error('Plant is required to post Goods Receipt.');
  }
  if (!StorageLocation) {
    throw new Error('Storage Location is required to post Goods Receipt.');
  }
  const nQty = Number(Quantity);
  if (isNaN(nQty) || nQty <= 0) {
    throw new Error('Quantity must be a positive number.');
  }

  // HARD-STOP: Verify SLED expiration
  if (ExpiryDate) {
    const status = adapter._enrichBatchStatus(ExpiryDate);
    if (status.StatusState === 'Error' || status.StatusText === 'EXPIRED') {
      throw new Error(
        `Expired Batch Blocked: Batch '${Batch}' expired on ${ExpiryDate} (SLED exceeded). Goods Receipt for expired materials is strictly prohibited by quality control rules.`
      );
    }
  }

  // Retargeted to MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers (Inventory Management / Movement 101)
  const { document: sDoc, source: sourceOfGR } = receiptTarget(payload);
  const now = new Date();
  const todayFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00`;
  const tempKey = `${sDoc}GR${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

  const rawItemNo = payload.DeliveryDocumentItem || payload.PurchaseOrderItem;
  if (!rawItemNo && (!Array.isArray(payload.Items) || payload.Items.length === 0)) {
    throw new Error('Delivery Document Item (or Purchase Order Item) is required to post Goods Receipt.');
  }
  const sItemNo = rawItemNo ? String(rawItemNo).padStart(6, '0') : '';

  let items = [];
  if (Array.isArray(payload.Items) && payload.Items.length > 0) {
    items = payload.Items.map((it, idx) => {
      const itemUnit = it.Unit || it.EntryUnit || it.UnitOfMeasure || payload.Unit || payload.EntryUnit || payload.UnitOfMeasure;
      if (!itemUnit || !String(itemUnit).trim()) {
        throw new Error(`Unit of Measure (EntryUnit) is required for Goods Receipt item ${it.DeliveryDocumentItem || idx + 1}`);
      }
      const itItemNo = it.DeliveryDocumentItem || it.PurchaseOrderItem || rawItemNo;
      if (!itItemNo || !String(itItemNo).trim()) {
        throw new Error(`Delivery Document Item is required for Goods Receipt item ${idx + 1}`);
      }
      const cleanUnit = String(itemUnit).trim().toUpperCase();
      return {
        InboundDelivery: sDoc,
        DeliveryDocumentItem: String(itItemNo).padStart(6, '0'),
        SourceOfGR: sourceOfGR,
        Material: it.Material || Material,
        Plant: it.Plant || Plant,
        StorageLocation: it.StorageLocation || StorageLocation,
        Batch: it.Batch || Batch || '',
        QuantityInEntryUnit: String(it.Quantity || nQty),
        EntryUnit: cleanUnit,
        OpenQuantity: String(it.Quantity || nQty),
        UnitOfMeasure: cleanUnit,
        GoodsMovementType: it.GoodsMovementType || payload.GoodsMovementType || GR_MOVEMENT_TYPE,
        GoodsMovementReasonCode: it.GoodsMovementReasonCode || payload.GoodsMovementReasonCode || '',
        DocumentItemText: it.DocumentItemText || ''
      };
    });
  } else {
    const itemUnit = payload.Unit || payload.EntryUnit || payload.UnitOfMeasure;
    if (!itemUnit || !String(itemUnit).trim()) {
      throw new Error('Unit of Measure (EntryUnit) is required for Goods Receipt');
    }
    const cleanUnit = String(itemUnit).trim().toUpperCase();
    items = [
      {
        InboundDelivery: sDoc,
        DeliveryDocumentItem: sItemNo,
        SourceOfGR: sourceOfGR,
        Material: Material,
        Plant: Plant,
        StorageLocation: StorageLocation,
        Batch: Batch || '',
        QuantityInEntryUnit: String(nQty),
        EntryUnit: cleanUnit,
        OpenQuantity: String(nQty),
        UnitOfMeasure: cleanUnit,
        GoodsMovementType: payload.GoodsMovementType || GR_MOVEMENT_TYPE,
        GoodsMovementReasonCode: payload.GoodsMovementReasonCode || '',
        DocumentItemText: payload.DocumentItemText || ''
      }
    ];
  }

  const postPayload = {
    InboundDelivery: sDoc,
    SourceOfGR: sourceOfGR,
    DocumentDate: todayFormatted,
    PostingDate: todayFormatted,
    DeliveryDocumentByVendor: payload.DeliveryDocumentByVendor || '',
    BillOfLading: payload.BillOfLading || '',
    MaterialDocumentHeaderText: payload.MaterialDocumentHeaderText || `GR Delivery ${sDoc}`,
    Temp_Key: tempKey,
    VersionForPrintingSlip: payload.VersionForPrintingSlip || '0',
    Header2Items: items
  };

  try {
    const path = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers';
    const ifMatch = options?.ifMatch || options?.etag ||
      options?.headers?.['If-Match'] || options?.headers?.['if-match'] ||
      options?.req?.headers?.['If-Match'] || options?.req?.headers?.['if-match'] ||
      options?._?.req?.headers?.['If-Match'] || options?._?.req?.headers?.['if-match'] ||
      options?.data?.ETag || options?.data?.etag;
    const customHeaders = ifMatch ? { ...(options?.headers || {}), 'If-Match': ifMatch } : (options?.headers || {});
    const result = await adapter._post(path, postPayload, customHeaders);

    // Check sap-message response header for business errors or posted document text
    const rawSapMsg = result?._headers?.['sap-message'];
    let sapMsgObj = null;
    if (rawSapMsg) {
      try {
        sapMsgObj = JSON.parse(rawSapMsg);
      } catch (_) {}
    }

    if (sapMsgObj && sapMsgObj.severity === 'error') {
      throw Object.assign(new Error(sapMsgObj.message || 'SAP S/4HANA rejected Goods Receipt posting'), { status: 422 });
    }

    let matDoc = result?.MaterialDocument;
    if (!matDoc && result?.Header2Refs) {
      const refs = Array.isArray(result.Header2Refs?.results)
        ? result.Header2Refs.results
        : (Array.isArray(result.Header2Refs) ? result.Header2Refs : []);
      const docRef = refs.find(r => r.DocNo && /^\d+$/.test(r.DocNo));
      if (docRef) {
        matDoc = docRef.DocNo;
      }
    }
    if (!matDoc && sapMsgObj?.message) {
      const match = sapMsgObj.message.match(/Material document\s+(\d+)/i);
      if (match) {
        matDoc = match[1];
      }
    }

    if (!matDoc) {
      const errDetail = sapMsgObj?.message || 'SAP did not generate or return a material document number.';
      throw new Error(errDetail);
    }

    return {
      Success: true,
      Message: `Goods Receipt posted successfully in SAP for Delivery ${sDoc} (Material Document ${matDoc})`,
      DeliveryDocument: sDoc,
      MaterialDocument: matDoc
    };
  } catch (err) {
    // Per AGENTS.md: Stop implementation and report exactly what SAP capability is missing / failing.
    // Mock persistence and dummy document generation are strictly prohibited.
    const errorMsg = err.message || JSON.stringify(err);
    const status = err.status || err.statusCode;
    // Only an explicit SAP 4xx, or SAP never reached (503), proves nothing was posted.
    const definite = (status >= 400 && status < 500) || status === 503;
    throw Object.assign(new Error(
      `SAP S/4HANA Backend Posting Capability Error: Posting Goods Receipt for Inbound Delivery '${sDoc}' via MMIM_GR4PO_DL_SRV failed in SAP Gateway (Client ${s4Config.getClient()}): ${errorMsg}. In accordance with AGENTS.md, mock persistence and synthetic document generation are strictly prohibited.`
    ), { status, statusCode: status, outcomeUnknown: !definite });
  }
}

module.exports = {
  receiptTarget,
  postGoodsReceipt,
  GR_MOVEMENT_TYPE
};
