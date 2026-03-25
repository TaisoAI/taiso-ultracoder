import { EventEmitter } from "node:events";

// ─── Structured Event Types ─────────────────────────────────────────

export type UltracoderEvent =
	| { type: "session.spawned"; sessionId: string; task: string; timestamp: string }
	| { type: "session.working"; sessionId: string; timestamp: string }
	| { type: "session.completed"; sessionId: string; timestamp: string }
	| { type: "session.failed"; sessionId: string; error: string; timestamp: string }
	| { type: "session.killed"; sessionId: string; reason?: string; timestamp: string }
	| { type: "pr.opened"; sessionId: string; prId: string; timestamp: string }
	| { type: "pr.reviewed"; sessionId: string; prId: string; decision: string; timestamp: string }
	| { type: "pr.merged"; sessionId: string; prId: string; timestamp: string }
	| { type: "ci.passed"; sessionId: string; ref: string; timestamp: string }
	| { type: "ci.failed"; sessionId: string; ref: string; checks: string[]; timestamp: string }
	| { type: "reaction.escalated"; sessionId: string; trigger: string; timestamp: string }
	| { type: "reaction.retried"; sessionId: string; trigger: string; attempt: number; timestamp: string }
	| { type: "issue.detected"; issueId: string; title: string; timestamp: string }
	| { type: "issue.triaged"; issueId: string; effort: string; timestamp: string }
	| { type: "issue.spawned"; issueId: string; sessionId: string; timestamp: string }
	| { type: "experiment.iteration"; sessionId: string; iteration: number; value: number | null; timestamp: string }
	| { type: "experiment.completed"; sessionId: string; bestValue: number | null; timestamp: string }
	| { type: "approval.requested"; approvalId: string; sessionId: string; timestamp: string }
	| { type: "approval.resolved"; approvalId: string; decision: string; timestamp: string }
	| { type: "merge.queued"; sessionId: string; branch: string; timestamp: string }
	| { type: "merge.conflict"; sessionId: string; branch: string; timestamp: string };

export type UltracoderEventType = UltracoderEvent["type"];

// ─── EventBus Interface ─────────────────────────────────────────────

export interface EventBus {
	emit(event: UltracoderEvent): void;
	on<T extends UltracoderEventType>(type: T, handler: (event: Extract<UltracoderEvent, { type: T }>) => void): void;
	off<T extends UltracoderEventType>(type: T, handler: (event: Extract<UltracoderEvent, { type: T }>) => void): void;
	onAny(handler: (event: UltracoderEvent) => void): void;
	offAny(handler: (event: UltracoderEvent) => void): void;
}

const WILDCARD = "*";

// ─── Factory ────────────────────────────────────────────────────────

export function createEventBus(): EventBus {
	const emitter = new EventEmitter();

	return {
		emit(event: UltracoderEvent): void {
			emitter.emit(event.type, event);
			emitter.emit(WILDCARD, event);
		},

		on<T extends UltracoderEventType>(
			type: T,
			handler: (event: Extract<UltracoderEvent, { type: T }>) => void,
		): void {
			emitter.on(type, handler as (...args: unknown[]) => void);
		},

		off<T extends UltracoderEventType>(
			type: T,
			handler: (event: Extract<UltracoderEvent, { type: T }>) => void,
		): void {
			emitter.off(type, handler as (...args: unknown[]) => void);
		},

		onAny(handler: (event: UltracoderEvent) => void): void {
			emitter.on(WILDCARD, handler);
		},

		offAny(handler: (event: UltracoderEvent) => void): void {
			emitter.off(WILDCARD, handler as (...args: unknown[]) => void);
		},
	};
}
