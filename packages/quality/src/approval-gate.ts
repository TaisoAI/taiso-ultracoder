import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface PendingApproval {
	id: string;
	sessionId: string;
	tool: string;
	context: string;
	requestedAt: string;
	timeoutMs: number;
	status: "pending" | "approved" | "denied" | "timed_out";
	resolvedAt?: string;
	reason?: string;
}

/**
 * File-backed approval gate for human-in-the-loop tool call decisions.
 * Each approval is stored as a JSON file in the storePath directory.
 */
export class ApprovalGate {
	constructor(private readonly storePath?: string) {}

	private approvalPath(id: string): string {
		if (!this.storePath) {
			throw new Error("ApprovalGate requires a storePath for persistence");
		}
		return path.join(this.storePath, `${id}.json`);
	}

	private async ensureDir(): Promise<void> {
		if (this.storePath) {
			await fs.promises.mkdir(this.storePath, { recursive: true });
		}
	}

	private async save(approval: PendingApproval): Promise<void> {
		await this.ensureDir();
		await fs.promises.writeFile(
			this.approvalPath(approval.id),
			JSON.stringify(approval, null, "\t"),
			"utf-8",
		);
	}

	private async load(id: string): Promise<PendingApproval | undefined> {
		try {
			const data = await fs.promises.readFile(this.approvalPath(id), "utf-8");
			return JSON.parse(data) as PendingApproval;
		} catch {
			return undefined;
		}
	}

	private async loadAll(): Promise<PendingApproval[]> {
		if (!this.storePath) return [];
		try {
			const files = await fs.promises.readdir(this.storePath);
			const approvals: PendingApproval[] = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const data = await fs.promises.readFile(path.join(this.storePath, file), "utf-8");
					approvals.push(JSON.parse(data) as PendingApproval);
				} catch {
					// skip corrupt files
				}
			}
			return approvals;
		} catch {
			return [];
		}
	}

	async requestApproval(opts: {
		sessionId: string;
		tool: string;
		context: string;
		timeoutMs?: number;
	}): Promise<PendingApproval> {
		const approval: PendingApproval = {
			id: randomUUID().slice(0, 8),
			sessionId: opts.sessionId,
			tool: opts.tool,
			context: opts.context,
			requestedAt: new Date().toISOString(),
			timeoutMs: opts.timeoutMs ?? 300_000,
			status: "pending",
		};
		await this.save(approval);
		return approval;
	}

	async respond(
		approvalId: string,
		decision: "approve" | "deny",
		reason?: string,
	): Promise<PendingApproval> {
		const approval = await this.load(approvalId);
		if (!approval) {
			throw new Error(`Approval '${approvalId}' not found`);
		}

		// Idempotent: if already resolved, return as-is
		if (approval.status !== "pending") {
			return approval;
		}

		// Check for timeout before responding
		const elapsed = Date.now() - new Date(approval.requestedAt).getTime();
		if (elapsed > approval.timeoutMs) {
			approval.status = "timed_out";
			approval.resolvedAt = new Date().toISOString();
			await this.save(approval);
			return approval;
		}

		approval.status = decision === "approve" ? "approved" : "denied";
		approval.resolvedAt = new Date().toISOString();
		if (reason) {
			approval.reason = reason;
		}

		await this.save(approval);
		return approval;
	}

	async getPending(): Promise<PendingApproval[]> {
		const all = await this.loadAll();
		return all.filter((a) => a.status === "pending");
	}

	async get(id: string): Promise<PendingApproval | undefined> {
		return this.load(id);
	}

	async sweepTimeouts(): Promise<number> {
		let count = 0;
		const now = Date.now();
		const all = await this.loadAll();
		for (const approval of all) {
			if (approval.status !== "pending") continue;
			const elapsed = now - new Date(approval.requestedAt).getTime();
			if (elapsed > approval.timeoutMs) {
				approval.status = "timed_out";
				approval.resolvedAt = new Date().toISOString();
				await this.save(approval);
				count++;
			}
		}
		return count;
	}
}
