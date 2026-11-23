import { CAPTCHA_CHECKS } from './captchaChecks.js';
import { describeSite } from './describeSite.js';
import { sitesTest as test } from './sitesTest.js';
import { SITE_ANNOTATION, VENDOR_ANNOTATION } from './summarizeSites.js';

for (const check of CAPTCHA_CHECKS) {
    const site = new URL(check.url).hostname;
    describeSite(site, () => {
        test(
            check.name,
            {
                tag: ['@captcha', `@${check.vendor.toLowerCase()}`],
                annotation: [
                    { type: VENDOR_ANNOTATION, description: check.vendor },
                    { type: SITE_ANNOTATION, description: site },
                    ...(check.note == null ? [] : [check.note]),
                ],
            },
            async ({ page, step }, testInfo) => {
                await check.run(page, step, testInfo);
            },
        );
    });
}
