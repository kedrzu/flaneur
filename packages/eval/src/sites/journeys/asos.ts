import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.asos.com/';

/**
 * ASOS behind Akamai (`_abck`, `bm_sz`): a search, a one-size beanie, the guest bag. A refused add shows no challenge
 * page: the bag API answers 403 and the page says "Sorry, there was an issue adding this item to the bag".
 */
export const asos = defineJourney({
    name: 'asos.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.locator('#onetrust-accept-btn-handler').click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Search for items and brands' }), 'beanie');
            await expect(page).toHaveURL(/\/search\/\?q=beanie/);
        });
        await step(
            'accept cookies on the results',
            async () => {
                await page.locator('#onetrust-accept-btn-handler').click();
            },
            { optional: true },
        );
        await step('open a product', async () => {
            await page
                .locator('a[href*="/prd/"]')
                .filter({ hasText: /beanie/i })
                .first()
                .click();
            await expect(page.getByRole('button', { name: 'Add to bag' })).toBeVisible();
        });
        await step(
            'stay on the UK store',
            async () => {
                // A visitor from Poland is asked where to deliver; the UK store keeps the journey's pages the same.
                await page.getByRole('button', { name: 'Deliver elsewhere' }).click();
            },
            { optional: true },
        );
        await step(
            'close the preferences',
            async () => {
                await page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name: 'Close' }).click();
            },
            { optional: true },
        );
        await step('add to bag', async () => {
            await page.getByRole('button', { name: 'Add to bag' }).click();
            // The mini bag opens beside the page.
            await expect(page.getByRole('link', { name: 'View Bag' })).toBeVisible();
        });
        await step('open the bag', async () => {
            await page.getByRole('link', { name: 'View Bag' }).click();
            await expect(page).toHaveURL(/\/bag/);
        });
    },
});
