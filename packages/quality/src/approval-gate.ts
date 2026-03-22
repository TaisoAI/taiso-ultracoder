import { randomUUID } from "node:crypto";

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

export class ApprovalGate {
	private store: Map<string, PendingApproval>;

	constructor(private readonly storePath?: string) {
		this.store = new Map();
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
		this.store.set(approval.id, approval);
		return approval;
	}

	async respond(
		approvalId: string,
		decision: "approve" | "deny",
		reason?: string,
	): Promise<PendingApproval> {
		const approval = this.store.get(approvalId);
		if (!approval) {
			throw new Error(`Approval '${approvalId}' not found`);
		}

		// Idempotent: if already resolved, return as-is
		if (approval.status !== "pending") {
			return approval;
		}

		approval.status = decision === "approve" ? "approved" : "denied";
		approval.resolvedAt = new Date().toISOString();
		if (reason) {
			approval.reason = reason;
		}

		return approval;
	}

	async getPending(): Promise<PendingApproval[]> {
		return Array.from(this.store.values()).filter((a) => a.status === "pending");
	}

	async get(id: string): Promise<PendingApproval | undefined> {
		return this.store.get(id);
	}

	async sweepTimeouts(): Promise<number> {
		let count = 0;
		const now = Date.now();
		for (const approval of this.store.values()) {
			if (approval.status !== "pending") continue;
			const elapsed = now - new Date(approval.requestedAt).getTime();
			if (elapsed > approval.timeoutMs) {
				approval.status = "timed_out";
				approval.resolvedAt = new Date().toISOString();
				count++;
			}
		}
		return count;
	}
}
