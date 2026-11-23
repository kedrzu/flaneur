import { setTimeout as sleep } from 'node:timers/promises';

import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { emptyCart } from '../emptyCart.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.sephora.pl/';

/** How long the cart dialog takes to slide in: a click on its button while it moved went nowhere (2026-11-21). */
const DIALOG_MS = 1500;

/** Sephora behind Akamai: a search, a product, the guest cart. */
export const sephora = defineAgentBrowserJourney({
    name: 'sephora.pl',
    vendor: 'Akamai',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'ZAAKCEPTUJ WSZYSTKIE');
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(ab, { role: 'searchbox', name: /^Szukaj$/ }, 'krem do rąk');
            await ab.waitForUrl(/\/wyniki-wyszukiwania\?q=/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            // The header's menus link products too.
            await ab.click({ role: 'link', url: /\/p\/.+\.html/, within: 'main' });
            await ab.waitForUrl(/\/p\/.+\.html/);
        });
        await step('add to cart', async () => {
            await ab.click({ role: 'button', name: /Dodaj do koszyka/ });
            await ab.findRef({ role: 'heading', name: /Dodano do koszyka/ });
        });
        await step('open the cart', async () => {
            await sleep(DIALOG_MS);
            await ab.click({ role: 'button', name: /^Zobacz koszyk$/ });
            await ab.waitForUrl(/\/koszyk/);
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
