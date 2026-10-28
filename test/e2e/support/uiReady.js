'use strict';
/* global window, document */

/** Resolves when UI5 is booted and no busy indicator is shown: the readiness check that replaces fixed sleeps. */
function uiReady(page, timeout = 15000) {
    return page.waitForFunction(
        () => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component')
            && ![...document.querySelectorAll('.sapUiLocalBusyIndicator, .sapUiBusyIndicator')].some((e) => e.getClientRects().length > 0), // a closed dialog keeps a hidden one in the DOM
        null, { timeout }
    );
}

module.exports = { uiReady };
