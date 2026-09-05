sap.ui.define([], function () {
    "use strict";

    var sCsrfToken = null;
    var CSRF_TOKEN_URL = "/odata/v4/purchase-order/";

    /**
     * Centralized OData/CAP HTTP Client handling:
     * - Automatic CSRF token acquisition and refresh
     * - Configurable retries with exponential backoff for transient errors
     * - Uniform OData V4 response and error unwrapping
     */
    var ODataClient = {
        /**
         * Fetches or returns a cached CSRF token.
         *
         * @param {boolean} [bForceRefresh=false]
         * @returns {Promise<string|null>}
         */
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
                try {
                    var oJson = JSON.parse(sText);
                    if (oJson.error && oJson.error.message) {
                        sMessage = oJson.error.message;
                    } else if (oJson.message) {
                        sMessage = oJson.message;
                    } else {
                        sMessage = sText;
                    }
                } catch (e) {
                    sMessage = sText || ("HTTP " + response.status + " " + response.statusText);
                }
                var oErr = new Error(sMessage);
                oErr.status = response.status;
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
            var options = Object.assign({
                method: "GET",
                headers: {},
                maxRetries: 1,
                retryDelayMs: 300
            }, mOptions || {});

            var sMethod = options.method.toUpperCase();
            var bRequiresCsrf = (sMethod === "POST" || sMethod === "PUT" || sMethod === "DELETE" || sMethod === "PATCH");

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
                        try {
                            var sSession = sessionStorage.getItem("saps4hana_fiori_auth_session") || localStorage.getItem("saps4hana_fiori_auth_session");
                            if (sSession) {
                                var oParsed = JSON.parse(sSession);
                                if (oParsed && oParsed.user && oParsed.user.token) {
                                    mHeaders["Authorization"] = "Bearer " + oParsed.user.token;
                                }
                            }
                        } catch (e) {}
                    }

                    var bodyData = options.body;
                    if (bodyData && typeof bodyData === "object") {
                        mHeaders["Content-Type"] = mHeaders["Content-Type"] || "application/json";
                        bodyData = JSON.stringify(bodyData);
                    }

                    return fetch(sUrl, {
                        method: sMethod,
                        headers: mHeaders,
                        body: bodyData
                    });
                })
                    .then(function (response) {
                        // Check for CSRF token expiration (HTTP 403 with x-csrf-token: Required)
                        if (response.status === 403 && bRequiresCsrf && iAttempt === 0) {
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
        post: function (sUrl, oBody, mHeaders) {
            return this.request(sUrl, {
                method: "POST",
                headers: mHeaders,
                body: oBody
            });
        }
    };

    return ODataClient;
});
