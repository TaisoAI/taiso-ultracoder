import type { Notification, NotifierPlugin } from "./types.js";

export interface NotificationRoutingConfig {
	urgent: string[];
	action: string[];
	warning: string[];
	info: string[];
}

export const DEFAULT_ROUTING: NotificationRoutingConfig = {
	urgent: ["slack", "desktop"],
	action: ["desktop"],
	warning: ["desktop"],
	info: [],
};

export class NotificationRouter {
	constructor(
		private notifiers: Map<string, NotifierPlugin>,
		private routing: NotificationRoutingConfig = DEFAULT_ROUTING,
	) {}

	async route(notification: Notification): Promise<void> {
		const priority = notification.priority ?? "info";
		const targets = this.routing[priority] ?? [];
		const promises: Promise<void>[] = [];
		for (const name of targets) {
			const notifier = this.notifiers.get(name);
			if (notifier) {
				promises.push(notifier.notify(notification));
			}
		}
		await Promise.allSettled(promises);
	}
}
