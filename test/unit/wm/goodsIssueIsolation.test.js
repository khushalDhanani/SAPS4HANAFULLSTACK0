/**
 * Structural isolation test for the per-movement-type Goods Issue stack (Phase 5 #2).
 * Proves every per-type module - BACKEND (validation / normalize / S/4 mapper) and FRONTEND
 * (controller / model / service) - imports NO other movement type's module. This is the
 * "posting 261 never touches 201's files" proof, done structurally rather than by hope.
 * Shared PURE infrastructure (common.js / s4common.js / goodsIssue.mapper) is allowed; another
 * movement type's file is not.
 */

const fs = require('fs');
const path = require('path');

const TYPES = ['201', '261', '301', '311'];

const BACKEND_FILES = [];
const FRONTEND_FILES = [];
for (const t of TYPES) {
  BACKEND_FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/wm/goods-issue/validation/goodsIssue${t}.validation.js`) });
  BACKEND_FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/wm/goods-issue/mapping/goodsIssue${t}.normalize.js`) });
  BACKEND_FILES.push({ type: t, file: path.resolve(__dirname, `../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue${t}Mapper.js`) });

  const feBase = path.resolve(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue');
  FRONTEND_FILES.push({ type: t, file: path.join(feBase, `controller/GoodsIssue${t}.controller.js`) });
  FRONTEND_FILES.push({ type: t, file: path.join(feBase, `model/GoodsIssue${t}Model.js`) });
  FRONTEND_FILES.push({ type: t, file: path.join(feBase, `service/GoodsIssue${t}Service.js`) });
}

/**
 * Extracts every dependency module path a source declares, covering both CommonJS `require('...')`
 * and UI5 `sap.ui.define([ '...', '...' ], ...)` dependency arrays.
 */
function dependencyPaths(src) {
  const out = [];
  const reRequire = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reRequire.exec(src)) !== null) out.push(m[1]);

  const defMatch = src.match(/sap\.ui\.define\(\s*\[([\s\S]*?)\]/);
  if (defMatch) {
    const reStr = /['"]([^'"]+)['"]/g;
    while ((m = reStr.exec(defMatch[1])) !== null) out.push(m[1]);
  }
  return out;
}

const ALL_FILES = [...BACKEND_FILES, ...FRONTEND_FILES];

describe('per-type Goods Issue module isolation (Phase 5 #2)', () => {
  test.each(ALL_FILES)('$type module imports no other movement type file ($file)', ({ type, file }) => {
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    const others = TYPES.filter(t => t !== type);
    for (const dep of dependencyPaths(src)) {
      for (const other of others) {
        // A dependency path must not reference another type's number (e.g. a 201 file depending on "...261...").
        expect(dep.includes(other)).toBe(false);
      }
    }
  });

  test('backend per-type files depend only on shared infrastructure (no cross-type deps)', () => {
    for (const { file } of BACKEND_FILES) {
      const src = fs.readFileSync(file, 'utf8');
      for (const dep of dependencyPaths(src)) {
        // Allowed shared deps: validation common, s4 common, and the type-agnostic normalize base.
        expect(/common|s4common|goodsIssue\.mapper/.test(dep)).toBe(true);
      }
    }
  });
});
