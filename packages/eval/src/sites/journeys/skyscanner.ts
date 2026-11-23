import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';

const URL = 'https://www.skyscanner.pl/';

/** Skyscanner behind HUMAN: the home page, then the results of a Warsaw–London return flight a few weeks ahead. */
export const skyscanner = defineJourney({
    name: 'skyscanner.pl',
    vendor: 'HUMAN',
    url: URL,
    run: async (page, step) => {
        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page.getByRole('button', { name: 'Akceptuj wszystkie' }).click();
            },
            { optional: true },
        );
        await step(
            'close the login prompt',
            async () => {
                await page.getByRole('button', { name: 'Zamknij okno dialogowe' }).click();
            },
            { optional: true },
        );
        await step('search flights', async () => {
            // A typed navigation, as a person opens a saved search: filling the form's date pickers is not what the
            // journey measures, and the results page is where HUMAN has challenged.
            await page.goto(flightsUrl(new Date()));
            await expect(page.getByText(/\d\s?zł/).first()).toBeVisible({ timeout: 60_000 });
        });
        await step(
            'close the price alert prompt',
            async () => {
                await page.getByRole('button', { name: 'Zamknij okno dialogowe' }).click();
            },
            { optional: true },
        );
        await step('open a result', async () => {
            // A result is a card whose "Sprawdź" button opens it; an ad's opens the airline's site in a new window.
            await page
                .getByRole('link', { name: /^Opcja \d+: (?!Reklama)/ })
                .first()
                .getByRole('button', { name: /^Wybierz opcję lotu \d+$/ })
                .click();
            await expect(page).toHaveURL(/\/(config|itinerary)\//);
            await expect(page.getByText(/\d\s?zł/).first()).toBeVisible({ timeout: 60_000 });
        });
    },
});

/**
 * The results of a return flight from Warsaw to London, out in 3 weeks and back 4 days later.
 * @__NO_SIDE_EFFECTS__
 */
export function flightsUrl(today: Date) {
    const out = daysAfter(today, 21);
    return `${URL}transport/loty/waw/lond/${formatDay(out)}/${formatDay(daysAfter(out, 4))}/?adultsv2=1&cabinclass=economy`;
}

function daysAfter(date: Date, days: number) {
    const after = new Date(date);
    after.setDate(after.getDate() + days);
    return after;
}

/** The date as Skyscanner's URLs carry it: `yyMMdd`. */
function formatDay(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}
