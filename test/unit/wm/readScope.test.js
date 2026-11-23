'use strict';

const { applyPlantScope, assertPlantsInScope, isPlantAllowed, plantScope } = require('../../../srv/wm/readScope');

const user = ({ admin = false, attr = {} } = {}) => ({
  attr,
  is: (role) => admin && role === 'Admin'
});

describe('WM plant read scope', () => {
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

  // Rule from the comment on assertPlantsInScope (srv/wm/readScope.js:33): a plant that cannot be read refuses the action.
  describe('assertPlantsInScope', () => {
    const clerk1120 = user({ attr: { Plant: ['1120'] } });
    const sapError = (status) => Object.assign(new Error('SAP said no'), { status });

    test('an Admin passes without SAP being read', async () => {
      let reads = 0;
      await assertPlantsInScope(user({ admin: true }), async () => { reads += 1; return ['1130']; }, 'delivery 1');
      expect(reads).toBe(0);
    });

    test('a plant in the user scope passes', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => ['1120'], 'delivery 1')).resolves.toBeUndefined();
    });

    test('a plant outside the user scope is refused with 403 naming the plant', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => ['1120', '1130'], 'delivery 1')).rejects.toMatchObject({
        status: 403,
        statusCode: 403,
        message: "Plant 1130 is outside the authenticated user's plant scope"
      });
    });

    test('a failed SAP read refuses with 503 and says nothing was posted', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => { throw sapError(500); }, 'delivery 1')).rejects.toMatchObject({
        status: 503,
        $sanitize: false,
        message: 'The plant of delivery 1 could not be read from SAP; nothing was posted (NOT posted). Try again.'
      });
    });

    test('a read error without a status also refuses with 503', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => { throw new Error('socket hang up'); }, 'delivery 1'))
        .rejects.toMatchObject({ status: 503 });
    });

    test('a 4xx from the read is passed on unchanged', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => { throw sapError(404); }, 'delivery 1'))
        .rejects.toMatchObject({ status: 404, message: 'SAP said no' });
    });

    test('an empty plant list refuses with 503, never passes', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => [], 'delivery 1')).rejects.toMatchObject({ status: 503 });
    });

    test('a blank plant among the rows refuses with 503, even when another row is in scope', async () => {
      await expect(assertPlantsInScope(clerk1120, async () => ['1120', '  '], 'delivery 1')).rejects.toMatchObject({ status: 503 });
    });
  });
});
