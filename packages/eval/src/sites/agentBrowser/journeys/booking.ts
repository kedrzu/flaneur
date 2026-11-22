import { formatDate } from '../../journeys/booking.js';
import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';

const URL = 'https://www.booking.com/index.pl.html';

/** How many days ahead the stay starts; within the picker's first two months. */
const STAY_IN_DAYS = 14;
const STAY_NIGHTS = 2;
/** How long the date picker takes to open by itself after a suggestion is picked. */
const PICKER_MS = 3000;

/** Booking.com behind AWS WAF: a city search for two nights and one hotel. No booking. */
export const booking = defineAgentBrowserJourney({
    name: 'booking.com',
    vendor: 'AWS WAF',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'Akceptuj');
            },
            { optional: true },
        );
        await step(
            'close the login prompt',
            async () => {
                await ab.click({ role: 'button', name: /Zamknij|Odrzuć informacje o logowaniu/ });
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                await ab.clickRole('button', 'Close sheet');
            },
            { optional: true },
        );
        await step('type the destination', async () => {
            // Booking tries a free-text field ("Szukaj własnymi słowami") on some visits.
            await ab.fill(
                await ab.findRef({ role: 'combobox', name: /Wprowadź miejsce|Szukaj własnymi słowami/ }),
                'Kraków',
            );
        });
        await step(
            'pick the suggestion',
            async () => {
                await ab.click({ role: 'option', name: /^Kraków/ });
            },
            { optional: true },
        );
        await step('pick the dates', async () => {
            // The days carry no name a snapshot tells apart reliably; their `data-date` does, as a CSS selector.
            const checkIn = `[data-date="${formatDate(STAY_IN_DAYS)}"]`;
            // The picker opens by itself after a picked suggestion; else the dates field opens it.
            const opened = await ab
                .withActionTimeout(PICKER_MS, () => ab.click(checkIn))
                .then(
                    () => true,
                    () => false,
                );
            if (!opened) {
                await ab.click('[data-testid="searchbox-dates-container"]');
                await ab.click(checkIn);
            }
            await ab.click(`[data-date="${formatDate(STAY_IN_DAYS + STAY_NIGHTS)}"]`);
        });
        await step('search', async () => {
            await ab.clickRole('button', 'Szukaj', { exact: true });
            await ab.waitForUrl(/\/searchresults\.pl\.html.*checkin=/);
        });
        await step(
            'close the map',
            async () => {
                // A landmark's results open beside a map, whose list does not follow a click on a title.
                await ab.clickRole('button', 'Zamknij mapę');
            },
            { optional: true },
        );
        await step('open a hotel', async () => {
            await ab.scroll('down', 400);
            // A result opens in a new tab, which agent-browser moves to.
            await ab.click({ role: 'link', url: /\/hotel\// });
            await ab.waitForUrl(/\/hotel\//);
        });
    },
});
