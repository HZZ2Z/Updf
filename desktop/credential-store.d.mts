export type TranslationCredentialProvider = "deepseek" | "google";

export interface CredentialStore {
  get(provider: TranslationCredentialProvider): Promise<string>;
  set(provider: TranslationCredentialProvider, value: string): Promise<boolean>;
  clear(provider: TranslationCredentialProvider): Promise<boolean>;
}

export function createCredentialStore(options: {
  safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
  };
  filePath: string;
  readFile: typeof import("node:fs/promises").readFile;
  writeFile: typeof import("node:fs/promises").writeFile;
  mkdir: typeof import("node:fs/promises").mkdir;
}): CredentialStore;
