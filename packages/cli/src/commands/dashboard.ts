import type { Session, SessionStatus } from "@ultracoder/core";
import { Command } from "commander";
import { buildContext } from "../context.js";

// ─── ANSI helpers ───────────────────────────────────────────────────

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

const FG = {
	red: `${ESC}[31m`,
	green: `${ESC}[32m`,
	yellow: `${ESC}[33m`,
	blue: `${ESC}[34m`,
	magenta: `${ESC}[35m`,
	cyan: `${ESC}[36m`,
	white: `${ESC}[37m`,
	gray: `${ESC}[90m`,
} as const;

function colorForStatus(status: SessionStatus): string {
	switch (status) {
		case "working":
		case "spawning":
			return FG.green;
		case "failed":
		case "killed":
		case "ci_failed":
			return FG.red;
		case "pr_open":
		case "review_pending":
			return FG.blue;
		case "merged":
			return FG.cyan;
		case "approved":
		case "mergeable":
			return FG.magenta;
		case "changes_requested":
		case "merge_conflicts":
			return FG.yellow;
		case "archived":
			return FG.gray;
		default:
			return FG.white;
	}
}

function colorize(text: string, color: string): string {
	return `${color}${text}${RESET}`;
}

// ─── Formatting helpers ─────────────────────────────────────────────

function formatDuration(createdAt: string): string {
	const ms = Date.now() - new Date(createdAt).getTime();
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 1)}\u2026`;
}

function getIntent(session: Session): string {
	const intent = session.metadata?.intent;
	if (typeof intent === "string") return intent;
	return "-";
}

function estimateCost(session: Session): number {
	const cost = session.metadata?.costUsd;
	if (typeof cost === "number") return cost;
	return 0;
}

// ─── Render ─────────────────────────────────────────────────────────

function render(sessions: Session[], projectName: string): string {
	const lines: string[] = [];
	const now = new Date().toLocaleTimeString();
	const width = process.stdout.columns || 80;

	// Header
	lines.push("");
	lines.push(
		`  ${BOLD}${FG.cyan}Ultracoder Dashboard${RESET}  ${DIM}${projectName}${RESET}  ${DIM}${now}${RESET}`,
	);
	lines.push(`  ${DIM}${"─".repeat(Math.min(width - 4, 76))}${RESET}`);

	if (sessions.length === 0) {
		lines.push("");
		lines.push(`  ${DIM}No active sessions${RESET}`);
		lines.push("");
		lines.push(`  ${DIM}Press Ctrl+C to exit${RESET}`);
		return lines.join("\n");
	}

	// Session table header
	const hdr = `  ${"ID".padEnd(10)} ${"Status".padEnd(16)} ${"Agent".padEnd(14)} ${"Intent".padEnd(12)} ${"Duration".padEnd(10)} Task`;
	lines.push("");
	lines.push(`  ${BOLD}${hdr.trim()}${RESET}`);
	lines.push(`  ${DIM}${"-".repeat(Math.min(width - 4, 86))}${RESET}`);

	// Session rows
	for (const s of sessions) {
		const statusColor = colorForStatus(s.status);
		const statusStr = colorize(s.status.padEnd(16), statusColor);
		const intent = truncate(getIntent(s), 12).padEnd(12);
		const duration = formatDuration(s.createdAt).padEnd(10);
		const task = truncate(s.task, Math.max(width - 74, 20));

		lines.push(
			`  ${s.id.padEnd(10)} ${statusStr} ${s.agentType.padEnd(14)} ${intent} ${duration} ${task}`,
		);
	}

	// Cost summary
	const totalCost = sessions.reduce((sum, s) => sum + estimateCost(s), 0);
	const activeSessions = sessions.filter(
		(s) => s.status === "working" || s.status === "spawning",
	).length;
	const failedSessions = sessions.filter(
		(s) => s.status === "failed" || s.status === "killed",
	).length;

	lines.push("");
	lines.push(`  ${DIM}${"─".repeat(Math.min(width - 4, 76))}${RESET}`);
	lines.push(
		`  ${BOLD}Sessions:${RESET} ${sessions.length} total  ${colorize(`${activeSessions} active`, FG.green)}${failedSessions > 0 ? `  ${colorize(`${failedSessions} failed`, FG.red)}` : ""}${totalCost > 0 ? `  ${DIM}Cost: $${totalCost.toFixed(2)}${RESET}` : ""}`,
	);

	// Warnings: sessions stuck in spawning for > 5 minutes
	const warnings: string[] = [];
	for (const s of sessions) {
		const age = Date.now() - new Date(s.createdAt).getTime();
		if (s.status === "spawning" && age > 5 * 60 * 1000) {
			warnings.push(`Session ${s.id} stuck in spawning for ${formatDuration(s.createdAt)}`);
		}
		if (s.status === "ci_failed") {
			warnings.push(`Session ${s.id} has CI failures`);
		}
		if (s.status === "merge_conflicts") {
			warnings.push(`Session ${s.id} has merge conflicts`);
		}
	}

	if (warnings.length > 0) {
		lines.push("");
		lines.push(`  ${BOLD}${FG.yellow}Warnings:${RESET}`);
		for (const w of warnings) {
			lines.push(`  ${FG.yellow}  ! ${w}${RESET}`);
		}
	}

	// Footer
	lines.push("");
	lines.push(`  ${DIM}Press Ctrl+C to exit${RESET}`);

	return lines.join("\n");
}

// ─── Command ────────────────────────────────────────────────────────

export function dashboardCommand(): Command {
	return new Command("dashboard")
		.description("Rich terminal dashboard showing session status, cost, and warnings")
		.option("-r, --refresh <ms>", "Refresh interval in milliseconds", "2000")
		.action(async (opts: { refresh: string }) => {
			const refreshMs = Number.parseInt(opts.refresh, 10) || 2000;
			const ctx = await buildContext();
			const projectName = ctx.config.projectId;

			const tick = async () => {
				const sessions = await ctx.sessions.list();
				// Clear screen + move cursor to top-left
				process.stdout.write(`${ESC}[2J${ESC}[H`);
				process.stdout.write(render(sessions, projectName));
			};

			await tick();
			const interval = setInterval(tick, refreshMs);

			process.on("SIGINT", () => {
				clearInterval(interval);
				// Show cursor, reset colors
				process.stdout.write(`${ESC}[?25h${RESET}\n`);
				process.exit(0);
			});
		});
}
