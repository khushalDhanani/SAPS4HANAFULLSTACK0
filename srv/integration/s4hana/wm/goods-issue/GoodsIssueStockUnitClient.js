const LOG = require('../../logger')('goods-issue-stock-unit');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
const { RfcClient } = require('../../RfcClient');

// Classic WM (LE-WM) Storage Units live in LEIN/LQUA, not in EWM Handling Units.
// Values below go into RFC_READ_TABLE WHERE clauses, so only [A-Z0-9] is accepted.
const WM_KEY_RE = /^[A-Z0-9]{1,40}$/;
const wmKey = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return WM_KEY_RE.test(s) ? s : '';
};
const WM_QUANT_FIELDS = ['LGNUM', 'LENUM', 'LQNUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BESTQ', 'SOBKZ',
  'VERME', 'EINME', 'MEINS', 'LGTYP', 'LGPLA', 'SKZUA', 'SKZSA', 'SKZSI', 'WDATU'];

// General storage type exclusion lists (Requirement 4)
const EXCLUDED_STORAGE_TYPES = ['OH1', 'QC1', 'RJ1'];
const EXCLUDED_STORAGE_TYPE_PREFIXES = ['9', 'QC', 'RJ'];
const wmAlphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const wmSapDate = (v) => (/^\d{8}$/.test(v || '') && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);
/** RFC_READ_TABLE quantity -> number (last separator is the decimal point). */
function wmNum(v) {
  let t = String(v ?? '').trim();
  if (!t) return 0;
  const neg = t.includes('-');
  t = t.replace(/[-\s]/g, '');
  const i = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  const n = i < 0 ? Number(t) : Number(`${t.slice(0, i).replace(/[.,]/g, '')}.${t.slice(i + 1)}`);
  return neg ? -n : n;
}

// ──────────────────────────────────────────────────────────
// Stock Unit (SU) / Handling Unit (HU) resolution configuration
// ──────────────────────────────────────────────────────────
// A scanned SU barcode is resolved ONLY against real SAP EWM Handling Unit
// (HUIDENT / SSCC) objects via registered /SCWM/ OData services. Entity sets and
// field names are DISCOVERED from live $metadata — never assumed (AGENTS.md SAP
// API Discovery Protocol).
const SU_HU_DEFAULT_SERVICES = [
  '/sap/opu/odata/scwm/SIMPLE_INB_DLV_SRV',
  '/sap/opu/odata/scwm/PACK_OUTBDLV_SRV',
  '/sap/opu/odata/scwm/PICKLIST_PAPER_SRV'
];
const SU_HU_SERVICES = process.env.SU_HU_SERVICE_PATH
  ? process.env.SU_HU_SERVICE_PATH.split(',')
      .map((s) => String(s).trim())
      .filter(Boolean)
      .map((name) => {
        if (/^\//.test(name)) return name;
        if (/^\/?(scwm|SCWM)\//i.test(name)) return `/sap/opu/odata/scwm/${name.replace(/^\/?scwm\//i, '')}`;
        return `/sap/opu/odata/sap/${name}`;
      })
  : SU_HU_DEFAULT_SERVICES;

/**
 * Domain client for SAP S/4HANA EWM Stock Unit / Handling Unit (SU/HU) resolution.
 * Discovers live $metadata on registered /SCWM/ services, verifies EWM warehouse context,
 * resolves physical SU/HU objects (HUIDENT / SSCC), and reads handling unit contents.
 */
class GoodsIssueStockUnitClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.batchesClient = options.batchesClient || (this.adapter && this.adapter.batches) || null;
    this.issuedSuStore = options.issuedSuStore || (this.adapter && this.adapter.issuedSuStore) || null;
    this._huModelCache = null;
    this.rfc = options.rfc || new RfcClient();
  }

  /**
   * Resolve the issued SU store instance if available.
   * @returns {Object|null}
   */
  _getIssuedSuStore() {
    if (this.issuedSuStore) return this.issuedSuStore;
    if (this.adapter && this.adapter.issuedSuStore) return this.adapter.issuedSuStore;
    try {
      return require('../../../../wm/goods-issue/GoodsIssueIssuedSuStore');
    } catch {
      return null;
    }
  }

  /**
   * Structured diagnostic log for SU resolution (SAP API discovery protocol).
   */
  _suDiag(label, fields) {
    if (process.env.NODE_ENV === 'test') return;
    try { LOG.info(`[SU-DIAG] ${label}:`, fields); } catch (_) {}
  }

  /**
   * Fetch an OData service $metadata document as raw XML text via shared client.
   */
  async _fetchMetadataXml(servicePath) {
    const xml = await this.client.getText(`${servicePath}/$metadata`, { accept: 'application/xml' });
    this._suDiag('HU metadata fetched', {
      huService: servicePath,
      sapObject: 'EWM Handling Unit OData service $metadata',
      sapResponse: `HTTP 200 (${xml.length} bytes)`
    });
    return xml;
  }

  async _getMetadataXml(servicePath) {
    return this._fetchMetadataXml(servicePath);
  }

  /**
   * Entity sets of an OData V2 $metadata document (name, unqualified type,
   * sap:requires-filter flag).
   */
  _extractEntitySets(xml) {
    const sets = [];
    const re = /<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"([^>]*)>/g;
    let m;
    while ((m = re.exec(xml))) {
      sets.push({
        name: m[1],
        type: String(m[2]).split('.').pop(),
        requiresFilter: /sap:requires-filter="true"/.test(m[3] || '')
      });
    }
    return sets;
  }

  /**
   * Property details (name, EDM type, key flag) of an entity type.
   */
  _typePropDetails(xml, typeName) {
    const props = [];
    const bodyRe = new RegExp(`<EntityType\\s+Name="${String(typeName)}"[^>]*>([\\s\\S]*?)</EntityType>`);
    const match = bodyRe.exec(xml);
    if (!match) return props;
    const keys = [];
    const keyRe = /<PropertyRef\s+Name="([^"]+)"/g;
    let k;
    while ((k = keyRe.exec(match[1]))) keys.push(k[1]);
    const propRe = /<Property\s+Name="([^"]+)"\s+Type="([^"]+)"[^>]*>/g;
    let p;
    while ((p = propRe.exec(match[1]))) props.push({ name: p[1], type: p[2], key: keys.includes(p[1]) });
    return props;
  }

  _typeProps(xml, typeName) {
    return this._typePropDetails(xml, typeName).map((p) => p.name);
  }

  _pickField(props, { names, re }) {
    for (const n of names) if (props.includes(n)) return n;
    return props.find((nm) => re.test(nm)) || '';
  }

  /**
   * Field-name vocabularies proven on live /SCWM/ services.
   */
  _huFieldSpecs() {
    return {
      warehouse: { names: ['WarehouseNumber', 'EWMWarehouse', 'LGNUM', 'Lgnum'], re: /^(warehousenumber|ewmwarehouse|lgnum)$/i },
      warehouseText: { names: ['LNUMT', 'EWMWarehouse_Text', 'WarehouseNumberName'], re: /^(lnumt|ewmwarehouse_text|warehousenumbername)$/i },
      huId: {
        names: ['HandlingUnitID', 'HUIDENT', 'Huident', 'HandlingUnitNumber', 'HuId', 'SourceHandlingUnit', 'VLENR', 'SSCC', 'HUEXID', 'EXIDV'],
        re: /^(handlingunit(id|number)?|huident|huid|sourcehandlingunit|vlenr|sscc|huexid|exidv)$/i
      },
      huUuid: { names: ['HandlingUnitUUID', 'HandlingUnitGUID', 'HU_GUID', 'GUID_HU'], re: /^(handlingunit(uuid|guid)|hu_?guid|guid_?hu)$/i },
      huParentUuid: { names: ['HandlingUnitParentUUID', 'ParentHandlingUnitUUID', 'HandlingUnitHeadUUID'], re: /^(handlingunitparentuuid|parenthandlingunituuid|handlingunitheaduuid)$/i },
      workCenter: { names: ['EWMWorkCenter', 'WorkCenter', 'WORKSTATION'], re: /^(ewmworkcenter|workcenter|workstation)$/i },
      material: { names: ['Product', 'Material', 'MATNR', 'Matnr', 'MaterialNumber', 'ProductNumber'], re: /^(product|material(number)?|matnr|productnumber)$/i },
      materialGuid: { names: ['MATID', 'ProductUUID', 'MaterialUUID', 'PMAT_GUID'], re: /^(matid|productuuid|materialuuid)$/i },
      batch: { names: ['Batch', 'CHARG', 'Charg'], re: /^(batch|charg)$/i },
      plant: { names: ['Plant', 'Werks', 'WERKS'], re: /^(plant|werks)$/i },
      sloc: { names: ['StorageLocation', 'Lgort', 'LGORT', 'SLoc'], re: /^(storagelocation|lgort|sloc)$/i },
      qty: { names: ['ItemQuantity', 'Quantity', 'QUAN', 'Quan', 'NISTM', 'Menge', 'HuQty', 'AvailableQty'], re: /^(itemquantity|quantity|qty|quan|nistm|menge|huqty|availableqty)$/i },
      unit: { names: ['ItemQuantityUnit', 'BaseUnit', 'MEINS', 'Meins', 'Unit', 'Uom', 'UoM'], re: /^(itemquantityunit|baseunit|meins|unit|uom)$/i }
    };
  }

  /**
   * Parse SAP Gateway error (code + message text + HTTP status) out of an error.
   */
  _sapErrorInfo(err) {
    const info = { status: Number(err && err.status) || 0, code: '', text: '' };
    const raw = String((err && err.message) || err || '');
    const http = /HTTP\s+(\d{3})/.exec(raw);
    if (http) info.status = Number(http[1]);
    const json = /\{[\s\S]*\}/.exec(raw);
    if (json) {
      try {
        const parsed = JSON.parse(json[0]);
        info.code = String(parsed.error?.code || '');
        info.text = String(parsed.error?.message?.value || '');
      } catch (_) { /* fall through */ }
    }
    if (!info.code && err && err.code && err.code !== 'UNKNOWN') info.code = String(err.code);
    if (!info.text) info.text = raw.replace(/\s+/g, ' ').slice(0, 200);
    return info;
  }

  /**
   * True when SAP EWM rejected the request because of warehouse context.
   */
  _isScwmWarehouseContextError(info) {
    return /^\/SCWM\//i.test(info.code || '') || /warehouse number/i.test(info.text || '');
  }

  /**
   * Select EWM warehouse value-help entity set.
   */
  _pickWarehouseSet(xml) {
    const specs = this._huFieldSpecs();
    const candidates = this._extractEntitySets(xml)
      .filter((s) => !/^SAP__/.test(s.name))
      .map((s) => {
        const details = this._typePropDetails(xml, s.type);
        const names = details.map((p) => p.name);
        const whField = this._pickField(names, specs.warehouse);
        const whProp = details.find((p) => p.name === whField);
        if (!whField || !whProp || !whProp.key || details.length > 4) return null;
        const n = s.name.toUpperCase();
        let score = 10;
        if (/LGNUM/.test(n)) score += 90;
        else if (/EWMWAREHOUSEVH/.test(n)) score += 80;
        else if (/EWMWAREHOUSE/.test(n)) score += 70;
        else if (/WAREHOUSE/.test(n)) score += 40;
        return { name: s.name, type: s.type, whField, textField: this._pickField(names, specs.warehouseText), score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  /**
   * Select Handling-Unit header/lookup entity set.
   */
  _pickHuHeaderSet(xml) {
    const specs = this._huFieldSpecs();
    const candidates = this._extractEntitySets(xml)
      .filter((s) => !/^SAP__/.test(s.name) && !/ITEM/i.test(s.name))
      .map((s) => {
        const details = this._typePropDetails(xml, s.type);
        const names = details.map((p) => p.name);
        const huIdField = this._pickField(names, specs.huId);
        const whField = this._pickField(names, specs.warehouse);
        const needsWorkCenter = details.some((p) => p.key && specs.workCenter.re.test(p.name));
        if (!huIdField || !whField || needsWorkCenter) return null;
        const n = s.name.toUpperCase();
        let score = 0;
        if (/^HUHEAD(SET)?$/.test(n)) score = 100;
        else if (/^VL_SH_XSCWMXSH_HU$/.test(n)) score = 90;
        else if (/^HU(SET)?$/.test(n)) score = 80;
        else if (/HUHEAD/.test(n)) score = 70;
        else if (/HANDLING[\s_-]?UNIT/.test(n)) score = 60;
        else if (/^HU/.test(n)) score = 40;
        else if (/HU/.test(n)) score = 20;
        if (score === 0) return null;
        return {
          name: s.name,
          type: s.type,
          huIdField,
          whField,
          huUuidField: this._pickField(names, specs.huUuid),
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  /**
   * Select Handling-Unit contents entity set.
   */
  _pickHuItemSet(xml, headerType) {
    const specs = this._huFieldSpecs();
    const candidates = this._extractEntitySets(xml)
      .filter((s) => s.type !== headerType && !/^SAP__/.test(s.name))
      .map((s) => {
        const details = this._typePropDetails(xml, s.type);
        const names = details.map((p) => p.name);
        const huField = this._pickField(names, specs.huId);
        const huParentUuidField = this._pickField(names, specs.huParentUuid);
        const material = this._pickField(names, specs.material);
        const materialGuid = this._pickField(names, specs.materialGuid);
        const qty = this._pickField(names, specs.qty);
        const needsWorkCenter = details.some((p) => p.key && specs.workCenter.re.test(p.name));
        if ((!huField && !huParentUuidField) || (!material && !materialGuid && !qty) || needsWorkCenter) return null;
        const n = s.name.toUpperCase();
        let score = 0;
        if (/^HUITEM(SET)?$/.test(n)) score = 100;
        else if (/TO_CONF_HU_COMP/.test(n)) score = 80;
        else if (/HUITEM/.test(n)) score = 70;
        else if (/^SOURCEHUVH$/.test(n)) score = 60;
        else if (/HU/.test(n) && /ITEM|COMP|CONTENT/.test(n)) score = 50;
        else if (/HU/.test(n)) score = 20;
        if (score === 0) return null;
        return {
          name: s.name,
          type: s.type,
          huField,
          huParentUuidField,
          whField: this._pickField(names, specs.warehouse),
          fields: {
            material,
            materialGuid,
            batch: this._pickField(names, specs.batch),
            plant: this._pickField(names, specs.plant),
            sloc: this._pickField(names, specs.sloc),
            qty,
            unit: this._pickField(names, specs.unit)
          },
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  /**
   * Product master value help carrying product GUID + product number.
   */
  _pickProductSet(xml) {
    const specs = this._huFieldSpecs();
    for (const s of this._extractEntitySets(xml)) {
      const names = this._typeProps(xml, s.type);
      const guidField = this._pickField(names, specs.materialGuid);
      const numberField = this._pickField(names, specs.material);
      if (guidField && numberField && /PROD/i.test(s.name)) return { name: s.name, guidField, numberField };
    }
    return null;
  }

  /**
   * Resolve EWM warehouse number.
   */
  async _resolveEwmWarehouse(base, warehouseSet) {
    const configured = String(process.env.EWM_WAREHOUSE_NUMBER || '').trim().toUpperCase();
    if (configured) {
      return { warehouse: configured, source: 'EWM_WAREHOUSE_NUMBER' };
    }
    if (!warehouseSet) {
      const err = new Error(
        `${base} exposes no EWM warehouse value help; set EWM_WAREHOUSE_NUMBER to the EWM warehouse the Stock Units belong to.`
      );
      err.status = 422;
      throw err;
    }
    const rows = await this._get(`${base}/${warehouseSet.name}`, '$format=json');
    const list = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ id: String(r[warehouseSet.whField] || '').trim(), text: String((warehouseSet.textField && r[warehouseSet.textField]) || '').trim() }))
      .filter((r) => r.id);
    if (list.length === 1) {
      return { warehouse: list[0].id, source: `${warehouseSet.name} value help (${list[0].text || 'no description'})` };
    }
    const err = new Error(
      list.length === 0
        ? `${base}/${warehouseSet.name} returned no EWM warehouse; no warehouse context is available for Handling Unit lookup.`
        : `${base}/${warehouseSet.name} returned ${list.length} EWM warehouses (${list.map((r) => r.id).join(', ')}); ` +
          'set EWM_WAREHOUSE_NUMBER to select the warehouse the Stock Units belong to.'
    );
    err.status = 422;
    throw err;
  }

  _odataLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  _resetHuModelCache() {
    this._huModelCache = null;
  }

  /**
   * Discover registered EWM (/SCWM/) Handling Unit service and models from live $metadata.
   */
  async _discoverHuModel() {
    if (this._huModelCache && this._huModelCache.expires > Date.now()) {
      return this._huModelCache.model;
    }
    const attempts = [];
    for (const base of SU_HU_SERVICES) {
      let xml;
      try {
        xml = await (this.adapter && typeof this.adapter._getMetadataXml === 'function'
          ? this.adapter._getMetadataXml(base)
          : this._fetchMetadataXml(base));
      } catch (err) {
        if (!err.status || err.status === 502 || err.status === 503) {
          // Destination / network failure must not be masked as "capability missing"
          throw err;
        }
        const info = this._sapErrorInfo(err);
        attempts.push(`${base} -> HTTP ${info.status || err.status}${info.code ? ` ${info.code}` : ''}`);
        continue;
      }

      const headerSet = this._pickHuHeaderSet(xml);
      if (!headerSet) {
        attempts.push(`${base} -> metadata OK but no HU entity set with warehouse + HU identification fields (or it requires an EWM work-center context)`);
        continue;
      }
      const itemSet = this._pickHuItemSet(xml, headerSet.type);
      const warehouseSet = this._pickWarehouseSet(xml);
      const productSet = this._pickProductSet(xml);

      let warehouse;
      try {
        warehouse = await this._resolveEwmWarehouse(base, warehouseSet);
      } catch (err) {
        attempts.push(`${base} -> ${err.message}`);
        continue;
      }

      // Warehouse session check: one warehouse-scoped read on the HU entity set.
      try {
        await this._get(
          `${base}/${headerSet.name}`,
          `$filter=${encodeURIComponent(`${headerSet.whField} eq ${this._odataLiteral(warehouse.warehouse)}`)}&$top=1&$format=json`
        );
      } catch (err) {
        const info = this._sapErrorInfo(err);
        attempts.push(
          `${base}/${headerSet.name} with ${headerSet.whField}='${warehouse.warehouse}' -> ` +
          `HTTP ${info.status || 0}${info.code ? ` ${info.code}` : ''}: ${info.text}` +
          (this._isScwmWarehouseContextError(info) ? ' (EWM warehouse context rejected for this user/warehouse)' : '')
        );
        continue;
      }

      const model = {
        base,
        headerSet: headerSet.name,
        huIdField: headerSet.huIdField,
        huUuidField: headerSet.huUuidField,
        whField: headerSet.whField,
        warehouse: warehouse.warehouse,
        warehouseSource: warehouse.source,
        warehouseSet: warehouseSet ? warehouseSet.name : '',
        itemSet: itemSet ? itemSet.name : '',
        itemHuField: itemSet ? itemSet.huField : '',
        itemHuParentUuidField: itemSet ? itemSet.huParentUuidField : '',
        itemWhField: itemSet ? itemSet.whField : '',
        itemFields: itemSet ? itemSet.fields : {},
        productSet
      };
      this._suDiag('HU model discovered', {
        huService: base,
        headerSet: model.headerSet,
        itemSet: model.itemSet,
        huIdField: model.huIdField,
        huUuidField: model.huUuidField,
        warehouseField: model.whField,
        warehouse: model.warehouse,
        warehouseSource: model.warehouseSource,
        itemFields: model.itemFields
      });
      this._huModelCache = { model, expires: Date.now() + 10 * 60 * 1000 };
      return model;
    }

    const err = new Error(
      'SU/HU (SSCC / Handling Unit) capability is not activated or not available in SAP S/4HANA EWM. ' +
      `Attempted service(s): ${attempts.join(' | ')}. ` +
      'A Stock Unit barcode cannot be resolved until an EWM Handling Unit service (such as /SCWM/SIMPLE_INB_DLV_SRV ' +
      'or /SCWM/PICKLIST_PAPER_SRV) accepts the EWM warehouse for this user and the object exists in SAP. ' +
      'No cross-document fallback search is performed by design.'
    );
    err.status = 404;
    throw err;
  }

  /**
   * Locate physical SU/HU object by its EWM handling-unit identification.
   */
  async _findHuByBarcode(model, barcode) {
    const { base, headerSet, huIdField, huUuidField, whField, warehouse } = model;
    const filter = `${whField} eq ${this._odataLiteral(warehouse)} and ${huIdField} eq ${this._odataLiteral(barcode)}`;
    let huObject = null;
    try {
      const rows = await this._get(`${base}/${headerSet}`, `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`);
      const list = Array.isArray(rows) ? rows : [];
      huObject = list.find((r) => String(r[huIdField] || '').trim().toUpperCase() === barcode.toUpperCase()) || list[0] || null;
    } catch (err) {
      const info = this._sapErrorInfo(err);
      this._suDiag('SU barcode lookup failed', {
        inputBarcode: barcode,
        huService: base,
        huEntitySet: headerSet,
        warehouse,
        fieldSearched: huIdField,
        valueSearched: barcode,
        sapResponse: `HTTP ${info.status || 0} ${info.code} ${info.text}`
      });
      const qErr = new Error(
        `Could not query EWM Handling Unit service ${base}/${headerSet} for ${barcode} in warehouse ${warehouse} ` +
        `(${whField}='${warehouse}', ${huIdField}='${barcode}'): HTTP ${info.status || 0}${info.code ? ` ${info.code}` : ''} - ${info.text}`
      );
      qErr.status = 502;
      throw qErr;
    }

    this._suDiag('SU barcode lookup', {
      inputBarcode: barcode,
      identifierType: 'EWM Handling Unit identification (HUIDENT / SSCC)',
      huService: base,
      huEntitySet: headerSet,
      warehouse,
      fieldSearched: `${whField},${huIdField}`,
      valueSearched: `${warehouse},${barcode}`,
      sapResponse: huObject ? 'object found' : 'no matching Handling Unit object',
      huInternalNumber: huObject ? String((huUuidField && huObject[huUuidField]) || huObject[huIdField] || '') : '',
      huExternalId: huObject ? String(huObject[huIdField] || '') : ''
    });

    if (!huObject) {
      const err = new Error(
        `Stock Unit ${barcode} was NOT found in SAP as a real Handling Unit / SSCC object. ` +
        `Resolved against EWM service ${base} (entity "${headerSet}") in EWM warehouse ${warehouse} ` +
        `(${whField}) on handling-unit identification field "${huIdField}". SAP returned no matching object. ` +
        `Verify the scanned SU/SSCC barcode and confirm the Handling Unit exists in EWM warehouse ${warehouse}.`
      );
      err.status = 404;
      throw err;
    }
    return huObject;
  }

  /**
   * Resolve product GUIDs to product numbers.
   */
  async _resolveProductNumbers(model, guids) {
    const map = {};
    if (!model.productSet) return map;
    for (const g of guids) {
      try {
        const rows = await this._get(
          `${model.base}/${model.productSet.name}`,
          `$filter=${encodeURIComponent(`${model.productSet.guidField} eq guid'${g}'`)}&$top=1&$format=json`
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row && row[model.productSet.numberField]) map[g] = String(row[model.productSet.numberField]).trim();
      } catch (err) {
        LOG.warn(`Could not resolve product GUID ${g} via ${model.base}/${model.productSet.name}: ${err.message}`);
      }
    }
    return map;
  }

  /**
   * Read physical contents of a resolved SU/HU object.
   */
  async _readHuContents(model, huObject) {
    const { base, huIdField, huUuidField, whField, warehouse, itemSet, itemHuField, itemHuParentUuidField, itemWhField, itemFields } = model;
    const huId = String(huObject[huIdField] || '').trim();
    const huUuid = huUuidField ? String(huObject[huUuidField] || '').trim() : '';
    const internalNo = huUuid || huId;
    let rows = [];
    if (itemSet && (itemHuField || (itemHuParentUuidField && huUuid))) {
      const parts = [];
      if (itemWhField) parts.push(`${itemWhField} eq ${this._odataLiteral(warehouse)}`);
      if (itemHuField) parts.push(`${itemHuField} eq ${this._odataLiteral(huId)}`);
      else parts.push(`${itemHuParentUuidField} eq guid'${huUuid}'`);
      const res = await this._get(`${base}/${itemSet}`, `$filter=${encodeURIComponent(parts.join(' and '))}&$format=json`);
      rows = Array.isArray(res) ? res : [];
    }

    const str = (it, field) => (field && it[field] != null ? String(it[field]).trim() : '');
    let guidMap = {};
    if (!itemFields.material && itemFields.materialGuid) {
      const guids = [...new Set(rows.map((it) => str(it, itemFields.materialGuid)).filter(Boolean))];
      guidMap = await this._resolveProductNumbers(model, guids);
    }
    const mapped = rows.map((it) => ({
      material: itemFields.material ? str(it, itemFields.material) : (guidMap[str(it, itemFields.materialGuid)] || ''),
      batch: str(it, itemFields.batch),
      plant: str(it, itemFields.plant),
      sloc: str(it, itemFields.sloc),
      qty: itemFields.qty ? Number(it[itemFields.qty]) || 0 : 0,
      unit: str(it, itemFields.unit)
    }));

    this._suDiag('SU contents read', {
      huService: base,
      huEntitySet: itemSet || '(no HU contents entity set)',
      warehouse,
      fieldSearched: `${itemWhField || whField},${itemHuField || itemHuParentUuidField}`,
      valueSearched: `${warehouse},${itemHuField ? huId : huUuid}`,
      huInternalNumber: internalNo,
      huExternalId: huId,
      itemCount: mapped.length,
      material: mapped.filter((m) => m.material).map((m) => m.material).join(','),
      batch: mapped.filter((m) => m.batch).map((m) => m.batch).join(','),
      plant: mapped.filter((m) => m.plant).map((m) => m.plant).join(','),
      storageLocation: mapped.filter((m) => m.sloc).map((m) => m.sloc).join(','),
      stock: mapped.reduce((sum, m) => sum + (m.qty || 0), 0)
    });

    return { items: mapped, primary: mapped.find((m) => m.material) || mapped[0] || {} };
  }


  /**
   * Read one open reservation item (UI_RESERVATION_ITM_MNG_V2) and compute its open quantity.
   */
  async _readOpenReservationItem(reservationNo, reservationItem) {
    const sResv = String(reservationNo).trim();
    const sItem = String(reservationItem).trim().padStart(4, '0');
    let resvItem = null;
    try {
      const resvPadded = sResv.padStart(10, '0');
      const resvClean = sResv.replace(/^0+/, '');
      const filter = `(Reservation eq '${resvClean}' or Reservation eq '${resvPadded}') and ReservationItem eq '${sItem}' and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
      const res = await this._get(
        '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
        `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
      );
      if (Array.isArray(res) && res.length > 0) {
        resvItem = res[0];
      } else {
        // Fallback: check if the reservation item exists in SAP but carries final issue or deletion flags
        try {
          const statusFilter = `(Reservation eq '${resvClean}' or Reservation eq '${resvPadded}') and ReservationItem eq '${sItem}'`;
          const allRes = await this._get(
            '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
            `$filter=${encodeURIComponent(statusFilter)}&$top=1&$format=json`
          );
          if (Array.isArray(allRes) && allRes.length > 0) {
            resvItem = allRes[0];
          }
        } catch (checkErr) {
          // Ignore status fallback failure; error below handles missing item
        }
      }
    } catch (err) {
      const connErr = new Error(`SAP connection failure while reading reservation ${sResv} item ${sItem}: ${err.message}`);
      connErr.status = err.status || 502;
      throw connErr;
    }
    if (!resvItem) {
      const err = new Error(`Reservation ${sResv} item ${sItem} not found or already completed in SAP.`);
      err.status = 404;
      throw err;
    }
    return { sResv, sItem, resvItem };
  }

  /**
   * All WM quants of material/plant/sloc in ANY warehouse. The warehouse is taken from the stock itself.
   */
  async _wmQuants(material, plant, sloc) {
    const m = wmKey(material);
    const w = wmKey(plant);
    if (!m || !w) return [];
    const matnr = /^\d+$/.test(m) ? m.padStart(18, '0') : m;
    const where = [`MATNR = '${matnr}'`, `AND WERKS = '${w}'`];
    if (wmKey(sloc)) where.push(`AND LGORT = '${wmKey(sloc)}'`);
    const rows = await this.rfc.readTable('LQUA', WM_QUANT_FIELDS, where);
    return rows.map((q) => ({ ...q, VERME: wmNum(q.VERME), EINME: wmNum(q.EINME) }));
  }

  /**
   * Why a quant cannot be issued for this reservation line ('' = issuable).
   * Rules: positive available stock, unrestricted (BESTQ blank), no special stock, no removal/inventory
   * block, reservation batch (if fixed) must match, and the batch must be usable (unexpired, unrestricted).
   * Requirement 4: Config list exclusions (OH1, EN1, QC/RJ types, other orders' staging bins).
   */
  _wmQuantRejection(q, resvBatch, usableBatchMap, ctx = {}) {
    if (!(q.VERME > 0)) return 'no available stock';
    if (EXCLUDED_STORAGE_TYPES.includes(q.LGTYP)) return `storage type ${q.LGTYP} is excluded`;
    if (EXCLUDED_STORAGE_TYPE_PREFIXES.some((p) => (q.LGTYP || '').startsWith(p))) {
      return `interim/excluded storage type ${q.LGTYP}`;
    }
    if (q.BESTQ) return `stock category ${q.BESTQ} (not unrestricted)`;
    if (q.SOBKZ) return `special stock ${q.SOBKZ}`;
    if (q.SKZUA || q.SKZSA) return 'blocked for stock removal';
    if (q.SKZSI) return 'blocked for inventory';

    // Exclude other orders' dynamic staging bins (Requirement 4)
    const isStagingType = /^(IP\d|PR\d)/i.test(q.LGTYP || '') || (ctx.targetType && q.LGTYP === ctx.targetType);
    const isOrderBin = /^\d{10}$/.test(q.LGPLA || '');
    if (isStagingType && isOrderBin) {
      const allowedOrder = ctx.currentOrder ? String(ctx.currentOrder).trim().padStart(10, '0') : '';
      const allowedBin = ctx.targetBin ? String(ctx.targetBin).trim().padStart(10, '0') : '';
      const binPadded = String(q.LGPLA || '').trim().padStart(10, '0');
      if (allowedOrder && binPadded !== allowedOrder && (!allowedBin || binPadded !== allowedBin)) {
        return `staged for another order (${q.LGPLA})`;
      }
    }

    if (resvBatch && q.CHARG !== resvBatch) return `batch ${q.CHARG || '(none)'} differs from reservation batch ${resvBatch}`;
    if (q.CHARG && usableBatchMap) {
      const b = usableBatchMap.get(q.CHARG.toUpperCase());
      if (!b) return `batch ${q.CHARG} is not usable (expired, restricted or no unrestricted stock)`;
      if (b.StatusState === 'Error') return `batch ${q.CHARG} is expired`;
    }
    return '';
  }

  /**
   * Check if plant + storage location is WM-managed via T320.
   * Requirement 1: item is WM-managed when T320 has an entry for plant+SLoc.
   */
  async _detectWmManaged(plant, sloc) {
    if (!plant || !sloc || !this.rfc || typeof this.rfc.readTable !== 'function') {
      return { isWm: false, warehouse: '' };
    }
    try {
      const p = wmKey(plant);
      const l = wmKey(sloc);
      const rows = await this.rfc.readTable('T320', ['WERKS', 'LGORT', 'LGNUM'], [`WERKS = '${p}'`, `AND LGORT = '${l}'`], 1);
      if (Array.isArray(rows) && rows.length > 0 && rows[0].LGNUM) {
        return { isWm: true, warehouse: String(rows[0].LGNUM).trim() };
      }
    } catch (err) {
      LOG.warn(`T320 check failed for ${plant}/${sloc}:`, err.message || err);
    }
    return { isWm: false, warehouse: '' };
  }

  /**
   * Resolves staging requirements for a WM reservation item (RESB, TR, PKHD, Order fallback).
   * Requirement 2: Read target type and bin from TR item (LTBK/LTBP) or control cycle (PKHD).
   * Order-number bin rule used only as fallback. Never hardcode IP1 or the bin.
   */
  async _resolveStagingRequirement(reservationNo, reservationItem, plant, sloc, material, orderNo = '', warehouse = '') {
    const sResv = String(reservationNo).trim();
    const sItem = String(reservationItem).trim().padStart(4, '0');
    const resvPadded = sResv.padStart(10, '0');

    let resbRow = null;
    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const rows = await this.rfc.readTable(
          'RESB',
          ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'AUFNR', 'LGTYP', 'PRVBE'],
          [`RSNUM = '${resvPadded}'`, `AND RSPOS = '${sItem}'`],
          1
        );
        if (Array.isArray(rows) && rows.length > 0) {
          resbRow = rows[0];
        }
      } catch (err) {
        LOG.warn(`RESB read failed for reservation ${sResv} item ${sItem}:`, err.message || err);
      }
    }

    const resbLgtyp = resbRow && resbRow.LGTYP ? String(resbRow.LGTYP).trim() : '';
    if (!resbLgtyp) {
      return { isStagingRequired: false };
    }

    const order = (resbRow && resbRow.AUFNR ? String(resbRow.AUFNR).trim() : '') || String(orderNo || '').trim();
    const orderPadded = order ? order.padStart(10, '0') : '';
    const prvbe = resbRow && resbRow.PRVBE ? String(resbRow.PRVBE).trim() : '';
    const bdmng = resbRow ? wmNum(resbRow.BDMNG) : 0;
    const enmng = resbRow ? wmNum(resbRow.ENMNG) : 0;
    const reqQty = Math.max(0, bdmng - enmng);
    const uom = (resbRow && resbRow.MEINS ? String(resbRow.MEINS).trim() : '') || 'KG';

    let targetType = resbLgtyp;
    let targetBin = '';
    let tbnum = '';
    let stagingSource = '';

    // Step A: Check TR item (LTBK / LTBP)
    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const trWhere = [];
        if (warehouse) {
          trWhere.push(`LGNUM = '${wmKey(warehouse)}'`);
        }
        if (orderPadded) {
          trWhere.push(`${trWhere.length ? 'AND ' : ''}BENUM = '${orderPadded}'`);
        }
        const ltbkRows = await this.rfc.readTable('LTBK', ['TBNUM', 'LGNUM', 'BWLVS', 'BENUM', 'BETYP', 'NLTYP', 'NLPLA'], trWhere, 5);
        if (Array.isArray(ltbkRows) && ltbkRows.length > 0) {
          const mvt319 = ltbkRows.find((r) => r.BWLVS === '319') || ltbkRows[0];
          tbnum = String(mvt319.TBNUM || '').trim();
          if (mvt319.NLTYP && mvt319.NLPLA) {
            targetType = String(mvt319.NLTYP).trim();
            targetBin = String(mvt319.NLPLA).trim();
            stagingSource = 'TR';
          }
        }
      } catch (err) {
        LOG.warn(`LTBK read failed for order ${order}:`, err.message || err);
      }
    }

    // Step B: Check Control Cycle (PKHD)
    if (!targetBin && this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const pkhdWhere = [`WERKS = '${wmKey(plant)}'`];
        if (prvbe) pkhdWhere.push(`AND PRVBE = '${wmKey(prvbe)}'`);
        const pkhdRows = await this.rfc.readTable('PKHD', ['MATNR', 'WERKS', 'PRVBE', 'LGNUM', 'LGTYP', 'LGPLA', 'BERKZ', 'NKDYN'], pkhdWhere, 1);
        if (Array.isArray(pkhdRows) && pkhdRows.length > 0) {
          const pk = pkhdRows[0];
          if (pk.LGTYP) targetType = String(pk.LGTYP).trim();
          if (pk.LGPLA) {
            targetBin = String(pk.LGPLA).trim();
            stagingSource = 'PKHD';
          } else if (pk.NKDYN === 'X' && (pk.BERKZ === '1' || pk.BERKZ === '2' || pk.BERKZ === '3' || pk.BERKZ === '4')) {
            targetBin = orderPadded;
            stagingSource = 'PKHD';
          }
        }
      } catch (err) {
        LOG.warn(`PKHD read failed for plant ${plant} supply area ${prvbe}:`, err.message || err);
      }
    }

    // Step C: Fallback Order-number bin rule
    if (!targetBin && orderPadded) {
      targetBin = orderPadded;
      stagingSource = 'FALLBACK_ORDER';
    }

    return {
      isStagingRequired: true,
      targetType,
      targetBin,
      tbnum,
      stagingSource,
      order,
      orderPadded,
      requiredQty: reqQty,
      uom
    };
  }

  /** Group issuable quants per Storage Unit (FEFO, then oldest GR date). */
  _wmGroupStockUnits(quants, usableBatchMap) {
    const bySu = new Map();
    for (const q of quants) {
      const key = `${q.LGNUM}|${q.LENUM}`;
      const b = q.CHARG && usableBatchMap ? usableBatchMap.get(q.CHARG.toUpperCase()) : null;
      const su = bySu.get(key) || {
        StorageUnit: wmAlphaOut(q.LENUM),
        Warehouse: q.LGNUM,
        Material: wmAlphaOut(q.MATNR),
        Plant: q.WERKS,
        StorageLocation: q.LGORT,
        StorageType: q.LGTYP,
        StorageBin: q.LGPLA,
        Batch: q.CHARG || '',
        ExpiryDate: b ? b.ExpiryDate || null : null,
        StatusState: b ? b.StatusState || 'None' : 'None',
        StatusText: b ? b.StatusText || '' : (q.CHARG ? '' : 'NOT BATCH MANAGED'),
        DaysToExpiry: b && b.DaysToExpiry !== undefined ? b.DaysToExpiry : null,
        GrDate: wmSapDate(q.WDATU),
        AvailableStock: 0,
        Unit: q.MEINS,
        QuantCount: 0,
        _batches: new Set()
      };
      su.AvailableStock = Math.round((su.AvailableStock + q.VERME) * 1000) / 1000;
      su.QuantCount += 1;
      su._batches.add(q.CHARG || '');
      bySu.set(key, su);
    }
    const list = [...bySu.values()].map(({ _batches, ...su }) => ({
      ...su,
      Batch: _batches.size > 1 ? '' : su.Batch,
      MultipleBatches: _batches.size > 1
    }));
    const far = '9999-12-31';
    return list.sort((a, b) =>
      (a.ExpiryDate || far).localeCompare(b.ExpiryDate || far) ||
      (a.GrDate || far).localeCompare(b.GrDate || far) ||
      a.StorageUnit.localeCompare(b.StorageUnit));
  }

  async _usableBatchMap(material, plant, sloc) {
    const getFn = (this.adapter && typeof this.adapter.getMaterialBatches === 'function')
      ? (m, p, l) => this.adapter.getMaterialBatches(m, p, l)
      : (this.batchesClient && typeof this.batchesClient.getMaterialBatches === 'function')
        ? (m, p, l) => this.batchesClient.getMaterialBatches(m, p, l)
        : null;
    const list = getFn ? (await getFn(material, plant, sloc)) || [] : [];
    return new Map(list.filter((b) => b && b.Batch).map((b) => [String(b.Batch).toUpperCase(), b]));
  }

  /**
   * Storage Units that are valid for ONE reservation line: same material, plant, storage location
   * (and batch, when the reservation fixes one) in the WM warehouse assigned to that storage location,
   * with unrestricted, unblocked, unexpired available stock. Nothing else is returned.
   */
  async listStockUnitsForReservationItem(reservationNo, reservationItem, options = {}) {
    if (!reservationNo || !reservationItem) {
      const err = new Error('Reservation number and item are required to list Storage Units.');
      err.status = 400;
      throw err;
    }
    const { sResv, sItem, resvItem } = await this._readOpenReservationItem(reservationNo, reservationItem);
    const material = resvItem.Product || '';
    const plant = resvItem.Plant || '';
    const sloc = resvItem.StorageLocation || '';
    const resvBatch = String(resvItem.Batch || '').trim().toUpperCase();
    const base = { ReservationNo: sResv, ReservationItem: sItem, Material: material, Plant: plant, StorageLocation: sloc, Batch: resvBatch };

    if (!sloc) {
      return { ...base, Warehouse: '', StockUnits: [], ExcludedCount: 0, Message: `Reservation item has no storage location; Storage Units cannot be determined.` };
    }

    const [quants, usableMap, activeClaims] = await Promise.all([
      this._wmQuants(material, plant, sloc).catch((err) => {
        const e = new Error(`Could not read WM stock (LQUA) for material ${material}: ${err.message}`);
        e.status = err.status || 502;
        throw e;
      }),
      this._usableBatchMap(material, plant, sloc),
      (async () => {
        try {
          const store = this._getIssuedSuStore();
          if (store && typeof store.getActiveIssuedSUs === 'function') {
            const claims = await store.getActiveIssuedSUs(material, plant, sloc);
            const excludedReference = String(options.excludeReferenceDocument || '').trim();
            return excludedReference
              ? claims.filter((claim) => String(claim.ReferenceDocument || '').trim() !== excludedReference)
              : claims;
          }
        } catch (e) {
          LOG.warn('Could not read active issued SUs in listStockUnitsForReservationItem:', e.message || e);
        }
        return [];
      })()
    ]);

    const warehouses = [...new Set(quants.map((q) => q.LGNUM).filter(Boolean))];
    const wmInfo = warehouses.length > 0
      ? { isWm: true, warehouse: warehouses[0] }
      : await this._detectWmManaged(plant, sloc);
    let staging = { isStagingRequired: false };
    if (wmInfo.isWm) {
      staging = await this._resolveStagingRequirement(sResv, sItem, plant, sloc, material, resvItem.OrderID || resvItem.OrderNo, wmInfo.warehouse);
    }

    // Requirement 3: If staging is required, staged stock = LQUA rows in that type+bin with VERME > 0,
    // no BESTQ, no SOBKZ, no SKZUA/SKZSA/SKZSI. Ignore EINME. Suggest and validate SUs from staged stock only.
    let eligibleQuants = quants;
    let stagedQty = 0;
    let plannedUnconfirmedQty = 0;
    const requiredQty = staging.requiredQty != null && staging.requiredQty > 0
      ? staging.requiredQty
      : (resvItem.ResvnItmRequiredQtyInBaseUnit != null
        ? Math.max(0, Number(resvItem.ResvnItmRequiredQtyInBaseUnit) - Number(resvItem.ResvnItmWithdrawnQtyInBaseUnit || 0))
        : (Number(resvItem.OpenQty) || 0));
    const uom = staging.uom || resvItem.BaseUnit || 'KG';

    if (staging.isStagingRequired && staging.targetType && staging.targetBin) {
      const typeBinQuants = quants.filter((q) => q.LGTYP === staging.targetType && q.LGPLA === staging.targetBin);
      const stagedQuants = typeBinQuants.filter((q) => q.VERME > 0 && !q.BESTQ && !q.SOBKZ && !q.SKZUA && !q.SKZSA && !q.SKZSI);
      stagedQty = Math.round(stagedQuants.reduce((sum, q) => sum + (Number(q.VERME) || 0), 0) * 1000) / 1000;
      plannedUnconfirmedQty = Math.round(typeBinQuants.reduce((sum, q) => sum + (Number(q.EINME) || 0), 0) * 1000) / 1000;

      // Suggest SUs from staged stock ONLY
      eligibleQuants = stagedQuants;
    }

    const suQuants = eligibleQuants.filter((q) => q.LENUM);
    const issuable = suQuants.filter((q) => !this._wmQuantRejection(q, resvBatch, usableMap, {
      targetType: staging.targetType,
      targetBin: staging.targetBin,
      currentOrder: staging.order
    }));
    const rawStockUnits = this._wmGroupStockUnits(issuable, usableMap);

    let excludedUnconfirmedCount = 0;
    const stockUnits = [];

    for (const su of rawStockUnits) {
      const suKey = wmAlphaOut(su.StorageUnit);
      const currentStock = Number(su.AvailableStock) || 0;
      const suClaims = (activeClaims || []).filter(
        (c) => c && ['issued', 'claiming'].includes(c.Status) && wmAlphaOut(c.StorageUnit) === suKey
      );

      let totalEffectiveClaim = 0;
      for (const claim of suClaims) {
        const claimed = Number(claim.IssuedQty) || 0;
        const preStock = Number(claim.PreIssueStock != null ? claim.PreIssueStock : currentStock);
        const toDeducted = Math.max(0, preStock - currentStock);
        const effective = Math.max(0, claimed - toDeducted);
        totalEffectiveClaim += effective;
      }
      totalEffectiveClaim = Math.round(totalEffectiveClaim * 1000) / 1000;

      if (totalEffectiveClaim > 0) {
        const netStock = Math.round((currentStock - totalEffectiveClaim) * 1000) / 1000;
        if (netStock <= 0) {
          excludedUnconfirmedCount++;
          continue;
        }
        su.AvailableStock = netStock;
        su.PreIssueStock = currentStock;
        su.IssuedPendingToQty = totalEffectiveClaim;
        su.StatusText = `${netStock} ${su.Unit || ''} available (${totalEffectiveClaim} ${su.Unit || ''} pending TO confirmation)`.trim();
      }
      stockUnits.push(su);
    }

    const shown = new Set(stockUnits.map((s) => s.StorageUnit));
    const allCandidateSu = quants.filter((q) => q.LENUM);
    const excludedCount = new Set(allCandidateSu.filter((q) => !shown.has(wmAlphaOut(q.LENUM))).map((q) => q.LENUM)).size;

    let message = '';
    const isFullyStaged = !staging.isStagingRequired || stagedQty >= requiredQty;

    // Requirement 5: If staged qty < required: block Complete, and return 400 before calling SAP with:
    // "Only X of Y UOM staged in <type>/<bin>. Transfer requirement <TBNUM> needs a confirmed transfer order (LT04/LT12) first."
    // Show planned-but-unconfirmed quantity (EINME) separately as "TO created, not confirmed".
    if (staging.isStagingRequired && stagedQty < requiredQty) {
      let shortfall = `Only ${stagedQty} of ${requiredQty} ${uom} staged in ${staging.targetType}/${staging.targetBin}.`;
      if (plannedUnconfirmedQty > 0) {
        shortfall += ` (${plannedUnconfirmedQty} ${uom} TO created, not confirmed).`;
      }
      shortfall += ` Transfer requirement ${staging.tbnum || ''} needs a confirmed transfer order (LT04/LT12) first.`;
      message = shortfall.trim();
    } else if (!stockUnits.length) {
      const loose = quants.filter((q) => !q.LENUM && !this._wmQuantRejection(q, resvBatch, usableMap, { targetType: staging.targetType, targetBin: staging.targetBin, currentOrder: staging.order }));
      const where = `material ${material} in plant ${plant} / storage location ${sloc}` + (resvBatch ? ` / batch ${resvBatch}` : '');
      if (excludedUnconfirmedCount > 0) {
        message = `All matching Storage Units for ${where} are currently pending Transfer Order confirmation.`;
      } else if (!quants.length) {
        message = `No WM stock for ${where}.`;
      } else if (loose.length) {
        const total = Math.round(loose.reduce((n, q) => n + q.VERME, 0) * 1000) / 1000;
        const bins = [...new Set(loose.map((q) => `${q.LGNUM} ${q.LGTYP}/${q.LGPLA}`))].slice(0, 3).join(', ');
        message = `No Storage Unit for ${where}: its stock (${total} ${loose[0].MEINS} in ${bins}) is not SU-managed. Issue without SU scan.`;
      } else {
        message = `No issuable Storage Unit for ${where} (warehouse ${warehouses.join(',')}).`;
      }
    }

    return {
      ...base,
      Warehouse: wmInfo.warehouse || warehouses.join(','),
      StockUnits: stockUnits,
      ExcludedCount: excludedCount,
      ExcludedUnconfirmedCount: excludedUnconfirmedCount,
      Message: message,
      StagedQty: stagedQty,
      RequiredQty: requiredQty,
      PlannedUnconfirmedQty: plannedUnconfirmedQty,
      TargetStorageType: staging.targetType || '',
      TargetStorageBin: staging.targetBin || '',
      TransferRequirement: staging.tbnum || '',
      StagingResolutionSource: staging.stagingSource || '',
      IsStagingRequired: !!staging.isStagingRequired,
      IsFullyStaged: isFullyStaged
    };
  }

  /**
   * Check staging for a reservation (single item or all open items).
   * Requirement 5: If staged qty < required: block Complete, and return 400 before calling SAP with:
   * "Only X of Y UOM staged in <type>/<bin>. Transfer requirement <TBNUM> needs a confirmed transfer order (LT04/LT12) first."
   * Show planned-but-unconfirmed quantity (EINME) separately as "TO created, not confirmed".
   * Multiple items in one reservation: check each.
   */
  async checkStagingForReservation(reservationNo, reservationItem = null) {
    const sResv = String(reservationNo || '').trim();
    if (!sResv) return { isStaged: true };

    const resvPadded = sResv.padStart(10, '0');
    let itemsToCheck = [];

    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const where = [`RSNUM = '${resvPadded}'`, `AND XLOEK = ''`, `AND KZEAR = ''`];
        if (reservationItem) {
          where.push(`AND RSPOS = '${String(reservationItem).trim().padStart(4, '0')}'`);
        }
        const resbRows = await this.rfc.readTable(
          'RESB',
          ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'AUFNR', 'LGTYP', 'PRVBE'],
          where,
          50
        );
        if (Array.isArray(resbRows) && resbRows.length > 0) {
          itemsToCheck = resbRows;
        }
      } catch (err) {
        LOG.warn(`RESB check failed for reservation ${sResv}:`, err.message || err);
      }
    }

    if (itemsToCheck.length === 0) {
      if (!reservationItem) return { isStaged: true };
      try {
        const suResult = await this.listStockUnitsForReservationItem(sResv, reservationItem);
        if (suResult && suResult.IsStagingRequired && !suResult.IsFullyStaged) {
          return { isStaged: false, error: suResult.Message, details: suResult };
        }
      } catch (e) {
        LOG.warn(`listStockUnitsForReservationItem fallback check failed:`, e.message || e);
      }
      return { isStaged: true };
    }

    for (const item of itemsToCheck) {
      const plant = String(item.WERKS || '').trim();
      const sloc = String(item.LGORT || '').trim();
      const lgtyp = String(item.LGTYP || '').trim();
      if (!lgtyp) continue; // non-staging item

      const wmInfo = await this._detectWmManaged(plant, sloc);
      if (!wmInfo.isWm) continue; // non-WM item

      const suResult = await this.listStockUnitsForReservationItem(sResv, item.RSPOS);
      if (suResult && suResult.IsStagingRequired && !suResult.IsFullyStaged) {
        return {
          isStaged: false,
          error: suResult.Message,
          details: suResult,
          failedItem: item.RSPOS
        };
      }
    }

    return { isStaged: true };
  }

  /**
   * Resolve a scanned/selected classic-WM Storage Unit (LENUM) against one reservation line.
   * Returns null when the SU does not exist in the WM warehouse (caller falls back to EWM HU lookup).
   * Throws 409 when the SU exists but is not valid for this line.
   */
  async _resolveWmStockUnit(sSu, ctx) {
    const lenum = wmKey(sSu);
    if (!lenum || lenum.length > 20) return null;
    const lenumIn = /^\d+$/.test(lenum) ? lenum.padStart(20, '0') : lenum;
    let quants = [];
    try {
      const rows = await this.rfc.readTable('LQUA', WM_QUANT_FIELDS, [`LENUM = '${lenumIn}'`]);
      quants = rows.map((q) => ({ ...q, VERME: wmNum(q.VERME), EINME: wmNum(q.EINME) }));
    } catch (err) {
      LOG.warn(`WM SU lookup skipped (LQUA read failed): ${err.message}`);
      return null;
    }
    if (!quants.length) return null;

    const usableMap = new Map((ctx.usableBatches || []).filter((b) => b && b.Batch).map((b) => [String(b.Batch).toUpperCase(), b]));
    const sameLine = quants.filter((q) => wmAlphaOut(q.MATNR) === wmAlphaOut(ctx.material) && q.WERKS === ctx.plant && (!ctx.sloc || q.LGORT === ctx.sloc));
    const suLabel = wmAlphaOut(lenumIn);
    if (!sameLine.length) {
      const q = quants[0];
      const err = new Error(
        `Storage Unit ${suLabel} holds material ${wmAlphaOut(q.MATNR)} in plant ${q.WERKS} / storage location ${q.LGORT}, ` +
        `but reservation ${ctx.sResv} item ${ctx.sItem} needs material ${ctx.material} in ${ctx.plant} / ${ctx.sloc}. Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    // Validate staging type and bin (Requirement 3: Suggest and validate SUs from staged stock only)
    if (ctx.isStagingRequired && ctx.targetType && ctx.targetBin) {
      const stagedQuant = sameLine.find((q) => q.LGTYP === ctx.targetType && q.LGPLA === ctx.targetBin);
      if (!stagedQuant) {
        const q0 = sameLine[0];
        const err = new Error(
          `Storage Unit ${suLabel} is located in ${q0.LGTYP}/${q0.LGPLA}, but reservation item requires staged stock in ${ctx.targetType}/${ctx.targetBin}. Goods Issue is blocked.`
        );
        err.status = 409;
        throw err;
      }
    }

    const issuable = sameLine.filter((q) => !this._wmQuantRejection(q, ctx.resvBatch, usableMap, {
      targetType: ctx.targetType,
      targetBin: ctx.targetBin,
      currentOrder: ctx.order
    }));
    if (!issuable.length) {
      const err = new Error(`Storage Unit ${suLabel} cannot be issued: ${this._wmQuantRejection(sameLine[0], ctx.resvBatch, usableMap, { targetType: ctx.targetType, targetBin: ctx.targetBin, currentOrder: ctx.order })}.`);
      err.status = 409;
      throw err;
    }
    const [su] = this._wmGroupStockUnits(issuable, usableMap);
    return { su, lenumIn };
  }

  /**
   * Authoritative SU -> Stock -> Batch resolution for Goods Issue.
   */
  async resolveStockUnitForGoodsIssue(suBarcode, reservationNo, reservationItem) {
    if (!suBarcode || typeof suBarcode !== 'string' || !suBarcode.trim()) {
      const err = new Error('Stock Unit / SU barcode is required.');
      err.status = 400;
      throw err;
    }
    if (!reservationNo || !reservationItem) {
      const err = new Error('Reservation number and item are required for SU validation.');
      err.status = 400;
      throw err;
    }

    const sSu = String(suBarcode || '').replace(/[\r\n\t]/g, '').trim();

    // STEP 1: Load reservation item to get expected values (Reservation-First)
    const { sResv, sItem, resvItem } = await this._readOpenReservationItem(reservationNo, reservationItem);

    const resvMaterial = resvItem.Product || '';
    const resvPlant = resvItem.Plant || '';
    const resvSLoc = resvItem.StorageLocation || '';
    const reqQty = Number(resvItem.ResvnItmRequiredQtyInBaseUnit || 0);
    const wdnQty = Number(resvItem.ResvnItmWithdrawnQtyInBaseUnit || 0);
    const openQty = Math.max(0, reqQty - wdnQty);
    const resvUnit = resvItem.BaseUnit || resvItem.ResvnItemComponentUnit || resvItem.EntryUnit || resvItem.UnitOfMeasure || '';

    if (openQty <= 0) {
      const err = new Error(
        `Reservation ${reservationNo} item ${reservationItem} has no open quantity remaining (already fully issued).`
      );
      err.status = 400;
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // STEP 2: Read actual current stock and authentic batches from SAP
    // ──────────────────────────────────────────────────────────
    let currentStock = null;
    let baseUnit = resvUnit;

    if (resvPlant && resvSLoc) {
      try {
        const slocFilter = `Material eq '${encodeURIComponent(resvMaterial)}' and Plant eq '${encodeURIComponent(resvPlant)}' and StorageLocation eq '${encodeURIComponent(resvSLoc)}'`;
        const slocRes = await this._get(
          '/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps',
          `$filter=${slocFilter}&$format=json`
        );
        if (Array.isArray(slocRes) && slocRes.length > 0 && slocRes[0].CurrentStock !== undefined && slocRes[0].CurrentStock !== null) {
          currentStock = Number(slocRes[0].CurrentStock);
          if (slocRes[0].BaseUnit) baseUnit = slocRes[0].BaseUnit;
        }
      } catch (err) {
        LOG.warn(`MaterialStorLocHelps query failed for ${resvMaterial}/${resvPlant}/${resvSLoc}: ${err.message}`);
      }

      if (currentStock === null) {
        try {
          const stockFilter = `Material eq '${encodeURIComponent(resvMaterial)}' and Plant eq '${encodeURIComponent(resvPlant)}' and StorageLocation eq '${encodeURIComponent(resvSLoc)}'`;
          const stockRes = await this._get(
            '/sap/opu/odata/sap/C_STOCKQUANTITYVALUEBYTYPE_CDS/C_STOCKQUANTITYVALUEBYTYPE',
            `$filter=${stockFilter}&$format=json`
          );
          if (Array.isArray(stockRes) && stockRes.length > 0 && stockRes[0].MatlWrhsStkQtyInMatlBaseUnit !== undefined && stockRes[0].MatlWrhsStkQtyInMatlBaseUnit !== null) {
            currentStock = Number(stockRes[0].MatlWrhsStkQtyInMatlBaseUnit);
            if (stockRes[0].MaterialBaseUnit) baseUnit = stockRes[0].MaterialBaseUnit;
          }
        } catch (err) {
          LOG.warn(`C_STOCKQUANTITYVALUEBYTYPE query failed for ${resvMaterial}/${resvPlant}/${resvSLoc}: ${err.message}`);
        }
      }
    }

    const getBatchesFn = (mat, plt, sloc) => {
      if (this.adapter && typeof this.adapter.getMaterialBatches === 'function') {
        return this.adapter.getMaterialBatches(mat, plt, sloc);
      }
      if (this.batchesClient && typeof this.batchesClient.getMaterialBatches === 'function') {
        return this.batchesClient.getMaterialBatches(mat, plt, sloc);
      }
      return [];
    };

    const usableBatches = await getBatchesFn(resvMaterial, resvPlant, resvSLoc);

    // ──────────────────────────────────────────────────────────
    // STEP 3: Check if scanned barcode directly matches an SAP Batch or GS1 Barcode
    // ──────────────────────────────────────────────────────────
    const directBatch = usableBatches.find(
      (b) => b.Batch && b.Batch.trim().toUpperCase() === sSu.toUpperCase()
    );

    let gs1Batch = null;
    let rawBatchCandidate = sSu;
    const gs1Match = /(?:^|[()（）\x1d])10[()（）]?([A-Za-z0-9_-]{1,20})/i.exec(sSu);
    if (!directBatch && gs1Match) {
      rawBatchCandidate = gs1Match[1].trim();
      gs1Batch = usableBatches.find(
        (b) => b.Batch && b.Batch.trim().toUpperCase() === rawBatchCandidate.toUpperCase()
      );
    }

    const batchDirectMatch = directBatch || gs1Batch;
    if (batchDirectMatch) {
      const resolvedStock = batchDirectMatch.AvailableStock !== null && batchDirectMatch.AvailableStock !== undefined
        ? batchDirectMatch.AvailableStock
        : currentStock;
      const maxIssueQty = resolvedStock !== null ? Math.min(resolvedStock, openQty) : openQty;
      this._suDiag('SU barcode matched SAP Batch directly', {
        inputBarcode: sSu,
        identifierType: directBatch ? 'Direct SAP Batch identifier' : 'GS1 Barcode AI (10) Batch identifier',
        batch: batchDirectMatch.Batch,
        material: resvMaterial,
        plant: resvPlant,
        storageLocation: resvSLoc,
        stock: resolvedStock
      });

      return {
        SuBarcode: sSu,
        SuExists: true,
        SuNotFoundReason: '',
        ResolvedType: directBatch ? 'BATCH' : 'GS1_BARCODE',
        HuService: '',
        HuInternalNumber: sSu,
        HuExternalId: sSu,
        DeliveryDocument: '',
        DeliveryDocumentItem: '',
        Material: resvMaterial,
        MaterialDesc: resvItem.ProductName || '',
        Plant: resvPlant,
        StorageLocation: resvSLoc,
        CurrentStock: resolvedStock,
        SuStockQty: resolvedStock,
        BaseUnit: baseUnit,
        Batches: usableBatches,
        DeterminedBatch: batchDirectMatch.Batch,
        DeterminedBatchExpiry: batchDirectMatch.ExpiryDate || null,
        DeterminedBatchStatusState: batchDirectMatch.StatusState || 'None',
        DeterminedBatchStatusText: batchDirectMatch.StatusText || 'unknown',
        DeterminedBatchDaysToExpiry: batchDirectMatch.DaysToExpiry !== undefined ? batchDirectMatch.DaysToExpiry : null,
        MultipleBatches: false,
        NoBatchAvailable: false,
        ReservationNo: sResv,
        ReservationItem: sItem,
        OrderNo: resvItem.OrderID || '',
        MaterialMatch: true,
        PlantMatch: true,
        SLocMatch: true,
        ReservationRemainingQty: openQty,
        ReservationRequiredQty: reqQty,
        ReservationWithdrawnQty: wdnQty,
        MaxIssueQty: maxIssueQty,
        Unit: baseUnit
      };
    }

    // ──────────────────────────────────────────────────────────
    // STEP 3B: If not in usable batches, check if barcode is an authentic SAP Batch
    // in LO_BM_BATCH_SRV that is expired, restricted, or deleted.
    // In S/4HANA, standard batch CHARG is max 10 chars; avoid facet errors on longer values.
    // ──────────────────────────────────────────────────────────
    if (rawBatchCandidate && rawBatchCandidate.length <= 10) {
      try {
        const batchQuery = `Material eq '${encodeURIComponent(resvMaterial)}' and Batch eq '${encodeURIComponent(rawBatchCandidate)}'`;
      const rawBatches = await this._get(
        '/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch',
        `$filter=${batchQuery}&$top=1&$format=json`
      );
      if (Array.isArray(rawBatches) && rawBatches.length > 0) {
        const rawB = rawBatches[0];
        const expFormatted = this._formatDate(rawB.ShelfLifeExpirationDate);
        const status = this._enrichBatchStatus(expFormatted);
        const availableBatchList = usableBatches.map((b) => b.Batch).slice(0, 6).join(', ');

        if (rawB.BatchIsMarkedForDeletion) {
          const delErr = new Error(
            `Batch ${rawBatchCandidate} for Material ${resvMaterial} is marked for deletion in SAP. Goods Issue is blocked.`
          );
          delErr.status = 422;
          delErr.details = {
            code: 'BATCH_DELETED',
            material: resvMaterial,
            plant: resvPlant,
            storageLocation: resvSLoc,
            currentStock,
            baseUnit,
            availableBatches: usableBatches
          };
          throw delErr;
        }

        if (rawB.MatlBatchIsInRstrcdUseStock) {
          const rstrErr = new Error(
            `Batch ${rawBatchCandidate} for Material ${resvMaterial} is in restricted-use stock in SAP. Goods Issue is blocked.`
          );
          rstrErr.status = 422;
          rstrErr.details = {
            code: 'BATCH_RESTRICTED',
            material: resvMaterial,
            plant: resvPlant,
            storageLocation: resvSLoc,
            currentStock,
            baseUnit,
            availableBatches: usableBatches
          };
          throw rstrErr;
        }

        if (status.StatusState === 'Error' || status.StatusText === 'EXPIRED') {
          const expErr = new Error(
            `Batch ${rawBatchCandidate} for Material ${resvMaterial} in Plant ${resvPlant} is EXPIRED (SLED: ${expFormatted || 'expired'}). ` +
            `Goods Issue cannot be posted for expired stock. ` +
            (availableBatchList ? `Available active batches: ${availableBatchList}.` : 'No active batches available.')
          );
          expErr.status = 422;
          expErr.details = {
            code: 'BATCH_EXPIRED',
            material: resvMaterial,
            plant: resvPlant,
            storageLocation: resvSLoc,
            currentStock,
            baseUnit,
            availableBatches: usableBatches
          };
          throw expErr;
        }
      }
      } catch (checkErr) {
        if (checkErr.status === 422) throw checkErr;
        LOG.warn(`Batch check before HU lookup encountered error: ${checkErr.message}`);
      }
    }

    // ──────────────────────────────────────────────────────────
    // STEP 3C: Classic WM Storage Unit (LQUA.LENUM) — the SU type used in warehouse W01.
    // ──────────────────────────────────────────────────────────
    let stagingInfo = { isStagingRequired: false };
    const wmManaged = await this._detectWmManaged(resvPlant, resvSLoc);
    if (wmManaged.isWm) {
      stagingInfo = await this._resolveStagingRequirement(sResv, sItem, resvPlant, resvSLoc, resvMaterial, resvItem.OrderID || resvItem.OrderNo, wmManaged.warehouse);
    }
    const wm = await this._resolveWmStockUnit(sSu, {
      sResv, sItem, material: resvMaterial, plant: resvPlant, sloc: resvSLoc,
      resvBatch: String(resvItem.Batch || '').trim().toUpperCase(), usableBatches,
      isStagingRequired: stagingInfo.isStagingRequired,
      targetType: stagingInfo.targetType,
      targetBin: stagingInfo.targetBin,
      order: stagingInfo.order
    });
    if (wm) {
      const { su } = wm;
      let activeClaims = [];
      try {
        const store = this._getIssuedSuStore();
        if (store && typeof store.getActiveIssuedSUs === 'function') {
          activeClaims = await store.getActiveIssuedSUs(resvMaterial, resvPlant, resvSLoc);
        }
      } catch (e) {
        LOG.warn('Could not read active issued SUs in resolveStockUnitForGoodsIssue:', e.message || e);
      }
      const suAlpha = wmAlphaOut(su.StorageUnit);
      const origStock = Number(su.AvailableStock) || 0;
      const suClaims = (activeClaims || []).filter(
        (c) => c && ['issued', 'claiming'].includes(c.Status) && wmAlphaOut(c.StorageUnit) === suAlpha
      );

      let totalEffectiveClaim = 0;
      for (const claim of suClaims) {
        const claimed = Number(claim.IssuedQty) || 0;
        const preStock = Number(claim.PreIssueStock != null ? claim.PreIssueStock : origStock);
        const toDeducted = Math.max(0, preStock - origStock);
        totalEffectiveClaim += Math.max(0, claimed - toDeducted);
      }
      totalEffectiveClaim = Math.round(totalEffectiveClaim * 1000) / 1000;
      const netStock = Math.max(0, Math.round((origStock - totalEffectiveClaim) * 1000) / 1000);

      if (totalEffectiveClaim > 0 && netStock <= 0) {
        return {
          SuBarcode: sSu,
          SuExists: false,
          SuNotFoundReason: `Storage Unit ${su.StorageUnit} is already issued (pending Transfer Order confirmation).`,
          ResolvedType: 'WM_STORAGE_UNIT',
          Material: resvMaterial,
          Plant: resvPlant,
          StorageLocation: resvSLoc
        };
      }
      const suStock = totalEffectiveClaim > 0 ? netStock : origStock;
      const stock = currentStock !== null && currentStock !== undefined ? Math.min(currentStock, suStock) : suStock;
      return {
        SuBarcode: sSu,
        SuExists: true,
        SuNotFoundReason: '',
        ResolvedType: 'WM_STORAGE_UNIT',
        HuService: `LQUA/${su.Warehouse}`,
        HuInternalNumber: wm.lenumIn,
        HuExternalId: su.StorageUnit,
        DeliveryDocument: '',
        DeliveryDocumentItem: '',
        Material: resvMaterial,
        MaterialDesc: resvItem.ProductName || '',
        Plant: resvPlant,
        StorageLocation: resvSLoc,
        CurrentStock: stock,
        SuStockQty: suStock,
        BaseUnit: baseUnit,
        Batches: usableBatches,
        DeterminedBatch: su.Batch,
        DeterminedBatchExpiry: su.ExpiryDate,
        DeterminedBatchStatusState: su.StatusState,
        DeterminedBatchStatusText: su.StatusText || (su.Batch ? '' : 'SU BATCH NOT STATED'),
        DeterminedBatchDaysToExpiry: su.DaysToExpiry,
        MultipleBatches: su.MultipleBatches,
        NoBatchAvailable: !su.Batch && !su.MultipleBatches,
        ReservationNo: sResv,
        ReservationItem: sItem,
        OrderNo: resvItem.OrderID || '',
        MaterialMatch: true,
        PlantMatch: true,
        SLocMatch: true,
        ReservationRemainingQty: openQty,
        ReservationRequiredQty: reqQty,
        ReservationWithdrawnQty: wdnQty,
        MaxIssueQty: Math.min(stock, openQty),
        Unit: baseUnit
      };
    }

    // ──────────────────────────────────────────────────────────
    // STEP 3D: Check if scanned barcode is an authentic SAP Serial Number
    // ──────────────────────────────────────────────────────────
    const serialRes = await this._resolveSerialNumber(sSu, {
      sResv,
      sItem,
      resvMaterial,
      resvPlant,
      resvSLoc,
      openQty,
      reqQty,
      wdnQty,
      currentStock,
      baseUnit,
      usableBatches,
      resvItem
    });
    if (serialRes) {
      return serialRes;
    }

    // ──────────────────────────────────────────────────────────
    // STEP 4: Resolve physical Handling Unit / Storage Unit in SAP (if available)
    // ──────────────────────────────────────────────────────────
    let huModel = null;
    try {
      huModel = await this._discoverHuModel();
    } catch (discoverErr) {
      if (discoverErr.status === 404 || discoverErr.status === 422) {
        if (usableBatches.length > 0) {
          const availableBatchList = usableBatches.map((b) => b.Batch).slice(0, 6).join(', ');
          discoverErr.message += ` For Material ${resvMaterial} in Plant ${resvPlant} / Storage Location ${resvSLoc}, available batches in unrestricted stock: ${availableBatchList} (${currentStock} ${baseUnit} available).`;
        }
        discoverErr.details = {
          code: 'SU_NOT_FOUND',
          barcode: sSu,
          reservationNo: sResv,
          reservationItem: sItem,
          material: resvMaterial,
          materialDesc: resvItem.ProductName || '',
          plant: resvPlant,
          storageLocation: resvSLoc,
          currentStock,
          baseUnit,
          availableBatches: usableBatches
        };
      }
      throw discoverErr;
    }

    let huObject = null;
    try {
      huObject = await this._findHuByBarcode(huModel, sSu);
    } catch (findErr) {
      if (findErr.status === 404) {
        if (huModel && huModel.base && huModel.base.includes('PICKLIST_PAPER_SRV')) {
          const availableBatchList = usableBatches.map((b) => b.Batch).slice(0, 6).join(', ');
          const err = new Error(
            `Stock Unit / Barcode "${sSu}" was NOT found in SAP. ` +
            `Reservation ${sResv} item ${sItem} expects Material ${resvMaterial} ` +
            `(${resvItem.ProductName || ''}) in Plant ${resvPlant} / Storage Location ${resvSLoc} ` +
            `(${currentStock} ${baseUnit} unrestricted stock). ` +
            (availableBatchList
              ? `To issue goods, scan an authentic Batch barcode or select an available batch: ${availableBatchList}.`
              : 'No valid batches found for this material.')
          );
          err.status = 404;
          err.details = {
            code: 'SU_NOT_FOUND',
            barcode: sSu,
            reservationNo: sResv,
            reservationItem: sItem,
            material: resvMaterial,
            materialDesc: resvItem.ProductName || '',
            plant: resvPlant,
            storageLocation: resvSLoc,
            currentStock,
            baseUnit,
            availableBatches: usableBatches
          };
          throw err;
        }

        if (usableBatches.length > 0) {
          const availableBatchList = usableBatches.map((b) => b.Batch).slice(0, 6).join(', ');
          findErr.message += ` For Material ${resvMaterial} in Plant ${resvPlant} / Storage Location ${resvSLoc}, available batches in unrestricted stock: ${availableBatchList} (${currentStock} ${baseUnit} available).`;
        }
        findErr.details = {
          code: 'SU_NOT_FOUND',
          barcode: sSu,
          reservationNo: sResv,
          reservationItem: sItem,
          material: resvMaterial,
          materialDesc: resvItem.ProductName || '',
          plant: resvPlant,
          storageLocation: resvSLoc,
          currentStock,
          baseUnit,
          availableBatches: usableBatches
        };
      }
      throw findErr;
    }

    const suContents = await this._readHuContents(huModel, huObject);

    const suPrimary = suContents.primary || {};
    const suMaterial = suPrimary.material || '';
    const suPlant = suPrimary.plant || '';
    const suSLoc = suPrimary.sloc || '';
    const suQty = Number(suPrimary.qty) > 0 ? Number(suPrimary.qty) : 0;
    const suUnit = suPrimary.unit || '';
    const suExternalId = String(huObject[huModel.huIdField] || sSu).trim();
    const suInternalNo = String((huModel.huUuidField && huObject[huModel.huUuidField]) || suExternalId).trim();
    const huService = huModel.base;
    const ewmWarehouse = huModel.warehouse;
    const resolvedType = 'HANDLING_UNIT';

    if (!suMaterial) {
      this._suDiag('SU resolution failed: no material in HU contents', {
        inputBarcode: sSu,
        huService,
        warehouse: ewmWarehouse,
        huInternalNumber: suInternalNo,
        huExternalId: suExternalId
      });
      const err = new Error(
        `Stock Unit ${sSu} exists in SAP EWM warehouse ${ewmWarehouse} as Handling Unit ${suExternalId} ` +
        `(${huService}), but its contents contain no material. Goods Issue cannot determine what to issue.`
      );
      err.status = 422;
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // STEP 5: Cross-validate the resolved SU/HU object's contents against reservation
    // ──────────────────────────────────────────────────────────
    const materialMatch = suMaterial.replace(/^0+/, '') === resvMaterial.replace(/^0+/, '');
    const plantMatch = !suPlant || !resvPlant || suPlant === resvPlant;
    const slocMatch = !suSLoc || !resvSLoc || suSLoc === resvSLoc;

    if (!materialMatch) {
      const err = new Error(
        `Material mismatch: Stock Unit ${sSu} (HU ${suExternalId}) contains material ${suMaterial}, ` +
        `but reservation ${sResv} item ${sItem} expects material ${resvMaterial}. ` +
        `Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    if (!plantMatch) {
      const err = new Error(
        `Plant mismatch: Stock Unit ${sSu} (HU ${suExternalId}) is in plant ${suPlant}, ` +
        `but reservation ${sResv} item ${sItem} expects plant ${resvPlant}. ` +
        `Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    if (!slocMatch) {
      const err = new Error(
        `Storage Location mismatch: Stock Unit ${sSu} (HU ${suExternalId}) is in storage location ` +
        `${suSLoc}, but reservation ${sResv} item ${sItem} expects storage location ${resvSLoc}. ` +
        `Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // STEP 6: Constrain stock by physical SU/HU quantity
    // ──────────────────────────────────────────────────────────
    const effectivePlant = resvPlant || suPlant;
    const effectiveSLoc = resvSLoc || suSLoc;

    if (currentStock !== null && currentStock !== undefined && currentStock > 0 && suQty > 0) {
      currentStock = Math.min(currentStock, suQty);
    }

    if (currentStock !== null && currentStock !== undefined && currentStock <= 0) {
      const err = new Error(
        `Stock Unit ${sSu} resolved to material ${resvMaterial} in plant ${effectivePlant} / ` +
        `storage location ${effectiveSLoc}, but SAP reports no stock there ` +
        `(SU/HU physical quantity: ${suQty} ${suUnit || '?'}). No Goods Issue is possible.`
      );
      err.status = 422;
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // STEP 7: Determine batch from HU contents if present
    // ──────────────────────────────────────────────────────────
    const suBatches = [...new Set(suContents.items.map((i) => i.batch).filter(Boolean))];

    let determinedBatch = '';
    let determinedBatchExpiry = null;
    let determinedBatchStatus = { StatusState: 'None', StatusText: 'SU BATCH NOT STATED', DaysToExpiry: null };
    let multipleBatches = false;
    let noBatchAvailable = false;

    if (suBatches.length === 0) {
      noBatchAvailable = true;
      determinedBatchStatus = { StatusState: 'None', StatusText: 'SU BATCH NOT STATED', DaysToExpiry: null };
    } else if (suBatches.length > 1) {
      multipleBatches = true;
      this._suDiag('SU resolution: multiple batches inside HU', {
        inputBarcode: sSu,
        huInternalNumber: suInternalNo,
        batches: suBatches.join(',')
      });
    } else {
      const suBatchSel = suBatches[0];
      const candidate = usableBatches.find((b) => b.Batch && b.Batch.toUpperCase() === suBatchSel.toUpperCase());
      if (!candidate) {
        const err = new Error(
          `Batch mismatch: Stock Unit ${sSu} (HU ${suExternalId}) contains batch ${suBatchSel}, ` +
          `which is not a valid/usable batch for material ${resvMaterial} in plant ${effectivePlant} / ` +
          `storage location ${effectiveSLoc}. Goods Issue is blocked.`
        );
        err.status = 409;
        throw err;
      }
      determinedBatch = suBatchSel;
      determinedBatchExpiry = candidate.ExpiryDate || null;
      determinedBatchStatus = {
        StatusState: candidate.StatusState || 'None',
        StatusText: candidate.StatusText || 'unknown',
        DaysToExpiry: candidate.DaysToExpiry !== undefined ? candidate.DaysToExpiry : null
      };
    }

    const availableStock = currentStock !== null && currentStock !== undefined
      ? currentStock
      : (suQty > 0 ? suQty : null);
    const maxIssueQty = availableStock !== null
      ? Math.min(availableStock, openQty)
      : openQty;

    this._suDiag('SU resolution complete', {
      inputBarcode: sSu,
      huService,
      warehouse: ewmWarehouse,
      huInternalNumber: suInternalNo,
      huExternalId: suExternalId,
      material: resvMaterial,
      batch: determinedBatch,
      plant: effectivePlant,
      storageLocation: effectiveSLoc,
      stock: currentStock,
      maxIssueQty
    });

    return {
      SuBarcode: sSu,
      SuExists: true,
      SuNotFoundReason: '',
      ResolvedType: resolvedType,
      HuService: huService,
      HuInternalNumber: suInternalNo,
      HuExternalId: suExternalId,
      DeliveryDocument: suInternalNo.length <= 10 ? suInternalNo : '',
      DeliveryDocumentItem: '',
      Material: resvMaterial,
      MaterialDesc: resvItem.ProductName || '',
      Plant: effectivePlant,
      StorageLocation: effectiveSLoc,
      CurrentStock: currentStock,
      SuStockQty: suQty > 0 ? suQty : (currentStock !== null && currentStock !== undefined ? currentStock : null),
      BaseUnit: baseUnit,
      Batches: usableBatches,
      DeterminedBatch: determinedBatch,
      DeterminedBatchExpiry: determinedBatchExpiry,
      DeterminedBatchStatusState: determinedBatchStatus.StatusState,
      DeterminedBatchStatusText: determinedBatchStatus.StatusText,
      DeterminedBatchDaysToExpiry: determinedBatchStatus.DaysToExpiry,
      MultipleBatches: multipleBatches,
      NoBatchAvailable: noBatchAvailable,
      ReservationNo: sResv,
      ReservationItem: sItem,
      OrderNo: resvItem.OrderID || '',
      MaterialMatch: materialMatch,
      PlantMatch: plantMatch,
      SLocMatch: slocMatch,
      ReservationRemainingQty: openQty,
      ReservationRequiredQty: reqQty,
      ReservationWithdrawnQty: wdnQty,
      MaxIssueQty: maxIssueQty,
      Unit: baseUnit
    };
  }

  /**
   * Resolve scanned barcode as an authentic SAP Serial Number.
   * Checks /sap/opu/odata/sap/UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber
   * with fallback to RFC EQUI and JEST (status I0184 = ESTO).
   * Validates material, plant, storage location, and unrestricted-use stock.
   */
  async _resolveSerialNumber(sBarcode, ctx) {
    if (!sBarcode || typeof sBarcode !== 'string') return null;
    const sSerial = sBarcode.replace(/[\r\n\t]/g, '').trim().toUpperCase();
    if (!sSerial) return null;

    const resvMat = ctx.resvMaterial || '';
    const resvMatClean = resvMat.replace(/^0+/, '');
    const resvMatPadded = resvMat.padStart(18, '0');
    const resvPlant = ctx.resvPlant || '';
    const resvSLoc = ctx.resvSLoc || '';
    const openQty = ctx.openQty || 0;
    const reqQty = ctx.reqQty || 0;
    const wdnQty = ctx.wdnQty || 0;
    const currentStock = ctx.currentStock;
    const baseUnit = ctx.baseUnit || 'EA';
    const usableBatches = ctx.usableBatches || [];
    const resvItem = ctx.resvItem || {};

    let serialRecord = null;

    // Attempt 1: UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber
    try {
      const serialFilter = `SerialNumber eq '${encodeURIComponent(sSerial)}' and Material eq '${encodeURIComponent(resvMatClean)}'`;
      const rows = await this._get(
        '/sap/opu/odata/sap/UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber',
        `$filter=${encodeURIComponent(serialFilter)}&$format=json`
      );
      if (Array.isArray(rows) && rows.length > 0) {
        serialRecord = rows[0];
      }
    } catch (odataErr) {
      LOG.warn(`UI_MATERIALSERIALNUMBER query failed for serial ${sSerial} / material ${resvMatClean}: ${odataErr.message}`);
    }

    // Attempt 2: If not found with exact material filter, check if serial belongs to ANOTHER material in SAP
    if (!serialRecord) {
      try {
        const anySerialFilter = `SerialNumber eq '${encodeURIComponent(sSerial)}'`;
        const anyRows = await this._get(
          '/sap/opu/odata/sap/UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber',
          `$filter=${encodeURIComponent(anySerialFilter)}&$top=1&$format=json`
        );
        if (Array.isArray(anyRows) && anyRows.length > 0) {
          const other = anyRows[0];
          const otherMatClean = (other.Material || '').replace(/^0+/, '');
          if (otherMatClean && otherMatClean !== resvMatClean) {
            const err = new Error(
              `Serial Number "${sSerial}" belongs to Material ${other.Material} (${other.Material_Text || ''}), ` +
              `but reservation ${ctx.sResv} item ${ctx.sItem} requires Material ${resvMatClean}. Goods Issue is blocked.`
            );
            err.status = 409;
            throw err;
          }
          serialRecord = other;
        }
      } catch (err) {
        if (err.status === 409) throw err;
      }
    }

    // Attempt 3: RFC Fallback via EQUI and JEST if OData was unavailable
    if (!serialRecord && this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const equiRows = await this.rfc.readTable('EQUI', ['EQUNR', 'SERNR', 'MATNR', 'WERK', 'LAGER'], [
          `SERNR = '${sSerial}'`,
          `AND ( MATNR = '${resvMatClean}' OR MATNR = '${resvMatPadded}' )`
        ]);
        if (Array.isArray(equiRows) && equiRows.length > 0) {
          const equi = equiRows[0];
          // Check JEST for status I0184 (ESTO - In warehouse)
          let isEsto = false;
          try {
            const objnr = `IE${equi.EQUNR}`;
            const jestRows = await this.rfc.readTable('JEST', ['OBJNR', 'STAT', 'INACT'], [
              `OBJNR = '${objnr}'`,
              `AND STAT = 'I0184'`,
              `AND INACT = ''`
            ]);
            isEsto = Array.isArray(jestRows) && jestRows.length > 0;
          } catch (jestErr) {
            LOG.warn(`JEST status check failed for EQUNR ${equi.EQUNR}: ${jestErr.message}`);
            isEsto = true;
          }

          serialRecord = {
            Material: equi.MATNR,
            SerialNumber: equi.SERNR,
            Plant: equi.WERK || resvPlant,
            StorageLocation: equi.LAGER || resvSLoc,
            InventoryStockType: isEsto ? '01' : '02',
            InventoryStockType_Text: isEsto ? 'Unrestricted-Use Stock' : 'Not in Stock (ESTO)',
            InventorySpecialStockType: ''
          };
        }
      } catch (rfcErr) {
        LOG.warn(`RFC EQUI/JEST fallback query failed for serial ${sSerial}: ${rfcErr.message}`);
      }
    }

    if (!serialRecord) {
      return null;
    }

    // ──────────────────────────────────────────────────────────
    // Validations on resolved Serial Number
    // ──────────────────────────────────────────────────────────
    const serPlant = (serialRecord.Plant || '').trim();
    const serSLoc = (serialRecord.StorageLocation || '').trim();
    const serStockType = (serialRecord.InventoryStockType || '').trim();
    const serSpecialStock = (serialRecord.InventorySpecialStockType || '').trim();

    // 1. Plant Match Check
    if (serPlant && resvPlant && serPlant !== resvPlant) {
      const err = new Error(
        `Serial Number "${sSerial}" is located in Plant ${serPlant} (${serialRecord.PlantName || ''}), ` +
        `but reservation ${ctx.sResv} item ${ctx.sItem} requires Plant ${resvPlant}. Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    // 2. Storage Location Match Check
    if (serSLoc && resvSLoc && serSLoc !== resvSLoc) {
      const err = new Error(
        `Serial Number "${sSerial}" is in Storage Location ${serSLoc} (${serialRecord.StorageLocationName || ''}), ` +
        `but reservation ${ctx.sResv} item ${ctx.sItem} requires Storage Location ${resvSLoc}. Goods Issue is blocked.`
      );
      err.status = 409;
      throw err;
    }

    // 3. Unrestricted-Use Stock Status (ESTO) Check
    if (serStockType && serStockType !== '01') {
      const statusText = serialRecord.InventoryStockType_Text || serStockType;
      const err = new Error(
        `Serial Number "${sSerial}" is not in unrestricted stock (Status: ${statusText}). ` +
        `Serial numbers for Goods Issue must have status In-Stock (ESTO). Goods Issue is blocked.`
      );
      err.status = 422;
      throw err;
    }

    // 4. Special Stock Check
    if (serSpecialStock) {
      const specialText = serialRecord.InventorySpecialStockType_Text || serSpecialStock;
      const err = new Error(
        `Serial Number "${sSerial}" is assigned to special stock (${specialText}). ` +
        `Goods Issue cannot be posted against unrestricted reservation.`
      );
      err.status = 422;
      throw err;
    }

    // 5. Quantity constraint: 1 serial number = exactly 1 unit of issue
    const maxIssueQty = Math.min(1, openQty);

    this._suDiag('Scanned barcode matched SAP Serial Number', {
      inputBarcode: sBarcode,
      serialNumber: sSerial,
      material: resvMatClean,
      plant: serPlant || resvPlant,
      storageLocation: serSLoc || resvSLoc,
      stockType: serStockType
    });

    return {
      SuBarcode: sBarcode.trim(),
      SuExists: true,
      SuNotFoundReason: '',
      ResolvedType: 'SERIAL_NUMBER',
      HuService: '/sap/opu/odata/sap/UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber',
      HuInternalNumber: sSerial,
      HuExternalId: sSerial,
      SerialNumber: sSerial,
      DeterminedSerial: sSerial,
      IsSerialManaged: true,
      DeliveryDocument: '',
      DeliveryDocumentItem: '',
      Material: resvMatClean,
      MaterialDesc: resvItem.ProductName || serialRecord.Material_Text || '',
      Plant: serPlant || resvPlant,
      StorageLocation: serSLoc || resvSLoc,
      CurrentStock: currentStock !== null && currentStock !== undefined ? currentStock : 1,
      SuStockQty: 1,
      BaseUnit: baseUnit,
      Batches: usableBatches,
      DeterminedBatch: serialRecord.Batch || '',
      DeterminedBatchExpiry: null,
      DeterminedBatchStatusState: 'None',
      DeterminedBatchStatusText: '',
      DeterminedBatchDaysToExpiry: null,
      MultipleBatches: false,
      NoBatchAvailable: !serialRecord.Batch,
      ReservationNo: ctx.sResv,
      ReservationItem: ctx.sItem,
      OrderNo: resvItem.OrderID || '',
      MaterialMatch: true,
      PlantMatch: true,
      SLocMatch: true,
      ReservationRemainingQty: openQty,
      ReservationRequiredQty: reqQty,
      ReservationWithdrawnQty: wdnQty,
      MaxIssueQty: maxIssueQty,
      Unit: baseUnit
    };
  }

  /**
   * Whether the material carries a serial number profile in the plant (MARC-SERNP, RFC_READ_TABLE;
   * API_PRODUCT_SRV is not active on this system). Throws when the profile cannot be read.
   * @returns {Promise<boolean>}
   */
  async isSerialManaged(material, plant) {
    const m = wmKey(material);
    const w = wmKey(plant);
    if (!m || !w) return false;
    const matnr = /^\d+$/.test(m) ? m.padStart(18, '0') : m;
    const rows = await this.rfc.readTable('MARC', ['SERNP'], [`MATNR = '${matnr}'`, `AND WERKS = '${w}'`]);
    return rows.some((r) => !!r.SERNP);
  }

  /**
   * Whether SAP requires a batch for the material at the issuing plant.
   * Reads the material-level and plant-level batch-management indicators; an unreadable or
   * missing master record is not treated as an unmanaged material.
   */
  async isBatchManaged(material, plant) {
    const m = wmKey(material);
    const w = wmKey(plant);
    if (!m || !w) {
      const err = new Error('Material and plant are required to verify SAP batch management.');
      err.status = 400;
      throw err;
    }
    const matnr = /^\d+$/.test(m) ? m.padStart(18, '0') : m;
    const [materialRows, plantRows] = await Promise.all([
      this.rfc.readTable('MARA', ['XCHPF'], [`MATNR = '${matnr}'`]),
      this.rfc.readTable('MARC', ['XCHPF'], [`MATNR = '${matnr}'`, `AND WERKS = '${w}'`])
    ]);
    if (materialRows.length === 0 || plantRows.length === 0) {
      const err = new Error(`SAP batch-management indicator could not be read for material ${m} at plant ${w}.`);
      err.status = 502;
      throw err;
    }
    return materialRows.some((r) => String(r.XCHPF || '').trim().toUpperCase() === 'X')
      || plantRows.some((r) => String(r.XCHPF || '').trim().toUpperCase() === 'X');
  }

  /**
   * Current SAP status of ONE serial number for a goods movement out of material / plant / storage
   * location. Never throws for a business outcome and never assumes: every result is what SAP
   * returned, or UNVERIFIED when SAP could not be read.
   *   AVAILABLE              in unrestricted stock at the required plant / storage location
   *   OTHER_PLANT / OTHER_STORAGE_LOCATION / NOT_UNRESTRICTED / SPECIAL_STOCK   in stock, but not usable here
   *   OTHER_MATERIAL         the serial number is in stock for a different material
   *   NOT_IN_STOCK           exists in SAP (equipment master) but is not in stock, e.g. already issued
   *   NOT_FOUND              unknown to SAP for this material
   *   UNVERIFIED             a SAP read failed or returned contradictory data
   * Sources: UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber (lists only serials currently in stock),
   * then EQUI / JEST status I0184 (ESTO) via RFC to tell "issued" from "unknown".
   * @returns {Promise<Object>}
   */
  async getSerialStatus(material, plant, storageLocation, serialNumber) {
    const sSerial = String(serialNumber || '').replace(/[\r\n\t]/g, '').trim().toUpperCase();
    const matClean = String(material || '').trim().replace(/^0+/, '');
    const targetPlant = String(plant || '').trim().toUpperCase();
    const targetSLoc = String(storageLocation || '').trim().toUpperCase();
    const SERIAL_SET = '/sap/opu/odata/sap/UI_MATERIALSERIALNUMBER/C_MaterialSerialNumber';
    const result = (Status, Message, rec = {}) => ({
      SerialNumber: sSerial,
      Material: matClean,
      RequiredPlant: targetPlant,
      RequiredStorageLocation: targetSLoc,
      Status,
      Available: Status === 'AVAILABLE',
      Message,
      Plant: String(rec.Plant || '').trim(),
      StorageLocation: String(rec.StorageLocation || '').trim(),
      StockType: String(rec.InventoryStockType || '').trim(),
      StockTypeText: String(rec.InventoryStockType_Text || '').trim(),
      VerifiedAt: new Date().toISOString()
    });
    const where = (rec) => `plant ${rec.Plant || '-'}, storage location ${rec.StorageLocation || '-'}, ${rec.InventoryStockType_Text || `stock type ${rec.InventoryStockType || '-'}`}`;
    const lit = (v) => encodeURIComponent(String(v).replace(/'/g, "''"));

    if (!sSerial || !matClean) {
      return result('UNVERIFIED', 'Serial number and material are required to verify a serial number with SAP.');
    }

    let rec;
    try {
      const rows = await this._get(SERIAL_SET, `$filter=${encodeURIComponent(`SerialNumber eq '`)}${lit(sSerial)}${encodeURIComponent(`' and Material eq '`)}${lit(matClean)}${encodeURIComponent(`'`)}&$format=json`);
      rec = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      return result('UNVERIFIED', `SAP serial number stock could not be read: ${err.message}`);
    }

    if (rec) {
      const recordSerial = String(rec.SerialNumber || '').trim().toUpperCase();
      const recordMaterial = String(rec.Material || '').trim().replace(/^0+/, '');
      if (!recordSerial) {
        return result('UNVERIFIED', `SAP returned a serial record without its serial number while verifying ${sSerial}.`, rec);
      }
      if (recordSerial !== sSerial) {
        return result('UNVERIFIED', `SAP returned serial number ${recordSerial} while verifying ${sSerial}.`);
      }
      if (!recordMaterial) {
        return result('UNVERIFIED', `SAP returned serial number ${sSerial} without its material.`, rec);
      }
      if (recordMaterial !== matClean) {
        return result('OTHER_MATERIAL', `Serial number ${sSerial} belongs to material ${recordMaterial}, not to material ${matClean}.`, rec);
      }
      const recPlant = String(rec.Plant || '').trim().toUpperCase();
      const recSLoc = String(rec.StorageLocation || '').trim().toUpperCase();
      const stockType = String(rec.InventoryStockType || '').trim();
      if (!stockType) {
        return result('UNVERIFIED', `SAP returned serial number ${sSerial} without a stock type.`, rec);
      }
      if (targetPlant && recPlant !== targetPlant) {
        return result('OTHER_PLANT', `Serial number ${sSerial} is in ${where(rec)}; plant ${targetPlant} is required.`, rec);
      }
      if (targetSLoc && recSLoc !== targetSLoc) {
        return result('OTHER_STORAGE_LOCATION', `Serial number ${sSerial} is in ${where(rec)}; storage location ${targetSLoc} is required.`, rec);
      }
      if (stockType !== '01') {
        return result('NOT_UNRESTRICTED', `Serial number ${sSerial} is not in unrestricted stock (${where(rec)}).`, rec);
      }
      if (String(rec.InventorySpecialStockType || '').trim()) {
        return result('SPECIAL_STOCK', `Serial number ${sSerial} is special stock (${rec.InventorySpecialStockType_Text || rec.InventorySpecialStockType}).`, rec);
      }
      return result('AVAILABLE', `Serial number ${sSerial} is in ${where(rec)}.`, rec);
    }

    // Not in stock for this material. In stock for another material?
    try {
      const others = await this._get(SERIAL_SET, `$filter=${encodeURIComponent(`SerialNumber eq '`)}${lit(sSerial)}${encodeURIComponent(`'`)}&$top=5&$format=json`);
      const other = (Array.isArray(others) ? others : []).find((r) => String(r.Material || '').replace(/^0+/, '') !== matClean);
      if (other) {
        return result('OTHER_MATERIAL', `Serial number ${sSerial} belongs to material ${String(other.Material).replace(/^0+/, '')} (${where(other)}), not to material ${matClean}.`, other);
      }
    } catch (err) {
      return result('UNVERIFIED', `SAP serial number stock could not be read: ${err.message}`);
    }

    // Known to SAP at all? (issued serials keep their equipment record but lose status ESTO)
    // The values go into an RFC_READ_TABLE WHERE clause: only quote-free serial characters pass.
    const sKey = /^[A-Z0-9 ._/-]{1,18}$/.test(sSerial) ? sSerial : '';
    const mKey = wmKey(matClean);
    if (!sKey || !mKey) {
      return result('NOT_IN_STOCK', `Serial number ${sSerial} is not in stock for material ${matClean} in SAP.`);
    }
    try {
      const matnr = /^\d+$/.test(mKey) ? mKey.padStart(18, '0') : mKey;
      const equi = await this.rfc.readTable('EQUI', ['EQUNR'], [`SERNR = '${sKey}'`, `AND MATNR = '${matnr}'`]);
      if (!equi.length) {
        return result('NOT_FOUND', `Serial number ${sSerial} does not exist in SAP for material ${matClean}.`);
      }
      const jest = await this.rfc.readTable('JEST', ['STAT'], [`OBJNR = 'IE${equi[0].EQUNR}'`, "AND STAT = 'I0184'", "AND INACT = ''"]);
      if (jest.length) {
        return result('UNVERIFIED', `SAP data for serial number ${sSerial} is inconsistent: status "in stock" (ESTO) without a stock record.`);
      }
      return result('NOT_IN_STOCK', `Serial number ${sSerial} exists in SAP for material ${matClean} but is not in stock (already issued or not yet received).`);
    } catch (err) {
      return result('UNVERIFIED', `Serial number ${sSerial} is not in stock for material ${matClean}; its SAP serial master could not be read: ${err.message}`);
    }
  }

  /**
   * Pre-check serial number stock status (must be ESTO / unrestricted stock, not already issued).
   *
   * @param {string} material
   * @param {string} plant
   * @param {string} storageLocation
   * @param {Array<string>} serialNumbers
   * @returns {Promise<{ valid: boolean }>}
   */
  async validateSerialStatus(material, plant, storageLocation, serialNumbers) {
    if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
      return { valid: true };
    }

    for (const rawSerial of serialNumbers) {
      const sSerial = String(rawSerial || '').trim();
      if (!sSerial) continue;
      let status;
      try {
        status = await this.getSerialStatus(material, plant, storageLocation, sSerial);
      } catch (statusErr) {
        const err = new Error(`Serial Number "${sSerial}" could not be verified in SAP: ${statusErr.message || 'unexpected status read failure'}. Goods Issue is blocked.`);
        err.status = statusErr.status || 502;
        throw err;
      }

      if (status.Status !== 'AVAILABLE') {
        const err = new Error(status.Message || `Serial Number "${sSerial}" is not available for this Goods Issue.`);
        err.status = status.Status === 'UNVERIFIED' ? 502
          : ['OTHER_PLANT', 'OTHER_STORAGE_LOCATION', 'OTHER_MATERIAL'].includes(status.Status) ? 409
            : 422;
        throw err;
      }
    }

    return { valid: true };
  }
}

module.exports = GoodsIssueStockUnitClient;
