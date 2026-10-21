import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('sublate', {
  getPlugins: () => ipcRenderer.invoke('kernel:plugins'),
  demoPing: () => ipcRenderer.invoke('kernel:demo-ping'),
  library: {
    list: () => ipcRenderer.invoke('library:list', {}),
    pickFiles: () => ipcRenderer.invoke('library:pick-files'),
    importFiles: (paths: string[]) => ipcRenderer.invoke('library:import-files', paths),
    importUrl: (url: string) => ipcRenderer.invoke('library:import-url', { url }),
    detail: (id: string) => ipcRenderer.invoke('carrier:detail', { id }),
    file: (id: string) => ipcRenderer.invoke('carrier:file', { id }),
    pages: (id: string, from: number, to: number) =>
      ipcRenderer.invoke('carrier:pages', { id, from, to }),
    saveReadPosition: (id: string, pageNo: number, scrollRatio: number) =>
      ipcRenderer.invoke('carrier:read-position', { id, pageNo, scrollRatio }),
    remove: (id: string) => ipcRenderer.invoke('carrier:delete', { id }),
    restore: (id: string) => ipcRenderer.invoke('carrier:restore', { id }),
    trash: () => ipcRenderer.invoke('trash:list'),
    search: (text: string) => ipcRenderer.invoke('search:query', { text }),
  },
  knowledge: {
    list: (carrierId: string) => ipcRenderer.invoke('knowledge:list', { carrierId }),
    extract: (carrierId: string) => ipcRenderer.invoke('knowledge:extract', { carrierId }),
    confirm: (ids: string[]) => ipcRenderer.invoke('knowledge:confirm', { ids }),
    reject: (ids: string[]) => ipcRenderer.invoke('knowledge:reject', { ids }),
    setAnchor: (id: string, pageStart: number, pageEnd: number) =>
      ipcRenderer.invoke('knowledge:anchor', { id, pageStart, pageEnd }),
    merge: (ids: string[]) => ipcRenderer.invoke('knowledge:merge', { ids }),
    split: (id: string, splitPage: number) =>
      ipcRenderer.invoke('knowledge:split', { id, splitPage }),
  },
})
