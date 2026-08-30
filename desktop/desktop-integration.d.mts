export interface DesktopIntegrationStatus {
  available: boolean;
  isDefault: boolean;
  defaultApplication?: string;
  error?: string;
}

export interface DesktopIntegrationOptions {
  dataHome: string;
  executablePath: string;
  iconSourcePath: string;
  execFile: (
    command: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr?: string }>;
  copyFile: (source: string, destination: string) => Promise<unknown>;
}

export const DESKTOP_NAME: "com.hzz2z.modureader.desktop";
export function getPdfDefaultAppStatus(
  options: Pick<DesktopIntegrationOptions, "execFile">,
): Promise<DesktopIntegrationStatus>;
export function setAsPdfDefaultApp(
  options: DesktopIntegrationOptions,
): Promise<DesktopIntegrationStatus>;
