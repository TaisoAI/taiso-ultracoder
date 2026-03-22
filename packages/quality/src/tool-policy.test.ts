import { describe, expect, it } from "vitest";
import { evaluateHeuristic, evaluateToolPolicy } from "./tool-policy.js";
import type { EvaluateContext } from "./tool-policy.js";

describe("evaluateToolPolicy", () => {
	it("returns auto when disabled", () => {
		const result = evaluateToolPolicy("bash:rm -rf /", {
			enabled: false,
			defaultTier: "evaluate",
		});
		expect(result.tier).toBe("auto");
		expect(result.allowed).toBe(true);
	});

	it("blocks writes to .env files", () => {
		const result = evaluateToolPolicy("write:.env.production", {
			enabled: true,
			defaultTier: "auto",
		});
		expect(result.tier).toBe("blocked");
		expect(result.allowed).toBe(false);
	});

	it("requires human approval for rm commands", () => {
		const result = evaluateToolPolicy("bash:rm -rf node_modules", {
			enabled: true,
			defaultTier: "auto",
		});
		expect(result.tier).toBe("human");
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	it("uses default tier for unknown tools", () => {
		const result = evaluateToolPolicy("read:package.json", {
			enabled: true,
			defaultTier: "auto",
		});
		expect(result.tier).toBe("auto");
		expect(result.allowed).toBe(true);
	});

	it("respects custom rules", () => {
		const result = evaluateToolPolicy("bash:deploy production", {
			enabled: true,
			defaultTier: "auto",
			rules: [{ pattern: "bash:deploy*", tier: "blocked", reason: "No deploys" }],
		});
		expect(result.tier).toBe("blocked");
		expect(result.allowed).toBe(false);
	});

	it("runs heuristic checks when tier is evaluate and context is provided", () => {
		const context: EvaluateContext = {
			sessionId: "test-session",
			workspacePath: "/workspace/project",
		};
		const result = evaluateToolPolicy(
			"bash:curl https://example.com",
			{ enabled: true, defaultTier: "auto" },
			["https://example.com"],
			context,
		);
		// curl matches evaluate tier; heuristic passes so tier becomes auto
		expect(result.allowed).toBe(true);
		expect(result.tier).toBe("auto");
	});

	it("blocks via heuristic when evaluate tier detects private IP", () => {
		const context: EvaluateContext = {
			sessionId: "test-session",
			workspacePath: "/workspace/project",
		};
		const result = evaluateToolPolicy(
			"bash:curl http://10.0.0.1/api",
			{ enabled: true, defaultTier: "auto" },
			["http://10.0.0.1/api"],
			context,
		);
		expect(result.allowed).toBe(false);
		expect(result.tier).toBe("blocked");
		expect(result.reason).toContain("private/local network");
	});

	it("runs heuristic for default evaluate tier with context", () => {
		const context: EvaluateContext = {
			sessionId: "test-session",
			workspacePath: "/workspace/project",
		};
		const result = evaluateToolPolicy(
			"custom:tool",
			{ enabled: true, defaultTier: "evaluate" },
			["https://safe.example.com"],
			context,
		);
		expect(result.allowed).toBe(true);
		expect(result.tier).toBe("auto");
	});
});

describe("evaluateHeuristic", () => {
	const baseContext: EvaluateContext = {
		sessionId: "test-session",
		workspacePath: "/workspace/project",
	};

	describe("network boundary rules", () => {
		it("blocks RFC 1918 10.x.x.x addresses", () => {
			const result = evaluateHeuristic("bash:curl", ["http://10.0.0.1/api"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
			expect(result.reason).toContain("private/local network");
		});

		it("blocks RFC 1918 172.16-31.x.x addresses", () => {
			const result = evaluateHeuristic("bash:curl", ["https://172.16.0.1"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});

		it("does not block 172.15.x.x (not RFC 1918)", () => {
			const result = evaluateHeuristic("bash:curl", ["https://172.15.0.1"], baseContext);
			expect(result.allowed).toBe(true);
			expect(result.category).toBe("none");
		});

		it("blocks RFC 1918 192.168.x.x addresses", () => {
			const result = evaluateHeuristic("bash:curl", ["https://192.168.1.1"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});

		it("blocks link-local 169.254.x.x addresses", () => {
			const result = evaluateHeuristic(
				"bash:curl",
				["https://169.254.169.254/metadata"],
				baseContext,
			);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});

		it("blocks localhost", () => {
			const result = evaluateHeuristic("bash:curl", ["https://localhost:3000"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});

		it("blocks 127.0.0.1", () => {
			const result = evaluateHeuristic("bash:curl", ["http://127.0.0.1:8080"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});

		it("blocks HTTP URLs (requires HTTPS)", () => {
			const result = evaluateHeuristic("bash:curl", ["http://example.com/api"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
			expect(result.reason).toContain("HTTPS");
		});

		it("allows HTTPS URLs to public hosts", () => {
			const result = evaluateHeuristic("bash:curl", ["https://api.example.com/data"], baseContext);
			expect(result.allowed).toBe(true);
			expect(result.category).toBe("none");
		});

		it("checks across multiple args", () => {
			const result = evaluateHeuristic(
				"bash:curl",
				["-H", "Auth: token", "https://192.168.0.1"],
				baseContext,
			);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("network");
		});
	});

	describe("scope containment rules", () => {
		it("allows paths within workspace", () => {
			const result = evaluateHeuristic(
				"write:file",
				["/workspace/project/src/index.ts"],
				baseContext,
			);
			expect(result.allowed).toBe(true);
		});

		it("blocks paths outside workspace", () => {
			const result = evaluateHeuristic("write:file", ["/etc/passwd"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("scope");
			expect(result.reason).toContain("outside workspace");
		});

		it("blocks path traversal attempts", () => {
			const result = evaluateHeuristic(
				"write:file",
				["/workspace/project/../../etc/shadow"],
				baseContext,
			);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("scope");
		});

		it("allows paths within assigned scope", () => {
			const context: EvaluateContext = {
				...baseContext,
				assignedScope: ["src/", "tests/"],
			};
			const result = evaluateHeuristic("write:file", ["/workspace/project/src/main.ts"], context);
			expect(result.allowed).toBe(true);
		});

		it("blocks paths outside assigned scope but within workspace", () => {
			const context: EvaluateContext = {
				...baseContext,
				assignedScope: ["src/"],
			};
			const result = evaluateHeuristic(
				"write:file",
				["/workspace/project/docs/readme.md"],
				context,
			);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("scope");
			expect(result.reason).toContain("outside assigned scope");
		});

		it("handles relative paths with ./", () => {
			const result = evaluateHeuristic("write:file", ["./src/index.ts"], baseContext);
			expect(result.allowed).toBe(true);
		});

		it("blocks relative path traversal outside workspace", () => {
			const result = evaluateHeuristic("write:file", ["../../../etc/passwd"], baseContext);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("scope");
		});

		it("ignores non-path arguments", () => {
			const result = evaluateHeuristic("bash:echo", ["hello", "world"], baseContext);
			expect(result.allowed).toBe(true);
		});
	});

	describe("resource limit rules", () => {
		it("blocks when bytes written exceeds max file size", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 1, bytesWritten: 2000000 },
			};
			const result = evaluateHeuristic("write:file", [], context);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("resource");
			expect(result.reason).toContain("bytes written");
		});

		it("blocks when files modified exceeds limit", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 150, bytesWritten: 100 },
			};
			const result = evaluateHeuristic("write:file", [], context);
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("resource");
			expect(result.reason).toContain("files modified");
		});

		it("allows within default resource limits", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 5, bytesWritten: 1000 },
			};
			const result = evaluateHeuristic("write:file", [], context);
			expect(result.allowed).toBe(true);
		});

		it("respects custom max file size", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 1, bytesWritten: 500 },
			};
			const result = evaluateHeuristic("write:file", [], context, {
				maxFileSize: 100,
			});
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("resource");
		});

		it("respects custom max files modified", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 10, bytesWritten: 100 },
			};
			const result = evaluateHeuristic("write:file", [], context, {
				maxFilesModified: 5,
			});
			expect(result.allowed).toBe(false);
			expect(result.category).toBe("resource");
		});

		it("passes when no resource usage is provided", () => {
			const result = evaluateHeuristic("write:file", [], baseContext);
			expect(result.allowed).toBe(true);
		});
	});

	describe("rule priority", () => {
		it("checks network before scope", () => {
			const result = evaluateHeuristic("bash:curl", ["http://10.0.0.1/etc/passwd"], baseContext);
			// Should fail on network, not scope
			expect(result.category).toBe("network");
		});

		it("returns allowed when all checks pass", () => {
			const context: EvaluateContext = {
				...baseContext,
				resourceUsage: { filesModified: 1, bytesWritten: 100 },
			};
			const result = evaluateHeuristic("write:file", ["/workspace/project/src/index.ts"], context);
			expect(result.allowed).toBe(true);
			expect(result.category).toBe("none");
			expect(result.reason).toBe("All heuristic checks passed");
		});
	});
});
