import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes to stderr by default", () => {
		const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const logger = createLogger({ level: "info" });
		logger.info("hello");
		expect(writeSpy).toHaveBeenCalledOnce();
		expect(writeSpy.mock.calls[0][0]).toContain("hello");
	});

	it("respects log level", () => {
		const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const logger = createLogger({ level: "warn" });
		logger.debug("skip");
		logger.info("skip");
		logger.warn("show");
		expect(writeSpy).toHaveBeenCalledOnce();
	});

	it("child logger inherits context", () => {
		const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const logger = createLogger({ level: "info", context: { component: "core" } });
		const child = logger.child({ sessionId: "abc" });
		child.info("test");
		const output = writeSpy.mock.calls[0][0] as string;
		expect(output).toContain("core");
		expect(output).toContain("abc");
	});
});
