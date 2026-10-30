'use strict';

/**
 * Synthetic WM seed for the reservation tests (tracked, so CI has it). Keys and document numbers are the ones the
 * tests assert; names and users are test values, not SAP data.
 */

const track = [
  {
    ReservationNo: '0000524979', ReservationItem: '0001', MovementType: '311', WarehouseNumber: 'W01',
    Plant: '1120', StorageLocation: 'HS01', Material: '000000008000000023', MaterialName: 'Test Material A',
    Quantity: 1, Unit: 'NOS', ReceivingPlant: '1120', ReceivingStorageLocation: 'CS01',
    Status_code: '01', createdBy: 'alice'
  },
  {
    ReservationNo: '0000524301', ReservationItem: '0001', MovementType: '261', WarehouseNumber: 'W01',
    Plant: '1130', StorageLocation: 'CS01', Material: '000000008000000023', MaterialName: 'Test Material A',
    Quantity: 25, Unit: 'KG', TransferRequirement: '0001001839', TransferOrder: '0001012966',
    MaterialDocument: '4900050128', MaterialDocYear: '2026', Status_code: '05', createdBy: 'alice'
  }
];

const log = [
  ['0000524979', 'MB21', '01'],
  ['0000524301', 'MB21', '01'],
  ['0000524301', 'LB01', '02'],
  ['0000524301', 'LT04', '03'],
  ['0000524301', 'LT12', '04'],
  ['0000524301', 'MIGO', '05']
].map(([ReservationNo, Step, Status], i) => ({
  ID: `a0000001-0000-0000-0000-00000000000${i + 1}`,
  ReservationNo, ReservationItem: '0001', Step, Status, MessageType: 'S', createdBy: 'alice'
}));

module.exports = { track, log };
