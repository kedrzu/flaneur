import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { openLink } from '../utils/openLink.js';

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
            await page.goto(flightsUrl(new Date()), { referer: page.url() });
            await expect(page.getByText(/\d\s?zł/).first()).toBeVisible({ timeout: 60_000 });
        });
        await step('open a result', async () => {
            await openLink(page.locator('a[href*="/transport/loty/"][href*="/config/"]').first());
            await expect(page.getByText(/\d\s?zł/).first()).toBeVisible({ timeout: 60_000 });
        });
    },
});

/** A return flight from Warsaw to London, out in 3 weeks and back 4 days later. */
function flightsUrl(today: Date) {
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
