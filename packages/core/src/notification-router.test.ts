import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ROUTING, NotificationRouter } from "./notification-router.js";
import type { NotificationRoutingConfig } from "./notification-router.js";
import type { Notification, NotifierPlugin } from "./types.js";

function makeNotifier(name: string): NotifierPlugin {
	return {
		meta: { name, slot: "notifier", version: "1.0.0" },
		notify: vi.fn<(n: Notification) => Promise<void>>().mockResolvedValue(undefined),
	};
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
	return {
		title: "Test",
		body: "Test body",
		level: "info",
		...overrides,
	};
}

describe("NotificationRouter", () => {
	it("sends to correct notifiers based on priority", async () => {
		const slack = makeNotifier("slack");
		const desktop = makeNotifier("desktop");
		const notifiers = new Map<string, NotifierPlugin>([
			["slack", slack],
			["desktop", desktop],
		]);
		const router = new NotificationRouter(notifiers);

		await router.route(makeNotification({ priority: "urgent" }));

		expect(slack.notify).toHaveBeenCalledOnce();
		expect(desktop.notify).toHaveBeenCalledOnce();
	});

	it("defaults absent priority to info which sends to no notifiers", async () => {
		const slack = makeNotifier("slack");
		const desktop = makeNotifier("desktop");
		const notifiers = new Map<string, NotifierPlugin>([
			["slack", slack],
			["desktop", desktop],
		]);
		const router = new NotificationRouter(notifiers);

		await router.route(makeNotification());

		expect(slack.notify).not.toHaveBeenCalled();
		expect(desktop.notify).not.toHaveBeenCalled();
	});

	it("silently skips unknown notifier names", async () => {
		const desktop = makeNotifier("desktop");
		const notifiers = new Map<string, NotifierPlugin>([["desktop", desktop]]);
		// Routing references "slack" but it's not in the map
		const router = new NotificationRouter(notifiers);

		await expect(
			router.route(makeNotification({ priority: "urgent" })),
		).resolves.toBeUndefined();

		expect(desktop.notify).toHaveBeenCalledOnce();
	});

	it("urgent priority reaches all configured channels", async () => {
		const slack = makeNotifier("slack");
		const desktop = makeNotifier("desktop");
		const email = makeNotifier("email");
		const notifiers = new Map<string, NotifierPlugin>([
			["slack", slack],
			["desktop", desktop],
			["email", email],
		]);
		const routing: NotificationRoutingConfig = {
			urgent: ["slack", "desktop", "email"],
			action: ["desktop"],
			warning: ["desktop"],
			info: [],
		};
		const router = new NotificationRouter(notifiers, routing);

		const notification = makeNotification({ priority: "urgent" });
		await router.route(notification);

		expect(slack.notify).toHaveBeenCalledWith(notification);
		expect(desktop.notify).toHaveBeenCalledWith(notification);
		expect(email.notify).toHaveBeenCalledWith(notification);
	});

	it("empty routing array means no notification sent", async () => {
		const slack = makeNotifier("slack");
		const desktop = makeNotifier("desktop");
		const notifiers = new Map<string, NotifierPlugin>([
			["slack", slack],
			["desktop", desktop],
		]);
		const routing: NotificationRoutingConfig = {
			urgent: [],
			action: [],
			warning: [],
			info: [],
		};
		const router = new NotificationRouter(notifiers, routing);

		await router.route(makeNotification({ priority: "urgent" }));

		expect(slack.notify).not.toHaveBeenCalled();
		expect(desktop.notify).not.toHaveBeenCalled();
	});

	it("notifier failure does not block other notifiers", async () => {
		const slack = makeNotifier("slack");
		(slack.notify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("slack down"));
		const desktop = makeNotifier("desktop");
		const notifiers = new Map<string, NotifierPlugin>([
			["slack", slack],
			["desktop", desktop],
		]);
		const router = new NotificationRouter(notifiers);

		await expect(
			router.route(makeNotification({ priority: "urgent" })),
		).resolves.toBeUndefined();

		expect(slack.notify).toHaveBeenCalledOnce();
		expect(desktop.notify).toHaveBeenCalledOnce();
	});

	it("DEFAULT_ROUTING has expected shape", () => {
		expect(DEFAULT_ROUTING.urgent).toEqual(["slack", "desktop"]);
		expect(DEFAULT_ROUTING.action).toEqual(["desktop"]);
		expect(DEFAULT_ROUTING.warning).toEqual(["desktop"]);
		expect(DEFAULT_ROUTING.info).toEqual([]);
	});
});
