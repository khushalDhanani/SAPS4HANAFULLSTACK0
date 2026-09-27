const TrToAdapter = require('../../../integration/s4hana/wm/TrToAdapter');

class TrToHandler {
  static init(srv, options = {}) {
    const adapter = options.adapter || new TrToAdapter();

    // FUNCTION: getTR(tbnum, lgnum)
    srv.on('getTR', async (req) => {
      const tbnum = req.data?.tbnum || (req.params && req.params[0]?.tbnum);
      const lgnum = req.data?.lgnum || (req.params && req.params[0]?.lgnum) || 'W01';

      if (!tbnum) {
        return req.error(400, 'Transfer Requirement number (tbnum) is required');
      }

      try {
        const trData = await adapter.getTR(tbnum, lgnum);
        return trData;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read Transfer Requirement from S/4HANA');
      }
    });

    // FUNCTION: checkSU(lenum, tbnum, lgnum)
    srv.on('checkSU', async (req) => {
      const lenum = req.data?.lenum || (req.params && req.params[0]?.lenum);
      const tbnum = req.data?.tbnum || (req.params && req.params[0]?.tbnum);
      const lgnum = req.data?.lgnum || (req.params && req.params[0]?.lgnum) || 'W01';

      if (!lenum) {
        return req.error(400, 'Storage Unit number (lenum) is required');
      }

      try {
        const suData = await adapter.checkSU(lenum, tbnum, lgnum);
        return suData;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to validate Storage Unit in S/4HANA');
      }
    });

    // ACTION: createTO(lgnum, tbnum, tbpos, lenum, qty, unit, confirmImmediate)
    // Synchronous execution: no offline queue, failure reported directly to operator
    srv.on('createTO', async (req) => {
      const {
        lgnum = 'W01',
        tbnum,
        tbpos = '0001',
        lenum,
        qty,
        openQty,
        unit = 'KG',
        confirmImmediate = true
      } = req.data || {};

      if (!tbnum) {
        return req.error(400, 'Transfer Requirement number (tbnum) is required');
      }
      if (!lenum) {
        return req.error(400, 'Storage Unit number (lenum) is required');
      }
      if (!qty || parseFloat(qty) <= 0) {
        return req.error(400, 'Quantity must be greater than zero');
      }
      if (openQty !== undefined && openQty !== null) {
        const numOpen = parseFloat(openQty);
        if (!isNaN(numOpen) && parseFloat(qty) > numOpen) {
          return req.error(400, `Requested quantity ${qty} ${unit} exceeds open TR quantity ${numOpen} ${unit}`);
        }
      }

      try {
        const result = await adapter.createTO({
          lgnum,
          tbnum,
          tbpos,
          lenum,
          qty,
          unit,
          confirmImmediate
        });
        return result;
      } catch (err) {
        return req.error(err.status || 400, err.message || 'Failed to create Transfer Order in SAP S/4HANA');
      }
    });
  }
}

module.exports = TrToHandler;
