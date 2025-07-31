const { app, BrowserWindow, globalShortcut, ipcMain, screen, clipboard, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let captureWindow = null;
let clipboardHistory = [];
let fixedArea = null;
let isCapturing = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Quickshot',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createCaptureWindow() {
  const displays = screen.getAllDisplays();
  let fullBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };

  displays.forEach(display => {
    fullBounds.x = Math.min(fullBounds.x, display.bounds.x);
    fullBounds.y = Math.min(fullBounds.y, display.bounds.y);
    fullBounds.width = Math.max(fullBounds.width, display.bounds.x + display.bounds.width);
    fullBounds.height = Math.max(fullBounds.height, display.bounds.y + display.bounds.height);
  });

  captureWindow = new BrowserWindow({
    x: fullBounds.x,
    y: fullBounds.y,
    width: fullBounds.width - fullBounds.x,
    height: fullBounds.height - fullBounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  captureWindow.loadFile('capture.html');
  captureWindow.setAlwaysOnTop(true, 'screen-saver');
  captureWindow.setVisibleOnAllWorkspaces(true);
  captureWindow.setIgnoreMouseEvents(false);

  captureWindow.on('closed', () => {
    captureWindow = null;
    isCapturing = false;
  });
}

app.whenReady().then(() => {
  createMainWindow();
  registerShortcuts();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

function registerShortcuts() {
  globalShortcut.register('Ctrl+Shift+A', () => {
    startCapture('rectangle');
  });

  globalShortcut.register('Ctrl+Shift+F', () => {
    if (fixedArea) {
      captureFixedArea();
    } else {
      startCapture('fixed');
    }
  });

  globalShortcut.register('Ctrl+Alt+F', () => {
    if (fixedArea) {
      captureFixedArea();
    } else {
      startCapture('fixed');
    }
  });

  globalShortcut.register('Ctrl+Shift+V', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send('show-clipboard-history');
    }
  });

  globalShortcut.register('PrintScreen', () => {
    captureFullScreen();
  });

  globalShortcut.register('F3', () => {
    startCapture('window');
  });

  globalShortcut.register('F12', () => {
    if (mainWindow) {
      mainWindow.webContents.openDevTools();
    }
    if (captureWindow) {
      captureWindow.webContents.openDevTools();
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle('start-capture', (event, mode) => {
    startCapture(mode);
  });

  ipcMain.handle('capture-screen', async (event, bounds, saveAsFixed = false) => {
    try {
      if (captureWindow) {
        captureWindow.close();
      }

      // 영역고정 모드에서 영역 저장
      if (saveAsFixed) {
        fixedArea = bounds;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fixed-area-saved', bounds);
        }
      }

      const sources = await getScreenSources();
      const captures = [];

      for (const source of sources) {
        const image = nativeImage.createFromDataURL(source.thumbnail);
        const display = source.display;
        
        if (isAreaInDisplay(bounds, display.bounds)) {
          const relativeBounds = {
            x: bounds.x - display.bounds.x,
            y: bounds.y - display.bounds.y,
            width: bounds.width,
            height: bounds.height
          };

          const scaleFactor = display.scaleFactor;
          const physicalBounds = {
            x: Math.round(relativeBounds.x * scaleFactor),
            y: Math.round(relativeBounds.y * scaleFactor),
            width: Math.round(relativeBounds.width * scaleFactor),
            height: Math.round(relativeBounds.height * scaleFactor)
          };

          const cropped = image.crop(physicalBounds);
          captures.push(cropped);
        }
      }

      if (captures.length > 0) {
        let finalImage = captures[0];
        if (captures.length > 1) {
          finalImage = combineImages(captures);
        }

        saveToClipboard(finalImage);
        addToHistory(finalImage);

        // 자동 저장
        const downloadsPath = path.join(os.homedir(), 'Downloads', 'screenshot');
        await fs.promises.mkdir(downloadsPath, { recursive: true });
        
        const captureType = saveAsFixed ? 'fixed_setup' : 'rectangle';
        const fileName = `${captureType}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const filePath = path.join(downloadsPath, fileName);
        
        await fs.promises.writeFile(filePath, finalImage.toPNG());

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.webContents.send('capture-complete', finalImage.toDataURL());
          mainWindow.webContents.send('capture-saved', { filePath, fileName });
        }
      }
    } catch (error) {
      console.error('Capture error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-error', error.message);
      }
    }

    isCapturing = false;
  });

  ipcMain.handle('cancel-capture', () => {
    if (captureWindow) {
      captureWindow.close();
    }
    isCapturing = false;
  });

  ipcMain.handle('get-clipboard-history', () => {
    return clipboardHistory;
  });

  ipcMain.handle('clear-clipboard-history', () => {
    clipboardHistory = [];
  });

  ipcMain.handle('delete-clipboard-item', (event, index) => {
    if (index >= 0 && index < clipboardHistory.length) {
      clipboardHistory.splice(index, 1);
    }
    return clipboardHistory;
  });

  ipcMain.handle('save-image', async (event, dataUrl, filePath) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      const buffer = filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')
        ? image.toJPEG(90)
        : image.toPNG();
      
      await fs.promises.writeFile(filePath, buffer);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-image-dialog', async (event, dataUrl) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(os.homedir(), 'Downloads', 'screenshot', `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`),
      filters: [
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
        { name: 'Bitmap Image', extensions: ['bmp'] }
      ]
    });

    if (!result.canceled) {
      const image = nativeImage.createFromDataURL(dataUrl);
      const ext = path.extname(result.filePath).toLowerCase();
      let buffer;

      if (ext === '.jpg' || ext === '.jpeg') {
        buffer = image.toJPEG(90);
      } else if (ext === '.bmp') {
        buffer = image.toBitmap();
      } else {
        buffer = image.toPNG();
      }

      try {
        const dir = path.dirname(result.filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(result.filePath, buffer);
        return { success: true, filePath: result.filePath };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false };
  });

  ipcMain.handle('copy-to-clipboard', (event, dataUrl) => {
    const image = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(image);
  });

  ipcMain.handle('set-fixed-area', (event, bounds) => {
    fixedArea = bounds;
  });

  ipcMain.handle('get-fixed-area', () => {
    return fixedArea;
  });

  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays();
  });

  ipcMain.on('open-dev-tools', () => {
    if (captureWindow) {
      captureWindow.webContents.openDevTools();
    }
  });

  ipcMain.handle('select-folder-dialog', async () => {
    const { dialog } = require('electron');
    
    // screenshot 폴더를 기본 경로로 설정
    const defaultPath = path.join(os.homedir(), 'Downloads', 'screenshot');
    
    // 폴더가 없으면 생성
    try {
      await fs.promises.mkdir(defaultPath, { recursive: true });
    } catch (error) {
      console.log('Screenshot folder already exists or error creating:', error.message);
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '저장할 폴더를 선택하세요',
      defaultPath: defaultPath
    });
    return result;
  });

  ipcMain.handle('minimize-main-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle('get-windows', async () => {
    try {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 150, height: 150 }
      });
      
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }));
    } catch (error) {
      console.error('Get windows error:', error);
      return [];
    }
  });

  ipcMain.handle('capture-window', async (event, windowId) => {
    try {
      if (captureWindow) {
        captureWindow.close();
      }

      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 4096, height: 4096 }
      });

      const windowSource = sources.find(source => source.id === windowId);
      if (!windowSource) {
        throw new Error('창을 찾을 수 없습니다.');
      }

      const image = windowSource.thumbnail;
      
      saveToClipboard(image);
      addToHistory(image);

      const downloadsPath = path.join(os.homedir(), 'Downloads', 'screenshot');
      await fs.promises.mkdir(downloadsPath, { recursive: true });
      
      const fileName = `window_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      const filePath = path.join(downloadsPath, fileName);
      
      await fs.promises.writeFile(filePath, image.toPNG());

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send('capture-complete', image.toDataURL());
        mainWindow.webContents.send('capture-saved', { filePath, fileName });
      }

      return { success: true };
    } catch (error) {
      console.error('Window capture error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send('capture-error', error.message);
      }
      return { success: false, error: error.message };
    }
  });
}

async function startCapture(mode) {
  if (isCapturing) return;
  
  // fixed-capture 모드는 바로 고정 영역 캡처
  if (mode === 'fixed-capture') {
    captureFixedArea();
    return;
  }
  
  // 창 캡쳐 모드는 바로 창 선택 다이얼로그 표시
  if (mode === 'window') {
    await showWindowSelectionDialog();
    return;
  }
  
  isCapturing = true;
  
  if (mainWindow) {
    mainWindow.minimize();
  }

  setTimeout(() => {
    createCaptureWindow();
    if (captureWindow) {
      captureWindow.webContents.once('did-finish-load', () => {
        captureWindow.webContents.send('set-capture-mode', mode);
      });
    }
  }, 200);
}

async function showWindowSelectionDialog() {
  try {
    console.log('Loading window list for selection...');
    const { desktopCapturer } = require('electron');
    
    // 창 목록 가져오기
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 300, height: 200 }
    });
    
    console.log('Found sources:', sources.length);
    
    // 빈 이름이나 자체 앱 제외
    const windows = sources.filter(source => 
      source.name && 
      source.name.trim() !== '' &&
      source.name !== 'Quickshot'
    );
    
    console.log('Filtered windows:', windows.length);
    windows.forEach(win => console.log('Window:', win.name));
    
    if (windows.length === 0) {
      const { dialog } = require('electron');
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '창 캡쳐',
        message: '캡처할 수 있는 창이 없습니다.',
        detail: '다른 프로그램을 실행한 후 다시 시도해주세요.\n\n또는 Windows 설정에서 화면 캡처 권한을 확인해주세요.',
        buttons: ['확인']
      });
      return;
    }
    
    // 메인 창에 창 목록 전송
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.webContents.send('show-window-selection', windows.map(win => ({
        id: win.id,
        name: win.name,
        thumbnail: win.thumbnail.toDataURL()
      })));
    }
    
  } catch (error) {
    console.error('Error in showWindowSelectionDialog:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox('오류', `창 목록을 불러올 수 없습니다: ${error.message}`);
  }
}

async function getScreenSources() {
  const { desktopCapturer } = require('electron');
  const displays = screen.getAllDisplays();
  const sources = [];

  for (const display of displays) {
    const displaySources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: display.bounds.width * display.scaleFactor,
        height: display.bounds.height * display.scaleFactor
      }
    });

    const source = displaySources.find(s => s.display_id === display.id.toString()) || displaySources[0];
    
    if (source) {
      sources.push({
        display: display,
        thumbnail: source.thumbnail.toDataURL()
      });
    }
  }

  return sources;
}

function isAreaInDisplay(area, displayBounds) {
  return !(area.x + area.width <= displayBounds.x ||
           area.x >= displayBounds.x + displayBounds.width ||
           area.y + area.height <= displayBounds.y ||
           area.y >= displayBounds.y + displayBounds.height);
}

function combineImages(images) {
  return images[0];
}

function saveToClipboard(image) {
  clipboard.writeImage(image);
}

function addToHistory(image) {
  const dataUrl = image.toDataURL();
  const timestamp = new Date().toISOString();
  
  clipboardHistory.unshift({
    dataUrl,
    timestamp,
    id: Date.now()
  });

  if (clipboardHistory.length > 50) {
    clipboardHistory.pop();
  }
}

async function captureFullScreen() {
  if (mainWindow) {
    mainWindow.minimize();
  }

  setTimeout(async () => {
    try {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: screen.getPrimaryDisplay().workAreaSize.width,
          height: screen.getPrimaryDisplay().workAreaSize.height
        }
      });

      if (sources && sources.length > 0) {
        const image = sources[0].thumbnail;
        
        saveToClipboard(image);
        addToHistory(image);

        const downloadsPath = path.join(os.homedir(), 'Downloads', 'screenshot');
        await fs.promises.mkdir(downloadsPath, { recursive: true });
        
        const fileName = `fullscreen_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const filePath = path.join(downloadsPath, fileName);
        
        await fs.promises.writeFile(filePath, image.toPNG());

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.webContents.send('capture-complete', image.toDataURL());
          mainWindow.webContents.send('capture-saved', { filePath, fileName });
        }
      }
    } catch (error) {
      console.error('Full screen capture error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send('capture-error', error.message);
      }
    }
  }, 200);
}

async function captureFixedArea() {
  if (!fixedArea) {
    // 고정 영역이 없으면 설정하도록 유도
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.webContents.send('show-fixed-area-dialog');
    }
    return;
  }
  
  if (mainWindow) {
    mainWindow.minimize();
  }

  setTimeout(async () => {
    try {
      const sources = await getScreenSources();
      const captures = [];

      for (const source of sources) {
        const image = nativeImage.createFromDataURL(source.thumbnail);
        const display = source.display;
        
        if (isAreaInDisplay(fixedArea, display.bounds)) {
          const relativeBounds = {
            x: fixedArea.x - display.bounds.x,
            y: fixedArea.y - display.bounds.y,
            width: fixedArea.width,
            height: fixedArea.height
          };

          const scaleFactor = display.scaleFactor;
          const physicalBounds = {
            x: Math.round(relativeBounds.x * scaleFactor),
            y: Math.round(relativeBounds.y * scaleFactor),
            width: Math.round(relativeBounds.width * scaleFactor),
            height: Math.round(relativeBounds.height * scaleFactor)
          };

          const cropped = image.crop(physicalBounds);
          captures.push(cropped);
        }
      }

      if (captures.length > 0) {
        let finalImage = captures[0];
        
        saveToClipboard(finalImage);
        addToHistory(finalImage);

        const downloadsPath = path.join(os.homedir(), 'Downloads', 'screenshot');
        await fs.promises.mkdir(downloadsPath, { recursive: true });
        
        const fileName = `fixed_area_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const filePath = path.join(downloadsPath, fileName);
        
        await fs.promises.writeFile(filePath, finalImage.toPNG());

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.webContents.send('capture-complete', finalImage.toDataURL());
          mainWindow.webContents.send('capture-saved', { filePath, fileName });
        }
      }
    } catch (error) {
      console.error('Fixed area capture error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send('capture-error', error.message);
      }
    }
  }, 200);
}