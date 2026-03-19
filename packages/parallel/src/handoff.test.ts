import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateHandoffReport, readHandoffReports, saveHandoffReport } from "./handoff.js";
import type { HandoffReport } from "./handoff.js";

const execFile = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFile("git", args, { cwd });
	return stdout;
}

describe("handoff", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "handoff-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	describe("generateHandoffReport", () => {
		it("extracts metrics from a git workspace with changes", async () => {
			// Initialize a git repo with an initial commit
			await git(["init"], tmpDir);
			await git(["config", "user.email", "test@test.com"], tmpDir);
			await git(["config", "user.name", "Test"], tmpDir);

			await fs.promises.writeFile(path.join(tmpDir, "file1.ts"), "line1\nline2\nline3\n");
			await git(["add", "."], tmpDir);
			await git(["commit", "-m", "initial"], tmpDir);

			// Make changes in a second commit
			await fs.promises.writeFile(
				path.join(tmpDir, "file1.ts"),
				"line1\nmodified\nline3\nnewline\n",
			);
			await fs.promises.writeFile(path.join(tmpDir, "file2.ts"), "brand new\n");
			await git(["add", "."], tmpDir);
			await git(["commit", "-m", "changes"], tmpDir);

			const report = await generateHandoffReport({
				sessionId: "sess-1",
				task: "implement feature",
				workspacePath: tmpDir,
				status: "completed",
				summary: "Added feature X",
				concerns: ["needs review"],
				suggestions: ["add more tests"],
			});

			expect(report.sessionId).toBe("sess-1");
			expect(report.task).toBe("implement feature");
			expect(report.status).toBe("completed");
			expect(report.summary).toBe("Added feature X");
			expect(report.concerns).toEqual(["needs review"]);
			expect(report.suggestions).toEqual(["add more tests"]);
			expect(report.timestamp).toBeTruthy();

			// Metrics
			expect(report.metrics.linesAdded).toBeGreaterThan(0);
			expect(report.metrics.linesRemoved).toBeGreaterThan(0);
			expect(report.metrics.filesChanged).toContain("file1.ts");
			expect(report.metrics.filesChanged).toContain("file2.ts");
			expect(report.metrics.filesChanged.length).toBe(2);

			// Diff should contain actual diff text
			expect(report.diff).toContain("modified");
			expect(report.diff).toContain("brand new");
		});

		it("handles empty diff (no changes)", async () => {
			await git(["init"], tmpDir);
			await git(["config", "user.email", "test@test.com"], tmpDir);
			await git(["config", "user.name", "Test"], tmpDir);

			await fs.promises.writeFile(path.join(tmpDir, "a.ts"), "hello\n");
			await git(["add", "."], tmpDir);
			await git(["commit", "-m", "only commit"], tmpDir);

			// HEAD~1 doesn't exist — everything should be empty/zero
			const report = await generateHandoffReport({
				sessionId: "sess-empty",
				task: "nothing changed",
				workspacePath: tmpDir,
				status: "completed",
			});

			expect(report.metrics.linesAdded).toBe(0);
			expect(report.metrics.linesRemoved).toBe(0);
			expect(report.metrics.filesChanged).toEqual([]);
			expect(report.diff).toBe("");
			expect(report.summary).toBe("");
			expect(report.concerns).toEqual([]);
			expect(report.suggestions).toEqual([]);
		});

		it("defaults optional fields", async () => {
			await git(["init"], tmpDir);
			await git(["config", "user.email", "test@test.com"], tmpDir);
			await git(["config", "user.name", "Test"], tmpDir);

			await fs.promises.writeFile(path.join(tmpDir, "a.ts"), "a\n");
			await git(["add", "."], tmpDir);
			await git(["commit", "-m", "first"], tmpDir);

			const report = await generateHandoffReport({
				sessionId: "sess-2",
				task: "task",
				workspacePath: tmpDir,
				status: "partial",
			});

			expect(report.summary).toBe("");
			expect(report.concerns).toEqual([]);
			expect(report.suggestions).toEqual([]);
		});
	});

	describe("save and read roundtrip", () => {
		it("saves and reads handoff reports via JSONL", async () => {
			const filePath = path.join(tmpDir, "reports.jsonl");

			const report1: HandoffReport = {
				sessionId: "s1",
				task: "task-1",
				status: "completed",
				summary: "done",
				diff: "diff-content",
				metrics: {
					linesAdded: 10,
					linesRemoved: 3,
					filesChanged: ["a.ts"],
					tokensUsed: 500,
				},
				concerns: [],
				suggestions: ["refactor later"],
				timestamp: "2026-01-01T00:00:00.000Z",
			};

			const report2: HandoffReport = {
				sessionId: "s2",
				task: "task-2",
				status: "failed",
				summary: "error occurred",
				diff: "",
				metrics: {
					linesAdded: 0,
					linesRemoved: 0,
					filesChanged: [],
				},
				concerns: ["build broke"],
				suggestions: [],
				timestamp: "2026-01-02T00:00:00.000Z",
			};

			await saveHandoffReport(filePath, report1);
			await saveHandoffReport(filePath, report2);

			const reports = await readHandoffReports(filePath);
			expect(reports).toHaveLength(2);
			expect(reports[0]).toEqual(report1);
			expect(reports[1]).toEqual(report2);
		});

		it("returns empty array for non-existent file", async () => {
			const filePath = path.join(tmpDir, "nonexistent.jsonl");
			const reports = await readHandoffReports(filePath);
			expect(reports).toEqual([]);
		});
	});
});
