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
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onUpdateState: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("更新状态监听器必须是函数");
    }
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("desktop:update-state", wrapped);
    return () => ipcRenderer.removeListener("desktop:update-state", wrapped);
  },
});

contextBridge.exposeInMainWorld("moduDesktop", bridge);
