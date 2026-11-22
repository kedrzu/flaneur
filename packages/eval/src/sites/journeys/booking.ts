import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { clickIntoNewTab } from '../utils/clickIntoNewTab.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.booking.com/index.pl.html';

/** How many days ahead the stay starts; within the picker's first two months. */
const STAY_IN_DAYS = 14;
const STAY_NIGHTS = 2;
/** How long the date picker takes to open by itself after a suggestion is picked. */
const PICKER_MS = 3000;

/** Booking.com behind AWS WAF: a city search for two nights and one hotel. No booking. */
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
        await step('pick the dates', async () => {
            // Without dates Booking opens its date picker over the results, where no click a person makes closed it
            // (2026-11-21), so the dates go in the search form, as a person planning a stay sets them.
            const checkIn = page.locator(`[data-date="${formatDate(STAY_IN_DAYS)}"]`);
            // The picker opens by itself after a picked suggestion; else the dates field opens it.
            const opened = await checkIn.waitFor({ timeout: PICKER_MS }).then(
                () => true,
                () => false,
            );
            if (!opened) {
                await page.getByTestId('searchbox-dates-container').click();
            }
            await checkIn.click();
            await page.locator(`[data-date="${formatDate(STAY_IN_DAYS + STAY_NIGHTS)}"]`).click();
        });
        await step('search', async () => {
            await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
            await expect(page).toHaveURL(/\/searchresults\.pl\.html.*checkin=/);
        });
        await step(
            'close the map',
            async () => {
                // A landmark's results open beside a map, whose list does not follow a click on a title.
                await page.getByRole('button', { name: 'Zamknij mapę' }).click();
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

/**
 * The local date `days` from today as `YYYY-MM-DD`, the picker's `data-date`.
 * @__NO_SIDE_EFFECTS__
 */
export function formatDate(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}
