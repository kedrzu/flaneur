import type { Locator, Page } from 'playwright/test';

import type { JourneyStep } from '../defineJourney.js';

/**
 * Clicks a link that opens its page in a new tab (`target=_blank`, or a script's `window.open`: Zillow's results) or in
 * the same tab, as a site varies it between layouts, and moves the journey to the new tab when one opens. A journey
 * that stayed would wait on the page it clicked on and leave the new tab open for the rest of the run.
 * @returns The tab the journey continues in.
 * @util
 */
export async function clickFollowingTab(link: Locator, step: JourneyStep): Promise<Page> {
    const page = link.page();
    const before = page.url();
    const opened = page.waitForEvent('popup');
    const moved = page.waitForURL(url => url.href !== before).then(() => page);
    // The way not taken times out after the race; its rejection is expected.
    opened.catch(() => {});
    moved.catch(() => {});
    await link.click();
    const tab = await Promise.race([opened, moved]);
    if (tab !== page) {
        step.follow(tab);
    }
    return tab;
}
