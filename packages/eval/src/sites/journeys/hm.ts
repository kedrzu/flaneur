import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www2.hm.com/pl_pl/index.html';

/** H&M behind Akamai (`_abck`, its `/akam/` script): a search, a sweater in a size, the guest cart. */
export const hm = defineJourney({
    name: 'hm.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.locator('#banner-accept-btn').click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await page.getByRole('button', { name: 'SZUKAJ' }).click();
            await submitSearch(page.getByRole('searchbox', { name: /^Pasek wyszukiwania/ }), 'sweter');
            await expect(page).toHaveURL(/\/search-results\.html\?q=sweter/);
        });
        await step(
            'accept cookies on the results',
            async () => {
                await page.locator('#banner-accept-btn').click();
            },
            { optional: true },
        );
        await step('open a product', async () => {
            await clickResult(
                page
                    .locator('a[href*="/productpage."]')
                    .filter({ hasText: /sweter/i })
                    .first(),
            );
            await expect(page).toHaveURL(/\/productpage\.\d+\.html/);
        });
        await step('choose a size', async () => {
            const size = page.getByRole('radio', { name: /^Rozmiar .*: Dostępny/ }).first();
            await size.click();
            await expect(size).toBeChecked();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
            await expect(page.getByRole('button', { name: /ZOBACZ KOSZYK \([1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: /ZOBACZ KOSZYK \([1-9]/ }).click();
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
