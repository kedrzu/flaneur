import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.x-kom.pl/';

/** x-kom behind Cloudflare: a search, a product, the guest cart. */
export const xkom = defineJourney({
    name: 'x-kom.pl',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('textbox', { name: 'Czego szukasz?' }), 'mysz bezprzewodowa');
            // A query naming a category may land on the category instead of the results.
            await expect(page.locator('#listing-container a[href*="/p/"]').first()).toBeVisible();
        });
        await step('open a product', async () => {
            await page.locator('#listing-container a[href*="/p/"]').first().click();
            await expect(page).toHaveURL(/\/p\/\d+-/);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
        });
        await step('open the cart', async () => {
            const name = /(Przejdź do|Zobacz) koszyk/i;
            await page.getByRole('link', { name }).or(page.getByRole('button', { name })).first().click();
            await expect(page).toHaveURL(/\/koszyk/);
        });
    },
});
