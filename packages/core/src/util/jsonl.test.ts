import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendJsonl, readJsonl, streamJsonl, tailJsonl } from "./jsonl.js";

describe("JSONL utilities", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-jsonl-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("append and read", async () => {
		const file = path.join(tmpDir, "test.jsonl");
		await appendJsonl(file, { a: 1 });
		await appendJsonl(file, { b: 2 });
		const records = await readJsonl(file);
		expect(records).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("readJsonl returns empty array for missing file", async () => {
		const records = await readJsonl(path.join(tmpDir, "nope.jsonl"));
		expect(records).toEqual([]);
	});

	it("readJsonl skips malformed lines", async () => {
		const file = path.join(tmpDir, "bad.jsonl");
		await fs.promises.writeFile(file, '{"a":1}\nNOT_JSON\n{"b":2}\n', "utf-8");
		const records = await readJsonl(file);
		expect(records).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("streamJsonl skips malformed lines", async () => {
		const file = path.join(tmpDir, "bad-stream.jsonl");
		await fs.promises.writeFile(file, '{"x":1}\n{broken\n{"y":2}\n', "utf-8");
		const results: unknown[] = [];
		await streamJsonl(file, (record) => {
			results.push(record);
		});
		expect(results).toEqual([{ x: 1 }, { y: 2 }]);
	});

	it("tailJsonl returns last N records", async () => {
		const file = path.join(tmpDir, "test.jsonl");
		for (let i = 0; i < 10; i++) {
			await appendJsonl(file, { i });
		}
		const last3 = await tailJsonl(file, 3);
		expect(last3).toEqual([{ i: 7 }, { i: 8 }, { i: 9 }]);
	});
});
