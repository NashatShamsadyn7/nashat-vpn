'use strict';
/**
 * nashat-vpn desktop — preload bridge (v1.1).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nashat', {
  getState: () => ipcRenderer.invoke('vpn:getState'),
  connect: () => ipcRenderer.invoke('vpn:connect'),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  selectCountry: (code: string) => ipcRenderer.invoke('vpn:selectCountry', code),
  importText: (text: string) => ipcRenderer.invoke('vpn:importText', text),
  getLogs: () => ipcRenderer.invoke('vpn:getLogs'),
  setLang: (lang: string) => ipcRenderer.invoke('app:setLang', lang),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
});
