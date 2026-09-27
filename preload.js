const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("libraryCloud", {
  push: (works) => ipcRenderer.invoke("library-cloud-push", works),
  pull: () => ipcRenderer.invoke("library-cloud-pull")
});
