'use strict';

/**
 * CAP replaces the text of a 5xx error with a generic message in production unless it sets $sanitize: false.
 * Adapters set that on an error saying SAP may already hold the document, because the text is what stops a duplicate.
 * Handlers rethrow it because req.error and req.reject would drop the flag.
 */
function throwIfTextMustShow(err) {
  if (err.$sanitize === false) throw err;
}

module.exports = { throwIfTextMustShow };
