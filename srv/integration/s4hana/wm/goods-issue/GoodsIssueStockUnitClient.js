const LOG = require('../../logger')('goods-issue-stock-unit');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

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
    this._huModelCache = null;
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
      bin: { names: ['EWMStorageBin', 'StorageBin', 'SourceStorageBin', 'VLPLA', 'LGPLA', 'Lgpla'], re: /^(ewmstoragebin|storagebin|sourcestoragebin|vlpla|lgpla)$/i },
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
            bin: this._pickField(names, specs.bin),
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
      bin: str(it, itemFields.bin),
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
      storageBin: mapped.filter((m) => m.bin).map((m) => m.bin).join(','),
      stock: mapped.reduce((sum, m) => sum + (m.qty || 0), 0)
    });

    return { items: mapped, primary: mapped.find((m) => m.material) || mapped[0] || {} };
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

    const sSu = suBarcode.trim();
    const sResv = String(reservationNo).trim();
    const sItem = String(reservationItem).trim().padStart(4, '0');

    // ──────────────────────────────────────────────────────────
    // STEP 1: Load reservation item to get expected values (Reservation-First)
    // ──────────────────────────────────────────────────────────
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

    const resvMaterial = resvItem.Product || '';
    const resvPlant = resvItem.Plant || '';
    const resvSLoc = resvItem.StorageLocation || '';
    const reqQty = Number(resvItem.ResvnItmRequiredQtyInBaseUnit || 0);
    const wdnQty = Number(resvItem.ResvnItmWithdrawnQtyInBaseUnit || 0);
    const openQty = Math.max(0, reqQty - wdnQty);
    const resvUnit = resvItem.BaseUnit || 'KG';

    // ──────────────────────────────────────────────────────────
    // STEP 2: Read actual current stock and authentic batches from SAP
    // ──────────────────────────────────────────────────────────
    let currentStock = 0;
    let baseUnit = resvUnit || 'KG';

    if (resvPlant && resvSLoc) {
      try {
        const slocFilter = `Material eq '${encodeURIComponent(resvMaterial)}' and Plant eq '${encodeURIComponent(resvPlant)}' and StorageLocation eq '${encodeURIComponent(resvSLoc)}'`;
        const slocRes = await this._get(
          '/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps',
          `$filter=${slocFilter}&$format=json`
        );
        if (Array.isArray(slocRes) && slocRes.length > 0) {
          currentStock = Number(slocRes[0].CurrentStock || 0);
          if (slocRes[0].BaseUnit) baseUnit = slocRes[0].BaseUnit;
        }
      } catch (err) {
        LOG.warn(`MaterialStorLocHelps query failed for ${resvMaterial}/${resvPlant}/${resvSLoc}: ${err.message}`);
      }

      if (currentStock === 0) {
        try {
          const stockFilter = `Material eq '${encodeURIComponent(resvMaterial)}' and Plant eq '${encodeURIComponent(resvPlant)}' and StorageLocation eq '${encodeURIComponent(resvSLoc)}'`;
          const stockRes = await this._get(
            '/sap/opu/odata/sap/C_STOCKQUANTITYVALUEBYTYPE_CDS/C_STOCKQUANTITYVALUEBYTYPE',
            `$filter=${stockFilter}&$format=json`
          );
          if (Array.isArray(stockRes) && stockRes.length > 0) {
            currentStock = Number(stockRes[0].MatlWrhsStkQtyInMatlBaseUnit || 0);
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
      const maxIssueQty = Math.min(currentStock, openQty);
      this._suDiag('SU barcode matched SAP Batch directly', {
        inputBarcode: sSu,
        identifierType: directBatch ? 'Direct SAP Batch identifier' : 'GS1 Barcode AI (10) Batch identifier',
        batch: batchDirectMatch.Batch,
        material: resvMaterial,
        plant: resvPlant,
        storageLocation: resvSLoc,
        stock: currentStock
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
        StorageBin: batchDirectMatch.StorageBin || resvItem.StorageLocationName || '',
        CurrentStock: batchDirectMatch.AvailableStock != null ? batchDirectMatch.AvailableStock : currentStock,
        SuStockQty: currentStock,
        BaseUnit: baseUnit,
        Batches: usableBatches,
        DeterminedBatch: batchDirectMatch.Batch,
        DeterminedBatchExpiry: batchDirectMatch.ExpiryDate || null,
        DeterminedBatchStatusState: batchDirectMatch.StatusState || 'Success',
        DeterminedBatchStatusText: batchDirectMatch.StatusText || 'VALID',
        DeterminedBatchDaysToExpiry: batchDirectMatch.DaysToExpiry || 9999,
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
    // ──────────────────────────────────────────────────────────
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
    const suBin = suPrimary.bin || '';
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

    if (suQty > 0) {
      currentStock = currentStock > 0 ? Math.min(currentStock, suQty) : suQty;
    }

    if (currentStock <= 0) {
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
    let determinedBatchStatus = { StatusState: 'None', StatusText: 'SU BATCH NOT STATED', DaysToExpiry: 9999 };
    let multipleBatches = false;
    let noBatchAvailable = false;

    if (suBatches.length === 0) {
      noBatchAvailable = true;
      determinedBatchStatus = { StatusState: 'None', StatusText: 'SU BATCH NOT STATED', DaysToExpiry: 9999 };
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
        StatusText: candidate.StatusText || 'VALID',
        DaysToExpiry: candidate.DaysToExpiry || 9999
      };
    }

    const maxIssueQty = Math.min(currentStock, openQty);

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
      storageBin: suBin,
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
      StorageBin: suBin || resvItem.StorageLocationName || '',
      CurrentStock: currentStock,
      SuStockQty: suQty,
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
}

module.exports = GoodsIssueStockUnitClient;
