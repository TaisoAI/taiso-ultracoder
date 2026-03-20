import { Command } from "commander";
import { batchSpawnCommand } from "./commands/batch-spawn.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { killCommand } from "./commands/kill.js";
import { logsCommand } from "./commands/logs.js";
import { monitorCommand } from "./commands/monitor.js";
import { sendCommand } from "./commands/send.js";
import { spawnCommand } from "./commands/spawn.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand } from "./commands/stop.js";
import { watchCommand } from "./commands/watch.js";

export function createProgram(): Command {
	const program = new Command();

	program.name("uc").description("Ultracoder — AI coding agent orchestration").version("0.0.1");

	program.addCommand(initCommand());
	program.addCommand(spawnCommand());
	program.addCommand(startCommand());
	program.addCommand(stopCommand());
	program.addCommand(batchSpawnCommand());
	program.addCommand(sendCommand());
	program.addCommand(statusCommand());
	program.addCommand(killCommand());
	program.addCommand(cleanupCommand());
	program.addCommand(doctorCommand());
	program.addCommand(watchCommand());
	program.addCommand(dashboardCommand());
	program.addCommand(logsCommand());
	program.addCommand(monitorCommand());

	return program;
}
