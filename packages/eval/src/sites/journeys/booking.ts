import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
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
        await step('type the destination', async () => {
            // Booking tries a free-text field ("Szukaj własnymi słowami") on some visits.
            await typeText(page.getByRole('combobox', { name: /Wprowadź miejsce|Szukaj własnymi słowami/ }), 'Kraków');
        });
        await step(
            'pick the suggestion',
            async () => {
                await page
                    .getByRole('option', { name: /^Kraków/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
            await expect(page).toHaveURL(/\/searchresults\.pl\.html/);
        });
        await step(
            'close the map',
            async () => {
                // A landmark's results open beside a map, whose list does not follow a click on a title.
                await page.getByRole('button', { name: 'Zamknij mapę' }).click();
            },
            { optional: true },
        );
        await step(
            'close the date picker',
            async () => {
                // Booking may open its date picker over the results after a search without dates.
                const datePicker = page.getByText('Elastyczne opcje dat');
                await datePicker.waitFor();
                await page.keyboard.press('Escape');
                await expect(datePicker).toBeHidden();
            },
            { optional: true },
        );
        await step('open a hotel', async () => {
            // A result opens in a new tab.
            const hotel = await clickIntoNewTab(page.locator('a[data-testid="title-link"]').first(), step);
            await expect(hotel).toHaveURL(/\/hotel\//);
        });
    },
});
