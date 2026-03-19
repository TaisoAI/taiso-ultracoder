import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWrite, safeRead } from "./atomic.js";

/**
 * Simple file-backed key-value store.
 * Each key is a file in the store directory; values are JSON-serializable.
 */
export class KVStore<T = unknown> {
	constructor(private readonly dir: string) {}

	async init(): Promise<void> {
		await fs.promises.mkdir(this.dir, { recursive: true });
	}

	async get(key: string): Promise<T | undefined> {
		const data = await safeRead(this.filePath(key));
		if (data === undefined) return undefined;
		return JSON.parse(data) as T;
	}

	async set(key: string, value: T): Promise<void> {
		await atomicWrite(this.filePath(key), JSON.stringify(value, null, "\t"));
	}

	async delete(key: string): Promise<boolean> {
		try {
			await fs.promises.unlink(this.filePath(key));
			return true;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw err;
		}
	}

	async has(key: string): Promise<boolean> {
		try {
			await fs.promises.access(this.filePath(key));
			return true;
		} catch {
			return false;
		}
	}

	async keys(): Promise<string[]> {
		try {
			const entries = await fs.promises.readdir(this.dir);
			return entries.filter((e) => e.endsWith(".json")).map((e) => e.replace(/\.json$/, ""));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	async values(): Promise<T[]> {
		const ks = await this.keys();
		const results: T[] = [];
		for (const k of ks) {
			const v = await this.get(k);
			if (v !== undefined) results.push(v);
		}
		return results;
	}

	private filePath(key: string): string {
		// Sanitize key to prevent path traversal
		const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
		return path.join(this.dir, `${safe}.json`);
	}
}
