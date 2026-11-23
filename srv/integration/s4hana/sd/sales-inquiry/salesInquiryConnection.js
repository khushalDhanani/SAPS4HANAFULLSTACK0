const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');

/**
 * SalesInquiryAdapter methods: S/4HANA service connections and raw service reads.
 * Mixed into SalesInquiryAdapter.prototype; `this` is the adapter instance.
 */
module.exports = {
  /** Initialize the remote S/4HANA read services */
  async init() {
    if (!this.s4hanaWL) {
      try {
        this.s4hanaWL = await cds.connect.to('SD_F2370_INQY_WL_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F2370_INQY_WL_SRV:', err.message);
      }
    }
    if (!this.s4hanaFS) {
      try {
        this.s4hanaFS = await cds.connect.to('SD_F2369_INQY_FS_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F2369_INQY_FS_SRV:', err.message);
      }
    }
    if (!this.s4hanaSO) {
      try {
        this.s4hanaSO = await cds.connect.to('SD_F1873_SO_WL_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F1873_SO_WL_SRV:', err.message);
      }
    }
  },

  /**
   * Resolve destination for S/4HANA communication using the shared S4HttpClient.
   * Propagates caller userJwt for Principal Propagation when available.
   *
   * @param {Object} [options]
   */
  async _getDestination(options = {}) {
    const dest = await this.client.resolveDestination(options);
    if (!dest) {
      const destinationName = this.client.destinationName;
      throw new Error(`[SalesInquiryAdapter] Destination '${destinationName}' not found and no local credentials configured.`);
    }
    return dest;
  },

  /** Read data from SD Worklist & Value Help service */
  async readWlData(query) {
    await this.init();
    if (!this.s4hanaWL) {
      const err = new Error('Sales inquiry worklist data cannot be read: the SAP SD service SD_F2370_INQY_WL_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaWL.run(query);
    } catch (error) {
      LOG.error('Error reading data from WL service:', error.message);
      if (!error.status) error.status = 502;
      throw error;
    }
  },

  /** Read data from SD Factsheet & Item service */
  async readFsData(query) {
    await this.init();
    if (!this.s4hanaFS) {
      const err = new Error('Sales inquiry factsheet data cannot be read: the SAP SD service SD_F2369_INQY_FS_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaFS.run(query);
    } catch (error) {
      LOG.error('Error reading data from FS service:', error.message);
      const err = new Error(`Sales inquiry factsheet data could not be read from SAP S/4HANA: ${error.message}`);
      err.status = error.status || 502;
      throw err;
    }
  },

  /** Read data from SD Sales Order Worklist & Value Help service (SD_F1873_SO_WL_SRV) */
  async readSoData(query) {
    await this.init();
    if (!this.s4hanaSO) {
      const err = new Error('Sales order worklist data cannot be read: the SAP SD service SD_F1873_SO_WL_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaSO.run(query);
    } catch (error) {
      LOG.error('Error reading data from SO service:', error.message);
      if (!error.status) error.status = 502;
      throw error;
    }
  }
};
