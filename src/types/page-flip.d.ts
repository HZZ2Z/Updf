declare module "page-flip" {
  export interface FlipEvent {
    data: number;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(elements: NodeListOf<HTMLElement> | HTMLElement[]): void;
    on(event: "flip", callback: (event: FlipEvent) => void): this;
    turnToPage(pageIndex: number): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    getSettings(): { disableFlipByClick: boolean };
    getCurrentPageIndex(): number;
    getPageCount(): number;
    destroy(): void;
  }
}
