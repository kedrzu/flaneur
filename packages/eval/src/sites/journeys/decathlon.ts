import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.decathlon.pl/';

/** Decathlon behind Cloudflare: a search, a product with no size to pick, the guest cart. */
export const decathlon = defineJourney({
    name: 'decathlon.pl',
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
            await submitSearch(page.getByRole('searchbox', { name: 'Szukaj' }), 'bidon');
            await expect(page).toHaveURL(/\/search\?Ntt=/);
        });
        await step('open a product', async () => {
            await clickResult(page.locator('a[href*="/p/"]').first());
            await expect(page.getByRole('button', { name: 'Dodaj do koszyka' })).toBeVisible();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
            await expect(page.getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: /Przejdź do koszyka/ }).click();
            await expect(page).toHaveURL(/\/checkout\/cart/);
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
