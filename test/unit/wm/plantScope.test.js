/** Unit tests for the server-side plant scope derived from the authenticated user. */
const plantScope = require('../../../srv/wm/handling-unit/plantScope');

const user = ({ admin = false, attr } = {}) => ({ is: (r) => admin && r === 'Admin', attr });

describe('plantScope(user)', () => {
  it('Admin -> null (all plants)', () => {
    expect(plantScope(user({ admin: true, attr: { Plant: ['1120'] } }))).toBeNull();
  });
  it('non-Admin with NO Plant attribute -> [] (no access, never null)', () => {
    expect(plantScope(user({ attr: {} }))).toEqual([]);
    expect(plantScope(user({}))).toEqual([]);        // attr undefined
    expect(plantScope(user({ attr: { Plant: [] } }))).toEqual([]); // empty array
  });
  it('empty-string / blank attribute values are dropped -> []', () => {
    expect(plantScope(user({ attr: { Plant: [''] } }))).toEqual([]);
    expect(plantScope(user({ attr: { Plant: ['', '   '] } }))).toEqual([]);
  });
  it('valid values are trimmed + upper-cased', () => {
    expect(plantScope(user({ attr: { Plant: [' 1120 ', '1130'] } }))).toEqual(['1120', '1130']);
    expect(plantScope(user({ attr: { Plant: '1120' } }))).toEqual(['1120']); // scalar tolerated
  });
  it('a malformed value is coerced (and will simply match no real plant) -> never null', () => {
    const r = plantScope(user({ attr: { Plant: ['ab/c', { x: 1 }] } }));
    expect(Array.isArray(r)).toBe(true);
    expect(r).not.toBeNull();
    expect(r).toContain('AB/C'); // bogus code, but harmless: it matches no real plant
  });
});
