import { expect } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

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
        let product = '';
        await step('add to cart', async () => {
            // The eval profile's cart keeps earlier runs' items, whose cards show a quantity instead of the button.
            const card = page
                .getByRole('group')
                .filter({ has: page.getByRole('button', { name: 'Add to Cart' }) })
                .first();
            const name = await card.getByRole('heading', { level: 3 }).textContent();
            assert(name, 'A product card has no name');
            product = name.trim();
            await card.getByRole('button', { name: 'Add to Cart' }).click();
            const added = page.getByRole('group').filter({ has: page.getByRole('heading', { name: product }) });
            await expect(added.getByText(/[1-9]\d* in Cart/)).toBeVisible();
        });
        await step('open the cart', async () => {
            // The header's link names the count: "Cart, 1 item".
            await page.getByRole('link', { name: /^Cart, [1-9]/ }).click();
            await expect(page).toHaveURL(/\/CheckoutCart/);
            await expect(page.getByText(product).filter({ visible: true }).first()).toBeVisible();
        });
    },
});
