/** The HTTP proxy every request of the browser goes through, e.g. a VPN tunnel's (`startVpnTunnel`). */
export interface StealthBrowserProxy {
    /** `http://<host>:<port>`. Loopback addresses still bypass it, as Chrome does by default. */
    server: string;
    /**
     * The proxy's login, answered to its challenges over CDP: Chrome takes no credentials on its command line. Both or
     * neither.
     */
    username?: string;
    password?: string;
}
