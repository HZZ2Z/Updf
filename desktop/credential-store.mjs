import { dirname } from "node:path";

const PROVIDERS = new Set(["deepseek", "google"]);

function assertProvider(provider) {
  if (!PROVIDERS.has(provider)) throw new Error("不支持的翻译服务");
}

export function createCredentialStore({
  safeStorage,
  filePath,
  readFile,
  writeFile,
  mkdir,
}) {
  let mutation = Promise.resolve();

  async function readVault() {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8"));
      if (value?.schemaVersion !== 1 || typeof value.credentials !== "object") {
        return { schemaVersion: 1, credentials: {} };
      }
      return value;
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) {
        return { schemaVersion: 1, credentials: {} };
      }
      throw error;
    }
  }

  async function writeVault(vault) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(vault), { encoding: "utf8", mode: 0o600 });
  }

  function assertEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统密钥环暂不可用，无法安全保存 API Key");
    }
  }

  return {
    async get(provider) {
      assertProvider(provider);
      const encrypted = (await readVault()).credentials[provider];
      if (!encrypted) return "";
      assertEncryption();
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    },
    async set(provider, value) {
      assertProvider(provider);
      if (typeof value !== "string" || !value.trim()) throw new Error("API Key 不能为空");
      mutation = mutation.catch(() => {}).then(async () => {
        assertEncryption();
        const vault = await readVault();
        vault.credentials[provider] = safeStorage.encryptString(value.trim()).toString("base64");
        await writeVault(vault);
      });
      await mutation;
      return true;
    },
    async clear(provider) {
      assertProvider(provider);
      mutation = mutation.catch(() => {}).then(async () => {
        const vault = await readVault();
        delete vault.credentials[provider];
        await writeVault(vault);
      });
      await mutation;
      return true;
    },
  };
}
