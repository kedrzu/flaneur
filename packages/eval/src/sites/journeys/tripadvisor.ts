import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickFollowingTab } from '../utils/clickFollowingTab.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.tripadvisor.com/';

/** Tripadvisor behind DataDome: a destination search and one of its results. */
export const tripadvisor = defineJourney({
    name: 'tripadvisor.com',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'I Accept' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('searchbox').first(), 'Krakow');
            // A query naming a place lands on the place's page, any other on the search results.
            await expect(page).toHaveURL(/\/(Tourism-|Search\?)/);
        });
        await step('open a result', async () => {
            // A result opens in a new tab in one layout and in the same tab in another.
            const result = await clickFollowingTab(
                page
                    .locator(
                        'a[href*="/Attraction_Review-"], a[href*="/Hotel_Review-"], a[href*="/Restaurant_Review-"]',
                    )
                    .first(),
                step,
            );
            await expect(result).toHaveURL(/\/(Attraction|Hotel|Restaurant)_Review-/);
            await expect(result.getByRole('heading', { level: 1 }).first()).toBeVisible();
        });
    },
});
