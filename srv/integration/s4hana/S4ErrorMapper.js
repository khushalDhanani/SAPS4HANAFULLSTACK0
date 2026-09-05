/**
 * S4ErrorMapper
 * Extracts and formats user-friendly error messages from SAP S/4HANA Gateway
 * and SAP Cloud SDK error responses.
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

module.exports = {
    extractS4ErrorMessage
};
