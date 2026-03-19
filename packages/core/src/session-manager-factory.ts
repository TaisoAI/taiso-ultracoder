import { FileSessionManager } from "./session-manager.js";
import type { Logger, PathResolver, SessionManager } from "./types.js";

// ─── Storage Backend ────────────────────────────────────────────────

export type StorageBackend = "file" | "sqlite";

export interface SessionManagerFactoryOpts {
	backend: StorageBackend;
	paths: PathResolver;
	logger: Logger;
}

/**
 * Create a SessionManager for the given storage backend.
 *
 * Currently only the "file" backend is implemented. The "sqlite" backend
 * will be added in a future iteration — calling it now throws a clear error.
 */
export function createSessionManager(opts: SessionManagerFactoryOpts): SessionManager {
	switch (opts.backend) {
		case "file":
			return new FileSessionManager(opts.paths, opts.logger);
		case "sqlite":
			throw new Error("SQLite backend not yet implemented. Use 'file' backend.");
		default:
			throw new Error(`Unknown storage backend: ${opts.backend satisfies never}`);
	}
}
