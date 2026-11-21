import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zillow.com/';

/** Zillow behind HUMAN: a place search, its listings, one home. No cart. */
export const zillow = defineJourney({
    name: 'zillow.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'skip the listing type question',
            async () => {
                await page.getByRole('button', { name: 'Skip this question' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Search' }), 'Denver, CO');
            await expect(page).toHaveURL(/\/homes\//);
        });
        await step(
            'skip the listing type question',
            async () => {
                await page.getByRole('button', { name: 'Skip this question' }).click();
            },
            { optional: true },
        );
        await step('open a home', async () => {
            await openLink(page.locator('a[href*="/homedetails/"]').first());
            await expect(page).toHaveURL(/\/homedetails\/.+_zpid/);
        });
    },
});
