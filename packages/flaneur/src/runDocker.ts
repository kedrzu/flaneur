import { spawn } from 'node:child_process';

/** A `docker` CLI call. */
export interface RunDockerParams {
    args: string[];
    /**
     * Added to the docker process's environment: how a container's variables travel, named by `-e NAME` in `args` with
     * the value here, so no value shows in `ps` or in an error.
     */
    env?: Record<string, string>;
    /** The call is killed after this long and rejects with `DockerTimeoutError`. */
    timeoutMs?: number;
}

/** What a finished `docker` call printed; a non-zero exit is the caller's to judge. */
export interface DockerOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Docker cannot be used at all: not installed, or its daemon is not running. */
export class DockerUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DockerUnavailableError';
    }
}

/** A `docker` call ran past its `timeoutMs` and was killed. */
export class DockerTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DockerTimeoutError';
    }
}

/**
 * Runs the `docker` CLI and resolves with what it printed, whatever its exit code; rejects with
 * `DockerUnavailableError` when docker is missing or its daemon down, as no call can work then.
 */
export async function runDocker(params: RunDockerParams): Promise<DockerOutput> {
    const child = spawn('docker', params.args, {
        env: { ...process.env, ...params.env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
    });

    let timedOut = false;
    const timer =
        params.timeoutMs == null
            ? undefined
            : setTimeout(() => {
                  timedOut = true;
                  child.kill('SIGKILL');
              }, params.timeoutMs);
    try {
        const exitCode = await new Promise<number>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', code => resolve(code ?? -1));
        });
        if (timedOut) {
            throw new DockerTimeoutError(`docker ${params.args[0]} did not finish in time`);
        }
        if (
            /Cannot connect to the Docker daemon|failed to connect to the docker API|error during connect/i.test(stderr)
        ) {
            throw new DockerUnavailableError('Docker is not running: start it to use a VPN');
        }
        return { exitCode, stdout, stderr };
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new DockerUnavailableError('Docker is not installed: a VPN needs the `docker` command');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
