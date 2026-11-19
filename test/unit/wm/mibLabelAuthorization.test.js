'use strict';

const {
  warehouseScope,
  isWarehouseAllowed,
  assertWarehouseAllowed,
  DEFAULT_PLANT_TO_WAREHOUSE
} = require('../../../srv/wm/mib-label/warehouseScope');

describe('SEC-01: MIB Label Authorization & Warehouse Scope', () => {
  describe('warehouseScope()', () => {
    it('returns null (unrestricted) for Admin user regardless of attributes', () => {
      const admin = {
        is: (role) => role === 'Admin',
        attr: { WarehouseNumber: ['W01'], Plant: ['1120'] }
      };
      expect(warehouseScope(admin)).toBeNull();
    });

    it('returns empty array when user or attributes are missing (fail closed)', () => {
      expect(warehouseScope(null)).toEqual([]);
      expect(warehouseScope(undefined)).toEqual([]);
      expect(warehouseScope({})).toEqual([]);
      expect(warehouseScope({ is: () => false })).toEqual([]);
      expect(warehouseScope({ is: () => false, attr: {} })).toEqual([]);
    });

    it('evaluates explicit WarehouseNumber user attribute', () => {
      const user = {
        is: () => false,
        attr: { WarehouseNumber: [' w01 ', 'W02'] }
      };
      expect(warehouseScope(user)).toEqual(['W01', 'W02']);
    });

    it('evaluates explicit single-string Warehouse attribute', () => {
      const user = {
        is: () => false,
        attr: { Warehouse: 'W03' }
      };
      expect(warehouseScope(user)).toEqual(['W03']);
    });

    it('evaluates explicit LGNUM attribute', () => {
      const user = {
        is: () => false,
        attr: { LGNUM: ['101', '102'] }
      };
      expect(warehouseScope(user)).toEqual(['101', '102']);
    });

    it('filters out invalid warehouse codes (not 1-3 alphanumeric)', () => {
      const user = {
        is: () => false,
        attr: { WarehouseNumber: ['W01', 'TOOLONG', '', '   ', 'W-1', '1234'] }
      };
      expect(warehouseScope(user)).toEqual(['W01']);
    });

    it('does NOT treat Plant attribute as warehouse number (maps via authoritative table)', () => {
      // Plant '1120' is a 4-char WERKS code; it must never be treated as a warehouse code directly.
      // Instead, it maps via DEFAULT_PLANT_TO_WAREHOUSE: '1120' -> ['W01'].
      expect(DEFAULT_PLANT_TO_WAREHOUSE['1120']).toEqual(['W01']);
      expect(DEFAULT_PLANT_TO_WAREHOUSE['1000']).toEqual(['W01']);
      const user = {
        is: () => false,
        attr: { Plant: ['1120'] }
      };
      const scope = warehouseScope(user);
      expect(scope).toEqual(['W01']);
      expect(scope).not.toContain('1120');
    });

    it('maps multiple plants via authoritative configuration mapping', () => {
      const customMap = {
        '1000': ['W01'],
        '2000': ['W02', 'W03'],
        '3000': []
      };
      const user = {
        is: () => false,
        attr: { Plant: ['1000', '2000', '3000'] }
      };
      const scope = warehouseScope(user, customMap);
      expect(scope).toEqual(['W01', 'W02', 'W03']);
    });

    it('returns empty array when user plant does not exist in authoritative mapping', () => {
      const user = {
        is: () => false,
        attr: { Plant: ['9999'] }
      };
      expect(warehouseScope(user)).toEqual([]);
    });

    it('prefers explicit warehouse attributes over plant mapping when present', () => {
      const user = {
        is: () => false,
        attr: {
          WarehouseNumber: ['W02'],
          Plant: ['1120'] // maps to W01, but explicit W02 takes precedence
        }
      };
      expect(warehouseScope(user)).toEqual(['W02']);
    });
  });

  describe('isWarehouseAllowed()', () => {
    it('returns true for unrestricted scope (null)', () => {
      expect(isWarehouseAllowed('W01', null)).toBe(true);
      expect(isWarehouseAllowed('ANY', null)).toBe(true);
    });

    it('returns false for non-array scope', () => {
      expect(isWarehouseAllowed('W01', undefined)).toBe(false);
      expect(isWarehouseAllowed('W01', 'W01')).toBe(false);
      expect(isWarehouseAllowed('W01', {})).toBe(false);
    });

    it('checks case-insensitively and trims whitespace', () => {
      expect(isWarehouseAllowed(' w01 ', ['W01', 'W02'])).toBe(true);
      expect(isWarehouseAllowed('W02', ['W01', 'W02'])).toBe(true);
      expect(isWarehouseAllowed('W03', ['W01', 'W02'])).toBe(false);
    });

    it('returns false for blank or empty warehouse', () => {
      expect(isWarehouseAllowed('', ['W01'])).toBe(false);
      expect(isWarehouseAllowed('   ', ['W01'])).toBe(false);
      expect(isWarehouseAllowed(null, ['W01'])).toBe(false);
    });
  });

  describe('assertWarehouseAllowed()', () => {
    it('does not throw for allowed warehouse in scope', () => {
      expect(() => assertWarehouseAllowed('W01', ['W01', 'W02'])).not.toThrow();
      expect(() => assertWarehouseAllowed('W99', null)).not.toThrow();
    });

    it('throws 403 Forbidden with descriptive message for unauthorized warehouse', () => {
      try {
        assertWarehouseAllowed('W03', ['W01']);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.status).toBe(403);
        expect(err.statusCode).toBe(403);
        expect(err.$sanitize).toBe(false);
        expect(err.message).toBe("Warehouse W03 is outside the user's authorized warehouse scope.");
      }
    });

    it('handles empty warehouse input in error message gracefully', () => {
      try {
        assertWarehouseAllowed('', ['W01']);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.status).toBe(403);
        expect(err.message).toBe("Warehouse (none) is outside the user's authorized warehouse scope.");
      }
    });
  });
});
