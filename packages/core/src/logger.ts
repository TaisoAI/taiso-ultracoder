import type { LogEntry, LogLevel, Logger } from "./types.js";
import { appendJsonl } from "./util/jsonl.js";

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export interface LoggerOpts {
	level?: LogLevel;
	/** JSONL file path for structured log output. */
	filePath?: string;
	/** Write to stderr. Defaults to true. */
	stderr?: boolean;
	/** Base context merged into every log entry. */
	context?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOpts = {}): Logger {
	const minLevel = LOG_LEVELS[opts.level ?? "info"];
	const baseContext = opts.context ?? {};
	const writeStderr = opts.stderr !== false;
	const filePath = opts.filePath;

	function shouldLog(level: LogLevel): boolean {
		return LOG_LEVELS[level] >= minLevel;
	}

	function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (!shouldLog(level)) return;

		const entry: LogEntry = {
			level,
			message,
			timestamp: new Date().toISOString(),
			context: { ...baseContext, ...context },
		};

		if (writeStderr) {
			const prefix =
				level === "error" ? "ERR" : level === "warn" ? "WRN" : level === "debug" ? "DBG" : "INF";
			const ctx =
				Object.keys(entry.context ?? {}).length > 0 ? ` ${JSON.stringify(entry.context)}` : "";
			process.stderr.write(`[${prefix}] ${entry.timestamp} ${message}${ctx}\n`);
		}

		if (filePath) {
			// Fire-and-forget write to JSONL
			appendJsonl(filePath, entry).catch(() => {
				// Swallow write errors for logging
			});
		}
	}

	return {
		debug(message, context) {
			emit("debug", message, context);
		},
		info(message, context) {
			emit("info", message, context);
		},
		warn(message, context) {
			emit("warn", message, context);
		},
		error(message, context) {
			emit("error", message, context);
		},
		child(childContext) {
			return createLogger({
				...opts,
				context: { ...baseContext, ...childContext },
			});
		},
	};
}
