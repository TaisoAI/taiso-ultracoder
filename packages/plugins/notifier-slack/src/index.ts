import type { Notification, NotifierPlugin } from "@ultracoder/core";

export interface SlackNotifierConfig {
	webhookUrl: string;
	channel?: string;
	username?: string;
	iconEmoji?: string;
}

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/services/";

export function create(config: SlackNotifierConfig): NotifierPlugin {
	if (!config.webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
		throw new Error(`Invalid Slack webhook URL: must start with ${SLACK_WEBHOOK_PREFIX}`);
	}

	return {
		meta: {
			name: "notifier-slack",
			slot: "notifier",
			version: "0.0.1",
		},

		async notify(notification: Notification): Promise<void> {
			const levelIcons: Record<string, string> = {
				info: "information_source",
				warn: "warning",
				error: "x",
				success: "white_check_mark",
			};

			const icon = levelIcons[notification.level] ?? "bell";
			let text = `:${icon}: *${notification.title}*\n${notification.body}`;

			if (notification.sessionId) {
				text += `\n_Session: ${notification.sessionId}_`;
			}
			if (notification.url) {
				text += `\n<${notification.url}|View>`;
			}

			const payload: Record<string, unknown> = { text };
			if (config.channel) payload.channel = config.channel;
			if (config.username) payload.username = config.username;
			if (config.iconEmoji) payload.icon_emoji = config.iconEmoji;

			const response = await fetch(config.webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
			}
		},
	};
}

export default create;
