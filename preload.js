const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("libraryCloud", {
  push: (works) => ipcRenderer.invoke("library-cloud-push", works),
  pull: () => ipcRenderer.invoke("library-cloud-pull")
});

contextBridge.exposeInMainWorld("libraryOcr", {
  recognize: (dataUrl) => ipcRenderer.invoke("library-ocr", dataUrl)
});
