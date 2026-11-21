import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.google.com/';

/** Google Search, whose `/sorry/` reCAPTCHA page is its challenge: two searches and a second results page. */
export const google = defineJourney({
    name: 'google.com',
    vendor: 'reCAPTCHA',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj wszystko' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'pogoda kraków');
            await expect(page).toHaveURL(/\/search\?q=/);
        });
        await step('search again', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'kubek termiczny');
            await expect(page).toHaveURL(/\/search\?q=kubek/);
        });
        await step('open results page 2', async () => {
            await page.getByRole('link', { name: /^(Strona|Page) 2$/ }).click();
            await expect(page).toHaveURL(/[?&]start=10/);
        });
    },
});
