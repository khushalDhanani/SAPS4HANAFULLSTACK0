sap.ui.define([
    "sap/ui/core/Theming"
], function (Theming) {
    "use strict";

    var STORAGE_KEY = "app.theme";
    var DEFAULT_THEME = "sap_horizon";
    // Keep in sync with themeStartup.js and the menu in CommonHeader.fragment.xml (themeService.test.js checks both)
    var THEMES = ["sap_horizon", "sap_horizon_dark", "sap_fiori_3", "sap_fiori_3_dark"];

    return {
        STORAGE_KEY: STORAGE_KEY,
        DEFAULT_THEME: DEFAULT_THEME,
        THEMES: THEMES,

        /**
         * The saved theme, or the default when nothing valid is saved or storage is blocked.
         *
         * @returns {string}
         */
        getSavedTheme: function () {
            var sTheme = null;
            try {
                sTheme = window.localStorage.getItem(STORAGE_KEY);
            } catch (e) {
                // storage blocked: use the default
            }
            return THEMES.indexOf(sTheme) === -1 ? DEFAULT_THEME : sTheme;
        },

        /**
         * Applies a theme at once, without a reload, and saves it. An unknown theme is ignored.
         *
         * @param {string} sTheme
         */
        applyTheme: function (sTheme) {
            if (THEMES.indexOf(sTheme) === -1) {
                return;
            }
            Theming.setTheme(sTheme);
            try {
                window.localStorage.setItem(STORAGE_KEY, sTheme);
            } catch (e) {
                // storage blocked: the theme still applies for this page load
            }
        },

        /**
         * Applies the saved theme. index.html already boots UI5 with it; this covers entry points
         * that do not use index.html, such as the FLP preview.
         *
         * @returns {string} the theme now active
         */
        restoreTheme: function () {
            var sTheme = this.getSavedTheme();
            Theming.setTheme(sTheme);
            return sTheme;
        }
    };
});
