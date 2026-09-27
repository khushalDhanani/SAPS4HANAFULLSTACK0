const LOG = require('../logger')('tr-to-adapter');
const S4ErrorMapper = require('../S4ErrorMapper');
const { S4HttpClient } = require('../S4HttpClient');

/**
 * TrToAdapter
 * Connects CAP layer to SAP S/4HANA for Transfer Requirement (TR) & Transfer Order (TO) handling.
 * Consumes Gateway OData service ZWM_RF_TRTO_SRV.
 *
 * Implements:
 * 1. getTR(tbnum, lgnum): Retrieves TR header and line items with MAKT descriptions and open quantities (MENGE - TAMEN).
 * 2. checkSU(lenum, tbnum, lgnum): Validates scanned Storage Unit against TR components and retrieves available stock (LQUA VERME).
 * 3. createTO(options): Synchronous Transfer Order creation (and optional 1-step Pick & Transfer confirmation).
 *
 * Strict compliance with AGENTS.md:
 * No offline queue; failures are reported synchronously to the operator right away.
 */
class TrToAdapter {
  static SERVICE_PATH = '/sap/opu/odata/sap/ZWM_RF_TRTO_SRV';
  static CSRF_FETCH_PATH = '/sap/opu/odata/sap/ZWM_RF_TRTO_SRV/TRHeaderSet?$top=1';

  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
  }

  /**
   * Helper: Normalize 10-digit SAP numbers (TR, Production Order, etc.)
   */
  _normalizeTbnum(tbnum) {
    if (!tbnum) return '';
    const clean = String(tbnum).trim();
    return clean ? clean.padStart(10, '0') : '';
  }

  /**
   * Helper: Normalize 20-digit SAP Storage Unit numbers (LENUM)
   */
  _normalizeLenum(lenum) {
    if (!lenum) return '';
    const clean = String(lenum).trim();
    return clean ? clean.padStart(20, '0') : '';
  }

  /**
   * Formats error into user-facing plain message and appropriate HTTP status
   */
  _handleError(error, contextMsg) {
    const rawMsg = S4ErrorMapper.extractS4ErrorMessage(error);
    const status = error.status || error.statusCode || error.response?.status || 500;
    LOG.error(`${contextMsg}: ${rawMsg}`);

    const cleanErr = new Error(`${contextMsg}: ${rawMsg}`);
    cleanErr.status = status;
    cleanErr.originalError = error;
    return cleanErr;
  }

  /**
   * Retrieves Transfer Requirement header and line items from SAP S/4HANA
   * @param {string} tbnum - Transfer Requirement Number (or Production Order number)
   * @param {string} [lgnum='W01'] - Warehouse Number
   * @returns {Promise<Object>} Formatted TR Header with items array
   */
  async getTR(tbnum, lgnum = 'W01') {
    if (!tbnum) {
      const err = new Error('Transfer Requirement number (tbnum) is required');
      err.status = 400;
      throw err;
    }

    const normTbnum = this._normalizeTbnum(tbnum);
    const sWarehouse = String(lgnum || 'W01').trim();

    LOG.info(`Fetching TR ${normTbnum} in warehouse ${sWarehouse}`);

    try {
      // 1. Query Gateway service TRHeaderSet with expand ToItems
      const sPath = `${TrToAdapter.SERVICE_PATH}/TRHeaderSet(Lgnum='${encodeURIComponent(sWarehouse)}',Tbnum='${encodeURIComponent(normTbnum)}')?$expand=ToItems`;
      const response = await this.client.get(sPath);
      const data = response?.data?.d || response?.data;

      if (!data || !data.Tbnum) {
        const err = new Error(`Transfer Requirement ${tbnum} not found in warehouse ${sWarehouse}`);
        err.status = 404;
        throw err;
      }

      // Format Header
      const header = {
        Lgnum: data.Lgnum || sWarehouse,
        Tbnum: data.Tbnum,
        Bwlvs: data.Bwlvs || '',
        Betyp: data.Betyp || '',
        Benum: data.Benum || '',
        Rsnum: data.Rsnum || '',
        Bdatu: data.Bdatu || null,
        Statu: data.Statu || '',
        Vltyp: data.Vltyp || '',
        Vlpla: data.Vlpla || '',
        Nltyp: data.Nltyp || '',
        Nlpla: data.Nlpla || '',
        Items: []
      };

      // Format Items
      const rawItems = data.ToItems?.results || (Array.isArray(data.ToItems) ? data.ToItems : []);
      header.Items = rawItems.map(item => {
        const reqQty = parseFloat(item.Menge || '0');
        const procQty = parseFloat(item.Tamen || '0');
        const openQty = parseFloat(item.OpenQty !== undefined ? item.OpenQty : (reqQty - procQty));

        return {
          Lgnum: item.Lgnum || header.Lgnum,
          Tbnum: item.Tbnum || header.Tbnum,
          Tbpos: String(item.Tbpos || '').padStart(4, '0'),
          Material: item.Matnr || '',
          MaterialDesc: item.Maktx || '',
          Plant: item.Werks || '',
          StorageLocation: item.Lgort || '',
          Batch: item.Charg || '',
          RequiredQty: reqQty,
          ProcessedQty: procQty,
          OpenQty: openQty,
          Unit: item.Meins || 'KG',
          DeliveryCompleted: item.Elikz === 'X',
          DestStorageType: item.Nltyp || header.Nltyp,
          DestStorageBin: item.Nlpla || header.Nlpla
        };
      });

      return header;
    } catch (error) {
      throw this._handleError(error, `Failed to retrieve Transfer Requirement ${tbnum}`);
    }
  }

  /**
   * Validates a scanned Storage Unit against a Transfer Requirement and returns quant details
   * @param {string} lenum - Storage Unit Number
   * @param {string} tbnum - Transfer Requirement Number
   * @param {string} [lgnum='W01'] - Warehouse Number
   * @returns {Promise<Object>} Storage Unit validation record with Quants array
   */
  async checkSU(lenum, tbnum, lgnum = 'W01') {
    if (!lenum) {
      const err = new Error('Storage Unit number (lenum) is required');
      err.status = 400;
      throw err;
    }

    const normLenum = this._normalizeLenum(lenum);
    const normTbnum = this._normalizeTbnum(tbnum);
    const sWarehouse = String(lgnum || 'W01').trim();

    LOG.info(`Validating SU ${normLenum} against TR ${normTbnum} in warehouse ${sWarehouse}`);

    try {
      const sFilter = `Lenum eq '${normLenum}' and Tbnum eq '${normTbnum}' and Lgnum eq '${sWarehouse}'`;
      const sPath = `${TrToAdapter.SERVICE_PATH}/StorageUnitSet?$filter=${encodeURIComponent(sFilter)}&$expand=ToQuants`;

      const response = await this.client.get(sPath);
      const results = response?.data?.d?.results || (Array.isArray(response?.data?.d) ? response?.data?.d : []);

      const suData = results[0];
      if (!suData) {
        return {
          Lgnum: sWarehouse,
          StorageUnit: normLenum,
          Tbnum: normTbnum,
          StorageType: '',
          StorageBin: '',
          SUType: '',
          IsValid: false,
          ErrorCode: 'SU_NOT_FOUND',
          ErrorMessage: `Storage Unit ${lenum} not found in warehouse ${sWarehouse}`,
          Quants: []
        };
      }

      const rawQuants = suData.ToQuants?.results || (Array.isArray(suData.ToQuants) ? suData.ToQuants : []);
      const quants = rawQuants.map(q => ({
        Lgnum: q.Lgnum || sWarehouse,
        QuantNumber: q.Lqnum || '',
        StorageUnit: q.Lenum || normLenum,
        Material: q.Matnr || '',
        MaterialDesc: q.Maktx || '',
        Plant: q.Werks || '',
        StorageLocation: q.Lgort || '',
        Batch: q.Charg || '',
        AvailableStock: parseFloat(q.Verme || '0'),
        Unit: q.Meins || 'KG',
        StorageType: q.Lgtyp || suData.Lgtyp || '',
        StorageBin: q.Lgpla || suData.Lgpla || ''
      }));

      return {
        Lgnum: suData.Lgnum || sWarehouse,
        StorageUnit: suData.Lenum || normLenum,
        Tbnum: suData.Tbnum || normTbnum,
        StorageType: suData.Lgtyp || '',
        StorageBin: suData.Lgpla || '',
        SUType: suData.Letyp || '',
        IsValid: suData.IsValid === true || suData.IsValid === 'X',
        ErrorCode: suData.ErrorCode || '',
        ErrorMessage: suData.ErrorMessage || '',
        Quants: quants
      };
    } catch (error) {
      throw this._handleError(error, `Failed to validate Storage Unit ${lenum}`);
    }
  }

  /**
   * Synchronously creates a Transfer Order for the scanned SU and TR
   * If confirmImmediate is true, executes 1-step Pick & Transfer.
   * No offline queue. Failures are thrown immediately.
   *
   * @param {Object} params
   * @param {string} [params.lgnum='W01']
   * @param {string} params.tbnum
   * @param {string} [params.tbpos='0001']
   * @param {string} params.lenum
   * @param {number} params.qty
   * @param {string} params.unit
   * @param {boolean} [params.confirmImmediate=true]
   * @returns {Promise<Object>} { TransferOrder, Success, Message, Confirmed }
   */
  async createTO(params = {}) {
    const {
      lgnum = 'W01',
      tbnum,
      tbpos = '0001',
      lenum,
      qty,
      unit = 'KG',
      confirmImmediate = true
    } = params;

    if (!tbnum) {
      const err = new Error('Transfer Requirement number (tbnum) is required');
      err.status = 400;
      throw err;
    }
    if (!lenum) {
      const err = new Error('Storage Unit number (lenum) is required');
      err.status = 400;
      throw err;
    }
    if (!qty || parseFloat(qty) <= 0) {
      const err = new Error('Quantity must be greater than zero');
      err.status = 400;
      throw err;
    }
    if (params.openQty !== undefined && params.openQty !== null) {
      const numOpen = parseFloat(params.openQty);
      if (!isNaN(numOpen) && parseFloat(qty) > numOpen) {
        const err = new Error(`Requested quantity ${qty} ${unit} exceeds open TR quantity ${numOpen} ${unit}`);
        err.status = 400;
        throw err;
      }
    }

    const normTbnum = this._normalizeTbnum(tbnum);
    const normLenum = this._normalizeLenum(lenum);
    const normTbpos = String(tbpos || '0001').padStart(4, '0');
    const sWarehouse = String(lgnum || 'W01').trim();

    LOG.info(`Synchronously creating TO for TR ${normTbnum} / SU ${normLenum} (Qty: ${qty} ${unit})`);

    const payload = {
      Lgnum: sWarehouse,
      Tbnum: normTbnum,
      Tbpos: normTbpos,
      Lenum: normLenum,
      Qty: String(qty),
      Unit: String(unit || 'KG').trim(),
      ConfirmImmediate: confirmImmediate ? 'X' : ''
    };

    try {
      const sPath = `${TrToAdapter.SERVICE_PATH}/CreateTO`;
      const response = await this.client.post(sPath, payload);
      const result = response?.data?.d || response?.data?.CreateTO || response?.data;

      if (!result || result.Success === 'E') {
        const errorMsg = result?.Message || 'Failed to create Transfer Order in SAP S/4HANA';
        const err = new Error(errorMsg);
        err.status = 400;
        throw err;
      }

      return {
        TransferOrder: result.Tanum || '',
        Success: result.Success === 'S',
        Message: result.Message || `Transfer Order ${result.Tanum} created successfully.`,
        Confirmed: result.Confirmed === true || result.Confirmed === 'X'
      };
    } catch (error) {
      throw this._handleError(error, `Failed to create Transfer Order for TR ${tbnum}`);
    }
  }
}

module.exports = TrToAdapter;
