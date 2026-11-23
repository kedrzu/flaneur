import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { openProducts } from '../utils/openProducts.js';
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
            // A result's own card link, as in the long walk (`walmartLong`).
            await openProducts(page, 'a[href^="/ip/"][href*="from=/search"]', { clickImage: true }).openFirst();
            await expect(page).toHaveURL(/\/ip\//);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/\/search\?q=towels/);
        });
        await step('add to cart', async () => {
            await clickResult(page.getByRole('button', { name: /^Add to cart - / }).first());
            await expect(page.getByRole('button', { name: /Cart contains [1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: /Cart contains [1-9]/ }).click();
            await expect(page).toHaveURL(/\/cart/);
        });
        // The eval profile keeps its cart from run to run: what the journey added comes out again.
        await step(
            'empty the cart',
            async () => {
                await emptyCart(page);
            },
            { optional: true },
        );
    },
});
