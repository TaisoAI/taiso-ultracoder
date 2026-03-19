import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Write a file atomically by writing to a temp file then renaming.
 * Ensures no partial writes on crash.
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.promises.mkdir(dir, { recursive: true });

	const tmpPath = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
	try {
		await fs.promises.writeFile(tmpPath, data, "utf-8");
		await fs.promises.rename(tmpPath, filePath);
	} catch (err) {
		// Clean up temp file on failure
		try {
			await fs.promises.unlink(tmpPath);
		} catch {
			// ignore cleanup errors
		}
		throw err;
	}
}

/**
 * Read a file, returning undefined if it doesn't exist.
 */
export async function safeRead(filePath: string): Promise<string | undefined> {
	try {
		return await fs.promises.readFile(filePath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
}
