import { describe, expect, it } from "vitest";
import { createPathResolver, globalConfigPath } from "./paths.js";

describe("createPathResolver", () => {
	it("returns consistent paths for same projectId", () => {
		const p1 = createPathResolver("my-project", "/tmp/uc");
		const p2 = createPathResolver("my-project", "/tmp/uc");
		expect(p1.dataDir()).toBe(p2.dataDir());
	});

	it("returns different paths for different projectIds", () => {
		const p1 = createPathResolver("project-a", "/tmp/uc");
		const p2 = createPathResolver("project-b", "/tmp/uc");
		expect(p1.dataDir()).not.toBe(p2.dataDir());
	});

	it("sessionDir is under dataDir", () => {
		const p = createPathResolver("test", "/tmp/uc");
		expect(p.sessionDir("abc")).toContain(p.dataDir());
		expect(p.sessionDir("abc")).toContain("abc");
	});

	it("sessionFile is inside sessionDir", () => {
		const p = createPathResolver("test", "/tmp/uc");
		expect(p.sessionFile("abc")).toContain(p.sessionDir("abc"));
		expect(p.sessionFile("abc")).toContain("session.json");
	});
});

describe("globalConfigPath", () => {
	it("returns a path under the base dir", () => {
		expect(globalConfigPath("/tmp/uc")).toContain("config.yaml");
	});
});
