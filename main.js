const { app, BrowserWindow, clipboard, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { getEncryptionKey, encrypt, decrypt } = require('./crypto-utils');
const { getActiveApp } = require('./app-detector');
const aiService = require('./ai-service');
const { simulatePaste } = require('./key-simulator');
const chatAssistant = require('./chat-assistant');

let mainWindow = null;
let tray = null;
let clipboardHistory = [];
let isMonitoring = true;
let isPrivateMode = false;
let monitoringInterval = null;
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
  autoSendReplies: false
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
    console.error('Error loading settings:', error);
  }
}

// Save settings
function saveSettings() {
  try {
    settings.privateMode = isPrivateMode;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
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
    }
  } catch (error) {
    console.error('Error loading history:', error);
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
  } catch (error) {
    console.error('Error saving history:', error);
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
      console.error('Error categorizing:', error);
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
  
  // Limit history size
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

// Create system tray
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  updateTrayMenu();
  
  tray.on('click', () => {
    showWindow();
  });
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

// App lifecycle
app.whenReady().then(async () => {
  loadSettings();
  await loadHistory();
  createTray();
  createWindow();
  
  // Register global shortcut (Cmd+Shift+V on macOS, Ctrl+Shift+V on Windows/Linux)
  const shortcut = process.platform === 'darwin' ? 'CommandOrControl+Shift+V' : 'Control+Shift+V';
  globalShortcut.register(shortcut, () => {
    showWindow();
  });
  
  // Start monitoring clipboard
  startMonitoring();
  
  console.log(`Economos started. Press ${shortcut} to open history.`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
    } catch (error) {
      console.error('Failed to simulate paste:', error);
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
