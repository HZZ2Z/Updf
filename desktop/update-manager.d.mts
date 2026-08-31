export interface DesktopUpdateState {
  status: "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error" | "unsupported";
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  checkedAt?: string;
  error?: string;
}

export interface UpdateManager {
  getState(): DesktopUpdateState;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): boolean;
}

export function createUpdateManager(options: {
  updater: any;
  currentVersion: string;
  isPackaged: boolean;
  onStateChange?: (state: DesktopUpdateState) => void;
}): UpdateManager;
