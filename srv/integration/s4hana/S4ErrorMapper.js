/**
 * S4ErrorMapper
 * Extracts and formats user-friendly error messages and maps them to semantic
 * HTTP status codes according to standard SAP error classifications.
 */

function _filterErrorDetails(details) {
    if (!Array.isArray(details) || details.length === 0) return [];
    const messages = details
        .map(d => d.message)
        .filter(m => m && typeof m === 'string' && m.trim().length > 0 && !m.startsWith('System error in backend'));
    return [...new Set(messages)];
}

/**
 * Extracts descriptive error messages from S/4 Gateway error payloads.
 *
 * @param {Error|Object} error
 * @returns {string}
 */
function extractS4ErrorMessage(error) {
    if (!error) {
        return 'Unknown error occurred during S/4HANA operation';
    }

    // 1. Direct OData V2 JSON error response in error.response.data
    const odataError = error.response?.data?.error;
    if (odataError) {
        const messages = _filterErrorDetails(odataError.innererror?.errordetails);
        if (messages.length > 0) {
            return messages.join('; ');
        }

        if (odataError.message?.value) {
            return odataError.message.value;
        }
    }

    // 2. Embedded JSON within error.message (common in fetch/Cloud SDK exceptions)
    if (typeof error.message === 'string') {
        const jsonMatch = error.message.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                const messages = _filterErrorDetails(parsed.error?.innererror?.errordetails);
                if (messages.length > 0) {
                    return messages.join('; ');
                }
                if (parsed.error?.message?.value) {
                    return parsed.error.message.value;
                }
            } catch (e) {
                // Ignore parse errors, proceed to fallback
            }
        }
        return error.message;
    }

    return String(error);
}

/**
 * Extracts error code from S/4 error payload if available.
 *
 * @param {Error|Object} error
 * @returns {string}
 */
function _extractErrorCode(error) {
    if (!error) return 'UNKNOWN';

    const odataError = error.response?.data?.error;
    if (odataError?.code) return odataError.code;

    if (error.code) return error.code;

    if (typeof error.message === 'string') {
        const jsonMatch = error.message.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.error?.code) return parsed.error.code;
            } catch (e) {
                // Ignore
            }
        }
    }

    return 'UNKNOWN';
}

/**
 * Maps an S/4HANA or Cloud SDK error into a semantic SAP error object:
 * - 400: Invalid user/business input format
 * - 401: Authentication failure
 * - 403: Authorization missing
 * - 404: Resource not found
 * - 409: Business conflict (e.g. document/vendor locked)
 * - 422: Business validation failure (e.g. invalid plant/quantity/vendor blocked)
 * - 502/503: S/4 integration or network unavailable
 * - 500: Actual internal application failure
 *
 * @param {Error|Object} error
 * @returns {{ status: number, message: string, code: string, details: Array<any> }}
 */
function mapS4Error(error) {
    if (!error) {
        return {
            status: 500,
            message: 'Unknown error occurred during S/4HANA operation',
            code: 'UNKNOWN',
            details: []
        };
    }

    const message = extractS4ErrorMessage(error);
    const code = _extractErrorCode(error);
    const sMessageLower = message.toLowerCase();
    const sCodeUpper = code.toUpperCase();
    const httpStatus = error.response?.status;
    const errorCode = error.code ? String(error.code).toUpperCase() : '';

    // Collect structured details if present
    const odataError = error.response?.data?.error;
    const rawDetails = odataError?.innererror?.errordetails || [];
    const hasBusiException = sCodeUpper.includes('BUSI_EXCEPTION') ||
        rawDetails.some(d => d.code && d.code.toUpperCase().includes('BUSI_EXCEPTION'));
    const hasTechException = sCodeUpper.includes('TECH_EXCEPTION') ||
        rawDetails.some(d => d.code && d.code.toUpperCase().includes('TECH_EXCEPTION'));

    let status = 500;

    // 1. Network / S/4 Gateway Unavailability (502 / 503)
    if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' || errorCode === 'ECONNRESET' ||
        sMessageLower.includes('destination could not be found') ||
        sMessageLower.includes('network error') ||
        sMessageLower.includes('connection refused') ||
        sMessageLower.includes('etimedout') ||
        httpStatus === 503) {
        status = 503;
    } else if (httpStatus === 502 || httpStatus === 504 || sMessageLower.includes('gateway timeout')) {
        status = 502;
    }
    // 2. Authentication (401)
    else if (httpStatus === 401 ||
        sMessageLower.includes('unauthorized') ||
        sMessageLower.includes('authentication failed') ||
        sMessageLower.includes('logon failed') ||
        sMessageLower.includes('jwt expired')) {
        status = 401;
    }
    // 3. Authorization (403)
    else if (httpStatus === 403 ||
        sCodeUpper.includes('NOT_AUTHORIZED') ||
        sMessageLower.includes('not authorized') ||
        sMessageLower.includes('no authorization') ||
        sMessageLower.includes('forbidden')) {
        status = 403;
    }
    // 4. Resource Not Found (404)
    else if (httpStatus === 404 ||
        sMessageLower.includes('resource not found') ||
        sMessageLower.includes('does not exist in system')) {
        status = 404;
    }
    // 5. Business Conflict / Lock (409)
    else if (httpStatus === 409 ||
        sMessageLower.includes('locked by') ||
        sMessageLower.includes('being processed by') ||
        sMessageLower.includes('foreign lock') ||
        sMessageLower.includes('enqueue')) {
        status = 409;
    }
    // 6. Business Validation (422)
    // Matches S/4 Gateway CX_MGW_BUSI_EXCEPTION or standard SAP message classes (ME, M3, MM, AM, 06, BAPI)
    else if (hasBusiException ||
        /^(AM|ME|M3|MM|06|BAPI|VL|V1|00|F5)\/\d+/.test(code) ||
        rawDetails.some(d => /^(AM|ME|M3|MM|06|BAPI|VL|V1|00|F5)\/\d+/.test(d.code || '')) ||
        sMessageLower.includes('enter plant') ||
        sMessageLower.includes('enter material') ||
        sMessageLower.includes('order quantity') ||
        sMessageLower.includes('address is incomplete') ||
        sMessageLower.includes('is blocked for') ||
        sMessageLower.includes('posting period') ||
        sMessageLower.includes('tax code') ||
        sMessageLower.includes('does not exist in plant')) {
        status = 422;
    }
    // 7. Invalid Input / Bad Request (400)
    else if (httpStatus === 400) {
        status = 400;
    }
    // 8. Explicit Technical Failure (500)
    else if (hasTechException) {
        status = 500;
    }
    // Fallback: inherit upstream HTTP status if present, otherwise 500
    else if (httpStatus && httpStatus >= 400 && httpStatus < 600) {
        status = httpStatus;
    }

    return {
        status,
        message,
        code,
        details: rawDetails
    };
}

module.exports = {
    extractS4ErrorMessage,
    mapS4Error
};
