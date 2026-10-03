const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '../../..');
const webappRoot = path.join(appRoot, 'app/fiori-app/webapp');
const viewPath = path.join(webappRoot, 'modules/wm/goods-issue/view/GoodsIssue261.view.xml');
const controllerPath = path.join(webappRoot, 'modules/wm/goods-issue/controller/GoodsIssue261.controller.js');
const i18nDir = path.join(webappRoot, 'i18n');

function parseProperties(filePath) {
  const entries = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[#!]/.test(trimmed)) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    entries.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return entries;
}

function getReferencedKeys() {
  const sources = [
    fs.readFileSync(viewPath, 'utf8'),
    fs.readFileSync(controllerPath, 'utf8')
  ];
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/getText\(\s*["']([^"']+)["']/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(/\$\{i18n>([^}]+)\}|\{i18n>([^}]+)\}/g)) {
      keys.add(match[1] || match[2]);
    }
  }
  return [...keys].sort();
}

describe('Movement 261 i18n completeness', () => {
  const keys = getReferencedKeys();
  const bundles = fs.readdirSync(i18nDir)
    .filter((name) => /^i18n(?:_[A-Za-z0-9-]+)?\.properties$/.test(name))
    .map((name) => path.join(i18nDir, name));

  test('audits the configured base bundle and all available locale bundles', () => {
    expect(fs.existsSync(path.join(i18nDir, 'i18n.properties'))).toBe(true);
    expect(bundles).toContain(path.join(i18nDir, 'i18n.properties'));
    expect(bundles).toContain(path.join(i18nDir, 'i18n_en.properties'));
  });

  test.each(bundles.map((filePath) => [path.basename(filePath), filePath]))(
    '%s defines every key used by the 261 view and controller',
    (_name, filePath) => {
      const entries = parseProperties(filePath);
      const missing = keys.filter((key) => !entries.has(key));
      const empty = keys.filter((key) => entries.has(key) && !entries.get(key));
      const unresolved = keys.filter((key) => entries.get(key) === key);

      expect({ missing, empty, unresolved }).toEqual({
        missing: [],
        empty: [],
        unresolved: []
      });
    }
  );

  test('localizes the key operational messages used throughout the 261 flow', () => {
    const flowKeys = [
      'gi261PrefillNoOpenItem',
      'gi261SelectReservationItem',
      'gi261ValidationErrorsSummary',
      'gi261StagingInsufficient',
      'gi261StagingUnknown',
      'gi261StagingDestinationUnknown',
      'gi261QueuedMsg',
      'gi261UnknownMsg',
      'gi261PostSuccessMsg',
      'gi261ReverseConfirmPrompt',
      'gi261FormReset'
    ];
    expect(flowKeys.every((key) => keys.includes(key))).toBe(true);
  });

  test('does not embed user-facing literals in view text attributes or controller message calls', () => {
    const view = fs.readFileSync(viewPath, 'utf8');
    const controller = fs.readFileSync(controllerPath, 'utf8');
    const rawTextAttributes = [...view.matchAll(/\b(?:text|headerText|placeholder|tooltip|noDataText)="([^"]*)"/g)]
      .map((match) => match[1])
      .filter((value) => value && !value.startsWith('{') && value !== '#');

    expect(rawTextAttributes).toEqual([]);
    expect(controller).not.toMatch(/Message(?:Box\.(?:error|success|warning|information|confirm)|Toast\.show)\(\s*["']/);
  });
});
