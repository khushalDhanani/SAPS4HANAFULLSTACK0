const { S4HttpClient } = require('../S4HttpClient');
const { RfcClient } = require('../RfcClient');
const GoodsIssuePostingClient = require('./goods-issue/GoodsIssuePostingClient');

/**
 * Read-only SAP lookups for GoodsIssueAttemptStore.recheck, which resolves posting attempts of
 * movement 261 and HU stock transfer whose outcome SAP has not confirmed.
 */
class GoodsIssueAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.rfc = options.rfc || new RfcClient();
    this.posting = new GoodsIssuePostingClient({ client: this.client, rfc: this.rfc });
  }

  /** Material document already posted under an idempotency reference (read-only), or null. */
  async findPostedGoodsIssueByReference(referenceDocument, movementType, postingDate) {
    return this.posting.findPostedByReference(referenceDocument, movementType, postingDate);
  }

  /** Outbound deliveries SAP created for a reservation item (LIKP/LIPS, read-only). */
  async findDeliveriesForReservationItem(reservationNo, reservationItem) {
    return this.posting.findDeliveriesForReservationItem(reservationNo, reservationItem);
  }

  /** Outbound delivery carrying a posting reference in LIKP-LIFEX (read-only), or null. */
  async findDeliveryByReference(referenceDocument) {
    return this.posting.findDeliveryByReference(referenceDocument);
  }

  /** Read a material document back from SAP to confirm persistence. */
  async readBackDocument(materialDocument, materialDocYear) {
    return this.posting.readBackDocument(materialDocument, materialDocYear);
  }
}

module.exports = new GoodsIssueAdapter();
