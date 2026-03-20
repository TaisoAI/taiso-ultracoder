import type { Deps, Logger } from "@ultracoder/core";
import { runSpawnPipeline } from "@ultracoder/core";
import type { IssueRecord } from "./types.js";

/**
 * Spawn a coding agent session to fix an issue based on the synthesized resolution plan.
 * Creates the full pipeline: session → workspace → agent command → runtime.
 */
export async function spawnFixSession(
	record: IssueRecord,
	deps: Deps,
	logger: Logger,
): Promise<string> {
	const log = logger.child({ component: "spawner", issueId: record.issueId });

	if (!record.resolutionPlan) {
		throw new Error(`Issue ${record.issueId} has no resolution plan`);
	}

	const branch = `uc/fix-issue-${record.issueId}`;
	const task = `Fix GitHub issue #${record.issueId}: ${record.title}\n\n${record.resolutionPlan}\n\nWhen done, open a PR with "Fixes #${record.issueId}" in the body.`;

	log.info("Spawning fix session", { branch });

	const session = await deps.sessions.create({
		projectId: deps.config.projectId,
		task,
		agentType: deps.config.session.agent.type,
		workspacePath: deps.config.rootPath,
		branch,
		metadata: {
			issueId: record.issueId,
			issueUrl: record.issueUrl,
			assessments: record.assessments,
			source: "issue-monitor",
		},
	});

	// runSpawnPipeline throws on failure (which sets session to "failed"),
	// so errors propagate naturally to callers.
	await runSpawnPipeline({
		session,
		task,
		deps,
		logger: log,
	});

	log.info("Fix session started", { sessionId: session.id });
	return session.id;
}
