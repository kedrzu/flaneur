import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zara.com/pl/pl/';

/** Zara behind Akamai: a search, a product in a size, the guest cart. */
export const zara = defineJourney({
    name: 'zara.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            // The home page streams video and may never fire `load`; the next step waits for what it needs.
            await page.goto(URL, { waitUntil: 'domcontentloaded' });
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'AKCEPTUJ WSZYSTKIE PLIKI COOKIE' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await page.getByRole('link', { name: 'SZUKAJ' }).click();
            await submitSearch(page.getByRole('combobox', { name: 'Wprowadzenie tekstu wyszukiwania' }), 'sweter');
            await expect(page).toHaveURL(/\/pl\/pl\/search\?searchTerm=/);
        });
        await step('open a product', async () => {
            await page.locator('a.product-grid-product__link').first().click();
            await expect(page).toHaveURL(/-p\d+\.html/);
        });
        await step('add to cart', async () => {
            // The button reads "Dodaj"; the wishlist's, named "Dodaj element do wishlist", leads to the login.
            await page
                .getByRole('button')
                .filter({ hasText: /^Dodaj$/ })
                .click();
        });
        await step('choose a size', async () => {
            await page
                .getByRole('button', { name: /^(XS|S|M|L|XL)(-(S|M|L|XL|XXL))?$/ })
                .first()
                .click();
            await expect(page.getByRole('dialog').getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('dialog').getByRole('button', { name: 'Zobacz koszyk' }).click();
            await expect(page).toHaveURL(/\/shop\/cart/);
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
