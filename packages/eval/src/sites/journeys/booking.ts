import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.booking.com/index.pl.html';

/** Booking.com behind AWS WAF: a city search and one hotel. No booking. */
export const booking = defineJourney({
    name: 'booking.com',
    vendor: 'AWS WAF',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj' }).click();
            },
            { optional: true },
        );
        await step(
            'close the login prompt',
            async () => {
                await page
                    .getByRole('button', { name: /Zamknij|Odrzuć informacje o logowaniu/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                await page.getByRole('button', { name: 'Close sheet' }).click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await typeText(page.getByRole('combobox', { name: /Wprowadź miejsce/ }), 'Kraków');
            await page
                .getByRole('option', { name: /^Kraków/ })
                .first()
                .click();
            await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
            await expect(page).toHaveURL(/\/searchresults\.pl\.html/);
        });
        await step('open a hotel', async () => {
            // A result opens in a new tab; the journey stays in its own.
            await openLink(page.locator('a[data-testid="title-link"]').first());
            await expect(page).toHaveURL(/\/hotel\//);
        });
    },
});
