import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { Logger, PathResolver, Session, SessionManager } from "./types.js";
import { atomicWrite, safeRead } from "./util/atomic.js";

export class FileSessionManager implements SessionManager {
	private readonly paths: PathResolver;
	private readonly logger: Logger;

	constructor(paths: PathResolver, logger: Logger) {
		this.paths = paths;
		this.logger = logger.child({ component: "session-manager" });
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
	}

	async list(filter?: Partial<Pick<Session, "status" | "projectId">>): Promise<Session[]> {
		const sessionsDir = this.paths.sessionsDir();

		try {
			const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
			const sessions: Session[] = [];

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const session = await this.get(entry.name);
				if (!session) continue;

				if (filter?.status && session.status !== filter.status) continue;
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
		const session = await this.get(id);
		if (!session) {
			throw new Error(`Session '${id}' not found`);
		}

		const updated = await this.update(id, { status: "archived" });
		const archivePath = `${this.paths.archiveDir()}/${id}`;
		await fs.promises.mkdir(this.paths.archiveDir(), { recursive: true });

		const sessionDir = this.paths.sessionDir(id);
		await fs.promises.rename(sessionDir, archivePath);

		this.logger.info(`Archived session '${id}'`);
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
