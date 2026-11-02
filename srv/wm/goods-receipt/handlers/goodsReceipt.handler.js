const cds = require('@sap/cds');
const crypto = require('crypto');
const LOG = require('../../../common/logger')('goods-receipt');
const GoodsReceiptAdapter = require('../../../integration/s4hana/wm/GoodsReceiptAdapter');
const GoodsIssueAttemptStore = require('../../goods-issue/GoodsIssueAttemptStore');
const { extractFilterParam, extractFilterParams, applyPaging, extractIfMatch } = require('../../../common/filterUtils');
// Reuse the type-agnostic WM field-format primitives (plant/sloc/material/batch are the same
// across Goods Issue and Goods Receipt) rather than duplicating the regexes here.
const { checkMaterial, checkPlant, checkStorageLocation, checkBatch } = require('../../goods-issue/validation/common');
const { plantScope, isPlantAllowed } = require('../../reservation-entry/readScope');

/** 403 message when the posting plant is outside the authenticated user's plant scope (Admin: unrestricted), else null. */
function plantScopeError(req, plant) {
    const allowedPlants = plantScope(req.user);
    return isPlantAllowed(plant, allowedPlants) ? null : `Plant ${plant || '(none)'} is outside the authenticated user's plant scope`;
}

const stripZeros = (value) => String(value || '').trim().replace(/^0+(?=.)/, '');

/**
 * Runs one SAP receipt posting under an atomic per-delivery-item claim. An unresolved attempt blocks the item;
 * a posted one does not, so a second partial receipt of the same quantity is still possible.
 * shortcut: ReservationNo holds the delivery, so a reservation with the same number and item is blocked too;
 * the number ranges differ on this system, give receipts their own columns if that changes.
 */
async function postWithAttempt(req, post) {
    const { DeliveryDocument, DeliveryDocumentItem, PurchaseOrderItem, Material, Plant, StorageLocation, Quantity, Unit, Simulate } = req.data;
    // No delivery: the recheck has nothing to look up in SAP, and the screen never posts this way.
    if (Simulate || !DeliveryDocument) return post();

    const delivery = stripZeros(DeliveryDocument);
    const item = stripZeros(DeliveryDocumentItem || PurchaseOrderItem || '10');
    const requestHash = crypto.createHash('sha1').update(`101|${delivery}|${item}`).digest('hex');
    let claim;
    try {
        claim = await GoodsIssueAttemptStore.createOrGet({
            ReferenceDocument: `GR${requestHash.slice(0, 12)}`.toUpperCase(),
            RequestHash: requestHash,
            MovementType: '101',
            ReservationNo: delivery.padStart(10, '0'),
            ReservationItem: item,
            Material,
            Plant,
            StorageLocation,
            IssueQty: Quantity,
            Unit: Unit || '',
            User: req.user?.id || 'anonymous',
            PostingDate: new Date().toISOString().slice(0, 10)
        }, { reclaimableStatuses: ['posted', 'rejected', 'not_posted'] });
    } catch (claimErr) {
        LOG.error('Goods receipt attempt log failed:', claimErr.message);
        throw Object.assign(new Error('The goods receipt posting-attempt log is unavailable; the goods receipt was NOT posted. Check the document list before retrying.'), { status: 503, statusCode: 503 });
    }
    if (!claim.created) {
        throw Object.assign(new Error(`A goods receipt for delivery ${delivery} item ${item} is already in progress or its outcome is not confirmed yet. Refresh and check the document list before retrying.`), { status: 409, statusCode: 409 });
    }

    const ref = claim.row.ReferenceDocument;
    const record = (status, fields) => GoodsIssueAttemptStore.setStatus(ref, status, fields).catch((err) => {
        LOG.error(`Critical reconciliation error: failed to persist attempt status '${status}' for reference ${ref}:`, err.message || err, fields);
    });
    try {
        const result = await post();
        await record('posted', { MaterialDocument: result?.MaterialDocument, MaterialDocYear: result?.MaterialDocumentYear, LastError: '' });
        return result;
    } catch (err) {
        await record(err.outcomeUnknown ? 'unconfirmed' : 'rejected', { LastError: err.message || 'Posting failed' });
        if (!err.outcomeUnknown) throw err;
        throw Object.assign(new Error(`Posting outcome unconfirmed in SAP S/4HANA (${err.message}). The goods receipt may have been posted in SAP. Please do not post again.`), { status: 504, statusCode: 504 });
    }
}

const init = (srv) => {
    /**
     * READ OpenInboundDeliveries
     * Serves live open inbound deliveries from SAP MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet
     */
    srv.on('READ', 'OpenInboundDeliveries', async (req) => {
        try {
            const sPlant = extractFilterParam(req, 'Plant') || '';
            const deliveries = await GoodsReceiptAdapter.getOpenInboundDeliveries(sPlant);
            return applyPaging(deliveries, req);
        } catch (err) {
            LOG.error('READ OpenInboundDeliveries failed:', err.message);
            req.reject(err.status || err.statusCode || 502, err.message || 'Failed to retrieve open inbound deliveries from SAP');
        }
    });

    /**
     * READ MaterialStorageLocations
     * Queries authentic storage locations from MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp
     */
    srv.on('READ', 'MaterialStorageLocations', async (req) => {
        const { Material: sMaterial, Plant: sPlant } = extractFilterParams(req, ['Material', 'Plant']);

        if (!sMaterial && !sPlant) {
            return req.reject(400, 'Plant or Material parameter is required to query storage locations.');
        }

        try {
            const locations = await GoodsReceiptAdapter.getMaterialStorageLocations(sMaterial, sPlant);
            return applyPaging(locations, req);
        } catch (err) {
            req.reject(err.status || err.statusCode || 502, err.message || 'Failed to retrieve storage locations from SAP');
        }
    });

    /**
     * READ MaterialBatches
     * Queries authentic batches and SLED from LO_BM_BATCH_SRV/I_Batch
     */
    srv.on('READ', 'MaterialBatches', async (req) => {
        const { Material: sMaterial, Plant: sPlant, StorageLocation: sStorageLocation } = extractFilterParams(req, ['Material', 'Plant', 'StorageLocation']);

        if (!sMaterial) {
            return req.reject(400, 'Material parameter is required to query batches.');
        }

        try {
            const batches = await GoodsReceiptAdapter.getMaterialBatches(sMaterial, sPlant, sStorageLocation);
            return applyPaging(batches, req);
        } catch (err) {
            req.reject(err.status || err.statusCode || 502, err.message || 'Failed to retrieve batches from SAP');
        }
    });

    /**
     * FUNCTION getStorageUnitDetails
     * Resolves scanned Storage Unit Number into authentic SAP Inbound Delivery, Material, Batch, SLED, and Stock
     */
    srv.on('getStorageUnitDetails', async (req) => {
        const { StorageUnit } = req.data;
        if (!StorageUnit || !String(StorageUnit).trim()) {
            return req.reject(400, 'Storage Unit Number is required.');
        }

        try {
            return await GoodsReceiptAdapter.resolveStorageUnit(StorageUnit);
        } catch (err) {
            LOG.error('getStorageUnitDetails failed:', err.message);
            const isOutage = (GoodsReceiptAdapter._isOutage && GoodsReceiptAdapter._isOutage(err)) || (GoodsReceiptAdapter.constructor && GoodsReceiptAdapter.constructor._isOutage && GoodsReceiptAdapter.constructor._isOutage(err));
            const statusCode = err.status || err.statusCode || (isOutage ? 502 : 404);
            req.reject(statusCode, err.message);
        }
    });

    /**
     * ACTION postGoodsReceipt
     * Posts Goods Receipt (101) directly to SAP S/4HANA
     */
    srv.on('postGoodsReceipt', async (req) => {
        const {
            StorageUnit,
            DeliveryDocument,
            Material,
            Plant,
            StorageLocation,
            Batch,
            Quantity,
            ExpiryDate,
            DeliveryDocumentItem,
            PurchaseOrder,
            PurchaseOrderItem,
            Unit,
            GoodsMovementType,
            DocumentItemText,
            SourceOfGR
        } = req.data;

        if (!StorageUnit && !DeliveryDocument) {
            return req.reject(400, 'Storage Unit or Delivery Document is required.');
        }
        if (!Material) {
            return req.reject(400, 'Material is required.');
        }
        if (!Plant) {
            return req.reject(400, 'Plant is required.');
        }
        if (!StorageLocation) {
            return req.reject(400, 'Storage Location is required.');
        }
        if (!Quantity || Number(Quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }
        // Field-format validation (reused WM primitives) before posting to SAP — presence is checked
        // above, so these enforce the shape (plant/sloc = 4 alphanumerics, material/batch max length).
        const formatErr = checkMaterial(Material, true)
            || checkPlant(Plant, true)
            || checkStorageLocation(StorageLocation, true)
            || checkBatch(Batch);
        if (formatErr) {
            return req.reject(400, `${formatErr.field}: ${formatErr.message}`);
        }
        const scopeErr = plantScopeError(req, Plant);
        if (scopeErr) {
            return req.reject(403, scopeErr);
        }

        try {
            const ifMatch = extractIfMatch(req);
            const payload = {
                StorageUnit,
                DeliveryDocument,
                Material,
                Plant,
                StorageLocation,
                Batch,
                Quantity,
                ExpiryDate,
                DeliveryDocumentItem,
                PurchaseOrder,
                PurchaseOrderItem,
                Unit,
                GoodsMovementType,
                DocumentItemText,
                SourceOfGR
            };
            return await postWithAttempt(req, () => (ifMatch
                ? GoodsReceiptAdapter.postGoodsReceipt(payload, { ifMatch })
                : GoodsReceiptAdapter.postGoodsReceipt(payload)));
        } catch (err) {
            LOG.error('postGoodsReceipt failed:', err.message);
            req.reject(err.status || err.statusCode || 500, err.message);
        }
    });

    /**
     * ACTION postGoodsReceiptWithStorageUnit
     * Posts Goods Receipt (101) against Storage Unit / Inbound Delivery via BAPI_INB_DELIVERY_CONFIRM_DEC
     */
    srv.on('postGoodsReceiptWithStorageUnit', async (req) => {
        const {
            StorageUnit,
            DeliveryDocument,
            DeliveryDocumentItem,
            PurchaseOrder,
            PurchaseOrderItem,
            Material,
            Plant,
            StorageLocation,
            Batch,
            Quantity,
            Unit,
            PackagingMaterial,
            ExpiryDate,
            Simulate
        } = req.data;

        if (!StorageUnit && !DeliveryDocument) {
            return req.reject(400, 'Storage Unit or Delivery Document is required.');
        }
        if (!Material) {
            return req.reject(400, 'Material is required.');
        }
        if (!Plant) {
            return req.reject(400, 'Plant is required.');
        }
        if (!StorageLocation) {
            return req.reject(400, 'Storage Location is required.');
        }
        if (!Quantity || Number(Quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }
        if (!Unit || !String(Unit).trim()) {
            return req.reject(400, 'Unit of Measure is required.');
        }

        const formatErr = checkMaterial(Material, true)
            || checkPlant(Plant, true)
            || checkStorageLocation(StorageLocation, true)
            || checkBatch(Batch);
        if (formatErr) {
            return req.reject(400, `${formatErr.field}: ${formatErr.message}`);
        }
        const scopeErr = plantScopeError(req, Plant);
        if (scopeErr) {
            return req.reject(403, scopeErr);
        }

        try {
            return await postWithAttempt(req, () => GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit,
                DeliveryDocument,
                DeliveryDocumentItem,
                PurchaseOrder,
                PurchaseOrderItem,
                Material,
                Plant,
                StorageLocation,
                Batch,
                Quantity,
                Unit,
                PackagingMaterial,
                ExpiryDate,
                Simulate
            }));
        } catch (err) {
            LOG.error('postGoodsReceiptWithStorageUnit failed:', err.message);
            req.reject(err.statusCode || err.status || 500, err.message);
        }
    });
};

module.exports = init;
module.exports.init = init;
