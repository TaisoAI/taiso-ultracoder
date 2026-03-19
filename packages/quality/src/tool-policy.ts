/**
 * 4-tier tool approval policy:
 * - auto: tool runs without intervention
 * - evaluate: tool is inspected, runs if safe
 * - human: requires human approval
 * - blocked: tool cannot run
 */
export type ApprovalTier = "auto" | "evaluate" | "human" | "blocked";

export interface ToolPolicyRule {
	/** Glob pattern matching tool names */
	pattern: string;
	tier: ApprovalTier;
	reason?: string;
}

export interface ToolPolicyConfig {
	enabled: boolean;
	defaultTier: ApprovalTier;
	rules?: ToolPolicyRule[];
	evaluateRules?: EvaluateRulesConfig;
}

export interface EvaluateRulesConfig {
	maxFileSize?: number;
	maxFilesModified?: number;
	maxSubprocessMs?: number;
}

export interface ToolPolicyDecision {
	tool: string;
	tier: ApprovalTier;
	allowed: boolean;
	reason?: string;
	matchedRule?: ToolPolicyRule;
}

export interface EvaluateContext {
	sessionId: string;
	workspacePath: string;
	assignedScope?: string[];
	resourceUsage?: {
		filesModified: number;
		bytesWritten: number;
	};
}

export type EvaluateCategory = "network" | "scope" | "resource" | "none";

export interface EvaluateResult {
	allowed: boolean;
	reason: string;
	category: EvaluateCategory;
}

/** Default dangerous tools that should require human approval */
const DEFAULT_RULES: ToolPolicyRule[] = [
	{ pattern: "bash:rm *", tier: "human", reason: "Destructive file operation" },
	{ pattern: "bash:git push*", tier: "human", reason: "Pushes to remote" },
	{ pattern: "bash:git reset*", tier: "human", reason: "Destructive git operation" },
	{ pattern: "bash:curl*", tier: "evaluate", reason: "Network request" },
	{ pattern: "bash:wget*", tier: "evaluate", reason: "Network request" },
	{ pattern: "write:*.env*", tier: "blocked", reason: "Secrets file" },
	{ pattern: "write:*credentials*", tier: "blocked", reason: "Credentials file" },
];

/** Default resource limits */
const DEFAULT_MAX_FILE_SIZE = 1048576; // 1MB
const DEFAULT_MAX_FILES_MODIFIED = 100;
const DEFAULT_MAX_SUBPROCESS_MS = 300000; // 5 minutes

/**
 * RFC 1918, link-local, and localhost patterns.
 */
const PRIVATE_IP_PATTERNS = [
	/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
	/\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/,
	/\b192\.168\.\d{1,3}\.\d{1,3}\b/,
	/\b169\.254\.\d{1,3}\.\d{1,3}\b/,
	/\blocalhost\b/,
	/\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
];

/**
 * Check network boundary rules.
 * Blocks requests to private/link-local IPs and requires HTTPS for external URLs.
 */
function checkNetworkBoundary(args: string[]): EvaluateResult | null {
	const joined = args.join(" ");

	// Check for private/link-local IPs and localhost
	for (const pattern of PRIVATE_IP_PATTERNS) {
		if (pattern.test(joined)) {
			return {
				allowed: false,
				reason: `Blocked: argument references private/local network address (matched ${pattern.source})`,
				category: "network",
			};
		}
	}

	// Check for http:// URLs (require HTTPS for external)
	const httpUrlPattern = /\bhttp:\/\/[^\s]+/i;
	if (httpUrlPattern.test(joined)) {
		return {
			allowed: false,
			reason: "Blocked: HTTP URL detected; use HTTPS for external requests",
			category: "network",
		};
	}

	return null;
}

/**
 * Normalize a path for comparison: resolve . and .. segments, ensure no trailing slash.
 */
function normalizePath(p: string): string {
	// Simple normalization: split on /, resolve . and .., rejoin
	const parts = p.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "." || part === "") {
		} else if (part === "..") {
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	const prefix = p.startsWith("/") ? "/" : "";
	return prefix + resolved.join("/");
}

/**
 * Check scope containment rules.
 * If assignedScope is set, verify file paths in args are within scope.
 * Always block writes outside workspace path.
 */
function checkScopeContainment(args: string[], context: EvaluateContext): EvaluateResult | null {
	const workspaceNorm = normalizePath(context.workspacePath);

	for (const arg of args) {
		// Only check arguments that look like file paths
		if (!arg.startsWith("/") && !arg.startsWith("./") && !arg.startsWith("../")) {
			continue;
		}

		const argNorm = normalizePath(arg.startsWith("/") ? arg : `${workspaceNorm}/${arg}`);

		// Block writes outside workspace
		if (!argNorm.startsWith(`${workspaceNorm}/`) && argNorm !== workspaceNorm) {
			return {
				allowed: false,
				reason: `Blocked: path "${arg}" is outside workspace "${context.workspacePath}"`,
				category: "scope",
			};
		}

		// Check assigned scope if set
		if (context.assignedScope && context.assignedScope.length > 0) {
			const inScope = context.assignedScope.some((scopePath) => {
				const scopeNorm = normalizePath(
					scopePath.startsWith("/") ? scopePath : `${workspaceNorm}/${scopePath}`,
				);
				return argNorm.startsWith(`${scopeNorm}/`) || argNorm === scopeNorm;
			});

			if (!inScope) {
				return {
					allowed: false,
					reason: `Blocked: path "${arg}" is outside assigned scope`,
					category: "scope",
				};
			}
		}
	}

	return null;
}

/**
 * Check resource limit rules.
 */
function checkResourceLimits(
	context: EvaluateContext,
	limits: EvaluateRulesConfig,
): EvaluateResult | null {
	const maxFileSize = limits.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
	const maxFilesModified = limits.maxFilesModified ?? DEFAULT_MAX_FILES_MODIFIED;

	if (context.resourceUsage) {
		if (context.resourceUsage.bytesWritten > maxFileSize) {
			return {
				allowed: false,
				reason: `Blocked: bytes written (${context.resourceUsage.bytesWritten}) exceeds max file size (${maxFileSize})`,
				category: "resource",
			};
		}

		if (context.resourceUsage.filesModified > maxFilesModified) {
			return {
				allowed: false,
				reason: `Blocked: files modified (${context.resourceUsage.filesModified}) exceeds limit (${maxFilesModified})`,
				category: "resource",
			};
		}
	}

	return null;
}

/**
 * Evaluate heuristic rules for the "evaluate" tier.
 * Runs network boundary, scope containment, and resource limit checks.
 */
export function evaluateHeuristic(
	tool: string,
	args: string[],
	context: EvaluateContext,
	limits?: EvaluateRulesConfig,
): EvaluateResult {
	const effectiveLimits = limits ?? {};

	// 1. Network boundary check
	const networkResult = checkNetworkBoundary(args);
	if (networkResult) return networkResult;

	// 2. Scope containment check
	const scopeResult = checkScopeContainment(args, context);
	if (scopeResult) return scopeResult;

	// 3. Resource limits check
	const resourceResult = checkResourceLimits(context, effectiveLimits);
	if (resourceResult) return resourceResult;

	return {
		allowed: true,
		reason: "All heuristic checks passed",
		category: "none",
	};
}

/**
 * Evaluate a tool invocation against the policy.
 * When the tier is "evaluate" and context is provided, runs heuristic checks.
 */
export function evaluateToolPolicy(
	tool: string,
	config: ToolPolicyConfig,
	args?: string[],
	context?: EvaluateContext,
): ToolPolicyDecision {
	if (!config.enabled) {
		return { tool, tier: "auto", allowed: true };
	}

	const allRules = [...DEFAULT_RULES, ...(config.rules ?? [])];

	for (const rule of allRules) {
		if (matchesPattern(tool, rule.pattern)) {
			// If tier is "evaluate" and we have context, run heuristic checks
			if (rule.tier === "evaluate" && args && context) {
				const heuristic = evaluateHeuristic(tool, args, context, config.evaluateRules);
				return {
					tool,
					tier: heuristic.allowed ? "auto" : "blocked",
					allowed: heuristic.allowed,
					reason: heuristic.reason,
					matchedRule: rule,
				};
			}
			return {
				tool,
				tier: rule.tier,
				allowed: rule.tier !== "blocked",
				reason: rule.reason,
				matchedRule: rule,
			};
		}
	}

	const tier = config.defaultTier;
	// If default tier is "evaluate" and we have context, run heuristic checks
	if (tier === "evaluate" && args && context) {
		const heuristic = evaluateHeuristic(tool, args, context, config.evaluateRules);
		return {
			tool,
			tier: heuristic.allowed ? "auto" : "blocked",
			allowed: heuristic.allowed,
			reason: heuristic.reason,
		};
	}

	return {
		tool,
		tier,
		allowed: tier !== "blocked",
	};
}

/**
 * Simple glob-like pattern matching for tool names.
 */
function matchesPattern(tool: string, pattern: string): boolean {
	const regex = new RegExp(
		`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
	);
	return regex.test(tool);
}
