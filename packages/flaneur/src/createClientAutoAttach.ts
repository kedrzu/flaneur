import type { Logger } from '@nzyme/logging/Logger.js';

/** A client's browser-level `Target.setAutoAttach`, emulated page by page. */
export interface ClientAutoAttach {
    /** Turns auto-attach on or off; on, settles once the client is attached to every page it sees. */
    set(autoAttach: boolean): Promise<void>;
    /** Attaches the client to a page it sees, once; does nothing while auto-attach is off. Never rejects. */
    attach(targetId: string): Promise<void>;
}

/** What a client's auto-attach attaches and with what. */
export interface CreateClientAutoAttachParams {
    /** The pages the client sees, the one used last first: the order they are announced in. */
    listPages: () => Promise<string[]>;
    /** Attaches the client to a page with a flat session; its `Target.attachedToTarget` reaches the client first. */
    attach: (targetId: string) => Promise<unknown>;
    logger: Logger;
}

/**
 * Creates the auto-attach of one client. Sent to the browser, `Target.setAutoAttach` would attach the client to every
 * target, the proxy's own and other groups' pages too, and the proxy would claim the new sessions as its own; so the
 * proxy attaches the client itself, explicitly, to each page it sees: those there when it is turned on, and each that
 * appears or joins the client's group later. Playwright learns of pages only from these attaches, and fails on a
 * second one of the same page, so a page is attached once; a call while its attach is in flight waits for it. A failed
 * attach (with `--chrome own`, a tab another client drives) is logged and forgotten, so a later call tries again.
 * Frames and workers are not attached here: they come with each page's session-level auto-attach.
 * @__NO_SIDE_EFFECTS__
 */
export function createClientAutoAttach(params: CreateClientAutoAttachParams): ClientAutoAttach {
    const { listPages, attach: attachPage, logger } = params;
    /** Each page's attach, in flight or done. */
    const attaches = new Map<string, Promise<void>>();
    let enabled = false;

    return { set, attach };

    async function set(autoAttach: boolean) {
        enabled = autoAttach;
        if (!autoAttach) {
            return;
        }
        // Started in order, so the pages are announced the one used last first.
        await Promise.all((await listPages()).map(attach));
    }

    function attach(targetId: string) {
        if (!enabled) {
            return Promise.resolve();
        }
        let attaching = attaches.get(targetId);
        if (attaching == null) {
            attaching = attachOnce(targetId);
            attaches.set(targetId, attaching);
        }
        return attaching;
    }

    async function attachOnce(targetId: string) {
        try {
            await attachPage(targetId);
        } catch (error) {
            attaches.delete(targetId);
            logger.debug('A page could not be auto-attached', { targetId, error });
        }
    }
}
