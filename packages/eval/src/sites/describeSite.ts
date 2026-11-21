import { COOLDOWN_FILE, IGNORE_COOLDOWN_VARIABLE, readCooldowns, remainingCooldownMinutes } from './siteCooldowns.js';
import { sitesTest as test } from './sitesTest.js';

/**
 * Declares the tests of one site (a host) in an untitled group, skipped while the site cools after it challenged or
 * refused flaneur. Untitled, so the skip applies before any fixture opens a tab and each test keeps its own title.
 */
export function describeSite(site: string, body: () => void) {
    test.describe(() => {
        const cooldowns = process.env[IGNORE_COOLDOWN_VARIABLE] === '1' ? {} : readCooldowns(COOLDOWN_FILE);
        const minutes = remainingCooldownMinutes(cooldowns, site, new Date());
        test.skip(
            minutes > 0,
            `${site} is cooling for ${minutes} more min after it challenged or refused flaneur (${IGNORE_COOLDOWN_VARIABLE}=1 runs it anyway)`,
        );
        body();
    });
}
