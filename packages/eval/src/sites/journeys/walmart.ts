import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.walmart.com/';

/** Walmart behind HUMAN: a search, a product page, an add from the listing, the guest cart. */
export const walmart = defineJourney({
    name: 'walmart.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Search' }), 'towels');
            await expect(page).toHaveURL(/\/search\?q=towels/);
        });
        await step('open a product', async () => {
            await page.locator('a[href*="/ip/"]').first().click();
            await expect(page).toHaveURL(/\/ip\//);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/\/search\?q=towels/);
        });
        await step('add to cart', async () => {
            await page
                .getByRole('button', { name: /^Add to cart - / })
                .first()
                .click();
            await expect(page.getByRole('button', { name: /Cart contains [1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: /Cart contains [1-9]/ }).click();
            await expect(page).toHaveURL(/\/cart/);
        });
    },
});
