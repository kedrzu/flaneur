import type { Locator, Page } from 'playwright/test';

import type { JourneyStep } from '../defineJourney.js';
import { clickIntoNewTab } from './clickIntoNewTab.js';

/**
 * Clicks a link that opens its page in a new tab when it says so (`target=_blank`) and in the same tab otherwise, as a
 * site varies it between layouts, and moves the journey to the new tab. A journey that stayed would check the page it
 * clicked on and leave the new tab open for the rest of the run.
 * @returns The tab the journey continues in.
 * @util
 */
export async function clickFollowingTab(link: Locator, step: JourneyStep): Promise<Page> {
    if ((await link.getAttribute('target')) === '_blank') {
        return clickIntoNewTab(link, step);
    }
    await link.click();
    return link.page();
}
