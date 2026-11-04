'use strict';

const {
  MOVEMENT_CONFIG,
  GM_CODE,
  getGmCode,
  validateMovement261Payload,
  calculateMovement261StockEligibility
} = require('../../../srv/common/movementConfig');

describe('Single Normalized Movement Configuration (Step 2) [mock only, not SAP verification]', () => {
  describe('1. Movement Configuration Definitions', () => {

    test('261: GI to Order configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['261'];
      expect(cfg.inventoryMovement).toBe('261');
      expect(cfg.configuredWmMovement).toBe('261');
      expect(cfg.wmMovement).toBe('261');
      expect(cfg.requiresCostCenter).toBe(false);
      expect(cfg.requiresAsset).toBe(false);
      expect(cfg.requiresReceivingPlant).toBe(false);
      expect(cfg.requiresReceivingSloc).toBe(false);
      expect(cfg.requiresOrder).toBe(true);
      expect(cfg.requirementType).toBe('F');
      expect(cfg.interimStorageType).toBe('914');
      expect(cfg.preserveReservationOnTr).toBe(true);
      expect(cfg.gmCode).toBe('03');
    });

  });

  describe('5. Canonical Movement 261 Stock-Eligibility Calculation', () => {
    test('unifies open, issuable, supply area, staged, storage unit, and no-unit stock into authoritative result', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        supplyAreaStock: 0,
        stagedQuantity: 10,
        storageUnitQuantity: 10,
        noUnitQuantity: 0,
        unit: 'KG',
        source: 'SAP'
      });

      expect(result).toMatchObject({
        eligible: true,
        Eligible: true,
        issuableQuantity: 10,
        IssuableQuantity: 10,
        reason: null,
        Reason: null,
        source: 'SAP',
        Source: 'SAP',
        openQuantity: 10,
        OpenQuantity: 10,
        supplyAreaStock: 0,
        SupplyAreaStock: 0,
        stagedQuantity: 10,
        StagedQuantity: 10,
        storageUnitQuantity: 10,
        StorageUnitQuantity: 10,
        noUnitQuantity: 0,
        NoUnitQuantity: 0,
        partialCoverage: false,
        PartialCoverage: false
      });
    });

    test('correctly calculates partial coverage when issuable stock is less than open quantity', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 20,
        issuableQuantity: 8,
        supplyAreaStock: 0,
        stagedQuantity: 8,
        storageUnitQuantity: 5,
        noUnitQuantity: 3,
        unit: 'KG'
      });

      expect(result.eligible).toBe(true);
      expect(result.issuableQuantity).toBe(8);
      expect(result.partialCoverage).toBe(true);
      expect(result.storageUnitQuantity).toBe(5);
      expect(result.noUnitQuantity).toBe(3);
      expect(result.reason).toBeNull();
    });

    test('marks zero open quantity as ineligible with explicit reason', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 0,
        issuableQuantity: 10,
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.Eligible).toBe(false);
      expect(result.reason).toBe('No open quantity remaining');
      expect(result.issuableQuantity).toBe(0);
    });

    test('rejects when upstream/external blockers are present', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        blockers: ['Order status locked (REL DLV)', 'Item flagged for deletion']
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Order status locked');
      expect(result.reason).toContain('Item flagged for deletion');
    });

    test('rejects when requested quantity exceeds open quantity', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 20,
        requestQuantity: 15,
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Quantity 15 exceeds the open quantity 10 KG');
    });

    test('rejects when requested quantity is non-positive', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        requestQuantity: 0
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Quantity must be greater than zero');
    });

    test('detects staging shortfall when staging is required and staged stock is insufficient', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        stagedQuantity: 4,
        stagingRequired: true,
        stagingStorageType: '100',
        stagingBin: 'STAGE-01',
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.stagingShortfall).toBe(6);
      expect(result.reason).toContain('shortfall of 6 KG in interim storage bin 100/STAGE-01');
      expect(result.issuableQuantity).toBe(4);
    });

    test('identifies when issue location has no stock but supply area has stock, advising transfer', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 0,
        supplyAreaStock: 12,
        unit: 'KG',
        storageLocation: '101A',
        supplyAreaStorageLocation: '101B'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('12 KG in supply area 101B; issue location 101A is empty - transfer required');
    });

    test('identifies when no unrestricted stock exists at all', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 0,
        supplyAreaStock: 0,
        unit: 'KG',
        storageLocation: '101A',
        batch: 'BATCH01'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('no unrestricted stock in 101A for batch BATCH01');
    });

    test('accepts PascalCase inputs and produces dual-cased results', () => {
      const result = calculateMovement261StockEligibility({
        OpenQuantity: 15,
        IssuableQuantity: 15,
        SupplyAreaStock: 0,
        StagedQuantity: 15,
        StorageUnitQuantity: 10,
        NoUnitQuantity: 5,
        Unit: 'L',
        Source: 'SAP'
      });

      expect(result.Eligible).toBe(true);
      expect(result.eligible).toBe(true);
      expect(result.IssuableQuantity).toBe(15);
      expect(result.issuableQuantity).toBe(15);
      expect(result.StorageUnitQuantity).toBe(10);
      expect(result.NoUnitQuantity).toBe(5);
      expect(result.Source).toBe('SAP');
    });
  });

  describe('6. Central GM_CODE and Policy Rules (Item 17)', () => {
    test('GM_CODE holds the goods movement code of the only movement left', () => {
      expect(GM_CODE).toEqual({ '261': '03' });
    });

    test('getGmCode helper returns correct GM_CODE or null', () => {
      expect(getGmCode('261')).toBe('03');
      expect(getGmCode(' 261 ')).toBe('03');
      expect(getGmCode('201')).toBeNull();
      expect(getGmCode('999')).toBeNull();
      expect(getGmCode('')).toBeNull();
      expect(getGmCode(null)).toBeNull();
    });

    test.each(['261'])('%s config limits batch numbers to 10 and serial numbers to 18 characters', (mvt) => {
      expect(MOVEMENT_CONFIG[mvt].batchRules.maxLength).toBe(10);
      expect(MOVEMENT_CONFIG[mvt].serialRules.maxLength).toBe(18);
    });

    test('261 config has correct reservation rules and order account assignment', () => {
      const cfg = MOVEMENT_CONFIG['261'];
      expect(cfg.reservationRules.requiredForPosting).toBe(true);
      expect(cfg.reservationRules.preserveReservationOnTr).toBe(true);
      expect(cfg.accountAssignment.type).toBe('Order');
      expect(cfg.accountAssignment.mandatory).toBe(true);
      expect(cfg.forbiddenFields).toContain('CostCenter');
      expect(cfg.forbiddenFields).toContain('AssetNo');
      expect(cfg.forbiddenFields).toContain('ReceivingPlant');
    });
  });

  describe('8. Canonical Movement 261 Payload Validation (Item 18)', () => {
    const valid261 = { movementType: '261', orderId: '1002707', orderType: 'ZP01' };
    test('accepts valid 261 payload with reservation, item, quantity', () => {
      const res = validateMovement261Payload({ ...valid261, reservation: '512851', item: '3', quantity: 200 });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('accepts PascalCase 261 payload (ReservationNo, ReservationItem, IssueQty)', () => {
      const res = validateMovement261Payload({ ...valid261, ReservationNo: '512851', ReservationItem: '0003', IssueQty: 200 });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('rejects missing reservation or item', () => {
      const resNoRes = validateMovement261Payload({ ...valid261, reservation: '', item: '1', quantity: 10 });
      expect(resNoRes.isValid).toBe(false);
      expect(resNoRes.errors[0].message).toBe('Reservation and item are required');

      const resNoItem = validateMovement261Payload({ ...valid261, reservation: '512851', item: '', quantity: 10 });
      expect(resNoItem.isValid).toBe(false);
      expect(resNoItem.errors[0].message).toBe('Reservation and item are required');
    });

    test('rejects zero, negative, or invalid quantity', () => {
      const resZero = validateMovement261Payload({ ...valid261, reservation: '512851', item: '1', quantity: 0 });
      expect(resZero.isValid).toBe(false);
      expect(resZero.errors[0].message).toBe('Quantity must be greater than zero');

      const resNeg = validateMovement261Payload({ ...valid261, reservation: '512851', item: '1', quantity: -5 });
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.errors[0].message).toBe('Quantity must be greater than zero');

      const resNan = validateMovement261Payload({ ...valid261, reservation: '512851', item: '1', quantity: 'abc' });
      expect(resNan.isValid).toBe(false);
      expect(resNan.errors[0].message).toBe('Quantity must be greater than zero');
    });

    test('rejects non-object or null input', () => {
      const resNull = validateMovement261Payload(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.message).toBe('Request body must be a valid JSON object');
    });

    test('rejects missing or non-261 movement type and invalid Order number before posting', () => {
      expect(validateMovement261Payload({ orderId: '1002707', reservation: '512851', item: '1', quantity: 10 }).errors[0].field).toBe('movementType');
      expect(validateMovement261Payload({ ...valid261, movementType: '201', reservation: '512851', item: '1', quantity: 10 }).errors[0].field).toBe('movementType');
      expect(validateMovement261Payload({ ...valid261, orderId: '12X', reservation: '512851', item: '1', quantity: 10 }).errors[0].field).toBe('orderId');
    });

    test('requires one explicit OrderType for 261 and rejects conflicting aliases', () => {
      expect(validateMovement261Payload({ ...valid261, orderType: '', reservation: '512851', item: '1', quantity: 10 }).errors[0].field).toBe('orderType');
      expect(validateMovement261Payload({ ...valid261, OrderType: 'ZEMP', reservation: '512851', item: '1', quantity: 10 }).errors[0].field).toBe('orderType');
    });

    test('rejects forbidden fields for 261 (CostCenter, AssetNo, ReceivingPlant, GLAccount)', () => {
      const res = validateMovement261Payload({
        ...valid261,
        reservation: '512851',
        item: '1',
        quantity: 10,
        CostCenter: '1011202902',
        ReceivingPlant: '1110',
        GLAccount: '400000'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'CostCenter')).toBe(true);
      expect(res.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
      expect(res.errors.some(e => e.field === 'GLAccount')).toBe(true);
    });
  });

});
