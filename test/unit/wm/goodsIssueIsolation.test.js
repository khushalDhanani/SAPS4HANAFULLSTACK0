/**
 * Structural isolation test for the per-movement-type Goods Issue backend.
 * Proves each type's validation + mapper module imports NO other type's module
 * (e.g. "posting 261 never touches 201's validation/mapper file"). Shared PURE infrastructure
 * (common.js / s4common.js) is allowed; another movement type's file is not.
 */

const fs = require('fs');
const path = require('path');

const TYPES = ['201', '261', '301', '311'];

const FILES = [];
for (const t of TYPES) {
  FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/wm/goods-issue/validation/goodsIssue${t}.validation.js`) });
  FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/wm/goods-issue/mapping/goodsIssue${t}.normalize.js`) });
  FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue${t}Mapper.js`) });
}

/** Extract the argument of every require('...') in a source file. */
function requiredPaths(src) {
  const out = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

describe('per-type Goods Issue module isolation', () => {
  test.each(FILES)('$type module imports no other movement type file', ({ type, file }) => {
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    const others = TYPES.filter(t => t !== type);
    for (const dep of requiredPaths(src)) {
      for (const other of others) {
        // A dependency path must not reference another type's number (e.g. 201 file requiring "...261...").
        expect(dep.includes(other)).toBe(false);
      }
    }
  });

  test('every per-type file exists and is wired to shared infra only', () => {
    for (const { file } of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      const deps = requiredPaths(src);
      // Allowed shared deps: validation common, s4 common, and the type-agnostic normalize base
      // (goodsIssue.mapper). No cross-type deps (checked above).
      for (const dep of deps) {
        expect(/common|s4common|goodsIssue\.mapper/.test(dep)).toBe(true);
      }
    }
  });
});
