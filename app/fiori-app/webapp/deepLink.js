(function (root) {
    "use strict";

    function normalizeDirect261Link(location, history, title) {
        var routePath = "/wm/goods-issue/order-based-261";
        var pathname = location.pathname.replace(/\/+$/, "");
        if (pathname !== routePath) {
            return false;
        }

        history.replaceState(null, title, "/saps4hanafiori/index.html#" + routePath + location.search);
        return true;
    }

    if (typeof module === "object" && module.exports) {
        module.exports = normalizeDirect261Link;
    } else {
        normalizeDirect261Link(root.location, root.history, root.document.title);
    }
})(typeof window === "undefined" ? globalThis : window);
