const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dispatchApi', {
  invoke: (path, payload, token) => ipcRenderer.invoke('udm:invoke', { path, payload, token }),
  on: (event, handler) => {
    const listener = (_event, message) => {
      if (!event || message.type === event) {
        handler(message);
      }
    };
    ipcRenderer.on('udm:event', listener);
    return () => ipcRenderer.removeListener('udm:event', listener);
  }
});
