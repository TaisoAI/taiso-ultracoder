import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KVStore } from "./kv-store.js";

describe("KVStore", () => {
	let tmpDir: string;
	let store: KVStore<{ name: string; value: number }>;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-kv-"));
		store = new KVStore(tmpDir);
		await store.init();
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("set and get", async () => {
		await store.set("foo", { name: "foo", value: 42 });
		const result = await store.get("foo");
		expect(result).toEqual({ name: "foo", value: 42 });
	});

	it("returns undefined for missing key", async () => {
		expect(await store.get("missing")).toBeUndefined();
	});

	it("delete returns true for existing key", async () => {
		await store.set("foo", { name: "foo", value: 1 });
		expect(await store.delete("foo")).toBe(true);
		expect(await store.get("foo")).toBeUndefined();
	});

	it("delete returns false for missing key", async () => {
		expect(await store.delete("nope")).toBe(false);
	});

	it("has", async () => {
		await store.set("exists", { name: "x", value: 0 });
		expect(await store.has("exists")).toBe(true);
		expect(await store.has("nope")).toBe(false);
	});

	it("keys and values", async () => {
		await store.set("a", { name: "a", value: 1 });
		await store.set("b", { name: "b", value: 2 });
		const keys = await store.keys();
		expect(keys.sort()).toEqual(["a", "b"]);
		const vals = await store.values();
		expect(vals).toHaveLength(2);
	});
});
