const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let captureWindow = null;
const tempDir = path.join(app.getPath('temp'), 'pdf-screenshot-collector');
const pdfOutputDir = path.join(app.getPath('documents'), 'PDF Screenshot Collector');

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Ensure PDF output directory exists at startup
if (!fs.existsSync(pdfOutputDir)) {
  fs.mkdirSync(pdfOutputDir, { recursive: true });
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const windowOpts = {
    width: 1250,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    title: 'PDF Screenshot Collector',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };

  if (fs.existsSync(iconPath)) {
    windowOpts.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOpts);
  mainWindow.setMenu(null);

  // Load the renderer interface
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (captureWindow) {
      captureWindow.close();
    }
  });
}

function registerGlobalShortcuts() {
  // Register Ctrl+Shift+S for capture
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-capture');
    }
  });
}

// Create a full-screen semi-transparent overlay for region selection
function triggerAreaCapture() {
  // Hide or minimize the main window before capturing
  if (mainWindow) {
    mainWindow.minimize();
  }

  // Wait for the window minimizing animation to complete
  setTimeout(() => {
    // Get primary display or current active screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    // Query desktop capturer for windows or screens
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: width, height: height }
    }).then(sources => {
      if (sources.length > 0) {
        const sourceImage = sources[0].thumbnail.toDataURL();
        
        // Open selection window
        if (captureWindow) {
          captureWindow.close();
        }

        captureWindow = new BrowserWindow({
          x: primaryDisplay.bounds.x,
          y: primaryDisplay.bounds.y,
          width: width,
          height: height,
          hasShadow: false,
          frame: false,
          transparent: true,
          resizable: false,
          fullscreen: true,
          enableLargerThanScreen: true,
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        });

        // Pass screen image to the selection window helper
        captureWindow.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
        
        captureWindow.webContents.on('did-finish-load', () => {
          captureWindow.webContents.send('init-selection', sourceImage);
        });

        captureWindow.on('closed', () => {
          captureWindow = null;
        });
      }
    }).catch(err => {
      console.error('Failed to grab desktop sources:', err);
      // Restore window if capture failed
      if (mainWindow) {
        mainWindow.restore();
        mainWindow.focus();
      }
    });
  }, 350);
}

// Communication channels
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  } catch (error) {
    console.error(error);
    return [];
  }
});

// Trigger Area Cropper Overlay
ipcMain.on('start-area-capture', () => {
  triggerAreaCapture();
});

// Handle Crop Completion
ipcMain.on('crop-complete', (event, dataUrl) => {
  if (mainWindow) {
    mainWindow.webContents.send('new-screenshot-captured', dataUrl);
    mainWindow.restore();
    mainWindow.focus();
  }
  if (captureWindow) {
    captureWindow.close();
  }
});

// Cancel Cropper Overlay
ipcMain.on('crop-cancel', () => {
  if (mainWindow) {
    mainWindow.restore();
    mainWindow.focus();
  }
  if (captureWindow) {
    captureWindow.close();
  }
});

// Save Temporary Physical Image File
ipcMain.handle('save-temp-image', async (event, { base64Data }) => {
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const fileId = `shot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
    const filePath = path.join(tempDir, fileId);
    const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (error) {
    console.error('Failed to write temp image file:', error);
    return { success: false, error: error.message };
  }
});

// Delete Single Temporary Image File
ipcMain.handle('delete-temp-image', async (event, { filePath }) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to delete temp image file:', error);
    return { success: false, error: error.message };
  }
});

// Clear Entire Temp Folder Contents
ipcMain.handle('clear-temp-dir', async () => {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const fp = path.join(tempDir, file);
        if (fs.statSync(fp).isFile()) {
          fs.unlinkSync(fp);
        }
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to clear temp directory:', error);
    return { success: false, error: error.message };
  }
});

// Handle PDF Export/Save automatically to dedicated folder
ipcMain.handle('save-pdf', async (event, { base64Data, defaultName }) => {
  try {
    if (!fs.existsSync(pdfOutputDir)) {
      fs.mkdirSync(pdfOutputDir, { recursive: true });
    }
    const filename = defaultName || `screenshot_database_${Date.now()}.pdf`;
    const filePath = path.join(pdfOutputDir, filename);
    const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
    fs.writeFileSync(filePath, buffer);
    
    // Automatically open and highlight the saved file in the folder
    shell.showItemInFolder(filePath);
    
    return { success: true, filePath };
  } catch (error) {
    console.error('File write error:', error);
    return { success: false, error: error.message };
  }
});

// Handle Opening Dedicated PDF folder
ipcMain.handle('open-pdf-folder', async () => {
  try {
    if (!fs.existsSync(pdfOutputDir)) {
      fs.mkdirSync(pdfOutputDir, { recursive: true });
    }
    await shell.openPath(pdfOutputDir);
    return { success: true };
  } catch (error) {
    console.error('Failed to open PDF directory:', error);
    return { success: false, error: error.message };
  }
});

// Clean up all temp files and directory on app exit
function cleanUpTempDir() {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const fp = path.join(tempDir, file);
        if (fs.statSync(fp).isFile()) {
          fs.unlinkSync(fp);
        }
      }
      fs.rmdirSync(tempDir);
    }
  } catch (error) {
    console.error('Error cleaning up temp directory on exit:', error);
  }
}

app.whenReady().then(() => {
  createMainWindow();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cleanUpTempDir();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
