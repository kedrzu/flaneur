import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.etsy.com/';

/** Etsy behind DataDome: a search and a listing. */
export const etsy = defineJourney({
    name: 'etsy.com',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie pliki cookie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: /Szukaj|Search/ }).first(), 'kubek ceramiczny');
            await expect(page).toHaveURL(/\/search\?q=/);
        });
        await step('open a listing', async () => {
            // Etsy opens listings in a new tab; the journey stays in one.
            await openLink(page.locator('a[href*="/listing/"]').first());
            await expect(page).toHaveURL(/\/listing\/\d+/);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
    },
});
