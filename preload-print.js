const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("printApi", {
  printSilent: () => ipcRenderer.invoke("print-silent"),
});
