'use strict';

/** Tier A read-only E2E: WM goods receipt, handling unit and packing screens. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Goods receipt list', hash: 'wm/goods-receipt', route: 'wmGoodsReceipt', needsList: true, expectRows: true },
    { name: 'Goods receipt detail (first row)', route: 'wmGoodsReceiptDetail', fromFirstRow: true },
    { name: 'Handling unit list', hash: 'wm/handling-unit', route: 'wmHandlingUnits', needsList: true, expectRows: true },
    { name: 'Handling unit detail (first row)', route: 'wmHandlingUnitDetail', fromFirstRow: true },
    { name: 'Packing instruction list', hash: 'wm/packing-instruction', route: 'wmPackingInstructions', needsList: true, expectRows: true },
    { name: 'Packing instruction detail (first row)', route: 'wmPackingInstructionDetail', fromFirstRow: true },
];

async function verifyWmScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'WM screens', steps: STEPS });
}

if (require.main === module) {
    verifyWmScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyWmScreens, STEPS };
