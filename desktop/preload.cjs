const { contextBridge, ipcRenderer } = require("electron");

const bridge = Object.freeze({
  isDesktop: true,
  consumeLaunchPdf: () => ipcRenderer.invoke("desktop:consume-launch-pdf"),
  onOpenPdfAvailable: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("PDF 打开监听器必须是函数");
    }
    const wrapped = () => listener();
    ipcRenderer.on("desktop:pdf-available", wrapped);
    return () => ipcRenderer.removeListener("desktop:pdf-available", wrapped);
  },
  getPdfDefaultAppStatus: () => ipcRenderer.invoke("desktop:get-pdf-default-status"),
  setAsPdfDefaultApp: () => ipcRenderer.invoke("desktop:set-pdf-default"),
});

contextBridge.exposeInMainWorld("moduDesktop", bridge);
