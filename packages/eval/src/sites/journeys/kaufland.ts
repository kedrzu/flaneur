import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.kaufland.pl/';

/** Kaufland's marketplace behind Cloudflare: a search, a product, the guest cart. */
export const kaufland = defineJourney({
    name: 'kaufland.pl',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj', exact: true }).click();
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                // A promotion's dialog, a link to its deals and an unnamed close button.
                await page
                    .getByRole('dialog')
                    .filter({ has: page.locator('a[href*="/deals/"]') })
                    .getByRole('button')
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('textbox', { name: 'Pole wyszukiwania' }), 'czajnik elektryczny');
            await expect(page).toHaveURL(/\/s\/\?search_value=/);
        });
        await step(
            'accept cookies on the results',
            async () => {
                // The banner may come up only after the first page.
                await page.getByRole('button', { name: 'Akceptuj', exact: true }).click();
            },
            { optional: true },
        );
        await step('open a product', async () => {
            // The tile holds buttons of its own (a price badge opens a dialog): a person clicks the picture.
            await page.locator('a[href*="/product/"] .product-image__wrapper').first().click();
            await expect(page).toHaveURL(/\/product\/\d+/);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
            await expect(page.getByRole('button', { name: 'Przejdź do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Przejdź do koszyka' }).click();
            await expect(page).toHaveURL(/\/checkout\/cart/);
            await expect(page.getByRole('heading', { name: /Mój koszyk \([1-9]/ })).toBeVisible();
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
