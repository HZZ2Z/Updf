function releaseNotesText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => typeof item?.note === "string" ? item.note : "")
    .filter(Boolean)
    .join("\n\n") || undefined;
}

export function createUpdateManager({
  updater,
  currentVersion,
  isPackaged,
  onStateChange = () => {},
}) {
  let state = {
    status: isPackaged ? "idle" : "unsupported",
    currentVersion,
  };

  const updateState = (changes) => {
    state = { ...state, ...changes };
    onStateChange({ ...state });
    return { ...state };
  };

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;

  updater.on("checking-for-update", () => {
    updateState({ status: "checking", error: undefined });
  });
  updater.on("update-available", (info) => {
    updateState({
      status: "available",
      availableVersion: info.version,
      releaseName: info.releaseName || undefined,
      releaseNotes: releaseNotesText(info.releaseNotes),
      releaseDate: info.releaseDate,
      progress: undefined,
      error: undefined,
    });
  });
  updater.on("update-not-available", (info) => {
    updateState({
      status: "up-to-date",
      availableVersion: info?.version || currentVersion,
      checkedAt: new Date().toISOString(),
      progress: undefined,
      error: undefined,
    });
  });
  updater.on("download-progress", (progress) => {
    updateState({
      status: "downloading",
      progress: Math.max(0, Math.min(100, Math.round(progress.percent ?? 0))),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
      error: undefined,
    });
  });
  updater.on("update-downloaded", (info) => {
    updateState({
      status: "ready",
      availableVersion: info.version,
      progress: 100,
      error: undefined,
    });
  });
  updater.on("error", (error) => {
    updateState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    getState() {
      return { ...state };
    },
    async check() {
      if (!isPackaged) return updateState({ status: "unsupported" });
      updateState({ status: "checking", error: undefined });
      try {
        await updater.checkForUpdates();
      } catch (error) {
        updateState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...state };
    },
    async download() {
      if (state.status !== "available") return { ...state };
      updateState({ status: "downloading", progress: 0, error: undefined });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        updateState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...state };
    },
    install() {
      if (state.status !== "ready") return false;
      updater.quitAndInstall(false, true);
      return true;
    },
  };
}
