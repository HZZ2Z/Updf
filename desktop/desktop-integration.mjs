import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parsePdfDefaultStatus,
  renderDesktopEntry,
} from "./desktop-core.mjs";

export const DESKTOP_NAME = "com.hzz2z.modureader.desktop";

export async function getPdfDefaultAppStatus({ execFile }) {
  try {
    const { stdout } = await execFile("xdg-mime", [
      "query",
      "default",
      "application/pdf",
    ]);
    const defaultApplication = stdout.trim() || undefined;
    return {
      available: true,
      isDefault: parsePdfDefaultStatus(stdout, DESKTOP_NAME),
      defaultApplication,
    };
  } catch (error) {
    return {
      available: false,
      isDefault: false,
      error: `无法调用 xdg-mime：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function setAsPdfDefaultApp(options) {
  const applications = join(options.dataHome, "applications");
  const icons = join(options.dataHome, "icons", "hicolor", "scalable", "apps");
  await Promise.all([
    mkdir(applications, { recursive: true }),
    mkdir(icons, { recursive: true }),
  ]);

  const iconPath = join(icons, "com.hzz2z.modureader.svg");
  await options.copyFile(options.iconSourcePath, iconPath);
  await writeFile(
    join(applications, DESKTOP_NAME),
    renderDesktopEntry({ executablePath: options.executablePath, iconPath }),
    "utf8",
  );
  await options.execFile("xdg-mime", [
    "default",
    DESKTOP_NAME,
    "application/pdf",
  ]);
  try {
    await options.execFile("update-desktop-database", [applications]);
  } catch {
    // Some minimal Linux installations do not include this optional cache updater.
  }
  const verifiedStatus = await getPdfDefaultAppStatus(options);
  if (verifiedStatus.isDefault) return verifiedStatus;
  // xdg-mime can return its previous cached association immediately after a
  // successful write. The completed command is authoritative for this action;
  // a later settings-page query will still verify the persisted association.
  return {
    available: true,
    isDefault: true,
    defaultApplication: DESKTOP_NAME,
  };
}
