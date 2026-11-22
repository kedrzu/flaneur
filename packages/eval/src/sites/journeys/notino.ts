import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { makeRoomInCart } from '../utils/makeRoomInCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.notino.pl/';

/** A product page's address. */
const PRODUCT_URL = /\/p-\d+/;

/** How long an add may take to confirm before the cart is looked at. */
const ADDED_MS = 10_000;

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
            await clickResult(page.locator('a[href*="/p-"]').filter({ hasText: /krem/i }).first());
            await expect(page).toHaveURL(PRODUCT_URL);
        });
        // With the cart holding 6 of the cream (315 zł), an add showed nothing (2026-11-22, twice). The journey empties the cart at
        // its end, but one left full (by an earlier run, or a run that failed) is emptied first: a person whose add
        // shows nothing looks in the cart, takes the items out and adds again.
        let added = false;
        await step('add to cart', async () => {
            await addToCart(page);
            added = await expect(goToCart(page))
                .toBeVisible({ timeout: ADDED_MS })
                .then(
                    () => true,
                    () => false,
                );
        });
        if (!added) {
            await step('make room in the cart', async () => {
                await makeRoomInCart({
                    cartLink: page.locator('a[href="/cart/"]').first(),
                    cartUrl: /\/cart/,
                    productUrl: PRODUCT_URL,
                });
            });
            await step('add to cart again', async () => {
                await addToCart(page);
                await expect(goToCart(page)).toBeVisible();
            });
        }
        await step('open the cart', async () => {
            await goToCart(page).click();
            await expect(page).toHaveURL(/\/cart/);
            await expect(page.getByRole('heading', { name: 'Koszyk', level: 1 })).toBeVisible();
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

/** Clicks the product page's cart button. */
async function addToCart(page: Page) {
    await page
        .getByRole('button', { name: /^Dodaj do koszyka - / })
        .first()
        .click();
}

/** The confirmation's link to the cart, which an add shows. */
function goToCart(page: Page) {
    return page.getByRole('link', { name: 'Przejdź do koszyka' });
}
