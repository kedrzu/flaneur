/** URL schemes of the web: Chrome's own pages and extensions', this one's included, stay out of flaneur's reach. */
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Whether flaneur may open or see a page at this URL: a web page, or a blank one.
 * @__NO_SIDE_EFFECTS__
 */
export function isWebUrl(url: string) {
    if (url === 'about:blank') {
        return true;
    }
    try {
        return WEB_PROTOCOLS.has(new URL(url).protocol);
    } catch {
        return false;
    }
}
