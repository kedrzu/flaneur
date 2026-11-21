import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.kohls.com/';

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
            await page.locator('a[href*="/product/prd-"]').first().click();
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
            await page.getByRole('button', { name: 'View Cart' }).click();
            await expect(page).toHaveURL(/\/checkout\/shopping_cart\.jsp/);
        });
    },
});

/** The product page's own details: its title, colours, sizes and cart button. */
function details(page: Page) {
    return page.getByRole('region', { name: 'Product details' });
}
