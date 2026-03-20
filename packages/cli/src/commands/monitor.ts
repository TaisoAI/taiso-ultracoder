import { Command } from "commander";
import { buildContext } from "../context.js";

export function monitorCommand(): Command {
	const cmd = new Command("monitor").description("Issue monitoring and auto-triage");

	cmd
		.command("start")
		.description("Start issue monitoring (runs in the orchestrator loop)")
		.action(async () => {
			const ctx = await buildContext();
			const config = ctx.config.issueMonitor;

			if (!config.enabled) {
				console.log("Issue monitor is disabled in config. Set issueMonitor.enabled: true");
				return;
			}

			const { IssueMonitor } = await import("@ultracoder/issue-monitor");
			const monitor = new IssueMonitor(ctx, config);
			await monitor.init();

			console.log("Issue monitor started");
			console.log(`  Poll interval: ${config.pollIntervalMs}ms`);
			console.log(`  Filter labels: ${config.filter.labels?.join(", ") || "(none)"}`);
			console.log(`  Max effort: ${config.maxEffort ?? "(unlimited)"}`);

			// Run poll loop using recursive setTimeout to avoid overlap
			let stopped = false;
			const scheduleNext = () => {
				if (stopped) return;
				return setTimeout(async () => {
					try {
						await monitor.poll();
					} catch (err) {
						console.error("Poll error:", err instanceof Error ? err.message : String(err));
					}
					scheduleNext();
				}, config.pollIntervalMs);
			};

			await monitor.poll();
			scheduleNext();

			process.on("SIGINT", () => {
				stopped = true;
				console.log("\nMonitor stopped.");
				process.exit(0);
			});
		});

	cmd
		.command("stop")
		.description("Stop issue monitoring")
		.action(() => {
			console.log("Monitor stop is handled by stopping the orchestrator (uc stop).");
		});

	cmd
		.command("status")
		.description("Show monitored issues and their states")
		.action(async () => {
			const ctx = await buildContext();
			const config = ctx.config.issueMonitor;

			console.log("Issue Monitor Configuration:");
			console.log(`  Enabled:       ${config.enabled}`);
			console.log(`  Poll interval: ${config.pollIntervalMs}ms`);
			console.log(`  Filter labels: ${config.filter.labels?.join(", ") || "(none)"}`);
			console.log(`  Max effort:    ${config.maxEffort ?? "(unlimited)"}`);
			console.log();

			const { IssueMonitor } = await import("@ultracoder/issue-monitor");
			const monitor = new IssueMonitor(ctx, config);
			await monitor.init();

			const records = await monitor.getRecords();
			if (records.length === 0) {
				console.log("No tracked issues.");
				return;
			}

			console.log(`Tracked Issues (${records.length}):`);
			console.log("─".repeat(80));

			for (const r of records) {
				const age = Math.round(
					(Date.now() - new Date(r.firstSeenAt).getTime()) / 60000,
				);
				console.log(
					`  #${r.issueId.padEnd(6)} ${r.state.padEnd(12)} ${r.title.slice(0, 50).padEnd(52)} ${age}m ago`,
				);
				if (r.sessionId) {
					console.log(`           └─ session: ${r.sessionId}`);
				}
				if (r.error) {
					console.log(`           └─ error: ${r.error}`);
				}
			}
		});

	cmd
		.command("assess")
		.description("Manually trigger dual assessment for an issue")
		.argument("<id>", "GitHub issue number")
		.action(async (id: string) => {
			const ctx = await buildContext();
			const config = ctx.config.issueMonitor;

			const { IssueMonitor } = await import("@ultracoder/issue-monitor");
			const monitor = new IssueMonitor(ctx, config);
			await monitor.init();

			console.log(`Assessing issue #${id}...`);
			try {
				await monitor.assessIssue(id);
				console.log("Assessment complete. Run 'uc monitor status' to see results.");
			} catch (err) {
				console.error("Assessment failed:", err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	return cmd;
}
