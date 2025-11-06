const { app, BrowserWindow, clipboard, globalShortcut, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { getEncryptionKey, encrypt, decrypt } = require('./crypto-utils');
const { getActiveApp } = require('./app-detector');
const aiService = require('./ai-service');
const { simulatePaste } = require('./key-simulator');
const chatAssistant = require('./chat-assistant');
const logger = require('./logger');

let mainWindow = null;
let tray = null;
let clipboardHistory = [];
let isMonitoring = true;
let isPrivateMode = false;
let monitoringInterval = null;
let cleanupInterval = null;
let settings = {
  encryptionEnabled: true,
  inMemoryOnly: false,
  excludedApps: [],
  privateMode: false,
  aiEnabled: false,
  openaiApiKey: '',
  groqApiKey: '',
  autoCategorize: false,
  chatAssistantEnabled: false,
  watchedApps: [],
  autoSendReplies: false,
  retentionDays: 0 // 0 = forever, 3 = 3 days, 7 = 7 days
};

const MAX_HISTORY = 100;
const HISTORY_FILE = path.join(app.getPath('userData'), 'clipboard-history.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const ENCRYPTED_HISTORY_FILE = path.join(app.getPath('userData'), 'clipboard-history.encrypted');

// Load settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      settings = { ...settings, ...JSON.parse(data) };
      isPrivateMode = settings.privateMode || false;
    }
  } catch (error) {
    logger.error('Error loading settings', error);
  }
}

// Save settings
function saveSettings() {
  try {
    settings.privateMode = isPrivateMode;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    logger.debug('Settings saved');
  } catch (error) {
    logger.error('Error saving settings', error);
  }
}

// Load history from file
async function loadHistory() {
  try {
    if (settings.inMemoryOnly) {
      clipboardHistory = [];
      return;
    }

    let data = null;
    
    if (settings.encryptionEnabled && fs.existsSync(ENCRYPTED_HISTORY_FILE)) {
      // Load encrypted history
      const encryptedData = fs.readFileSync(ENCRYPTED_HISTORY_FILE, 'utf8');
      const key = getEncryptionKey(app.getPath('userData'));
      const decrypted = decrypt(encryptedData, key);
      if (decrypted) {
        data = decrypted;
      }
    } else if (fs.existsSync(HISTORY_FILE)) {
      // Load plain text history (for migration)
      data = fs.readFileSync(HISTORY_FILE, 'utf8');
    }

    if (data) {
      clipboardHistory = JSON.parse(data);
      logger.debug('History loaded', { count: clipboardHistory.length });
      // Clean up old items on load
      cleanupOldItems();
    }
  } catch (error) {
    logger.error('Error loading history', error);
    clipboardHistory = [];
  }
}

// Save history to file
async function saveHistory() {
  if (settings.inMemoryOnly) {
    return; // Don't save to disk
  }

  try {
    const data = JSON.stringify(clipboardHistory, null, 2);
    
    if (settings.encryptionEnabled) {
      // Save encrypted
      const key = getEncryptionKey(app.getPath('userData'));
      const encrypted = encrypt(data, key);
      fs.writeFileSync(ENCRYPTED_HISTORY_FILE, encrypted);
      // Remove plain text file if it exists
      if (fs.existsSync(HISTORY_FILE)) {
        fs.unlinkSync(HISTORY_FILE);
      }
    } else {
      // Save plain text
      fs.writeFileSync(HISTORY_FILE, data);
      // Remove encrypted file if it exists
      if (fs.existsSync(ENCRYPTED_HISTORY_FILE)) {
        fs.unlinkSync(ENCRYPTED_HISTORY_FILE);
      }
    }
    logger.debug('History saved', { count: clipboardHistory.length });
  } catch (error) {
    logger.error('Error saving history', error);
  }
}

// Clean up old clipboard items based on retention settings
async function cleanupOldItems() {
  const retentionDays = settings.retentionDays || 0;
  
  // If retention is 0 (forever), don't clean up
  if (retentionDays === 0) {
    return;
  }
  
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const initialCount = clipboardHistory.length;
  
  clipboardHistory = clipboardHistory.filter(item => {
    // Keep items that are newer than cutoff time
    return item.timestamp >= cutoffTime;
  });
  
  const removedCount = initialCount - clipboardHistory.length;
  
  if (removedCount > 0) {
    logger.info(`Cleaned up ${removedCount} old clipboard items`, { 
      retentionDays, 
      remaining: clipboardHistory.length 
    });
    await saveHistory();
    
    // Update window if it exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('history-updated', clipboardHistory);
    }
  }
}

// Start periodic cleanup (runs every hour)
function startCleanupService() {
  // Clear existing interval if any
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  
  // Run cleanup immediately
  cleanupOldItems().catch(err => {
    logger.error('Error in initial cleanup', err);
  });
  
  // Only start interval if retention is enabled (not forever)
  if (settings.retentionDays && settings.retentionDays > 0) {
    // Then run cleanup every hour (3600000 ms)
    cleanupInterval = setInterval(() => {
      cleanupOldItems().catch(err => {
        logger.error('Error in periodic cleanup', err);
      });
    }, 3600000); // 1 hour
    
    logger.debug('Cleanup service started', { retentionDays: settings.retentionDays });
  } else {
    logger.debug('Cleanup service disabled (keep forever)', { retentionDays: settings.retentionDays });
  }
}

// Stop periodic cleanup
function stopCleanupService() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.debug('Cleanup service stopped');
  }
}

// Check if app is excluded
async function isAppExcluded() {
  if (settings.excludedApps.length === 0) return false;
  
  try {
    const activeApp = await getActiveApp();
    return settings.excludedApps.some(app => 
      activeApp.toLowerCase().includes(app.toLowerCase())
    );
  } catch (error) {
    return false;
  }
}

// Add clipboard item to history
async function addToHistory(text) {
  if (!text || text.trim() === '') return;
  if (isPrivateMode) return; // Don't log in private mode
  if (await isAppExcluded()) return; // Don't log if app is excluded
  
  // Avoid duplicates (don't add if same as last item)
  if (clipboardHistory.length > 0 && clipboardHistory[0].text === text) {
    return;
  }
  
  // Create new history item
  const newItem = {
    text: text,
    timestamp: Date.now(),
    id: Date.now().toString(),
    category: 'other'
  };
  
  // Auto-categorize if enabled and AI is configured
  if (settings.autoCategorize && settings.aiEnabled && (settings.openaiApiKey || settings.groqApiKey)) {
    try {
      if (settings.openaiApiKey) {
        aiService.setOpenAIKey(settings.openaiApiKey);
      }
      if (settings.groqApiKey) {
        aiService.setGroqKey(settings.groqApiKey);
      }
      newItem.category = await aiService.categorizeText(text);
    } catch (error) {
      logger.warn('Error categorizing text', error);
      // Use fallback categorization
      if (text.includes('@') && text.includes('.')) newItem.category = 'email';
      else if (text.startsWith('http://') || text.startsWith('https://')) newItem.category = 'link';
      else if (/^[0-9]+$/.test(text.trim())) newItem.category = 'number';
      else if (text.includes('{') || text.includes('[')) newItem.category = 'json';
      else if (text.includes('<') && text.includes('>')) newItem.category = 'html';
      else if (text.includes('function') || text.includes('const ')) newItem.category = 'code';
      else newItem.category = 'note';
    }
  } else {
    // Basic fallback categorization
    if (text.includes('@') && text.includes('.')) newItem.category = 'email';
    else if (text.startsWith('http://') || text.startsWith('https://')) newItem.category = 'link';
    else if (/^[0-9]+$/.test(text.trim())) newItem.category = 'number';
    else if (text.includes('{') || text.includes('[')) newItem.category = 'json';
    else if (text.includes('<') && text.includes('>')) newItem.category = 'html';
    else if (text.includes('function') || text.includes('const ')) newItem.category = 'code';
    else newItem.category = 'note';
  }
  
  // Add to beginning of array
  clipboardHistory.unshift(newItem);
  
  // Clean up old items before checking size limit
  await cleanupOldItems();
  
  // Limit history size (after cleanup)
  if (clipboardHistory.length > MAX_HISTORY) {
    clipboardHistory = clipboardHistory.slice(0, MAX_HISTORY);
  }
  
  await saveHistory();
  
  // Update window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', clipboardHistory);
  }
}

// Monitor clipboard
let lastClipboardText = '';
async function monitorClipboard() {
  const currentText = clipboard.readText();
  if (currentText !== lastClipboardText) {
    lastClipboardText = currentText;
    await addToHistory(currentText);
  }
}

// Start monitoring clipboard
function startMonitoring() {
  if (monitoringInterval) return; // Already monitoring
  
  isMonitoring = true;
  monitoringInterval = setInterval(() => monitorClipboard(), 500);
  updateTrayMenu();
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('monitoring-status', isMonitoring);
  }
}

// Stop monitoring clipboard
function stopMonitoring() {
  if (!monitoringInterval) return; // Already stopped
  
  isMonitoring = false;
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  updateTrayMenu();
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('monitoring-status', isMonitoring);
  }
}

// Toggle monitoring
function toggleMonitoring() {
  if (isMonitoring) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
}

// Toggle private mode
function togglePrivateMode() {
  isPrivateMode = !isPrivateMode;
  saveSettings();
  updateTrayMenu();
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('private-mode-status', isPrivateMode);
  }
}

// Update tray menu
function updateTrayMenu() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show History',
      click: () => {
        showWindow();
      }
    },
    { type: 'separator' },
    {
      label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => {
        toggleMonitoring();
      }
    },
    {
      label: isPrivateMode ? 'Exit Private Mode' : 'Enter Private Mode',
      click: () => {
        togglePrivateMode();
      }
    },
    {
      label: 'Clear History',
      click: () => {
        clipboardHistory = [];
        saveHistory();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('history-updated', clipboardHistory);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  let status = isMonitoring ? 'Active' : 'Paused';
  if (isPrivateMode) status += ' (Private)';
  tray.setToolTip(`Economos - Multi-Clipboard Manager (${status})`);
}

// Create a simple fallback icon
function createFallbackIcon() {
  // Create a simple 16x16 icon using a data URI (clipboard icon)
  // Using a simple colored square as fallback
  const size = process.platform === 'win32' ? 16 : 22;
  const icon = nativeImage.createEmpty();
  
  // For Windows, try to create a simple bitmap
  // If that fails, we'll use the empty icon (which should still work)
  return icon;
}

// Create system tray
function createTray() {
  try {
    let icon = null;
    
    // Try multiple icon paths (for development and packaged app)
    const possibleIconPaths = [
      path.join(__dirname, 'build', 'icon.png'),
      path.join(__dirname, 'build', 'icon.ico'),
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(process.resourcesPath, 'build', 'icon.ico'),
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(app.getAppPath(), 'build', 'icon.ico')
    ];
    
    // Try to load icon from any of the possible paths
    for (const iconPath of possibleIconPaths) {
      try {
        if (fs.existsSync(iconPath)) {
          icon = nativeImage.createFromPath(iconPath);
          if (!icon.isEmpty()) {
            // Resize for tray (16x16 or 22x22 depending on platform)
            const size = process.platform === 'win32' ? 16 : 22;
            icon = icon.resize({ width: size, height: size });
            logger.debug('Loaded tray icon from', iconPath);
            break;
          }
        }
      } catch (error) {
        // Continue trying other paths
        continue;
      }
    }
    
    // If no icon loaded, create a fallback
    if (!icon || icon.isEmpty()) {
      logger.warn('Could not load tray icon from any path, using fallback');
      icon = createFallbackIcon();
    }
    
    // Create tray with icon (empty icon should still work on Windows)
    tray = new Tray(icon);
    
    // Windows: Set tooltip immediately (before menu)
    if (process.platform === 'win32') {
      tray.setToolTip('Economos - Multi-Clipboard Manager');
    }
    
    updateTrayMenu();
    
    // Windows: Use click event, macOS/Linux: use click for left, right-click for menu
    if (process.platform === 'win32') {
      tray.on('click', () => {
        showWindow();
      });
    } else {
      tray.on('click', () => {
        showWindow();
      });
    }
    
    logger.debug('System tray created successfully');
  } catch (error) {
    logger.error('Failed to create system tray', error);
    // Don't crash the app if tray creation fails
    // The app can still work without tray icon (though less convenient)
  }
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('blur', () => {
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  
  // Send current state to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', clipboardHistory);
    mainWindow.webContents.send('monitoring-status', isMonitoring);
    mainWindow.webContents.send('private-mode-status', isPrivateMode);
    mainWindow.webContents.send('settings-updated', settings);
  }
  
  // Initialize AI service if API keys are set
  if (settings.aiEnabled) {
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
  }
  
  // Initialize chat assistant
  if (settings.chatAssistantEnabled && settings.watchedApps) {
    settings.watchedApps.forEach(app => chatAssistant.addWatchedApp(app));
    if (settings.chatAssistantEnabled) {
      startChatAssistant();
    }
  }
  
  // Position window near cursor or center
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const winSize = mainWindow.getSize();
  
  mainWindow.setPosition(
    Math.floor((width - winSize[0]) / 2),
    Math.floor((height - winSize[1]) / 2)
  );
  
  mainWindow.show();
  mainWindow.focus();
}

// Setup crash handlers
function setupCrashHandlers() {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.critical('Uncaught Exception', error);
    dialog.showErrorBox('Application Error', `An unexpected error occurred:\n\n${error.message}\n\nCheck logs for details.`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.critical('Unhandled Promise Rejection', { reason, promise });
  });

  // Handle renderer process crashes
  app.on('render-process-gone', (event, webContents, details) => {
    logger.critical('Render Process Crashed', details);
    dialog.showErrorBox('Renderer Crashed', `The renderer process crashed:\n\n${details.reason}\n\nCheck logs for details.`);
  });

  // Handle main process window crashes
  app.on('child-process-gone', (event, details) => {
    logger.error('Child Process Gone', details);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    setupCrashHandlers();
    
    // Initialize file paths first
    initializeFilePaths();
    
    logger.info('Economos starting', {
      platform: process.platform,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      userData: app.getPath('userData')
    });
    
    // Load settings and history
    try {
      loadSettings();
    } catch (error) {
      logger.error('Failed to load settings', error);
    }
    
    try {
      await loadHistory();
    } catch (error) {
      logger.error('Failed to load history', error);
      clipboardHistory = []; // Start with empty history
    }
    
    // Create tray (non-critical, continue if it fails)
    try {
      createTray();
    } catch (error) {
      logger.error('Failed to create tray, continuing without tray icon', error);
    }
    
    // Create window (must succeed for app to work)
    try {
      createWindow();
      // Show window on first start (Windows users might not see tray icon)
      if (process.platform === 'win32') {
        // On Windows, show window briefly on first start to indicate app is running
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        }, 2000);
      }
    } catch (error) {
      logger.critical('Failed to create window', error);
      dialog.showErrorBox('Startup Error', `Failed to create application window:\n\n${error.message}\n\nCheck logs for details.`);
      app.quit();
      return;
    }
    
    // Register global shortcut
    try {
      const shortcut = process.platform === 'darwin' ? 'CommandOrControl+Shift+V' : 'Control+Shift+V';
      const registered = globalShortcut.register(shortcut, () => {
        showWindow();
      });
      
      if (!registered) {
        logger.warn(`Failed to register global shortcut: ${shortcut}`);
      } else {
        logger.info(`Global shortcut registered: ${shortcut}`);
      }
    } catch (error) {
      logger.error('Failed to register global shortcut', error);
      // Continue without global shortcut - user can still use tray menu
    }
    
    // Start monitoring clipboard
    try {
      startMonitoring();
    } catch (error) {
      logger.error('Failed to start clipboard monitoring', error);
      // Continue without monitoring - user can start it manually
    }
    
    // Start cleanup service
    try {
      startCleanupService();
    } catch (error) {
      logger.error('Failed to start cleanup service', error);
      // Non-critical, continue
    }
    
    logger.info('Economos started successfully', {
      platform: process.platform,
      version: app.getVersion(),
      userData: app.getPath('userData')
    });
  } catch (error) {
    logger.critical('Fatal error during startup', error);
    dialog.showErrorBox('Fatal Error', `Application failed to start:\n\n${error.message}\n\nCheck logs for details.`);
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopCleanupService();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Prevent app from closing when window is closed
});

// IPC handlers
const { ipcMain } = require('electron');
ipcMain.on('paste-item', async (event, text) => {
  clipboard.writeText(text);
  
  // Hide window first
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  
  // Wait a moment for window to close and focus to return, then simulate paste
  setTimeout(() => {
    try {
      simulatePaste();
      logger.debug('Pasted item', { textLength: text.length });
    } catch (error) {
      logger.error('Failed to simulate paste', error);
      // User can still manually paste with Cmd/Ctrl+V
    }
  }, 200);
});

ipcMain.on('get-history', (event) => {
  event.returnValue = clipboardHistory;
});

ipcMain.on('close-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

ipcMain.on('update-history', async (event, newHistory) => {
  clipboardHistory = newHistory;
  await saveHistory();
});

ipcMain.on('delete-item', async (event, itemId) => {
  clipboardHistory = clipboardHistory.filter(item => item.id !== itemId);
  await saveHistory();
  logger.debug('Item deleted from history', { itemId });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', clipboardHistory);
  }
});

ipcMain.on('toggle-monitoring', () => {
  toggleMonitoring();
});

ipcMain.on('toggle-private-mode', () => {
  togglePrivateMode();
});

ipcMain.on('get-monitoring-status', (event) => {
  event.returnValue = isMonitoring;
});

ipcMain.on('get-private-mode-status', (event) => {
  event.returnValue = isPrivateMode;
});

ipcMain.on('get-settings', (event) => {
  event.returnValue = settings;
});

ipcMain.on('update-settings', async (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  
  // If retention days changed, restart cleanup service
  if (newSettings.retentionDays !== undefined) {
    startCleanupService();
    // Clean up immediately when setting changes (already called in startCleanupService, but ensure it runs)
  }
  
  // If switching to/from in-memory mode or encryption, reload history
  if (newSettings.inMemoryOnly !== undefined || newSettings.encryptionEnabled !== undefined) {
    await loadHistory();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('history-updated', clipboardHistory);
    }
  }
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('add-excluded-app', async (event, appName) => {
  if (!settings.excludedApps.includes(appName)) {
    settings.excludedApps.push(appName);
    saveSettings();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-updated', settings);
    }
  }
});

ipcMain.on('remove-excluded-app', async (event, appName) => {
  settings.excludedApps = settings.excludedApps.filter(app => app !== appName);
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});

// AI Feature Handlers
ipcMain.handle('smart-paste', async (event, text, options) => {
  try {
    if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
      throw new Error('AI features require OpenAI or Groq API key');
    }
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
    const result = await aiService.smartPaste(text, options);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('semantic-search', async (event, query) => {
  try {
    if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
      throw new Error('AI features require OpenAI or Groq API key');
    }
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
    const results = await aiService.semanticSearch(query, clipboardHistory, 10);
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-reply', async (event, messages, context) => {
  try {
    if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
      throw new Error('AI features require OpenAI or Groq API key');
    }
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
    const reply = await aiService.generateReply(messages, context);
    return { success: true, reply };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('format-text', async (event, text, formatType) => {
  try {
    if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
      throw new Error('AI features require OpenAI or Groq API key');
    }
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
    const formatted = await aiService.formatText(text, formatType);
    return { success: true, formatted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('categorize-text', async (event, text) => {
  try {
    if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
      return { success: false, error: 'AI features require OpenAI or Groq API key' };
    }
    if (settings.openaiApiKey) {
      aiService.setOpenAIKey(settings.openaiApiKey);
    }
    if (settings.groqApiKey) {
      aiService.setGroqKey(settings.groqApiKey);
    }
    const category = await aiService.categorizeText(text);
    return { success: true, category };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chat Assistant Handlers
function startChatAssistant() {
  if (!settings.chatAssistantEnabled || !settings.aiEnabled) return;
  
  // Initialize AI service for chat assistant
  if (settings.groqApiKey) {
    aiService.setGroqKey(settings.groqApiKey);
  }
  if (settings.openaiApiKey) {
    aiService.setOpenAIKey(settings.openaiApiKey);
  }
  
  // Set AI service in chat assistant
  const { setAIService } = require('./chat-assistant');
  setAIService(aiService);
  
  chatAssistant.startClipboardMonitoring(async (data) => {
    // Auto-send reply if enabled
    if (settings.autoSendReplies && data.reply) {
      await chatAssistant.sendReply(data.reply, data.app, clipboard, simulatePaste);
    }
    
    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat-assistant-message', data);
    }
  }, clipboard);
}

function stopChatAssistant() {
  chatAssistant.stopMonitoring();
}

ipcMain.on('chat-assistant-toggle', async (event, enabled) => {
  settings.chatAssistantEnabled = enabled;
  saveSettings();
  
  if (enabled) {
    startChatAssistant();
  } else {
    stopChatAssistant();
  }
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('add-watched-app', async (event, appName) => {
  chatAssistant.addWatchedApp(appName);
  if (!settings.watchedApps.includes(appName)) {
    settings.watchedApps.push(appName);
    saveSettings();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('remove-watched-app', async (event, appName) => {
  chatAssistant.removeWatchedApp(appName);
  settings.watchedApps = settings.watchedApps.filter(app => app !== appName);
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('get-watched-apps', (event) => {
  event.returnValue = chatAssistant.getWatchedApps();
});

// Log viewer IPC handlers
ipcMain.handle('get-logs', async (event, lines = 500, errorOnly = false) => {
  try {
    return logger.readLogs(lines, errorOnly);
  } catch (error) {
    logger.error('Error getting logs', error);
    return { logs: [], error: error.message };
  }
});

ipcMain.handle('get-all-log-files', async () => {
  try {
    return logger.getAllLogFiles();
  } catch (error) {
    logger.error('Error getting log files', error);
    return [];
  }
});

ipcMain.handle('read-log-file', async (event, filePath, lines = 500) => {
  try {
    return logger.readLogFile(filePath, lines);
  } catch (error) {
    logger.error('Error reading log file', error);
    return { logs: [], error: error.message };
  }
});

ipcMain.handle('get-log-directory', () => {
  return logger.getLogDirectory();
});

ipcMain.handle('open-log-directory', () => {
  try {
    const logDir = logger.getLogDirectory();
    shell.openPath(logDir);
    return { success: true, path: logDir };
  } catch (error) {
    logger.error('Error opening log directory', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-old-logs', async (event, daysToKeep = 7) => {
  try {
    return logger.clearOldLogs(daysToKeep);
  } catch (error) {
    logger.error('Error clearing old logs', error);
    return { deleted: 0, error: error.message };
  }
});

ipcMain.handle('analyze-logs', async (event, filePath = null) => {
  try {
    return logger.analyzeLogs(filePath);
  } catch (error) {
    logger.error('Error analyzing logs', error);
    return logger.getEmptyInsights();
  }
});

ipcMain.handle('send-chat-reply', async (event, reply, appName) => {
  try {
    const success = await chatAssistant.sendReply(reply, appName, clipboard, simulatePaste);
    return { success };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('toggle-auto-send', async (event, enabled) => {
  settings.autoSendReplies = enabled;
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', settings);
  }
});
