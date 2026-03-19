import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, safeRead } from "./atomic.js";

describe("atomicWrite", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("writes a file atomically", async () => {
		const filePath = path.join(tmpDir, "test.txt");
		await atomicWrite(filePath, "hello world");
		const content = await fs.promises.readFile(filePath, "utf-8");
		expect(content).toBe("hello world");
	});

	it("creates directories as needed", async () => {
		const filePath = path.join(tmpDir, "a", "b", "c.txt");
		await atomicWrite(filePath, "nested");
		const content = await fs.promises.readFile(filePath, "utf-8");
		expect(content).toBe("nested");
	});

	it("overwrites existing file", async () => {
		const filePath = path.join(tmpDir, "test.txt");
		await atomicWrite(filePath, "first");
		await atomicWrite(filePath, "second");
		const content = await fs.promises.readFile(filePath, "utf-8");
		expect(content).toBe("second");
	});
});

describe("safeRead", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns content for existing file", async () => {
		const filePath = path.join(tmpDir, "test.txt");
		await fs.promises.writeFile(filePath, "hello");
		expect(await safeRead(filePath)).toBe("hello");
	});

	it("returns undefined for missing file", async () => {
		expect(await safeRead(path.join(tmpDir, "nope.txt"))).toBeUndefined();
	});
});
