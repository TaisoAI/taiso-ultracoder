#!/usr/bin/env node
import { createProgram } from "./index.js";

const program = createProgram();
program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
