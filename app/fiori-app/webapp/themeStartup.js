// Plain script loaded before UI5 boots (index.html), so the default theme never flashes first.
// It cannot import service/ThemeService.js, because UI5 is not loaded yet; themeService.test.js keeps both lists equal.
(function () {
    "use strict";

    var sTheme = null;
    try {
        sTheme = window.localStorage.getItem("app.theme");
    } catch (e) {
        // storage blocked: use the default
    }
    var aThemes = ["sap_horizon", "sap_horizon_dark", "sap_fiori_3", "sap_fiori_3_dark"];
    window["sap-ui-config"] = { theme: aThemes.indexOf(sTheme) === -1 ? "sap_horizon" : sTheme };
}());
