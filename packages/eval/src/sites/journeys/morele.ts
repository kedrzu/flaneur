import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.morele.net/';

/** morele.net behind Cloudflare: a search, a product, the guest cart. */
export const morele = defineJourney({
    name: 'morele.net',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuję wszystko' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            // The department picker covers the field's centre.
            await submitSearch(page.getByRole('searchbox', { name: 'wyszukiwarka' }), 'mysz bezprzewodowa', {
                position: { x: 40, y: 24 },
            });
            await expect(page).toHaveURL(/\/wyszukiwarka\/\?q=/);
        });
        await step('open a product', async () => {
            await page.locator('a.product-card__name-link').first().click();
            await expect(page.getByRole('button', { name: 'Do koszyka' }).first()).toBeVisible();
        });
        await step('add to cart', async () => {
            // The product page sends a guest straight to the cart.
            await page.getByRole('button', { name: 'Do koszyka' }).first().click();
            await expect(page).toHaveURL(/\/koszyk\//);
            await expect(page.getByText(/Twój koszyk \(1\)/)).toBeVisible();
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
