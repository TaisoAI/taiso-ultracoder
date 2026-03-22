import { ApprovalGate } from "@ultracoder/quality";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function approveCommand(): Command {
	return new Command("approve")
		.description("Approve a pending tool call")
		.argument("<id>", "Approval ID")
		.action(async (id: string) => {
			const ctx = await buildContext();
			const gate = new ApprovalGate(`${ctx.paths.dataDir()}/approvals`);
			try {
				const result = await gate.respond(id, "approve");
				console.log(`Approved: ${result.id} (${result.tool})`);
			} catch (err) {
				console.error((err as Error).message);
				process.exit(1);
			}
		});
}
