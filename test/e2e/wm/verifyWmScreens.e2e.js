'use strict';

/** Tier A read-only E2E: WM goods receipt, handling unit, packing, reservation, scan-to and HU stock transfer screens. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Goods receipt list', hash: 'wm/goods-receipt', route: 'wmGoodsReceipt', needsList: true },
    { name: 'Goods receipt detail (first row)', route: 'wmGoodsReceiptDetail', fromFirstRow: true },
    { name: 'Handling unit list', hash: 'wm/handling-unit', route: 'wmHandlingUnits', needsList: true },
    { name: 'Handling unit detail (first row)', route: 'wmHandlingUnitDetail', fromFirstRow: true },
    { name: 'Packing instruction list', hash: 'wm/packing-instruction', route: 'wmPackingInstructions', needsList: true },
    { name: 'Packing instruction detail (first row)', route: 'wmPackingInstructionDetail', fromFirstRow: true },
    { name: 'Reservation entry list', hash: 'wm/reservation-entry', route: 'wmReservationEntryList', needsList: true },
    { name: 'Reservation entry detail (first row)', route: 'wmReservationEntryDetail', fromFirstRow: true },
    { name: 'Reservation entry create', hash: 'wm/reservation-entry/create', route: 'wmReservationEntryCreate' },
    { name: 'Warehouse scan-to entry', hash: 'wm/scan-to', route: 'wmWarehouseScanTo' },
    { name: 'Warehouse scan-to detail (first open TR)', route: 'wmWarehouseScanToDetailWithWh', fromFirstRow: 'listOpenTRs' },
    { name: 'HU stock transfer list', hash: 'wm/hu-stock-transfer', route: 'wmHuStockTransfer', needsList: true },
    { name: 'HU stock transfer rack (first row)', route: 'wmHuStockTransferRack', fromFirstRow: true },
    { name: 'HU stock transfer detail (same reservation)', route: 'wmHuStockTransferDetail', hashFrom: (h) => h.replace(/\/rack$/, '') },
    { name: 'HU stock transfer rack demo', hash: 'wm/hu-stock-transfer/demo-rack', route: 'wmHuStockTransferRackDemo' }
];

/** Scan 261 has no list entry point; take the first open 261 item from the read-only openItems() function. */
async function mvt261Steps(baseUrl) {
    let item = null;
    try {
        const res = await fetch(`${baseUrl}/odata/v4/mvt261/openItems()`, {
            headers: { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') }
        });
        item = res.ok ? ((await res.json()).Items || [])[0] : null;
    } catch (_) {
        item = null;
    }
    const skip = item ? undefined : 'no open 261 reservation item returned by openItems()';
    const hash = item ? `wm/mvt261/open/${item.Reservation}/${item.ReservationItem}` : '';
    return [
        { name: 'Movement 261 scan (first open item)', hash, route: 'wmScan261', skip },
        { name: 'Movement 261 cycle (same item)', hash: hash && `${hash}/cycle`, route: 'wmCycle261', skip }
    ];
}

async function verifyWmScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'WM screens', steps: STEPS.concat(await mvt261Steps(baseUrl)) });
}

if (require.main === module) {
    verifyWmScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyWmScreens, STEPS };
