import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const exec = promisify(execFile);

export interface GateConfig {
	lint: boolean;
	test: boolean;
	typecheck: boolean;
}

export interface GateResult {
	gate: string;
	passed: boolean;
	output: string;
	durationMs: number;
}

export interface GatesResult {
	passed: boolean;
	results: GateResult[];
}

/** Auto-detect and run quality gates for a project. */
export async function runGates(
	projectPath: string,
	config: GateConfig,
	logger: Logger,
): Promise<GatesResult> {
	const gates: Array<{ name: string; enabled: boolean; detect: () => Promise<string | null> }> = [
		{
			name: "lint",
			enabled: config.lint,
			detect: () => detectCommand(projectPath, ["pnpm lint", "npm run lint", "npx biome check ."]),
		},
		{
			name: "test",
			enabled: config.test,
			detect: () => detectCommand(projectPath, ["pnpm test", "npm test"]),
		},
		{
			name: "typecheck",
			enabled: config.typecheck,
			detect: () => detectCommand(projectPath, ["pnpm typecheck", "npx tsc --noEmit"]),
		},
	];

	const enabledGates = gates.filter((g) => g.enabled);
	const results = await Promise.all(
		enabledGates.map(async (gate) => runSingleGate(gate.name, projectPath, gate.detect, logger)),
	);

	return {
		passed: results.every((r) => r.passed),
		results,
	};
}

async function runSingleGate(
	name: string,
	projectPath: string,
	detect: () => Promise<string | null>,
	logger: Logger,
): Promise<GateResult> {
	const start = Date.now();

	const command = await detect();
	if (!command) {
		return {
			gate: name,
			passed: true,
			output: "No command detected, skipping",
			durationMs: Date.now() - start,
		};
	}

	logger.info(`Running gate: ${name}`, { command });

	try {
		const [cmd, ...args] = command.split(" ");
		const { stdout, stderr } = await exec(cmd, args, {
			cwd: projectPath,
			timeout: 300_000, // 5 min timeout
		});
		return {
			gate: name,
			passed: true,
			output: (stdout + stderr).trim(),
			durationMs: Date.now() - start,
		};
	} catch (err) {
		const error = err as { stdout?: string; stderr?: string; message?: string };
		return {
			gate: name,
			passed: false,
			output: ((error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? "")).trim(),
			durationMs: Date.now() - start,
		};
	}
}

/** Try to detect which command to use for a gate. */
async function detectCommand(projectPath: string, candidates: string[]): Promise<string | null> {
	for (const cmd of candidates) {
		const [binary, ...args] = cmd.split(" ");
		// For package manager scripts (pnpm/npm run X), verify the script exists
		if ((binary === "pnpm" || binary === "npm") && args[0] !== "run") {
			// e.g. "pnpm test" or "pnpm lint" — check binary exists first
			try {
				await exec(binary, ["--version"], { cwd: projectPath });
				return cmd;
			} catch {
				continue;
			}
		}
		// For direct executables (npx, etc.), check they're available
		try {
			const whichCmd = process.platform === "win32" ? "where" : "which";
			await exec(whichCmd, [binary]);
			return cmd;
		} catch {
			// Binary not found, try next candidate
		}
	}
	return null;
}
