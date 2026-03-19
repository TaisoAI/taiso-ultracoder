import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { PathResolver } from "./types.js";

/**
 * Hash-namespaced directory layout for session isolation.
 *
 * Layout:
 *   ~/.ultracoder/
 *   ├── sessions/
 *   │   ├── <session-id>/
 *   │   │   ├── session.json
 *   │   │   └── logs/
 *   │   └── ...
 *   ├── archive/
 *   └── config.yaml
 */
export function createPathResolver(projectId: string, baseDir?: string): PathResolver {
	const root = baseDir ?? path.join(os.homedir(), ".ultracoder");
	const projectHash = createHash("sha256").update(projectId).digest("hex").slice(0, 12);
	const projectDir = path.join(root, "projects", projectHash);

	return {
		dataDir() {
			return projectDir;
		},

		sessionsDir() {
			return path.join(projectDir, "sessions");
		},

		sessionDir(sessionId: string) {
			return path.join(projectDir, "sessions", sessionId);
		},

		sessionFile(sessionId: string) {
			return path.join(projectDir, "sessions", sessionId, "session.json");
		},

		logsDir(sessionId: string) {
			return path.join(projectDir, "sessions", sessionId, "logs");
		},

		archiveDir() {
			return path.join(projectDir, "archive");
		},
	};
}

/**
 * Global paths (not project-specific).
 */
export function globalConfigPath(baseDir?: string): string {
	const root = baseDir ?? path.join(os.homedir(), ".ultracoder");
	return path.join(root, "config.yaml");
}
