import { ApprovalGate } from "@ultracoder/quality";
import { Command } from "commander";

export function denyCommand(): Command {
	return new Command("deny")
		.description("Deny a pending tool call")
		.argument("<id>", "Approval ID")
		.argument("[reason]", "Reason for denial")
		.action(async (id: string, reason?: string) => {
			const gate = new ApprovalGate();
			try {
				const result = await gate.respond(id, "deny", reason);
				console.log(`Denied: ${result.id} (${result.tool})${reason ? ` — ${reason}` : ""}`);
			} catch (err) {
				console.error((err as Error).message);
				process.exit(1);
			}
		});
}
