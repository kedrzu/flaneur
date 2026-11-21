import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.otto.de/';

/** OTTO behind Kasada: a search, a product, the guest cart. */
export const otto = defineJourney({
    name: 'otto.de',
    vendor: 'Kasada',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'OK' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox', { name: 'Wonach suchst du?' }), 'thermobecher');
            await expect(page).toHaveURL(/\/suche\/thermobecher/);
        });
        await step('open a product', async () => {
            await openLink(page.locator('a[href*="/p/"]').first());
            await expect(page.getByRole('button', { name: 'In den Warenkorb' })).toBeVisible();
        });
        await step('add to cart', async () => {
            await page.getByRole('button', { name: 'In den Warenkorb' }).click();
        });
        await step('open the cart', async () => {
            await page.getByRole('button', { name: 'Zum Warenkorb' }).click();
            await expect(page).toHaveURL(/\/order\/basket/);
        });
    },
});
