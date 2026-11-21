import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.costco.com/';

/**
 * Costco behind Kasada (`KP_UIDz`): a search, an add from the listing, the guest cart. A click on a product card's name
 * landed on a layer of the card that did not navigate (2026-11-21), so the journey adds from the listing.
 */
export const costco = defineJourney({
    name: 'costco.com',
    vendor: 'Kasada',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Search Costco' }), 'paper towels');
            await expect(page).toHaveURL(/\/s\?keyword=paper/);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Add to Cart' }).first().click();
            await expect(page.getByRole('button', { name: 'Remove from Cart' }).first()).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: 'Cart', exact: true }).click();
            await expect(page).toHaveURL(/CheckoutCartDisplayView/);
            await expect(page.getByRole('heading', { name: 'Cart', level: 1 })).toBeVisible();
        });
    },
});
