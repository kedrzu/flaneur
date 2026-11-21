import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openProducts } from '../utils/openProducts.js';
import { readPage } from '../utils/readPage.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.otto.de/';

/**
 * The long OTTO walk (Kasada): a search sorted by rating, its second page, two products read (back between them), the
 * second in the guest cart.
 */
export const ottoLong = defineJourney({
    name: 'otto.de long',
    vendor: 'Kasada',
    url: URL,
    tags: ['@long'],
    run: async (page, step) => {
        const products = openProducts(page, 'a[href*="/p/"]');
        const addToCart = page.getByRole('button', { name: 'In den Warenkorb' });

        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'OK' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Wonach suchst du?' }), 'thermobecher');
            await expect(page).toHaveURL(/\/suche\/thermobecher/);
        });
        await step('sort by rating', async () => {
            await page.getByRole('combobox', { name: 'Sortieren nach:' }).selectOption({ label: 'Bewertungen' });
            await expect(page).toHaveURL(/sortiertnach=bewertung/);
        });
        await step('open page 2', async () => {
            await page.getByRole('button', { name: '2', exact: true }).filter({ visible: true }).first().click();
            // OTTO's paging counts products: the second page starts at the 120th.
            await expect(page).toHaveURL(/[?&]o=120/);
        });
        await step('open a product', async () => {
            await products.openFirst();
            await expect(addToCart).toBeVisible();
        });
        await step('read the product', async () => {
            await readPage(page);
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]o=120/);
        });
        await step('open another product', async () => {
            await products.openAnother();
            await expect(addToCart).toBeVisible();
        });
        await step('read the other product', async () => {
            await readPage(page);
        });
        await step('add to cart', async () => {
            await addToCart.click();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Zum Warenkorb' }).click();
            await expect(page).toHaveURL(/\/order\/basket/);
        });
    },
});
