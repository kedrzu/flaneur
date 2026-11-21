import { setTimeout as sleep } from 'node:timers/promises';

import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.leroymerlin.pl/';

/** How long the search field's suggestions take to come up after a click. */
const SUGGESTIONS_MS = 1500;

/** Leroy Merlin behind DataDome (`datadome` cookie): a search, a drill, the guest cart. */
export const leroymerlin = defineJourney({
    name: 'leroymerlin.pl',
    vendor: 'DataDome',
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
            const field = page.getByRole('combobox', { name: /^Zacznij wpisywać szukane hasła/ });
            // Only "wi" of the query arrived once: the field opens its suggestions on focus and drops keys typed while
            // they come up, so a person's wait before typing comes first.
            await field.click();
            await sleep(SUGGESTIONS_MS);
            await submitSearch(field, 'wiertarka');
            await expect(page).toHaveURL(/\/search\?q=wiertarka/);
        });
        await step('open a product', async () => {
            await page
                .locator('a[href*="/produkty/"][href$=".html"]')
                .filter({ hasText: /Wiertarka/ })
                .first()
                .click();
            await expect(page.getByRole('button', { name: 'Dodaj do koszyka' }).first()).toBeVisible();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
            await expect(page.getByRole('link', { name: 'Pokaż mój koszyk' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('link', { name: 'Pokaż mój koszyk' }).click();
            await expect(page).toHaveURL(/\/checkout\/cart/);
            await expect(page.getByRole('heading', { name: /Koszyk \([1-9]/ })).toBeVisible();
        });
    },
});
