import { describe, it, expect } from "vitest";
import { parseAssessmentOutput } from "./assessor.js";

describe("parseAssessmentOutput", () => {
	it("parses clean JSON output", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Missing null check in handler",
			proposedFix: "Add guard clause at line 42",
			relatedFiles: ["src/handler.ts"],
			confidence: 0.85,
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("high");
		expect(result!.effort).toBe("small");
		expect(result!.rootCause).toBe("Missing null check in handler");
		expect(result!.proposedFix).toBe("Add guard clause at line 42");
		expect(result!.relatedFiles).toEqual(["src/handler.ts"]);
		expect(result!.confidence).toBe(0.85);
	});

	it("parses JSON from fenced code block", () => {
		const output = `Here's my analysis:

\`\`\`json
{
  "severity": "medium",
  "effort": "trivial",
  "rootCause": "Typo in variable name",
  "proposedFix": "Rename variable",
  "relatedFiles": ["src/utils.ts"],
  "confidence": 0.95
}
\`\`\`

That should fix it.`;

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("medium");
		expect(result!.confidence).toBe(0.95);
	});

	it("parses JSON embedded in prose", () => {
		const output = `After analyzing the issue, I believe:

{ "severity": "low", "effort": "medium", "rootCause": "Race condition", "proposedFix": "Add mutex", "relatedFiles": [], "confidence": 0.6 }

This should resolve the problem.`;

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("low");
		expect(result!.rootCause).toBe("Race condition");
	});

	it("returns null for non-JSON output", () => {
		const result = parseAssessmentOutput("This is just plain text with no JSON.");
		expect(result).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		const result = parseAssessmentOutput("{ invalid json }");
		expect(result).toBeNull();
	});

	it("returns null for JSON missing required fields", () => {
		const result = parseAssessmentOutput(JSON.stringify({ severity: "high" }));
		expect(result).toBeNull();
	});

	it("defaults confidence to 0.5 if missing", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(0.5);
	});

	it("returns null for invalid severity enum value", () => {
		const output = JSON.stringify({
			severity: "urgent",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
			confidence: 0.8,
		});
		expect(parseAssessmentOutput(output)).toBeNull();
	});

	it("returns null for invalid effort enum value", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "tiny",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
			confidence: 0.8,
		});
		expect(parseAssessmentOutput(output)).toBeNull();
	});

	it("normalizes case-insensitive severity/effort", () => {
		const output = JSON.stringify({
			severity: "High",
			effort: "Small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: 0.8,
		});
		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("high");
		expect(result!.effort).toBe("small");
	});

	it("clamps confidence to 0-1 range", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: 5.0,
		});
		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(1);

		const output2 = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: -0.5,
		});
		const result2 = parseAssessmentOutput(output2);
		expect(result2).not.toBeNull();
		expect(result2!.confidence).toBe(0);
	});

	it("defaults relatedFiles to empty array if not array", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: "not-an-array",
			confidence: 0.7,
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.relatedFiles).toEqual([]);
	});
});
