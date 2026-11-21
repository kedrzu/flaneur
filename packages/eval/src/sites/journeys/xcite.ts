import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.xcite.com/';

/** Xcite behind Imperva: a search, a product, the guest cart. */
export const xcite = defineJourney({
    name: 'xcite.com',
    vendor: 'Imperva',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox').first(), 'air fryer');
            await expect(page).toHaveURL(/\/search\?q=air/);
        });
        await step('open a product', async () => {
            await page.locator('a[href*="/p"]').filter({ hasText: /fryer/i }).first().click();
            await expect(page.getByRole('button', { name: /Add To Cart/i }).first()).toBeVisible();
        });
        await step('add to cart', async () => {
            await page
                .getByRole('button', { name: /Add To Cart/i })
                .first()
                .click();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: /^View cart/ }).click();
            await expect(page).toHaveURL(/cart/);
        });
    },
});
