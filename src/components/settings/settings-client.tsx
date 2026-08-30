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
import type { TranslationProvider } from "@/lib/types";

export function SettingsClient() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasGoogleApiKey, setHasGoogleApiKey] = useState(false);
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>("deepseek");
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [translationUsage, setTranslationUsage] = useState<TranslationUsageSummary>();
  const [documentCount, setDocumentCount] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [message, setMessage] = useState("");

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
    setHasApiKey(Boolean(window.sessionStorage.getItem("modu-deepseek-key")));
    setHasGoogleApiKey(Boolean(window.sessionStorage.getItem("modu-google-translate-key")));
    const savedProvider = window.localStorage.getItem("modu-translation-provider");
    setTranslationProvider(savedProvider === "google" || savedProvider === "smart" ? savedProvider : "deepseek");
    setTargetLanguage(window.localStorage.getItem("modu-target-language") || "zh-CN");
    setTranslationUsage(readTranslationUsage());
    void refreshCounts();
  }, [refreshCounts]);

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
      hasApiKey={hasApiKey}
      hasGoogleApiKey={hasGoogleApiKey}
      translationProvider={translationProvider}
      targetLanguage={targetLanguage}
      translationUsage={translationUsage}
      documentCount={documentCount}
      recordCount={recordCount}
      message={message}
      onSaveApiKey={(key) => {
        window.sessionStorage.setItem("modu-deepseek-key", key);
        setHasApiKey(true);
        setMessage("DeepSeek API Key 已保存到当前会话。");
      }}
      onClearApiKey={() => {
        window.sessionStorage.removeItem("modu-deepseek-key");
        setHasApiKey(false);
        setMessage("当前会话中的 API Key 已清除。");
      }}
      onSaveGoogleApiKey={(key) => {
        window.sessionStorage.setItem("modu-google-translate-key", key);
        setHasGoogleApiKey(true);
        setMessage("Google Cloud Translation API Key 已保存到当前会话。");
      }}
      onClearGoogleApiKey={() => {
        window.sessionStorage.removeItem("modu-google-translate-key");
        setHasGoogleApiKey(false);
        setMessage("当前会话中的 Google API Key 已清除。");
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
