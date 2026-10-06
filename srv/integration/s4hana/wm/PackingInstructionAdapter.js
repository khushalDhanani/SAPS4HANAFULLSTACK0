'use strict';

const LOG = require('../logger')('packing-instruction-adapter');
const { S4HttpClient } = require('../S4HttpClient');

/**
 * Packing instructions via API_PACKINGINSTRUCTION (OData V2). Live-verified contract (client 220, 2026-10-06):
 *  - PackingInstructionHeader: key PackingInstructionSystemUUID (Edm.Guid, server-generated);
 *    PackingInstructionNumber is SAP-generated (e.g. "PI-2000000041"); PackingInstructionExternalName is
 *    user-set. Metadata: header is creatable (no sap:creatable attr => default true).
 *  - PackingInstructionComponent / PackingInstructionText: sap:creatable="false" => read-only; the app
 *    creates the HEADER only. Navs: to_PackingInstructionComponent, to_PackingInstructionText.
 * Create is proven against SAP before the UI uses it (see WORKSTATUS; AGENTS.md SAP API discovery).
 */
const API = '/sap/opu/odata/sap/API_PACKINGINSTRUCTION';
const HEADER = `${API}/PackingInstructionHeader`;
const PAGE = 200;
const MAX_LIST = 1000;

const HEADER_SELECT = [
  'PackingInstructionSystemUUID', 'PackingInstructionNumber', 'PackingInstructionExternalName',
  'HandlingUnitType', 'HandlingUnitLength', 'HandlingUnitWidth', 'HandlingUnitHeight', 'HandlingUnitUoMDimension',
  'HandlingUnitGrossWeight', 'HandlingUnitWeightUnit', 'HandlingUnitGrossVolume', 'HandlingUnitVolumeUnit',
  'PackingInstructionIsDeleted', 'CreatedByUser', 'CreationDate', 'LastChangedByUser', 'LastChangeDate'
].join(',');

const RE = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  extName: /^[A-Za-z0-9 _./-]{1,20}$/,
  unit: /^[A-Z0-9]{1,3}$/,
  item: /^\d{1,6}$/,
  category: /^[PM]$/,
  material: /^[A-Z0-9][A-Z0-9_./-]{0,39}$/
};

const strip = (v) => String(v ?? '').replace(/^0+(?=.)/, '');
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const sapDate = (v) => { const m = /\/Date\((-?\d+)/.exec(v || ''); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : ''; };
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Trust-boundary check: values go into an OData $filter, key or POST body, so only the listed characters pass. */
function clean(value, label, re, mandatory) {
  const s = String(value ?? '').trim();
  if (!s && !mandatory) return '';
  if (!re.test(s)) throw httpError(400, `${label} is missing or invalid`);
  return s;
}

const mapHeader = (r) => ({
  PackingInstructionSystemUUID: r.PackingInstructionSystemUUID || '',
  PackingInstructionNumber: r.PackingInstructionNumber || '',
  PackingInstructionExternalName: r.PackingInstructionExternalName || '',
  HandlingUnitType: r.HandlingUnitType || '',
  Length: num(r.HandlingUnitLength),
  Width: num(r.HandlingUnitWidth),
  Height: num(r.HandlingUnitHeight),
  DimensionUnit: r.HandlingUnitUoMDimension || '',
  GrossWeight: num(r.HandlingUnitGrossWeight),
  WeightUnit: r.HandlingUnitWeightUnit || '',
  GrossVolume: num(r.HandlingUnitGrossVolume),
  VolumeUnit: r.HandlingUnitVolumeUnit || '',
  IsDeleted: r.PackingInstructionIsDeleted === true || r.PackingInstructionIsDeleted === 'X',
  CreatedByUser: r.CreatedByUser || '',
  CreationDate: sapDate(r.CreationDate),
  LastChangedByUser: r.LastChangedByUser || '',
  LastChangeDate: sapDate(r.LastChangeDate)
});

class PackingInstructionAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
  }

  async _results(path, params, context) {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    try {
      const { data } = await this.client.get(path, { query });
      return data?.d || {};
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  /** List of packing instruction headers. Read-only. */
  async list(input = {}) {
    const name = clean(input.externalName, 'External name', RE.extName);
    const filter = [];
    if (name) filter.push(`substringof('${name.replace(/'/g, "''")}',PackingInstructionExternalName)`);

    const params = { $orderby: 'PackingInstructionNumber asc', $top: PAGE, $inlinecount: 'allpages', $select: HEADER_SELECT, $format: 'json' };
    if (filter.length) params.$filter = filter.join(' and ');

    const rows = [];
    let sapCount = 0;
    do {
      const d = await this._results(HEADER, { ...params, $skip: rows.length }, 'Read packing instructions');
      sapCount = Number(d.__count || 0);
      if (!(d.results || []).length) break;
      rows.push(...d.results);
    } while (rows.length < sapCount && rows.length < MAX_LIST);

    return { TotalCount: rows.length, SapCount: sapCount, Truncated: rows.length < sapCount, Items: rows.map(mapHeader) };
  }

  /** One packing instruction header with its components and texts. Read-only. */
  async get(input = {}) {
    const uuid = clean(input.systemUUID, 'Packing instruction id', RE.uuid, true);
    const key = `PackingInstructionHeader(guid'${uuid}')`;
    const h = await this._results(`${API}/${key}`, { $format: 'json' }, `Read packing instruction ${uuid}`);
    if (!h.PackingInstructionSystemUUID) throw httpError(404, `Packing instruction ${uuid} not found`);
    const c = await this._results(`${API}/${key}/to_PackingInstructionComponent`, { $format: 'json' }, `Read components of ${uuid}`);
    const t = await this._results(`${API}/${key}/to_PackingInstructionText`, { $format: 'json' }, `Read texts of ${uuid}`);

    return Object.assign(mapHeader(h), {
      Components: (c.results || []).map((r) => ({
        Item: strip(r.PackingInstructionItem), Material: strip(r.Material),
        TargetQuantity: num(r.PackingInstructionItmTargetQty), Unit: r.BaseUnitofMeasure || ''
      })),
      Texts: (t.results || []).map((r) => ({ Language: r.Language || '', Text: r.PackingInstructionText || r.Text || '' }))
    });
  }

  async _post(path, data, context) {
    try {
      const res = await this.client.post(path, { data, csrfPath: `${API}/` });
      return res.data?.d || res.data || {};
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  /**
   * Create one packing instruction by OData V2 DEEP INSERT (proven 2026-10-06, client 220: docs 52/53).
   * SAP rejects a header-only POST (PI_RAP/003 "Incomplete data"); it needs >=1 component and at least one
   * category 'P' (load carrier / packaging material). PackingInstructionNumber and LoadCarrierSystUUID are
   * server-generated and must NOT be sent. Components/texts go through the composition navs even though the
   * child sets are sap:creatable="false" (that only blocks standalone child POSTs). POST -> read back by UUID.
   */
  async create(input = {}) {
    const externalName = clean(input.externalName, 'External name', RE.extName, true);
    const weightUnit = clean(input.weightUnit, 'Weight unit', RE.unit, true);
    const components = Array.isArray(input.components) ? input.components : [];
    if (!components.length) throw httpError(422, 'A packing instruction needs at least one component');
    if (!components.some((c) => String(c.category || '').toUpperCase() === 'P')) {
      throw httpError(422, 'A packing instruction needs a packaging component (category P)');
    }

    const to_PackingInstructionComponent = components.map((c, i) => {
      const item = clean(c.item, `Component ${i + 1} item`, RE.item, true);
      const category = clean(c.category, `Component ${i + 1} category`, RE.category, true);
      const material = clean(c.material, `Component ${i + 1} material`, RE.material, true);
      const unit = clean(c.unit, `Component ${i + 1} unit`, RE.unit, true);
      const qty = Number(c.targetQty);
      if (!(qty > 0)) throw httpError(422, `Component ${i + 1} target quantity must be greater than zero`);
      return {
        PackingInstructionItem: item,
        PackingInstructionItemCategory: category,
        Material: material,
        PackingInstructionItmTargetQty: String(qty),
        BaseUnitofMeasure: unit,
        UnitOfMeasure: unit
      };
    });

    const body = { PackingInstructionExternalName: externalName, HandlingUnitWeightUnit: weightUnit, to_PackingInstructionComponent };
    const texts = (Array.isArray(input.texts) ? input.texts : []).filter((t) => t && t.text);
    if (texts.length) {
      body.to_PackingInstructionText = texts.map((t) => ({
        Language: clean(t.language || 'EN', 'Text language', /^[A-Z]{1,2}$/, true),
        PackingInstructionText: String(t.text).slice(0, 255)
      }));
    }

    const created = await this._post(HEADER, body, `Create packing instruction '${externalName}'`);
    const uuid = created.PackingInstructionSystemUUID;
    if (!uuid) throw httpError(502, 'SAP did not return a packing instruction id; nothing was created');
    // Read the persisted document back so the caller shows SAP's result, not the POST echo.
    return this.get({ systemUUID: uuid });
  }
}

module.exports = PackingInstructionAdapter;
