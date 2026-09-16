const { extractFilterParam, extractFilterParams } = require('../../../srv/common/filterUtils');

describe('Unit: filterUtils', () => {
  describe('extractFilterParam', () => {
    it('should return null for null or missing req or fieldName', () => {
      expect(extractFilterParam(null, 'Plant')).toBeNull();
      expect(extractFilterParam({}, null)).toBeNull();
      expect(extractFilterParam({}, '')).toBeNull();
    });

    it('should extract parameter from req.data', () => {
      const req = { data: { Plant: '1120', Warehouse: '0001' } };
      expect(extractFilterParam(req, 'Plant')).toBe('1120');
      expect(extractFilterParam(req, 'Warehouse')).toBe('0001');
    });

    it('should extract parameter from req.params object', () => {
      const req = { params: [{ Plant: '1010' }] };
      expect(extractFilterParam(req, 'Plant')).toBe('1010');
    });

    it('should extract single primitive key parameter from req.params', () => {
      const req = { params: ['0000000010'] };
      expect(extractFilterParam(req, 'SalesInquiry')).toBe('0000000010');
    });

    it('should extract parameter from req.query.SELECT.where (string token format)', () => {
      const req = {
        query: {
          SELECT: {
            where: ['Plant', '=', '1120', 'and', 'Material', '=', '1000000514']
          }
        }
      };
      expect(extractFilterParam(req, 'Plant')).toBe('1120');
      expect(extractFilterParam(req, 'Material')).toBe('1000000514');
    });

    it('should extract parameter from req.query.SELECT.where (object ref / val format)', () => {
      const req = {
        query: {
          SELECT: {
            where: [
              { ref: ['Warehouse'] },
              '=',
              { val: '0001' },
              'and',
              { ref: ['Plant'] },
              '=',
              { val: '1120' }
            ]
          }
        }
      };
      expect(extractFilterParam(req, 'Warehouse')).toBe('0001');
      expect(extractFilterParam(req, 'Plant')).toBe('1120');
    });

    it('should extract parameter from raw $filter query option', () => {
      const req = {
        _queryOptions: {
          $filter: "Plant eq '1120' and Material eq '1000000514'"
        }
      };
      expect(extractFilterParam(req, 'Plant')).toBe('1120');
      expect(extractFilterParam(req, 'Material')).toBe('1000000514');
    });

    it('should extract parameter from decoded req.req.url fallback', () => {
      const req = {
        req: {
          url: "/odata/v4/warehouse-management/Warehouses?$filter=Warehouse%20eq%20'0001'"
        }
      };
      expect(extractFilterParam(req, 'Warehouse')).toBe('0001');
    });

    it('should return null when parameter is not found', () => {
      const req = { query: { SELECT: { where: ['Plant', '=', '1120'] } } };
      expect(extractFilterParam(req, 'StorageLocation')).toBeNull();
    });
  });

  describe('extractFilterParams', () => {
    it('should extract multiple parameters into an object', () => {
      const req = {
        query: {
          SELECT: {
            where: [
              { ref: ['Material'] }, '=', { val: 'MAT01' },
              'and',
              { ref: ['Plant'] }, '=', { val: '1120' },
              'and',
              { ref: ['StorageLocation'] }, '=', { val: 'CS01' }
            ]
          }
        }
      };
      const params = extractFilterParams(req, ['Material', 'Plant', 'StorageLocation', 'Batch']);
      expect(params).toEqual({
        Material: 'MAT01',
        Plant: '1120',
        StorageLocation: 'CS01',
        Batch: ''
      });
    });
  });
});
