'use strict';

const { applyWhere, compileWhere } = require('../../../srv/common/cqnFilterEvaluator');

describe('Unit: cqnFilterEvaluator', () => {
  const sampleRows = [
    { ID: '1', Name: 'Acme Corp', Category: 'A', Active: true, Amount: 100 },
    { ID: '2', Name: 'Beta LLC', Category: 'B', Active: false, Amount: 250 },
    { ID: '3', Name: 'Gamma Inc', Category: 'A', Active: true, Amount: 50 },
    { ID: '4', Name: 'Delta GmbH', Category: 'C', Active: null, Amount: 0 }
  ];

  describe('compileWhere & applyWhere', () => {
    it('returns the rows unchanged when where is empty or non-array', () => {
      expect(applyWhere(sampleRows, [])).toBe(sampleRows);
      expect(applyWhere(sampleRows, null)).toBe(sampleRows);
      expect(applyWhere(null, [{ ref: ['Name'] }, '=', { val: 'Acme' }])).toBeNull();
    });

    it('filters rows by equality with string token', () => {
      const where = [{ ref: ['Category'] }, '=', { val: 'A' }];
      const result = applyWhere(sampleRows, where);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.ID)).toEqual(['1', '3']);
    });

    it('filters rows with contains function case-insensitively', () => {
      const where = [{ func: 'contains', args: [{ ref: ['Name'] }, { val: 'corp' }] }];
      const result = applyWhere(sampleRows, where);
      expect(result).toHaveLength(1);
      expect(result[0].ID).toBe('1');
    });

    it('filters rows with startswith and endswith', () => {
      const whereStart = [{ func: 'startswith', args: [{ ref: ['Name'] }, { val: 'beta' }] }];
      expect(applyWhere(sampleRows, whereStart)).toHaveLength(1);

      const whereEnd = [{ func: 'endswith', args: [{ ref: ['Name'] }, { val: 'inc' }] }];
      expect(applyWhere(sampleRows, whereEnd)).toHaveLength(1);
    });

    it('combines OR conditions and AND conditions with precedence', () => {
      const where = [
        '(',
        { func: 'contains', args: [{ ref: ['Name'] }, { val: 'Acme' }] },
        'or',
        { func: 'contains', args: [{ ref: ['Name'] }, { val: 'Beta' }] },
        ')',
        'and',
        { ref: ['Category'] },
        '=',
        { val: 'A' }
      ];
      const result = applyWhere(sampleRows, where);
      expect(result).toHaveLength(1);
      expect(result[0].ID).toBe('1');
    });

    it('handles numeric comparisons', () => {
      const whereGt = [{ ref: ['Amount'] }, '>', { val: 75 }];
      const result = applyWhere(sampleRows, whereGt);
      expect(result.map((r) => r.ID)).toEqual(['1', '2']);
    });

    it('handles IS NULL and IS NOT NULL', () => {
      const whereNull = [{ ref: ['Active'] }, 'is', 'null'];
      const resultNull = applyWhere(sampleRows, whereNull);
      expect(resultNull).toHaveLength(1);
      expect(resultNull[0].ID).toBe('4');

      const whereNotNull = [{ ref: ['Active'] }, 'is', 'not', 'null'];
      const resultNotNull = applyWhere(sampleRows, whereNotNull);
      expect(resultNotNull).toHaveLength(3);
    });

    it('evaluates unknown constructs to true (never hides rows)', () => {
      const whereUnknown = [{ func: 'unknownFunction', args: [{ ref: ['Name'] }] }];
      const result = applyWhere(sampleRows, whereUnknown);
      expect(result).toHaveLength(sampleRows.length);
    });

    it('exports compileWhere which produces a predicate function', () => {
      const pred = compileWhere([{ ref: ['Name'] }, '=', { val: 'Acme Corp' }]);
      expect(typeof pred).toBe('function');
      expect(pred({ Name: 'Acme Corp' })).toBe(true);
      expect(pred({ Name: 'Other' })).toBe(false);
    });
  });
});
