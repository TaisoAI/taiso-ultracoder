import { createHmac, timingSafeEqual } from "node:crypto";
import type { UltracoderEvent } from "@ultracoder/core";

/**
 * Verify a GitHub webhook signature (HMAC-SHA256).
 * Compares `sha256=${hmac}` against the provided signature header.
 */
export function verifyGitHubSignature(
	payload: string,
	signature: string,
	secret: string,
): boolean {
	const hmac = createHmac("sha256", secret).update(payload).digest("hex");
	const expected = `sha256=${hmac}`;

	if (expected.length !== signature.length) {
		return false;
	}

	try {
		return timingSafeEqual(
			Buffer.from(expected, "utf8"),
			Buffer.from(signature, "utf8"),
		);
	} catch {
		return false;
	}
}

/**
 * Map a GitHub webhook event type + payload to an UltracoderEvent.
 * Returns null for unrecognized event types.
 */
export function mapGitHubEvent(
	eventType: string,
	payload: Record<string, unknown>,
): UltracoderEvent | null {
	// Try to extract a branch-based session ID (ultracoder branches are "uc-<sessionId>")
	const prPayload = payload.pull_request as Record<string, unknown> | undefined;
	const head = prPayload?.head as Record<string, unknown> | undefined;
	const branch = String(head?.ref ?? "");
	const sessionId = branch.startsWith("uc-")
		? branch.slice(3)
		: String(prPayload?.id ?? (payload.check_suite as Record<string, unknown> | undefined)?.id ?? "unknown");

	switch (eventType) {
		case "pull_request": {
			const action = payload.action as string;
			const pr = payload.pull_request as Record<string, unknown> | undefined;
			const prId = String(pr?.number ?? pr?.id ?? "unknown");

			if (action === "opened") {
				return {
					type: "pr.opened",
					sessionId,
					prId,
					timestamp: new Date().toISOString(),
				};
			}

			if (action === "closed" && pr?.merged === true) {
				return { type: "pr.merged", sessionId, prId, timestamp: new Date().toISOString() };
			}

			return null;
		}

		case "check_suite": {
			const cs = payload.check_suite as Record<string, unknown> | undefined;
			const conclusion = (cs?.conclusion ?? payload.conclusion) as string | undefined;
			const ref = String(cs?.head_sha ?? "unknown");

			if (conclusion === "success") {
				return { type: "ci.passed", sessionId, ref, timestamp: new Date().toISOString() };
			}

			if (conclusion === "failure") {
				return { type: "ci.failed", sessionId, ref, checks: [], timestamp: new Date().toISOString() };
			}

			return null;
		}

		case "pull_request_review": {
			const action = payload.action as string;
			if (action !== "submitted") return null;

			const review = payload.review as Record<string, unknown> | undefined;
			const pr = payload.pull_request as Record<string, unknown> | undefined;
			const prId = String(pr?.number ?? pr?.id ?? "unknown");
			const decision = String(review?.state ?? "commented");

			return { type: "pr.reviewed", sessionId, prId, decision, timestamp: new Date().toISOString() };
		}

		default:
			return null;
	}
}
