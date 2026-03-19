import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { ProjectConfigSchema } from "./schemas.js";
import type { ProjectConfig } from "./types.js";
import { safeRead } from "./util/atomic.js";

const CONFIG_FILENAMES = [
	"ultracoder.yaml",
	"ultracoder.yml",
	".ultracoder.yaml",
	".ultracoder.yml",
];

/**
 * Search order for config files:
 * 1. Explicit path (if provided)
 * 2. Project directory (cwd or specified)
 * 3. Home directory (~/.ultracoder/)
 */
export async function loadConfig(opts?: {
	configPath?: string;
	projectDir?: string;
}): Promise<ProjectConfig> {
	const projectDir = opts?.projectDir ?? process.cwd();

	// 1. Explicit path
	if (opts?.configPath) {
		return await parseConfigFile(opts.configPath);
	}

	// 2. Search project directory
	for (const filename of CONFIG_FILENAMES) {
		const filePath = path.join(projectDir, filename);
		const content = await safeRead(filePath);
		if (content !== undefined) {
			return parseConfigContent(content, filePath);
		}
	}

	// 3. Search home directory
	const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const homeConfigDir = path.join(homeDir, ".ultracoder");
	for (const filename of CONFIG_FILENAMES) {
		const filePath = path.join(homeConfigDir, filename);
		const content = await safeRead(filePath);
		if (content !== undefined) {
			return parseConfigContent(content, filePath);
		}
	}

	// Default config with derived projectId
	return ProjectConfigSchema.parse({
		projectId: path.basename(projectDir),
		rootPath: projectDir,
	});
}

async function parseConfigFile(filePath: string): Promise<ProjectConfig> {
	const content = await fs.promises.readFile(filePath, "utf-8");
	return parseConfigContent(content, filePath);
}

function parseConfigContent(content: string, filePath: string): ProjectConfig {
	const raw = parseYaml(content) as Record<string, unknown>;

	// If rootPath is relative, resolve relative to config file location
	if (raw.rootPath && typeof raw.rootPath === "string" && !path.isAbsolute(raw.rootPath)) {
		raw.rootPath = path.resolve(path.dirname(filePath), raw.rootPath);
	}

	return ProjectConfigSchema.parse(raw);
}

/**
 * Merge a per-project override into a base config.
 */
export function mergeConfig(base: ProjectConfig, override: Partial<ProjectConfig>): ProjectConfig {
	return ProjectConfigSchema.parse({ ...base, ...override });
}
