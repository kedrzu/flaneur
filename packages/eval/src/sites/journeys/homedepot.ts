import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.homedepot.com/';

/** The Home Depot behind HUMAN (`_px2`) and Akamai (`_abck`): a search, a hammer, the guest cart. */
export const homedepot = defineJourney({
    name: 'homedepot.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        // The "Added to Cart" drawer is a frame of its own.
        const viewCart = page.locator('#thd-drawer-frame').contentFrame().getByRole('link', { name: 'View Cart' });

        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'What can we help you find today?' }), 'hammer');
            // A query that names a category lands on the category's page.
            await expect(page).toHaveURL(/searchRedirect=hammer|\/s\/hammer/);
        });
        await step('open a product', async () => {
            // The page also holds a hidden "recently viewed" strip of the products earlier runs opened.
            await clickResult(
                page
                    .locator('a[href*="/p/"]')
                    .filter({ hasText: /Hammer/, visible: true })
                    .first(),
            );
            await expect(page).toHaveURL(/\/p\//);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click();
            await expect(viewCart).toBeVisible();
        });
        await step('open the cart', async () => {
            await viewCart.click();
            await expect(page).toHaveURL(/\/cart/);
            await expect(page.getByRole('heading', { name: /CART \([1-9]/ })).toBeVisible();
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
