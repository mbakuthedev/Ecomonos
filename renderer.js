const { ipcRenderer } = require('electron');
const { clipboard } = require('electron');

let history = [];
let filteredHistory = [];
let selectedIndex = -1;
let isMonitoring = true;
let isPrivateMode = false;
let settings = {
  encryptionEnabled: true,
  inMemoryOnly: false,
  excludedApps: [],
  aiEnabled: false,
  openaiApiKey: '',
  groqApiKey: '',
  autoCategorize: false,
  chatAssistantEnabled: false,
  watchedApps: [],
  autoSendReplies: false,
  retentionDays: 0
};
let isAiSearchMode = false;
let chatLog = [];

// Load history on startup
window.addEventListener('DOMContentLoaded', () => {
  history = ipcRenderer.sendSync('get-history');
  filteredHistory = history;
  isMonitoring = ipcRenderer.sendSync('get-monitoring-status');
  isPrivateMode = ipcRenderer.sendSync('get-private-mode-status');
  settings = ipcRenderer.sendSync('get-settings');
  
  updateMonitoringUI();
  updatePrivateModeUI();
  updateSettingsUI();
  renderHistory();
  
  // Focus search input
  document.getElementById('searchInput').focus();
});

// Listen for updates
ipcRenderer.on('history-updated', (event, newHistory) => {
  history = newHistory;
  filterHistory();
  renderHistory();
});

ipcRenderer.on('monitoring-status', (event, status) => {
  isMonitoring = status;
  updateMonitoringUI();
});

ipcRenderer.on('private-mode-status', (event, status) => {
  isPrivateMode = status;
  updatePrivateModeUI();
});

ipcRenderer.on('settings-updated', (event, newSettings) => {
  settings = newSettings;
  updateSettingsUI();
});

// Close button
document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-window');
});

// Panel management - ensure only one panel is open at a time
function closeAllPanels() {
  document.getElementById('settingsPanel').style.display = 'none';
  document.getElementById('aiPanel').style.display = 'none';
  document.getElementById('logsPanel').style.display = 'none';
  document.getElementById('aiBtn').classList.remove('active');
  document.getElementById('aiSearchBtn').classList.remove('active');
  isAiSearchMode = false;
}

function openPanel(panelId, buttonId = null) {
  closeAllPanels();
  const panel = document.getElementById(panelId);
  panel.style.display = 'block';
  if (buttonId) {
    document.getElementById(buttonId).classList.add('active');
  }
}

// Logs button
document.getElementById('logsBtn').addEventListener('click', async () => {
  const panel = document.getElementById('logsPanel');
  const isVisible = panel.style.display !== 'none';
  
  if (isVisible) {
    closeAllPanels();
  } else {
    openPanel('logsPanel');
    await loadLogs();
    await loadLogFiles();
    await loadLogInsights(); // Load intelligent insights
  }
});

document.getElementById('closeLogsBtn').addEventListener('click', () => {
  closeAllPanels();
});

// Log viewer functionality
async function loadLogs() {
  const errorOnly = document.getElementById('errorOnlyToggle').checked;
  const lines = parseInt(document.getElementById('logLinesSelect').value);
  const selectedFile = document.getElementById('logFileSelect').value;
  
  try {
    let result;
    if (selectedFile === 'current') {
      result = await ipcRenderer.invoke('get-logs', lines, errorOnly);
    } else {
      result = await ipcRenderer.invoke('read-log-file', selectedFile, lines);
    }
    
    displayLogs(result.logs, result);
  } catch (error) {
    console.error('Error loading logs:', error);
    document.getElementById('logsOutput').textContent = `Error loading logs: ${error.message}`;
  }
}

function displayLogs(logs, info) {
  const output = document.getElementById('logsOutput');
  const infoDiv = document.getElementById('logsInfo');
  
  if (!info) {
    info = { totalLines: logs.length, showingLines: logs.length };
  }
  
  // Store logs for search
  allLogs = logs;
  
  // Update info
  if (info.error) {
    infoDiv.textContent = `Error: ${info.error}`;
  } else {
    const searchTerm = document.getElementById('logSearchInput').value;
    const searchInfo = searchTerm ? ` (filtered from ${info.totalLines || logs.length})` : '';
    infoDiv.textContent = `Showing ${info.showingLines || logs.length} of ${info.totalLines || logs.length} lines${searchInfo}${info.path ? ` • ${info.path.split(/[/\\]/).pop()}` : ''}`;
  }
  
  if (logs.length === 0) {
    output.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No log entries found</div>';
    return;
  }
  
  // Parse and format log lines
  const searchTerm = document.getElementById('logSearchInput').value.toLowerCase();
  const formattedLogs = logs.map(line => {
    // Parse log line: [timestamp] [LEVEL] message
    const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\]\s*(.+)$/);
    if (match) {
      const [, timestamp, level, message] = match;
      const levelLower = level.toLowerCase();
      let highlightedMessage = escapeHtml(message);
      
      // Highlight search term
      if (searchTerm) {
        const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
        highlightedMessage = highlightedMessage.replace(regex, '<mark>$1</mark>');
      }
      
      return `<div class="log-line ${levelLower}">
        <span class="log-line-timestamp">${escapeHtml(timestamp)}</span>
        <span class="log-line-level ${level}">[${level}]</span>
        <span class="log-line-message">${highlightedMessage}</span>
      </div>`;
    } else {
      let highlightedLine = escapeHtml(line);
      if (searchTerm) {
        const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
        highlightedLine = highlightedLine.replace(regex, '<mark>$1</mark>');
      }
      return `<div class="log-line">${highlightedLine}</div>`;
    }
  }).join('');
  
  output.innerHTML = formattedLogs;
  output.scrollTop = output.scrollHeight; // Scroll to bottom
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadLogFiles() {
  try {
    const files = await ipcRenderer.invoke('get-all-log-files');
    const select = document.getElementById('logFileSelect');
    
    // Keep "Current Log" option
    const currentOption = select.options[0];
    select.innerHTML = '';
    select.appendChild(currentOption);
    
    // Add log files
    files.forEach(file => {
      const option = document.createElement('option');
      option.value = file.path;
      const sizeKB = (file.size / 1024).toFixed(1);
      option.textContent = `${file.name} (${sizeKB} KB)`;
      select.appendChild(option);
    });
    
    // Select current log if no file selected
    if (files.length > 0 && select.value === 'current') {
      select.selectedIndex = 0;
    }
  } catch (error) {
    console.error('Error loading log files:', error);
  }
}

document.getElementById('refreshLogsBtn').addEventListener('click', async () => {
  await loadLogs();
});

document.getElementById('errorOnlyToggle').addEventListener('change', async () => {
  await loadLogs();
});

document.getElementById('logLinesSelect').addEventListener('change', async () => {
  await loadLogs();
});

document.getElementById('logFileSelect').addEventListener('change', async () => {
  await loadLogs();
  await loadLogInsights();
  document.getElementById('logSearchInput').value = ''; // Clear search when changing files
});

document.getElementById('openLogsDirBtn').addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('open-log-directory');
    if (!result.success) {
      alert('Error opening log directory: ' + result.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
});

document.getElementById('clearOldLogsBtn').addEventListener('click', async () => {
  if (!confirm('Delete log files older than 7 days?')) {
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('clear-old-logs', 7);
    if (result.error) {
      alert('Error clearing logs: ' + result.error);
    } else {
      alert(`Cleared ${result.deleted} old log file(s)`);
      await loadLogFiles();
      await loadLogs();
      await loadLogInsights();
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
});

// Toggle insights panel
document.getElementById('toggleInsightsBtn').addEventListener('click', () => {
  const content = document.getElementById('insightsContent');
  const btn = document.getElementById('toggleInsightsBtn');
  const isVisible = content.style.display !== 'none';
  
  if (isVisible) {
    content.style.display = 'none';
    btn.textContent = '+';
  } else {
    content.style.display = 'block';
    btn.textContent = '−';
    loadLogInsights();
  }
});

// Load log insights
async function loadLogInsights() {
  try {
    const selectedFile = document.getElementById('logFileSelect').value;
    const filePath = selectedFile === 'current' ? null : selectedFile;
    
    const insights = await ipcRenderer.invoke('analyze-logs', filePath);
    displayLogInsights(insights);
  } catch (error) {
    console.error('Error loading log insights:', error);
  }
}

function displayLogInsights(insights) {
  // Update statistics
  document.getElementById('statTotal').textContent = insights.stats.total.toLocaleString();
  document.getElementById('statErrors').textContent = insights.stats.error;
  document.getElementById('statWarnings').textContent = insights.stats.warn;
  document.getElementById('statLast24h').textContent = insights.stats.last24h;
  
  // Display alerts
  const alertsDiv = document.getElementById('insightAlerts');
  if (insights.alerts.length === 0) {
    alertsDiv.innerHTML = '<div class="insight-alert info">✓ No issues detected</div>';
  } else {
    alertsDiv.innerHTML = insights.alerts.map(alert => `
      <div class="insight-alert ${alert.severity}">
        <div class="alert-message">${escapeHtml(alert.message)}</div>
        <div class="alert-suggestion">${escapeHtml(alert.suggestion)}</div>
      </div>
    `).join('');
  }
  
  // Display patterns
  const patternsDiv = document.getElementById('insightPatterns');
  if (insights.patterns.length === 0 && insights.errorPatterns.length === 0) {
    patternsDiv.innerHTML = '<div class="insight-pattern">No patterns detected</div>';
  } else {
    let html = '';
    
    if (insights.patterns.length > 0) {
      html += insights.patterns.map(pattern => `
        <div class="insight-pattern">
          <span class="pattern-type">${escapeHtml(pattern.type.replace(/_/g, ' '))}</span>
          <span class="pattern-message">${escapeHtml(pattern.message)}</span>
          <span class="pattern-count">(${pattern.count})</span>
        </div>
      `).join('');
    }
    
    if (insights.errorPatterns.length > 0) {
      html += '<div class="insight-pattern-header">Top Error Patterns:</div>';
      html += insights.errorPatterns.map(pattern => `
        <div class="insight-pattern">
          <span class="pattern-message">${escapeHtml(pattern.pattern.substring(0, 60))}${pattern.pattern.length > 60 ? '...' : ''}</span>
          <span class="pattern-count error">×${pattern.count}</span>
        </div>
      `).join('');
    }
    
    patternsDiv.innerHTML = html;
  }
}

// Log search functionality
let filteredLogs = [];
let allLogs = [];

document.getElementById('logSearchInput').addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase();
  if (searchTerm === '') {
    displayLogs(allLogs, { totalLines: allLogs.length, showingLines: allLogs.length });
  } else {
    filteredLogs = allLogs.filter(line => line.toLowerCase().includes(searchTerm));
    displayLogs(filteredLogs, { totalLines: allLogs.length, showingLines: filteredLogs.length });
  }
});

// Update loadLogs to store all logs
const originalLoadLogs = loadLogs;
loadLogs = async function() {
  const result = await originalLoadLogs();
  allLogs = result.logs || [];
  return result;
};

// Toggle monitoring button
document.getElementById('toggleBtn').addEventListener('click', () => {
  ipcRenderer.send('toggle-monitoring');
});

// Private mode button
document.getElementById('privateBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  ipcRenderer.send('toggle-private-mode');
});

// Settings button
document.getElementById('settingsBtn').addEventListener('click', () => {
  const panel = document.getElementById('settingsPanel');
  const isVisible = panel.style.display !== 'none';
  
  if (isVisible) {
    closeAllPanels();
  } else {
    openPanel('settingsPanel');
  }
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
  closeAllPanels();
});

// Settings UI updates
function updateSettingsUI() {
  document.getElementById('encryptionToggle').checked = settings.encryptionEnabled;
  document.getElementById('inMemoryToggle').checked = settings.inMemoryOnly;
  document.getElementById('aiEnabledToggle').checked = settings.aiEnabled || false;
  document.getElementById('openaiApiKeyInput').value = settings.openaiApiKey || '';
  document.getElementById('groqApiKeyInput').value = settings.groqApiKey || '';
  document.getElementById('autoCategorizeToggle').checked = settings.autoCategorize || false;
  document.getElementById('retentionDaysSelect').value = settings.retentionDays || 0;
  
  // Chat Assistant settings
  document.getElementById('chatAssistantToggle').checked = settings.chatAssistantEnabled || false;
  document.getElementById('autoSendToggle').checked = settings.autoSendReplies || false;
  const chatSettings = document.getElementById('chatAssistantSettings');
  chatSettings.style.display = settings.chatAssistantEnabled ? 'block' : 'none';
  
  const aiSection = document.getElementById('aiSettingsSection');
  aiSection.style.display = settings.aiEnabled ? 'block' : 'none';
  
  updateExcludedAppsList();
  updateWatchedAppsList();
}

// Encryption toggle
document.getElementById('encryptionToggle').addEventListener('change', (e) => {
  ipcRenderer.send('update-settings', { encryptionEnabled: e.target.checked });
});

// In-memory toggle
document.getElementById('inMemoryToggle').addEventListener('change', (e) => {
  ipcRenderer.send('update-settings', { inMemoryOnly: e.target.checked });
});

// Retention days setting
document.getElementById('retentionDaysSelect').addEventListener('change', (e) => {
  const retentionDays = parseInt(e.target.value);
  ipcRenderer.send('update-settings', { retentionDays });
});

// Add excluded app
document.getElementById('addAppBtn').addEventListener('click', () => {
  const input = document.getElementById('addAppInput');
  const appName = input.value.trim();
  if (appName) {
    ipcRenderer.send('add-excluded-app', appName);
    input.value = '';
  }
});

document.getElementById('addAppInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('addAppBtn').click();
  }
});

// AI Settings
document.getElementById('aiEnabledToggle').addEventListener('change', (e) => {
  const newSettings = { aiEnabled: e.target.checked };
  if (!e.target.checked) {
    newSettings.openaiApiKey = '';
    newSettings.groqApiKey = '';
    newSettings.autoCategorize = false;
  }
  ipcRenderer.send('update-settings', newSettings);
});

document.getElementById('openaiApiKeyInput').addEventListener('change', (e) => {
  ipcRenderer.send('update-settings', { openaiApiKey: e.target.value });
});

document.getElementById('groqApiKeyInput').addEventListener('change', (e) => {
  ipcRenderer.send('update-settings', { groqApiKey: e.target.value });
});

document.getElementById('autoCategorizeToggle').addEventListener('change', (e) => {
  ipcRenderer.send('update-settings', { autoCategorize: e.target.checked });
});

// Chat Assistant
document.getElementById('chatAssistantToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  ipcRenderer.send('chat-assistant-toggle', enabled);
  document.getElementById('chatAssistantSettings').style.display = enabled ? 'block' : 'none';
});

document.getElementById('autoSendToggle').addEventListener('change', (e) => {
  ipcRenderer.send('toggle-auto-send', e.target.checked);
});

// Add watched app
document.getElementById('addWatchedAppBtn').addEventListener('click', () => {
  const input = document.getElementById('addWatchedAppInput');
  const appName = input.value.trim();
  if (appName) {
    ipcRenderer.send('add-watched-app', appName);
    input.value = '';
  }
});

document.getElementById('addWatchedAppInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('addWatchedAppBtn').click();
  }
});

function updateWatchedAppsList() {
  const list = document.getElementById('watchedAppsList');
  const watchedApps = settings.watchedApps || [];
  list.innerHTML = watchedApps.map(app => `
    <div class="watched-app-tag">
      <span>${escapeHtml(app)}</span>
      <button class="remove-app" data-app="${escapeHtml(app)}">×</button>
    </div>
  `).join('');
  
  // Add remove handlers
  document.querySelectorAll('#watchedAppsList .remove-app').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const appName = btn.dataset.app;
      ipcRenderer.send('remove-watched-app', appName);
    });
  });
}

// Listen for chat assistant messages
ipcRenderer.on('chat-assistant-message', (event, data) => {
  // Add to chat log
  chatLog.unshift({
    app: data.app,
    message: data.message,
    reply: data.reply,
    timestamp: new Date().toLocaleTimeString()
  });
  
  // Keep only last 10 entries
  if (chatLog.length > 10) {
    chatLog = chatLog.slice(0, 10);
  }
  
  // Update chat log display
  updateChatLog();
});

function updateChatLog() {
  const log = document.getElementById('chatLog');
  if (chatLog.length === 0) {
    log.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No activity yet</div>';
    return;
  }
  
  log.innerHTML = chatLog.map(entry => `
    <div class="chat-log-entry">
      <div class="app-name">${escapeHtml(entry.app)}</div>
      <div class="message">${escapeHtml(entry.message.substring(0, 100))}${entry.message.length > 100 ? '...' : ''}</div>
      <div class="reply">${escapeHtml(entry.reply.substring(0, 100))}${entry.reply.length > 100 ? '...' : ''}</div>
      <div class="timestamp">${entry.timestamp}</div>
    </div>
  `).join('');
}

// AI Panel
document.getElementById('aiBtn').addEventListener('click', () => {
  const panel = document.getElementById('aiPanel');
  const isVisible = panel.style.display !== 'none';
  
  if (isVisible) {
    closeAllPanels();
  } else {
    if (!settings.aiEnabled) {
      openPanel('settingsPanel');
      alert('Please enable AI features in Settings first and add your API key.');
      return;
    }
    openPanel('aiPanel', 'aiBtn');
  }
});

document.getElementById('closeAiBtn').addEventListener('click', () => {
  closeAllPanels();
});

// AI Tabs
document.querySelectorAll('.ai-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  // Update chat log when switching to chat assistant tab
  if (tabName === 'chat-assistant') {
    updateChatLog();
  }
});
});

// AI Semantic Search
document.getElementById('aiSearchBtn').addEventListener('click', () => {
  isAiSearchMode = !isAiSearchMode;
  document.getElementById('aiSearchBtn').classList.toggle('active', isAiSearchMode);
  const searchInput = document.getElementById('searchInput');
  
  // Close other panels when toggling AI search
  if (isAiSearchMode) {
    closeAllPanels();
  }
  
  if (isAiSearchMode) {
    searchInput.placeholder = 'AI Semantic Search (by meaning)...';
    if (searchInput.value) {
      performAiSearch(searchInput.value);
    }
  } else {
    searchInput.placeholder = 'Search history...';
    filterHistory();
    renderHistory();
  }
});

async function performAiSearch(query) {
  if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
    alert('AI features require OpenAI or Groq API key. Please configure in Settings.');
    isAiSearchMode = false;
    document.getElementById('aiSearchBtn').classList.remove('active');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('semantic-search', query);
    if (result.success) {
      filteredHistory = result.results;
      renderHistory();
    } else {
      alert('AI Search Error: ' + result.error);
    }
  } catch (error) {
    console.error('AI search error:', error);
  }
}

// Smart Paste
document.getElementById('smartPasteBtn').addEventListener('click', async () => {
  const input = document.getElementById('smartPasteInput').value;
  if (!input.trim()) {
    alert('Please enter text to process');
    return;
  }
  
  if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
    alert('AI features require OpenAI or Groq API key. Please configure in Settings.');
    return;
  }
  
  const btn = document.getElementById('smartPasteBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';
  
  try {
    const options = {
      removeLineBreaks: document.getElementById('removeLineBreaks').checked,
      formatJSON: document.getElementById('formatJSON').checked,
      rewriteTone: document.getElementById('rewriteTone').checked 
        ? document.getElementById('toneSelect').value 
        : null
    };
    
    const result = await ipcRenderer.invoke('smart-paste', input, options);
    if (result.success) {
      document.getElementById('smartPasteOutput').value = result.result;
      clipboard.writeText(result.result);
      alert('Text processed and copied to clipboard!');
    } else {
      alert('Error: ' + result.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Process & Copy';
  }
});

document.getElementById('rewriteTone').addEventListener('change', (e) => {
  document.getElementById('toneSelect').style.display = e.target.checked ? 'block' : 'none';
});

// Formatter
document.getElementById('formatterBtn').addEventListener('click', async () => {
  const input = document.getElementById('formatterInput').value;
  if (!input.trim()) {
    alert('Please enter text to format');
    return;
  }
  
  if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
    alert('AI features require OpenAI or Groq API key. Please configure in Settings.');
    return;
  }
  
  const btn = document.getElementById('formatterBtn');
  btn.disabled = true;
  btn.textContent = 'Formatting...';
  
  try {
    const formatType = document.getElementById('formatTypeSelect').value;
    const result = await ipcRenderer.invoke('format-text', input, formatType);
    if (result.success) {
      document.getElementById('formatterOutput').value = result.formatted;
      clipboard.writeText(result.formatted);
      alert('Text formatted and copied to clipboard!');
    } else {
      alert('Error: ' + result.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Format & Copy';
  }
});

// Reply Generator
document.getElementById('replyBtn').addEventListener('click', async () => {
  const input = document.getElementById('replyInput').value;
  if (!input.trim()) {
    alert('Please enter messages to generate a reply');
    return;
  }
  
  if (!settings.aiEnabled || (!settings.openaiApiKey && !settings.groqApiKey)) {
    alert('AI features require OpenAI or Groq API key. Please configure in Settings.');
    return;
  }
  
  const btn = document.getElementById('replyBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  
  try {
    const messages = input.split('\n').filter(m => m.trim());
    const context = document.getElementById('replyContext').value;
    const result = await ipcRenderer.invoke('generate-reply', messages, context);
    if (result.success) {
      document.getElementById('replyOutput').value = result.reply;
      clipboard.writeText(result.reply);
      alert('Reply generated and copied to clipboard!');
    } else {
      alert('Error: ' + result.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Reply';
  }
});

function updateExcludedAppsList() {
  const list = document.getElementById('excludedAppsList');
  list.innerHTML = settings.excludedApps.map(app => `
    <div class="excluded-app-tag">
      <span>${escapeHtml(app)}</span>
      <button class="remove-app" data-app="${escapeHtml(app)}">×</button>
    </div>
  `).join('');
  
  // Add remove handlers
  document.querySelectorAll('.remove-app').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const appName = btn.dataset.app;
      ipcRenderer.send('remove-excluded-app', appName);
    });
  });
}

function updateMonitoringUI() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const toggleIcon = document.getElementById('toggleIcon');
  const toggleBtn = document.getElementById('toggleBtn');
  
  if (isMonitoring) {
    statusDot.classList.add('active');
    statusDot.classList.remove('paused');
    statusText.textContent = 'Active';
    toggleIcon.textContent = '⏸';
    toggleBtn.title = 'Stop Monitoring';
  } else {
    statusDot.classList.add('paused');
    statusDot.classList.remove('active');
    statusText.textContent = 'Paused';
    toggleIcon.textContent = '▶';
    toggleBtn.title = 'Start Monitoring';
  }
}

function updatePrivateModeUI() {
  const privateBtn = document.getElementById('privateBtn');
  const privateIcon = document.getElementById('privateIcon');
  
  if (isPrivateMode) {
    privateBtn.classList.add('active');
    privateIcon.textContent = '🔓';
    privateBtn.title = 'Exit Private Mode';
    document.getElementById('statusText').textContent = 'Private';
  } else {
    privateBtn.classList.remove('active');
    privateIcon.textContent = '🔒';
    privateBtn.title = 'Enter Private Mode';
    updateMonitoringUI(); // Update status text
  }
}

// Search functionality
document.getElementById('searchInput').addEventListener('input', async (e) => {
  const query = e.target.value;
  if (isAiSearchMode && query && settings.aiEnabled) {
    await performAiSearch(query);
  } else {
    filterHistory();
    renderHistory();
  }
});

function filterHistory() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  if (searchTerm === '') {
    filteredHistory = history;
  } else {
    filteredHistory = history.filter(item => 
      item.text.toLowerCase().includes(searchTerm)
    );
  }
  selectedIndex = -1;
}

function renderHistory() {
  const list = document.getElementById('historyList');
  
  if (filteredHistory.length === 0) {
    list.innerHTML = '<div class="empty-state">No items found</div>';
    return;
  }
  
  list.innerHTML = filteredHistory.map((item, index) => {
    const preview = item.text.length > 100 
      ? item.text.substring(0, 100) + '...' 
      : item.text;
    const time = new Date(item.timestamp).toLocaleTimeString();
    const number = index < 9 ? (index + 1) : '';
    
    const category = item.category || 'other';
    return `
      <div class="history-item" data-index="${index}" data-id="${item.id}">
        <div class="item-number">${number}</div>
        <div class="item-content">
          <div class="item-text" title="${escapeHtml(item.text)}">
            ${escapeHtml(preview)}
            <span class="item-category ${category}">${category}</span>
          </div>
          <div class="item-time">${time}</div>
        </div>
        <button class="delete-btn" data-id="${item.id}" title="Delete">×</button>
      </div>
    `;
  }).join('');
  
  // Add click handlers for items
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger paste if clicking delete button
      if (e.target.classList.contains('delete-btn')) return;
      
      const index = parseInt(item.dataset.index);
      pasteItem(index);
    });
  });
  
  // Add delete button handlers
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      ipcRenderer.send('delete-item', itemId);
    });
  });
  
  // Highlight selected item
  if (selectedIndex >= 0 && selectedIndex < filteredHistory.length) {
    const selectedItem = document.querySelector(`[data-index="${selectedIndex}"]`);
    if (selectedItem) {
      selectedItem.classList.add('selected');
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function pasteItem(index) {
  if (index < 0 || index >= filteredHistory.length) return;
  
  const item = filteredHistory[index];
  
  // Move item to top of history
  const historyIndex = history.findIndex(h => h.id === item.id);
  if (historyIndex > 0) {
    history.splice(historyIndex, 1);
    history.unshift(item);
    // Update timestamp
    item.timestamp = Date.now();
    
    // Save and notify
    ipcRenderer.send('update-history', history);
  }
  
  // Send paste command - this will copy to clipboard, close window, and simulate paste
  ipcRenderer.send('paste-item', item.text);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts if user is typing in search box (unless it's a special key)
  const isTypingInSearch = document.activeElement === document.getElementById('searchInput');
  
  // Number keys 1-9 (only if not typing in search)
  if (!isTypingInSearch && e.key >= '1' && e.key <= '9') {
    const num = parseInt(e.key) - 1;
    if (num < filteredHistory.length) {
      pasteItem(num);
      e.preventDefault();
    }
  }
  
  // Arrow keys
  if (e.key === 'ArrowDown') {
    selectedIndex = Math.min(selectedIndex + 1, filteredHistory.length - 1);
    renderHistory();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    selectedIndex = Math.max(selectedIndex - 1, -1);
    renderHistory();
    e.preventDefault();
  }
  
  // Enter key (paste selected)
  if (e.key === 'Enter' && selectedIndex >= 0) {
    pasteItem(selectedIndex);
    e.preventDefault();
  }
  
  // Escape key - close panels first, then window
  if (e.key === 'Escape') {
    const hasOpenPanel = document.getElementById('settingsPanel').style.display !== 'none' ||
                         document.getElementById('aiPanel').style.display !== 'none' ||
                         document.getElementById('logsPanel').style.display !== 'none';
    if (hasOpenPanel) {
      closeAllPanels();
    } else {
      ipcRenderer.send('close-window');
    }
    e.preventDefault();
  }
  
  // Cmd/Ctrl + F to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
    document.getElementById('searchInput').select();
  }
});
