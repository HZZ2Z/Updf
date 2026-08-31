// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { createUpdateManager } from "../../desktop/update-manager.mjs";

function createUpdater() {
  const updater = new EventEmitter() as EventEmitter & {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = true;
  updater.checkForUpdates = vi.fn().mockResolvedValue(undefined);
  updater.downloadUpdate = vi.fn().mockResolvedValue(undefined);
  updater.quitAndInstall = vi.fn();
  return updater;
}

describe("desktop update manager", () => {
  it("checks automatically without downloading or installing silently", async () => {
    const updater = createUpdater();
    const manager = createUpdateManager({ updater, currentVersion: "1.1.0", isPackaged: true });

    await manager.check();
    updater.emit("update-available", {
      version: "1.2.0",
      releaseName: "墨读 1.2.0",
      releaseNotes: "Improved reading",
      releaseDate: "2026-09-01T00:00:00.000Z",
    });

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({
      status: "available",
      currentVersion: "1.1.0",
      availableVersion: "1.2.0",
    });
  });

  it("reports progress and installs only after an explicit request", async () => {
    const updater = createUpdater();
    const states: string[] = [];
    const manager = createUpdateManager({
      updater,
      currentVersion: "1.1.0",
      isPackaged: true,
      onStateChange: (state) => states.push(state.status),
    });
    updater.emit("update-available", { version: "1.2.0" });

    await manager.download();
    updater.emit("download-progress", {
      percent: 47.6,
      bytesPerSecond: 100,
      transferred: 48,
      total: 100,
    });
    expect(manager.install()).toBe(false);
    updater.emit("update-downloaded", { version: "1.2.0" });

    expect(manager.getState()).toMatchObject({ status: "ready", progress: 100 });
    expect(manager.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(states).toContain("downloading");
  });

  it("stays offline in an unpackaged development session", async () => {
    const updater = createUpdater();
    const manager = createUpdateManager({ updater, currentVersion: "1.1.0", isPackaged: false });

    await manager.check();

    expect(manager.getState().status).toBe("unsupported");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
