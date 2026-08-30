import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DesktopPdfOpenCoordinator } from "@/components/desktop/desktop-pdf-open-coordinator";

import "./globals.css";

export const metadata: Metadata = {
  title: "墨读 · 本地 PDF 深度阅读器",
  description: "在本地阅读、翻译与整理 PDF 文献。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DesktopPdfOpenCoordinator />
        {children}
      </body>
    </html>
  );
}
