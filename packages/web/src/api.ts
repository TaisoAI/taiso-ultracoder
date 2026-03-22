import type { Deps, Session } from "@ultracoder/core";

export interface SessionListItem {
	id: string;
	status: string;
	task: string;
	agentType: string;
	branch: string;
	createdAt: string;
	updatedAt: string;
}

export interface HealthResponse {
	status: "ok";
	uptime: number;
}

export interface ErrorResponse {
	error: string;
	statusCode: number;
}

/** List all sessions. */
export async function handleSessionsList(
	deps: Deps,
): Promise<SessionListItem[]> {
	const sessions: Session[] = await deps.sessions.list();
	return sessions.map((s) => ({
		id: s.id,
		status: s.status,
		task: s.task,
		agentType: s.agentType,
		branch: s.branch,
		createdAt: s.createdAt,
		updatedAt: s.updatedAt,
	}));
}

/** Get a single session by ID. Returns the session or an error object. */
export async function handleSessionDetail(
	deps: Deps,
	id: string,
): Promise<Session | ErrorResponse> {
	const session = await deps.sessions.get(id);
	if (!session) {
		return { error: "Session not found", statusCode: 404 };
	}
	return session;
}

/** Health check endpoint. */
export function handleHealth(): HealthResponse {
	return { status: "ok", uptime: process.uptime() };
}
