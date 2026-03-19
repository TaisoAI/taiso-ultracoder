import type { Logger } from "@ultracoder/core";
import { appendJsonl, readJsonl } from "@ultracoder/core";

export interface CostEntry {
	sessionId: string;
	timestamp: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	currency: string;
}

export interface CostBudget {
	maxPerSession: number;
	maxPerDay: number;
	currency: string;
}

export interface CostSummary {
	totalCost: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	entriesByModel: Record<string, { cost: number; count: number }>;
	entriesBySession: Record<string, number>;
}

/** Pricing per 1M tokens (input/output) */
const PRICING: Record<string, { input: number; output: number }> = {
	"claude-sonnet-4-5-20250514": { input: 3.0, output: 15.0 },
	"claude-opus-4-5-20250514": { input: 15.0, output: 75.0 },
	"gpt-4o": { input: 2.5, output: 10.0 },
	o3: { input: 10.0, output: 40.0 },
};

/**
 * Calculate cost for a token usage entry.
 * If pricingOverride is provided, it takes precedence over the hardcoded PRICING map.
 */
export function calculateCost(
	model: string,
	inputTokens: number,
	outputTokens: number,
	pricingOverride?: Record<string, { input: number; output: number }>,
): number {
	const pricing = pricingOverride?.[model] ?? PRICING[model];
	if (!pricing) return 0;
	return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Record a cost entry.
 */
export async function recordCost(filePath: string, entry: CostEntry): Promise<void> {
	await appendJsonl(filePath, entry);
}

/**
 * Summarize costs from a log file.
 */
export async function summarizeCosts(filePath: string): Promise<CostSummary> {
	const entries = await readJsonl<CostEntry>(filePath);

	const summary: CostSummary = {
		totalCost: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		entriesByModel: {},
		entriesBySession: {},
	};

	for (const entry of entries) {
		summary.totalCost += entry.cost;
		summary.totalInputTokens += entry.inputTokens;
		summary.totalOutputTokens += entry.outputTokens;

		if (!summary.entriesByModel[entry.model]) {
			summary.entriesByModel[entry.model] = { cost: 0, count: 0 };
		}
		summary.entriesByModel[entry.model].cost += entry.cost;
		summary.entriesByModel[entry.model].count += 1;

		summary.entriesBySession[entry.sessionId] =
			(summary.entriesBySession[entry.sessionId] ?? 0) + entry.cost;
	}

	return summary;
}

/**
 * Check if a session is within budget.
 * When costLogPath is provided and maxPerDay > 0, also enforces per-day budget
 * by reading today's entries from the cost log.
 */
export async function isWithinBudget(
	sessionCost: number,
	budget: CostBudget,
	costLogPath?: string,
): Promise<{ allowed: boolean; remaining: number; dailyCost?: number }> {
	// Check per-session
	const sessionRemaining = budget.maxPerSession - sessionCost;
	if (sessionRemaining <= 0) {
		return { allowed: false, remaining: 0 };
	}

	// Check per-day (if costLogPath provided)
	if (costLogPath && budget.maxPerDay > 0) {
		const entries = await readJsonl<CostEntry>(costLogPath);
		const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
		const dailyCost = entries
			.filter((e) => e.timestamp.startsWith(today))
			.reduce((sum, e) => sum + e.cost, 0);

		if (dailyCost >= budget.maxPerDay) {
			return { allowed: false, remaining: 0, dailyCost };
		}
		return {
			allowed: true,
			remaining: Math.min(sessionRemaining, budget.maxPerDay - dailyCost),
			dailyCost,
		};
	}

	return { allowed: true, remaining: sessionRemaining };
}
