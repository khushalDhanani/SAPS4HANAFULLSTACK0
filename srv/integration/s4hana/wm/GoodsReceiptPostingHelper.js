const LOG = require('../logger')('goods-receipt-adapter');
const s4Config = require('../s4Config');
const { sapKey } = require('../sapKey');

const GR_MOVEMENT_TYPE = '101';

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
    const sDoc = DeliveryDocument || PurchaseOrder || StorageUnit;
    const now = new Date();
    const todayFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00`;
    const tempKey = `${sDoc}GR${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

    // Determine SourceOfGR: 'INBDELIV' (Inbound Delivery) or 'PURORD' (Purchase Order)
    let sourceOfGR = payload.SourceOfGR;
    if (!sourceOfGR) {
      if (payload.PurchaseOrder && !payload.DeliveryDocument && String(sDoc) === String(payload.PurchaseOrder)) {
        sourceOfGR = 'PURORD';
      } else {
        sourceOfGR = 'INBDELIV';
      }
    }

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

  /**
   * 101 documents of a delivery item, newest first. RFC_READ_TABLE returns rows in no fixed order and can
   * repeat a document, so the last row is not the latest document.
   */
async function _read101Docs(adapter, delivery, item, extraWhere = []) {
    const vbeln = sapKey(delivery, 'vbeln').padStart(10, '0');
    const posnr = sapKey(item, 'posnr').padStart(6, '0');
    const rows = await adapter.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART'], [
      `VBELN_IM = '${vbeln}'`, `AND VBELP_IM = '${posnr}'`, `AND BWART = '101'`, ...extraWhere
    ]);
    const unique = new Map((rows || []).map((r) => [`${r.MJAHR}/${r.MBLNR}`, r]));
    return [...unique.keys()].sort().reverse().map((key) => unique.get(key));
  }

  /**
   * The 101 document that may belong to a receipt attempt whose outcome is unknown, or null.
   * shortcut: a same-day partial receipt also matches, so the attempt may name the wrong document; it never
   * allows a double post, because a match only ends the block. Store a pre-post baseline on the attempt to be exact.
   * Searches from the day before the attempt because SAP's date can be behind the UTC date in createdAt.
   */
async function findReceiptForAttempt(adapter, attempt) {
    const from = new Date(new Date(attempt.createdAt).getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    const [latest] = await adapter._read101Docs(attempt.ReservationNo, attempt.ReservationItem, [`AND CPUDT >= '${from}'`]);
    return latest ? { MaterialDocument: latest.MBLNR, MaterialDocumentYear: latest.MJAHR } : null;
  }

  /**
   * Executes Goods Receipt posting against Storage Unit / Inbound Delivery via BAPI_INB_DELIVERY_CONFIRM_DEC.
   * In strict accordance with AGENTS.md:
   * - Proves real SAP transaction (BAPI_INB_DELIVERY_CONFIRM_DEC in one LUW with BAPI_TRANSACTION_COMMIT)
   * - Immediately reads back persisted Material Document from MATDOC / EKBE
   * - NO mock persistence, NO synthetic document generation
   */
async function postGoodsReceiptWithStorageUnit(adapter, payload = {}) {
    const {
      StorageUnit,
      DeliveryDocument,
      DeliveryDocumentItem,
      Material,
      Plant,
      StorageLocation,
      Batch,
      Quantity,
      Unit,
      PackagingMaterial,
      ExpiryDate,
      Simulate
    } = payload;

    if (!StorageUnit && !DeliveryDocument) {
      throw new Error('Storage Unit or Delivery Document is required to post Goods Receipt.');
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
    const sUnit = (Unit || '').trim().toUpperCase();
    if (!sUnit) {
      throw new Error('Unit of Measure is required for Goods Receipt.');
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

    const sDeliv = DeliveryDocument ? sapKey(DeliveryDocument, 'vbeln').padStart(10, '0') : '';
    const sItem = DeliveryDocumentItem ? sapKey(DeliveryDocumentItem, 'posnr').padStart(6, '0') : '000010';
    const sSU = StorageUnit ? String(StorageUnit).trim() : '';
    const sMat = (/^\d+$/.test(Material) && Material.length < 18) ? Material.padStart(18, '0') : Material;
    const isSimulate = !!Simulate;

    let targetDeliv = sDeliv;
    let huHeaders = [];
    let huItems = [];

    // Distinguish real Storage Unit from Inbound Delivery number passed in StorageUnit field
    const isDelivMatch = sSU && targetDeliv && (
      sSU === targetDeliv ||
      sSU.replace(/^0+/, '') === targetDeliv.replace(/^0+/, '')
    );
    const cleanSU = isDelivMatch ? '' : sSU;
    const sSUPadded = (/^\d+$/.test(cleanSU) && cleanSU.length < 20) ? cleanSU.padStart(20, '0') : cleanSU;

    if (!targetDeliv) {
      throw new Error(`Inbound Delivery Number could not be resolved for Goods Receipt.`);
    }

    // Pre-check Inbound Delivery status in LIKP to prevent rejected duplicate posts or putaway violations
    if (adapter.rfc && typeof adapter.rfc.readTable === 'function') {
      try {
        const likpRows = await adapter.rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK'], [
          `VBELN = '${targetDeliv}'`
        ]);
        if (likpRows.length > 0) {
          const likp = likpRows[0];
          if (likp.WBSTK === 'C') {
            let existingDoc = '';
            try {
              const [latest] = await adapter._read101Docs(targetDeliv, sItem);
              if (latest) existingDoc = `${latest.MBLNR}/${latest.MJAHR}`;
            } catch (_) {}
            const errMsg = `Delivery already completed: Goods Receipt has already been completely processed for Inbound Delivery '${targetDeliv}' (Status: Completed)${existingDoc ? `. Existing Material Document: ${existingDoc}` : ''}. Duplicate posting is prevented (SAP HUDIALOG 018).`;
            const conflictErr = new Error(errMsg);
            conflictErr.statusCode = 409;
            throw conflictErr;
          }
          if (likp.KOSTK === 'A') {
            const errMsg = `Putaway required: Inbound Delivery '${targetDeliv}' has not yet been put away in the warehouse (Putaway Status KOSTK = 'A'). In SAP Warehouse Management, transfer orders must be created and confirmed for putaway before Goods Receipt can be posted (SAP message VLMOVE 029 / VLA 307).`;
            const putawayErr = new Error(errMsg);
            putawayErr.statusCode = 422;
            throw putawayErr;
          }
        }
      } catch (e) {
        if (e.statusCode === 409 || e.statusCode === 422) throw e;
        LOG.warn(`LIKP pre-check warning: ${e.message}`);
      }
    }

    // Query VEKP/VEPO for exact HU structure and pre-validate status if rfc is available
    if (cleanSU && adapter.rfc && typeof adapter.rfc.readTable === 'function') {
      try {
        const vekpRows = await adapter.rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'STATUS', 'VPOBJ', 'VPOBJKEY'], [
          `EXIDV = '${sSUPadded}' OR EXIDV = '${cleanSU}'`
        ]);
        if (vekpRows.length > 0) {
          const matchedHU = vekpRows[0];
          if (matchedHU.STATUS === '0060') {
            const err = new Error(
              `Storage Unit already received: Storage Unit '${cleanSU}' is already in status '0060' (Goods Receipt Posted) in SAP warehouse. Duplicate posting is prevented.`
            );
            err.statusCode = 409;
            throw err;
          }
          if (!targetDeliv && matchedHU.VPOBJKEY) {
            targetDeliv = String(matchedHU.VPOBJKEY).padStart(10, '0');
          }
          huHeaders = [{
            HDL_UNIT_EXID: matchedHU.EXIDV,
            SHIP_MAT: matchedHU.VHILM || PackagingMaterial || '',
            DELIV_NUMB: targetDeliv
          }];
          huItems = [{
            HDL_UNIT_EXID_INTO: matchedHU.EXIDV,
            DELIV_NUMB: targetDeliv,
            DELIV_ITEM: sItem,
            MATERIAL: sMat,
            BATCH: Batch || '',
            PACK_QTY: String(nQty),
            BASE_UOM: sUnit
          }];
        } else {
          // Explicit Storage Unit was requested but does not exist in VEKP — never invent dummy HUs
          const notFoundErr = new Error(
            `Storage Unit not found: Storage Unit '${cleanSU}' does not exist in SAP warehouse records (VEKP). Please verify the scanned Storage Unit / Handling Unit number.`
          );
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }
      } catch (e) {
        if (e.statusCode === 409 || e.statusCode === 404) throw e;
        LOG.warn(`VEKP lookup warning: ${e.message}`);
      }
    }

    // Unpacked delivery: DLV_QTY without conversion factors fails with VL 268 + VLBAPI 004 (simulated live 2026-11-02).
    let unitFields = {};
    if (huHeaders.length === 0) {
      const facts = await adapter._readDeliveryItemFacts(targetDeliv, sItem);
      if (!facts) {
        throw Object.assign(new Error(`Delivery item ${targetDeliv}/${sItem} could not be read. The Goods Receipt was NOT posted.`), { statusCode: 503, status: 503, $sanitize: false });
      }
      // shortcut: only a full receipt in a 1:1 unit is proven; CHG_DELQTY is not sent here, so SAP would confirm the whole item. Prove partial receipts live before allowing them.
      const refuse = (msg) => Object.assign(new Error(`${msg} The Goods Receipt was NOT posted.`), { statusCode: 422, status: 422 });
      if (Math.abs(nQty - facts.DeliveryQuantity) > 0.0005) {
        throw refuse(`Partial receipt is not supported for an unpacked delivery: enter the full quantity ${facts.DeliveryQuantity} ${facts.Unit}.`);
      }
      if (sUnit !== facts.Unit || facts.Unit !== facts.BaseUnit || facts.FactorNumerator !== facts.FactorDenominator || !(facts.FactorDenominator > 0)) {
        throw refuse(`Unit ${sUnit} cannot be posted for delivery item ${targetDeliv}/${sItem} (delivery unit ${facts.Unit}, base unit ${facts.BaseUnit}, factor ${facts.FactorNumerator}:${facts.FactorDenominator}).`);
      }
      unitFields = {
        SALES_UNIT: facts.Unit,
        BASE_UOM: facts.BaseUnit,
        FACT_UNIT_NOM: String(facts.FactorNumerator),
        FACT_UNIT_DENOM: String(facts.FactorDenominator)
      };
    }

    const bapiError = (ret) => [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));

    // Documents that exist before posting: only a document outside this set belongs to this receipt.
    const docKey = (r) => `${r.MJAHR}/${r.MBLNR}`;
    let knownDocs = new Set();
    if (!isSimulate) {
      try {
        knownDocs = new Set((await adapter._read101Docs(targetDeliv, sItem)).map(docKey));
      } catch (e) {
        throw Object.assign(new Error(`Existing material documents of Inbound Delivery '${targetDeliv}' could not be read (${e.message}). The Goods Receipt was NOT posted.`), { statusCode: 503, status: 503, $sanitize: false });
      }
    }

    let bapiResult = null;
    try {
      await adapter.rfc.session(async (call) => {
      const itemControl = {
        DELIV_NUMB: targetDeliv,
        DELIV_ITEM: sItem
      };
      if (huHeaders.length > 0) {
        itemControl.CHG_DELQTY = 'X';
      }

      const confirmParams = {
        HEADER_DATA: { DELIV_NUMB: targetDeliv },
        HEADER_CONTROL: {
          DELIV_NUMB: targetDeliv,
          POST_GI_FLG: 'X',
          SIMULATE: isSimulate ? 'X' : ''
        },
        ITEM_DATA: [{
          DELIV_NUMB: targetDeliv,
          DELIV_ITEM: sItem,
          DLV_QTY: String(nQty),
          DLV_QTY_IMUNIT: String(nQty),
          ...unitFields
        }],
        ITEM_CONTROL: [itemControl]
      };
      if (huHeaders.length > 0) {
        confirmParams.HANDLING_UNIT_HEADER = huHeaders;
      }
      if (huItems.length > 0) {
        confirmParams.HANDLING_UNIT_ITEM = huItems;
      }

      bapiResult = await call('BAPI_INB_DELIVERY_CONFIRM_DEC', confirmParams);
      const err = bapiError(bapiResult && bapiResult.RETURN);
      if (err) {
        let classifiedMsg = `SAP rejected Goods Receipt: [${err.ID} ${err.NUMBER}] ${err.MESSAGE}`;
        if (err.ID === 'HUDIALOG' && err.NUMBER === '018') {
          classifiedMsg = `Delivery status constraint: Inbound Delivery '${targetDeliv}' only allows display mode because Goods Receipt has already been completed (SAP message HUDIALOG 018).`;
        } else if (err.ID === 'VLBAPI' && err.NUMBER === '004') {
          classifiedMsg = `Quantity consistency check failed: The quantity for Inbound Delivery '${targetDeliv}' item '${sItem}' is inconsistent with putaway or packing status (SAP message VLBAPI 004).`;
        } else if (err.ID === 'VLMOVE' && err.NUMBER === '029') {
          classifiedMsg = `Putaway required: Inbound Delivery '${targetDeliv}' has not yet been put away in the warehouse (SAP message VLMOVE 029).`;
        } else if (err.ID === 'VL' && err.NUMBER === '608') {
          classifiedMsg = `Warehouse processing incomplete: Inbound Delivery '${targetDeliv}' has not yet been completely processed by WM (SAP message VL 608).`;
        } else if (err.ID === '12' && err.NUMBER === '008') {
          classifiedMsg = `Shelf life expiration date constraint: Material shelf life / expiration check failed (${err.MESSAGE || 'SLED validation failed'}, SAP message 12 008).`;
        } else if (err.ID === 'M7' && err.NUMBER === '006') {
          classifiedMsg = `Master data constraint: Material '${err.MESSAGE_V1 || Material}' is not maintained in plant '${err.MESSAGE_V2 || Plant}' storage location '${err.MESSAGE_V3 || StorageLocation}' (SAP message M7 006).`;
        } else if (err.ID === 'VLA' && err.NUMBER === '307') {
          classifiedMsg = `Putaway constraint: Putaway quantity cannot be less than GR posted quantity (SAP message VLA 307).`;
        } else if (err.ID === 'VLA' && err.NUMBER === '311') {
          classifiedMsg = `Packing constraint: Packing can only be updated via inbound delivery dialog (SAP message VLA 311).`;
        } else if (err.ID === 'VLA' && err.NUMBER === '317') {
          classifiedMsg = `Batch constraint: Batch must be assigned to delivery item (SAP message VLA 317).`;
        } else if (err.ID === 'BS' && err.NUMBER === '013') {
          classifiedMsg = `Serial number status constraint: Equipment status active (SAP message BS 013).`;
        } else if (err.ID === 'IO' && err.NUMBER === '206') {
          classifiedMsg = `Serial number constraint: Serial numbers required for material (SAP message IO 206).`;
        } else if (err.ID === 'M7' && err.NUMBER === '021') {
          classifiedMsg = `Quantity deficit: Stock / purchase order deficit (SAP message M7 021).`;
        }
        const bapiErr = new Error(classifiedMsg);
        bapiErr.bapiReturn = bapiResult.RETURN;
        bapiErr.statusCode = 422;
        throw bapiErr;
      }

      if (!isSimulate) {
        const commitRes = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        const commitErr = bapiError(commitRes && commitRes.RETURN);
        if (commitErr) {
          throw new Error(`BAPI_TRANSACTION_COMMIT failed: ${commitErr.MESSAGE}`);
        }
      }
      });
    } catch (e) {
      // A BAPI error return is a definite refusal and 503 means SAP was never reached; anything else may have posted.
      if (!e.bapiReturn && e.status !== 503) e.outcomeUnknown = !isSimulate;
      throw e;
    }

    if (isSimulate) {
      return {
        Success: true,
        Message: `Goods Receipt simulated successfully in SAP for ${cleanSU ? 'Storage Unit ' + cleanSU : 'Inbound Delivery ' + targetDeliv} (0 errors)`,
        DeliveryDocument: targetDeliv,
        StorageUnit: cleanSU,
        Quantity: nQty,
        Unit: sUnit
      };
    }

    // Read back persisted material document immediately from SAP
    let newDoc;
    try {
      newDoc = (await adapter._read101Docs(targetDeliv, sItem)).find((r) => !knownDocs.has(docKey(r)));
    } catch (readErr) {
      LOG.warn(`Immediate read-back table query warning: ${readErr.message}`);
    }

    if (!newDoc) {
      throw Object.assign(
        new Error(`SAP S/4HANA executed BAPI_INB_DELIVERY_CONFIRM_DEC but no new Material Document was found in MATDOC for Delivery ${targetDeliv}. In accordance with AGENTS.md, mock persistence is strictly prohibited.`),
        { statusCode: 504, status: 504, outcomeUnknown: true }
      );
    }
    const matDoc = newDoc.MBLNR;
    const matDocYear = newDoc.MJAHR;

    return {
      Success: true,
      Message: `Goods Receipt posted successfully in SAP for ${cleanSU ? 'Storage Unit ' + cleanSU : 'Inbound Delivery ' + targetDeliv} (Material Document ${matDoc})`,
      MaterialDocument: matDoc,
      MaterialDocumentYear: matDocYear,
      DeliveryDocument: targetDeliv,
      StorageUnit: cleanSU,
      Quantity: nQty,
      Unit: sUnit
    };
  }


module.exports = {
  postGoodsReceipt,
  _read101Docs,
  findReceiptForAttempt,
  postGoodsReceiptWithStorageUnit,
  GR_MOVEMENT_TYPE
};
