import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.redfin.com/';

/** Redfin behind AWS WAF: a city search, its listings, one home. */
export const redfin = defineJourney({
    name: 'redfin.com',
    vendor: 'AWS WAF',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: /Search for properties/ }).first(), 'Denver, CO');
            await expect(page).toHaveURL(/\/city\//);
        });
        await step('open a home', async () => {
            // Redfin opens a home in a new tab.
            const home = await clickIntoNewTab(page.locator('a[href*="/home/"]').first(), step);
            await expect(home).toHaveURL(/\/home\/\d+/);
        });
    },
});
