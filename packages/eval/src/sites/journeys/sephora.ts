import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.sephora.pl/';

/** Sephora behind Akamai: a search, a product, the guest cart. */
export const sephora = defineJourney({
    name: 'sephora.pl',
    vendor: 'Akamai',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'ZAAKCEPTUJ WSZYSTKIE' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Szukaj' }), 'krem do rąk');
            await expect(page).toHaveURL(/\/wyniki-wyszukiwania\?q=/);
        });
        await step('open a product', async () => {
            await openLink(page.locator('a[href*="/p/"][href*="-P"]').first());
            await expect(page).toHaveURL(/\/p\/.+-P\d+\.html/);
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'Dodaj do koszyka' }).first().click();
            await expect(page.getByRole('heading', { name: 'Dodano do koszyka' })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Zobacz koszyk' }).click();
            await expect(page).toHaveURL(/\/koszyk/);
        });
    },
});
