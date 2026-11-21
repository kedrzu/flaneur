import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.vinted.pl/';

/**
 * Vinted, behind Cloudflare and DataDome; counted as DataDome, whose challenge the site shows. No guest cart: a search
 * and an item.
 */
export const vinted = defineJourney({
    name: 'vinted.pl',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zgoda na wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('textbox', { name: 'Przedmioty' }), 'plecak');
            await expect(page).toHaveURL(/\/catalog\?.*search_text=/);
        });
        await step('open an item', async () => {
            await page.locator('a[href*="/items/"]').first().click();
            await expect(page).toHaveURL(/\/items\/\d+/);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
    },
});
