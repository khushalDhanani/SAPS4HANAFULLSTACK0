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
  extName: /^[A-Za-z0-9 _./-]{1,20}$/
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

  // Create is intentionally NOT implemented: a live POST proof (2026-10-06, client 220) returned
  // PI_RAP/003 "Incomplete data" for every informed payload, and the required RAP field set is not
  // discoverable from this service's metadata/errors. Per AGENTS.md, no unproven create path is shipped.
}

module.exports = PackingInstructionAdapter;
