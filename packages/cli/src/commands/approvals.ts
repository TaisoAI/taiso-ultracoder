import { ApprovalGate } from "@ultracoder/quality";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function approvalsCommand(): Command {
	return new Command("approvals")
		.description("List pending tool call approvals")
		.action(async () => {
			const ctx = await buildContext();
			const gate = new ApprovalGate(`${ctx.paths.dataDir()}/approvals`);
			await gate.sweepTimeouts();
			const pending = await gate.getPending();

			if (pending.length === 0) {
				console.log("No pending approvals");
				return;
			}

			console.log(
				`${"ID".padEnd(10)} ${"Tool".padEnd(30)} ${"Session".padEnd(12)} ${"Requested".padEnd(26)} Context`,
			);
			console.log("-".repeat(100));
			for (const a of pending) {
				console.log(
					`${a.id.padEnd(10)} ${a.tool.padEnd(30)} ${a.sessionId.padEnd(12)} ${a.requestedAt.padEnd(26)} ${a.context}`,
				);
			}
		});
}
