import type { z } from "zod";
import type { AgentConfigSchema, ProjectConfigSchema, SessionConfigSchema } from "./schemas.js";

// ─── Plugin Slot Names ───────────────────────────────────────────────
export const PLUGIN_SLOTS = [
	"runtime",
	"agent",
	"workspace",
	"tracker",
	"scm",
	"notifier",
	"reviewer",
] as const;

export type PluginSlot = (typeof PLUGIN_SLOTS)[number];

// ─── Session ─────────────────────────────────────────────────────────
export type SessionStatus =
	| "spawning"
	| "working"
	| "pr_open"
	| "review_pending"
	| "ci_failed"
	| "changes_requested"
	| "merge_conflicts"
	| "approved"
	| "mergeable"
	| "merged"
	| "failed"
	| "killed"
	| "archived";

export interface Session {
	readonly id: string;
	readonly projectId: string;
	task: string;
	status: SessionStatus;
	agentType: string;
	workspacePath: string;
	branch: string;
	pid?: number;
	runtimeId?: string;
	parentSessionId?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	metadata: Record<string, unknown>;
}

// ─── Plugin Interfaces ──────────────────────────────────────────────
export interface PluginMeta {
	readonly name: string;
	readonly slot: PluginSlot;
	readonly version: string;
}

export interface Plugin<T extends PluginSlot = PluginSlot> {
	readonly meta: PluginMeta;
	init?(deps: Deps): Promise<void>;
	destroy?(): Promise<void>;
}

export interface RuntimePlugin extends Plugin<"runtime"> {
	spawn(opts: RuntimeSpawnOpts): Promise<RuntimeHandle>;
	kill(handle: RuntimeHandle): Promise<void>;
	isAlive(handle: RuntimeHandle): Promise<boolean>;
	sendInput(handle: RuntimeHandle, input: string): Promise<void>;
}

export interface RuntimeSpawnOpts {
	command: string;
	args: string[];
	cwd: string;
	env?: Record<string, string>;
	name?: string;
}

export interface RuntimeHandle {
	id: string;
	pid?: number;
}

export interface AgentPlugin extends Plugin<"agent"> {
	buildCommand(opts: AgentCommandOpts): { command: string; args: string[] };
	parseActivity(line: string): AgentActivity | null;
}

export interface AgentCommandOpts {
	task: string;
	workspacePath: string;
	config: AgentConfig;
}

export type AgentActivityType = "idle" | "active" | "tool_call" | "completed" | "error";

export interface AgentActivity {
	type: AgentActivityType;
	timestamp: string;
	detail?: string;
}

export interface WorkspacePlugin extends Plugin<"workspace"> {
	create(opts: WorkspaceCreateOpts): Promise<WorkspaceInfo>;
	cleanup(info: WorkspaceInfo): Promise<void>;
}

export interface WorkspaceCreateOpts {
	projectPath: string;
	branch: string;
	sessionId: string;
}

export interface WorkspaceInfo {
	path: string;
	branch: string;
	isTemporary: boolean;
}

export interface TrackerListOpts {
	state?: "open" | "closed" | "all";
	labels?: string[];
	assignee?: string;
	query?: string;
	limit?: number;
}

export interface TrackerPlugin extends Plugin<"tracker"> {
	createIssue(opts: TrackerIssueOpts): Promise<string>;
	updateIssue(id: string, update: Partial<TrackerIssueOpts>): Promise<void>;
	getIssue(id: string): Promise<TrackerIssue>;
	listIssues?(opts?: TrackerListOpts): Promise<TrackerIssue[]>;
	addComment?(issueId: string, body: string): Promise<string>;
}

export interface TrackerIssueOpts {
	title: string;
	body: string;
	labels?: string[];
	assignees?: string[];
}

export interface TrackerIssue extends TrackerIssueOpts {
	id: string;
	state: "open" | "closed";
	url: string;
}

export interface ScmPlugin extends Plugin<"scm"> {
	createPR(opts: PullRequestOpts): Promise<string>;
	getPRStatus(id: string): Promise<PullRequestStatus>;
	mergePR(id: string, strategy?: MergeStrategy): Promise<void>;
	getCIStatus(ref: string): Promise<CIStatus>;
}

export interface PullRequestOpts {
	title: string;
	body: string;
	head: string;
	base: string;
	draft?: boolean;
}

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequestStatus {
	id: string;
	state: PullRequestState;
	mergeable: boolean;
	reviewDecision?: "approved" | "changes_requested" | "review_required";
	ciStatus: CIStatus;
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export type CIStatusState = "pending" | "success" | "failure" | "error";

export interface CIStatus {
	state: CIStatusState;
	checks: Array<{ name: string; status: CIStatusState; url?: string }>;
}

export interface NotifierPlugin extends Plugin<"notifier"> {
	notify(notification: Notification): Promise<void>;
}

export interface Notification {
	title: string;
	body: string;
	level: "info" | "warn" | "error" | "success";
	sessionId?: string;
	url?: string;
}

export interface ReviewerPlugin extends Plugin<"reviewer"> {
	review(opts: ReviewOpts): Promise<ReviewVerdict>;
}

export interface ReviewOpts {
	diff: string;
	task: string;
	sessionId: string;
}

export type ReviewVerdictDecision = "approve" | "request_changes" | "comment";

export interface ReviewVerdict {
	decision: ReviewVerdictDecision;
	summary: string;
	comments: Array<{ file: string; line: number; body: string }>;
}

// ─── Configuration ──────────────────────────────────────────────────
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Dependency Injection Container ─────────────────────────────────
export interface Deps {
	config: ProjectConfig;
	logger: Logger;
	plugins: PluginRegistry;
	sessions: SessionManager;
	paths: PathResolver;
}

// ─── Logger ─────────────────────────────────────────────────────────
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	level: LogLevel;
	message: string;
	timestamp: string;
	context?: Record<string, unknown>;
}

export interface Logger {
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
	child(context: Record<string, unknown>): Logger;
}

// ─── Plugin Registry ────────────────────────────────────────────────
export interface PluginRegistry {
	register(plugin: Plugin): void;
	get<S extends PluginSlot>(slot: S): PluginForSlot<S> | undefined;
	getAll(): ReadonlyMap<PluginSlot, Plugin>;
	has(slot: PluginSlot): boolean;
}

// ─── Session Manager ────────────────────────────────────────────────
export interface SessionManager {
	create(opts: Omit<Session, "id" | "createdAt" | "updatedAt" | "status">): Promise<Session>;
	get(id: string): Promise<Session | undefined>;
	update(id: string, patch: Partial<Session>): Promise<Session>;
	list(filter?: Partial<Pick<Session, "status" | "projectId">>): Promise<Session[]>;
	archive(id: string): Promise<void>;
	delete(id: string): Promise<void>;
}

// ─── Path Resolver ──────────────────────────────────────────────────
export interface PathResolver {
	dataDir(): string;
	sessionsDir(): string;
	sessionDir(sessionId: string): string;
	sessionFile(sessionId: string): string;
	logsDir(sessionId: string): string;
	archiveDir(): string;
	issuesDir(): string;
}

// ─── Helper: Map PluginSlot → Plugin Interface ──────────────────────
export type PluginForSlot<S extends PluginSlot> = S extends "runtime"
	? RuntimePlugin
	: S extends "agent"
		? AgentPlugin
		: S extends "workspace"
			? WorkspacePlugin
			: S extends "tracker"
				? TrackerPlugin
				: S extends "scm"
					? ScmPlugin
					: S extends "notifier"
						? NotifierPlugin
						: S extends "reviewer"
							? ReviewerPlugin
							: Plugin;
