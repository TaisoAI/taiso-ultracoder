import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const execFile = promisify(execFileCb);

export interface ReconcilerConfig {
	projectPath: string;
	/** Minimum interval between sweeps (used on failure). Default: 60000 (60s) */
	minIntervalMs: number;
	/** Maximum interval between sweeps (used after consecutive successes). Default: 300000 (5min) */
	maxIntervalMs: number;
	/** Maximum number of fix task descriptions per sweep. Default: 5 */
	maxFixTasks: number;
}

export interface ReconcilerResult {
	checksPerformed: number;
	healthy: boolean;
	failures: string[];
	fixDescriptions: string[];
	/** Next suggested interval in ms (adaptive) */
	intervalMs: number;
}

interface GateSpec {
	name: string;
	commands: string[][];
}

const DEFAULT_CONFIG: ReconcilerConfig = {
	projectPath: ".",
	minIntervalMs: 60_000,
	maxIntervalMs: 300_000,
	maxFixTasks: 5,
};

/**
 * Reconciler: runs typecheck, build, and test gates against a project path,
 * collects failures, generates fix descriptions, and adapts sweep intervals.
 */
export class Reconciler {
	private readonly config: ReconcilerConfig;
	private readonly logger: Logger;
	private consecutiveSuccesses = 0;
	readonly recentFixScopes: Set<string> = new Set();

	constructor(
		config: Partial<ReconcilerConfig> & Pick<ReconcilerConfig, "projectPath">,
		logger: Logger,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = logger;
	}

	async reconcile(): Promise<ReconcilerResult> {
		const gates: GateSpec[] = [
			{ name: "typecheck", commands: [["npx", "tsc", "--noEmit"]] },
			{
				name: "build",
				commands: [
					["pnpm", "build"],
					["npm", "run", "build"],
				],
			},
			{
				name: "test",
				commands: [
					["pnpm", "test"],
					["npm", "test"],
				],
			},
		];

		const failures: string[] = [];
		const fixDescriptions: string[] = [];
		let checksPerformed = 0;

		for (const gate of gates) {
			checksPerformed++;
			const result = await this.runGate(gate);

			if (!result.passed) {
				failures.push(`${gate.name}: ${result.output}`);

				const descriptions = this.extractFixDescriptions(gate.name, result.output);
				for (const desc of descriptions) {
					const scope = this.scopeKey(gate.name, desc);
					if (this.recentFixScopes.has(scope)) {
						continue;
					}
					if (fixDescriptions.length >= this.config.maxFixTasks) {
						break;
					}
					fixDescriptions.push(desc);
					this.recentFixScopes.add(scope);
				}
			}
		}

		const healthy = failures.length === 0;

		if (healthy) {
			this.consecutiveSuccesses++;
		} else {
			this.consecutiveSuccesses = 0;
		}

		const intervalMs =
			this.consecutiveSuccesses >= 3 ? this.config.maxIntervalMs : this.config.minIntervalMs;

		this.logger.info("Reconciliation complete", {
			healthy,
			checksPerformed,
			failureCount: failures.length,
			fixCount: fixDescriptions.length,
			intervalMs,
		});

		return {
			checksPerformed,
			healthy,
			failures,
			fixDescriptions,
			intervalMs,
		};
	}

	/** Clear tracked fix scopes (e.g. after fixes are applied). */
	clearFixScopes(): void {
		this.recentFixScopes.clear();
	}

	/** Reset consecutive success counter (for testing or manual override). */
	resetConsecutiveSuccesses(): void {
		this.consecutiveSuccesses = 0;
	}

	private async runGate(gate: GateSpec): Promise<{ passed: boolean; output: string }> {
		for (const cmd of gate.commands) {
			const [binary, ...args] = cmd;
			try {
				const { stdout, stderr } = await execFile(binary, args, {
					cwd: this.config.projectPath,
					timeout: 300_000,
				});
				return { passed: true, output: (stdout + stderr).trim() };
			} catch (err) {
				const error = err as { stdout?: string; stderr?: string; message?: string; code?: string };
				// If the binary wasn't found, try the next command candidate
				if (error.code === "ENOENT") {
					continue;
				}
				// Command ran but failed — this is a real failure
				const output = ((error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? "")).trim();
				return { passed: false, output };
			}
		}
		// No command candidates could be found/executed
		return { passed: true, output: "No command available, skipping" };
	}

	private extractFixDescriptions(gateName: string, output: string): string[] {
		const descriptions: string[] = [];
		const lines = output.split("\n");

		for (const line of lines) {
			// Match TypeScript errors: src/foo.ts(10,5): error TS2345: ...
			const tsMatch = line.match(/^(.+?)\(\d+,\d+\):\s*error\s+(TS\d+):\s*(.+)/);
			if (tsMatch) {
				descriptions.push(`Fix ${gateName} error in ${tsMatch[1]}: ${tsMatch[3]}`);
				continue;
			}
			// Match generic file:line errors
			const fileMatch = line.match(/^(.+?\.\w+):(\d+):\d*\s*(.+)/);
			if (fileMatch) {
				descriptions.push(`Fix ${gateName} error in ${fileMatch[1]}: ${fileMatch[3]}`);
				continue;
			}
			// Match "error" keyword lines
			if (/\berror\b/i.test(line) && line.trim().length > 10) {
				descriptions.push(`Fix ${gateName}: ${line.trim().slice(0, 120)}`);
			}
		}

		// Deduplicate and limit
		return [...new Set(descriptions)].slice(0, this.config.maxFixTasks);
	}

	private scopeKey(gate: string, description: string): string {
		// Extract file path from description if present
		const fileMatch = description.match(/in\s+(.+?\.\w+)/);
		if (fileMatch) {
			return `${gate}:${fileMatch[1]}`;
		}
		return `${gate}:${description.slice(0, 80)}`;
	}
}

/**
 * Convenience function: create a Reconciler and run a single sweep.
 */
export async function reconcile(
	config: Partial<ReconcilerConfig> & Pick<ReconcilerConfig, "projectPath">,
	logger: Logger,
): Promise<ReconcilerResult> {
	const reconciler = new Reconciler(config, logger);
	return reconciler.reconcile();
}
