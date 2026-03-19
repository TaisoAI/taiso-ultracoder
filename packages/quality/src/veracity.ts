import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const execFile = promisify(execFileCb);

/**
 * Tier 1: Regex-based veracity checks.
 * Catches common hallucination patterns in agent output.
 */
/**
 * Negative lookbehind to avoid matching inside code strings.
 * Rejects matches preceded by a quote character or backtick
 * (i.e., the pattern is likely inside a string literal).
 */
const NOT_IN_STRING = "(?<![\"'`])";

const HALLUCINATION_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
	// --- Existing metadata patterns ---
	{
		pattern: /(?:import|require)\s+.*from\s+["']([^"'./][^"']*)['"]/g,
		message: "Unverified package import detected",
	},
	{
		pattern: /https?:\/\/(?:www\.)?(?:github\.com|npmjs\.com|docs\.)[^\s)]+/g,
		message: "External URL reference detected — verify exists",
	},
	{
		pattern: /(?:as\s+(?:of|per)\s+(?:version|v)\s*[\d.]+)/gi,
		message: "Version claim detected — verify accuracy",
	},
	{
		pattern: /(?:deprecated|removed)\s+(?:in|since)\s+(?:version|v)\s*[\d.]+/gi,
		message: "Deprecation claim detected — verify accuracy",
	},

	// --- Hallucinated creation claims ---
	{
		pattern: new RegExp(`${NOT_IN_STRING}\\bI(?:'ve|\\s+have)?\\s+created\\b`, "gi"),
		message: "Hallucinated creation claim — verify file/resource actually exists",
	},

	// --- Hallucinated success claims ---
	{
		pattern: new RegExp(`${NOT_IN_STRING}\\bsuccessfully\\s+(?:built|compiled|installed)\\b`, "gi"),
		message: "Hallucinated success claim — verify build/compile/install actually ran",
	},

	// --- Hallucinated execution claims ---
	{
		pattern: new RegExp(`${NOT_IN_STRING}\\bI\\s+(?:ran\\s+the\\s+command|executed|ran)\\b`, "gi"),
		message: "Hallucinated execution claim — verify command was actually executed",
	},

	// --- Hallucinated completeness claims ---
	{
		pattern: new RegExp(
			`${NOT_IN_STRING}\\b(?:all\\s+files\\s+in\\s+place|all\\s+tests\\s+pass|everything\\s+is\\s+working)\\b`,
			"gi",
		),
		message: "Hallucinated completeness claim — verify all files/tests/state independently",
	},

	// --- Hallucinated update/modification claims ---
	{
		pattern: new RegExp(
			`${NOT_IN_STRING}\\bI(?:'ve|\\s+have)?\\s+(?:updated|modified|added)\\b`,
			"gi",
		),
		message: "Hallucinated update claim — verify file was actually modified",
	},

	// --- Hallucinated passive-voice change claims ---
	{
		pattern: new RegExp(
			`${NOT_IN_STRING}\\bthe\\s+(?:file|changes?)\\s+(?:has|have)\\s+been\\b`,
			"gi",
		),
		message: "Hallucinated passive change claim — verify change was actually applied",
	},
];

export interface VeracityFinding {
	tier: "regex" | "llm" | "filesystem";
	message: string;
	line?: number;
	match?: string;
	file?: string;
	severity: "info" | "warn" | "error";
}

export interface VeracityConfig {
	enabled: boolean;
	tier: "regex" | "llm" | "both";
}

/**
 * Run Tier 1 regex-based veracity checks on content.
 */
export function checkVeracityRegex(content: string): VeracityFinding[] {
	const findings: VeracityFinding[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		for (const { pattern, message } of HALLUCINATION_PATTERNS) {
			// Reset regex state for each line
			pattern.lastIndex = 0;
			let match = pattern.exec(lines[i]);
			while (match !== null) {
				findings.push({
					tier: "regex",
					message,
					line: i + 1,
					match: match[0],
					severity: "warn",
				});
				match = pattern.exec(lines[i]);
			}
		}
	}

	return findings;
}

const GROUNDING_PROMPT_TEMPLATE = `You are a factual accuracy checker. Review the following text and identify any claims that are:
- Unsubstantiated (no evidence provided)
- Potentially hallucinated (claiming something was done without proof)
- Factually questionable (version numbers, API details, etc.)

Text to check:
{content}

For each finding, respond with one line in this format:
FINDING:<severity>:<line_number>:<description>

Where severity is one of: info, warn, error

If no issues found, respond with: NO_ISSUES

Example:
FINDING:warn:5:Claims "all tests pass" but no test output shown
FINDING:error:12:References API endpoint that doesn't exist in the codebase`;

const VALID_SEVERITIES = new Set(["info", "warn", "error"]);

/**
 * Parse raw LLM output from the grounding check into VeracityFindings.
 */
export function parseLLMVeracityOutput(output: string): VeracityFinding[] {
	const trimmed = output.trim();
	if (!trimmed) return [];
	if (trimmed === "NO_ISSUES") return [];

	const findings: VeracityFinding[] = [];

	for (const raw of trimmed.split("\n")) {
		const line = raw.trim();
		if (!line.startsWith("FINDING:")) continue;

		// FINDING:<severity>:<line_number>:<description>
		const rest = line.slice("FINDING:".length);
		const firstColon = rest.indexOf(":");
		if (firstColon < 0) continue;

		const severity = rest.slice(0, firstColon);
		if (!VALID_SEVERITIES.has(severity)) continue;

		const afterSeverity = rest.slice(firstColon + 1);
		const secondColon = afterSeverity.indexOf(":");
		if (secondColon < 0) continue;

		const lineNumStr = afterSeverity.slice(0, secondColon);
		const lineNum = Number.parseInt(lineNumStr, 10);
		if (Number.isNaN(lineNum)) continue;

		const description = afterSeverity.slice(secondColon + 1).trim();
		if (!description) continue;

		findings.push({
			tier: "llm",
			message: description,
			line: lineNum,
			severity: severity as "info" | "warn" | "error",
		});
	}

	return findings;
}

/**
 * Tier 2: LLM-grounded veracity check.
 * Spawns an agent CLI process to verify factual claims in the content.
 */
export async function checkVeracityLLM(
	content: string,
	logger: Logger,
	config?: { agentPath?: string; timeoutMs?: number },
): Promise<VeracityFinding[]> {
	const agentPath = config?.agentPath ?? "claude";
	const timeoutMs = config?.timeoutMs ?? 120_000;

	const prompt = GROUNDING_PROMPT_TEMPLATE.replace("{content}", content);

	try {
		const { stdout } = await execFile(agentPath, ["-p", prompt, "--output-format", "text"], {
			timeout: timeoutMs,
		});
		return parseLLMVeracityOutput(stdout);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Unknown veracity LLM error";
		logger.warn("Veracity LLM check failed", { error: message });
		return [];
	}
}

/**
 * Run veracity checks based on config.
 */
export async function checkVeracity(
	content: string,
	config: VeracityConfig,
	logger: Logger,
): Promise<VeracityFinding[]> {
	if (!config.enabled) return [];

	const findings: VeracityFinding[] = [];

	if (config.tier === "regex" || config.tier === "both") {
		findings.push(...checkVeracityRegex(content));
	}

	if (config.tier === "llm" || config.tier === "both") {
		findings.push(...(await checkVeracityLLM(content, logger)));
	}

	return findings;
}

/**
 * Filesystem-based veracity check.
 * Uses `git diff` and `git status` to determine which files actually changed
 * in the workspace, then cross-checks against claimed files.
 */
export async function checkVeracityFilesystem(
	workspacePath: string,
	claimedFiles?: string[],
): Promise<VeracityFinding[]> {
	const findings: VeracityFinding[] = [];
	const execOpts = { cwd: workspacePath };

	// Gather actually-changed files from git
	const changedFiles = new Set<string>();

	try {
		const { stdout: diffOut } = await execFile("git", ["diff", "--name-only"], execOpts);
		for (const line of diffOut.split("\n")) {
			const trimmed = line.trim();
			if (trimmed) changedFiles.add(trimmed);
		}
	} catch {
		// Not a git repo or git not available — skip diff
	}

	try {
		const { stdout: statusOut } = await execFile("git", ["status", "--porcelain"], execOpts);
		for (const line of statusOut.split("\n")) {
			// porcelain format: XY filename (or XY -> renamed)
			const trimmed = line.trim();
			if (!trimmed) continue;
			// File path starts at index 3 in porcelain output
			const filePart = line.slice(3).trim();
			// Handle renames: "old -> new"
			const arrowIdx = filePart.indexOf(" -> ");
			const fileName = arrowIdx >= 0 ? filePart.slice(arrowIdx + 4) : filePart;
			if (fileName) changedFiles.add(fileName);
		}
	} catch {
		// Not a git repo or git not available — skip status
	}

	if (!claimedFiles || claimedFiles.length === 0) {
		// No claims to verify — report what actually changed (informational)
		for (const file of changedFiles) {
			findings.push({
				tier: "filesystem",
				message: `File actually changed: ${file}`,
				file,
				severity: "info",
			});
		}
		return findings;
	}

	// Cross-check claimed files against actual changes
	for (const claimed of claimedFiles) {
		if (changedFiles.has(claimed)) {
			findings.push({
				tier: "filesystem",
				message: `Claimed file verified as changed: ${claimed}`,
				file: claimed,
				severity: "info",
			});
		} else {
			findings.push({
				tier: "filesystem",
				message: `File claimed as changed but not found in git diff/status: ${claimed}`,
				file: claimed,
				severity: "error",
			});
		}
	}

	return findings;
}
