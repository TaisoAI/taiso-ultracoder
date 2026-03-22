import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuntimeSpawnOpts } from "@ultracoder/core";

const mockContainer = {
	id: "abc123",
	start: vi.fn().mockResolvedValue(undefined),
	stop: vi.fn().mockResolvedValue(undefined),
	remove: vi.fn().mockResolvedValue(undefined),
	inspect: vi
		.fn()
		.mockResolvedValue({ State: { Running: true, Pid: 12345 } }),
	exec: vi
		.fn()
		.mockResolvedValue({ start: vi.fn().mockResolvedValue(undefined) }),
};

const mockDocker = {
	createContainer: vi.fn().mockResolvedValue(mockContainer),
	getContainer: vi.fn().mockReturnValue(mockContainer),
};

vi.mock("dockerode", () => {
	const MockDocker = vi.fn().mockImplementation(() => mockDocker);
	return { default: MockDocker };
});

import { create } from "./index.js";

describe("runtime-docker", () => {
	const defaultOpts: RuntimeSpawnOpts = {
		command: "node",
		args: ["index.js"],
		cwd: "/home/user/project",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockContainer.start.mockResolvedValue(undefined);
		mockContainer.stop.mockResolvedValue(undefined);
		mockContainer.remove.mockResolvedValue(undefined);
		mockContainer.inspect.mockResolvedValue({
			State: { Running: true, Pid: 12345 },
		});
		mockContainer.exec.mockResolvedValue({
			start: vi.fn().mockResolvedValue(undefined),
		});
		mockDocker.createContainer.mockResolvedValue(mockContainer);
		mockDocker.getContainer.mockReturnValue(mockContainer);
	});

	it("has correct plugin meta", () => {
		const plugin = create();
		expect(plugin.meta).toEqual({
			name: "runtime-docker",
			slot: "runtime",
			version: "0.0.1",
		});
	});

	it("spawn creates container with correct config", async () => {
		const plugin = create();
		await plugin.spawn(defaultOpts);

		expect(mockDocker.createContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Image: "node:22-slim",
				Cmd: ["node", "index.js"],
				WorkingDir: "/workspace",
				OpenStdin: true,
				Tty: false,
			}),
		);
	});

	it("spawn uses correct bind mount path", async () => {
		const plugin = create();
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.HostConfig.Binds).toContain(
			"/home/user/project:/workspace",
		);
	});

	it("spawn uses network=none by default", async () => {
		const plugin = create();
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.HostConfig.NetworkMode).toBe("none");
	});

	it("spawn uses custom network when configured", async () => {
		const plugin = create({ network: "bridge" });
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.HostConfig.NetworkMode).toBe("bridge");
	});

	it("kill stops and removes container", async () => {
		const plugin = create();
		await plugin.kill({ id: "abc123" });

		expect(mockDocker.getContainer).toHaveBeenCalledWith("abc123");
		expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
		expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
	});

	it("kill handles already-stopped container", async () => {
		mockContainer.stop.mockRejectedValue(new Error("container already stopped"));
		const plugin = create();
		await plugin.kill({ id: "abc123" });

		expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
	});

	it("isAlive returns true for running container", async () => {
		const plugin = create();
		const alive = await plugin.isAlive({ id: "abc123" });

		expect(alive).toBe(true);
	});

	it("isAlive returns false for stopped container", async () => {
		mockContainer.inspect.mockResolvedValue({
			State: { Running: false, Pid: 0 },
		});
		const plugin = create();
		const alive = await plugin.isAlive({ id: "abc123" });

		expect(alive).toBe(false);
	});

	it("isAlive returns false when container not found", async () => {
		mockDocker.getContainer.mockReturnValue({
			inspect: vi.fn().mockRejectedValue(new Error("no such container")),
		});
		const plugin = create();
		const alive = await plugin.isAlive({ id: "gone" });

		expect(alive).toBe(false);
	});

	it("spawn merges env vars from opts and config", async () => {
		const plugin = create({ env: { CONFIG_VAR: "from-config" } });
		await plugin.spawn({
			...defaultOpts,
			env: { OPT_VAR: "from-opts" },
		});

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.Env).toContain("OPT_VAR=from-opts");
		expect(call.Env).toContain("CONFIG_VAR=from-config");
	});

	it("memory and CPU limits are applied", async () => {
		const plugin = create({ memoryMb: 4096, cpus: 4 });
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.HostConfig.Memory).toBe(4096 * 1024 * 1024);
		expect(call.HostConfig.NanoCpus).toBe(4 * 1e9);
	});

	it("custom image is used when configured", async () => {
		const plugin = create({ image: "python:3.12-slim" });
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.Image).toBe("python:3.12-slim");
	});

	it("spawn returns handle with id and pid", async () => {
		const plugin = create();
		const handle = await plugin.spawn(defaultOpts);

		expect(handle.id).toBe("abc123");
		expect(handle.pid).toBe(12345);
	});

	it("spawn throws clear error when Docker is not available", async () => {
		mockDocker.createContainer.mockRejectedValue(
			new Error("connect ENOENT /var/run/docker.sock"),
		);
		const plugin = create();
		await expect(plugin.spawn(defaultOpts)).rejects.toThrow(
			/Is Docker installed and running/,
		);
	});

	it("sendInput executes command in container", async () => {
		const plugin = create();
		await plugin.sendInput({ id: "abc123" }, "hello world");

		expect(mockContainer.exec).toHaveBeenCalledWith(
			expect.objectContaining({
				Cmd: ["sh", "-c", expect.stringContaining("hello world")],
				AttachStdout: true,
			}),
		);
	});

	it("extra bind mounts are included", async () => {
		const plugin = create({
			extraBinds: ["/host/data:/container/data"],
		});
		await plugin.spawn(defaultOpts);

		const call = mockDocker.createContainer.mock.calls[0][0];
		expect(call.HostConfig.Binds).toContain("/host/data:/container/data");
		expect(call.HostConfig.Binds).toContain(
			"/home/user/project:/workspace",
		);
	});
});
