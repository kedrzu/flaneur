import type { Locator, Page } from 'playwright/test';

import type { JourneyStep } from '../defineJourney.js';
import { clickResult } from './clickResult.js';

/**
 * Clicks a result that opens its page in a new tab, as a listing with `target=_blank` does, coming to it as
 * `clickResult` does, and moves the journey to that tab, as a person reads on where the click took them.
 * @returns The new tab, where the journey continues.
 * @util
 */
export async function clickIntoNewTab(link: Locator, step: JourneyStep): Promise<Page> {
    const [tab] = await Promise.all([link.page().waitForEvent('popup'), clickResult(link)]);
    step.follow(tab);
    return tab;
}
