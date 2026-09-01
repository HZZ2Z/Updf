// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCredentialStore } from "../../desktop/credential-store.mjs";

describe("desktop encrypted credential store", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("persists only encrypted API key bytes and restores them on the next run", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-credentials-"));
    roots.push(root);
    const filePath = join(root, "profile", "credentials.v1.json");
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^sealed:/, ""),
    };
    const store = createCredentialStore({ safeStorage, filePath, readFile, writeFile, mkdir });

    await store.set("deepseek", "sk-private-value");

    expect(await readFile(filePath, "utf8")).not.toContain("sk-private-value");
    await expect(store.get("deepseek")).resolves.toBe("sk-private-value");
    await store.clear("deepseek");
    await expect(store.get("deepseek")).resolves.toBe("");
  });

  it("refuses to persist a key when the operating-system keyring is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-credentials-locked-"));
    roots.push(root);
    const store = createCredentialStore({
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => "",
      },
      filePath: join(root, "credentials.v1.json"),
      readFile,
      writeFile,
      mkdir,
    });

    await expect(store.set("deepseek", "sk-private-value")).rejects.toThrow("系统密钥环");
  });
});
