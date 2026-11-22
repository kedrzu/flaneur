import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickResult } from '../utils/clickResult.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.google.com/';

/** Ordinary queries a person might type in one sitting. */
const QUERIES = [
    'pogoda kraków',
    'przepis na pierogi',
    'godziny otwarcia poczty',
    'kurs euro',
    'najlepsze buty do biegania',
    'rozkład jazdy pkp',
];

/**
 * Google Search, many times in a row: six searches, each with a result opened and left with Back. A `/sorry/` page
 * (reCAPTCHA) on a step tells after how many searches Google stops trusting the browser.
 */
export const googleRepeated = defineJourney({
    name: 'google.com repeated searches',
    vendor: 'reCAPTCHA',
    url: URL,
    tags: ['@long'],
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
        for (const [index, query] of QUERIES.entries()) {
            const search = `search ${index + 1}`;
            await step(search, async () => {
                await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), query);
                await expect(page).toHaveURL(/\/search\?/);
            });
            await step(
                `decline the location prompt after ${search}`,
                async () => {
                    // A local query ("godziny otwarcia poczty") brings a dialog asking for the precise location.
                    await page.getByRole('button', { name: 'Nie teraz' }).click();
                },
                { optional: true },
            );
            await step(`open a result of ${search}`, async () => {
                await clickResult(page.locator('#search a:has(h3)').first());
                await expect(page).not.toHaveURL(/google\.[a-z.]+\/search/);
            });
            await step(`back from the result of ${search}`, async () => {
                // Google's results come back from the back-forward cache, which fires no load event.
                await page.goBack({ waitUntil: 'commit' });
                await expect(page).toHaveURL(/\/search\?/);
            });
        }
    },
});
