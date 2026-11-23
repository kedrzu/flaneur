import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { typeText } from '../utils/typeText.js';

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
            await typeText(page.getByRole('combobox', { name: 'Search' }), 'Denver, CO');
            // Enter alone does not search here; the button does.
            await page.getByRole('button', { name: 'Submit Search' }).click();
        });
        // After a search Zillow may ask which listings to show before it shows any.
        await step(
            'choose homes for sale',
            async () => {
                await page.getByRole('button', { name: 'For sale' }).click();
            },
            { optional: true },
        );
        await step('see the results', async () => {
            await expect(page).toHaveURL(/\/homes\//);
        });
        await step('open a home', async () => {
            await clickResult(page.locator('a[href*="/homedetails/"]').first());
            await expect(page).toHaveURL(/\/homedetails\/.+_zpid/);
        });
    },
});
