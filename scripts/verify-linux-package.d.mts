export function expectedLinuxArtifacts(version: string): string[];
export function validateDesktopEntryContent(content: string): void;
export function validateStandaloneServerFiles(serverRoot: string): Promise<void>;
export function verifyLinuxPackage(rootDir: string): Promise<void>;
