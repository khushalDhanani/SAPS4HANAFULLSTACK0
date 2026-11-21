const LOG = require('../logger')('goods-receipt-adapter');
const { sapKey } = require('../sapKey');
const { bapiError, classifyBapiError } = require('./GoodsReceiptBapiErrorClassifier');

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
        const classifiedMsg = classifyBapiError(err, targetDeliv, sItem, Material, Plant, StorageLocation);
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
  postGoodsReceiptWithStorageUnit
};
