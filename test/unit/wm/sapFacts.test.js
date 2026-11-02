'use strict';

const { parseSapNumber } = require('../../../srv/integration/s4hana/sapFacts');

describe('sapFacts - parseSapNumber', () => {
  test('parses positive integers and decimal strings', () => {
    expect(parseSapNumber('100')).toBe(100);
    expect(parseSapNumber('100.000')).toBe(100);
    expect(parseSapNumber('12.345')).toBe(12.345);
    expect(parseSapNumber('0')).toBe(0);
    expect(parseSapNumber('0.000')).toBe(0);
  });

  test('parses SAP RFC trailing-minus negative strings', () => {
    expect(parseSapNumber('5.000-')).toBe(-5);
    expect(parseSapNumber('123.45-')).toBe(-123.45);
    expect(parseSapNumber('1-')).toBe(-1);
    expect(parseSapNumber('0.5-')).toBe(-0.5);
  });

  test('parses standard negative prefix strings and numbers', () => {
    expect(parseSapNumber('-5')).toBe(-5);
    expect(parseSapNumber('-123.45')).toBe(-123.45);
    expect(parseSapNumber(42)).toBe(42);
    expect(parseSapNumber(-99.5)).toBe(-99.5);
    expect(parseSapNumber(0)).toBe(0);
  });

  test('trims surrounding whitespace properly', () => {
    expect(parseSapNumber('  100.500  ')).toBe(100.5);
    expect(parseSapNumber('  25.000-  ')).toBe(-25);
    expect(parseSapNumber('\t50\n')).toBe(50);
  });

  test('returns NaN for blank, null, and undefined values', () => {
    expect(parseSapNumber('')).toBeNaN();
    expect(parseSapNumber('   ')).toBeNaN();
    expect(parseSapNumber(null)).toBeNaN();
    expect(parseSapNumber(undefined)).toBeNaN();
  });

  test('returns NaN for non-numeric or invalid formats without guessing', () => {
    expect(parseSapNumber('abc')).toBeNaN();
    expect(parseSapNumber('10,000')).toBeNaN();
    expect(parseSapNumber('100.00.00')).toBeNaN();
    expect(parseSapNumber('--')).toBeNaN();
    expect(parseSapNumber('-')).toBeNaN();
  });
});

