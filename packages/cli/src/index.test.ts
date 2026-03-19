import { describe, expect, it } from "vitest";
import { createProgram } from "./index.js";

describe("CLI", () => {
	it("creates program with all commands", () => {
		const program = createProgram();
		expect(program.name()).toBe("uc");

		const commandNames = program.commands.map((c) => c.name());
		expect(commandNames).toContain("init");
		expect(commandNames).toContain("spawn");
		expect(commandNames).toContain("send");
		expect(commandNames).toContain("status");
		expect(commandNames).toContain("kill");
		expect(commandNames).toContain("cleanup");
		expect(commandNames).toContain("doctor");
		expect(commandNames).toContain("watch");
		expect(commandNames).toContain("logs");
		expect(commandNames).toHaveLength(9);
	});
});
