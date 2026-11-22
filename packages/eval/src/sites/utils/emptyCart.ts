import { setTimeout as sleep } from 'node:timers/promises';

import type { Page } from 'playwright/test';

/**
 * The names of a cart line's control that takes the product out, on the panel's sites ("Usuń", "Remove", "Aus dem
 * Warenkorb entfernen"). The end of the word is not `\b`, which takes "ń" for a non-word character.
 */
export const REMOVE_FROM_CART =
    /^(usuń|remove|delete|entfernen|löschen|supprimer)(?!\p{L})|^aus dem warenkorb entfernen$/iu;

/** The names of a cart line's control that takes one piece out, used where a line has no remove (H&M, Ocado). */
export const ONE_LESS_IN_CART = /^(zmniejsz|decrease quantity|decrease value)(?!\p{L})/iu;

/** The most clicks one emptying makes: a cart that grew before the journeys emptied it holds about 20 items. */
export const MAX_CART_REMOVALS = 25;

/** How long the cart's page may take to show its lines' controls. */
export const CART_RENDER_MS = 10_000;

/** How long a cart may take to show its controls again after a click reloaded it. */
export const SETTLE_MS = 5000;

/** How long a click may take to change the cart: a line going, a count dropping, a confirmation coming. */
const REMOVAL_MS = 10_000;

/**
 * How long a click may wait: the journey's own action timeout, which an optional step shortens and flaneur's pace may
 * use up after a removal reloads the cart.
 */
const CLICK_MS = 30_000;

/** How often the cart is read again while a click shows. */
const REMOVAL_POLL_MS = 500;

/**
 * Empties the guest cart the journey is on, as a person who only came to look takes out what they put in. The eval
 * profile keeps its cart from run to run, so without this every run adds the same product again until the site's cap
 * for it (GameStop's 10 items, Xcite's 3 of a product, Notino's cream, LEGO's set) or a changed flow breaks the journey.
 * Clicks the last visible remove control (a confirmation the click brings shows its own after the line's), or the last
 * "one less" where no line has a remove, while the page changes after each click, at most `MAX_CART_REMOVALS` times.
 * Never touches the checkout.
 * @util
 */
export async function emptyCart(page: Page) {
    const remove = findControls(page, REMOVE_FROM_CART);
    const oneLess = findControls(page, ONE_LESS_IN_CART);
    const any = remove.or(oneLess);
    const readPage = () => page.locator('body').innerText();
    for (let removal = 0; removal < MAX_CART_REMOVALS; removal++) {
        // The cart may still be rendering, or reloading after the last click.
        const shown = await any
            .first()
            .waitFor({ timeout: removal === 0 ? CART_RENDER_MS : SETTLE_MS })
            .then(
                () => true,
                () => false,
            );
        if (!shown) {
            return;
        }
        const target = (await remove.count()) > 0 ? remove.last() : oneLess.last();
        const before = await readPage();
        await target.click({ timeout: CLICK_MS });
        if (!(await waitForChange(readPage, before))) {
            return;
        }
    }
}

/** The visible, enabled buttons and links of the page named as `name` matches. */
function findControls(page: Page, name: RegExp) {
    return page
        .getByRole('button', { name, disabled: false })
        .or(page.getByRole('link', { name }))
        .filter({ visible: true });
}

/**
 * Whether what `read` reads moves away from `before` within `timeoutMs`, by default the time a click on a cart may
 * take to show.
 * @util
 */
export async function waitForChange<T>(read: () => Promise<T>, before: T, timeoutMs = REMOVAL_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await read()) !== before) {
            return true;
        }
        await sleep(REMOVAL_POLL_MS);
    }
    return false;
}
