const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("libraryCloud", {
  push: (works) => ipcRenderer.invoke("library-cloud-push", works),
  pull: () => ipcRenderer.invoke("library-cloud-pull")
});

contextBridge.exposeInMainWorld("libraryPlatform", {
  open: (name) => ipcRenderer.invoke("platform-open", name),
  importCurrent: (name) => ipcRenderer.invoke("platform-import", name)
});
