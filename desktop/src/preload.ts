'use strict';
/**
 * nashat-vpn desktop — preload bridge.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nashat', {
  getState: () => ipcRenderer.invoke('vpn:getState'),
  connect: () => ipcRenderer.invoke('vpn:connect'),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  selectCountry: (code: string) => ipcRenderer.invoke('vpn:selectCountry', code),
  importText: (text: string) => ipcRenderer.invoke('vpn:importText', text),
  importSubscription: (url: string) => ipcRenderer.invoke('vpn:importSubscription', url),
  listSubscriptions: () => ipcRenderer.invoke('vpn:listSubscriptions'),
  removeSubscription: (url: string) => ipcRenderer.invoke('vpn:removeSubscription', url),
  getLogs: () => ipcRenderer.invoke('vpn:getLogs'),
  stats: () => ipcRenderer.invoke('vpn:stats'),
  autoPick: () => ipcRenderer.invoke('vpn:autoPick'),
  setLang: (lang: string) => ipcRenderer.invoke('app:setLang', lang),
  toggleFavorite: (code: string) => ipcRenderer.invoke('app:toggleFavorite', code),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  setAutoConnect: (on: boolean) => ipcRenderer.invoke('app:setAutoConnect', on),
  setLaunchAtBoot: (on: boolean) => ipcRenderer.invoke('app:setLaunchAtBoot', on),
  setKillSwitch: (on: boolean) => ipcRenderer.invoke('app:setKillSwitch', on),
  setRotate: (min: number) => ipcRenderer.invoke('app:setRotate', min),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
});
