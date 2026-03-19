import type { Deps, Plugin, PluginForSlot, PluginRegistry, PluginSlot } from "./types.js";
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
): Promise<void> {
	if (!isPluginTrusted(packageName, trustedPlugins)) {
		logger.warn(
			`Skipping untrusted plugin '${packageName}'. Add it to trustedPlugins to allow loading.`,
		);
		return;
	}

	try {
		const mod = (await import(packageName)) as {
			default?: Plugin;
			create?: (config: Record<string, unknown>) => Plugin;
		};
		const plugin = mod.default ?? mod.create?.(config);
		if (!plugin) {
			logger.error(`Plugin '${packageName}' has no default export or create function`);
			return;
		}
		registry.register(plugin);
	} catch (err) {
		logger.error(`Failed to load plugin '${packageName}'`, { error: String(err) });
		// Graceful degradation: continue without this plugin
	}
}
