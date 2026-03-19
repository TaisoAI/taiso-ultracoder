/**
 * Scope tracker: ensures parallel agents don't overlap in file ownership.
 */
import { appendJsonl, readJsonl } from "@ultracoder/core";

export interface ScopeEntry {
	sessionId: string;
	files: Set<string>;
	acquiredAt: string;
}

export type ScopeEvent =
	| { type: "acquire"; sessionId: string; files: string[]; timestamp: string }
	| { type: "release"; sessionId: string; files: string[]; timestamp: string }
	| {
			type: "handoff";
			fromSession: string;
			toSession: string;
			files: string[];
			timestamp: string;
	  };

export class ScopeTracker {
	private readonly scopes = new Map<string, ScopeEntry>();
	private readonly persistPath?: string;

	constructor(persistPath?: string) {
		this.persistPath = persistPath;
	}

	/**
	 * Create a ScopeTracker and hydrate state from an existing JSONL log.
	 */
	static async fromLog(persistPath: string): Promise<ScopeTracker> {
		const tracker = new ScopeTracker(persistPath);
		const events = await readJsonl<ScopeEvent>(persistPath);
		for (const event of events) {
			tracker.replayEvent(event);
		}
		return tracker;
	}

	/**
	 * Replay a single event into in-memory state (no persistence write).
	 */
	private replayEvent(event: ScopeEvent): void {
		switch (event.type) {
			case "acquire":
				this.acquireInternal(event.sessionId, event.files);
				break;
			case "release":
				this.releaseInternal(event.sessionId);
				break;
			case "handoff": {
				// Remove files from source
				const sourceEntry = this.scopes.get(event.fromSession);
				if (sourceEntry) {
					for (const file of event.files) {
						sourceEntry.files.delete(file);
					}
				}
				// Add files to target
				this.acquireInternal(event.toSession, event.files);
				break;
			}
		}
	}

	/**
	 * Internal acquire logic without persistence.
	 */
	private acquireInternal(sessionId: string, files: string[]): string | null {
		for (const [existingId, entry] of this.scopes) {
			if (existingId === sessionId) continue;
			for (const file of files) {
				if (entry.files.has(file)) {
					return existingId;
				}
			}
		}

		const existing = this.scopes.get(sessionId);
		if (existing) {
			for (const file of files) {
				existing.files.add(file);
			}
		} else {
			this.scopes.set(sessionId, {
				sessionId,
				files: new Set(files),
				acquiredAt: new Date().toISOString(),
			});
		}

		return null;
	}

	/**
	 * Internal release logic without persistence.
	 */
	private releaseInternal(sessionId: string): void {
		this.scopes.delete(sessionId);
	}

	/**
	 * Persist a scope event to the JSONL log.
	 */
	private async persistEvent(event: ScopeEvent): Promise<void> {
		if (this.persistPath) {
			await appendJsonl(this.persistPath, event);
		}
	}

	/**
	 * Acquire scope for a session. Returns conflicting session ID if overlap detected.
	 */
	async acquire(sessionId: string, files: string[]): Promise<string | null> {
		const conflict = this.acquireInternal(sessionId, files);
		if (conflict === null) {
			await this.persistEvent({
				type: "acquire",
				sessionId,
				files,
				timestamp: new Date().toISOString(),
			});
		}
		return conflict;
	}

	/**
	 * Release scope for a session.
	 */
	async release(sessionId: string): Promise<void> {
		const entry = this.scopes.get(sessionId);
		const files = entry ? [...entry.files] : [];
		this.releaseInternal(sessionId);
		await this.persistEvent({
			type: "release",
			sessionId,
			files,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Check if a file is owned by any session.
	 */
	owner(file: string): string | null {
		for (const [sessionId, entry] of this.scopes) {
			if (entry.files.has(file)) return sessionId;
		}
		return null;
	}

	/**
	 * Execute a handoff: transfer file ownership between sessions.
	 * Persists a single "handoff" event rather than separate release+acquire.
	 */
	async handoff(request: HandoffRequest): Promise<boolean> {
		// Verify the source owns all files
		for (const file of request.files) {
			if (this.owner(file) !== request.fromSession) {
				return false;
			}
		}

		// Check no third party owns any of these files
		for (const file of request.files) {
			const currentOwner = this.owner(file);
			if (
				currentOwner !== null &&
				currentOwner !== request.fromSession &&
				currentOwner !== request.toSession
			) {
				return false;
			}
		}

		// Release from source
		const sourceEntry = this.scopes.get(request.fromSession);
		if (sourceEntry) {
			for (const file of request.files) {
				sourceEntry.files.delete(file);
			}
		}

		// Acquire for target (internal, no persistence)
		const conflict = this.acquireInternal(request.toSession, request.files);
		if (conflict !== null) {
			// Rollback: re-add files to source
			if (sourceEntry) {
				for (const file of request.files) {
					sourceEntry.files.add(file);
				}
			}
			return false;
		}

		// Persist a single handoff event
		await this.persistEvent({
			type: "handoff",
			fromSession: request.fromSession,
			toSession: request.toSession,
			files: request.files,
			timestamp: new Date().toISOString(),
		});

		return true;
	}

	/**
	 * Get all active scopes.
	 */
	getAll(): ReadonlyMap<string, ScopeEntry> {
		return this.scopes;
	}
}

/**
 * Handoff protocol: transfer file ownership between sessions.
 */
export interface HandoffRequest {
	fromSession: string;
	toSession: string;
	files: string[];
	reason: string;
}

export async function executeHandoff(
	tracker: ScopeTracker,
	request: HandoffRequest,
): Promise<boolean> {
	return tracker.handoff(request);
}
