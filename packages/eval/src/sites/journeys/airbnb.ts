import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.airbnb.pl/';

/** Airbnb behind DataDome: a place search and one of its listings. No booking. */
export const airbnb = defineJourney({
    name: 'airbnb.pl',
    vendor: 'DataDome',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Zaakceptuj wszystkie' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await typeText(page.getByRole('searchbox', { name: /Gdzie/ }), 'Zakopane');
            await page
                .getByRole('option', { name: /Zakopane/ })
                .first()
                .click();
            await page.getByRole('button', { name: 'Szukaj' }).first().click();
            await expect(page).toHaveURL(/\/s\/.*Zakopane/);
        });
        await step('open a listing', async () => {
            // The card's link lies under its photos, so a person clicks the photo; Airbnb opens the listing in a new tab.
            const card = page.getByTestId('card-container').first();
            await expect(card.locator('img').first()).toBeVisible();
            const listing = await clickIntoNewTab(card, step);
            await expect(listing).toHaveURL(/\/rooms\/\d+/);
        });
    },
});
