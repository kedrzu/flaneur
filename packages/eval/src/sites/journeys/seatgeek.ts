import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://seatgeek.com/';

/** SeatGeek behind DataDome (its `tags.js` served first-party): a team from the search, one game. No seats, no tickets. */
export const seatgeek = defineJourney({
    name: 'seatgeek.com',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            // The page's ads hold its load event past the navigation timeout.
            await page.goto(URL, { waitUntil: 'domcontentloaded' });
        });
        await step(
            'close the sign-up offer',
            async () => {
                await page.getByRole('button', { name: 'Close Modal' }).click();
            },
            { optional: true },
        );
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Accept All' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await typeText(page.getByRole('combobox', { name: 'Search or ask anything' }), 'Knicks');
            await page.getByRole('option', { name: 'New York Knicks', exact: true }).click();
            await expect(page).toHaveURL(/\/new-york-knicks-tickets/);
        });
        await step('open a game', async () => {
            // An event opens in a new tab.
            const game = await clickIntoNewTab(
                page.getByRole('link', { name: /Find tickets from .* Knicks/ }).first(),
                step,
            );
            await expect(game).toHaveURL(/\/nba\/\d+/);
            await expect(game.getByRole('heading', { level: 1 })).toContainText('Knicks');
        });
    },
});
