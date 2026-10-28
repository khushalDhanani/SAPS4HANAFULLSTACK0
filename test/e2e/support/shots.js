'use strict';

/**
 * Full-page screenshots for the Mvt suites: a passing run asserts on the DOM and takes none; E2E_SCREENSHOTS=1 (debug
 * mode) keeps the per-step evidence; a failing run always saves one failure screenshot.
 */

const enabled = () => process.env.E2E_SCREENSHOTS === '1';

/** Step evidence, debug mode only. */
async function evidence(page, file) {
    if (!enabled()) return;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`Saved screenshot: ${file}`);
}

/** The page as it was when a suite failed; never throws. */
async function failure(page, file) {
    await page.screenshot({ path: file, fullPage: true })
        .then(() => console.error(`Saved failure screenshot: ${file}`), () => {});
}

module.exports = { enabled, evidence, failure };
