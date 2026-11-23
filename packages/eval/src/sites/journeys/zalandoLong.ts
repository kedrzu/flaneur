import { expect } from 'playwright/test';

import { defineJourney } from '../defineJourney.js';
import { chooseZalandoSize } from '../utils/chooseZalandoSize.js';
import { emptyCart } from '../utils/emptyCart.js';
import { openNextPage } from '../utils/openNextPage.js';
import { openProducts } from '../utils/openProducts.js';
import { readPage } from '../utils/readPage.js';
import { submitSearch } from '../utils/submitSearch.js';

const URL = 'https://www.zalando.pl/';

/**
 * The long Zalando walk (Akamai): a search sorted by price, its second page, two products read (back between them), the
 * second in the guest cart.
 */
export const zalandoLong = defineJourney({
    name: 'zalando.pl long',
    vendor: 'Akamai',
    url: URL,
    tags: ['@long'],
    run: async (page, step) => {
        const products = openProducts(page, 'article a[href$=".html"]');
        const addToCart = page.getByRole('button', { name: 'Dodaj do koszyka' });

        await step('open the home page', async () => {
            await page.goto(URL);
        });
        await step(
            'accept cookies',
            async () => {
                await page
                    .getByRole('button', { name: /^(Zaakceptuj|Akceptuj|Zgadzam się)/ })
                    .first()
                    .click();
            },
            { optional: true },
        );
        await step(
            'close the promotion',
            async () => {
                await page.getByRole('button', { name: 'Zamknij' }).first().click();
            },
            { optional: true },
        );
        await step('search', async () => {
            await submitSearch(page.getByRole('combobox', { name: 'Szukaj' }), 'czapka zimowa');
            await expect(page).toHaveURL(/\/katalog\/|[?&]q=czapka/);
        });
        await step('sort by price', async () => {
            await page.getByRole('button', { name: 'Sortuj' }).click();
            await page.getByText('Najwyższa cena', { exact: true }).click();
            await page.getByRole('button', { name: 'Zapisz filtr Sortuj' }).click();
            await expect(page).toHaveURL(/[?&]order=price/);
        });
        await step('open page 2', async () => {
            await openNextPage(page.getByRole('link', { name: 'następna strona' }), /[?&]p=2/);
        });
        await step('open a product', async () => {
            await products.openFirst();
            await expect(addToCart).toBeVisible();
        });
        await step('read the product', async () => {
            await readPage(page);
        });
        await step('back to the results', async () => {
            await page.goBack();
            await expect(page).toHaveURL(/[?&]p=2/);
        });
        await step('open another product', async () => {
            await products.openAnother();
            await expect(addToCart).toBeVisible();
        });
        await step('read the other product', async () => {
            await readPage(page);
        });
        await step(
            'choose a size',
            async () => {
                await chooseZalandoSize(page);
            },
            { optional: true },
        );
        await step('add to cart', async () => {
            await addToCart.click();
            await expect(page.getByRole('link', { name: /koszyk/i }).filter({ hasText: /[1-9]/ })).toBeVisible();
        });
        await step('open the cart', async () => {
            await page
                .getByRole('link', { name: /koszyk/i })
                .filter({ hasText: /[1-9]/ })
                .click();
            await expect(page.getByRole('heading', { name: /koszyk/i }).first()).toBeVisible();
        });
        // The eval profile keeps its cart from run to run: what the journey added comes out again.
        await step(
            'empty the cart',
            async () => {
                await emptyCart(page);
            },
            { optional: true },
        );
    },
});
