import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zara.com/pl/pl/';

/** Zara behind Akamai: a search, a product in a size, the guest cart. */
export const zara = defineJourney({
    name: 'zara.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
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
            await openLink(page.locator('a.product-grid-product__link').first());
            await expect(page).toHaveURL(/-p\d+\.html/);
        });
        await step('add to cart', async () => {
            await page
                .getByRole('button', { name: /^Dodaj/ })
                .first()
                .click();
        });
        await step('choose a size', async () => {
            await page
                .getByRole('button', { name: /^(XS|S|M|L|XL)$/ })
                .first()
                .click();
            await expect(page.getByRole('dialog', { name: /DODANO DO KOSZYKA/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: 'ZOBACZ KOSZYK' }).click();
            await expect(page).toHaveURL(/\/shop\/cart/);
        });
    },
});
