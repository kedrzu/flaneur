import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { makeRoomInCart } from '../utils/makeRoomInCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.lego.com/pl-pl';

/** LEGO behind Cloudflare (with its waiting room): past the age gate, a search, a set, the guest cart. */
export const lego = defineJourney({
    name: 'lego.com',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'pass the age gate',
            async () => {
                // A carousel on the page has a "Dalej" button too.
                await page.locator('[class*="AgeGate"]').getByRole('button', { name: 'Dalej' }).click();
            },
            { optional: true },
        );
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'sokół millennium');
            await expect(page).toHaveURL(/\/search\?q=/);
        });
        await step(
            'decline the survey',
            async () => {
                // A survey invitation may cover the results: an image map whose "no" area sits at its lower right.
                await page.locator('img[alt="Survey invitation background"]').click({ position: { x: 326, y: 291 } });
            },
            { optional: true },
        );
        await step('open a set', async () => {
            await page.locator('a[href*="/product/"]').filter({ hasText: /Sokół/ }).first().click();
            await expect(page).toHaveURL(/\/product\//);
        });
        await step('make room in the cart', async () => {
            // With the cart at the set's limit the set's button reads "Limit został przekroczony", and the first
            // "Dodaj do Koszyka" is a recommendation's (2026-11-22). The journey empties the cart at its end, but one
            // left full (by an earlier run, or a run that failed) is emptied first.
            const limit = page.getByRole('button', { name: 'Limit został przekroczony' }).first();
            await expect(limit.or(page.getByRole('button', { name: 'Dodaj do Koszyka' })).first()).toBeVisible();
            if (await limit.isVisible()) {
                await makeRoomInCart({
                    cartLink: page.getByRole('link', { name: /^Koszyk \d+/ }).first(),
                    cartUrl: /\/cart/,
                    productUrl: /\/product\//,
                });
            }
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do Koszyka' }).first().click();
            await expect(page.getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Zobacz koszyk' }).click();
            await expect(page).toHaveURL(/\/cart/);
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
