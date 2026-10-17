/**
 * Tests for Open261 controller sorting, tab filtering, and navigation logic.
 */
let Open261Controller;
const BaseController = { extend: (_name, obj) => { Open261Controller = obj; return obj; } };
const JSONModel = function (initialData) {
  const data = { ...initialData };
  const norm = (p) => (p && p.startsWith('/') ? p.slice(1) : p);
  return {
    getData: () => data,
    getProperty: (p) => data[norm(p)],
    setProperty: (p, v) => { data[norm(p)] = v; },
    setSizeLimit: () => {}
  };
};
const ODataClient = { get: jest.fn() };

global.sap = {
  ui: {
    define: (_deps, factory) => {
      factory(BaseController, JSONModel, ODataClient);
    }
  }
};

require('../../../app/fiori-app/webapp/modules/wm/mvt261/controller/Open261.controller');

describe('Open261.controller sorting and lifecycle', () => {
  let ctrl;
  let model;
  let navTarget;

  beforeEach(() => {
    ctrl = Object.create(Open261Controller);
    model = null;
    navTarget = null;
    ctrl.setModel = (m) => { model = m; };
    ctrl.getModel = () => model;
    ctrl.getText = (k, args) => `${k}:${(args || []).join(',')}`;
    ctrl.getRouter = () => ({
      getRoute: () => ({ attachPatternMatched: jest.fn() }),
      navTo: (route, args) => { navTarget = { route, args }; }
    });
    ctrl.onInit();
  });

  it('initializes with sortDescending: true, selectedTab: open, and empty items', () => {
    expect(model.getProperty('/sortDescending')).toBe(true);
    expect(model.getProperty('/selectedTab')).toBe('open');
    expect(model.getProperty('/openCount')).toBe(0);
    expect(model.getProperty('/blockedCount')).toBe(0);
    expect(model.getProperty('/allCount')).toBe(0);
    expect(model.getProperty('/items')).toEqual([]);
  });

  it('onGo retrieves items, calculates tab counts, and displays open items in DESC order', async () => {
    ODataClient.get.mockResolvedValueOnce({
      TotalCount: 4,
      SapOpenCount: 4,
      Truncated: false,
      Items: [
        { Reservation: '100', ReservationItem: '1', RequirementDate: '2026-01-01', ScanPossible: true },
        { Reservation: '300', ReservationItem: '1', RequirementDate: '2026-05-01', ScanPossible: true },
        { Reservation: '200', ReservationItem: '2', RequirementDate: '2026-05-01', ScanPossible: true },
        { Reservation: '400', ReservationItem: '1', RequirementDate: '2026-06-01', ScanPossible: false, BlockReason: 'No stock' }
      ]
    });

    ctrl.onGo();
    await Promise.resolve();
    await Promise.resolve();

    expect(model.getProperty('/openCount')).toBe(3);
    expect(model.getProperty('/blockedCount')).toBe(1);
    expect(model.getProperty('/allCount')).toBe(4);

    // Active tab is "open" -> only the 3 ScanPossible=true items, sorted DESC
    const items = model.getProperty('/items');
    expect(items.map((i) => `${i.RequirementDate}|${i.Reservation}|${i.ReservationItem}`)).toEqual([
      '2026-05-01|300|1',
      '2026-05-01|200|2',
      '2026-01-01|100|1'
    ]);
  });

  it('onTabSelect switches between open, blocked, and all tabs', async () => {
    ODataClient.get.mockResolvedValueOnce({
      TotalCount: 3,
      SapOpenCount: 3,
      Truncated: false,
      Items: [
        { Reservation: '100', ReservationItem: '1', RequirementDate: '2026-01-01', ScanPossible: true },
        { Reservation: '200', ReservationItem: '1', RequirementDate: '2026-02-01', ScanPossible: false, BlockReason: 'Order not released' },
        { Reservation: '300', ReservationItem: '1', RequirementDate: '2026-03-01', ScanPossible: false, BlockReason: 'No ready units' }
      ]
    });

    ctrl.onGo();
    await Promise.resolve();
    await Promise.resolve();

    // Default tab: open
    expect(model.getProperty('/items').map((i) => i.Reservation)).toEqual(['100']);

    // Switch to blocked
    ctrl.onTabSelect({ getParameter: () => 'blocked', getSource: () => ({ getSelectedKey: () => 'blocked' }) });
    expect(model.getProperty('/selectedTab')).toBe('blocked');
    expect(model.getProperty('/items').map((i) => i.Reservation)).toEqual(['300', '200']); // DESC

    // Switch to all
    ctrl.onTabSelect({ getParameter: () => 'all', getSource: () => ({ getSelectedKey: () => 'all' }) });
    expect(model.getProperty('/selectedTab')).toBe('all');
    expect(model.getProperty('/items').map((i) => i.Reservation)).toEqual(['300', '200', '100']); // DESC
  });

  it('onToggleSort flips between DESC and ASC order on the selected tab', async () => {
    ODataClient.get.mockResolvedValueOnce({
      TotalCount: 3,
      SapOpenCount: 3,
      Truncated: false,
      Items: [
        { Reservation: '100', ReservationItem: '1', RequirementDate: '2026-01-01', ScanPossible: true },
        { Reservation: '300', ReservationItem: '1', RequirementDate: '2026-05-01', ScanPossible: true },
        { Reservation: '200', ReservationItem: '2', RequirementDate: '2026-05-01', ScanPossible: true }
      ]
    });

    ctrl.onGo();
    await Promise.resolve();
    await Promise.resolve();

    // Initial DESC
    expect(model.getProperty('/sortDescending')).toBe(true);
    expect(model.getProperty('/items').map((i) => `${i.RequirementDate}|${i.Reservation}`)).toEqual([
      '2026-05-01|300',
      '2026-05-01|200',
      '2026-01-01|100'
    ]);

    // Toggle to ASC
    ctrl.onToggleSort();
    expect(model.getProperty('/sortDescending')).toBe(false);
    expect(model.getProperty('/items').map((i) => `${i.RequirementDate}|${i.Reservation}`)).toEqual([
      '2026-01-01|100',
      '2026-05-01|200',
      '2026-05-01|300'
    ]);

    // Toggle back to DESC
    ctrl.onToggleSort();
    expect(model.getProperty('/sortDescending')).toBe(true);
    expect(model.getProperty('/items').map((i) => `${i.RequirementDate}|${i.Reservation}`)).toEqual([
      '2026-05-01|300',
      '2026-05-01|200',
      '2026-01-01|100'
    ]);
  });

  it('onOpenCycle navigates to wmScan261 with reservation and item', () => {
    const oEvent = {
      getSource: () => ({
        getBindingContext: () => ({
          getObject: () => ({ Reservation: '523651', ReservationItem: '1' })
        })
      })
    };
    ctrl.onOpenCycle(oEvent);
    expect(navTarget).toEqual({
      route: 'wmScan261',
      args: { reservation: '523651', item: '1' }
    });
  });
});
