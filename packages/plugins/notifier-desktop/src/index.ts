import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { Notification, NotifierPlugin } from "@ultracoder/core";

export interface DesktopNotifierConfig {
	/** Override platform detection */
	platform?: string;
}

/**
 * Strip all characters except safe alphanumerics, spaces, and basic punctuation.
 * Prevents shell injection in notification strings.
 */
export function sanitizeForShell(s: string): string {
	return s.replace(/[^a-zA-Z0-9 .,!?:;()\-]/g, "");
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

export function create(config: DesktopNotifierConfig = {}): NotifierPlugin {
	const os = config.platform ?? platform();

	return {
		meta: {
			name: "notifier-desktop",
			slot: "notifier",
			version: "0.0.1",
		},

		async notify(notification: Notification): Promise<void> {
			const title = sanitizeForShell(notification.title);
			const body = sanitizeForShell(notification.body);

			if (os === "darwin") {
				// Pass sanitized strings as separate -e arguments to avoid shell injection
				await exec("osascript", ["-e", `display notification "${body}" with title "${title}"`]);
			} else if (os === "linux") {
				await exec("notify-send", [title, body]);
			} else if (os === "win32") {
				const psScript = `
[void] [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(5000, "${title}", "${body}", "Info")
`;
				await exec("powershell", ["-Command", psScript]);
			} else {
				throw new Error(`Unsupported platform: ${os}`);
			}
		},
	};
}

export default create;
