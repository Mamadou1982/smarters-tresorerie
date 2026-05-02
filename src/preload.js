const { contextBridge, ipcRenderer } = require('electron');

// Expose une API sécurisée à la page HTML
contextBridge.exposeInMainWorld('db', {
  getAll:       ()  => ipcRenderer.invoke('db-get-all'),
  add:          (t) => ipcRenderer.invoke('db-add', t),
  update:       (t) => ipcRenderer.invoke('db-update', t),
  delete:       (id)=> ipcRenderer.invoke('db-delete', id),
  stats:        ()  => ipcRenderer.invoke('db-stats'),
  backup:       ()  => ipcRenderer.invoke('db-backup'),
  restore:      ()  => ipcRenderer.invoke('db-restore'),
  openFolder:   ()  => ipcRenderer.invoke('open-db-folder'),
});
