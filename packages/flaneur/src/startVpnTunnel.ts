import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitFor } from '@nzyme/utils/waitFor.js';

import { readGluetunError } from './readGluetunError.js';
import { DockerTimeoutError, runDocker } from './runDocker.js';
import type { DockerOutput, RunDockerParams } from './runDocker.js';
import type { StealthBrowserProxy } from './StealthBrowserProxy.js';

/** Which VPN, where, and with whose login. */
export interface StartVpnTunnelOptions {
    /** gluetun's `VPN_SERVICE_PROVIDER`, e.g. `private internet access`. */
    provider: string;
    /** A server region of the provider (gluetun's `SERVER_REGIONS`), e.g. `US Texas`. */
    region: string;
    /** The VPN account's OpenVPN login. */
    credentials: VpnCredentials;
    logger?: Logger;
}

/** A VPN account's OpenVPN login. */
export interface VpnCredentials {
    username: string;
    password: string;
}

/** A running VPN tunnel: an HTTP proxy on `127.0.0.1` whose traffic leaves through the VPN. */
export interface VpnTunnel {
    /** For `launchStealthBrowser`; its login is random, made for this tunnel. */
    proxy: StealthBrowserProxy;
    /** The address sites see. */
    publicIp: string;
    /**
     * Where ipinfo's database, asked from inside the tunnel, places `publicIp`. A site's own database may differ (a `US
     * Kansas` server was placed in Texas), so confirm the location with the site itself.
     */
    ipGeolocation: VpnGeolocation;
    /** Removes the container. Safe to call twice. */
    close(): Promise<void>;
}

/** A place as ipinfo names it. */
export interface VpnGeolocation {
    country: string;
    region: string;
    city: string;
}

/** gluetun, pinned by its manifest-list digest: a tag can be pushed again. */
const GLUETUN_IMAGE = 'qmcgaw/gluetun:v3.41.3@sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027';
/** The label naming the PID of the process a container belongs to. */
const OWNER_LABEL = 'flaneur.vpn.owner';
const PROXY_PORT = 8888;
const CONTROL_PORT = 8000;
const PULL_TIMEOUT_MS = 5 * 60_000;
const UPDATE_TIMEOUT_MS = 3 * 60_000;
const SERVER_LIST_MAX_AGE_MINUTES = 24 * 60;
/** How long a new tunnel may take to connect and learn its public address. */
const START_TIMEOUT_MS = 90_000;
const POLL_MS = 500;
/** How many of gluetun's last OpenVPN lines explain a tunnel that never came up. */
const OPENVPN_LINES = 5;

/**
 * Starts a VPN tunnel in a gluetun container. Only what is sent through its proxy uses the VPN: the host's own network
 * and DNS stay as they are, so a failing tunnel cannot take the computer offline. Ports are published on `127.0.0.1`
 * only, the proxy and gluetun's control server each behind a random secret.
 *
 * The VPN login reaches gluetun as its secret files, a read-only mount of a folder only this user can read, deleted
 * once the tunnel is up: never on a command line, nor in the container's environment, which `docker inspect` shows.
 * gluetun's own server list goes stale (dead server addresses), so a fresh one is kept in a Docker volume per provider
 * and renewed once a day, one refresh at a time across processes. Each container is labelled with this process's PID,
 * and a start removes the containers of processes that are gone, so a tunnel killed with its process does not outlive
 * the next start. The first start pulls the image and refreshes the list: a minute or more.
 */
export async function startVpnTunnel(options: StartVpnTunnelOptions): Promise<VpnTunnel> {
    const logger = options.logger ?? createLogger('VpnTunnel');
    const region = options.region.trim();
    const key = toNamePart(region);
    if (key === '') {
        throw new Error(`Not a VPN region: "${options.region}"`);
    }
    const volume = `flaneur-vpn-servers-${toNamePart(options.provider)}`;

    await removeOrphans();
    await ensureImage();
    await ensureServerList();

    const name = `flaneur-vpn-${process.pid}-${key}-${randomHex(3)}`;
    const proxyLogin = { username: `flaneur-${randomHex(6)}`, password: randomHex(24) };
    const apiKey = randomHex(24);
    const secrets = [options.credentials.username, options.credentials.password, proxyLogin.password, apiKey];
    const secretsDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-vpn-'));
    logger.info('Starting the VPN tunnel', { provider: options.provider, region });
    try {
        await writeFile(path.join(secretsDir, 'openvpn_user'), options.credentials.username, { mode: 0o600 });
        await writeFile(path.join(secretsDir, 'openvpn_password'), options.credentials.password, { mode: 0o600 });
        const env = {
            VPN_SERVICE_PROVIDER: options.provider,
            SERVER_REGIONS: region,
            HTTPPROXY: 'on',
            HTTPPROXY_USER: proxyLogin.username,
            HTTPPROXY_PASSWORD: proxyLogin.password,
            HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE: JSON.stringify({ auth: 'apikey', apikey: apiKey }),
        };
        await docker({
            args: [
                'run',
                '-d',
                '--name',
                name,
                '--label',
                `${OWNER_LABEL}=${process.pid}`,
                '--cap-add',
                'NET_ADMIN',
                '--device',
                '/dev/net/tun',
                '-p',
                `127.0.0.1::${PROXY_PORT}`,
                '-p',
                `127.0.0.1::${CONTROL_PORT}`,
                '-v',
                `${volume}:/gluetun`,
                '--mount',
                `type=bind,source=${secretsDir},target=/run/secrets,readonly`,
                ...Object.keys(env).flatMap(variable => ['-e', variable]),
                GLUETUN_IMAGE,
            ],
            env,
        });
    } catch (error) {
        await rm(secretsDir, { recursive: true, force: true });
        throw error;
    }

    let closing: Promise<void> | undefined;
    try {
        const deadline = Date.now() + START_TIMEOUT_MS;
        const ports = await waitHealthy(deadline);
        const location = await waitPublicIp(ports.control, deadline);
        const { country, city } = location.ipGeolocation;
        logger.info('The VPN tunnel is up', { region, publicIp: location.publicIp, country, city });
        return { proxy: { server: `http://127.0.0.1:${ports.proxy}`, ...proxyLogin }, ...location, close };
    } catch (error) {
        await close();
        throw error;
    } finally {
        // gluetun reads its settings once, at its start.
        await rm(secretsDir, { recursive: true, force: true });
    }

    function close() {
        closing ??= removeContainers([name]).catch((error: unknown) =>
            logger.warn('The VPN container could not be removed', { error, name }),
        );
        return closing;
    }

    /** Waits for gluetun's healthcheck and returns its published ports; fails with its reason once it stopped. */
    async function waitHealthy(deadline: number) {
        for (;;) {
            const state = await inspect();
            if (state == null) {
                throw new Error(`The VPN container for "${region}" disappeared while starting`);
            }
            // A container publishes its ports only while it runs.
            if (state.running && state.health === 'healthy') {
                return {
                    proxy: readHostPort(state.ports, PROXY_PORT),
                    control: readHostPort(state.ports, CONTROL_PORT),
                };
            }
            if (!state.running) {
                const reason = readGluetunError(await readLogs(), region);
                throw new Error(
                    `The VPN tunnel for "${region}" stopped while starting: ${reason == null ? `exit code ${state.exitCode}` : redact(reason)}`,
                );
            }
            if (Date.now() >= deadline) {
                const lines = (await readLogs())
                    .split('\n')
                    .filter(line => line.includes('[openvpn]'))
                    .slice(-OPENVPN_LINES)
                    .map(line => redact(line.trim()));
                throw new Error(
                    `The VPN tunnel for "${region}" did not connect in ${START_TIMEOUT_MS / 1000} s` +
                        (lines.length > 0 ? `; OpenVPN said last:\n${lines.join('\n')}` : ''),
                );
            }
            await waitFor(POLL_MS);
        }
    }

    /** gluetun reports healthy before it knows its public address, so a new tunnel waits for that too. */
    async function waitPublicIp(controlPort: number, deadline: number) {
        for (;;) {
            const response = await fetch(`http://127.0.0.1:${controlPort}/v1/publicip/ip`, {
                headers: { 'X-API-Key': apiKey },
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                throw new Error(`gluetun's control server answered ${response.status} for the public address`);
            }
            const location = readPublicIp(await response.json());
            if (location != null) {
                return location;
            }
            if (Date.now() >= deadline) {
                throw new Error(`The VPN tunnel for "${region}" is up, but gluetun did not learn its public address`);
            }
            await waitFor(POLL_MS);
        }
    }

    async function inspect() {
        const output = await runDocker({
            args: [
                'inspect',
                '--type',
                'container',
                '--format',
                '{{json .State}}\t{{json .NetworkSettings.Ports}}',
                name,
            ],
        });
        if (output.exitCode !== 0) {
            if (/no such (container|object)/i.test(output.stderr)) {
                return null;
            }
            throw dockerError('inspect', output);
        }
        const [state, ports] = output.stdout.trim().split('\t');
        return readContainerState(JSON.parse(state ?? 'null'), JSON.parse(ports ?? 'null'));
    }

    /** stdout and stderr together: gluetun writes to both. */
    async function readLogs() {
        const output = await docker({ args: ['logs', '--tail', '500', name] });
        return `${output.stdout}\n${output.stderr}`;
    }

    /** Hides every secret of this start: gluetun's log can echo the logins. */
    function redact(text: string) {
        let redacted = text;
        for (const secret of secrets) {
            if (secret !== '') {
                redacted = redacted.split(secret).join('[redacted]');
            }
        }
        return redacted;
    }

    /** Removes the containers of processes that are gone; best effort, as it only tidies up. */
    async function removeOrphans() {
        try {
            const output = await docker({
                args: [
                    'ps',
                    '-a',
                    '--filter',
                    `label=${OWNER_LABEL}`,
                    '--format',
                    `{{.Names}}\t{{.Label "${OWNER_LABEL}"}}`,
                ],
            });
            const orphans: string[] = [];
            for (const line of output.stdout.split('\n')) {
                const [container, pid] = line.trim().split('\t');
                if (container != null && container !== '' && !isProcessAlive(Number(pid))) {
                    orphans.push(container);
                }
            }
            if (orphans.length > 0) {
                await removeContainers(orphans);
                logger.info('Removed VPN containers left behind', { count: orphans.length });
            }
        } catch (error) {
            logger.warn('Looking for VPN containers left behind failed', { error });
        }
    }

    async function ensureImage() {
        const output = await runDocker({ args: ['image', 'inspect', '--format', '{{.Id}}', GLUETUN_IMAGE] });
        if (output.exitCode === 0) {
            return;
        }
        logger.info('Pulling the VPN image', { image: GLUETUN_IMAGE });
        await docker({ args: ['pull', '--quiet', GLUETUN_IMAGE], timeoutMs: PULL_TIMEOUT_MS });
    }

    /**
     * Refreshes the provider's server list in the volume when it is missing or a day old. The refreshing container has a
     * fixed name, so a second process starting one meanwhile is refused and waits for the first one's result instead.
     */
    async function ensureServerList() {
        const updater = `flaneur-vpn-servers-update-${toNamePart(options.provider)}`;
        for (let attempt = 0; !(await isServerListFresh()); attempt++) {
            if (attempt === 3) {
                throw new Error(`The ${options.provider} server list could not be refreshed`);
            }
            logger.info('Refreshing the VPN server list', { provider: options.provider });
            let output: DockerOutput;
            try {
                output = await runDocker({
                    args: [
                        'run',
                        '--rm',
                        '--name',
                        updater,
                        '--label',
                        `${OWNER_LABEL}=${process.pid}`,
                        '-v',
                        `${volume}:/gluetun`,
                        GLUETUN_IMAGE,
                        'update',
                        '-enduser',
                        '-providers',
                        options.provider,
                    ],
                    timeoutMs: UPDATE_TIMEOUT_MS,
                });
            } catch (error) {
                if (error instanceof DockerTimeoutError) {
                    await removeContainers([updater]);
                }
                throw error;
            }
            if (output.exitCode === 0) {
                return;
            }
            if (!/already in use|Conflict/i.test(output.stderr)) {
                const reason = readGluetunError(`${output.stdout}\n${output.stderr}`) ?? output.stderr.trim();
                throw new Error(`Refreshing the ${options.provider} server list failed: ${reason}`);
            }
            logger.info('Waiting for another process refreshing the VPN server list', { provider: options.provider });
            await runDocker({ args: ['wait', updater], timeoutMs: UPDATE_TIMEOUT_MS });
        }
    }

    /** Whether `servers.json` is in the volume and younger than a day, by the container's clock. */
    async function isServerListFresh() {
        const output = await docker({
            args: [
                'run',
                '--rm',
                '--label',
                `${OWNER_LABEL}=${process.pid}`,
                '-v',
                `${volume}:/gluetun`,
                '--entrypoint',
                'sh',
                GLUETUN_IMAGE,
                '-c',
                `test -n "$(find /gluetun/servers.json -mmin -${SERVER_LIST_MAX_AGE_MINUTES} 2>/dev/null)"`,
            ],
            timeoutMs: 60_000,
            allowExitCodes: [1],
        });
        return output.exitCode === 0;
    }
}

/** A `docker` call that must succeed: exit code 0, or one of `allowExitCodes`. */
interface DockerCallParams extends RunDockerParams {
    allowExitCodes?: number[];
}

async function docker(params: DockerCallParams) {
    const output = await runDocker(params);
    if (output.exitCode !== 0 && !params.allowExitCodes?.includes(output.exitCode)) {
        throw dockerError(params.args[0], output);
    }
    return output;
}

/** Removes containers; one already gone, or going, is what was wanted. */
async function removeContainers(names: string[]) {
    const output = await runDocker({ args: ['rm', '-f', ...names] });
    const unexpected = output.stderr
        .split('\n')
        .filter(line => line.trim() !== '' && !/no such container|already in progress/i.test(line));
    if (output.exitCode !== 0 && (unexpected.length > 0 || output.stderr.trim() === '')) {
        throw dockerError('rm', output);
    }
}

/** Names the subcommand only: the rest of the command line may hold a region or a path, never needed to act. */
function dockerError(subcommand: string | undefined, output: DockerOutput) {
    const reason = output.stderr.trim().split('\n')[0] ?? '';
    return new Error(`docker ${subcommand} failed: ${reason === '' ? `exit code ${output.exitCode}` : reason}`);
}

/** The container's state and its published ports, unread, as `docker inspect` reports them. */
function readContainerState(state: unknown, ports: unknown) {
    if (!isPlainObject(state)) {
        throw new Error('docker inspect gave no container state');
    }
    const health = isPlainObject(state['Health']) ? state['Health']['Status'] : undefined;
    return {
        running: state['Running'] === true,
        exitCode: typeof state['ExitCode'] === 'number' ? state['ExitCode'] : -1,
        health: typeof health === 'string' ? health : undefined,
        ports,
    };
}

function readHostPort(ports: unknown, containerPort: number) {
    const bindings = isPlainObject(ports) ? ports[`${containerPort}/tcp`] : undefined;
    const binding: unknown = Array.isArray(bindings) ? bindings[0] : undefined;
    const hostPort = isPlainObject(binding) ? Number(binding['HostPort']) : Number.NaN;
    if (!Number.isInteger(hostPort) || hostPort <= 0) {
        throw new Error(`The VPN container publishes no port for ${containerPort}`);
    }
    return hostPort;
}

/** gluetun's `/v1/publicip/ip`: `{ public_ip, country, region, city, … }`; `null` while it has no address yet. */
function readPublicIp(body: unknown) {
    if (!isPlainObject(body) || typeof body['public_ip'] !== 'string' || body['public_ip'] === '') {
        return null;
    }
    return {
        publicIp: body['public_ip'],
        ipGeolocation: {
            country: readText(body, 'country'),
            region: readText(body, 'region'),
            city: readText(body, 'city'),
        },
    };
}

function readText(body: Record<string, unknown>, field: string) {
    const value = body[field];
    return typeof value === 'string' ? value : '';
}

/** Whether a process runs: signal 0 checks without sending anything, and `EPERM` means another user's process. */
function isProcessAlive(pid: number) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM';
    }
}

/** A region or provider as part of a container or volume name; gluetun compares region names case-insensitively. */
function toNamePart(text: string) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function randomHex(bytes: number) {
    return randomBytes(bytes).toString('hex');
}
