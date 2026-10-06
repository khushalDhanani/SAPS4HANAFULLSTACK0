const { extractFilterParam, extractFilterParams, odataString, applyWhere } = require('../../../srv/common/filterUtils');

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

  describe('applyPaging', () => {
    const { applyPaging } = require('../../../srv/common/filterUtils');

    it('should return non-array inputs unmodified', () => {
      expect(applyPaging(null, {})).toBeNull();
      expect(applyPaging('abc', {})).toBe('abc');
    });

    it('should slice array when SELECT.limit is provided with numbers', () => {
      const items = [1, 2, 3, 4, 5];
      const req = { query: { SELECT: { limit: { rows: 2, offset: 1 } } } };
      const res = applyPaging(items, req);
      expect(res).toEqual([2, 3]);
    });

    it('should slice array when SELECT.limit contains { val: N } AST objects', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const req = { query: { SELECT: { limit: { rows: { val: 3 }, offset: { val: 0 } } } } };
      const res = applyPaging(items, req);
      expect(res).toEqual(['a', 'b', 'c']);
    });

    it('should attach $count when count: true is requested in query', () => {
      const items = [10, 20, 30, 40, 50, 60];
      const req = {
        query: {
          SELECT: {
            count: true,
            limit: { rows: { val: 2 }, offset: { val: 0 } }
          }
        }
      };
      const res = applyPaging(items, req);
      expect([...res]).toEqual([10, 20]);
      expect(res.$count).toBe(6);
    });

    it('should preserve existing $count if items already has it set', () => {
      const items = [1, 2];
      items.$count = 100;
      const req = { query: { SELECT: { limit: { rows: 1 } } } };
      const res = applyPaging(items, req);
      expect([...res]).toEqual([1]);
      expect(res.$count).toBe(100);
    });

    it('should support raw query options $top and $skip', () => {
      const items = [1, 2, 3, 4, 5];
      const req = { _queryOptions: { $top: '2', $skip: '1', $count: 'true' } };
      const res = applyPaging(items, req);
      expect([...res]).toEqual([2, 3]);
      expect(res.$count).toBe(5);
    });
  });

  describe('odataString', () => {
    it('should enclose standard string values in single quotes', () => {
      expect(odataString('1000000045')).toBe("'1000000045'");
      expect(odataString('CS01')).toBe("'CS01'");
    });

    it('should escape single quotes by doubling them', () => {
      expect(odataString("O'Neill")).toBe("'O''Neill'");
      expect(odataString("Item's and other's")).toBe("'Item''s and other''s'");
      expect(odataString("'''")).toBe("''''''''");
    });

    it('should return empty string literal for null, undefined, or empty string', () => {
      expect(odataString(null)).toBe("''");
      expect(odataString(undefined)).toBe("''");
      expect(odataString('')).toBe("''");
    });

    it('should convert numbers and booleans to quoted strings', () => {
      expect(odataString(123)).toBe("'123'");
      expect(odataString(0)).toBe("'0'");
      expect(odataString(false)).toBe("'false'");
    });
  });

  describe('applyWhere (in-memory $filter for RFC-backed value helps)', () => {
    const rows = [
      { PaymentTerms: '0001', PaymentTermsName: 'Payable immediately' },
      { PaymentTerms: 'AD30', PaymentTermsName: '120 Days from Invoice Date' },
      { PaymentTerms: 'NT30', PaymentTermsName: 'Net 30 days' }
    ];
    const contains = (field, val) => ({ func: 'contains', args: [{ ref: [field] }, { val }] });

    it('returns the rows unchanged when there is nothing to filter', () => {
      expect(applyWhere(rows, undefined)).toBe(rows);
      expect(applyWhere(rows, [])).toBe(rows);
      expect(applyWhere('not-an-array', [])).toBe('not-an-array');
    });

    it('applies contains case-insensitively across an or-group, as the UI5 suggestion filter sends it', () => {
      const where = ['(', contains('PaymentTerms', 'ad3'), 'or', contains('PaymentTermsName', 'ad3'), ')'];
      expect(applyWhere(rows, where).map((r) => r.PaymentTerms)).toEqual(['AD30']);
      const byText = [{ xpr: [contains('PaymentTerms', 'days'), 'or', contains('PaymentTermsName', 'days')] }];
      expect(applyWhere(rows, byText).map((r) => r.PaymentTerms)).toEqual(['AD30', 'NT30']);
    });

    it('combines an or-group with an and-ed equality (contact search within one customer)', () => {
      const contacts = [
        { ContactPerson: '25158', Customer: '10135', FullName: 'Babu Rao' },
        { ContactPerson: '25160', Customer: '10135', FullName: 'MN Rao' },
        { ContactPerson: '25799', Customer: '10514', FullName: 'Pradip Rao' }
      ];
      const where = [{ xpr: [contains('ContactPerson', 'rao'), 'or', contains('FullName', 'rao')] }, 'and', { ref: ['Customer'] }, '=', { val: '10135' }];
      expect(applyWhere(contacts, where).map((r) => r.ContactPerson)).toEqual(['25158', '25160']);
      expect(applyWhere(contacts, [{ ref: ['Customer'] }, '=', { val: '10514' }])).toHaveLength(1);
      expect(applyWhere(contacts, [{ ref: ['Customer'] }, '!=', { val: '10514' }])).toHaveLength(2);
    });

    it('never hides rows for constructs it does not understand', () => {
      expect(applyWhere(rows, [{ func: 'geo.distance', args: [] }])).toHaveLength(3);
      expect(applyWhere(rows, [{ ref: ['PaymentTerms'] }, 'is', 'not', 'null'])).toHaveLength(3);
    });
  });
});
