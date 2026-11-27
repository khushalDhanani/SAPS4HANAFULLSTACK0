'use strict';

const LOG = require('../../../../common/logger')('maintenance-order-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { mapS4Error } = require('../../S4ErrorMapper');
const { odataString } = require('../../../../common/filterUtils');
const TtlCache = require('../../../../common/TtlCache');

const SERVICE_PATH = '/sap/opu/odata/sap/API_MAINTENANCEORDER;v=2';
const ENTITY_SET = 'MaintenanceOrder';
const PLANT_VH_URL = '/sap/opu/odata/sap/EAM_ORDER_MONITOR/I_Plant?$select=Plant,PlantName&$format=json';
const ORDER_TYPE_VH_URL = '/sap/opu/odata/sap/EAM_ORDER_MONITOR/C_MaintOrderTypeVH?$top=100&$select=MaintenanceOrderType,MaintenanceOrderTypeName&$format=json';
const TECH_OBJECT_SERVICE = '/sap/opu/odata/sap/EAM_OBJPG_TECHNICALOBJECT_SRV/C_ObjPgTechnicalObject';
const FL_BATCH_SIZE = 15;
const DEFAULT_TOP = 25;
const MAX_TOP = 200;
const SELECT_FIELDS = [
    'MaintenanceOrder',
    'MaintenanceOrderType',
    'MaintenanceOrderDesc',
    'MaintenancePlan',
    'MaintenanceNotification',
    'MaintenancePlanningPlant',
    'MaintenancePlant',
    'MainWorkCenter',
    'Equipment',
    'EquipmentName',
    'FunctionalLocation',
    'MaintPriority',
    'SystemStatusText',
    'UserStatusText',
    'MaintOrdBasicStartDate',
    'MaintOrdBasicEndDate',
    'MaintOrderCreationDateTime',
    'CreatedByUser'
].join(',');

/**
 * Parses an OData V2 /Date(ms)/ or /Date(ms+offset)/ timestamp to YYYY-MM-DD.
 * Returns '' for null/undefined/unrecognised values.
 *
 * @param {string|Date|null|undefined} dateVal
 * @returns {string}
 */
function _parseODataV2Date(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') {
        const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
        if (match) {
            const d = new Date(parseInt(match[1], 10));
            return d.toISOString().slice(0, 10);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    }
    if (dateVal instanceof Date) {
        return dateVal.toISOString().slice(0, 10);
    }
    return '';
}

/**
 * Parses an OData V2 /Date(ms)/ or /Date(ms+offset)/ timestamp to an ISO-8601 UTC string.
 * Returns '' for null/undefined/unrecognised values.
 *
 * @param {string|Date|null|undefined} dateVal
 * @returns {string}
 */
function _parseODataV2DateTime(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') {
        const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
        if (match) {
            return new Date(parseInt(match[1], 10)).toISOString();
        }
        const d = new Date(dateVal);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())) {
        return dateVal.toISOString();
    }
    return '';
}

/**
 * Normalizes a raw SAP MaintenanceOrder row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
function _formatRow(row) {
    if (!row) return null;
    const maintPlant = row.MaintenancePlant || row.MaintenancePlanningPlant || '';
    const planPlant = row.MaintenancePlanningPlant || '';
    return {
        maintenanceOrder: String(row.MaintenanceOrder || '').trim(),
        maintenanceOrderType: row.MaintenanceOrderType || '',
        maintenanceOrderTypeName: '',
        maintenanceOrderDesc: row.MaintenanceOrderDesc || '',
        maintenancePlan: row.MaintenancePlan || '',
        maintenanceNotification: row.MaintenanceNotification || '',
        maintenancePlanningPlant: planPlant,
        maintenancePlant: maintPlant,
        plantName: '',
        planningPlantDiff: (row.MaintenancePlant && planPlant && planPlant !== row.MaintenancePlant) ? planPlant : '',
        mainWorkCenter: row.MainWorkCenter || '',
        equipment: row.Equipment || '',
        equipmentName: row.EquipmentName || '',
        functionalLocation: row.FunctionalLocation || '',
        functionalLocationLabel: '',
        functionalLocationName: '',
        maintPriority: row.MaintPriority || '',
        systemStatusText: row.SystemStatusText || '',
        userStatusText: row.UserStatusText || '',
        maintOrdBasicStartDate: _parseODataV2Date(row.MaintOrdBasicStartDate),
        maintOrdBasicEndDate: _parseODataV2Date(row.MaintOrdBasicEndDate),
        maintOrderCreationDate: _parseODataV2Date(row.MaintOrderCreationDateTime),
        maintOrderCreationDateTime: _parseODataV2DateTime(row.MaintOrderCreationDateTime),
        createdByUser: row.CreatedByUser || ''
    };
}

/**
 * Builds an OData V2 $filter expression from the provided filter parameters.
 * Only SAP-filterable fields are used; SystemStatusText / UserStatusText are excluded.
 *
 * @param {Object} params
 * @returns {string} $filter value, or '' if no filters
 */
function _buildFilter(params = {}) {
    const parts = [];

    if (params.plant) {
        parts.push(`MaintenancePlant eq ${odataString(params.plant)}`);
    }
    if (params.planningPlant) {
        parts.push(`MaintenancePlanningPlant eq ${odataString(params.planningPlant)}`);
    }
    if (params.mainWorkCenter) {
        parts.push(`MainWorkCenter eq ${odataString(params.mainWorkCenter)}`);
    }
    if (params.orderType) {
        parts.push(`MaintenanceOrderType eq ${odataString(params.orderType)}`);
    }
    if (params.priority) {
        parts.push(`MaintPriority eq ${odataString(params.priority)}`);
    }
    if (params.searchQuery) {
        const q = odataString(params.searchQuery);
        parts.push(
            `(substringof(${q},MaintenanceOrderDesc) or substringof(${q},MaintenanceOrder) or substringof(${q},Equipment) or substringof(${q},EquipmentName))`
        );
    }

    return parts.join(' and ');
}

function _toAdapterError(err, context) {
    LOG.error(`${context}: ${err?.message || err}`);
    const mapped = mapS4Error(err);
    const status = (mapped.status && mapped.status !== 500) ? mapped.status : (err?.status || mapped.status || 502);
    const out = new Error(mapped.message || err?.message || 'SAP S/4HANA request failed');
    out.status = status;
    out.code = mapped.code || err?.code || 'S4_ERROR';
    return out;
}

class MaintenanceOrderAdapter {
    constructor(options = {}) {
        this.client = options.client || new S4HttpClient();
        this.plantCache = new TtlCache({ defaultTtlMs: 10 * 60 * 1000, maxEntries: 5 });
        this.orderTypeCache = new TtlCache({ defaultTtlMs: 10 * 60 * 1000, maxEntries: 5 });
        this.flCache = new TtlCache({ defaultTtlMs: 10 * 60 * 1000, maxEntries: 1000 });
    }

    async _getPlantMap() {
        const cached = this.plantCache.get('plants');
        if (cached) return cached;
        try {
            const res = await this.client.get(PLANT_VH_URL);
            const rows = res?.data?.d?.results || [];
            const map = new Map();
            rows.forEach((r) => {
                if (r?.Plant) map.set(String(r.Plant).trim(), r.PlantName || '');
            });
            if (map.size > 0) this.plantCache.set('plants', map);
            return map;
        } catch (err) {
            LOG.warn(`_getPlantMap skipped: ${err?.message || err}`);
            return new Map();
        }
    }

    async _getOrderTypeMap() {
        const cached = this.orderTypeCache.get('orderTypes');
        if (cached) return cached;
        try {
            const res = await this.client.get(ORDER_TYPE_VH_URL);
            const rows = res?.data?.d?.results || [];
            const map = new Map();
            rows.forEach((r) => {
                if (r?.MaintenanceOrderType) {
                    map.set(String(r.MaintenanceOrderType).trim(), r.MaintenanceOrderTypeName || '');
                }
            });
            if (map.size > 0) this.orderTypeCache.set('orderTypes', map);
            return map;
        } catch (err) {
            LOG.warn(`_getOrderTypeMap skipped: ${err?.message || err}`);
            return new Map();
        }
    }

    async _getFunctionalLocationMap(rawIds) {
        const uniqueIds = [...new Set((rawIds || []).map((v) => String(v || '').trim()).filter(Boolean))];
        const map = new Map();
        const missing = [];

        uniqueIds.forEach((id) => {
            const hit = this.flCache.get(id);
            if (hit !== undefined) map.set(id, hit);
            else missing.push(id);
        });

        for (let i = 0; i < missing.length; i += FL_BATCH_SIZE) {
            const chunk = missing.slice(i, i + FL_BATCH_SIZE);
            const orExpr = chunk.map((id) => `TechnicalObject eq ${odataString(id)}`).join(' or ');
            const filter = `TechObjIsEquipOrFuncnlLoc eq 'EAMS_FL' and (${orExpr})`;
            const url = `${TECH_OBJECT_SERVICE}?$filter=${encodeURIComponent(filter)}&$select=TechnicalObject,TechnicalObjectLabel,TechnicalObjectDescription&$format=json`;
            try {
                const res = await this.client.get(url);
                const rows = res?.data?.d?.results || [];
                const resolvedKeys = new Set();
                rows.forEach((r) => {
                    const key = String(r?.TechnicalObject || '').trim();
                    if (!key) return;
                    const entry = {
                        label: r.TechnicalObjectLabel || key,
                        name: r.TechnicalObjectDescription || ''
                    };
                    this.flCache.set(key, entry);
                    map.set(key, entry);
                    resolvedKeys.add(key);
                });
                chunk.forEach((id) => {
                    if (!resolvedKeys.has(id)) {
                        const fallback = { label: id, name: '' };
                        this.flCache.set(id, fallback);
                        map.set(id, fallback);
                    }
                });
            } catch (err) {
                LOG.warn(`_getFunctionalLocationMap chunk skipped: ${err?.message || err}`);
            }
        }

        return map;
    }

    async _enrichRows(items) {
        if (!Array.isArray(items) || items.length === 0) return items;

        const flIds = items.map((item) => item.functionalLocation).filter(Boolean);
        const [plantMap, orderTypeMap, flMap] = await Promise.all([
            this._getPlantMap(),
            this._getOrderTypeMap(),
            flIds.length > 0 ? this._getFunctionalLocationMap(flIds) : Promise.resolve(new Map())
        ]);

        return items.map((item) => {
            const fl = flMap.get(item.functionalLocation);
            return {
                ...item,
                plantName: plantMap.get(item.maintenancePlant) || '',
                maintenanceOrderTypeName: orderTypeMap.get(item.maintenanceOrderType) || '',
                functionalLocationLabel: fl ? fl.label : '',
                functionalLocationName: fl ? fl.name : ''
            };
        });
    }

    /**
     * Queries maintenance orders from API_MAINTENANCEORDER;v=2.
     * READ-ONLY: no POST/PUT/PATCH/DELETE.
     *
     * @param {Object} [params]
     * @param {string} [params.plant]
     * @param {string} [params.planningPlant]
     * @param {string} [params.mainWorkCenter]
     * @param {string} [params.orderType]
     * @param {string} [params.priority]
     * @param {string} [params.searchQuery]
     * @param {number} [params.top=25]
     * @param {number} [params.skip=0]
     * @returns {Promise<{ totalCount: number, items: Array<Object> }>}
     */
    async list(params = {}) {
        const top = Math.max(1, Math.min(parseInt(params.top, 10) || DEFAULT_TOP, MAX_TOP));
        const skip = Math.max(0, parseInt(params.skip, 10) || 0);
        const filter = _buildFilter(params);

        const qsParts = [
            `$select=${SELECT_FIELDS}`,
            `$orderby=MaintOrderCreationDateTime desc`,
            `$top=${top}`,
            `$skip=${skip}`,
            `$inlinecount=allpages`,
            `$format=json`
        ];
        if (filter) qsParts.push(`$filter=${encodeURIComponent(filter)}`);

        const url = `${SERVICE_PATH}/${ENTITY_SET}?${qsParts.join('&')}`;
        let res;
        try {
            res = await this.client.get(url);
        } catch (err) {
            throw _toAdapterError(err, 'list');
        }

        const d = res.data && res.data.d ? res.data.d : {};
        const results = Array.isArray(d.results) ? d.results : [];
        const parsedCount = d.__count !== undefined ? parseInt(d.__count, 10) : NaN;
        const totalCount = Number.isFinite(parsedCount) ? parsedCount : results.length;
        const formatted = results.map(_formatRow).filter(Boolean);
        const items = await this._enrichRows(formatted);

        return {
            totalCount,
            items
        };
    }

    /**
     * Returns the total count of maintenance orders in SAP (for the KPI tile).
     * Uses $top=1&$inlinecount=allpages to avoid fetching all data.
     *
     * @returns {Promise<{ totalCount: number }>}
     */
    async getMetrics() {
        const url = `${SERVICE_PATH}/${ENTITY_SET}?$top=1&$inlinecount=allpages&$format=json`;
        let res;
        try {
            res = await this.client.get(url);
        } catch (err) {
            throw _toAdapterError(err, 'getMetrics');
        }

        const d = res.data && res.data.d ? res.data.d : {};
        const parsedCount = d.__count !== undefined ? parseInt(d.__count, 10) : NaN;
        const totalCount = Number.isFinite(parsedCount) ? parsedCount : 0;
        return { totalCount };
    }
}

module.exports = MaintenanceOrderAdapter;
module.exports.MaintenanceOrderAdapter = MaintenanceOrderAdapter;
module.exports._parseODataV2Date = _parseODataV2Date;
module.exports._parseODataV2DateTime = _parseODataV2DateTime;
module.exports._formatRow = _formatRow;
module.exports._buildFilter = _buildFilter;
