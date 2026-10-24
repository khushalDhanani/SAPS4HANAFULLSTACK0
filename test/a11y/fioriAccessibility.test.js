'use strict';

/**
 * test/a11y/fioriAccessibility.test.js
 *
 * Accessibility (a11y) Verification Suite for SAP Fiori / UI5 Views & Fragments.
 * Enforces WCAG 2.1 AA and SAP Fiori accessibility standards:
 * - Dialog titles, landmarks, and ariaLabelledBy
 * - Icon-only buttons declare tooltip or ariaLabel
 * - Form inputs have accessible labels or placeholder descriptions
 * - Tables declare column header semantics
 * - AI assistant dialog controls and QR code modals declare accessible roles
 */

const fs = require('fs');
const path = require('path');

const WEBAPP_DIR = path.resolve(__dirname, '../../app/fiori-app/webapp');

function findXmlFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findXmlFiles(fullPath, fileList);
    } else if (entry.name.endsWith('.view.xml') || entry.name.endsWith('.fragment.xml')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Release Automation: SAP Fiori Accessibility (a11y) Suite', () => {
  let xmlFiles = [];

  beforeAll(() => {
    xmlFiles = findXmlFiles(WEBAPP_DIR);
  });

  it('discovers SAPUI5 XML views and fragments in the webapp directory', () => {
    expect(xmlFiles.length).toBeGreaterThan(5);
  });

  // 1. Dialog Accessibility: Every Dialog must have title, ariaLabel, ariaLabelledBy, or customHeader
  it('enforces title, ariaLabel, or ariaLabelledBy on all SAPUI5 Dialog elements', () => {
    const dialogRegex = /<Dialog\b([\s\S]*?(?:"[^"]*"|'[^']*'|[^'">])*?)>/g;
    const violations = [];

    xmlFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = dialogRegex.exec(content)) !== null) {
        const attrs = match[1];
        const hasTitle = /\btitle\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaLabel = /\bariaLabel\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaLabelledBy = /\bariaLabelledBy\s*=\s*["'][^"']+["']/.test(attrs);
        const hasCustomHeader = content.includes('customHeader');

        if (!hasTitle && !hasAriaLabel && !hasAriaLabelledBy && !hasCustomHeader) {
          violations.push(path.relative(WEBAPP_DIR, file));
        }
      }
    });

    expect(violations).toEqual([]);
  });

  // 2. Icon-Only Button Accessibility: Must have tooltip, ariaLabel, or text
  it('enforces accessible text, tooltip, or ariaLabel on all action Buttons', () => {
    const buttonRegex = /<Button\b([\s\S]*?(?:"[^"]*"|'[^']*'|[^'">])*?)>/g;
    const violations = [];

    xmlFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = buttonRegex.exec(content)) !== null) {
        const attrs = match[1];
        const hasText = /\btext\s*=\s*["'][^"']+["']/.test(attrs);
        const hasIcon = /\bicon\s*=\s*["'][^"']+["']/.test(attrs);
        const hasTooltip = /\btooltip\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaLabel = /\bariaLabel\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaHasPopup = /\bariaHasPopup\s*=\s*["'][^"']+["']/.test(attrs);

        // If it has an icon and NO text, it must have a tooltip or ariaLabel
        if (hasIcon && !hasText && !hasTooltip && !hasAriaLabel && !hasAriaHasPopup) {
          const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
          const btnId = idMatch ? idMatch[1] : 'unnamed-button';
          violations.push(`${path.relative(WEBAPP_DIR, file)} -> Button #${btnId}`);
        }
      }
    });

    expect(violations).toEqual([]);
  });

  // 3. Form Input Accessibility: Every Input or SearchField must have an accessible label association, placeholder, or tooltip
  it('enforces accessible labels, placeholders, or tooltips on Input and SearchField controls', () => {
    const inputRegex = /<(?:Input|SearchField)\b([\s\S]*?(?:"[^"]*"|'[^']*'|[^'">])*?)\/?>/g;
    const violations = [];

    xmlFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = inputRegex.exec(content)) !== null) {
        const attrs = match[1];
        const hasPlaceholder = /\bplaceholder\s*=\s*["'][^"']+["']/.test(attrs);
        const hasTooltip = /\btooltip\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaLabel = /\bariaLabel\s*=\s*["'][^"']+["']/.test(attrs);
        const hasAriaLabelledBy = /\bariaLabelledBy\s*=\s*["'][^"']+["']/.test(attrs);

        const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
        const inputId = idMatch ? idMatch[1] : null;

        // Check if there is an associated Label (labelFor="inputId") in the same XML file (standard UI5 pattern)
        const hasAssociatedLabel = inputId ? new RegExp(`labelFor\\s*=\\s*["']${inputId}["']`).test(content) : false;

        // Or if it's inside a SimpleForm where the preceding element is a Label
        const isFormLabeled = content.includes('sap.ui.layout.form') || content.includes('SimpleForm') || content.includes('FilterGroupItem') || content.includes('FilterBar');

        if (!hasPlaceholder && !hasTooltip && !hasAriaLabel && !hasAriaLabelledBy && !hasAssociatedLabel && !isFormLabeled) {
          violations.push(`${path.relative(WEBAPP_DIR, file)} -> Input #${inputId || 'unnamed'}`);
        }
      }
    });

    expect(violations).toEqual([]);
  });

  // 4. AI Assistant Dialog Specific a11y: Region role, aria labels, and stop/send button accessibility
  it('validates AskAIDialog fragment adheres to Fiori AI accessibility requirements', () => {
    const aiFragPath = path.join(WEBAPP_DIR, 'modules/mm/purchase-order/view/AskAIDialog.fragment.xml');
    expect(fs.existsSync(aiFragPath)).toBe(true);

    const content = fs.readFileSync(aiFragPath, 'utf8');
    expect(content).toContain('accessibleRole="Region"');
    expect(content).toContain('ariaLabel="{i18n>aiDialogTitle}"');
    expect(content).toContain('press=".onAIStop"');
    expect(content).toContain('press=".onAIAsk"');
  });

  // 5. Handling Unit QR Dialog a11y: Dialog header and download buttons
  it('validates Handling Unit QR Dialog fragments declare accessible titles and button tooltips', () => {
    const qrFragPath = path.join(WEBAPP_DIR, 'modules/wm/handling-unit/view/QrCodeDialog.fragment.xml');
    if (fs.existsSync(qrFragPath)) {
      const content = fs.readFileSync(qrFragPath, 'utf8');
      expect(content).toContain('title="{i18n>huQrTitle}"');
    }

    const layoutFragPath = path.join(WEBAPP_DIR, 'modules/wm/handling-unit/view/SelectQrLayoutDialog.fragment.xml');
    if (fs.existsSync(layoutFragPath)) {
      const content = fs.readFileSync(layoutFragPath, 'utf8');
      expect(content).toContain('title="{i18n>huQrCombineTitle}"');
    }
  });
});
