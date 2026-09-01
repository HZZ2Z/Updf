import type { ReaderMode } from "@/lib/types";

const LAST_READER_PATH_KEY = "modu-last-reader-path";
const READER_STATE_PREFIX = "modu-reader-state:";

export interface ReaderResumeState {
  mode: ReaderMode;
  continuousPage: number;
  bookPage: number;
  continuousZoom: number;
  bookZoom: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getReaderStateStorageKey(documentId: string) {
  return `${READER_STATE_PREFIX}${documentId}`;
}

export function parseReaderResumeState(
  value: string | null,
  pageCount: number,
): ReaderResumeState | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ReaderResumeState>;
    if (parsed.mode !== "continuous" && parsed.mode !== "book") return undefined;
    const numbers = [
      parsed.continuousPage,
      parsed.bookPage,
      parsed.continuousZoom,
      parsed.bookZoom,
    ];
    if (numbers.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      return undefined;
    }
    return {
      mode: parsed.mode,
      continuousPage: clamp(Math.round(parsed.continuousPage as number), 1, pageCount),
      bookPage: clamp(Math.round(parsed.bookPage as number), 1, pageCount),
      continuousZoom: clamp(parsed.continuousZoom as number, 0.5, 3),
      bookZoom: clamp(parsed.bookZoom as number, 0.5, 3),
    };
  } catch {
    return undefined;
  }
}

export function saveReaderResumeState(
  documentId: string,
  state: ReaderResumeState,
) {
  window.localStorage.setItem(getReaderStateStorageKey(documentId), JSON.stringify(state));
  window.localStorage.setItem(
    LAST_READER_PATH_KEY,
    `/reader/${encodeURIComponent(documentId)}`,
  );
}

export function getDesktopReaderResumePath(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\/reader\/[^/?#]+$/.test(value) ? value : undefined;
}

export function readDesktopReaderResumePath(): string | undefined {
  return getDesktopReaderResumePath(window.localStorage.getItem(LAST_READER_PATH_KEY));
}

export function getSettingsReturnPath(value: string | null): string {
  return getDesktopReaderResumePath(value) ?? "/";
}
