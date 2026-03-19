import {
	DefaultPluginRegistry,
	type Deps,
	createLogger,
	createPathResolver,
	createSessionManager,
	loadConfig,
	loadPlugin,
} from "@ultracoder/core";

/**
 * Build the dependency container for CLI commands.
 */
export async function buildContext(opts?: {
	configPath?: string;
	projectDir?: string;
	logLevel?: "debug" | "info" | "warn" | "error";
}): Promise<Deps> {
	const config = await loadConfig({
		configPath: opts?.configPath,
		projectDir: opts?.projectDir,
	});

	const paths = createPathResolver(config.projectId);

	const logger = createLogger({
		level: opts?.logLevel ?? "info",
		filePath: `${paths.dataDir()}/ultracoder.log`,
	});

	const plugins = new DefaultPluginRegistry(logger);
	const sessions = createSessionManager({
		backend: config.storageBackend,
		paths,
		logger,
	});

	// Load configured plugins
	for (const [, ref] of Object.entries(config.plugins)) {
		await loadPlugin(ref.package, ref.config, plugins, logger);
	}

	const deps: Deps = { config, logger, plugins, sessions, paths };
	await plugins.initAll(deps);

	return deps;
}
