sap.ui.define(["sap/base/Log"], function (Log) {
    "use strict";

    var sCsrfToken = null;
    var CSRF_TOKEN_URL = "/odata/v4/auth/";

    /**
     * Centralized OData/CAP HTTP Client handling:
     * - Automatic CSRF token acquisition and refresh
     * - Configurable retries with exponential backoff for transient errors
     * - Uniform OData V4 response and error unwrapping
     */
    var ODataClient = {
        /**
         * Read a CAP entity set using a V4 list binding or the shared HTTP client.
         * Callers resolve their own service base and stored model. Options preserve
         * the existing services' context-length and filter-accessor contracts.
         * @param {string} sServiceBase Service-relative URL
         * @param {object} oModel Optional OData V4 model
         * @param {string} sEntitySet Entity-set path including leading slash
         * @param {object[]} aFilters List filters
         * @param {object} mParameters Binding/query parameters
         * @param {object} mOptions useContextLength maps $top to requestContexts;
         *   useFilterGetters accepts filters exposing getPath/getValue1.
         * @returns {Promise<object[]>} Entity objects
         */
        readEntitySet: function (sServiceBase, oModel, sEntitySet, aFilters, mParameters, mOptions) {
            var oOptions = mOptions || {};
            if (!oModel || typeof oModel.bindList !== "function") {
                var sUrl = sServiceBase + sEntitySet;
                var aParts = [];
                if (aFilters && aFilters.length > 0) {
                    var aFilterParts = aFilters.map(function (f) {
                        var sValue = f.oValue1;
                        var sPath = f.sPath;
                        if (oOptions.useFilterGetters) {
                            sValue = sValue !== undefined ? sValue : (f.getValue1 ? f.getValue1() : "");
                            sPath = sPath || (f.getPath ? f.getPath() : "");
                        }
                        return sPath + " eq '" + encodeURIComponent(sValue) + "'";
                    });
                    aParts.push("$filter=" + aFilterParts.join(" and "));
                }
                if (mParameters && mParameters.$top) {
                    aParts.push("$top=" + mParameters.$top);
                }
                if (aParts.length > 0) {
                    sUrl += "?" + aParts.join("&");
                }
                return this.get(sUrl).then(function (result) {
                    if (!result) return [];
                    return result.value || (result.d && result.d.results) || [];
                });
            }

            var iLength = Infinity;
            var mBindingParameters = mParameters;
            if (oOptions.useContextLength) {
                // $top is a context count, not a V4 list-binding parameter.
                iLength = (mParameters && mParameters.$top) ? Number(mParameters.$top) : Infinity;
                mBindingParameters = Object.assign({}, mParameters);
                delete mBindingParameters.$top;
                if (!Object.keys(mBindingParameters).length) mBindingParameters = undefined;
            }
            var oListBinding = oModel.bindList(sEntitySet, undefined, undefined, aFilters, mBindingParameters);
            return oListBinding.requestContexts(0, iLength).then(function (aContexts) {
                return aContexts.map(function (oContext) { return oContext.getObject(); });
            });
        },

        /**
         * Fetches or returns a cached CSRF token.
         *
         * @param {boolean} [bForceRefresh=false]
         * @returns {Promise<string|null>}
         */
        /** Authorization header from the stored login session ({} when none / unreadable). */
        authHeaders: function () {
            try {
                var sSession = sessionStorage.getItem("saps4hana_fiori_auth_session") || localStorage.getItem("saps4hana_fiori_auth_session");
                if (sSession) {
                    var oParsed = JSON.parse(sSession);
                    var sAuthToken = (oParsed && oParsed.user && oParsed.user.token) || (oParsed && oParsed.token) || null;
                    if (sAuthToken) { return { "Authorization": "Bearer " + sAuthToken }; }
                }
            } catch (e) {
                // Corrupt or unreadable session: the request goes out unauthenticated and will 401.
                if (Log && typeof Log.warning === "function") {
                    Log.warning("ODataClient: stored auth session unreadable (" + (e && e.message) + ")");
                }
            }
            return {};
        },

        fetchCsrfToken: function (bForceRefresh) {
            if (sCsrfToken && !bForceRefresh) {
                return Promise.resolve(sCsrfToken);
            }

            return fetch(CSRF_TOKEN_URL, {
                method: "HEAD",
                headers: {
                    "X-CSRF-Token": "Fetch",
                    "Accept": "application/json"
                }
            })
                .then(function (response) {
                    var sToken = response.headers.get("X-CSRF-Token") || response.headers.get("x-csrf-token");
                    if (sToken) {
                        sCsrfToken = sToken;
                    }
                    return sCsrfToken;
                })
                .catch(function () {
                    // If HEAD fails (e.g. local dev without CSRF protection), resolve null
                    return null;
                });
        },

        /**
         * Clears cached CSRF token (useful after HTTP 403 CSRF validation failures).
         */
        clearCsrfToken: function () {
            sCsrfToken = null;
        },

        /**
         * Parses error responses into a human-readable Error instance.
         *
         * @param {Response} response
         * @returns {Promise<Error>}
         */
        parseError: function (response) {
            return response.text().then(function (sText) {
                var sMessage;
                var aDetails = [];
                var sCode = "";
                var oParsedJson = null;
                try {
                    var oJson = JSON.parse(sText);
                    oParsedJson = oJson;
                    if (oJson.error) {
                        var oErrObj = oJson.error;
                        sCode = oErrObj.code || "";
                        if (oErrObj.message) {
                            sMessage = typeof oErrObj.message === "object" ? (oErrObj.message.value || JSON.stringify(oErrObj.message)) : oErrObj.message;
                        }
                        if (oErrObj.target && (!sMessage || sMessage === sCode || oErrObj.target.length > (sMessage || "").length)) {
                            sMessage = oErrObj.target;
                        }
                        if (Array.isArray(oErrObj.details)) {
                            aDetails = oErrObj.details;
                        } else if (oErrObj.innererror && Array.isArray(oErrObj.innererror.errordetails)) {
                            aDetails = oErrObj.innererror.errordetails;
                        }
                    } else if (oJson.message) {
                        sMessage = oJson.message;
                    } else {
                        sMessage = sText;
                    }
                } catch (e) {
                    sMessage = sText || ("HTTP " + response.status + " " + response.statusText);
                }
                var oErr = new Error(sMessage || ("HTTP " + response.status));
                oErr.status = response.status;
                oErr.code = sCode;
                oErr.details = aDetails;
                oErr.rawResponse = sText;
                oErr.errorJson = oParsedJson;
                return oErr;
            });
        },

        /**
         * Executes an HTTP request with automatic CSRF management and retry capabilities.
         *
         * @param {string} sUrl
         * @param {Object} [mOptions]
         * @param {string} [mOptions.method="GET"]
         * @param {Object} [mOptions.headers]
         * @param {any} [mOptions.body]
         * @param {number} [mOptions.maxRetries=1]
         * @param {number} [mOptions.retryDelayMs=300]
         * @returns {Promise<any>}
         */
        request: function (sUrl, mOptions) {
            var that = this;
            var sMethod = String((mOptions && mOptions.method) || "GET").toUpperCase();
            var bRequiresCsrf = (sMethod === "POST" || sMethod === "PUT" || sMethod === "DELETE" || sMethod === "PATCH");
            var options = Object.assign({
                method: "GET",
                headers: {},
                // A write is never re-sent automatically: a 502/503/504 or a dropped connection does
                // not tell whether the server already posted it in SAP, so a resend can post twice.
                maxRetries: bRequiresCsrf ? 0 : 1,
                retryDelayMs: 300
            }, mOptions || {});

            function executeAttempt(iAttempt) {
                var pCsrf = bRequiresCsrf ? that.fetchCsrfToken() : Promise.resolve(null);

                return pCsrf.then(function (token) {
                    var mHeaders = Object.assign({
                        "Accept": "application/json"
                    }, options.headers);

                    if (token) {
                        mHeaders["X-CSRF-Token"] = token;
                    }

                    if (!mHeaders["Authorization"]) {
                        Object.assign(mHeaders, that.authHeaders());
                    }

                    var bodyData = options.body;
                    if (bodyData && typeof bodyData === "object") {
                        mHeaders["Content-Type"] = mHeaders["Content-Type"] || "application/json";
                        bodyData = JSON.stringify(bodyData);
                    }

                    return fetch(sUrl, {
                        method: sMethod,
                        headers: mHeaders,
                        body: bodyData,
                        credentials: "same-origin",
                        signal: options.signal // optional AbortSignal for cancellable requests
                    });
                })
                    .then(function (response) {
                        // Check for CSRF token expiration (HTTP 403 with x-csrf-token: Required)
                        if (response.status === 403 && bRequiresCsrf && iAttempt === 0 &&
                            String(response.headers.get("x-csrf-token") || "").toLowerCase() === "required") {
                            that.clearCsrfToken();
                            return that.fetchCsrfToken(true).then(function () {
                                return executeAttempt(iAttempt + 1);
                            });
                        }

                        // Check for transient server errors eligible for retry (502, 503, 504)
                        if ((response.status === 502 || response.status === 503 || response.status === 504) && iAttempt < options.maxRetries) {
                            return new Promise(function (resolve) {
                                setTimeout(resolve, options.retryDelayMs * Math.pow(2, iAttempt));
                            }).then(function () {
                                return executeAttempt(iAttempt + 1);
                            });
                        }

                        if (!response.ok) {
                            if (response.status === 401) {
                                try {
                                    sessionStorage.removeItem("saps4hana_fiori_auth_session");
                                    localStorage.removeItem("saps4hana_fiori_auth_session");
                                } catch (e) {
                                    // Storage unavailable (private mode): nothing to clear.
                                }
                            }
                            return that.parseError(response).then(function (err) {
                                throw err;
                            });
                        }

                        // Handle 204 No Content
                        if (response.status === 204) {
                            return null;
                        }

                        return response.json().then(function (result) {
                            return result;
                        }).catch(function () {
                            return null;
                        });
                    })
                    .catch(function (error) {
                        // Retry on network disconnect errors if attempts remain
                        if (iAttempt < options.maxRetries && error && error.name === "TypeError") {
                            return new Promise(function (resolve) {
                                setTimeout(resolve, options.retryDelayMs * Math.pow(2, iAttempt));
                            }).then(function () {
                                return executeAttempt(iAttempt + 1);
                            });
                        }
                        throw error;
                    });
            }

            return executeAttempt(0);
        },

        /**
         * Convenience GET request.
         *
         * @deprecated Prefer SAPUI5 OData V4 model bindings (bindList / bindContext) for entity set queries.
         * ODataClient is maintained for unbound actions, function imports, and fallback requests.
         * @param {string} sUrl
         * @param {Object} [mHeaders]
         * @returns {Promise<any>}
         */
        get: function (sUrl, mHeaders) {
            return this.request(sUrl, {
                method: "GET",
                headers: mHeaders
            });
        },

        /**
         * Convenience POST request with CSRF handling.
         *
         * @param {string} sUrl
         * @param {Object} oBody
         * @param {Object} [mHeaders]
         * @returns {Promise<any>}
         */
        post: function (sUrl, oBody, mHeaders, mOptions) {
            return this.request(sUrl, Object.assign({
                method: "POST",
                headers: mHeaders,
                body: oBody
            }, mOptions || {}));
        }
    };

    return ODataClient;
});
