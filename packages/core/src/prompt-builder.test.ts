import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { buildPrompt, type PromptContext } from "./prompt-builder.js";

function baseCtx(overrides: Partial<PromptContext> = {}): PromptContext {
	return {
		task: "Implement the foobar feature",
		projectId: "my-project",
		rootPath: "/home/user/my-project",
		defaultBranch: "main",
		branch: "uc/foobar",
		agentType: "claude-code",
		sessionId: "sess-001",
		...overrides,
	};
}

describe("buildPrompt", () => {
	const tempFiles: string[] = [];

	afterEach(() => {
		for (const f of tempFiles) {
			try {
				unlinkSync(f);
			} catch {
				// ignore
			}
		}
		tempFiles.length = 0;
	});

	it("includes all four layers in the output", () => {
		const prompt = buildPrompt(baseCtx());

		// Layer 1: base instructions
		expect(prompt).toContain("## Ultracoder Instructions");
		expect(prompt).toContain("session sess-001");
		expect(prompt).toContain("`uc/foobar`");
		expect(prompt).toContain("`main`");

		// Layer 2: project context
		expect(prompt).toContain("## Project Context");
		expect(prompt).toContain("my-project");
		expect(prompt).toContain("/home/user/my-project");

		// Layer 3: no rules — should not appear
		expect(prompt).not.toContain("## Agent Rules");

		// Layer 4: task
		expect(prompt).toContain("## Task");
		expect(prompt).toContain("Implement the foobar feature");
	});

	it("adds 'Fixes #N' instruction when metadata.issueId is present", () => {
		const prompt = buildPrompt(
			baseCtx({ metadata: { issueId: 42 } }),
		);

		expect(prompt).toContain('Fixes #42');
	});

	it("does not mention Fixes when issueId is absent", () => {
		const prompt = buildPrompt(baseCtx());
		expect(prompt).not.toContain("Fixes #");
	});

	it("includes inline agentRules text", () => {
		const prompt = buildPrompt(
			baseCtx({ agentRules: "Always use strict TypeScript." }),
		);

		expect(prompt).toContain("## Agent Rules");
		expect(prompt).toContain("Always use strict TypeScript.");
	});

	it("reads agentRulesFile from disk and includes content", () => {
		const dir = mkdtempSync(join(tmpdir(), "uc-test-"));
		const rulesPath = join(dir, "rules.txt");
		writeFileSync(rulesPath, "Never use any.\nPrefer const.\n");
		tempFiles.push(rulesPath);

		const prompt = buildPrompt(
			baseCtx({ agentRulesFile: rulesPath }),
		);

		expect(prompt).toContain("## Agent Rules");
		expect(prompt).toContain("Never use any.");
		expect(prompt).toContain("Prefer const.");
	});

	it("handles missing agentRulesFile gracefully", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const prompt = buildPrompt(
			baseCtx({ agentRulesFile: "/nonexistent/rules.txt" }),
		);

		// Should not throw; should skip rules layer
		expect(prompt).not.toContain("## Agent Rules");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Could not read agentRulesFile"),
		);

		warnSpy.mockRestore();
	});

	it("adds experiment context when metadata.experiment is present", () => {
		const prompt = buildPrompt(
			baseCtx({
				metadata: {
					experiment: {
						objective: "Improve test coverage",
						metric: {
							name: "coverage",
							direction: "up",
							target: 95,
						},
					},
				},
			}),
		);

		expect(prompt).toContain("### Experiment Mode");
		expect(prompt).toContain("Improve test coverage");
		expect(prompt).toContain("coverage");
		expect(prompt).toContain("Direction: up");
		expect(prompt).toContain("Target: 95");
		expect(prompt).toContain("Iterate to improve the metric");
	});

	it("inline agentRules takes priority over agentRulesFile", () => {
		const dir = mkdtempSync(join(tmpdir(), "uc-test-"));
		const rulesPath = join(dir, "rules.txt");
		writeFileSync(rulesPath, "File-based rules.");
		tempFiles.push(rulesPath);

		const prompt = buildPrompt(
			baseCtx({
				agentRules: "Inline rules win.",
				agentRulesFile: rulesPath,
			}),
		);

		expect(prompt).toContain("Inline rules win.");
		expect(prompt).not.toContain("File-based rules.");
	});
});
