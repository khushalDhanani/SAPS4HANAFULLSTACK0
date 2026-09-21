/**
 * Isolated Test Fixtures for Goods Issue Unit Tests
 * Kept strictly inside test/ folder per AGENTS.md and project rules.
 * NEVER imported or used by runtime application adapters.
 */

const mockPackagingUnitsRM4520 = [
  { Unit: 'KG', Description: 'Kilogram', Numerator: 1, Denominator: 1, FactorToBase: 1.0, IsBaseUnit: true },
  { Unit: 'DRM', Description: 'Drum (50 KG)', Numerator: 50, Denominator: 1, FactorToBase: 50.0, IsBaseUnit: false },
  { Unit: 'CAN', Description: 'Canister (10 KG)', Numerator: 10, Denominator: 1, FactorToBase: 10.0, IsBaseUnit: false }
];

const mockPackagingUnitsRM4831 = [
  { Unit: 'KG', Description: 'Kilogram', Numerator: 1, Denominator: 1, FactorToBase: 1.0, IsBaseUnit: true },
  { Unit: 'BAG', Description: 'Bag (25 KG)', Numerator: 25, Denominator: 1, FactorToBase: 25.0, IsBaseUnit: false },
  { Unit: 'SCK', Description: 'Sack (10 KG)', Numerator: 10, Denominator: 1, FactorToBase: 10.0, IsBaseUnit: false }
];

const mockPackagingUnitsRM5100 = [
  { Unit: 'KG', Description: 'Kilogram', Numerator: 1, Denominator: 1, FactorToBase: 1.0, IsBaseUnit: true },
  { Unit: 'PAC', Description: 'Pack (5 KG)', Numerator: 5, Denominator: 1, FactorToBase: 5.0, IsBaseUnit: false },
  { Unit: 'BAG', Description: 'Bag (20 KG)', Numerator: 20, Denominator: 1, FactorToBase: 20.0, IsBaseUnit: false }
];

const mockPackagingUnitsAlum = [
  { Unit: 'PC', Description: 'Piece', Numerator: 1, Denominator: 1, FactorToBase: 1.0, IsBaseUnit: true },
  { Unit: 'ROL', Description: 'Roll (5 PC)', Numerator: 5, Denominator: 1, FactorToBase: 5.0, IsBaseUnit: false },
  { Unit: 'CRT', Description: 'Crate (20 PC)', Numerator: 20, Denominator: 1, FactorToBase: 20.0, IsBaseUnit: false }
];

function createMockReservationItems() {
  return [
    {
      ReservationNo: '0000012345',
      ReservationItem: '0001',
      OrderNo: '000004000123',
      Material: 'RM-4520',
      MaterialDesc: 'High-Grade Industrial Solvent',
      Plant: '1010',
      StorageLocation: '101A',
      Batch: 'B240915',
      ExpiryDate: '2026-12-31',
      BatchStatusState: 'Success',
      BatchStatusText: 'VALID',
      Unit: 'KG',
      RequiredQty: 100.0,
      WithdrawnQty: 0.0,
      OpenQty: 100.0,
      MovementType: '261',
      MovementTypeName: 'GI for order',
      PackagingUnits: [...mockPackagingUnitsRM4520]
    },
    {
      ReservationNo: '0000012345',
      ReservationItem: '0002',
      OrderNo: '000004000123',
      Material: 'RM-4831',
      MaterialDesc: 'Polymer Additive Granules',
      Plant: '1010',
      StorageLocation: '101A',
      Batch: 'B240820',
      ExpiryDate: '2027-06-30',
      BatchStatusState: 'Success',
      BatchStatusText: 'VALID',
      Unit: 'KG',
      RequiredQty: 60.0,
      WithdrawnQty: 0.0,
      OpenQty: 60.0,
      MovementType: '261',
      MovementTypeName: 'GI for order',
      PackagingUnits: [...mockPackagingUnitsRM4831]
    },
    {
      ReservationNo: '0000012345',
      ReservationItem: '0003',
      OrderNo: '000004000123',
      Material: 'RM-5100',
      MaterialDesc: 'Thermal Stabilizer Compound',
      Plant: '1010',
      StorageLocation: '101A',
      Batch: '',
      ExpiryDate: null,
      BatchStatusState: 'None',
      BatchStatusText: 'NO BATCH',
      Unit: 'KG',
      RequiredQty: 40.0,
      WithdrawnQty: 15.0,
      OpenQty: 25.0,
      MovementType: '261',
      MovementTypeName: 'GI for order',
      PackagingUnits: [...mockPackagingUnitsRM5100]
    },
    {
      ReservationNo: '0000098765',
      ReservationItem: '0001',
      OrderNo: '000004000888',
      Material: 'RAW-ALUM-01',
      MaterialDesc: 'Aluminum Coil Sheet 2mm',
      Plant: '1010',
      StorageLocation: '101A',
      Batch: 'AL-9901',
      ExpiryDate: '2028-12-31',
      BatchStatusState: 'Success',
      BatchStatusText: 'VALID',
      Unit: 'PC',
      RequiredQty: 50.0,
      WithdrawnQty: 10.0,
      OpenQty: 40.0,
      MovementType: '261',
      MovementTypeName: 'GI for order',
      PackagingUnits: [...mockPackagingUnitsAlum]
    }
  ];
}

const mockBatchesRM4520 = [
  {
    Material: 'RM-4520',
    Plant: '1010',
    Batch: 'B240101',
    ExpiryDate: '2026-01-15',
    ManufactDate: '2024-01-15',
    AvailableStock: 30.0,
    Unit: 'KG',
    StorageLocation: '101A',
    StatusState: 'Error',
    StatusText: 'EXPIRED',
    DaysToExpiry: -236
  },
  {
    Material: 'RM-4520',
    Plant: '1010',
    Batch: 'B240801',
    ExpiryDate: '2026-09-20',
    ManufactDate: '2024-08-01',
    AvailableStock: 50.0,
    Unit: 'KG',
    StorageLocation: '101A',
    StatusState: 'Warning',
    StatusText: 'EXPIRING SOON',
    DaysToExpiry: 12
  },
  {
    Material: 'RM-4520',
    Plant: '1010',
    Batch: 'B240915',
    ExpiryDate: '2026-12-31',
    ManufactDate: '2024-09-15',
    AvailableStock: 120.0,
    Unit: 'KG',
    StorageLocation: '101A',
    StatusState: 'Success',
    StatusText: 'VALID',
    DaysToExpiry: 114
  }
];

module.exports = {
  createMockReservationItems,
  mockBatchesRM4520,
  mockPackagingUnitsRM4520,
  mockPackagingUnitsRM4831,
  mockPackagingUnitsRM5100,
  mockPackagingUnitsAlum
};
