import { KVStore } from "@ultracoder/core";
import type { IssueRecord, IssueState } from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";

/**
 * Persistent store for issue records with state machine validation.
 */
export class IssueStore {
	private readonly store: KVStore<IssueRecord>;

	constructor(dir: string) {
		this.store = new KVStore<IssueRecord>(dir);
	}

	async init(): Promise<void> {
		await this.store.init();
	}

	async get(issueId: string): Promise<IssueRecord | undefined> {
		return this.store.get(issueId);
	}

	async has(issueId: string): Promise<boolean> {
		return this.store.has(issueId);
	}

	async set(record: IssueRecord): Promise<void> {
		await this.store.set(record.issueId, record);
	}

	async all(): Promise<IssueRecord[]> {
		return this.store.values();
	}

	/**
	 * Transition an issue to a new state, validating the transition is legal.
	 */
	async transition(issueId: string, newState: IssueState): Promise<IssueRecord> {
		const record = await this.store.get(issueId);
		if (!record) {
			throw new Error(`Issue ${issueId} not found`);
		}

		const allowed = VALID_TRANSITIONS[record.state];
		if (!allowed.includes(newState)) {
			throw new Error(
				`Invalid transition: ${record.state} → ${newState} for issue ${issueId}`,
			);
		}

		record.state = newState;
		record.lastCheckedAt = new Date().toISOString();
		await this.store.set(issueId, record);
		return record;
	}

	/**
	 * Update an issue record (merge fields) without state transition validation.
	 * Use this for updating assessments, plans, etc.
	 */
	async update(issueId: string, patch: Partial<IssueRecord>): Promise<IssueRecord> {
		const record = await this.store.get(issueId);
		if (!record) {
			throw new Error(`Issue ${issueId} not found`);
		}

		const updated: IssueRecord = { ...record, ...patch, issueId: record.issueId };
		updated.lastCheckedAt = new Date().toISOString();
		await this.store.set(issueId, updated);
		return updated;
	}

	/**
	 * Recover stale records stuck in "assessing" for longer than the timeout.
	 * Resets them to "seen" so they can be retried.
	 */
	async recoverStale(timeoutMs: number): Promise<string[]> {
		const now = Date.now();
		const records = await this.all();
		const recovered: string[] = [];

		for (const record of records) {
			if (record.state !== "assessing") continue;
			const elapsed = now - new Date(record.lastCheckedAt).getTime();
			if (elapsed > timeoutMs) {
				record.state = "error";
				record.error = `Stale: stuck in assessing for ${Math.round(elapsed / 1000)}s`;
				record.lastCheckedAt = new Date().toISOString();
				await this.store.set(record.issueId, record);

				// Reset to "seen" for retry (error → seen is valid)
				record.state = "seen";
				record.error = undefined;
				record.lastCheckedAt = new Date().toISOString();
				await this.store.set(record.issueId, record);

				recovered.push(record.issueId);
			}
		}

		return recovered;
	}
}
