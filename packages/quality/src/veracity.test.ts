import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVeracityFilesystem, checkVeracityRegex } from "./veracity.js";

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
