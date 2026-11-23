import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.lowes.com/';

/** Lowe's behind Akamai (`_abck`, `bm_sv`): a search, a hammer, the guest cart. */
export const lowes = defineJourney({
    name: 'lowes.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('textbox', { name: 'Search Query' }), 'hammer');
            await expect(page).toHaveURL(/\/search\?searchTerm=hammer/);
        });
        await step('open a product', async () => {
            await clickResult(
                page
                    .locator('a[href*="/pd/"]')
                    .filter({ hasText: /hammer/i })
                    .first(),
            );
            await expect(page).toHaveURL(/\/pd\//);
        });
        await step('add to cart', async () => {
            await page.locator('#atcButton').click();
            await expect(page.getByRole('heading', { name: 'Added to Cart' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'View Cart' }).click();
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
