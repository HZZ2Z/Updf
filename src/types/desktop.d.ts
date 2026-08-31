export interface DesktopPdfFile {
  name: string;
  sourcePath?: string;
  bytes: Uint8Array;
}

export interface DesktopIntegrationStatus {
  available: boolean;
  isDefault: boolean;
  defaultApplication?: string;
  error?: string;
}

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

export interface ModuDesktopBridge {
  isDesktop: true;
  consumeLaunchPdf(): Promise<DesktopPdfFile | null>;
  onOpenPdfAvailable(listener: () => void): () => void;
  getPdfDefaultAppStatus(): Promise<DesktopIntegrationStatus>;
  setAsPdfDefaultApp(): Promise<DesktopIntegrationStatus>;
  getUpdateState?(): Promise<DesktopUpdateState>;
  checkForUpdates?(): Promise<DesktopUpdateState>;
  downloadUpdate?(): Promise<DesktopUpdateState>;
  installUpdate?(): Promise<boolean>;
  onUpdateState?(listener: (state: DesktopUpdateState) => void): () => void;
}

declare global {
  interface Window {
    moduDesktop?: ModuDesktopBridge;
  }
}

export {};
