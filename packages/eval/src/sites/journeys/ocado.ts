import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { emptyCart } from '../utils/emptyCart.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.ocado.com/';

/** Ocado behind AWS WAF: a search, one product into the guest trolley, the trolley's quick view. */
export const ocado = defineJourney({
    name: 'ocado.com',
    vendor: 'AWS WAF',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Accept' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('search').getByRole('combobox'), 'semi skimmed milk');
            await expect(page).toHaveURL(/\/search/);
            await expect(addOne(page)).toBeVisible();
        });
        await step('add to trolley', async () => {
            await clickResult(addOne(page));
        });
        await step('open the trolley', async () => {
            // The trolley opens as a quick view over the page; its full page is the checkout, which a journey never enters.
            const trolley = page.getByRole('button', { name: /^Trolley £\d+\.\d+ - Open quick view trolley/ });
            await expect(trolley).not.toHaveAccessibleName(/^Trolley £0\.00/);
            await trolley.click();
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

/**
 * A result's button that puts one more in the trolley: "Add … to trolley", or, for a product the eval profile's trolley
 * already holds from earlier runs, the "Increase quantity of … in trolley" that replaces it.
 */
function addOne(page: Page) {
    return page
        .getByRole('button', { name: /^Add .+ to trolley/ })
        .or(page.getByRole('button', { name: /^Increase quantity of .+ in trolley$/ }))
        .first();
}
