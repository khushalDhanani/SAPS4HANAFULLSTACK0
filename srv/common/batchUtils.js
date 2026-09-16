/**
 * Shared Batch & SLED (Shelf Life Expiration Date) Utilities
 *
 * Evaluates batch expiration against current date and assigns standard Fiori status
 * states (Success, Warning, Error, None) and descriptions.
 */

/**
 * Enriches batch object with SLED classification against current date.
 *
 * @param {string|number|Date|null|undefined} expiryDate - Expiration date in /Date(ms)/, ISO, Date, or timestamp
 * @returns {{ StatusState: string, StatusText: string, DaysToExpiry: number }}
 */
function enrichBatchStatus(expiryDate) {
  if (!expiryDate) {
    return { StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 };
  }

  let exp = null;
  if (typeof expiryDate === 'string') {
    const trimmed = expiryDate.trim();
    if (!trimmed) {
      return { StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 };
    }
    const match = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(trimmed);
    if (match) {
      exp = new Date(parseInt(match[1], 10));
    } else {
      exp = new Date(trimmed);
    }
  } else if (expiryDate instanceof Date) {
    exp = expiryDate;
  } else if (typeof expiryDate === 'number') {
    exp = new Date(expiryDate);
  }

  if (!exp || isNaN(exp.getTime())) {
    return { StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 };
  }

  const now = new Date();
  const expCopy = new Date(exp.getTime());
  expCopy.setHours(0, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = expCopy.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { StatusState: 'Error', StatusText: 'EXPIRED', DaysToExpiry: diffDays };
  } else if (diffDays <= 30) {
    return { StatusState: 'Warning', StatusText: 'EXPIRING SOON', DaysToExpiry: diffDays };
  } else {
    return { StatusState: 'Success', StatusText: 'VALID', DaysToExpiry: diffDays };
  }
}

module.exports = {
  enrichBatchStatus
};
