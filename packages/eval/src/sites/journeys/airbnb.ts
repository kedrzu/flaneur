import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
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
            await openLink(page.locator('a[href*="/rooms/"]').first());
            await expect(page).toHaveURL(/\/rooms\/\d+/);
        });
    },
});
