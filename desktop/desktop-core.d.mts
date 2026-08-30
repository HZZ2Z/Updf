export interface DesktopPdfFile {
  name: string;
  sourcePath: string;
  bytes: Uint8Array;
}

export function extractPdfPaths(argv: string[], cwd: string): string[];
export function readValidatedPdf(path: string): Promise<DesktopPdfFile>;
export function isTrustedRendererUrl(value: string, origin: string): boolean;
export function quoteDesktopExecArg(value: string): string;
export function renderDesktopEntry(options: {
  executablePath: string;
  iconPath: string;
}): string;
export function parsePdfDefaultStatus(stdout: string, desktopName: string): boolean;
