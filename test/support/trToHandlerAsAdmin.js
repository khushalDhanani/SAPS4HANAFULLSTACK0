'use strict';

const TrToHandler = require('../../srv/wm/tr-to/handlers/trTo.handler');

const ADMIN = { is: (role) => role === 'Admin', attr: {} };
const PLANT_LIMITED = /^(createTOFromTR|CreateTOFromTR|postMigoGoodsMovement|PostMigoGoodsMovement)$/;

/**
 * TrToHandler for tests about something other than plant limits: a write with no real CAP user runs as an Admin,
 * because it is refused otherwise (see test/unit/wm/plantLimits.test.js).
 */
module.exports = {
  init: (srv, options) => TrToHandler.init({
    on: (event, fn) => srv.on(event, (req) => {
      if (PLANT_LIMITED.test(event) && typeof req.user?.is !== 'function') req.user = { ...ADMIN, ...req.user };
      return fn(req);
    })
  }, options)
};
