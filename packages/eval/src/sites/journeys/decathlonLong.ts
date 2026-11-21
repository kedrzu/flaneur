import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openProducts } from '../utils/openProducts.js';
import { readPage } from '../utils/readPage.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.decathlon.pl/';

/**
 * The long Decathlon walk (Cloudflare): a search sorted by rating, its second page, two products read (back between
 * them), the second in the guest cart.
 */
export const decathlonLong = defineJourney({
    name: 'decathlon.pl long',
    vendor: 'Cloudflare',
    url: URL,
    tags: ['@long'],
    run: async (page, step) => {
        const products = openProducts(page, 'a[href*="/p/"]');

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
            await submitSearch(page.getByRole('searchbox', { name: 'Szukaj' }), 'bidon');
            await expect(page).toHaveURL(/\/search\?Ntt=/);
        });
        await step('sort by rating', async () => {
            await page.getByRole('combobox', { name: /Sortuj według/ }).click();
            await page.getByRole('option', { name: 'Najwyżej oceniane' }).click();
            await expect(page).toHaveURL(/[?&]sort=rating/);
        });
        await step('open page 2', async () => {
            await page.getByRole('link', { name: 'Przejdź do następnej strony' }).click();
            await expect(page).toHaveURL(/[?&]from=40/);
        });
        await step('open a product', async () => {
            await products.openFirst();
            await expect(page.getByRole('button', { name: 'Dodaj do koszyka' })).toBeVisible();
        });
        await step('read the product', async () => {
            await readPage(page);
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]from=40/);
        });
        await step('open another product', async () => {
            await products.openAnother();
            await expect(page.getByRole('button', { name: 'Dodaj do koszyka' })).toBeVisible();
        });
        await step('read the other product', async () => {
            await readPage(page);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
            await expect(page.getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: /Przejdź do koszyka/ }).click();
            await expect(page).toHaveURL(/\/checkout\/cart/);
        });
    },
});
