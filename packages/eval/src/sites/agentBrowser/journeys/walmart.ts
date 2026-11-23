import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { emptyCart } from '../emptyCart.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.walmart.com/';

/** Walmart behind HUMAN: a search, a product page, an add from the listing, the guest cart. */
export const walmart = defineAgentBrowserJourney({
    name: 'walmart.com',
    vendor: 'HUMAN',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step('search', async () => {
            await submitSearch(ab, { role: 'combobox', name: /^Search$/ }, 'towels');
            await ab.waitForUrl(/\/search\?q=towels/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /\/ip\// });
            await ab.waitForUrl(/\/ip\//);
            await ab.findRef({ role: 'heading' });
        });
        await step('back to the results', async () => {
            await ab.back();
            await ab.waitForUrl(/\/search\?q=towels/);
        });
        await step('add to cart', async () => {
            await ab.click({ role: 'button', name: /^Add to cart - / });
            await ab.findRef({ role: 'button', name: /Cart contains [1-9]/ });
        });
        await step('open the cart', async () => {
            await ab.click({ role: 'button', name: /Cart contains [1-9]/ });
            await ab.waitForUrl(/\/cart/);
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
