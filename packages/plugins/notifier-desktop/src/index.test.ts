import { describe, expect, it } from "vitest";
import { create, sanitizeForShell } from "./index.js";

describe("notifier-desktop", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("notifier-desktop");
		expect(plugin.meta.slot).toBe("notifier");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has notify method", () => {
		const plugin = create();
		expect(typeof plugin.notify).toBe("function");
	});

	it("accepts platform override config", () => {
		const plugin = create({ platform: "linux" });
		expect(plugin.meta.name).toBe("notifier-desktop");
	});
});

describe("sanitizeForShell", () => {
	it("allows alphanumeric characters", () => {
		expect(sanitizeForShell("Hello123")).toBe("Hello123");
	});

	it("allows spaces and basic punctuation", () => {
		expect(sanitizeForShell("Hello, world! Done.")).toBe("Hello, world! Done.");
	});

	it("allows parentheses, colons, semicolons, hyphens", () => {
		expect(sanitizeForShell("Task (done): ok; next-step")).toBe("Task (done): ok; next-step");
	});

	it("allows question marks", () => {
		expect(sanitizeForShell("Ready?")).toBe("Ready?");
	});

	it("strips double quotes", () => {
		expect(sanitizeForShell('He said "hello"')).toBe("He said hello");
	});

	it("strips single quotes", () => {
		expect(sanitizeForShell("it's fine")).toBe("its fine");
	});

	it("strips backticks", () => {
		expect(sanitizeForShell("run `cmd`")).toBe("run cmd");
	});

	it("strips dollar signs", () => {
		expect(sanitizeForShell("cost $100")).toBe("cost 100");
	});

	it("strips backslashes", () => {
		expect(sanitizeForShell("path\\to\\file")).toBe("pathtofile");
	});

	it("strips newlines and tabs", () => {
		expect(sanitizeForShell("line1\nline2\ttab")).toBe("line1line2tab");
	});

	it("strips angle brackets and ampersands", () => {
		expect(sanitizeForShell("<script>alert&run</script>")).toBe("scriptalertrunscript");
	});

	it("handles empty string", () => {
		expect(sanitizeForShell("")).toBe("");
	});

	it("strips pipe and redirect characters", () => {
		expect(sanitizeForShell("cmd | rm -rf > /dev/null")).toBe("cmd  rm -rf  devnull");
	});
});
