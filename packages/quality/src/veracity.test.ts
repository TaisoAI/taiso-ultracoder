import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "@ultracoder/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkVeracity,
	checkVeracityFilesystem,
	checkVeracityLLM,
	checkVeracityRegex,
	parseLLMVeracityOutput,
} from "./veracity.js";

describe("checkVeracityRegex", () => {
	it("detects unverified package imports", () => {
		const content = `import foo from "some-nonexistent-package";`;
		const findings = checkVeracityRegex(content);
		expect(findings.length).toBeGreaterThan(0);
		expect(findings[0].message).toContain("package import");
	});

	it("detects URL references", () => {
		const content = "// See https://github.com/example/repo for details";
		const findings = checkVeracityRegex(content);
		expect(findings.some((f) => f.message.includes("URL"))).toBe(true);
	});

	it("detects version claims", () => {
		const content = "as of version 3.2.1, this API changed";
		const findings = checkVeracityRegex(content);
		expect(findings.some((f) => f.message.includes("Version claim"))).toBe(true);
	});

	it("returns empty for clean content", () => {
		const content = "const x = 1;\nconst y = x + 2;\n";
		const findings = checkVeracityRegex(content);
		expect(findings).toHaveLength(0);
	});

	// --- Hallucinated creation claims ---
	it("detects 'I've created' claims", () => {
		const findings = checkVeracityRegex("I've created a new file called utils.ts");
		expect(findings.some((f) => f.message.includes("creation claim"))).toBe(true);
	});

	it("detects 'I created' claims", () => {
		const findings = checkVeracityRegex("I created the helper function");
		expect(findings.some((f) => f.message.includes("creation claim"))).toBe(true);
	});

	it("detects 'I have created' claims", () => {
		const findings = checkVeracityRegex("I have created the module");
		expect(findings.some((f) => f.message.includes("creation claim"))).toBe(true);
	});

	// --- Hallucinated success claims ---
	it("detects 'successfully built' claims", () => {
		const findings = checkVeracityRegex("The project was successfully built");
		expect(findings.some((f) => f.message.includes("success claim"))).toBe(true);
	});

	it("detects 'successfully compiled' claims", () => {
		const findings = checkVeracityRegex("The code successfully compiled without errors");
		expect(findings.some((f) => f.message.includes("success claim"))).toBe(true);
	});

	it("detects 'successfully installed' claims", () => {
		const findings = checkVeracityRegex("I successfully installed the dependencies");
		expect(findings.some((f) => f.message.includes("success claim"))).toBe(true);
	});

	// --- Hallucinated execution claims ---
	it("detects 'I ran the command' claims", () => {
		const findings = checkVeracityRegex("I ran the command npm test");
		expect(findings.some((f) => f.message.includes("execution claim"))).toBe(true);
	});

	it("detects 'I executed' claims", () => {
		const findings = checkVeracityRegex("I executed the build script");
		expect(findings.some((f) => f.message.includes("execution claim"))).toBe(true);
	});

	it("detects 'I ran' claims", () => {
		const findings = checkVeracityRegex("I ran the tests and they all passed");
		expect(findings.some((f) => f.message.includes("execution claim"))).toBe(true);
	});

	// --- Hallucinated completeness claims ---
	it("detects 'all files in place' claims", () => {
		const findings = checkVeracityRegex("All files in place and ready to deploy");
		expect(findings.some((f) => f.message.includes("completeness claim"))).toBe(true);
	});

	it("detects 'all tests pass' claims", () => {
		const findings = checkVeracityRegex("All tests pass successfully");
		expect(findings.some((f) => f.message.includes("completeness claim"))).toBe(true);
	});

	it("detects 'everything is working' claims", () => {
		const findings = checkVeracityRegex("Everything is working as expected now");
		expect(findings.some((f) => f.message.includes("completeness claim"))).toBe(true);
	});

	// --- Hallucinated update/modification claims ---
	it("detects 'I've updated' claims", () => {
		const findings = checkVeracityRegex("I've updated the configuration file");
		expect(findings.some((f) => f.message.includes("update claim"))).toBe(true);
	});

	it("detects 'I've modified' claims", () => {
		const findings = checkVeracityRegex("I've modified the function signature");
		expect(findings.some((f) => f.message.includes("update claim"))).toBe(true);
	});

	it("detects 'I've added' claims", () => {
		const findings = checkVeracityRegex("I've added error handling to the function");
		expect(findings.some((f) => f.message.includes("update claim"))).toBe(true);
	});

	// --- Hallucinated passive-voice change claims ---
	it("detects 'the file has been' claims", () => {
		const findings = checkVeracityRegex("The file has been updated with the new logic");
		expect(findings.some((f) => f.message.includes("passive change claim"))).toBe(true);
	});

	it("detects 'the changes have been' claims", () => {
		const findings = checkVeracityRegex("The changes have been applied to main");
		expect(findings.some((f) => f.message.includes("passive change claim"))).toBe(true);
	});

	it("detects 'the change has been' claims", () => {
		const findings = checkVeracityRegex("The change has been committed");
		expect(findings.some((f) => f.message.includes("passive change claim"))).toBe(true);
	});

	// --- No false positives on code content ---
	it("does not flag patterns inside string literals", () => {
		const content = `const msg = "I've created a new instance";`;
		const findings = checkVeracityRegex(content);
		const creationFindings = findings.filter((f) => f.message.includes("creation claim"));
		expect(creationFindings).toHaveLength(0);
	});

	it("does not flag patterns inside backtick template literals", () => {
		const content = "const msg = `I've updated the config`;";
		const findings = checkVeracityRegex(content);
		const updateFindings = findings.filter((f) => f.message.includes("update claim"));
		expect(updateFindings).toHaveLength(0);
	});

	it("does not flag patterns inside single-quoted strings", () => {
		const content = "const msg = 'all tests pass';";
		const findings = checkVeracityRegex(content);
		const completenessFindings = findings.filter((f) => f.message.includes("completeness claim"));
		expect(completenessFindings).toHaveLength(0);
	});

	// --- All new findings have severity "warn" ---
	it("all hallucination findings have severity warn", () => {
		const proseLines = [
			"I've created a new file",
			"successfully built the project",
			"I ran the command",
			"all tests pass",
			"I've updated the config",
			"The file has been modified",
		];
		const findings = checkVeracityRegex(proseLines.join("\n"));
		for (const f of findings) {
			expect(f.severity).toBe("warn");
		}
	});
});

describe("checkVeracityFilesystem", () => {
	let tmpDir: string;

	function git(args: string, cwd?: string) {
		execSync(`git ${args}`, {
			cwd: cwd ?? tmpDir,
			stdio: "pipe",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "test",
				GIT_AUTHOR_EMAIL: "test@test.com",
				GIT_COMMITTER_NAME: "test",
				GIT_COMMITTER_EMAIL: "test@test.com",
			},
		});
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "veracity-fs-test-"));
		git("init");
		// Create an initial commit so HEAD exists
		fs.writeFileSync(path.join(tmpDir, "initial.txt"), "init");
		git("add .");
		git('commit -m "initial"');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns info findings for actually changed files when no claims provided", async () => {
		// Modify a tracked file
		fs.writeFileSync(path.join(tmpDir, "initial.txt"), "changed");
		const findings = await checkVeracityFilesystem(tmpDir);
		expect(findings.length).toBeGreaterThan(0);
		expect(findings.every((f) => f.tier === "filesystem")).toBe(true);
		expect(findings.every((f) => f.severity === "info")).toBe(true);
		expect(findings.some((f) => f.file === "initial.txt")).toBe(true);
	});

	it("returns error for claimed file that was not changed", async () => {
		const findings = await checkVeracityFilesystem(tmpDir, ["nonexistent.ts"]);
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe("error");
		expect(findings[0].file).toBe("nonexistent.ts");
		expect(findings[0].message).toContain("not found in git diff/status");
	});

	it("returns info for claimed file that was actually changed", async () => {
		fs.writeFileSync(path.join(tmpDir, "initial.txt"), "modified content");
		const findings = await checkVeracityFilesystem(tmpDir, ["initial.txt"]);
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe("info");
		expect(findings[0].message).toContain("verified as changed");
	});

	it("detects new untracked files via git status", async () => {
		fs.writeFileSync(path.join(tmpDir, "new-file.ts"), "export const x = 1;");
		const findings = await checkVeracityFilesystem(tmpDir, ["new-file.ts"]);
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe("info");
		expect(findings[0].file).toBe("new-file.ts");
	});

	it("detects staged files", async () => {
		fs.writeFileSync(path.join(tmpDir, "staged.ts"), "content");
		git("add staged.ts");
		const findings = await checkVeracityFilesystem(tmpDir, ["staged.ts"]);
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe("info");
	});

	it("returns mixed results for partially correct claims", async () => {
		fs.writeFileSync(path.join(tmpDir, "initial.txt"), "changed");
		const findings = await checkVeracityFilesystem(tmpDir, ["initial.txt", "does-not-exist.ts"]);
		expect(findings).toHaveLength(2);
		const infos = findings.filter((f) => f.severity === "info");
		const errors = findings.filter((f) => f.severity === "error");
		expect(infos).toHaveLength(1);
		expect(errors).toHaveLength(1);
		expect(infos[0].file).toBe("initial.txt");
		expect(errors[0].file).toBe("does-not-exist.ts");
	});

	it("returns empty findings for non-git directory with no claims", async () => {
		const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "veracity-nongit-"));
		try {
			const findings = await checkVeracityFilesystem(nonGitDir);
			expect(findings).toHaveLength(0);
		} finally {
			fs.rmSync(nonGitDir, { recursive: true, force: true });
		}
	});

	it("returns errors for claims in non-git directory", async () => {
		const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "veracity-nongit-"));
		try {
			const findings = await checkVeracityFilesystem(nonGitDir, ["file.ts"]);
			expect(findings).toHaveLength(1);
			expect(findings[0].severity).toBe("error");
		} finally {
			fs.rmSync(nonGitDir, { recursive: true, force: true });
		}
	});
});

// ─── parseLLMVeracityOutput ─────────────────────────────────────────

describe("parseLLMVeracityOutput", () => {
	it("parses valid findings", () => {
		const output = [
			'FINDING:warn:5:Claims "all tests pass" but no test output shown',
			"FINDING:error:12:References API endpoint that doesn't exist in the codebase",
		].join("\n");

		const findings = parseLLMVeracityOutput(output);
		expect(findings).toHaveLength(2);

		expect(findings[0]).toEqual({
			tier: "llm",
			message: 'Claims "all tests pass" but no test output shown',
			line: 5,
			severity: "warn",
		});

		expect(findings[1]).toEqual({
			tier: "llm",
			message: "References API endpoint that doesn't exist in the codebase",
			line: 12,
			severity: "error",
		});
	});

	it("returns empty array for NO_ISSUES", () => {
		const findings = parseLLMVeracityOutput("NO_ISSUES");
		expect(findings).toHaveLength(0);
	});

	it("returns empty array for empty output", () => {
		const findings = parseLLMVeracityOutput("");
		expect(findings).toHaveLength(0);
	});

	it("returns empty array for malformed output", () => {
		const output = [
			"This is not a valid format",
			"FINDING:badlevel:5:some issue",
			"FINDING:warn:notanumber:some issue",
			"FINDING:warn:5:",
			"FINDING:warn",
			"random text",
		].join("\n");

		const findings = parseLLMVeracityOutput(output);
		expect(findings).toHaveLength(0);
	});

	it("handles mixed severity findings", () => {
		const output = [
			"FINDING:info:1:Minor observation about style",
			"FINDING:warn:10:Unsubstantiated performance claim",
			"FINDING:error:20:Fabricated API reference",
		].join("\n");

		const findings = parseLLMVeracityOutput(output);
		expect(findings).toHaveLength(3);
		expect(findings[0].severity).toBe("info");
		expect(findings[1].severity).toBe("warn");
		expect(findings[2].severity).toBe("error");
		expect(findings[0].line).toBe(1);
		expect(findings[1].line).toBe(10);
		expect(findings[2].line).toBe(20);
	});

	it("skips malformed lines and keeps valid ones", () => {
		const output = [
			"FINDING:warn:5:Valid finding",
			"This line is not a finding",
			"FINDING:error:10:Another valid finding",
		].join("\n");

		const findings = parseLLMVeracityOutput(output);
		expect(findings).toHaveLength(2);
		expect(findings[0].message).toBe("Valid finding");
		expect(findings[1].message).toBe("Another valid finding");
	});
});

// ─── checkVeracityLLM ───────────────────────────────────────────────

function makeLogger(): Logger {
	const noop = () => {};
	return {
		debug: noop,
		info: noop,
		warn: vi.fn(),
		error: noop,
		child: () => makeLogger(),
	};
}

describe("checkVeracityLLM", () => {
	let scriptDir: string;

	/** Create a shell script that outputs the contents of a file to stdout. */
	function makeAgentScript(stdout: string): string {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const dataPath = path.join(scriptDir, `data-${id}.txt`);
		const scriptPath = path.join(scriptDir, `agent-${id}.sh`);
		fs.writeFileSync(dataPath, stdout);
		fs.writeFileSync(scriptPath, `#!/bin/sh\ncat ${JSON.stringify(dataPath)}\n`, { mode: 0o755 });
		return scriptPath;
	}

	/** Create a shell script that exits with an error. */
	function makeFailingScript(): string {
		const scriptPath = path.join(scriptDir, `fail-${Date.now()}.sh`);
		fs.writeFileSync(scriptPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		return scriptPath;
	}

	beforeEach(() => {
		scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "veracity-llm-test-"));
	});

	afterEach(() => {
		fs.rmSync(scriptDir, { recursive: true, force: true });
	});

	it("returns empty array on agent error (graceful degradation)", async () => {
		const logger = makeLogger();
		const findings = await checkVeracityLLM("some content", logger, {
			agentPath: "/nonexistent/binary",
			timeoutMs: 5000,
		});
		expect(findings).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalled();
	});

	it("returns findings for ungrounded claims", async () => {
		const stdout = [
			'FINDING:warn:3:Claims "all tests pass" but no test output provided',
			"FINDING:error:7:References non-existent API endpoint /api/v3/sync",
		].join("\n");
		const agentPath = makeAgentScript(stdout);

		const logger = makeLogger();
		const findings = await checkVeracityLLM("some agent output", logger, { agentPath });

		expect(findings).toHaveLength(2);
		expect(findings[0]).toEqual({
			tier: "llm",
			message: 'Claims "all tests pass" but no test output provided',
			line: 3,
			severity: "warn",
		});
		expect(findings[1]).toEqual({
			tier: "llm",
			message: "References non-existent API endpoint /api/v3/sync",
			line: 7,
			severity: "error",
		});
	});

	it("returns empty array for grounded output (NO_ISSUES)", async () => {
		const agentPath = makeAgentScript("NO_ISSUES");

		const logger = makeLogger();
		const findings = await checkVeracityLLM("const x = 1;", logger, { agentPath });
		expect(findings).toHaveLength(0);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("passes context (task and workspace) into the prompt", async () => {
		// Script that writes its second argument (the prompt after -p) to a file, then outputs NO_ISSUES
		const capturedPromptPath = path.join(scriptDir, "captured-prompt.txt");
		const scriptPath = path.join(scriptDir, "echo-prompt.sh");
		fs.writeFileSync(
			scriptPath,
			`#!/bin/sh\nprintf '%s' "$2" > ${JSON.stringify(capturedPromptPath)}\necho NO_ISSUES\n`,
			{ mode: 0o755 },
		);

		const logger = makeLogger();
		await checkVeracityLLM("output text", logger, { agentPath: scriptPath }, {
			task: "Fix the login bug",
			workspacePath: "/tmp/workspace",
		});

		const capturedPrompt = fs.readFileSync(capturedPromptPath, "utf-8");
		expect(capturedPrompt).toContain("Fix the login bug");
		expect(capturedPrompt).toContain("/tmp/workspace");
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("gracefully degrades when LLM call fails (warn + continue)", async () => {
		const agentPath = makeFailingScript();

		const logger = makeLogger();
		const findings = await checkVeracityLLM("content", logger, { agentPath });

		expect(findings).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			"Veracity LLM check failed, continuing without LLM findings",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});
});

describe("checkVeracity (orchestrator)", () => {
	let scriptDir: string;

	function makeAgentScript(stdout: string): string {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const dataPath = path.join(scriptDir, `data-${id}.txt`);
		const scriptPath = path.join(scriptDir, `agent-${id}.sh`);
		fs.writeFileSync(dataPath, stdout);
		fs.writeFileSync(scriptPath, `#!/bin/sh\ncat ${JSON.stringify(dataPath)}\n`, { mode: 0o755 });
		return scriptPath;
	}

	beforeEach(() => {
		scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "veracity-orch-test-"));
	});

	afterEach(() => {
		fs.rmSync(scriptDir, { recursive: true, force: true });
	});

	it("returns empty when disabled", async () => {
		const logger = makeLogger();
		const findings = await checkVeracity("I've created the file", { enabled: false, tier: "both" }, logger);
		expect(findings).toHaveLength(0);
	});

	it("runs regex only for tier 'regex'", async () => {
		const logger = makeLogger();
		const findings = await checkVeracity(
			"I've created a new file",
			{ enabled: true, tier: "regex" },
			logger,
		);
		expect(findings.length).toBeGreaterThan(0);
		expect(findings.every((f) => f.tier === "regex")).toBe(true);
	});

	it("runs LLM only for tier 'llm' (returns only LLM findings)", async () => {
		const agentPath = makeAgentScript("FINDING:warn:1:Unverified claim about deployment");

		const logger = makeLogger();
		const findings = await checkVeracity(
			"I've created a new file",
			{ enabled: true, tier: "llm", llm: { agentPath } },
			logger,
		);

		// Should only have LLM findings, no regex findings
		expect(findings.length).toBeGreaterThan(0);
		expect(findings.every((f) => f.tier === "llm")).toBe(true);
	});

	it("'both' tier merges regex and LLM results", async () => {
		const agentPath = makeAgentScript("FINDING:error:1:LLM detected fabricated reference");

		const logger = makeLogger();
		const findings = await checkVeracity(
			"I've created a new file",
			{ enabled: true, tier: "both", llm: { agentPath } },
			logger,
		);

		const regexFindings = findings.filter((f) => f.tier === "regex");
		const llmFindings = findings.filter((f) => f.tier === "llm");

		expect(regexFindings.length).toBeGreaterThan(0);
		expect(llmFindings.length).toBeGreaterThan(0);
		expect(findings.length).toBe(regexFindings.length + llmFindings.length);
	});

	it("'both' tier still returns regex findings when LLM fails", async () => {
		const logger = makeLogger();
		const findings = await checkVeracity(
			"I've created a new file",
			{ enabled: true, tier: "both", llm: { agentPath: "/nonexistent/binary" } },
			logger,
		);

		// Regex findings should still be present even though LLM failed
		expect(findings.length).toBeGreaterThan(0);
		expect(findings.every((f) => f.tier === "regex")).toBe(true);
		expect(logger.warn).toHaveBeenCalled();
	});
});
