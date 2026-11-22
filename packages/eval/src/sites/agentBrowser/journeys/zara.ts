import { setTimeout as sleep } from 'node:timers/promises';

import type { AgentBrowser } from '../openAgentBrowser.js';
import { defineAgentBrowserJourney } from '../defineAgentBrowserJourney.js';
import { emptyCart } from '../emptyCart.js';
import { submitSearch } from '../submitSearch.js';

const URL = 'https://www.zara.com/pl/pl/';

/** The header's cart link: "Produkty w koszyku: 4. Przejdź do koszyka". */
const CART_LINK = /^Produkty w koszyku: (\d+)/;

/** How long the header's count may take to show the added product. */
const CART_UPDATE_MS = 15_000;

/** Zara behind Akamai: a search, a product in a size, the guest cart. */
export const zara = defineAgentBrowserJourney({
    name: 'zara.com',
    vendor: 'Akamai',
    url: URL,
    run: async (ab, step) => {
        await step('open the home page', async () => {
            await ab.open(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await ab.clickRole('button', 'AKCEPTUJ WSZYSTKIE PLIKI COOKIE');
            },
            { optional: true },
        );
        await step('search', async () => {
            await ab.clickRole('link', 'SZUKAJ', { exact: true });
            await submitSearch(ab, { role: 'combobox', name: /Wprowadzenie tekstu wyszukiwania/ }, 'sweter');
            await ab.waitForUrl(/\/pl\/pl\/search\?searchTerm=/);
        });
        await step('open a product', async () => {
            await ab.scroll('down', 400);
            await ab.click({ role: 'link', url: /-p\d+\.html/ });
            await ab.waitForUrl(/-p\d+\.html/);
        });
        let before = 0;
        await step('add to cart', async () => {
            before = await readCartCount(ab);
            // The button reads "Dodaj", named "Dodaj <product>"; the wishlist's, "Dodaj element do wishlist", leads to the
            // login.
            await ab.click({ role: 'button', name: /^Dodaj (?!element do wishlist)/ });
        });
        await step('choose a size', async () => {
            await ab.click({ role: 'button', name: /^(XS|S|M|L|XL)(-(S|M|L|XL|XXL))?$/ });
            // The "DODANO DO KOSZYKA" dialog may be gone by the next snapshot; the header's count tells the add then.
            const deadline = Date.now() + CART_UPDATE_MS;
            while (!(await isAdded(ab, before))) {
                if (Date.now() > deadline) {
                    throw new Error(`Neither the cart dialog nor a cart count above ${before} after choosing a size`);
                }
                await sleep(1000);
            }
        });
        await step('open the cart', async () => {
            // The dialog's button while it shows; the header's link, which the dialog hides, once it closed.
            const { elements } = await ab.snapshot();
            const dialogButton = elements.find(
                element => element.role === 'button' && /^Zobacz koszyk$/i.test(element.name),
            );
            await ab.click(dialogButton?.ref ?? { role: 'link', name: CART_LINK });
            await ab.waitForUrl(/\/shop\/cart/);
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

/** The number of products the header's cart link says the cart holds; an empty cart's link reads "Pusty koszyk". */
async function readCartCount(ab: AgentBrowser) {
    const { elements } = await ab.snapshot();
    const link = elements.find(element => element.role === 'link' && CART_LINK.test(element.name));
    return Number((link == null ? undefined : CART_LINK.exec(link.name)?.[1]) ?? 0);
}

/** Whether the snapshot shows the add: the cart dialog, or the header counting more than `before`. */
async function isAdded(ab: AgentBrowser, before: number) {
    const { elements } = await ab.snapshot();
    return elements.some(
        element =>
            (element.role === 'heading' && /Dodano do koszyka/i.test(element.name)) ||
            (element.role === 'link' && Number(CART_LINK.exec(element.name)?.[1] ?? 0) > before),
    );
}
