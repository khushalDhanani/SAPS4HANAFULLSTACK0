'use strict';

/**
 * The field-format checks goods receipt applies before posting (goodsReceipt.handler.js).
 * Each returns null when the value is acceptable, or the field and message the caller sees in a 400.
 */

const { checkMaterial, checkPlant, checkStorageLocation, checkBatch } = require('../../../srv/wm/goods-issue/validation/common');

describe('checkMaterial', () => {
  test('requires a value when required, and ignores a blank one when not', () => {
    expect(checkMaterial('   ', true)).toEqual({ field: 'Material', message: 'Material number is required' });
    expect(checkMaterial('', false)).toBeNull();
  });

  test('accepts 40 characters and refuses 41', () => {
    expect(checkMaterial('M'.repeat(40), true)).toBeNull();
    expect(checkMaterial('M'.repeat(41), true)).toEqual({ field: 'Material', message: 'Material number exceeds maximum length of 40 characters' });
  });
});

describe('checkPlant', () => {
  test('requires a value when required, and ignores a blank one when not', () => {
    expect(checkPlant('', true)).toEqual({ field: 'Plant', message: 'Plant is required' });
    expect(checkPlant('', false)).toBeNull();
  });

  test.each(['112', '11200', '11-0'])('refuses %s, which is not 4 alphanumeric characters', (plant) => {
    expect(checkPlant(plant, true)).toEqual({ field: 'Plant', message: `Plant '${plant}' must be exactly 4 alphanumeric characters` });
  });

  test('accepts 4 alphanumeric characters', () => {
    expect(checkPlant('11A0', true)).toBeNull();
  });
});

describe('checkStorageLocation', () => {
  test('requires a value when required, and ignores a blank one when not', () => {
    expect(checkStorageLocation('', true)).toEqual({ field: 'StorageLocation', message: 'Storage Location is required' });
    expect(checkStorageLocation('', false)).toBeNull();
  });

  test.each(['HS0', 'HS011', 'H S1'])('refuses %s, which is not 4 alphanumeric characters', (sloc) => {
    expect(checkStorageLocation(sloc, true)).toEqual({ field: 'StorageLocation', message: `Storage Location '${sloc}' must be exactly 4 alphanumeric characters` });
  });

  test('accepts 4 alphanumeric characters', () => {
    expect(checkStorageLocation('HS01', true)).toBeNull();
  });
});

describe('checkBatch', () => {
  test.each([undefined, null, '', '   '])('treats %p as no batch', (batch) => {
    expect(checkBatch(batch)).toBeNull();
  });

  test('accepts 10 characters and refuses 11', () => {
    expect(checkBatch('B'.repeat(10))).toBeNull();
    expect(checkBatch('B'.repeat(11))).toEqual({ field: 'Batch', message: `Batch '${'B'.repeat(11)}' exceeds maximum length of 10 characters` });
  });
});
