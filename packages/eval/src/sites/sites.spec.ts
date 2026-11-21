import { runJourney } from './defineJourney.js';
import { JOURNEYS } from './journeys/index.js';
import { COOLDOWN_FILE, IGNORE_COOLDOWN_VARIABLE, readCooldowns, remainingCooldownMinutes } from './siteCooldowns.js';
import { sitesTest as test } from './sitesTest.js';
import { SITE_ANNOTATION, VENDOR_ANNOTATION } from './summarizeSites.js';

const cooldowns = process.env[IGNORE_COOLDOWN_VARIABLE] === '1' ? {} : readCooldowns(COOLDOWN_FILE);
const now = new Date();

for (const journey of JOURNEYS) {
    const site = new URL(journey.url).hostname;
    // An untitled group, so the skip applies before any fixture opens a tab and the test keeps its title.
    test.describe(() => {
        const minutes = remainingCooldownMinutes(cooldowns, site, now);
        test.skip(
            minutes > 0,
            `${site} is cooling for ${minutes} more min after it challenged or refused flaneur (${IGNORE_COOLDOWN_VARIABLE}=1 runs it anyway)`,
        );

        test(
            journey.name,
            {
                tag: `@${journey.vendor.toLowerCase()}`,
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
