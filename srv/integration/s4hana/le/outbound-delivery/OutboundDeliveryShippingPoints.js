'use strict';

const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { mapS4Error } = require('../../S4ErrorMapper');
const { sapKey } = require('../../sapKey');

class OutboundDeliveryShippingPoints {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get rfc() {
    return this.adapter.rfc;
  }

  get client() {
    return this.adapter.client;
  }

  get servicePath() {
    return this.adapter.servicePath;
  }

  get cacheTtlMs() {
    return this.adapter.cacheTtlMs;
  }

  get businessConfigResolver() {
    return this.adapter.businessConfigResolver;
  }

  get _tvstzCache() {
    return this.adapter._tvstzCache;
  }

  /**
   * Retrieves valid shipping points for a plant from TVSTZ (or BusinessConfigResolver).
   *
   * @param {string} plant
   * @param {Object} [options]
   * @returns {Promise<Array<string>>}
   */
  async getShippingPointsForPlant(plant, options = {}) {
    if (!plant) return [];
    const cleanPlant = String(plant).trim().toUpperCase();
    if (!cleanPlant) return [];

    if (options.shippingPoints && Array.isArray(options.shippingPoints)) {
      return options.shippingPoints;
    }
    if (typeof options.tvstzResolver === 'function') {
      return await options.tvstzResolver(cleanPlant);
    }

    if (!options.forceRefresh && this._tvstzCache && this._tvstzCache.has(cleanPlant)) {
      const entry = this._tvstzCache.get(cleanPlant);
      if (entry && entry.expiresAt > Date.now()) {
        return entry.points;
      }
    }

    let points = [];
    const rfc = options.rfc || this.rfc;
    if (rfc && typeof rfc.readTable === 'function') {
      try {
        const rows = await rfc.readTable('TVSTZ', ['WERKS', 'VSTEL'], [`WERKS = '${cleanPlant}'`]);
        if (Array.isArray(rows)) {
          points = Array.from(new Set(rows.map(r => r.VSTEL && r.VSTEL.trim()).filter(Boolean)));
        }
      } catch (err) {
        LOG.warn(`Failed to read TVSTZ for plant ${cleanPlant}: ${err.message}`);
      }
    }

    const resolver = options.businessConfigResolver !== undefined ? options.businessConfigResolver : this.businessConfigResolver;
    if (points.length === 0 && resolver) {
      try {
        const cfg = await resolver.resolve({
          plant: cleanPlant,
          fields: ['shippingPoints'],
          rfc
        });
        if (cfg && Array.isArray(cfg.shippingPoints)) {
          points = cfg.shippingPoints;
        }
      } catch (_) {}
    }

    // An empty result may be an outage, so it is not cached.
    if (this._tvstzCache && points.length > 0) {
      this._tvstzCache.set(cleanPlant, {
        points,
        expiresAt: Date.now() + this.cacheTtlMs
      });
    }

    return points;
  }

  /**
   * Shipping points a plant-scoped user may read. Refuses rather than answering with no filter, which would
   * read the orders of every plant.
   *
   * @param {Array<string>} plants
   * @param {Object} [options]
   * @returns {Promise<Array<string>>}
   */
  async _shippingPointsInScope(plants, options = {}) {
    const fnGetPoints = (p) => (this.adapter ? this.adapter.getShippingPointsForPlant(p, options) : this.getShippingPointsForPlant(p, options));
    const lists = await Promise.all(plants.map(fnGetPoints));
    const points = [...new Set(lists.flat().map((point) => String(point).trim().toUpperCase()))];
    if (points.length === 0) {
      const err = new Error(`The shipping points of plant ${plants.join(', ')} could not be read from SAP, so nothing was read or posted. Try again.`);
      err.status = 503;
      err.$sanitize = false; // see srv/common/visibleError.js
      err.statusCode = 503;
      err.isScopeRefusal = true;
      throw err;
    }
    return points;
  }

  /**
   * Refuses (403) a shipping point that belongs to none of the plants, or (503) when their points cannot be read.
   *
   * @param {string} shippingPoint
   * @param {Array<string>} plants
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async assertShippingPointInPlants(shippingPoint, plants, options = {}) {
    const fnScope = (pts, opts) => (this.adapter ? this.adapter._shippingPointsInScope(pts, opts) : this._shippingPointsInScope(pts, opts));
    const allowed = plants.length ? await fnScope(plants, options) : [];
    if (!allowed.includes(String(shippingPoint).trim().toUpperCase())) {
      const err = new Error(`Shipping point '${shippingPoint}' is outside user's authorized plants: [${plants.join(', ')}]. Access denied.`);
      err.status = 403;
      err.statusCode = 403;
      err.isScopeRefusal = true;
      throw err;
    }
  }

  /**
   * Plant of every item of a delivery, from LIPS. A delivery can span plants, so all of them are returned.
   *
   * @param {string} deliveryDocument
   * @returns {Promise<Array<string>>}
   */
  async readDeliveryPlants(deliveryDocument) {
    const vbeln = sapKey(deliveryDocument, 'vbeln').padStart(10, '0');
    const rows = await this.rfc.readTable('LIPS', ['WERKS'], [`VBELN = '${vbeln}'`]);
    return rows.map((row) => row.WERKS);
  }

  /**
   * Clears in-memory TVSTZ cache.
   */
  clearTvstzCache() {
    if (this._tvstzCache) {
      this._tvstzCache.clear();
    }
  }

  /**
   * Gets cached TVSTZ entry for a plant.
   *
   * @param {string} plant
   * @returns {Object|null}
   */
  getTvstzCacheEntry(plant) {
    if (!this._tvstzCache || !plant) return null;
    const cleanPlant = String(plant).trim().toUpperCase();
    return this._tvstzCache.get(cleanPlant) || null;
  }

  /**
   * Reads shipping points value help from C_ShippingPointVH.
   *
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getShippingPoints(options = {}) {
    try {
      const url = `${this.servicePath}/C_ShippingPointVH?$top=100`;
      LOG.info(`Reading shipping points from: ${url}`);
      const res = await this.client.get(url, options);
      const rawResults = res.data?.d?.results || res.data?.results || res.data?.value || [];
      let list = rawResults.map(sp => ({
        ShippingPoint: sp.ShippingPoint,
        ShippingPointName: sp.ShippingPointName || sp.ShippingPoint_Text || '',
        ShippingPoint_Text: sp.ShippingPoint_Text || sp.ShippingPointName || '',
        ActiveDepartureCountry: sp.ActiveDepartureCountry || ''
      }));

      // If plant is specified or derived from request context, filter to points valid in TVSTZ
      const plant = options.plant ||
        (options.req?.user?.attr?.Plant && [].concat(options.req.user.attr.Plant)[0]) ||
        (options.user?.attr?.Plant && [].concat(options.user.attr.Plant)[0]) ||
        null;

      if (plant) {
        const validPoints = await (this.adapter ? this.adapter.getShippingPointsForPlant(plant, options) : this.getShippingPointsForPlant(plant, options));
        if (validPoints && validPoints.length > 0) {
          const set = new Set(validPoints);
          list = list.filter(sp => set.has(sp.ShippingPoint));
        }
      }

      return list;
    } catch (err) {
      const sapErr = mapS4Error(err);
      LOG.error(`Failed to read shipping points (${sapErr.status}): ${sapErr.message}`);
      const error = new Error(sapErr.message);
      error.status = sapErr.status;
      error.statusCode = sapErr.status;
      error.code = sapErr.code;
      error.details = sapErr.details;
      throw error;
    }
  }
}

module.exports = OutboundDeliveryShippingPoints;
