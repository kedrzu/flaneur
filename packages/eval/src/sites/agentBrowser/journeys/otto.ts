import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { emptyCart } from '../emptyCart.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.otto.de/';

/** OTTO behind Kasada: a search, a product, the guest cart. */
export const otto = defineAgentBrowserJourney({
    name: 'otto.de',
    vendor: 'Kasada',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'OK', { exact: true });
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(ab, { role: 'searchbox', name: /Wonach suchst du\?/ }, 'thermobecher');
            await ab.waitForUrl(/\/suche\/thermobecher/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/p\// });
            await ab.findRef({ role: 'button', name: /In den Warenkorb/ });
        });
        await step('add to cart', async () => {
            await ab.clickRole('button', 'In den Warenkorb');
        });
        await step('open the cart', async () => {
            await ab.clickRole('button', 'Zum Warenkorb');
            await ab.waitForUrl(/\/order\/basket/);
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
