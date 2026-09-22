const cds = require('@sap/cds');
const LOG = require('../../../common/logger')('goods-receipt');
const GoodsReceiptAdapter = require('../../../integration/s4hana/wm/GoodsReceiptAdapter');
const { extractFilterParam, extractFilterParams, applyPaging } = require('../../../common/filterUtils');

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
     * Queries authentic storage locations and bins from MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps
     */
    srv.on('READ', 'MaterialStorageLocations', async (req) => {
        const { Material: sMaterial, Plant: sPlant } = extractFilterParams(req, ['Material', 'Plant']);

        if (!sMaterial) {
            return req.reject(400, 'Material parameter is required to query storage locations.');
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

        try {
            return await GoodsReceiptAdapter.postGoodsReceipt({
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
            });
        } catch (err) {
            LOG.error('postGoodsReceipt failed:', err.message);
            req.reject(err.statusCode || 500, err.message);
        }
    });
};

module.exports = init;
module.exports.init = init;
