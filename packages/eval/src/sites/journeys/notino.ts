import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.notino.pl/';

/** Notino behind Cloudflare (whose challenge plain curl gets): a search, a product, the guest cart. */
export const notino = defineJourney({
    name: 'notino.pl',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj wszystko' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: /^Wyszukaj/ }), 'krem do rąk');
            await expect(page).toHaveURL(/\/search/);
        });
        await step('open a product', async () => {
            await page.locator('a[href*="/p-"]').filter({ hasText: /krem/i }).first().click();
            await expect(page).toHaveURL(/\/p-\d+/);
        });
        await step('add to cart', async () => {
            await page
                .getByRole('button', { name: /^Dodaj do koszyka - / })
                .first()
                .click();
            await expect(page.getByRole('link', { name: 'Przejdź do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: 'Przejdź do koszyka' }).click();
            await expect(page).toHaveURL(/\/cart/);
            await expect(page.getByRole('heading', { name: 'Koszyk', level: 1 })).toBeVisible();
        });
    },
});
