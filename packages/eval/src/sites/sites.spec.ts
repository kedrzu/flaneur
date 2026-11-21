import { runJourney } from './defineJourney.js';
import { JOURNEYS } from './journeys/index.js';
import { sitesTest as test } from './sitesTest.js';
import { VENDOR_ANNOTATION } from './summarizeSites.js';

for (const journey of JOURNEYS) {
    test(
        journey.name,
        {
            tag: `@${journey.vendor.toLowerCase()}`,
            annotation: { type: VENDOR_ANNOTATION, description: journey.vendor },
        },
        async ({ page, step }) => {
            await runJourney(journey, page, step);
        },
    );
}
