import type { Deps, Plugin, PluginForSlot, PluginImporter, PluginRegistry, PluginSlot } from "./types.js";
import { PLUGIN_SLOTS } from "./types.js";
import type { Logger } from "./types.js";

export class DefaultPluginRegistry implements PluginRegistry {
	private readonly plugins = new Map<PluginSlot, Plugin>();
	private readonly logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger.child({ component: "plugin-registry" });
	}

	register(plugin: Plugin): void {
		if (!PLUGIN_SLOTS.includes(plugin.meta.slot)) {
			throw new Error(`Unknown plugin slot: ${plugin.meta.slot}`);
		}
		if (this.plugins.has(plugin.meta.slot)) {
			this.logger.warn(`Replacing plugin in slot '${plugin.meta.slot}'`, {
				old: this.plugins.get(plugin.meta.slot)?.meta.name,
				new: plugin.meta.name,
			});
		}
		this.plugins.set(plugin.meta.slot, plugin);
		this.logger.info(`Registered plugin '${plugin.meta.name}' in slot '${plugin.meta.slot}'`);
	}

	get<S extends PluginSlot>(slot: S): PluginForSlot<S> | undefined {
		return this.plugins.get(slot) as PluginForSlot<S> | undefined;
	}

	getAll(): ReadonlyMap<PluginSlot, Plugin> {
		return this.plugins;
	}

	has(slot: PluginSlot): boolean {
		return this.plugins.has(slot);
	}

	async initAll(deps: Deps): Promise<void> {
		for (const [slot, plugin] of this.plugins) {
			if (plugin.init) {
				try {
					await plugin.init(deps);
					this.logger.info(`Initialized plugin '${plugin.meta.name}'`);
				} catch (err) {
					this.logger.error(`Failed to initialize plugin '${plugin.meta.name}'`, {
						slot,
						error: String(err),
					});
					// Graceful degradation: remove the failing plugin
					this.plugins.delete(slot);
				}
			}
		}
	}

	async destroyAll(): Promise<void> {
		for (const [, plugin] of this.plugins) {
			if (plugin.destroy) {
				try {
					await plugin.destroy();
				} catch (err) {
					this.logger.error(`Failed to destroy plugin '${plugin.meta.name}'`, {
						error: String(err),
					});
				}
			}
		}
		this.plugins.clear();
	}
}

/**
 * Check whether a plugin package name is trusted.
 * First-party @ultracoder/* packages are always allowed.
 * Third-party packages must be listed in trustedPlugins.
 */
function isPluginTrusted(
	packageName: string,
	trustedPlugins: readonly string[] | undefined,
): boolean {
	if (packageName.startsWith("@ultracoder/")) {
		return true;
	}
	return trustedPlugins?.includes(packageName) ?? false;
}

/**
 * Dynamically import and register a plugin by package name.
 */
export async function loadPlugin(
	packageName: string,
	config: Record<string, unknown>,
	registry: DefaultPluginRegistry,
	logger: Logger,
	trustedPlugins?: readonly string[],
	importer?: PluginImporter,
): Promise<void> {
	if (!isPluginTrusted(packageName, trustedPlugins)) {
		logger.warn(
			`Skipping untrusted plugin '${packageName}'. Add it to trustedPlugins to allow loading.`,
		);
		return;
	}

	const importFn = importer ?? ((name: string) => import(name));

	try {
		const mod = (await importFn(packageName)) as {
			default?: Plugin | ((cfg: Record<string, unknown>) => Plugin);
			create?: (cfg: Record<string, unknown>) => Plugin;
		};
		// Plugins export either a factory function or a plugin instance
		let plugin: Plugin | undefined;
		if (typeof mod.create === "function") {
			plugin = mod.create(config);
		} else if (typeof mod.default === "function") {
			plugin = (mod.default as (cfg: Record<string, unknown>) => Plugin)(config);
		} else if (mod.default && typeof mod.default === "object" && "meta" in mod.default) {
			plugin = mod.default as Plugin;
		}
		if (!plugin || !plugin.meta) {
			logger.error(`Plugin '${packageName}' has no valid create function or default export`);
			return;
		}
		registry.register(plugin);
	} catch (err) {
		logger.error(`Failed to load plugin '${packageName}'`, { error: String(err) });
		// Graceful degradation: continue without this plugin
	}
}
