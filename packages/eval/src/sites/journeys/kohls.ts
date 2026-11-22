import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.kohls.com/';

/** How long opening the cart may take: the suite's navigation timeout. */
const CART_LOAD_MS = 60_000;

/** Kohl's behind Akamai: a search, a product in a size, the guest cart; never the checkout. */
export const kohls = defineJourney({
    name: 'kohls.com',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'What are you looking for today?' }), 'towels');
            await expect(page).toHaveURL(/\/search\.jsp\?(.*&)?search=towels/);
        });
        await step('open a product', async () => {
            await clickResult(page.locator('a[href*="/product/prd-"]').first());
            await expect(details(page).getByRole('button', { name: 'Add to Cart' })).toBeVisible();
        });
        await step(
            'choose a size',
            async () => {
                await details(page)
                    .getByRole('button', { name: /^Select size (?!.*out of stock)/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            // The page's recommendations carry an "Add to Cart" of their own.
            await details(page).getByRole('button', { name: 'Add to Cart' }).click();
            await expect(page.getByRole('heading', { name: 'Added to Cart for Shipping' })).toBeVisible();
        });
        await step('open the cart', async () => {
            // The cart's page once took over 30 s to commit (2026-11-21), and a click waits for the navigation it starts:
            // it gets as long as a page load.
            await page.getByRole('button', { name: 'View Cart' }).click({ timeout: CART_LOAD_MS });
            await expect(page).toHaveURL(/\/checkout\/shopping_cart\.jsp/);
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

/** The product page's own details: its title, colours, sizes and cart button. */
function details(page: Page) {
    return page.getByRole('region', { name: 'Product details' });
}
