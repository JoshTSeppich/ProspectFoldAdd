const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  searchApolloCompanies: (args) => ipcRenderer.invoke("apollo:companies", args),
  openEventFold: (url) => ipcRenderer.invoke("shell:openExternal", url),
  searchApolloOrg: (args) => ipcRenderer.invoke("apollo:orgSearch", args),
  searchApolloContacts: (args) => ipcRenderer.invoke("apollo:contacts", args),
});
