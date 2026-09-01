"use client";

import { useCallback, useEffect, useState } from "react";

import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  applyBundleToDatabase,
  clearReaderDatabase,
  getReaderDatabase,
} from "@/lib/database";
import {
  createExportBundle,
  createLibraryArchive,
  parsePortableArchive,
} from "@/lib/portable-data";
import { readTranslationUsage, type TranslationUsageSummary } from "@/lib/translation-usage";
import {
  clearTranslationApiKey,
  loadTranslationApiKey,
  saveTranslationApiKey,
} from "@/lib/translation-key-storage";
import { getSettingsReturnPath } from "@/lib/reader-session";
import type { TranslationProvider } from "@/lib/types";
import type { DesktopIntegrationStatus, DesktopUpdateState } from "@/types/desktop";

export function SettingsClient() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasGoogleApiKey, setHasGoogleApiKey] = useState(false);
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>("deepseek");
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [translationUsage, setTranslationUsage] = useState<TranslationUsageSummary>();
  const [documentCount, setDocumentCount] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [message, setMessage] = useState("");
  const [desktopIntegration, setDesktopIntegration] = useState<DesktopIntegrationStatus>();
  const [desktopIntegrationBusy, setDesktopIntegrationBusy] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>();
  const [backHref, setBackHref] = useState("/");

  const refreshCounts = useCallback(async () => {
    const database = getReaderDatabase();
    const [documents, marks, notes, vocabulary] = await Promise.all([
      database.documents.count(),
      database.translationMarks.count(),
      database.annotations.count(),
      database.vocabulary.count(),
    ]);
    setDocumentCount(documents);
    setRecordCount(marks + notes + vocabulary);
  }, []);

  useEffect(() => {
    let active = true;
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    setBackHref(getSettingsReturnPath(returnTo));
    const savedProvider = window.localStorage.getItem("modu-translation-provider");
    setTranslationProvider(savedProvider === "google" || savedProvider === "smart" ? savedProvider : "deepseek");
    setTargetLanguage(window.localStorage.getItem("modu-target-language") || "zh-CN");
    setTranslationUsage(readTranslationUsage());
    void Promise.all([
      loadTranslationApiKey("deepseek"),
      loadTranslationApiKey("google"),
    ]).then(([deepSeekKey, googleKey]) => {
      if (!active) return;
      setHasApiKey(Boolean(deepSeekKey));
      setHasGoogleApiKey(Boolean(googleKey));
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "无法读取 API Key");
    });
    void refreshCounts();
    return () => {
      active = false;
    };
  }, [refreshCounts]);

  useEffect(() => {
    const bridge = window.moduDesktop;
    if (!bridge) return;
    let active = true;
    const stopUpdateListener = bridge.onUpdateState?.((state) => {
      if (active) setDesktopUpdate(state);
    });
    void bridge.getUpdateState?.()
      .then((state) => {
        if (active) setDesktopUpdate(state);
      })
      .catch(() => {});
    void bridge.getPdfDefaultAppStatus()
      .then((status) => {
        if (active) setDesktopIntegration(status);
      })
      .catch((error) => {
        if (!active) return;
        setDesktopIntegration({
          available: false,
          isDefault: false,
          error: error instanceof Error ? error.message : "无法查询 PDF 默认应用",
        });
      });
    return () => {
      active = false;
      stopUpdateListener?.();
    };
  }, []);

  const setPdfDefaultApp = useCallback(async () => {
    const bridge = window.moduDesktop;
    if (!bridge) return;
    setDesktopIntegrationBusy(true);
    try {
      const status = await bridge.setAsPdfDefaultApp();
      setDesktopIntegration(status);
      setMessage(status.isDefault
        ? "墨读已设为 PDF 默认应用。"
        : status.error ?? "PDF 默认应用设置未生效。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "无法设置 PDF 默认应用";
      setDesktopIntegration({ available: false, isDefault: false, error: reason });
      setMessage(reason);
    } finally {
      setDesktopIntegrationBusy(false);
    }
  }, []);

  const exportAll = useCallback(async () => {
    const database = getReaderDatabase();
    const documents = await database.documents.toArray();
    const bundles = await Promise.all(documents.map(async (document) => {
      const [translationMarks, annotations, vocabulary] = await Promise.all([
        database.translationMarks.where("documentId").equals(document.id).toArray(),
        database.annotations.where("documentId").equals(document.id).toArray(),
        database.vocabulary.where("documentId").equals(document.id).toArray(),
      ]);
      const translationIds = new Set(translationMarks.map((mark) => mark.translationId));
      const translations = (await database.translations.toArray()).filter((item) => translationIds.has(item.id));
      return createExportBundle({ document, translations, translationMarks, annotations, vocabulary });
    }));
    const blob = new Blob([JSON.stringify(createLibraryArchive(bundles), null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "墨读-全部阅读记录.updf-notes.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("全部阅读记录已导出，不包含 PDF 和 API Key。");
  }, []);

  const importArchive = useCallback(async (file: File) => {
    try {
      const bundles = parsePortableArchive(await file.text());
      const results = await Promise.all(
        bundles.map((bundle) => applyBundleToDatabase(getReaderDatabase(), bundle)),
      );
      const pending = results.filter((result) => result === "pending").length;
      setMessage(`已导入 ${bundles.length} 份阅读记录${pending ? `，${pending} 份等待匹配 PDF` : ""}。`);
      await refreshCounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    }
  }, [refreshCounts]);

  return (
    <SettingsScreen
      backHref={backHref}
      hasApiKey={hasApiKey}
      hasGoogleApiKey={hasGoogleApiKey}
      translationProvider={translationProvider}
      targetLanguage={targetLanguage}
      translationUsage={translationUsage}
      documentCount={documentCount}
      recordCount={recordCount}
      message={message}
      desktopIntegration={desktopIntegration}
      desktopIntegrationBusy={desktopIntegrationBusy}
      desktopUpdate={desktopUpdate}
      onSaveApiKey={(key) => {
        void saveTranslationApiKey("deepseek", key).then(() => {
          setHasApiKey(true);
          setMessage("DeepSeek API Key 已安全保存到本机。");
        }).catch((error) => {
          setMessage(error instanceof Error ? error.message : "DeepSeek API Key 保存失败");
        });
      }}
      onClearApiKey={() => {
        void clearTranslationApiKey("deepseek").then(() => {
          setHasApiKey(false);
          setMessage("DeepSeek API Key 已从本机清除。");
        }).catch((error) => {
          setMessage(error instanceof Error ? error.message : "DeepSeek API Key 清除失败");
        });
      }}
      onSaveGoogleApiKey={(key) => {
        void saveTranslationApiKey("google", key).then(() => {
          setHasGoogleApiKey(true);
          setMessage("Google Cloud Translation API Key 已安全保存到本机。");
        }).catch((error) => {
          setMessage(error instanceof Error ? error.message : "Google API Key 保存失败");
        });
      }}
      onClearGoogleApiKey={() => {
        void clearTranslationApiKey("google").then(() => {
          setHasGoogleApiKey(false);
          setMessage("Google API Key 已从本机清除。");
        }).catch((error) => {
          setMessage(error instanceof Error ? error.message : "Google API Key 清除失败");
        });
      }}
      onTranslationProviderChange={(provider) => {
        window.localStorage.setItem("modu-translation-provider", provider);
        setTranslationProvider(provider);
        const providerName = provider === "smart"
          ? "智能路由"
          : provider === "google" ? "Google Cloud Translation" : "DeepSeek";
        setMessage(`默认翻译服务已切换为 ${providerName}。`);
      }}
      onTargetLanguageChange={(language) => {
        window.localStorage.setItem("modu-target-language", language);
        setTargetLanguage(language);
      }}
      onExportAll={() => void exportAll()}
      onImportArchive={(file) => void importArchive(file)}
      onSetPdfDefaultApp={() => void setPdfDefaultApp()}
      onCheckForUpdates={() => {
        void window.moduDesktop?.checkForUpdates?.().then(setDesktopUpdate);
      }}
      onDownloadUpdate={() => {
        void window.moduDesktop?.downloadUpdate?.().then(setDesktopUpdate);
      }}
      onInstallUpdate={() => {
        void window.moduDesktop?.installUpdate?.();
      }}
      onClearLibrary={() => {
        if (!window.confirm("清空本地资料库？PDF、翻译、注释和词汇都将从这台设备删除，请先导出备份。")) return;
        void clearReaderDatabase(getReaderDatabase()).then(async () => {
          setMessage("本地资料库已清空。");
          await refreshCounts();
        });
      }}
    />
  );
}
