import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const execFile = promisify(execFileCb);

export interface QuestionDetection {
	isQuestion: boolean;
	questionText: string;
	confidence: number; // 0-1
}

export interface AutoAnswerResult {
	answered: boolean;
	answer: string | null;
}

const QUESTION_PATTERNS: Array<{ regex: RegExp; confidence: number }> = [
	{ regex: /\bshould I\b/i, confidence: 0.9 },
	{ regex: /\bdo you want\b/i, confidence: 0.9 },
	{ regex: /\bwhich approach\b/i, confidence: 0.85 },
	{ regex: /\bI need clarification\b/i, confidence: 0.9 },
	{ regex: /\bwould you like me to\b/i, confidence: 0.9 },
	{ regex: /\bshall I\b/i, confidence: 0.9 },
	{ regex: /\bdo you prefer\b/i, confidence: 0.85 },
	{ regex: /\bcan you confirm\b/i, confidence: 0.85 },
	{ regex: /\bis it okay\b/i, confidence: 0.8 },
];

/**
 * Detect whether text contains an agent question that may need answering.
 */
export function detectQuestion(text: string): QuestionDetection {
	let highestConfidence = 0;
	let matchedText = "";

	for (const { regex, confidence } of QUESTION_PATTERNS) {
		if (regex.test(text)) {
			if (confidence > highestConfidence) {
				highestConfidence = confidence;
				// Try to extract the sentence containing the match
				const match = text.match(regex);
				if (match) {
					const matchIndex = match.index ?? 0;
					// Find sentence boundaries around the match
					const before = text.slice(0, matchIndex);
					const after = text.slice(matchIndex);
					const periodIdx = before.lastIndexOf(". ");
					const exclamIdx = before.lastIndexOf("! ");
					const questIdx = before.lastIndexOf("? ");
					const sentenceStart = Math.max(
						periodIdx >= 0 ? periodIdx + 2 : 0,
						exclamIdx >= 0 ? exclamIdx + 2 : 0,
						questIdx >= 0 ? questIdx + 2 : 0,
					);
					const sentenceEndOffset = after.search(/[.!?](?:\s|$)/);
					const sentenceEnd =
						sentenceEndOffset >= 0
							? matchIndex + sentenceEndOffset + 1
							: text.length;
					matchedText = text.slice(sentenceStart, sentenceEnd).trim();
				}
			}
		}
	}

	if (highestConfidence > 0) {
		return {
			isQuestion: true,
			questionText: matchedText || text,
			confidence: highestConfidence,
		};
	}

	// Check trailing question mark on substantial content
	const trimmed = text.trim();
	if (trimmed.length > 20 && trimmed.endsWith("?")) {
		return {
			isQuestion: true,
			questionText: trimmed,
			confidence: 0.5,
		};
	}

	return { isQuestion: false, questionText: "", confidence: 0 };
}

/**
 * Attempt to auto-answer a procedural question by spawning a short-lived agent call.
 */
export async function tryAutoAnswer(opts: {
	question: string;
	taskContext: string;
	sessionMetadata?: Record<string, unknown>;
	agentPath?: string;
	timeoutMs?: number;
	logger: Logger;
}): Promise<AutoAnswerResult> {
	const {
		question,
		taskContext,
		agentPath = "claude",
		timeoutMs = 60_000,
		logger,
	} = opts;
	const log = logger.child({ component: "question-detector" });

	const prompt = `Given this task context:\n${taskContext}\n\nAnswer this procedural question concisely:\n${question}\n\nIf this requires human judgment or you cannot answer from the given context, respond with exactly: ESCALATE`;

	try {
		const { stdout } = await execFile(
			agentPath,
			["-p", prompt, "--output-format", "text"],
			{ timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
		);

		const response = stdout.trim();
		if (response.includes("ESCALATE")) {
			return { answered: false, answer: null };
		}
		return { answered: true, answer: response };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn("Auto-answer failed", { error: message });
		return { answered: false, answer: null };
	}
}
