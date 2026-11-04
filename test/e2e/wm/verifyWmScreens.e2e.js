'use strict';

/** Tier A read-only E2E: WM goods receipt, handling unit, packing, reservation and HU stock transfer screens. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Goods receipt list', hash: 'wm/goods-receipt', route: 'wmGoodsReceipt', needsList: true },
    { name: 'Goods receipt detail (first row)', route: 'wmGoodsReceiptDetail', fromFirstRow: true },
    { name: 'Handling unit list', hash: 'wm/handling-unit', route: 'wmHandlingUnits', needsList: true },
    { name: 'Handling unit detail (first row)', route: 'wmHandlingUnitDetail', fromFirstRow: true },
    { name: 'Packing instruction list', hash: 'wm/packing-instruction', route: 'wmPackingInstructions', needsList: true },
    { name: 'Packing instruction detail (first row)', route: 'wmPackingInstructionDetail', fromFirstRow: true },
    { name: 'HU stock transfer list', hash: 'wm/hu-stock-transfer', route: 'wmHuStockTransfer', needsList: true },
    { name: 'HU stock transfer rack (first row)', route: 'wmHuStockTransferRack', fromFirstRow: true },
    { name: 'HU stock transfer detail (same reservation)', route: 'wmHuStockTransferDetail', hashFrom: (h) => h.replace(/\/rack$/, '') },
    { name: 'HU stock transfer rack demo', hash: 'wm/hu-stock-transfer/demo-rack', route: 'wmHuStockTransferRackDemo' }
];

async function verifyWmScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'WM screens', steps: STEPS });
}

if (require.main === module) {
    verifyWmScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyWmScreens, STEPS };
