/**
 * Tests for Open261 controller sorting and navigation logic.
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

  it('initializes with sortDescending: true and empty items', () => {
    expect(model.getProperty('/sortDescending')).toBe(true);
    expect(model.getProperty('/items')).toEqual([]);
    expect(model.getProperty('/scanPossibleOnly')).toBe(true);
  });

  it('onGo retrieves items and sorts them in DESC order (RequirementDate, Reservation, ReservationItem)', async () => {
    ODataClient.get.mockResolvedValueOnce({
      TotalCount: 3,
      SapOpenCount: 3,
      Truncated: false,
      Items: [
        { Reservation: '100', ReservationItem: '1', RequirementDate: '2026-01-01' },
        { Reservation: '300', ReservationItem: '1', RequirementDate: '2026-05-01' },
        { Reservation: '200', ReservationItem: '2', RequirementDate: '2026-05-01' }
      ]
    });

    ctrl.onGo();
    await Promise.resolve();
    await Promise.resolve();

    const items = model.getProperty('/items');
    expect(items.map((i) => `${i.RequirementDate}|${i.Reservation}|${i.ReservationItem}`)).toEqual([
      '2026-05-01|300|1',
      '2026-05-01|200|2',
      '2026-01-01|100|1'
    ]);
  });

  it('onToggleSort flips between DESC and ASC order', () => {
    model.setProperty('/items', [
      { Reservation: '100', ReservationItem: '1', RequirementDate: '2026-01-01' },
      { Reservation: '300', ReservationItem: '1', RequirementDate: '2026-05-01' },
      { Reservation: '200', ReservationItem: '2', RequirementDate: '2026-05-01' }
    ]);
    model.setProperty('/sortDescending', true);

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
