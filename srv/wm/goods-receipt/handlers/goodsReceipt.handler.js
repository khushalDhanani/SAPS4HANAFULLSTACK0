const GoodsReceiptAdapter = require('../../../integration/s4hana/wm/GoodsReceiptAdapter');

const init = (srv) => {
    /**
     * READ OpenInboundDeliveries
     * Serves live open inbound deliveries from SAP MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet
     */
    srv.on('READ', 'OpenInboundDeliveries', async (req) => {
        try {
            let sPlant = '';
            const whereClause = req.query?.SELECT?.where;
            if (Array.isArray(whereClause)) {
                for (let i = 0; i < whereClause.length; i++) {
                    const token = whereClause[i];
                    if (token?.ref?.[0] === 'Plant' && whereClause[i + 2]?.val) {
                        sPlant = String(whereClause[i + 2].val).trim();
                        break;
                    }
                }
            }

            return await GoodsReceiptAdapter.getOpenInboundDeliveries(sPlant);
        } catch (err) {
            console.error('[GoodsReceiptHandler] READ OpenInboundDeliveries failed:', err.message);
            req.reject(err.statusCode || 502, err.message || 'Failed to retrieve open inbound deliveries from SAP');
        }
    });

    /**
     * READ MaterialStorageLocations
     * Queries authentic storage locations and bins from MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps
     */
    srv.on('READ', 'MaterialStorageLocations', async (req) => {
        try {
            let sMaterial = '';
            let sPlant = '';

            const whereClause = req.query?.SELECT?.where;
            if (Array.isArray(whereClause)) {
                for (let i = 0; i < whereClause.length; i++) {
                    const token = whereClause[i];
                    if (token?.ref?.[0] === 'Material' && whereClause[i + 2]?.val) {
                        sMaterial = String(whereClause[i + 2].val).trim();
                    }
                    if (token?.ref?.[0] === 'Plant' && whereClause[i + 2]?.val) {
                        sPlant = String(whereClause[i + 2].val).trim();
                    }
                }
            }

            if (!sMaterial) {
                return req.reject(400, 'Material parameter is required to query storage locations.');
            }

            return await GoodsReceiptAdapter.getMaterialStorageLocations(sMaterial, sPlant);
        } catch (err) {
            req.reject(err.statusCode || 502, err.message || 'Failed to retrieve storage locations from SAP');
        }
    });

    /**
     * READ MaterialBatches
     * Queries authentic batches and SLED from LO_BM_BATCH_SRV/I_Batch
     */
    srv.on('READ', 'MaterialBatches', async (req) => {
        try {
            let sMaterial = '';
            let sPlant = '';
            let sStorageLocation = '';

            const whereClause = req.query?.SELECT?.where;
            if (Array.isArray(whereClause)) {
                for (let i = 0; i < whereClause.length; i++) {
                    const token = whereClause[i];
                    if (token?.ref?.[0] === 'Material' && whereClause[i + 2]?.val) {
                        sMaterial = String(whereClause[i + 2].val).trim();
                    }
                    if (token?.ref?.[0] === 'Plant' && whereClause[i + 2]?.val) {
                        sPlant = String(whereClause[i + 2].val).trim();
                    }
                    if (token?.ref?.[0] === 'StorageLocation' && whereClause[i + 2]?.val) {
                        sStorageLocation = String(whereClause[i + 2].val).trim();
                    }
                }
            }

            if (!sMaterial) {
                return req.reject(400, 'Material parameter is required to query batches.');
            }

            return await GoodsReceiptAdapter.getMaterialBatches(sMaterial, sPlant, sStorageLocation);
        } catch (err) {
            req.reject(err.statusCode || 502, err.message || 'Failed to retrieve batches from SAP');
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
            console.error('[GoodsReceiptHandler] getStorageUnitDetails failed:', err.message);
            req.reject(err.statusCode || 404, err.message);
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
            ExpiryDate
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
                ExpiryDate
            });
        } catch (err) {
            console.error('[GoodsReceiptHandler] postGoodsReceipt failed:', err.message);
            req.reject(err.statusCode || 500, err.message);
        }
    });
};

module.exports = init;
module.exports.init = init;
