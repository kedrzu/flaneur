import { createPageDriver } from '../createPageDriver.js';
import { runShopProbe } from '../runShopProbe.js';
import { checkShopScore, summarizeShopScore } from './checkShopScore.js';
import { sitesTest as test } from './sitesTest.js';
import { SCORE_ANNOTATION, VENDOR_ANNOTATION } from './summarizeSites.js';

/**
 * The mean reCAPTCHA v3 score a visit must reach. The agent's browser averaged 0.68 and the plain headless Chromium
 * 0.08 over the same visit (stealth-browsing D9).
 */
const SHOP_SCORE_THRESHOLD = 0.5;
/** Between the visit's steps: the agent thinks a few seconds between commands, as in `bun run eval`. */
const SHOP_PAUSE_MS = 3000;

test(
    'Beanwright test shop',
    { tag: '@recaptcha', annotation: { type: VENDOR_ANNOTATION, description: 'reCAPTCHA' } },
    async ({ page }, testInfo) => {
        const driver = createPageDriver(
            page,
            () => Promise.resolve(page.context().browser()?.version() ?? 'unknown'),
            () => Promise.resolve(),
        );
        const visit = await runShopProbe({ driver, pauseMs: SHOP_PAUSE_MS, label: testInfo.project.name });

        const summary = summarizeShopScore(visit);
        if (summary != null) {
            testInfo.annotations.push({ type: SCORE_ANNOTATION, description: String(summary.mean) });
        }
        checkShopScore(visit, SHOP_SCORE_THRESHOLD);
    },
);
