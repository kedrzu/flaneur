import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.amazon.pl/';

/** Amazon's own bot check: a search, a product, the guest cart; any paid add-on offered is declined. */
export const amazon = defineJourney({
    name: 'amazon.pl',
    vendor: 'Amazon',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Szukaj na Amazon.pl' }), 'kubek termiczny');
            await expect(page).toHaveURL(/\/s\?k=/);
        });
        await step('open a product', async () => {
            await page.locator('[data-component-type="s-search-result"] a[href*="/dp/"]').first().click();
            await expect(page).toHaveURL(/\/dp\//);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka', exact: true }).first().click();
        });
        await step(
            'decline add-ons',
            async () => {
                await page
                    .getByRole('button', { name: /Nie, dziękuję/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step('see the cart confirmation', async () => {
            await expect(page.getByRole('heading', { name: /Dodano do koszyka/ }).first()).toBeVisible();
        });
        await step('open the cart', async () => {
            // The header's cart link; a hidden "skip to the cart" link shares its name.
            await page.locator('#nav-cart').click();
            await expect(page).toHaveURL(/\/cart/);
        });
    },
});
