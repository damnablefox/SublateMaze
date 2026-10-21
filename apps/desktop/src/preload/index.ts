import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('sublate', {
  getPlugins: () => ipcRenderer.invoke('kernel:plugins'),
  demoPing: () => ipcRenderer.invoke('kernel:demo-ping'),
})
