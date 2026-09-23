const LOG = require('../../../common/logger')('outbound-delivery');
const outboundDeliveryAdapter = require('../../../integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const s4Config = require('../../../common/s4Config');
const { applyPaging, extractFilterParam } = require('../../../common/filterUtils');

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
      let filtered = orders;
      const isDeliverableParam = extractFilterParam(req, 'IsDeliverable');
      const approvalStatusParam = extractFilterParam(req, 'SalesDocApprovalStatus');

      if (isDeliverableParam !== null) {
        const targetBool = String(isDeliverableParam).toLowerCase() === 'true';
        filtered = filtered.filter(o => Boolean(o.IsDeliverable) === targetBool);
      }
      if (approvalStatusParam !== null) {
        filtered = filtered.filter(o => String(o.SalesDocApprovalStatus || '') === String(approvalStatusParam));
      }

      return applyPaging(filtered, req);
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

    const configuredSPs = s4Config.getShippingPoints();
    const resolvedSP = ShippingPoint && String(ShippingPoint).trim() !== ''
      ? String(ShippingPoint).trim()
      : configuredSPs[0];

    try {
      const result = await outboundDeliveryAdapter.createDeliveryFromOrder({
        salesOrder: SalesOrder,
        shippingPoint: resolvedSP,
        deliveryDate: DeliveryDate
      });
      return result.OutboundDelivery || '';
    } catch (err) {
      LOG.error(`Error in createOutboundDelivery (${err.status || 500}): ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 4. Function getDefaultShippingPoint
  srv.on('getDefaultShippingPoint', async () => {
    const configuredSPs = s4Config.getShippingPoints();
    return {
      ShippingPoint: configuredSPs[0],
      ShippingPoints: configuredSPs
    };
  });

  // 5. PGI / billing on an existing delivery — SAP's result only, never a synthesized number
  srv.on('getDeliveryStatus', async (req) => {
    try {
      const status = await outboundDeliveryAdapter.getDeliveryStatus(req.data?.DeliveryDocument);
      if (!status) return req.error(404, `Delivery ${req.data?.DeliveryDocument} was not found in S/4HANA.`);
      return status;
    } catch (err) {
      LOG.error(`getDeliveryStatus failed: ${err.message}`);
      return req.error(err.status || 502, err.message);
    }
  });

  srv.on('postGoodsIssue', async (req) => {
    try {
      return await outboundDeliveryAdapter.postGoodsIssue(req.data?.DeliveryDocument);
    } catch (err) {
      LOG.error(`postGoodsIssue failed: ${err.message}`);
      return req.error(err.status || 502, err.message);
    }
  });

  srv.on('getBillingDocumentTypes', async (req) => {
    try {
      return await outboundDeliveryAdapter.getBillingDocumentTypes(req.data?.DeliveryDocument);
    } catch (err) {
      LOG.error(`getBillingDocumentTypes failed: ${err.message}`);
      return req.error(err.status || 502, err.message);
    }
  });

  srv.on('createBillingDocument', async (req) => {
    const { DeliveryDocument, BillingDocumentType, BillingDocumentDate } = req.data || {};
    try {
      return await outboundDeliveryAdapter.createBillingDocument({ deliveryDocument: DeliveryDocument, billingDocumentType: BillingDocumentType, billingDocumentDate: BillingDocumentDate });
    } catch (err) {
      LOG.error(`createBillingDocument failed: ${err.message}`);
      return req.error(err.status || 502, err.message);
    }
  });

  // 6. Function getOrdersDueMetrics: counts over the full due set (same SAP read as the worklist, unpaged)
  srv.on('getOrdersDueMetrics', async (req) => {
    try {
      const rows = await outboundDeliveryAdapter.getOrdersDueForDelivery({});
      if (!Array.isArray(rows)) {
        throw new Error('Orders due for delivery could not be read from S/4HANA');
      }
      const shippingPoints = new Set();
      const distinctOrders = new Set();
      const readyOrders = new Set();
      const inApprovalOrders = new Set();
      let readyToDeliverCount = 0;
      let inApprovalCount = 0;
      for (const r of rows) {
        if (!r) continue;
        if (r.ShippingPoint) shippingPoints.add(r.ShippingPoint);
        if (r.SalesOrder) {
          distinctOrders.add(r.SalesOrder);
          if (r.IsDeliverable) readyOrders.add(r.SalesOrder);
          if (r.SalesDocApprovalStatus === 'A') inApprovalOrders.add(r.SalesOrder);
        }
        if (r.IsDeliverable) readyToDeliverCount++;
        if (r.SalesDocApprovalStatus === 'A') inApprovalCount++;
      }
      return {
        scheduleLineCount: rows.length,
        readyToDeliverCount,
        inApprovalCount,
        shippingPointCount: shippingPoints.size,
        distinctOrdersCount: distinctOrders.size,
        readyOrdersCount: readyOrders.size,
        inApprovalOrdersCount: inApprovalOrders.size
      };
    } catch (err) {
      LOG.error(`Failed to compute orders-due metrics: ${err.message}`);
      return req.error(err.status || 502, err.message);
    }
  });
}

module.exports = registerOutboundDeliveryHandlers;
