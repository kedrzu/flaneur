import { flightsUrl } from '../../journeys/skyscanner.js';
import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';

const URL = 'https://www.skyscanner.pl/';

/** A result card's link: "Opcja 3: …"; an ad's reads "Opcja 1: Reklama …" and opens the airline's site. */
const RESULT_CARD = /^Opcja (\d+): (?!Reklama)/;

/** Skyscanner behind HUMAN: the home page, then the results of a Warsaw–London return flight a few weeks ahead. */
export const skyscanner = defineAgentBrowserJourney({
    name: 'skyscanner.pl',
    vendor: 'HUMAN',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'Akceptuj wszystkie');
            },
            { optional: true },
        );
        await step(
            'close the login prompt',
            async () => {
                await ab.clickRole('button', 'Zamknij okno dialogowe');
            },
            { optional: true },
        );
        let option = '';
        await step('search flights', async () => {
            // A typed navigation, as a person opens a saved search: filling the form's date pickers is not what the
            // journey measures, and the results page is where HUMAN has challenged.
            await ab.open(flightsUrl(new Date()));
            const card = await ab.findElement({ role: 'link', name: RESULT_CARD });
            option = RESULT_CARD.exec(card.name)?.[1] ?? '';
        });
        await step(
            'close the price alert prompt',
            async () => {
                await ab.clickRole('button', 'Zamknij okno dialogowe');
            },
            { optional: true },
        );
        await step('open a result', async () => {
            await ab.scroll('down', 300);
            // A card opens with its "Wybierz" button.
            await ab.click({ role: 'button', name: new RegExp(`^Wybierz opcję lotu ${option}$`) });
            await ab.waitForUrl(/\/(config|itinerary)\//);
        });
    },
});
