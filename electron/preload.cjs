const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  searchApolloCompanies: (args) => ipcRenderer.invoke("apollo:companies", args),
  openEventFold: (url) => ipcRenderer.invoke("shell:openExternal", url),
});
