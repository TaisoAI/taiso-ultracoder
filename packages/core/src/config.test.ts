import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, mergeConfig } from "./config.js";

describe("loadConfig", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-config-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("returns default config when no file exists", async () => {
		const config = await loadConfig({ projectDir: tmpDir });
		expect(config.projectId).toBe(path.basename(tmpDir));
		expect(config.rootPath).toBe(tmpDir);
		expect(config.defaultBranch).toBe("main");
	});

	it("loads config from ultracoder.yaml", async () => {
		const yaml = `projectId: test-project\nrootPath: ${tmpDir}\ndefaultBranch: develop\n`;
		await fs.promises.writeFile(path.join(tmpDir, "ultracoder.yaml"), yaml);
		const config = await loadConfig({ projectDir: tmpDir });
		expect(config.projectId).toBe("test-project");
		expect(config.defaultBranch).toBe("develop");
	});

	it("loads from explicit path", async () => {
		const configPath = path.join(tmpDir, "custom.yaml");
		const yaml = `projectId: custom\nrootPath: ${tmpDir}\n`;
		await fs.promises.writeFile(configPath, yaml);
		const config = await loadConfig({ configPath });
		expect(config.projectId).toBe("custom");
	});
});

describe("mergeConfig", () => {
	it("merges override into base", () => {
		const base = {
			projectId: "test",
			rootPath: "/tmp",
			defaultBranch: "main",
			session: {},
			plugins: {},
			workspace: {},
			notifications: {},
		};
		const result = mergeConfig(base as any, { defaultBranch: "develop" });
		expect(result.defaultBranch).toBe("develop");
		expect(result.projectId).toBe("test");
	});
});
