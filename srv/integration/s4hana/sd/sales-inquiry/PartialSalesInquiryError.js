/**
 * Error thrown when a multi-step Sales Inquiry creation partially succeeds (header persisted in SAP,
 * but a subsequent item or price condition write fails). Carries the created SAP document number
 * to prevent duplicate retries.
 */
class PartialSalesInquiryError extends Error {
  constructor(message, inquiryId, details = {}) {
    super(message);
    this.name = 'PartialSalesInquiryError';
    this.SalesInquiry = String(inquiryId || '').trim();
    this.documentNumber = this.SalesInquiry;
    this.isPartialCreation = true;
    this.$sanitize = false; // see srv/common/visibleError.js
    this.status = details.status || 502;
    this.step = details.step || 'UNKNOWN';
    this.itemNumber = details.itemNumber || '';
    this.sapMessage = details.sapMessage || message;
    if (details.originalError) {
      this.cause = details.originalError;
      if (details.originalError.response) {
        this.response = details.originalError.response;
      }
    }
  }
}

module.exports = { PartialSalesInquiryError };
