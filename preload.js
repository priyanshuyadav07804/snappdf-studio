const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Take area capture or screen snapshot
  startAreaCapture: () => ipcRenderer.send('start-area-capture'),
  cropComplete: (dataUrl) => ipcRenderer.send('crop-complete', dataUrl),
  cropCancel: () => ipcRenderer.send('crop-cancel'),

  // Core Events listeners
  onTriggerCapture: (callback) => {
    const fn = () => callback();
    ipcRenderer.on('trigger-capture', fn);
    return () => ipcRenderer.removeListener('trigger-capture', fn);
  },
  onNewScreenshotCaptured: (callback) => {
    const fn = (event, dataUrl) => callback(dataUrl);
    ipcRenderer.on('new-screenshot-captured', fn);
    return () => ipcRenderer.removeListener('new-screenshot-captured', fn);
  },
  onInitSelection: (callback) => {
    const fn = (event, sourceImage) => callback(sourceImage);
    ipcRenderer.on('init-selection', fn);
    return () => ipcRenderer.removeListener('init-selection', fn);
  },

  // Securely export and save PDF via standard save directory browser
  savePDF: (base64Data, defaultName) => ipcRenderer.invoke('save-pdf', { base64Data, defaultName }),
  openPDFFolder: () => ipcRenderer.invoke('open-pdf-folder'),

  // Pull active system windows streams
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Temporary file system integration API definitions
  saveTempImage: (base64Data) => ipcRenderer.invoke('save-temp-image', { base64Data }),
  deleteTempImage: (filePath) => ipcRenderer.invoke('delete-temp-image', { filePath }),
  clearTempDir: () => ipcRenderer.invoke('clear-temp-dir')
});
