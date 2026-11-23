import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.xcite.com/';

/** How long a product page may keep its cart button disabled while it loads. */
const ENABLED_MS = 5000;

/** Xcite behind Imperva: a search, a product, the guest cart. */
export const xcite = defineJourney({
    name: 'xcite.com',
    vendor: 'Imperva',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox').first(), 'air fryer');
            await expect(page).toHaveURL(/\/search\?q=air/);
        });
        await step('open a product', async () => {
            await clickResult(page.locator('a[href*="/p"]').filter({ hasText: /fryer/i }).first());
            await expect(addToCart(page)).toBeVisible();
        });
        // The product page disables its button once the cart holds 3 of the product (the air fryer, 2026-11-22), and the
        // eval profile's cart keeps them from run to run; the cart then would not take one less either. A person seeing
        // the button greyed out goes to the cart, which already holds the product.
        let cartFull = false;
        await step('add to cart', async () => {
            cartFull = !(await expect(addToCart(page))
                .toBeEnabled({ timeout: ENABLED_MS })
                .then(
                    () => true,
                    () => false,
                ));
            if (!cartFull) {
                await addToCart(page).click();
            }
        });
        await step('open the cart', async () => {
            await (
                cartFull
                    ? page.locator('a[href$="/checkout/cart"]').first()
                    : page.getByRole('button', { name: /^View cart/ })
            ).click();
            await expect(page).toHaveURL(/cart/);
            await expect(page.getByRole('main').getByRole('link', { name: /fryer/i }).first()).toBeVisible();
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

/** The product page's cart button. */
function addToCart(page: Page) {
    return page.getByRole('button', { name: /Add To Cart/i }).first();
}
