import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.ikea.com/pl/pl/';

/** IKEA behind Cloudflare: a search, a product, the guest cart. */
export const ikea = defineJourney({
    name: 'ikea.com',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie cookies' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj...' }), 'kubek');
            await expect(page).toHaveURL(/\/pl\/pl\/search\/\?q=/);
        });
        await step('open a product', async () => {
            await openLink(page.locator('a[href*="/pl/pl/p/"]').first());
            await expect(page).toHaveURL(/\/pl\/pl\/p\//);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie cookies' }).click();
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
            await expect(page.getByRole('alertdialog', { name: /dodano do koszyka/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: /^Koszyk/ }).click();
            await expect(page).toHaveURL(/\/pl\/pl\/shoppingcart\//);
        });
    },
});
