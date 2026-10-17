/**
 * Project-wide UI consistency rules (static checks over every view / fragment).
 * One page chrome: the application ShellBar shows the title and the back button, so no page renders
 * its own. Every table has an empty-state text, no control is sized in pixels, every custom CSS class
 * used by a view exists in style.css, and UI texts come from i18n.
 */
const fs = require('fs');
const path = require('path');

const WEBAPP = path.join(__dirname, '../../../app/fiori-app/webapp');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const views = walk(WEBAPP).filter((f) => /\.(view|fragment)\.xml$/.test(f)).map((f) => ({ name: path.relative(WEBAPP, f), xml: fs.readFileSync(f, 'utf8') }));
const css = fs.readFileSync(path.join(WEBAPP, 'css/style.css'), 'utf8');
const i18n = fs.readFileSync(path.join(WEBAPP, 'i18n/i18n.properties'), 'utf8');
const i18nEn = fs.readFileSync(path.join(WEBAPP, 'i18n/i18n_en.properties'), 'utf8');
const appController = fs.readFileSync(path.join(WEBAPP, 'controller/App.controller.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(WEBAPP, 'manifest.json'), 'utf8'));
/** Opening tags of the given control, attributes included (bindings contain ">" so match up to the tag end). */
const tags = (xml, control) => xml.match(new RegExp(`<(?:\\w+:)?${control}\\b(?:[^>"]|"[^"]*")*>`, 'g')) || [];

test('there are views to check', () => expect(views.length).toBeGreaterThan(30));

test('no page renders its own title or back button (the ShellBar owns both)', () => {
  views.forEach(({ name, xml }) => tags(xml, 'Page').forEach((tag) => {
    expect(`${name}: ${/\s(title|showNavButton|navButtonPress)=/.test(tag)}`).toBe(`${name}: false`);
  }));
});

test('every route except login has a ShellBar title', () => {
  const routes = manifest['sap.ui5'].routing.routes.map((r) => r.name).filter((n) => !['login', 'default'].includes(n));
  routes.forEach((route) => expect(`${route}: ${new RegExp(`case "${route}":`).test(appController)}`).toBe(`${route}: true`));
});

test('every table has an empty-state text', () => {
  views.forEach(({ name, xml }) => tags(xml, 'Table').forEach((tag) => {
    expect(`${name}: ${/\snoDataText=/.test(tag)}`).toBe(`${name}: true`);
  }));
});

test('no control is sized in pixels', () => {
  views.forEach(({ name, xml }) => expect(`${name}: ${(xml.match(/\s(?:width|height|contentWidth|contentHeight)="\d+px"/g) || []).join(',')}`).toBe(`${name}: `));
});

test('every custom CSS class used in a view is defined in style.css', () => {
  const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  views.forEach(({ name, xml }) => {
    const used = [...xml.matchAll(/\sclass="([^"{]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c && !c.startsWith('sap'));
    expect(`${name}: ${[...new Set(used.filter((c) => !defined.has(c)))].join(',')}`).toBe(`${name}: `);
  });
});

test('UI texts come from i18n, and every referenced key exists in both bundles', () => {
  const keys = (src) => new Set([...src.matchAll(/^([\w.]+)=/gm)].map((m) => m[1]));
  const k = keys(i18n);
  const kEn = keys(i18nEn);
  views.forEach(({ name, xml }) => {
    const literal = [...xml.matchAll(/\s(?:text|title|header|subheader|headerText|placeholder|tooltip|noDataText)="([^"{]*[A-Za-z]{3}[^"{]*)"/g)].map((m) => m[1]);
    expect(`${name}: ${literal.join(' | ')}`).toBe(`${name}: `);
    const missing = [...new Set([...xml.matchAll(/\{i18n>([\w.]+)\}/g)].map((m) => m[1]))].filter((key) => !k.has(key) || !kEn.has(key));
    expect(`${name}: ${missing.join(',')}`).toBe(`${name}: `);
  });
});
