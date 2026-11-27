'use strict';

const LOG = require('../../../../common/logger')('maintenance-order-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { mapS4Error } = require('../../S4ErrorMapper');
const { odataString } = require('../../../../common/filterUtils');

const SERVICE_PATH = '/sap/opu/odata/sap/API_MAINTENANCEORDER;v=2';
const ENTITY_SET = 'MaintenanceOrder';
const DEFAULT_TOP = 25;
const MAX_TOP = 200;
const SELECT_FIELDS = [
    'MaintenanceOrder',
    'MaintenanceOrderType',
    'MaintenanceOrderDesc',
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
        // Already a plain date string (e.g. "2024-01-15")
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    }
    if (dateVal instanceof Date) {
        return dateVal.toISOString().slice(0, 10);
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
    return {
        maintenanceOrder: String(row.MaintenanceOrder || '').trim(),
        maintenanceOrderType: row.MaintenanceOrderType || '',
        maintenanceOrderDesc: row.MaintenanceOrderDesc || '',
        maintenancePlanningPlant: row.MaintenancePlanningPlant || '',
        maintenancePlant: row.MaintenancePlant || '',
        mainWorkCenter: row.MainWorkCenter || '',
        equipment: row.Equipment || '',
        equipmentName: row.EquipmentName || '',
        functionalLocation: row.FunctionalLocation || '',
        maintPriority: row.MaintPriority || '',
        systemStatusText: row.SystemStatusText || '',
        userStatusText: row.UserStatusText || '',
        maintOrdBasicStartDate: _parseODataV2Date(row.MaintOrdBasicStartDate),
        maintOrdBasicEndDate: _parseODataV2Date(row.MaintOrdBasicEndDate),
        maintOrderCreationDate: _parseODataV2Date(row.MaintOrderCreationDateTime),
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

        return {
            totalCount,
            items: results.map(_formatRow).filter(Boolean)
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
module.exports._formatRow = _formatRow;
module.exports._buildFilter = _buildFilter;
