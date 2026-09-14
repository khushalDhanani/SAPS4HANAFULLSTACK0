const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');

describe('Unit: EWM Validation & Contract Enforcing (EwmAdapter)', () => {
  describe('confirmWarehouseTask validation', () => {
    it('should throw if Warehouse is missing', async () => {
      await expect(EwmAdapter.confirmWarehouseTask('', '10001', 5)).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
    });

    it('should throw if WarehouseTask is missing', async () => {
      await expect(EwmAdapter.confirmWarehouseTask('0001', '', 5)).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
    });

    it('should throw if ConfirmedQuantity is missing or non-positive', async () => {
      await expect(EwmAdapter.confirmWarehouseTask('0001', '10001', 0)).rejects.toThrow(
        /Valid positive ConfirmedQuantity is required/
      );
      await expect(EwmAdapter.confirmWarehouseTask('0001', '10001', -1)).rejects.toThrow(
        /Valid positive ConfirmedQuantity is required/
      );
      await expect(EwmAdapter.confirmWarehouseTask('0001', '10001', null)).rejects.toThrow(
        /Valid positive ConfirmedQuantity is required/
      );
    });
  });

  describe('createWarehouseTask validation', () => {
    it('should throw if taskData or Warehouse is missing', async () => {
      await expect(EwmAdapter.createWarehouseTask(null)).rejects.toThrow(
        /Warehouse is required/
      );
      await expect(EwmAdapter.createWarehouseTask({ Product: 'TG11' })).rejects.toThrow(
        /Warehouse is required/
      );
    });

    it('should throw if Product is missing', async () => {
      await expect(EwmAdapter.createWarehouseTask({ Warehouse: '0001' })).rejects.toThrow(
        /Product is required/
      );
    });

    it('should throw if Quantity is non-positive or missing', async () => {
      await expect(EwmAdapter.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 0 })).rejects.toThrow(
        /Valid positive Quantity is required/
      );
      await expect(EwmAdapter.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: -5 })).rejects.toThrow(
        /Valid positive Quantity is required/
      );
    });

    it('should throw if UnitOfMeasure or WarehouseProcessType is missing', async () => {
      await expect(EwmAdapter.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 5 })).rejects.toThrow(
        /UnitOfMeasure is required/
      );
      await expect(EwmAdapter.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 5, UnitOfMeasure: 'EA' })).rejects.toThrow(
        /WarehouseProcessType is required/
      );
    });
  });

  describe('cancelWarehouseTask validation', () => {
    it('should throw if Warehouse or WarehouseTask is missing', async () => {
      await expect(EwmAdapter.cancelWarehouseTask('', '10001')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
      await expect(EwmAdapter.cancelWarehouseTask('0001', '')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
    });
  });

  describe('postGoodsReceipt validation', () => {
    it('should throw if Warehouse or DeliveryDocument is missing', async () => {
      await expect(EwmAdapter.postGoodsReceipt('', '1800001')).rejects.toThrow(
        /Warehouse and DeliveryDocument are required/
      );
      await expect(EwmAdapter.postGoodsReceipt('0001', '')).rejects.toThrow(
        /Warehouse and DeliveryDocument are required/
      );
    });
  });

  describe('postGoodsIssue validation', () => {
    it('should throw if Warehouse or OutboundDeliveryOrder is missing', async () => {
      await expect(EwmAdapter.postGoodsIssue('', '800001')).rejects.toThrow(
        /Warehouse and OutboundDeliveryOrder are required/
      );
      await expect(EwmAdapter.postGoodsIssue('0001', '')).rejects.toThrow(
        /Warehouse and OutboundDeliveryOrder are required/
      );
    });
  });

  describe('confirmRfPickTask validation', () => {
    it('should throw if required parameters are missing', async () => {
      await expect(EwmAdapter.confirmRfPickTask('', '10001', 5, 'HU-01', 'BIN-01')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
      await expect(EwmAdapter.confirmRfPickTask('0001', '', 5, 'HU-01', 'BIN-01')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
      await expect(EwmAdapter.confirmRfPickTask('0001', '10001', 0, 'HU-01', 'BIN-01')).rejects.toThrow(
        /Valid positive ConfirmedQuantity is required/
      );
      await expect(EwmAdapter.confirmRfPickTask('0001', '10001', 5, '', 'BIN-01')).rejects.toThrow(
        /DestinationHU is required/
      );
      await expect(EwmAdapter.confirmRfPickTask('0001', '10001', 5, 'HU-01', '')).rejects.toThrow(
        /ScannedBin is required/
      );
    });
  });
});
