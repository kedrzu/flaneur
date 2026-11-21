import { runJourney } from './defineJourney.js';
import { describeSite } from './describeSite.js';
import { JOURNEYS } from './journeys/index.js';
import { sitesTest as test } from './sitesTest.js';
import { SITE_ANNOTATION, VENDOR_ANNOTATION } from './summarizeSites.js';

for (const journey of JOURNEYS) {
    const site = new URL(journey.url).hostname;
    describeSite(site, () => {
        test(
            journey.name,
            {
                tag: [`@${journey.vendor.toLowerCase().replaceAll(' ', '-')}`, ...(journey.tags ?? [])],
                annotation: [
                    { type: VENDOR_ANNOTATION, description: journey.vendor },
                    { type: SITE_ANNOTATION, description: site },
                ],
            },
            async ({ page, step }) => {
                await runJourney(journey, page, step);
            },
        );
    });
}
