import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { typeText } from '../utils/typeText.js';

const URL = 'https://www.hertz.com/';

/**
 * Hertz behind Imperva (`visid_incap`, `reese84`): the rental locations page and a city's locations. No booking. A
 * location's own page answered "We took a wrong turn" (2026-11-21), so the journey stops at the results.
 */
export const hertz = defineJourney({
    name: 'hertz.com',
    vendor: 'Imperva',
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
        await step('open the locations', async () => {
            await page.getByRole('button', { name: 'Menu' }).click();
            await page.getByRole('link', { name: 'Punkty wynajmu' }).first().click();
            await expect(page).toHaveURL(/\/rentacar\/location/);
        });
        await step('search a city', async () => {
            await typeText(page.getByRole('textbox', { name: /^wpisz nazwę punktu/ }), 'Kraków');
            await page.getByRole('button', { name: 'Szukaj punktu' }).click();
            await expect(page.getByRole('heading', { name: 'Location Results for Kraków' })).toBeVisible();
        });
    },
});
