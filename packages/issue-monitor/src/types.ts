import type { z } from "zod";
import type { IssueMonitorConfigSchema } from "@ultracoder/core";

// ─── Issue State Machine ────────────────────────────────────────────

export type IssueState =
	| "seen"
	| "assessing"
	| "assessed"
	| "planning"
	| "spawning"
	| "spawned"
	| "rejected"
	| "error";

export interface AgentAssessment {
	agent: string;
	severity: "critical" | "high" | "medium" | "low";
	effort: "trivial" | "small" | "medium" | "large";
	rootCause: string;
	proposedFix: string;
	relatedFiles: string[];
	confidence: number;
	completedAt: string;
	commentId?: string;
}

export interface IssueRecord {
	issueId: string;
	issueUrl: string;
	title: string;
	body: string;
	state: IssueState;
	firstSeenAt: string;
	lastCheckedAt: string;
	assessments?: {
		claude?: AgentAssessment;
		codex?: AgentAssessment;
	};
	resolutionPlan?: string;
	sessionId?: string;
	error?: string;
}

export type IssueMonitorConfig = z.infer<typeof IssueMonitorConfigSchema>;

// ─── Valid State Transitions ────────────────────────────────────────

export const VALID_TRANSITIONS: Record<IssueState, IssueState[]> = {
	seen: ["assessing", "rejected", "error"],
	assessing: ["assessed", "error"],
	assessed: ["planning", "rejected", "error"],
	planning: ["spawning", "rejected", "error"],
	spawning: ["spawned", "error"],
	spawned: [],
	rejected: [],
	error: ["seen"],
};
