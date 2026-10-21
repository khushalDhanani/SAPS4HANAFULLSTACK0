'use strict';

const { applyPlantScope, isPlantAllowed, plantScope } = require('../../../srv/wm/reservation-entry/readScope');

const user = ({ admin = false, attr = {} } = {}) => ({
  attr,
  is: (role) => admin && role === 'Admin'
});

describe('Reservation Entry plant read scope', () => {
  test('uses the authenticated Plant attribute; Admin is unrestricted', () => {
    expect(plantScope(user({ attr: { Plant: ['1120', '1130'] } }))).toEqual(['1120', '1130']);
    expect(plantScope(user({ admin: true, attr: { Plant: ['1120'] } }))).toBeNull();
  });

  test('adds an ANDed plant predicate without discarding existing OData filters', () => {
    const query = { SELECT: { where: [{ ref: ['Status_code'] }, '=', { val: '02' }] } };
    expect(applyPlantScope(query, ['1120', '1130'])).toBe(query);
    expect(query.SELECT.where).toEqual([
      { xpr: [{ ref: ['Status_code'] }, '=', { val: '02' }] },
      'and',
      { xpr: [{ ref: ['Plant'] }, 'in', { list: [{ val: '1120' }, { val: '1130' }] }] }
    ]);
  });

  test('an empty plant claim produces a false predicate and never exposes a row', () => {
    const query = { SELECT: {} };
    applyPlantScope(query, []);
    expect(query.SELECT.where).toEqual([{ val: 1 }, '=', { val: 0 }]);
    expect(isPlantAllowed('1120', [])).toBe(false);
  });

  test('checks individual rows against authorized plants and leaves Admin unrestricted', () => {
    expect(isPlantAllowed(' 1120 ', ['1120'])).toBe(true);
    expect(isPlantAllowed('1130', ['1120'])).toBe(false);
    expect(isPlantAllowed('', ['1120'])).toBe(false);
    expect(isPlantAllowed('1130', null)).toBe(true);
  });
});
