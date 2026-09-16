sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var BASE_PATH = "/odata/v4/warehouse-management";

    var _FilterOperator = FilterOperator || {
        EQ: "EQ",
        NE: "NE",
        GT: "GT",
        GE: "GE",
        LT: "LT",
        LE: "LE",
        BT: "BT",
        Contains: "Contains"
    };

    var _Filter = Filter || function (sPath, sOperator, oValue1, oValue2) {
        if (typeof sPath === "object") {
            this.aFilters = sPath.filters;
            this.bAnd = sPath.and;
        } else {
            this.sPath = sPath;
            this.sOperator = sOperator;
            this.oValue1 = oValue1;
            this.oValue2 = oValue2;
        }
    };

    var _oModel = null;

    function _isModel(o) {
        return !!(o && typeof o.bindList === "function");
    }

    /**
     * Read an entity set via the OData V4 model's list binding.
     * Falls back to ODataClient.get() if no model is provided.
     *
     * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
     * @param {string} sEntitySet - Entity set path e.g. "/Warehouses"
     * @param {sap.ui.model.Filter[]} [aFilters]
     * @param {Object} [mParameters] - Additional binding parameters (e.g. $expand)
     * @returns {Promise<Object>} Object with value array e.g. { value: [...] }
     */
    function _readEntitySet(oModel, sEntitySet, aFilters, mParameters) {
        if (!oModel || typeof oModel.bindList !== "function") {
            var sUrl = BASE_PATH + sEntitySet;
            var aQueryParts = [];
            if (aFilters && aFilters.length > 0) {
                var aParts = aFilters.map(function (f) {
                    return f.sPath + " eq '" + encodeURIComponent(f.oValue1) + "'";
                });
                aQueryParts.push("$filter=" + aParts.join(" and "));
            }
            if (mParameters && mParameters.$expand) {
                aQueryParts.push("$expand=" + mParameters.$expand);
            }
            if (aQueryParts.length > 0) {
                sUrl += "?" + aQueryParts.join("&");
            }
            return ODataClient.get(sUrl);
        }

        var oListBinding = oModel.bindList(sEntitySet, undefined, undefined, aFilters, mParameters);
        return oListBinding.requestContexts(0, Infinity).then(function (aContexts) {
            var aItems = aContexts.map(function (oCtx) { return oCtx.getObject(); });
            return { value: aItems };
        });
    }

    /**
     * Validate that a parameter is a non-empty string.
     * Throws an Error if invalid.
     * @param {*} v - Value to validate
     * @param {string} sFieldName - Name of the field for error message
     * @returns {string} Trimmed string
     */
    function _validateRequiredString(v, sFieldName) {
        if (!v || typeof v !== "string" || !v.trim()) {
            throw new Error(sFieldName + " is required and must be a valid non-empty string");
        }
        return v.trim();
    }

    /**
     * Validate that a parameter is a positive number (> 0).
     * Throws an Error if invalid.
     * @param {*} n - Value to validate
     * @param {string} sFieldName - Name of the field for error message
     * @returns {number} Validated positive number
     */
    function _validatePositiveNumber(n, sFieldName) {
        var num = Number(n);
        if (n === null || n === undefined || isNaN(num) || num <= 0) {
            throw new Error(sFieldName + " is required and must be a positive number greater than 0");
        }
        return num;
    }

    /**
     * Sanitize code strings that might contain descriptions (e.g. '0030 - General Storage Area')
     * @param {*} val - Value to sanitize
     * @param {number} [maxLen] - Optional max length
     * @returns {string} Clean uppercase code
     */
    function _sanitizeCode(val, maxLen) {
        if (!val || typeof val !== "string") return "";
        var s = val.trim();
        if (s.indexOf(" - ") !== -1) {
            s = s.split(" - ")[0].trim();
        }
        if (maxLen && s.length > maxLen) {
            s = s.substring(0, maxLen);
        }
        return s.toUpperCase();
    }

    /**
     * Determine if a warehouse is a project-specific warehouse.
     * Strictly excludes SAP standard, default, and demo warehouse types:
     * - Codes: 0001, 001, 002, 100, EWM, MLO
     * - Names: Central Warehouse, Central whse, Full WM, Lean WM, SCM-EWM, Loading Object, demo/sample/standard
     * @param {Object} w - Warehouse object { Warehouse, WarehouseName, ... }
     * @returns {boolean}
     */
    function _isProjectSpecificWarehouse(w) {
        if (!w || typeof w.Warehouse !== "string") {
            return false;
        }
        var sKey = w.Warehouse.trim().toUpperCase();
        if (!sKey) {
            return false;
        }

        // Exclude SAP standard/demo warehouse codes
        var aStandardCodes = ["0001", "001", "002", "100", "EWM", "MLO"];
        if (aStandardCodes.indexOf(sKey) !== -1) {
            return false;
        }

        // Exclude SAP standard/demo warehouse names / descriptions
        var sName = (w.WarehouseName || "").trim().toLowerCase();
        var aStandardPatterns = [
            "central warehouse",
            "central whse",
            "full wm",
            "lean wm",
            "scm-ewm",
            "loading object",
            "demo",
            "sample",
            "standard"
        ];
        for (var i = 0; i < aStandardPatterns.length; i++) {
            if (sName.indexOf(aStandardPatterns[i]) !== -1) {
                return false;
            }
        }

        return true;
    }

    return {
        /**
         * Set the OData V4 model for entity set reads
         * @param {sap.ui.model.odata.v4.ODataModel} oModel
         */
        setModel: function (oModel) {
            _oModel = oModel;
        },

        /**
         * Get the current OData V4 model
         * @returns {sap.ui.model.odata.v4.ODataModel|null}
         */
        getModel: function () {
            return _oModel;
        },

        /**
         * Determine if a warehouse is a project-specific warehouse (excluding SAP standard/demo warehouses)
         * @param {Object} w - Warehouse entity
         * @returns {boolean}
         */
        isProjectSpecificWarehouse: _isProjectSpecificWarehouse,

        /**
         * Filter a collection of warehouses to retain only project-specific warehouses
         * @param {Array} aWarehouses - Array of warehouse entities
         * @returns {Array}
         */
        filterProjectWarehouses: function (aWarehouses) {
            if (!Array.isArray(aWarehouses)) {
                return [];
            }
            return aWarehouses.filter(_isProjectSpecificWarehouse);
        },

        /**
         * Fetch list of configured warehouses from SAP
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel] - The "warehouseMgmt" V4 model
         * @returns {Promise<Object>} Object with value array e.g. { value: [...] }
         */
        getWarehouses: function (oModel) {
            var m = _isModel(oModel) ? oModel : _oModel;
            if (_isModel(m)) {
                return _readEntitySet(m, "/Warehouses");
            }
            return ODataClient.get(BASE_PATH + "/Warehouses");
        },

        /**
         * Fetch warehouse process types for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWarehouse] - Warehouse number if model is provided
         * @returns {Promise<Object>}
         */
        getWarehouseProcessTypes: function (oModelOrWhse, sWarehouse) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWhseParam = _isModel(oModelOrWhse) ? sWarehouse : oModelOrWhse;
            try {
                var sWhse = _validateRequiredString(sWhseParam, "Warehouse");
                if (_isModel(oModel)) {
                    return _readEntitySet(oModel, "/WarehouseProcessTypes", [
                        new _Filter("Warehouse", _FilterOperator.EQ, sWhse)
                    ]);
                }
                return ODataClient.get(BASE_PATH + "/WarehouseProcessTypes?$filter=Warehouse eq '" + encodeURIComponent(sWhse) + "'");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch storage types for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWhseOrStorageType] - Warehouse or Storage type
         * @param {string} [sStorageType] - Storage type if model is provided
         * @returns {Promise<Object>}
         */
        getStorageTypes: function (oModelOrWhse, sWhseOrStorageType, sStorageType) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWarehouse = _isModel(oModelOrWhse) ? sWhseOrStorageType : oModelOrWhse;
            var sType = _isModel(oModelOrWhse) ? sStorageType : sWhseOrStorageType;
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                if (_isModel(oModel)) {
                    var aFilters = [new _Filter("Warehouse", _FilterOperator.EQ, sWhse)];
                    if (sType && typeof sType === "string" && sType.trim()) {
                        aFilters.push(new _Filter("StorageType", _FilterOperator.EQ, sType.trim()));
                    }
                    return _readEntitySet(oModel, "/StorageTypes", aFilters);
                }
                var sFilter = "Warehouse eq '" + encodeURIComponent(sWhse) + "'";
                if (sType && typeof sType === "string" && sType.trim()) {
                    sFilter += " and StorageType eq '" + encodeURIComponent(sType.trim()) + "'";
                }
                return ODataClient.get(BASE_PATH + "/StorageTypes?$filter=" + sFilter);
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch storage bins for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWhseOrStorageType] - Warehouse or Storage type
         * @param {string} [sStorageTypeOrBin] - Storage type or Storage bin
         * @param {string} [sStorageBin] - Storage bin if model is provided
         * @returns {Promise<Object>}
         */
        getStorageBins: function (oModelOrWhse, sWhseOrStorageType, sStorageTypeOrBin, sStorageBin) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWarehouse = _isModel(oModelOrWhse) ? sWhseOrStorageType : oModelOrWhse;
            var sType = _isModel(oModelOrWhse) ? sStorageTypeOrBin : sWhseOrStorageType;
            var sBin = _isModel(oModelOrWhse) ? sStorageBin : sStorageTypeOrBin;
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                if (_isModel(oModel)) {
                    var aFilters = [new _Filter("Warehouse", _FilterOperator.EQ, sWhse)];
                    if (sType && typeof sType === "string" && sType.trim()) {
                        aFilters.push(new _Filter("StorageType", _FilterOperator.EQ, sType.trim()));
                    }
                    if (sBin && typeof sBin === "string" && sBin.trim()) {
                        aFilters.push(new _Filter("StorageBin", _FilterOperator.EQ, sBin.trim()));
                    }
                    return _readEntitySet(oModel, "/StorageBins", aFilters);
                }
                var aFiltersOld = ["Warehouse eq '" + encodeURIComponent(sWhse) + "'"];
                if (sType && typeof sType === "string" && sType.trim()) {
                    aFiltersOld.push("StorageType eq '" + encodeURIComponent(sType.trim()) + "'");
                }
                if (sBin && typeof sBin === "string" && sBin.trim()) {
                    aFiltersOld.push("StorageBin eq '" + encodeURIComponent(sBin.trim()) + "'");
                }
                return ODataClient.get(BASE_PATH + "/StorageBins?$filter=" + aFiltersOld.join(" and "));
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a specific storage bin for a warehouse from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sStorageBin - Storage bin identifier (required)
         * @returns {Promise<Object>}
         */
        getStorageBin: function (sWarehouse, sStorageBin) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sBin = _validateRequiredString(sStorageBin, "StorageBin");
                return ODataClient.get(BASE_PATH + "/StorageBins(Warehouse='" + encodeURIComponent(sWhse) + "',StorageBin='" + encodeURIComponent(sBin) + "')");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch warehouse orders for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWhseOrQueue] - Warehouse or Queue
         * @param {string} [sQueueOrStatus] - Queue or Order status
         * @param {string} [sOrderStatus] - Order status if model is provided
         * @returns {Promise<Object>}
         */
        getWarehouseOrders: function (oModelOrWhse, sWhseOrQueue, sQueueOrStatus, sOrderStatus) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWarehouse = _isModel(oModelOrWhse) ? sWhseOrQueue : oModelOrWhse;
            var sQueue = _isModel(oModelOrWhse) ? sQueueOrStatus : sWhseOrQueue;
            var sStatus = _isModel(oModelOrWhse) ? sOrderStatus : sQueueOrStatus;
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                if (_isModel(oModel)) {
                    var aFilters = [new _Filter("Warehouse", _FilterOperator.EQ, sWhse)];
                    if (sQueue && typeof sQueue === "string" && sQueue.trim()) {
                        aFilters.push(new _Filter("WarehouseOrderQueue", _FilterOperator.EQ, sQueue.trim()));
                    }
                    if (sStatus && typeof sStatus === "string" && sStatus.trim()) {
                        aFilters.push(new _Filter("WarehouseOrderStatus", _FilterOperator.EQ, sStatus.trim()));
                    }
                    return _readEntitySet(oModel, "/WarehouseOrders", aFilters);
                }
                var aFiltersOld = ["Warehouse eq '" + encodeURIComponent(sWhse) + "'"];
                if (sQueue && typeof sQueue === "string" && sQueue.trim()) {
                    aFiltersOld.push("WarehouseOrderQueue eq '" + encodeURIComponent(sQueue.trim()) + "'");
                }
                if (sStatus && typeof sStatus === "string" && sStatus.trim()) {
                    aFiltersOld.push("WarehouseOrderStatus eq '" + encodeURIComponent(sStatus.trim()) + "'");
                }
                return ODataClient.get(BASE_PATH + "/WarehouseOrders?$filter=" + aFiltersOld.join(" and "));
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a single warehouse order from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sWarehouseOrder - Warehouse order number (required)
         * @returns {Promise<Object>}
         */
        getWarehouseOrder: function (sWarehouse, sWarehouseOrder) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sOrder = _validateRequiredString(sWarehouseOrder, "WarehouseOrder");
                return ODataClient.get(BASE_PATH + "/WarehouseOrders(Warehouse='" + encodeURIComponent(sWhse) + "',WarehouseOrder='" + encodeURIComponent(sOrder) + "')");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch warehouse tasks for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWhseOrStatus] - Warehouse or Status
         * @param {string} [sStatusOrOrder] - Status or Order
         * @param {string} [sOrder] - Order if model is provided
         * @returns {Promise<Object>}
         */
        getWarehouseTasks: function (oModelOrWhse, sWhseOrStatus, sStatusOrOrder, sOrder) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWarehouse = _isModel(oModelOrWhse) ? sWhseOrStatus : oModelOrWhse;
            var sStatus = _isModel(oModelOrWhse) ? sStatusOrOrder : sWhseOrStatus;
            var sOrd = _isModel(oModelOrWhse) ? sOrder : sStatusOrOrder;
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                if (_isModel(oModel)) {
                    var aFilters = [new _Filter("Warehouse", _FilterOperator.EQ, sWhse)];
                    if (sStatus && typeof sStatus === "string" && sStatus.trim()) {
                        aFilters.push(new _Filter("WarehouseTaskStatus", _FilterOperator.EQ, sStatus.trim()));
                    }
                    if (sOrd && typeof sOrd === "string" && sOrd.trim()) {
                        aFilters.push(new _Filter("WarehouseOrder", _FilterOperator.EQ, sOrd.trim()));
                    }
                    return _readEntitySet(oModel, "/WarehouseTasks", aFilters);
                }
                var aFiltersOld = ["Warehouse eq '" + encodeURIComponent(sWhse) + "'"];
                if (sStatus && typeof sStatus === "string" && sStatus.trim()) {
                    aFiltersOld.push("WarehouseTaskStatus eq '" + encodeURIComponent(sStatus.trim()) + "'");
                }
                if (sOrd && typeof sOrd === "string" && sOrd.trim()) {
                    aFiltersOld.push("WarehouseOrder eq '" + encodeURIComponent(sOrd.trim()) + "'");
                }
                return ODataClient.get(BASE_PATH + "/WarehouseTasks?$filter=" + aFiltersOld.join(" and "));
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a specific warehouse task by key from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sWarehouseTask - Warehouse task number (required)
         * @returns {Promise<Object>}
         */
        getWarehouseTask: function (sWarehouse, sWarehouseTask) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sTask = _validateRequiredString(sWarehouseTask, "WarehouseTask");
                return ODataClient.get(BASE_PATH + "/WarehouseTasks(Warehouse='" + encodeURIComponent(sWhse) + "',WarehouseTask='" + encodeURIComponent(sTask) + "')");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch inbound deliveries for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWarehouse] - Warehouse number if model is provided
         * @returns {Promise<Object>}
         */
        getInboundDeliveries: function (oModelOrWhse, sWarehouse) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWhseParam = _isModel(oModelOrWhse) ? sWarehouse : oModelOrWhse;
            try {
                var sWhse = _validateRequiredString(sWhseParam, "Warehouse");
                if (_isModel(oModel)) {
                    return _readEntitySet(oModel, "/InboundDeliveries", [
                        new _Filter("Warehouse", _FilterOperator.EQ, sWhse)
                    ], { $expand: "Items" });
                }
                return ODataClient.get(BASE_PATH + "/InboundDeliveries?$filter=Warehouse eq '" + encodeURIComponent(sWhse) + "'&$expand=Items");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a single inbound delivery from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sDeliveryDocument - Delivery document number (required)
         * @returns {Promise<Object>}
         */
        getInboundDelivery: function (sWarehouse, sDeliveryDocument) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sDoc = _validateRequiredString(sDeliveryDocument, "DeliveryDocument");
                return ODataClient.get(BASE_PATH + "/InboundDeliveries(Warehouse='" + encodeURIComponent(sWhse) + "',DeliveryDocument='" + encodeURIComponent(sDoc) + "')?$expand=Items");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch outbound delivery orders for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWarehouse] - Warehouse number if model is provided
         * @returns {Promise<Object>}
         */
        getOutboundDeliveries: function (oModelOrWhse, sWarehouse) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWhseParam = _isModel(oModelOrWhse) ? sWarehouse : oModelOrWhse;
            try {
                var sWhse = _validateRequiredString(sWhseParam, "Warehouse");
                if (_isModel(oModel)) {
                    return _readEntitySet(oModel, "/OutboundDeliveries", [
                        new _Filter("Warehouse", _FilterOperator.EQ, sWhse)
                    ], { $expand: "Items" });
                }
                return ODataClient.get(BASE_PATH + "/OutboundDeliveries?$filter=Warehouse eq '" + encodeURIComponent(sWhse) + "'&$expand=Items");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a single outbound delivery order from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sOutboundDeliveryOrder - Outbound delivery order number (required)
         * @returns {Promise<Object>}
         */
        getOutboundDelivery: function (sWarehouse, sOutboundDeliveryOrder) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sOdo = _validateRequiredString(sOutboundDeliveryOrder, "OutboundDeliveryOrder");
                return ODataClient.get(BASE_PATH + "/OutboundDeliveries(Warehouse='" + encodeURIComponent(sWhse) + "',OutboundDeliveryOrder='" + encodeURIComponent(sOdo) + "')?$expand=Items");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch warehouse KPIs for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWarehouse] - Warehouse number if model is provided
         * @returns {Promise<Object>}
         */
        getWarehouseKPIs: function (oModelOrWhse, sWarehouse) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWhseParam = _isModel(oModelOrWhse) ? sWarehouse : oModelOrWhse;
            try {
                var sWhse = _validateRequiredString(sWhseParam, "Warehouse");
                if (_isModel(oModel)) {
                    return _readEntitySet(oModel, "/WarehouseKPIs", [
                        new _Filter("Warehouse", _FilterOperator.EQ, sWhse)
                    ]);
                }
                return ODataClient.get(BASE_PATH + "/WarehouseKPIs?$filter=Warehouse eq '" + encodeURIComponent(sWhse) + "'");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch RF Warehouse Resources for a warehouse from SAP
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrWhse] - Model or Warehouse number
         * @param {string} [sWarehouse] - Warehouse number if model is provided
         * @returns {Promise<Object>}
         */
        getResources: function (oModelOrWhse, sWarehouse) {
            var oModel = _isModel(oModelOrWhse) ? oModelOrWhse : _oModel;
            var sWhseParam = _isModel(oModelOrWhse) ? sWarehouse : oModelOrWhse;
            try {
                var sWhse = _validateRequiredString(sWhseParam, "Warehouse");
                if (_isModel(oModel)) {
                    return _readEntitySet(oModel, "/WarehouseResources", [
                        new _Filter("Warehouse", _FilterOperator.EQ, sWhse)
                    ]);
                }
                return ODataClient.get(BASE_PATH + "/WarehouseResources?$filter=Warehouse eq '" + encodeURIComponent(sWhse) + "'");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch a specific RF resource from SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sResource - Resource identifier (required)
         * @returns {Promise<Object>}
         */
        getResource: function (sWarehouse, sResource) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sRsrc = _validateRequiredString(sResource, "Resource");
                return ODataClient.get(BASE_PATH + "/WarehouseResources(Warehouse='" + encodeURIComponent(sWhse) + "',Resource='" + encodeURIComponent(sRsrc) + "')");
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Fetch distinct active queues configured in SAP for a warehouse
         * Derived dynamically from actual SAP Warehouse Orders and Resources.
         * @param {string} sWarehouse - Warehouse number (required)
         * @returns {Promise<Array<{ Queue: string }>>}
         */
        getQueues: function (sWarehouse) {
            var that = this;
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                return this.getWarehouseOrders(sWhse)
                    .then(function (oOrdersData) {
                        var aOrders = (oOrdersData && oOrdersData.value) ? oOrdersData.value : [];
                        var mQueues = {};
                        aOrders.forEach(function (o) {
                            if (o.WarehouseOrderQueue && typeof o.WarehouseOrderQueue === "string" && o.WarehouseOrderQueue.trim()) {
                                mQueues[o.WarehouseOrderQueue.trim()] = true;
                            }
                        });

                        return that.getResources(sWhse)
                            .then(function (oRsrcData) {
                                var aResources = (oRsrcData && oRsrcData.value) ? oRsrcData.value : [];
                                aResources.forEach(function (r) {
                                    if (r.AssignedQueue && typeof r.AssignedQueue === "string" && r.AssignedQueue.trim()) {
                                        mQueues[r.AssignedQueue.trim()] = true;
                                    }
                                });
                                return Object.keys(mQueues).sort().map(function (q) {
                                    return { Queue: q };
                                });
                            })
                            .catch(function () {
                                return Object.keys(mQueues).sort().map(function (q) {
                                    return { Queue: q };
                                });
                            });
                    });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Confirm Warehouse Task in SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sWarehouseTask - Warehouse task number (required)
         * @param {number} fConfirmedQty - Confirmed quantity (required, must be > 0)
         * @returns {Promise<Object>}
         */
        confirmWarehouseTask: function (sWarehouse, sWarehouseTask, fConfirmedQty) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sTask = _validateRequiredString(sWarehouseTask, "WarehouseTask");
                var nQty = _validatePositiveNumber(fConfirmedQty, "ConfirmedQuantity");

                return ODataClient.post(BASE_PATH + "/confirmWarehouseTask", {
                    Warehouse: sWhse,
                    WarehouseTask: sTask,
                    ConfirmedQuantity: nQty
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Create Warehouse Task in SAP
         * Requires explicit, non-empty business parameters without synthetic fallbacks.
         * @param {Object} oTaskData - Task creation payload (required)
         * @returns {Promise<Object>}
         */
        createWarehouseTask: function (oTaskData) {
            try {
                if (!oTaskData || typeof oTaskData !== "object") {
                    throw new Error("Task data object is required to create a Warehouse Task");
                }
                var sWhse = _sanitizeCode(_validateRequiredString(oTaskData.Warehouse, "Warehouse"), 4);
                var sProduct = _validateRequiredString(oTaskData.Product, "Product");
                var nQty = _validatePositiveNumber(oTaskData.Quantity, "Quantity");
                var sUom = _validateRequiredString(oTaskData.UnitOfMeasure, "UnitOfMeasure");
                var sWpt = _sanitizeCode(_validateRequiredString(oTaskData.WarehouseProcessType, "WarehouseProcessType"), 4);

                var oPayload = {
                    Warehouse: sWhse,
                    Product: sProduct,
                    Quantity: nQty,
                    UnitOfMeasure: sUom,
                    WarehouseProcessType: sWpt
                };

                if (oTaskData.SourceStorageBin && typeof oTaskData.SourceStorageBin === "string" && oTaskData.SourceStorageBin.trim()) {
                    oPayload.SourceStorageBin = oTaskData.SourceStorageBin.trim();
                }
                if (oTaskData.TargetStorageBin && typeof oTaskData.TargetStorageBin === "string" && oTaskData.TargetStorageBin.trim()) {
                    oPayload.TargetStorageBin = oTaskData.TargetStorageBin.trim();
                }
                if (oTaskData.DestinationStorageBin && typeof oTaskData.DestinationStorageBin === "string" && oTaskData.DestinationStorageBin.trim()) {
                    oPayload.DestinationStorageBin = oTaskData.DestinationStorageBin.trim();
                }
                if (oTaskData.SourceStorageType && typeof oTaskData.SourceStorageType === "string" && oTaskData.SourceStorageType.trim()) {
                    oPayload.SourceStorageType = _sanitizeCode(oTaskData.SourceStorageType, 4);
                }
                if (oTaskData.TargetStorageType && typeof oTaskData.TargetStorageType === "string" && oTaskData.TargetStorageType.trim()) {
                    oPayload.TargetStorageType = _sanitizeCode(oTaskData.TargetStorageType, 4);
                }
                if (oTaskData.DestinationStorageType && typeof oTaskData.DestinationStorageType === "string" && oTaskData.DestinationStorageType.trim()) {
                    oPayload.DestinationStorageType = _sanitizeCode(oTaskData.DestinationStorageType, 4);
                }
                if (oTaskData.Batch && typeof oTaskData.Batch === "string" && oTaskData.Batch.trim()) {
                    oPayload.Batch = oTaskData.Batch.trim();
                }
                if (oTaskData.SourceHandlingUnit && typeof oTaskData.SourceHandlingUnit === "string" && oTaskData.SourceHandlingUnit.trim()) {
                    oPayload.SourceHandlingUnit = oTaskData.SourceHandlingUnit.trim();
                }
                if (oTaskData.DestinationHandlingUnit && typeof oTaskData.DestinationHandlingUnit === "string" && oTaskData.DestinationHandlingUnit.trim()) {
                    oPayload.DestinationHandlingUnit = oTaskData.DestinationHandlingUnit.trim();
                }

                return ODataClient.post(BASE_PATH + "/createWarehouseTask", oPayload);
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Cancel Warehouse Task in SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sWarehouseTask - Warehouse task number (required)
         * @returns {Promise<Object>}
         */
        cancelWarehouseTask: function (sWarehouse, sWarehouseTask) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sTask = _validateRequiredString(sWarehouseTask, "WarehouseTask");

                return ODataClient.post(BASE_PATH + "/cancelWarehouseTask", {
                    Warehouse: sWhse,
                    WarehouseTask: sTask
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Post Goods Receipt for Inbound Delivery in SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sDeliveryDocument - Delivery document number (required)
         * @returns {Promise<Object>}
         */
        postGoodsReceipt: function (sWarehouse, sDeliveryDocument) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sDoc = _validateRequiredString(sDeliveryDocument, "DeliveryDocument");

                return ODataClient.post(BASE_PATH + "/postGoodsReceipt", {
                    Warehouse: sWhse,
                    DeliveryDocument: sDoc
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Post Goods Issue for Outbound Delivery Order in SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sOutboundDeliveryOrder - Outbound delivery order number (required)
         * @returns {Promise<Object>}
         */
        postGoodsIssue: function (sWarehouse, sOutboundDeliveryOrder) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sOdo = _validateRequiredString(sOutboundDeliveryOrder, "OutboundDeliveryOrder");

                return ODataClient.post(BASE_PATH + "/postGoodsIssue", {
                    Warehouse: sWhse,
                    OutboundDeliveryOrder: sOdo
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Logon RF Resource in SAP
         * All three parameters are mandatory; empty strings are rejected.
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sResource - Resource identifier (required)
         * @param {string} sQueue - Queue identifier (required)
         * @returns {Promise<Object>}
         */
        logonResource: function (sWarehouse, sResource, sQueue) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sRsrc = _validateRequiredString(sResource, "Resource");
                var sQ = _validateRequiredString(sQueue, "Queue");

                return ODataClient.post(BASE_PATH + "/logonResource", {
                    Warehouse: sWhse,
                    Resource: sRsrc,
                    Queue: sQ
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Verify Scan Barcode against SAP
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sScanType - Scan type ('BIN', 'PRODUCT', etc.) (required)
         * @param {string} sBarcodeValue - Scanned barcode value (required)
         * @param {string} sExpectedValue - Expected master value (required)
         * @returns {Promise<Object>}
         */
        verifyRfScan: function (sWarehouse, sScanType, sBarcodeValue, sExpectedValue) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sType = _validateRequiredString(sScanType, "ScanType");
                var sScanned = _validateRequiredString(sBarcodeValue, "BarcodeValue");
                var sExpected = _validateRequiredString(sExpectedValue, "ExpectedValue");

                return ODataClient.post(BASE_PATH + "/verifyRfScan", {
                    Warehouse: sWhse,
                    ScanType: sType,
                    BarcodeValue: sScanned,
                    ExpectedValue: sExpected
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        },

        /**
         * Action: Confirm RF Pick Task in SAP
         * All parameters are strictly required; no fallback quantities or empty HU/bin strings.
         * @param {string} sWarehouse - Warehouse number (required)
         * @param {string} sWarehouseTask - Warehouse task number (required)
         * @param {number} fConfirmedQty - Confirmed quantity (required, must be > 0)
         * @param {string} sDestinationHU - Destination Handling Unit (required)
         * @param {string} sScannedBin - Verified scanned storage bin (required)
         * @returns {Promise<Object>}
         */
        confirmRfPick: function (sWarehouse, sWarehouseTask, fConfirmedQty, sDestinationHU, sScannedBin) {
            try {
                var sWhse = _validateRequiredString(sWarehouse, "Warehouse");
                var sTask = _validateRequiredString(sWarehouseTask, "WarehouseTask");
                var nQty = _validatePositiveNumber(fConfirmedQty, "ConfirmedQuantity");
                var sHu = _validateRequiredString(sDestinationHU, "DestinationHU");
                var sBin = _validateRequiredString(sScannedBin, "ScannedBin");

                return ODataClient.post(BASE_PATH + "/confirmRfPick", {
                    Warehouse: sWhse,
                    WarehouseTask: sTask,
                    ConfirmedQuantity: nQty,
                    DestinationHU: sHu,
                    ScannedBin: sBin
                });
            } catch (oErr) {
                return Promise.reject(oErr);
            }
        }
    };
});
