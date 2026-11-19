import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import type { CdpEvent } from './CdpTypes.js';

/** The answers to a proxy's login challenges for one browser run. */
export interface ProxyAuth {
    /** Starts intercepting at the browser; call it before anything loads, once `observe` gets every event. */
    start(): Promise<void>;
    /** Lets paused requests go on and answers the proxy's challenges; call it with every event. */
    observe(event: CdpEvent): void;
}

/** What the proxy's login needs of its browser run. */
export interface CreateProxyAuthParams {
    /** Sends a CDP command on the run's pipe, before the run is ready too. */
    send: (method: string, params?: object, sessionId?: string) => Promise<unknown>;
    username: string;
    password: string;
    logger: Logger;
}

/**
 * Answers the proxy's login over CDP, as Chrome takes no credentials with `--proxy-server`. `Fetch` on the browser
 * target reaches the requests of every page, frame and worker; Chrome refuses `handleAuthRequests` without a pattern,
 * so every request pauses there and is let go at once. A client's own `Fetch` on a page session still sees and
 * answers that page's requests, and the browser target's events never reach a client, so neither the pages nor the
 * clients can tell. Only the proxy's challenges are answered: a site's own login goes to Chrome's default, and a proxy
 * that refuses the login twice for one request gets it cancelled, not answered in a loop.
 * @__NO_SIDE_EFFECTS__
 */
export function createProxyAuth(params: CreateProxyAuthParams): ProxyAuth {
    const { send, username, password, logger } = params;
    /** Requests whose proxy challenge was answered once already; few, as Chrome reuses an accepted login. */
    const answered = new Set<string>();

    return { start, observe };

    async function start() {
        await send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*' }] });
    }

    function observe(event: CdpEvent) {
        // A client's Fetch runs on a page session; the browser target's are the proxy's own.
        if (event.sessionId != null || !isPlainObject(event.params)) {
            return;
        }
        const requestId = event.params['requestId'];
        if (typeof requestId !== 'string') {
            return;
        }
        switch (event.method) {
            case 'Fetch.requestPaused':
                reply('Fetch.continueRequest', { requestId });
                return;
            case 'Fetch.authRequired':
                reply('Fetch.continueWithAuth', {
                    requestId,
                    authChallengeResponse: answerChallenge(requestId, event.params['authChallenge']),
                });
                break;
        }
    }

    function answerChallenge(requestId: string, challenge: unknown) {
        if (!isPlainObject(challenge) || challenge['source'] !== 'Proxy') {
            return { response: 'Default' };
        }
        if (answered.has(requestId)) {
            answered.delete(requestId);
            logger.warn('The proxy refused its login', { origin: challenge['origin'] });
            return { response: 'CancelAuth' };
        }
        answered.add(requestId);
        return { response: 'ProvideCredentials', username, password };
    }

    function reply(method: string, replyParams: object) {
        // A request can be gone before its answer arrives: its page closed or navigated away.
        send(method, replyParams).catch((error: unknown) =>
            logger.debug('A paused request was gone', { error, method }),
        );
    }
}
