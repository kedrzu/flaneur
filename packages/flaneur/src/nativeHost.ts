/**
 * The native messaging host Chrome runs for the flaneur extension: a bridge between Chrome's stdio and a local socket
 * flaneur connects to. Registration copies the compiled file out of the package and runs it standalone, so it imports
 * Node built-ins only, and runs on Node 22+ and Bun.
 *
 * - Chrome's side: native messaging frames, a 4-byte little-endian length and UTF-8 JSON, both ways.
 * - flaneur's side: one JSON message per line.
 * - One client at a time: another gets a `busy` line and is closed, the first unaffected.
 * - Nothing from Chrome reaches a client before the client's first message; what comes earlier is dropped. On
 *   Windows other users may open the pipe read-only, and such a client can never speak.
 * - A client that spoke leaves the extension greeted, and the extension greets once per port: when that client goes,
 *   the host exits, Chrome closes the port and the extension connects again with a fresh host. A client that never
 *   spoke frees its place.
 * - Exits when Chrome closes its stdin; leaves when another host (another Chrome profile) already serves the socket.
 */
import { rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Chrome refuses a message from the host above 1 MB and closes the port. */
const MAX_TO_CHROME_BYTES = 1024 * 1024;
const FRAME_HEADER_BYTES = 4;
const NEWLINE = 0x0a;

const address = getHostAddress();
/** The connected client, and whether it spoke: only then does Chrome's traffic reach it. */
let client: net.Socket | undefined;
let clientSpoke = false;
/** Whether this host listens on `address`, so it is this host's to remove. */
let listening = false;
let fromChrome: Buffer = Buffer.alloc(0);

process.stdin.on('data', onChromeData);
process.stdin.on('end', () => exit('Chrome closed the port'));
process.stdin.on('error', error => exit(`Reading from Chrome failed: ${error.message}`));
void listen();

async function listen() {
    if (await isServed()) {
        exit('Another host already serves flaneur');
    }
    if (process.platform !== 'win32') {
        // A socket file nobody answers on is left by a host that died.
        rmSync(address, { force: true });
    }
    const server = net.createServer(onClient);
    server.on('error', error => exit(`The socket failed: ${error.message}`));
    server.listen(address, () => {
        listening = true;
    });
}

function onClient(socket: net.Socket) {
    if (client) {
        socket.end(`${JSON.stringify({ type: 'busy', message: 'Another flaneur is connected to this Chrome' })}\n`);
        return;
    }
    client = socket;
    clientSpoke = false;
    let rest: Buffer = Buffer.alloc(0);
    socket.on('error', error => log(`The client connection failed: ${error.message}`));
    socket.on('close', () => onClientClosed(socket));
    socket.on('data', (chunk: Buffer) => {
        rest = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
        let end = rest.indexOf(NEWLINE);
        while (end !== -1 && !socket.destroyed) {
            forwardToChrome(socket, rest.subarray(0, end));
            rest = rest.subarray(end + 1);
            end = rest.indexOf(NEWLINE);
        }
        // A line that has outgrown Chrome's limit before it ended can only be refused.
        if (!socket.destroyed && rest.length > MAX_TO_CHROME_BYTES) {
            refuse(socket, 'A message from flaneur exceeds the 1 MB Chrome accepts');
        }
    });
}

function onClientClosed(socket: net.Socket) {
    if (client !== socket) {
        return;
    }
    client = undefined;
    if (clientSpoke) {
        exit('flaneur disconnected');
    }
}

/** Sends one line of the client to Chrome, whole or not at all. */
function forwardToChrome(socket: net.Socket, line: Buffer) {
    let message: unknown;
    try {
        message = JSON.parse(line.toString('utf8'));
    } catch {
        refuse(socket, 'flaneur sent a line that is not JSON');
        return;
    }
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > MAX_TO_CHROME_BYTES) {
        refuse(socket, 'A message from flaneur exceeds the 1 MB Chrome accepts');
        return;
    }
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt32LE(payload.length);
    process.stdout.write(Buffer.concat([header, payload]));
    clientSpoke = true;
}

function onChromeData(chunk: Buffer) {
    fromChrome = fromChrome.length > 0 ? Buffer.concat([fromChrome, chunk]) : chunk;
    while (fromChrome.length >= FRAME_HEADER_BYTES) {
        const end = FRAME_HEADER_BYTES + fromChrome.readUInt32LE(0);
        if (fromChrome.length < end) {
            return;
        }
        forwardToClient(fromChrome.subarray(FRAME_HEADER_BYTES, end));
        fromChrome = fromChrome.subarray(end);
    }
}

function forwardToClient(payload: Buffer) {
    if (!client || !clientSpoke) {
        return;
    }
    let message: unknown;
    try {
        message = JSON.parse(payload.toString('utf8'));
    } catch {
        log('Chrome sent a message that is not JSON');
        return;
    }
    // Serialized again so it is one line whatever whitespace Chrome wrote.
    client.write(`${JSON.stringify(message)}\n`);
}

function refuse(socket: net.Socket, reason: string) {
    log(reason);
    socket.destroy();
}

/** Whether a live host answers on the address. */
function isServed() {
    return new Promise<boolean>(resolve => {
        const probe = net.connect(address);
        probe.once('connect', () => {
            probe.destroy();
            resolve(true);
        });
        probe.once('error', () => resolve(false));
    });
}

function exit(reason: string): never {
    log(reason);
    client?.destroy();
    if (listening && process.platform !== 'win32') {
        rmSync(address, { force: true });
    }
    process.exit(0);
}

/** Chrome keeps what the host writes to stderr in its own log. */
function log(message: string) {
    process.stderr.write(`flaneur native host: ${message}\n`);
}

/**
 * Where the host listens; `registerNativeHost` works out the same address, which flaneur connects to. POSIX: the
 * socket beside this file, in the folder only the user can enter.
 */
function getHostAddress() {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\flaneur-own-chrome-${os.userInfo().username}`;
    }
    return path.join(import.meta.dirname, 'host.sock');
}
