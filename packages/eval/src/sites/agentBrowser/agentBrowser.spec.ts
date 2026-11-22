import { describeSite } from '../describeSite.js';
import { runJourney } from '../defineJourney.js';
import { SITE_ANNOTATION, VENDOR_ANNOTATION } from '../summarizeSites.js';
import { agentBrowserTest as test } from './agentBrowserTest.js';
import { AGENT_BROWSER_JOURNEYS } from './journeys/index.js';
import { recaptchaCheckbox } from './recaptchaCheckbox.js';

for (const journey of AGENT_BROWSER_JOURNEYS) {
    const site = new URL(journey.url).hostname;
    describeSite(site, () => {
        test(
            journey.name,
            {
                tag: [
                    '@agent-browser',
                    `@${journey.vendor.toLowerCase().replaceAll(' ', '-')}`,
                    ...(journey.tags ?? []),
                ],
                annotation: [
                    { type: VENDOR_ANNOTATION, description: journey.vendor },
                    { type: SITE_ANNOTATION, description: site },
                ],
            },
            async ({ ab, step }) => {
                await runJourney(journey, ab, step);
            },
        );
    });
}

const checkboxSite = new URL(recaptchaCheckbox.url).hostname;
describeSite(checkboxSite, () => {
    test(
        recaptchaCheckbox.name,
        {
            tag: ['@agent-browser', '@captcha', '@recaptcha'],
            annotation: [
                { type: VENDOR_ANNOTATION, description: recaptchaCheckbox.vendor },
                { type: SITE_ANNOTATION, description: checkboxSite },
            ],
        },
        async ({ ab, step }, testInfo) => {
            await recaptchaCheckbox.run(ab, step, testInfo);
        },
    );
});
