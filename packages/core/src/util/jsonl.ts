import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

/**
 * Append a record to a JSONL file. Creates parent directories if needed.
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	const line = `${JSON.stringify(record)}\n`;
	await fs.promises.appendFile(filePath, line, "utf-8");
}

/**
 * Read all records from a JSONL file.
 */
export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		const results: T[] = [];
		for (const line of content.split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				results.push(JSON.parse(line) as T);
			} catch {
				// Skip malformed lines
			}
		}
		return results;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
}

/**
 * Stream JSONL records from a file, calling handler for each.
 */
export async function streamJsonl<T = unknown>(
	filePath: string,
	handler: (record: T) => void | Promise<void>,
): Promise<void> {
	try {
		await fs.promises.access(filePath);
	} catch {
		return; // File doesn't exist, nothing to stream
	}

	const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
	const rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

	for await (const line of rl) {
		if (line.trim().length > 0) {
			try {
				await handler(JSON.parse(line) as T);
			} catch {
				// Skip malformed lines
			}
		}
	}
}

/**
 * Tail a JSONL file, reading the last N records.
 */
export async function tailJsonl<T = unknown>(filePath: string, n: number): Promise<T[]> {
	const all = await readJsonl<T>(filePath);
	return all.slice(-n);
}
