import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("notifier-slack", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" });
		expect(plugin.meta.name).toBe("notifier-slack");
		expect(plugin.meta.slot).toBe("notifier");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has notify method", () => {
		const plugin = create({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" });
		expect(typeof plugin.notify).toBe("function");
	});
});

describe("webhook URL validation", () => {
	it("accepts valid Slack webhook URL", () => {
		expect(() =>
			create({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" }),
		).not.toThrow();
	});

	it("rejects HTTP (non-HTTPS) webhook URL", () => {
		expect(() => create({ webhookUrl: "http://hooks.slack.com/services/T00/B00/xxx" })).toThrow(
			"Invalid Slack webhook URL",
		);
	});

	it("rejects arbitrary HTTPS URL", () => {
		expect(() => create({ webhookUrl: "https://evil.example.com/webhook" })).toThrow(
			"Invalid Slack webhook URL",
		);
	});

	it("rejects empty string", () => {
		expect(() => create({ webhookUrl: "" })).toThrow("Invalid Slack webhook URL");
	});

	it("rejects URL with wrong path prefix", () => {
		expect(() => create({ webhookUrl: "https://hooks.slack.com/workflows/T00/B00/xxx" })).toThrow(
			"Invalid Slack webhook URL",
		);
	});

	it("rejects URL that only partially matches", () => {
		expect(() => create({ webhookUrl: "https://hooks.slack.com.evil.com/services/T00" })).toThrow(
			"Invalid Slack webhook URL",
		);
	});
});
