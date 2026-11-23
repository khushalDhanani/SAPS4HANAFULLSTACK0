'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { strip, num, httpError, inPlantScope, plantClause, clean, RE } = require('./handlingUnitUtils');

const MONITOR = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/HandlingUnit';
const HIERNODE = '/sap/opu/odata/sap/UI_HANDLINGUNITHIERNODE/C_HandlingUnitHierarchyNode';
const VH_BASE = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS';
const VH_TOP = 500;

const VALUE_HELP = {
  plant: { set: 'C_PlantVH', key: 'Plant', text: 'PlantName' },
  packaging: { set: 'C_PackagingMaterialVH', key: 'PackagingMaterial', text: 'PackagingMaterialName' },
  status: { set: 'C_HandlingUnitStatusVH', key: 'HandlingUnitStat', text: 'HandlingUnitStatusName' },
  shippingpoint: { set: 'C_ShippingPointVH', key: 'ShippingPoint', text: 'ShippingPointName' },
  storagelocation: { set: 'I_StorageLocationStdVH', key: 'StorageLocation', text: 'StorageLocationName' }
};

class HandlingUnitHierarchyKpiReader {
  constructor(options = {}) {
    this.results = options.results;
    this.client = options.client;
    this.vhCache = options.vhCache;
    this.kpiCache = options.kpiCache;
  }

  /** Recursive packing tree of one handling unit (flat rows with Node / ParentNode / level). Read-only. */
  async hierarchy(input = {}) {
    const char32 = clean(input.handlingUnitIDChar32, 'Handling unit id', RE.char32, true);
    const origin = clean(input.handlingUnitOrigin || 'ERP', 'Handling unit origin', RE.origin, true);

    if (Array.isArray(input.allowedPlants)) {
      const m = await this.results(MONITOR, {
        $filter: `HandlingUnitIDChar32 eq '${char32}'`, $select: 'Plant', $top: 1, $format: 'json'
      }, 'Resolve plant for packing tree').catch(() => ({}));
      const row = (m.results || [])[0];
      if (!inPlantScope(input.allowedPlants, row && row.Plant)) {
        throw httpError(403, 'Not authorized to view this handling unit');
      }
    }

    const path = `${HIERNODE}(P_HandlingUnitOrigin='${origin}',P_HandlingUnitIDChar32='${char32}')/Set`;
    const d = await this.results(path, { $format: 'json' }, `Read packing tree of ${char32}`);

    const Nodes = (d.results || []).map((r) => ({
      Node: r.Node || '',
      ParentNode: r.ParentNode || '',
      HierarchyLevel: Number(r.HierarchyLevel) || 0,
      DrillState: r.HierarchyDrillState || '',
      Name: strip(r.HandlingUnitOrProductName),
      Product: strip(r.Product),
      ProductName: r.ProductName || '',
      PackagingMaterial: strip(r.PackagingMaterial),
      PackagingMaterialName: r.PackagingMaterialName || '',
      Quantity: num(r.HandlingUnitQuantity),
      Unit: r.HandlingUnitQuantityUnit || '',
      Batch: r.Batch || '',
      ReferenceDocument: strip(r.HandlingUnitReferenceDocument)
    }));
    return { TotalCount: Nodes.length, Nodes };
  }

  /** Filter-bar value help: distinct key/text pairs from monitor value-help set. Read-only. Cached. */
  async valueHelp(input = {}) {
    const kind = clean(input.kind, 'Value help kind', RE.vhKind).toLowerCase();
    const cacheKey = `${kind}_${JSON.stringify(input.allowedPlants || null)}`;
    const fnFetch = async () => {
      const vh = VALUE_HELP[kind];
      if (!vh) throw httpError(400, `Unknown value help '${input.kind}'`);
      const d = await this.results(`${VH_BASE}/${vh.set}`, {
        $select: `${vh.key},${vh.text}`,
        $top: VH_TOP,
        $format: 'json'
      }, `Read ${kind} value help`);
      const seen = new Set();
      let Items = (d.results || []).map((r) => ({ key: r[vh.key] || '', text: r[vh.text] || '' }))
        .filter((x) => x.key && !seen.has(x.key) && seen.add(x.key));
      if (kind === 'plant' && Array.isArray(input.allowedPlants)) {
        const set = new Set(input.allowedPlants);
        Items = Items.filter((x) => set.has(String(x.key).trim().toUpperCase()));
      }
      return { Items };
    };
    return this.vhCache ? this.vhCache.getOrSet(cacheKey, fnFetch) : fnFetch();
  }

  /** HandlingUnit/$count for a $filter. Returns a number. */
  async _count(filter) {
    const query = filter ? `$filter=${encodeURIComponent(filter)}` : '';
    try {
      const text = await this.client.getText(`${MONITOR}/$count`, { query, accept: 'text/plain' });
      const n = Number(String(text).trim());
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      LOG.error(`Count handling units: ${e.message}`);
      throw httpError(e.status || 502, `Count handling units: ${e.message}`);
    }
  }

  /** Status-distribution KPIs for the cards above the filter bar. Read-only. Cached. */
  async statusKpis(input = {}) {
    const cacheKey = `statusKpis_${JSON.stringify(input.allowedPlants || null)}`;
    const fnFetch = async () => {
      const { Items: statuses } = await this.valueHelp({ kind: 'status', allowedPlants: input.allowedPlants });
      const sPlant = plantClause(input.allowedPlants);
      const withPlant = (f) => [sPlant, f].filter(Boolean).join(' and ');
      const [Total, ...counts] = await Promise.all([
        this._count(withPlant('')),
        ...statuses.map((s) => {
          const code = clean(s.key, 'Status', RE.status);
          return code ? this._count(withPlant(`HandlingUnitProcessStatus eq '${code}'`)) : Promise.resolve(0);
        })
      ]);
      const Items = [];
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i];
        const code = clean(s.key, 'Status', RE.status);
        if (!code) continue;
        Items.push({ code, name: s.text, count: counts[i] || 0 });
      }
      return { Total, Items };
    };
    return this.kpiCache ? this.kpiCache.getOrSet(cacheKey, fnFetch) : fnFetch();
  }
}

module.exports = HandlingUnitHierarchyKpiReader;
