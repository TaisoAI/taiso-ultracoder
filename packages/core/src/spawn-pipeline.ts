import type {
	AgentPlugin,
	Deps,
	Logger,
	RuntimeHandle,
	RuntimePlugin,
	Session,
	WorkspacePlugin,
} from "./types.js";

export interface SpawnPipelineOpts {
	session: Session;
	task: string;
	deps: Deps;
	logger: Logger;
}

export interface SpawnPipelineResult {
	session: Session;
	workspacePath: string;
	runtimeHandle?: RuntimeHandle;
}

/**
 * Execute the workspace→agent→runtime spawn pipeline.
 * On any step failure, sets session to "failed" and throws.
 */
export async function runSpawnPipeline(
	opts: SpawnPipelineOpts,
): Promise<SpawnPipelineResult> {
	const { session, task, deps, logger } = opts;

	// --- Concurrency guard ---
	const maxConcurrent = deps.config.session?.maxConcurrentSessions;
	if (maxConcurrent != null) {
		const active = await deps.sessions.list({
			status: ["spawning", "working"],
		});
		// Exclude the current session (already created in "spawning" state by caller)
		const otherActive = active.filter((s) => s.id !== session.id);
		if (otherActive.length >= maxConcurrent) {
			logger.warn(
				`Max concurrent sessions (${maxConcurrent}) reached — refusing to spawn`,
				{ activeCount: otherActive.length, maxConcurrent },
			);
			await deps.sessions.update(session.id, { status: "failed" });
			throw new Error(
				`Max concurrent sessions (${maxConcurrent}) reached`,
			);
		}
	}

	let workspacePath = deps.config.rootPath;

	// --- Workspace ---
	const workspace = deps.plugins.get("workspace") as
		| WorkspacePlugin
		| undefined;

	if (workspace) {
		try {
			const info = await workspace.create({
				projectPath: deps.config.rootPath,
				branch: session.branch,
				sessionId: session.id,
			});
			workspacePath = info.path;
			await deps.sessions.update(session.id, {
				workspacePath: info.path,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await deps.sessions.update(session.id, { status: "failed" });
			throw new Error(`Failed to create workspace: ${message}`);
		}
	} else {
		logger.warn("No workspace plugin configured — using project root.");
	}

	// --- Agent command ---
	const agent = deps.plugins.get("agent") as AgentPlugin | undefined;
	if (!agent) {
		logger.warn(
			"No agent plugin configured — agent was not started.",
		);
		return { session, workspacePath };
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
		throw new Error(`Failed to build agent command: ${message}`);
	}

	// --- Runtime ---
	const runtime = deps.plugins.get("runtime") as
		| RuntimePlugin
		| undefined;
	if (!runtime) {
		logger.warn(
			"No runtime plugin configured — agent was not started.",
		);
		return { session, workspacePath };
	}

	let runtimeHandle: RuntimeHandle;
	try {
		runtimeHandle = await runtime.spawn({
			command: cmd.command,
			args: cmd.args,
			cwd: workspacePath,
			name: `uc-${session.id}`,
		});

		await deps.sessions.update(session.id, {
			status: "working",
			runtimeId: runtimeHandle.id,
			pid: runtimeHandle.pid,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await deps.sessions.update(session.id, { status: "failed" });
		throw new Error(`Failed to spawn agent: ${message}`);
	}

	return { session, workspacePath, runtimeHandle };
}
