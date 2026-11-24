'use strict';

const {
  DEFAULT_SAP_ROLE_PREFIX,
  getSapRolePrefix,
  matchKnownRole,
  loadRoleMap,
  mapRoles,
  parseAdminUsers,
  fetchAndMapRoles,
} = require('../../../srv/auth/sapRoleMapper');

describe('Unit: sapRoleMapper (Prefix-based SAP PFCG role mapping + optional role-map.json)', () => {
  const sampleMap = {
    Z_SPECIAL_MGR: ['SalesManager'],
    Z_SPECIAL_ADMIN: ['Admin', 'Viewer']
  };

  const makeFs = (content) => ({
    readFileSync: (_p) => {
      if (content === null) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    }
  });

  describe('getSapRolePrefix', () => {
    it('returns default prefix ZAPP_ when unset', () => {
      expect(getSapRolePrefix({})).toBe(DEFAULT_SAP_ROLE_PREFIX);
      expect(getSapRolePrefix({})).toBe('ZAPP_');
    });

    it('returns custom prefix when APP_SAP_ROLE_PREFIX is set', () => {
      expect(getSapRolePrefix({ APP_SAP_ROLE_PREFIX: 'SAP_APP_' })).toBe('SAP_APP_');
      expect(getSapRolePrefix({ APP_SAP_ROLE_PREFIX: '' })).toBe('');
    });
  });

  describe('matchKnownRole', () => {
    it('matches exact and case-insensitive role names', () => {
      expect(matchKnownRole('Viewer')).toBe('Viewer');
      expect(matchKnownRole('VIEWER')).toBe('Viewer');
      expect(matchKnownRole('viewer')).toBe('Viewer');
      expect(matchKnownRole('SalesManager')).toBe('SalesManager');
      expect(matchKnownRole('SALESMANAGER')).toBe('SalesManager');
      expect(matchKnownRole('salesmanager')).toBe('SalesManager');
    });

    it('matches underscore-separated role names case-insensitively', () => {
      expect(matchKnownRole('SALES_MANAGER')).toBe('SalesManager');
      expect(matchKnownRole('warehouse_clerk')).toBe('WarehouseClerk');
      expect(matchKnownRole('PURCHASING_MANAGER')).toBe('PurchasingManager');
      expect(matchKnownRole('sap_logs_reader')).toBe('SapLogsReader');
    });

    it('returns null for unknown role suffixes', () => {
      expect(matchKnownRole('SUPERUSER')).toBeNull();
      expect(matchKnownRole('UNKNOWN')).toBeNull();
      expect(matchKnownRole('')).toBeNull();
    });
  });

  describe('loadRoleMap', () => {
    it('returns null when file does not exist (ENOENT)', () => {
      const fsImpl = makeFs(null);
      expect(loadRoleMap('/fake/absent.json', fsImpl)).toBeNull();
    });

    it('returns null when file is empty or {}', () => {
      expect(loadRoleMap('/fake/empty.json', makeFs('   '))).toBeNull();
      expect(loadRoleMap('/fake/empty.json', makeFs('{}'))).toBeNull();
    });

    it('the shipped config/role-map.json is empty: no SAP role name is mapped until a site enters its own', () => {
      const shipped = require('fs').readFileSync(require('path').resolve(__dirname, '../../../config/role-map.json'), 'utf8');
      expect(JSON.parse(shipped)).toEqual({});
      expect(loadRoleMap()).toBeNull();
      for (const name of ['Z_APP_SALES_MGR', 'Z_APP_WH_CLERK', 'Z_APP_PURCHASING']) {
        expect(mapRoles('JSMITH', [name], loadRoleMap(), {})).toBeNull();
      }
      // the prefix convention needs no file
      expect(mapRoles('JSMITH', ['ZAPP_SALESMANAGER'], loadRoleMap(), {})).toEqual(['SalesManager']);
    });

    it('parses valid role-map JSON when file exists', () => {
      const fsImpl = makeFs(JSON.stringify(sampleMap));
      expect(loadRoleMap('/fake/role-map.json', fsImpl)).toEqual(sampleMap);
    });

    it('throws when role-map contains invalid JSON', () => {
      const fsImpl = makeFs('{bad-json');
      expect(() => loadRoleMap('/fake/role-map.json', fsImpl)).toThrow(/invalid JSON/);
    });

    it('throws when mapping contains unknown app roles', () => {
      const fsImpl = makeFs('{"Z_ROLE": ["SuperDuperUser"]}');
      expect(() => loadRoleMap('/fake/role-map.json', fsImpl)).toThrow(/unknown app role/);
    });
  });

  describe('parseAdminUsers', () => {
    it('returns empty set when APP_ADMIN_USERS is unset or empty', () => {
      expect(parseAdminUsers({})).toEqual(new Set());
      expect(parseAdminUsers({ APP_ADMIN_USERS: '  ' })).toEqual(new Set());
    });

    it('parses comma-separated list of usernames in lower-case', () => {
      const result = parseAdminUsers({ APP_ADMIN_USERS: 'MADMIN, Khushal, Alice ' });
      expect(result.has('madmin')).toBe(true);
      expect(result.has('khushal')).toBe(true);
      expect(result.has('alice')).toBe(true);
      expect(result.has('bob')).toBe(false);
    });
  });

  describe('mapRoles — prefix matching and role union', () => {
    it('grants app role for default prefix match ZAPP_<ROLE>', () => {
      const roles = mapRoles('jsmith', ['ZAPP_SalesManager'], null, {});
      expect(roles).toEqual(['SalesManager']);
    });

    it('grants union of multiple matched SAP roles', () => {
      const roles = mapRoles('jsmith', ['ZAPP_SalesManager', 'ZAPP_WarehouseClerk'], null, {});
      expect(roles).toEqual(expect.arrayContaining(['SalesManager', 'WarehouseClerk']));
      expect(roles).toHaveLength(2);
    });

    it('handles case-insensitivity and underscore variants in prefix and suffix', () => {
      expect(mapRoles('user1', ['zapp_viewer'], null, {})).toEqual(['Viewer']);
      expect(mapRoles('user1', ['ZAPP_SALESMANAGER'], null, {})).toEqual(['SalesManager']);
      expect(mapRoles('user1', ['ZAPP_SALES_MANAGER'], null, {})).toEqual(['SalesManager']);
      expect(mapRoles('user1', ['ZAPP_WAREHOUSE_CLERK'], null, {})).toEqual(['WarehouseClerk']);
    });

    it('supports custom prefix via APP_SAP_ROLE_PREFIX', () => {
      const env = { APP_SAP_ROLE_PREFIX: 'CUSTOM_' };
      const roles = mapRoles('user1', ['CUSTOM_SalesManager', 'ZAPP_Viewer'], null, env);
      expect(roles).toEqual(['SalesManager']);
    });

    it('ignores SAP roles with unknown suffix and returns null when no roles match', () => {
      expect(mapRoles('user1', ['ZAPP_UNKNOWN_ROLE'], null, {})).toBeNull();
      expect(mapRoles('user1', ['SAP_ALL', 'S_A.DEVELOP'], null, {})).toBeNull();
    });

    it('keeps valid matched roles when an unknown role suffix is also present', () => {
      const roles = mapRoles('user1', ['ZAPP_Viewer', 'ZAPP_UNKNOWN_ROLE', 'SAP_ALL'], null, {});
      expect(roles).toEqual(['Viewer']);
    });

    it('uses role-map.json as an optional override when provided', () => {
      const overrideMap = {
        Z_SPECIAL_MGR: ['SalesManager'],
        ZAPP_VIEWER: ['WarehouseClerk'] // overrides standard prefix mapping
      };
      const roles = mapRoles('user1', ['Z_SPECIAL_MGR', 'ZAPP_VIEWER'], overrideMap, {});
      expect(roles).toEqual(expect.arrayContaining(['SalesManager', 'WarehouseClerk']));
    });
  });

  describe('mapRoles — Admin guard', () => {
    it('never grants Admin through prefix match unless user is in APP_ADMIN_USERS', () => {
      const roles = mapRoles('regularuser', ['ZAPP_Admin', 'ZAPP_Viewer'], null, {});
      expect(roles).not.toContain('Admin');
      expect(roles).toEqual(['Viewer']);
    });

    it('returns null if the only matched role was Admin and user is not in APP_ADMIN_USERS', () => {
      const roles = mapRoles('regularuser', ['ZAPP_Admin'], null, {});
      expect(roles).toBeNull();
    });

    it('grants Admin through prefix match if user IS in APP_ADMIN_USERS', () => {
      const env = { APP_ADMIN_USERS: 'adminuser,other' };
      const roles = mapRoles('adminuser', ['ZAPP_Admin', 'ZAPP_Viewer'], null, env);
      expect(roles).toContain('Admin');
      expect(roles).toContain('Viewer');
    });

    it('never grants Admin through role-map override unless user is in APP_ADMIN_USERS', () => {
      const roles = mapRoles('regularuser', ['Z_SPECIAL_ADMIN'], sampleMap, {});
      expect(roles).not.toContain('Admin');
      expect(roles).toEqual(['Viewer']);
    });
  });

  describe('fetchAndMapRoles', () => {
    it('resolves mapped roles via prefix matching when role-map file does not exist', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        roles: [{ name: 'ZAPP_SalesManager' }, { name: 'ZAPP_PurchasingManager' }]
      });
      const fsImpl = makeFs(null); // role-map does not exist

      const roles = await fetchAndMapRoles('jsmith', mockFetch, {}, '/fake/absent.json', fsImpl);
      expect(roles).toEqual(expect.arrayContaining(['SalesManager', 'PurchasingManager']));
      expect(mockFetch).toHaveBeenCalledWith('jsmith');
    });

    it('falls back to APP_DEFAULT_ROLES when no SAP roles match prefix or map', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        roles: [{ name: 'SAP_ALL' }, { name: 'ZAPP_NONEXISTENT' }]
      });
      const fsImpl = makeFs(null);
      const env = { APP_DEFAULT_ROLES: 'Viewer' };

      const roles = await fetchAndMapRoles('jsmith', mockFetch, env, '/fake/absent.json', fsImpl);
      expect(roles).toEqual(['Viewer']);
    });

    it('falls back to APP_DEFAULT_ROLES when BAPI call throws (RFC failure, timeout)', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('RFC_TIMEOUT: connection timed out'));
      const fsImpl = makeFs(null);
      const env = { APP_DEFAULT_ROLES: 'Viewer' };

      const roles = await fetchAndMapRoles('jsmith', mockFetch, env, '/fake/absent.json', fsImpl);
      expect(roles).toEqual(['Viewer']);
    });

    it('falls back to APP_DEFAULT_ROLES when fetchDetail is not a function', async () => {
      const fsImpl = makeFs(null);
      const env = { APP_DEFAULT_ROLES: 'Viewer' };

      const roles = await fetchAndMapRoles('jsmith', null, env, '/fake/absent.json', fsImpl);
      expect(roles).toEqual(['Viewer']);
    });

    it('enforces Admin guard through fetchAndMapRoles', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        roles: [{ name: 'ZAPP_Admin' }]
      });
      const fsImpl = makeFs(null);

      // Regular user falls back to default because Admin is stripped
      const roles1 = await fetchAndMapRoles('regularuser', mockFetch, { APP_DEFAULT_ROLES: 'Viewer' }, '/fake/absent.json', fsImpl);
      expect(roles1).toEqual(['Viewer']);

      // Admin user in APP_ADMIN_USERS gets Admin
      const roles2 = await fetchAndMapRoles('adminuser', mockFetch, { APP_ADMIN_USERS: 'adminuser' }, '/fake/absent.json', fsImpl);
      expect(roles2).toEqual(['Admin']);
    });
  });
});
