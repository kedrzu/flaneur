import { chromium } from 'playwright';

import { createPageDriver } from './createPageDriver.js';
import type { EvalDriver } from './StealthEvalTypes.js';

/**
 * The known-bot control (stealth-browsing D9): Playwright's bundled Chromium, headless, launched plain with no flags, so it
 * looks exactly as automated as it is.
 */
export async function createPlaywrightDriver(): Promise<EvalDriver> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    return createPageDriver(
        page,
        () => Promise.resolve(`HeadlessChrome/${browser.version()}`),
        () => browser.close(),
    );
}
