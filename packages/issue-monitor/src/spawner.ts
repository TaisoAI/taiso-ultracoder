import type {
	AgentPlugin,
	Deps,
	Logger,
	RuntimePlugin,
	WorkspacePlugin,
} from "@ultracoder/core";
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

	// --- Workspace ---
	const workspace = deps.plugins.get("workspace") as WorkspacePlugin | undefined;
	let workspacePath = deps.config.rootPath;

	if (workspace) {
		try {
			const info = await workspace.create({
				projectPath: deps.config.rootPath,
				branch,
				sessionId: session.id,
			});
			workspacePath = info.path;
			await deps.sessions.update(session.id, { workspacePath: info.path });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await deps.sessions.update(session.id, { status: "failed" });
			throw new Error(`Failed to create workspace for issue ${record.issueId}: ${message}`);
		}
	}

	// --- Agent command ---
	const agent = deps.plugins.get("agent") as AgentPlugin | undefined;
	if (!agent) {
		log.warn("No agent plugin configured — session left in spawning state");
		return session.id;
	}

	let cmd: { command: string; args: string[] };
	try {
		cmd = agent.buildCommand({
			task,
			workspacePath,
			config: deps.config.session.agent,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await deps.sessions.update(session.id, { status: "failed" });
		throw new Error(`Failed to build agent command for issue ${record.issueId}: ${message}`);
	}

	// --- Runtime ---
	const runtime = deps.plugins.get("runtime") as RuntimePlugin | undefined;
	if (!runtime) {
		log.warn("No runtime plugin configured — session left in spawning state");
		return session.id;
	}

	try {
		const handle = await runtime.spawn({
			command: cmd.command,
			args: cmd.args,
			cwd: workspacePath,
			name: `uc-${session.id}`,
		});

		await deps.sessions.update(session.id, {
			status: "working",
			runtimeId: handle.id,
			pid: handle.pid,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await deps.sessions.update(session.id, { status: "failed" });
		throw new Error(`Failed to spawn agent for issue ${record.issueId}: ${message}`);
	}

	log.info("Fix session started", { sessionId: session.id });
	return session.id;
}
