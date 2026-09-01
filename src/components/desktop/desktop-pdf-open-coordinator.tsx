"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { readDesktopReaderResumePath } from "@/lib/reader-session";
import type { DesktopPdfFile } from "@/types/desktop";

function toBrowserFile(incoming: DesktopPdfFile) {
  const buffer = new ArrayBuffer(incoming.bytes.byteLength);
  new Uint8Array(buffer).set(incoming.bytes);
  return new File([buffer], incoming.name, { type: "application/pdf" });
}

export function DesktopPdfOpenCoordinator() {
  const router = useRouter();
  const draining = useRef(false);
  const drainRequested = useRef(false);
  const resumeChecked = useRef(false);
  const [message, setMessage] = useState("");

  const drain = useCallback(async () => {
    const bridge = window.moduDesktop;
    if (!bridge) return;
    drainRequested.current = true;
    if (draining.current) return;
    draining.current = true;
    let openedReader = false;

    try {
      do {
        drainRequested.current = false;
        for (;;) {
          let incoming: DesktopPdfFile | null;
          try {
            incoming = await bridge.consumeLaunchPdf();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "PDF 无法打开");
            break;
          }
          if (!incoming) break;
          try {
            const { importPdfIntoLibrary } = await import("@/lib/pdf-library-import");
            const result = await importPdfIntoLibrary(toBrowserFile(incoming));
            setMessage(`正在打开 ${result.title}`);
            router.push(`/reader/${encodeURIComponent(result.documentId)}`);
            openedReader = true;
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "PDF 导入失败");
          }
        }
      } while (drainRequested.current);
    } finally {
      draining.current = false;
      if (!resumeChecked.current) {
        resumeChecked.current = true;
        const resumePath = readDesktopReaderResumePath();
        if (!openedReader && window.location.pathname === "/" && resumePath) {
          router.replace(resumePath);
        }
      }
    }
  }, [router]);

  useEffect(() => {
    const bridge = window.moduDesktop;
    if (!bridge) return;
    const unsubscribe = bridge.onOpenPdfAvailable(() => void drain());
    void drain();
    return unsubscribe;
  }, [drain]);

  return message ? (
    <div className="desktop-open-toast" role="status">
      {message}
    </div>
  ) : null;
}
