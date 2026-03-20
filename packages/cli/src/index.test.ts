import { describe, expect, it } from "vitest";
import { spawnCommand } from "./commands/spawn.js";
import { createProgram } from "./index.js";

describe("CLI", () => {
	it("creates program with all commands", () => {
		const program = createProgram();
		expect(program.name()).toBe("uc");

		const commandNames = program.commands.map((c) => c.name());
		expect(commandNames).toContain("init");
		expect(commandNames).toContain("spawn");
		expect(commandNames).toContain("start");
		expect(commandNames).toContain("stop");
		expect(commandNames).toContain("batch-spawn");
		expect(commandNames).toContain("send");
		expect(commandNames).toContain("status");
		expect(commandNames).toContain("kill");
		expect(commandNames).toContain("cleanup");
		expect(commandNames).toContain("doctor");
		expect(commandNames).toContain("watch");
		expect(commandNames).toContain("logs");
		expect(commandNames).toContain("dashboard");
		expect(commandNames).toContain("monitor");
		expect(commandNames).toHaveLength(14);
	});
});

describe("spawn command", () => {
	it("is named spawn with correct description", () => {
		const cmd = spawnCommand();
		expect(cmd.name()).toBe("spawn");
		expect(cmd.description()).toBe("Spawn a new agent session");
	});

	it("requires a task argument", () => {
		const cmd = spawnCommand();
		// Commander stores registered arguments
		const args = cmd.registeredArguments;
		expect(args).toHaveLength(1);
		expect(args[0].name()).toBe("task");
		expect(args[0].required).toBe(true);
	});

	it("accepts --agent and --branch options", () => {
		const cmd = spawnCommand();
		const agentOpt = cmd.options.find((o) => o.long === "--agent");
		const branchOpt = cmd.options.find((o) => o.long === "--branch");

		expect(agentOpt).toBeDefined();
		expect(agentOpt!.short).toBe("-a");
		expect(agentOpt!.defaultValue).toBe("claude-code");

		expect(branchOpt).toBeDefined();
		expect(branchOpt!.short).toBe("-b");
	});
});
