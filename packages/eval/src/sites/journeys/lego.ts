import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.lego.com/pl-pl';

/** LEGO behind Cloudflare (with its waiting room): past the age gate, a search, a set, the guest cart. */
export const lego = defineJourney({
    name: 'lego.com',
    vendor: 'Cloudflare',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'pass the age gate',
            async () => {
                // A carousel on the page has a "Dalej" button too.
                await page.locator('[class*="AgeGate"]').getByRole('button', { name: 'Dalej' }).click();
            },
            { optional: true },
        );
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'sokół millennium');
            await expect(page).toHaveURL(/\/search\?q=/);
        });
        await step(
            'decline the survey',
            async () => {
                // A survey invitation may cover the results: an image map whose "no" area sits at its lower right.
                await page.locator('img[alt="Survey invitation background"]').click({ position: { x: 326, y: 291 } });
            },
            { optional: true },
        );
        await step('open a set', async () => {
            await page.locator('a[href*="/product/"]').filter({ hasText: /Sokół/ }).first().click();
            await expect(page).toHaveURL(/\/product\//);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do Koszyka' }).first().click();
            await expect(page.getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Zobacz koszyk' }).click();
            await expect(page).toHaveURL(/\/cart/);
            await expect(page.getByRole('heading', { name: /Mój koszyk \([1-9]/ })).toBeVisible();
        });
    },
});
