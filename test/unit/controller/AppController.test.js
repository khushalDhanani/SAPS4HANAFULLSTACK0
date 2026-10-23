const path = require('path');

let AppController;

beforeAll(() => {
  const BaseController = {
    extend: (_name, implementation) => {
      function Controller() {}
      Controller.prototype = implementation;
      return Controller;
    }
  };

  global.sap = {
    ui: {
      define: (_dependencies, factory) => {
        AppController = factory(BaseController, function JSONModel() {}, {});
      }
    }
  };

  require(path.join(__dirname, '../../../app/fiori-app/webapp/controller/App.controller.js'));
});

describe('App shell route titles', () => {
  test('purchase order detail keeps its title instead of falling through to sales inquiries', () => {
    const shellState = {};
    const controller = Object.create(AppController.prototype);
    controller._oShellModel = {
      setProperty: (key, value) => { shellState[key] = value; }
    };
    controller.getOwnerComponent = () => ({
      getModel: () => ({
        getResourceBundle: () => ({ getText: (key) => key })
      })
    });

    controller._updateShell('purchaseOrderDetail', { PurchaseOrder: '4500012345' });

    expect(shellState).toEqual({
      '/currentTitle': 'poDetailTitle 4500012345',
      '/showNavButton': true
    });
  });
});
