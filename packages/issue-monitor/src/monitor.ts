import type { Deps, Logger, TrackerPlugin, TrackerIssue } from "@ultracoder/core";
import type { IssueMonitorConfig, IssueRecord } from "./types.js";
import { IssueStore } from "./issue-store.js";
import { runDualAssessment, type DualAssessorConfig } from "./dual-assessor.js";
import { synthesizePlan, type SynthesizerConfig } from "./synthesizer.js";
import { spawnFixSession } from "./spawner.js";

const EFFORT_ORDER = ["trivial", "small", "medium", "large"] as const;

/**
 * IssueMonitor: polls for new issues, runs dual assessment, synthesizes a plan, and spawns a fix.
 */
export class IssueMonitor {
	private readonly store: IssueStore;
	private readonly logger: Logger;
	private readonly deps: Deps;
	private readonly config: IssueMonitorConfig;
	private activeAssessments = 0;
	private activeSpawns = 0;
	private pollInProgress = false;

	constructor(deps: Deps, config: IssueMonitorConfig) {
		this.deps = deps;
		this.config = config;
		this.logger = deps.logger.child({ component: "issue-monitor" });
		this.store = new IssueStore(deps.paths.issuesDir());
	}

	async init(): Promise<void> {
		await this.store.init();
	}

	/**
	 * Run a single poll cycle: list → dedup → assess → synthesize → spawn.
	 */
	async poll(): Promise<void> {
		if (!this.config.enabled) return;
		if (this.pollInProgress) {
			this.logger.debug("Poll already in progress, skipping");
			return;
		}
		this.pollInProgress = true;

		try {
			await this.doPoll();
		} finally {
			this.pollInProgress = false;
		}
	}

	private async doPoll(): Promise<void> {
		const tracker = this.deps.plugins.get("tracker") as TrackerPlugin | undefined;
		if (!tracker?.listIssues) {
			this.logger.warn("Tracker plugin does not support listIssues — skipping poll");
			return;
		}

		this.logger.debug("Polling for issues");

		// Recover any stale records (stuck in assessing for >2x timeout)
		const staleTimeout = this.config.assessorTimeoutMs * 2;
		const recovered = await this.store.recoverStale(staleTimeout);
		if (recovered.length > 0) {
			this.logger.warn("Recovered stale issue records", { recovered });
		}

		// List issues from tracker
		let issues: TrackerIssue[];
		try {
			issues = await tracker.listIssues({
				state: this.config.filter.state,
				labels: this.config.filter.labels,
				assignee: this.config.filter.assignee,
				query: this.config.filter.query,
			});
		} catch (err) {
			this.logger.error("Failed to list issues", {
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		// Filter out excluded labels
		if (this.config.filter.excludeLabels?.length) {
			const exclude = new Set(this.config.filter.excludeLabels);
			issues = issues.filter(
				(issue) => !issue.labels?.some((l) => exclude.has(l)),
			);
		}

		this.logger.debug("Issues found", { count: issues.length });

		// Process each issue
		for (const issue of issues) {
			await this.processIssue(issue, tracker);
		}
	}

	private async processIssue(issue: TrackerIssue, tracker: TrackerPlugin): Promise<void> {
		const existing = await this.store.get(issue.id);

		if (existing) {
			// Already tracked — check if we need to advance the pipeline
			await this.advancePipeline(existing, tracker);
			return;
		}

		// New issue — create record
		const record: IssueRecord = {
			issueId: issue.id,
			issueUrl: issue.url,
			title: issue.title,
			body: issue.body,
			state: "seen",
			firstSeenAt: new Date().toISOString(),
			lastCheckedAt: new Date().toISOString(),
		};

		await this.store.set(record);
		this.logger.info("New issue discovered", { issueId: issue.id, title: issue.title });

		// Immediately try to advance
		await this.advancePipeline(record, tracker);
	}

	private async advancePipeline(record: IssueRecord, tracker: TrackerPlugin): Promise<void> {
		try {
			switch (record.state) {
				case "seen":
					await this.startAssessment(record, tracker);
					break;
				case "assessed":
					await this.startSynthesis(record);
					break;
				case "planning":
					await this.startSpawn(record);
					break;
				default:
					// Terminal or in-progress states — nothing to do
					break;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error("Pipeline error", { issueId: record.issueId, state: record.state, error: message });
			await this.store.update(record.issueId, { state: "error", error: message });
		}
	}

	private async startAssessment(record: IssueRecord, tracker: TrackerPlugin): Promise<void> {
		if (this.activeAssessments >= this.config.maxConcurrentAssessments) {
			this.logger.debug("Max concurrent assessments reached, deferring", {
				issueId: record.issueId,
			});
			return;
		}

		await this.store.transition(record.issueId, "assessing");
		this.activeAssessments++;

		try {
			const assessorConfig: DualAssessorConfig = {
				claudeConfig: {
					agentPath: this.config.assessorAgentPath ?? "claude",
					timeoutMs: this.config.assessorTimeoutMs,
				},
				codexConfig: {
					agentPath: "codex",
					timeoutMs: this.config.assessorTimeoutMs,
				},
			};

			const assessments = await runDualAssessment(record, assessorConfig, tracker, this.logger);

			// Check maxEffort filter — use worst-case effort from all available assessments
			if (this.config.maxEffort) {
				const maxIdx = EFFORT_ORDER.indexOf(this.config.maxEffort);
				const available = [assessments.claude, assessments.codex].filter(Boolean) as import("./types.js").AgentAssessment[];
				const worstEffort = available.reduce((worst, a) => {
					const idx = EFFORT_ORDER.indexOf(a.effort);
					return idx > worst.idx ? { idx, effort: a.effort } : worst;
				}, { idx: -1, effort: "" as string });

				if (worstEffort.idx > maxIdx) {
					this.logger.info("Issue exceeds maxEffort, rejecting", {
						issueId: record.issueId,
						effort: worstEffort.effort,
						maxEffort: this.config.maxEffort,
					});
					await this.store.update(record.issueId, {
						state: "rejected",
						assessments,
						error: `Effort ${worstEffort.effort} exceeds max ${this.config.maxEffort}`,
					});
					return;
				}
			}

			await this.store.update(record.issueId, {
				assessments,
			});
			await this.store.transition(record.issueId, "assessed");
		} finally {
			this.activeAssessments--;
		}
	}

	private async startSynthesis(record: IssueRecord): Promise<void> {
		const synthConfig: SynthesizerConfig = {
			agentPath: this.config.assessorAgentPath ?? "claude",
			timeoutMs: this.config.assessorTimeoutMs,
		};

		// Refetch with latest assessments
		const current = (await this.store.get(record.issueId))!;
		const plan = await synthesizePlan(current, synthConfig, this.logger);

		await this.store.update(record.issueId, { resolutionPlan: plan });
		await this.store.transition(record.issueId, "planning");
	}

	private async startSpawn(record: IssueRecord): Promise<void> {
		if (this.activeSpawns >= this.config.maxConcurrentSpawns) {
			this.logger.debug("Max concurrent spawns reached, deferring", {
				issueId: record.issueId,
			});
			return;
		}

		await this.store.transition(record.issueId, "spawning");
		this.activeSpawns++;

		try {
			// Refetch with latest data
			const current = (await this.store.get(record.issueId))!;
			const sessionId = await spawnFixSession(current, this.deps, this.logger);

			await this.store.update(record.issueId, { sessionId });
			await this.store.transition(record.issueId, "spawned");
		} finally {
			this.activeSpawns--;
		}
	}

	/**
	 * Get all tracked issue records for status display.
	 */
	async getRecords(): Promise<IssueRecord[]> {
		return this.store.all();
	}

	/**
	 * Manually trigger assessment for a specific issue by ID.
	 */
	async assessIssue(issueId: string): Promise<void> {
		const tracker = this.deps.plugins.get("tracker") as TrackerPlugin | undefined;
		if (!tracker) {
			throw new Error("No tracker plugin configured");
		}

		let record = await this.store.get(issueId);
		if (!record) {
			// Fetch from tracker
			const issue = await tracker.getIssue(issueId);
			record = {
				issueId: issue.id,
				issueUrl: issue.url,
				title: issue.title,
				body: issue.body,
				state: "seen",
				firstSeenAt: new Date().toISOString(),
				lastCheckedAt: new Date().toISOString(),
			};
			await this.store.set(record);
		}

		// Allow retry from "error" state by resetting to "seen"
		if (record.state === "error") {
			await this.store.transition(issueId, "seen");
			record = (await this.store.get(issueId))!;
		}

		if (record.state !== "seen") {
			throw new Error(`Issue ${issueId} is in state "${record.state}", expected "seen" or "error"`);
		}

		await this.advancePipeline(record, tracker);
	}
}
