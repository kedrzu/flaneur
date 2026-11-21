import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.gamestop.com/';

/** GameStop behind HUMAN: a search, a product, the guest cart. */
export const gamestop = defineJourney({
    name: 'gamestop.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            // The combobox's label element is empty, so its placeholder is what names it.
            await submitSearch(page.getByPlaceholder('Search games, consoles & more'), 'controller');
            await expect(page).toHaveURL(/\/search-new\/\?q=/);
        });
        await step('open a product', async () => {
            await openLink(page.locator('a[href*="/products/"][href$=".html"]').first());
            await expect(page).toHaveURL(/\/products\/.+\/\d+\.html/);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Add to Cart' }).first().click();
            await expect(page.getByRole('heading', { name: 'Added to the cart' })).toBeVisible();
        });
        await step('open the cart', async () => {
            // The confirmation offers a paid protection plan; "No Thanks" declines it and goes to the cart.
            await page.getByRole('button', { name: 'Navigate to Cart and Close Modal' }).click();
            await expect(page).toHaveURL(/\/cart\//);
        });
    },
});
