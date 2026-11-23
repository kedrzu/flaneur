import type { Page } from 'playwright/test';

/**
 * Picks the first size in stock on a Zalando product page, as a person does before adding it to the cart. A one-size
 * product shows its size as text and has no picker; the caller runs this as an optional step for that layout.
 * @util
 */
export async function chooseZalandoSize(page: Page) {
    await page.getByRole('button', { name: /Wybierz rozmiar/ }).click();
    // A size out of stock offers a reminder instead.
    await page
        .getByRole('listitem')
        .filter({ has: page.getByRole('checkbox') })
        .filter({ hasNotText: /przypomnienie/i })
        .first()
        .click();
}
