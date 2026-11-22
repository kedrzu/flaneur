import { setTimeout as sleep } from 'node:timers/promises';

import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { emptyCart } from '../emptyCart.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.leroymerlin.pl/';

/** How long the search field's suggestions take to come up after a click. */
const SUGGESTIONS_MS = 1500;

/** Leroy Merlin behind DataDome (`datadome` cookie): a search, a drill, the guest cart. */
export const leroymerlin = defineAgentBrowserJourney({
    name: 'leroymerlin.pl',
    vendor: 'DataDome',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'Akceptuję wszystkie');
            },
            { optional: true },
        );
        await step('search', async () => {
            const field = { role: 'combobox', name: /^Zacznij wpisywać szukane hasła/ };
            // The field opens its suggestions on focus and drops keys typed while they come up (seen with Playwright),
            // so the click and an agent's next turn come first.
            await ab.click(field);
            await sleep(SUGGESTIONS_MS);
            await submitSearch(ab, field, 'wiertarka');
            await ab.waitForUrl(/\/search\?q=wiertarka/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', name: /Wiertarka/, url: /\/produkty\/.*\.html$/ });
            await ab.findRef({ role: 'button', name: /Dodaj do koszyka/ });
        });
        await step('add to cart', async () => {
            await ab.clickRole('button', 'Dodaj do koszyka');
            await ab.findRef({ role: 'link', name: /Pokaż mój koszyk/ });
        });
        await step('open the cart', async () => {
            await ab.clickRole('link', 'Pokaż mój koszyk');
            await ab.waitForUrl(/\/checkout\/cart/);
            await ab.findRef({ role: 'heading', name: /Koszyk \([1-9]/ });
        });
        // The eval profile keeps its cart from run to run: what the journey added comes out again.
        await step(
            'empty the cart',
            async () => {
                await emptyCart(ab);
            },
            { optional: true },
        );
    },
});
