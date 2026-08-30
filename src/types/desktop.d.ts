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

export interface ModuDesktopBridge {
  isDesktop: true;
  consumeLaunchPdf(): Promise<DesktopPdfFile | null>;
  onOpenPdfAvailable(listener: () => void): () => void;
  getPdfDefaultAppStatus(): Promise<DesktopIntegrationStatus>;
  setAsPdfDefaultApp(): Promise<DesktopIntegrationStatus>;
}

declare global {
  interface Window {
    moduDesktop?: ModuDesktopBridge;
  }
}

export {};
