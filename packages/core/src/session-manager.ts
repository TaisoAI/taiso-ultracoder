import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { canTransition } from "./state-machine.js";
import type { SessionEvent } from "./state-machine.js";
import type { Logger, PathResolver, Session, SessionManager, SessionStatus } from "./types.js";
import { atomicWrite, safeRead } from "./util/atomic.js";

export class FileSessionManager implements SessionManager {
	private readonly paths: PathResolver;
	private readonly logger: Logger;
	private readonly locks = new Map<string, Promise<void>>();

	constructor(paths: PathResolver, logger: Logger) {
		this.paths = paths;
		this.logger = logger.child({ component: "session-manager" });
	}

	private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
		// Wait for any existing lock on this session
		while (this.locks.has(id)) {
			await this.locks.get(id);
		}

		let resolve: () => void;
		const lockPromise = new Promise<void>((r) => {
			resolve = r;
		});
		this.locks.set(id, lockPromise);

		try {
			return await fn();
		} finally {
			this.locks.delete(id);
			resolve!();
		}
	}

	async create(opts: Omit<Session, "id" | "createdAt" | "updatedAt" | "status">): Promise<Session> {
		const id = randomUUID().slice(0, 8);
		const now = new Date().toISOString();
		const session: Session = {
			...opts,
			id,
			status: "spawning",
			createdAt: now,
			updatedAt: now,
		};

		await atomicWrite(this.paths.sessionFile(id), JSON.stringify(session, null, "\t"));
		// Ensure logs directory exists
		await fs.promises.mkdir(this.paths.logsDir(id), { recursive: true });

		this.logger.info(`Created session '${id}'`, { task: opts.task });
		return session;
	}

	async get(id: string): Promise<Session | undefined> {
		const content = await safeRead(this.paths.sessionFile(id));
		if (content === undefined) return undefined;
		try {
			return JSON.parse(content) as Session;
		} catch {
			this.logger.error(`Corrupt session file for '${id}', skipping`);
			return undefined;
		}
	}

	async update(id: string, patch: Partial<Session>): Promise<Session> {
		return this.withLock(id, async () => {
			const existing = await this.get(id);
			if (!existing) {
				throw new Error(`Session '${id}' not found`);
			}

			const updated: Session = {
				...existing,
				...patch,
				id, // Never allow changing id
				createdAt: existing.createdAt, // Never allow changing creation time
				updatedAt: new Date().toISOString(),
			};

			await atomicWrite(this.paths.sessionFile(id), JSON.stringify(updated, null, "\t"));
			this.logger.debug(`Updated session '${id}'`, { status: updated.status });
			return updated;
		});
	}

	async transition(id: string, event: SessionEvent): Promise<Session> {
		return this.withLock(id, async () => {
			const existing = await this.get(id);
			if (!existing) {
				throw new Error(`Session '${id}' not found`);
			}

			const result = canTransition(existing.status, event);
			if (!result.valid) {
				throw new Error(
					result.reason ?? `Cannot transition from '${existing.status}' via '${event}'`,
				);
			}

			const updated: Session = {
				...existing,
				status: result.to,
				updatedAt: new Date().toISOString(),
			};

			await atomicWrite(this.paths.sessionFile(id), JSON.stringify(updated, null, "\t"));
			this.logger.info(`Transitioned session '${id}': ${existing.status} -> ${result.to}`, {
				event,
			});
			return updated;
		});
	}

	async list(filter?: Partial<Pick<Session, "projectId">> & { status?: SessionStatus | SessionStatus[] }): Promise<Session[]> {
		const sessionsDir = this.paths.sessionsDir();

		try {
			const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
			const sessions: Session[] = [];

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const session = await this.get(entry.name);
				if (!session) continue;

				if (filter?.status) {
					if (Array.isArray(filter.status)) {
						if (!filter.status.includes(session.status)) continue;
					} else {
						if (session.status !== filter.status) continue;
					}
				}
				if (filter?.projectId && session.projectId !== filter.projectId) continue;

				sessions.push(session);
			}

			return sessions.sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	async archive(id: string): Promise<void> {
		return this.withLock(id, async () => {
			const session = await this.get(id);
			if (!session) {
				throw new Error(`Session '${id}' not found`);
			}

			const updated: Session = {
				...session,
				status: "archived",
				updatedAt: new Date().toISOString(),
			};
			await atomicWrite(this.paths.sessionFile(id), JSON.stringify(updated, null, "\t"));

			const archivePath = `${this.paths.archiveDir()}/${id}`;
			await fs.promises.mkdir(this.paths.archiveDir(), { recursive: true });

			const sessionDir = this.paths.sessionDir(id);
			await fs.promises.rename(sessionDir, archivePath);

			this.logger.info(`Archived session '${id}'`);
		});
	}

	async delete(id: string): Promise<void> {
		const sessionDir = this.paths.sessionDir(id);
		try {
			await fs.promises.rm(sessionDir, { recursive: true, force: true });
			this.logger.info(`Deleted session '${id}'`);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
			throw err;
		}
	}
}
