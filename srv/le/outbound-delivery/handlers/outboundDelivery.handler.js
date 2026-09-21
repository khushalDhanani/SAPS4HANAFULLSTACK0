const LOG = require('../../../common/logger')('outbound-delivery');
const outboundDeliveryAdapter = require('../../../integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const s4Config = require('../../../common/s4Config');
const { applyPaging } = require('../../../common/filterUtils');

/**
 * Registers Outbound Delivery business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerOutboundDeliveryHandlers(srv) {
  // 1. READ OrdersDueForDelivery
  srv.on('READ', 'OrdersDueForDelivery', async (req) => {
    try {
      const orders = await outboundDeliveryAdapter.getOrdersDueForDelivery(req);
      return applyPaging(orders, req);
    } catch (err) {
      LOG.error(`Failed to read due orders: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 2. READ ShippingPointVH
  srv.on('READ', 'ShippingPointVH', async (req) => {
    try {
      const shippingPoints = await outboundDeliveryAdapter.getShippingPoints();
      return applyPaging(shippingPoints, req);
    } catch (err) {
      LOG.error(`Failed to read shipping points: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 3. Action createOutboundDelivery
  srv.on('createOutboundDelivery', async (req) => {
    const { SalesOrder, ShippingPoint, DeliveryDate } = req.data || {};

    if (!SalesOrder || String(SalesOrder).trim() === '') {
      return req.error(400, 'SalesOrder is required to create an outbound delivery.');
    }

    const configuredSPs = s4Config.getShippingPoints() || ['1120'];
    const resolvedSP = ShippingPoint && String(ShippingPoint).trim() !== ''
      ? String(ShippingPoint).trim()
      : configuredSPs[0] || '1120';

    try {
      const result = await outboundDeliveryAdapter.createDeliveryFromOrder({
        salesOrder: SalesOrder,
        shippingPoint: resolvedSP,
        deliveryDate: DeliveryDate
      });
      return result.OutboundDelivery || 'Delivery created';
    } catch (err) {
      LOG.error(`Error in createOutboundDelivery (${err.status || 500}): ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 4. Function getDefaultShippingPoint
  srv.on('getDefaultShippingPoint', async () => {
    const configuredSPs = s4Config.getShippingPoints() || ['1120'];
    return {
      ShippingPoint: configuredSPs[0] || '1120',
      ShippingPoints: configuredSPs
    };
  });
}

module.exports = registerOutboundDeliveryHandlers;
