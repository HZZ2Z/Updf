"use client";

import {
  ArrowLeft,
  Database,
  Download,
  FileCheck2,
  KeyRound,
  Languages,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { TranslationProvider } from "@/lib/types";
import type { TranslationUsageSummary } from "@/lib/translation-usage";
import type { DesktopIntegrationStatus } from "@/types/desktop";

interface SettingsScreenProps {
  hasApiKey: boolean;
  hasGoogleApiKey: boolean;
  translationProvider: TranslationProvider;
  targetLanguage: string;
  translationUsage?: TranslationUsageSummary;
  documentCount: number;
  recordCount: number;
  message?: string;
  desktopIntegration?: DesktopIntegrationStatus;
  desktopIntegrationBusy?: boolean;
  onSaveApiKey: (key: string) => void;
  onClearApiKey: () => void;
  onSaveGoogleApiKey: (key: string) => void;
  onClearGoogleApiKey: () => void;
  onTranslationProviderChange: (provider: TranslationProvider) => void;
  onTargetLanguageChange: (language: string) => void;
  onExportAll: () => void;
  onImportArchive: (file: File) => void;
  onClearLibrary: () => void;
  onSetPdfDefaultApp?: () => void;
}

export function SettingsScreen({
  hasApiKey,
  hasGoogleApiKey,
  translationProvider,
  targetLanguage,
  translationUsage,
  documentCount,
  recordCount,
  message,
  desktopIntegration,
  desktopIntegrationBusy = false,
  onSaveApiKey,
  onClearApiKey,
  onSaveGoogleApiKey,
  onClearGoogleApiKey,
  onTranslationProviderChange,
  onTargetLanguageChange,
  onExportAll,
  onImportArchive,
  onClearLibrary,
  onSetPdfDefaultApp,
}: SettingsScreenProps) {
  const [apiKey, setApiKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const saveKey = (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    onSaveApiKey(apiKey.trim());
    setApiKey("");
  };

  const saveGoogleKey = (event: FormEvent) => {
    event.preventDefault();
    if (!googleApiKey.trim()) return;
    onSaveGoogleApiKey(googleApiKey.trim());
    setGoogleApiKey("");
  };

  return (
    <div className="settings-shell">
      <header className="subpage-topbar">
        <a className="toolbar-icon-button" href="/" aria-label="返回资料库"><ArrowLeft /></a>
        <a className="brand" href="/"><span className="brand-mark">墨</span><span>墨读</span></a>
      </header>
      <main className="settings-main">
        <div className="settings-heading"><h1>设置</h1><p>密钥、翻译偏好和本地阅读数据都由你掌控。</p></div>
        {message ? <div className="library-message" role="status">{message}</div> : null}

        <section className="settings-section">
          <div className="settings-section-heading"><Languages /><div><h2>翻译偏好</h2><p>阅读时直接使用这里选择的服务，不需要每次重复切换。</p></div></div>
          <div className="translation-preference-grid">
            <label className="settings-select"><span>默认翻译服务</span><select value={translationProvider} onChange={(event) => onTranslationProviderChange(event.target.value as TranslationProvider)}>
              <option value="deepseek">DeepSeek</option>
              <option value="google">Google Cloud Translation</option>
              <option value="smart">智能路由（短词 Google / 长段 DeepSeek）</option>
            </select></label>
          <label className="settings-select"><span>默认目标语言</span><select value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select></label>
          </div>
          {translationUsage ? (
            <div className="translation-usage-grid" aria-label={`${translationUsage.month} 翻译用量`}>
              <span><strong>DeepSeek {translationUsage.deepSeekRequests} 次</strong><small>Google {translationUsage.googleRequests} 次</small></span>
              <span><strong>输入 {translationUsage.promptTokens} Tokens</strong><small>其中 API 缓存命中 {translationUsage.promptCacheHitTokens}</small></span>
              <span><strong>输出 {translationUsage.completionTokens} Tokens</strong><small>合计 {translationUsage.totalTokens}</small></span>
              <span><strong>本地缓存复用 {translationUsage.localCacheHits} 次</strong><small>这些请求未调用翻译 API</small></span>
            </div>
          ) : null}
        </section>

        {desktopIntegration ? (
          <section className="settings-section">
            <div className="settings-section-heading">
              <FileCheck2 />
              <div>
                <h2>PDF 默认应用</h2>
                <p>从文件管理器双击 PDF 时直接使用墨读打开。</p>
              </div>
            </div>
            <div className="desktop-integration-row">
              <span>{desktopIntegration.isDefault ? "墨读已是 PDF 默认应用" : "当前尚未设为默认"}</span>
              <button
                className="primary-button"
                type="button"
                disabled={
                  !desktopIntegration.available
                  || desktopIntegrationBusy
                  || desktopIntegration.isDefault
                }
                onClick={onSetPdfDefaultApp}
              >
                {desktopIntegrationBusy
                  ? "正在设置…"
                  : desktopIntegration.isDefault ? "已设为默认" : "设为 PDF 默认应用"}
              </button>
            </div>
            {desktopIntegration.error ? (
              <p className="settings-inline-error">{desktopIntegration.error}</p>
            ) : null}
          </section>
        ) : null}

        <section className="settings-section">
          <div className="settings-section-heading"><KeyRound /><div><h2>翻译 API 密钥</h2><p>两种密钥分别保存在当前标签页会话中，关闭浏览器后自动清除。</p></div></div>
          <div className="translation-key-grid">
            <div className={`translation-key-card${translationProvider === "deepseek" ? " is-active" : ""}`}>
              <div className="translation-key-heading"><strong>DeepSeek</strong><span>{hasApiKey ? "当前会话已连接" : "尚未连接"}</span></div>
              <form className="api-key-form" onSubmit={saveKey}>
                <label><span>DeepSeek API Key</span><input type="password" value={apiKey} placeholder={hasApiKey ? "输入新密钥可替换" : "sk-…"} onChange={(event) => setApiKey(event.target.value)} /></label>
                <div>
                  <button className="primary-button" type="submit" disabled={!apiKey.trim()}>保存到当前会话</button>
                  {hasApiKey ? <button className="secondary-button" type="button" onClick={onClearApiKey}>清除密钥</button> : null}
                </div>
              </form>
            </div>
            <div className={`translation-key-card${translationProvider === "google" ? " is-active" : ""}`}>
              <div className="translation-key-heading"><strong>Google Cloud Translation</strong><span>{hasGoogleApiKey ? "当前会话已连接" : "尚未连接"}</span></div>
              <form className="api-key-form" onSubmit={saveGoogleKey}>
                <label><span>Google Cloud Translation API Key</span><input type="password" value={googleApiKey} placeholder={hasGoogleApiKey ? "输入新密钥可替换" : "AIza…"} onChange={(event) => setGoogleApiKey(event.target.value)} /></label>
                <div>
                  <button className="primary-button" type="submit" disabled={!googleApiKey.trim()}>保存 Google 密钥</button>
                  {hasGoogleApiKey ? <button className="secondary-button" type="button" onClick={onClearGoogleApiKey}>清除 Google 密钥</button> : null}
                </div>
              </form>
              <p className="translation-key-help">需在 Google Cloud 中启用 Cloud Translation API 和结算。每月免费额度及超额价格以 <a href="https://cloud.google.com/translate/pricing" target="_blank" rel="noreferrer">Google 官方定价</a>为准。</p>
            </div>
          </div>
          <div className="privacy-note"><ShieldCheck /><span>PDF 原文不会上传；只有你主动选择并点击“翻译”的文字会发送到当前选中的翻译服务。</span></div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading"><Database /><div><h2>本地数据</h2><p>{documentCount} 份文档 · {recordCount} 条翻译、注释与词汇记录</p></div></div>
          <div className="data-actions">
            <button className="secondary-button" type="button" disabled={documentCount === 0} onClick={onExportAll}><Download />导出全部阅读记录</button>
            <button className="secondary-button" type="button" onClick={() => importRef.current?.click()}><Upload />导入笔记包或资料库</button>
            <button className="danger-button" type="button" disabled={documentCount === 0 && recordCount === 0} onClick={onClearLibrary}><Trash2 />清空本地资料库</button>
          </div>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="选择阅读记录文件" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportArchive(file);
            event.target.value = "";
          }} />
          <p className="data-footnote">导出文件不包含原 PDF 或 API Key；接收者需要导入完全相同的 PDF 才能恢复页面标记。</p>
        </section>
      </main>
    </div>
  );
}
