import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.fiverr.com/';

/** Fiverr behind HUMAN (`_px3`, its `px-cdn.net` client): a search and one gig. No order, no account. */
export const fiverr = defineJourney({
    name: 'fiverr.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Search for any service' }).first(), 'logo design');
            await expect(page).toHaveURL(/\/search\/gigs\?query=logo/);
        });
        await step('open a gig', async () => {
            // A gig opens in a new tab.
            const gig = await clickIntoNewTab(page.getByRole('link', { name: 'Go to gig' }).first(), step);
            await expect(gig.getByRole('heading', { level: 1 })).toContainText(/^I will/);
        });
    },
});
