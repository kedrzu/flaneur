import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { emptyCart } from '../utils/emptyCart.js';
import { makeRoomInCart } from '../utils/makeRoomInCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.gamestop.com/';

/** How long an add may take to confirm before the cart is looked at. */
const ADDED_MS = 10_000;

/** GameStop behind HUMAN: a search, a product, the guest cart. */
export const gamestop = defineJourney({
    name: 'gamestop.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            // The combobox's label element is empty, so its placeholder is what names it.
            await submitSearch(page.getByPlaceholder('Search games, consoles & more'), 'controller');
            await expect(page).toHaveURL(/\/search-new\/\?q=/);
        });
        await step('open a product', async () => {
            await page.locator('a[href*="/products/"][href$=".html"]').first().click();
            await expect(page).toHaveURL(/\/products\/.+\/\d+\.html/);
        });
        await step(
            'accept cookies',
            async () => {
                // The consent banner covers the bottom of the view, where "Add to Cart" may be after Back.
                await page.getByRole('button', { name: 'Akceptuj' }).click();
            },
            { optional: true },
        );
        // The cart holds 10 items at most; a full one takes no more, and the page says nothing (2026-11-22). The journey
        // empties the cart at its end, but one left full (by an earlier run, or a run that failed) is emptied first: a
        // person whose add shows nothing looks in the cart, takes the items out and adds again.
        let added = false;
        await step('add to cart', async () => {
            await addToCart(page);
            added = await expect(addedHeading(page))
                .toBeVisible({ timeout: ADDED_MS })
                .then(
                    () => true,
                    () => false,
                );
        });
        if (!added) {
            await step('make room in the cart', async () => {
                await makeRoomInCart({
                    cartLink: page.getByRole('link', { name: /\bCart$/ }).first(),
                    cartUrl: /\/cart\//,
                    productUrl: /\/products\/.+\/\d+\.html/,
                });
            });
            await step('add to cart again', async () => {
                await addToCart(page);
                await expect(addedHeading(page)).toBeVisible();
            });
        }
        await step('open the cart', async () => {
            // The confirmation offers a paid protection plan; "No Thanks" declines it and goes to the cart.
            await page.getByRole('button', { name: 'Navigate to Cart and Close Modal' }).click();
            await expect(page).toHaveURL(/\/cart\//);
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
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
}

/** The confirmation of an add, which offers a protection plan. */
function addedHeading(page: Page) {
    return page.getByRole('heading', { name: 'Added to the cart' });
}
