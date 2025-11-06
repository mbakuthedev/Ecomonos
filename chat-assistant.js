const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Note: aiService will be set by main process
let aiService = null;

function setAIService(service) {
  aiService = service;
}

class ChatAssistant {
  constructor() {
    this.watchedApps = [];
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.lastMessages = new Map(); // Track last seen messages per app
    this.messageCallbacks = [];
  }

  // Add app to watch list
  addWatchedApp(appName) {
    if (!this.watchedApps.includes(appName)) {
      this.watchedApps.push(appName);
      this.lastMessages.set(appName, '');
    }
  }

  // Remove app from watch list
  removeWatchedApp(appName) {
    this.watchedApps = this.watchedApps.filter(app => app !== appName);
    this.lastMessages.delete(appName);
  }

  // Get watched apps
  getWatchedApps() {
    return this.watchedApps;
  }

  // Start monitoring for new messages
  startMonitoring(callback) {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.messageCallbacks.push(callback);
    
    // Check for new messages every 2 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.checkForNewMessages();
    }, 2000);
  }

  // Stop monitoring
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.messageCallbacks = [];
  }

  // Check for new messages in watched apps
  async checkForNewMessages() {
    for (const appName of this.watchedApps) {
      try {
        const activeApp = await this.getActiveApp();
        if (activeApp.toLowerCase().includes(appName.toLowerCase())) {
          const currentText = await this.getFocusedText();
          const lastText = this.lastMessages.get(appName) || '';
          
          // Check if new text appeared (message received)
          if (currentText && currentText !== lastText && currentText.length > lastText.length) {
            const newMessage = currentText.substring(lastText.length).trim();
            
            if (newMessage && newMessage.length > 10) { // Minimum message length
              this.lastMessages.set(appName, currentText);
              await this.handleNewMessage(appName, newMessage, activeApp);
            }
          }
        }
      } catch (error) {
        console.error(`Error checking ${appName}:`, error);
      }
    }
  }

  // Get currently active application
  async getActiveApp() {
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await execAsync(
          "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
        );
        return stdout.trim();
      } else if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'powershell -command "(Get-Process -Id (Get-WindowThreadProcessId (Get-ForegroundWindow))).ProcessName"'
        );
        return stdout.trim();
      } else {
        const { stdout } = await execAsync('xdotool getactivewindow getwindowclassname 2>/dev/null || echo "unknown"');
        return stdout.trim();
      }
    } catch (error) {
      return 'unknown';
    }
  }

  // Get text from focused window/input (simplified - may need app-specific logic)
  async getFocusedText() {
    try {
      if (process.platform === 'darwin') {
        // Use clipboard as a proxy - user would copy the message
        // Or use AppleScript to get text from focused element
        const { stdout } = await execAsync(
          'osascript -e \'tell application "System Events" to get value of (focused UI element of focused window)\' 2>/dev/null || echo ""'
        );
        return stdout.trim();
      }
      // For other platforms, this is more complex
      // Could use OCR or app-specific APIs
      return '';
    } catch (error) {
      return '';
    }
  }

  // Handle new message detected
  async handleNewMessage(appName, message, activeApp) {
    // Skip very large messages (likely documents, not chat messages)
    if (message && message.length > 10000) {
      console.log(`Skipping large message in ${appName} (${message.length} chars)`);
      return null;
    }
    
    console.log(`New message detected in ${appName}:`, message.substring(0, 100));
    
    // Generate AI reply (will return null if too large or on error)
    const reply = await this.generateReply(message, appName);
    
    // Notify callbacks even if reply is null (so UI can show message was detected)
    for (const callback of this.messageCallbacks) {
      callback({
        app: appName,
        message: message,
        reply: reply, // May be null if AI processing skipped
        activeApp: activeApp
      });
    }
    
    return reply;
  }

  // Generate AI reply for a message
  async generateReply(message, context = '') {
    if (!aiService) {
      throw new Error('AI service not initialized');
    }
    
    // Check if message is too large
    if (message && message.length > 8000) {
      console.log('Message too large for AI reply, skipping');
      return null; // Skip AI processing for very large messages
    }
    
    try {
      // Limit message size before sending
      const maxMessageLength = 5000; // Limit individual message length
      const limitedMessage = message.length > maxMessageLength 
        ? message.substring(0, maxMessageLength) + '...'
        : message;
      
      // Use the existing AI service (it will handle further limits)
      const reply = await aiService.generateReply(limitedMessage, context);
      
      return reply ? reply.trim() : null;
    } catch (error) {
      // If error is due to size or rate limit, don't throw - just skip
      if (error.message.includes('too large') || error.message.includes('TPM') || error.message.includes('Requested')) {
        console.error('Error generating reply (message too large or rate limited):', error.message);
        return null; // Return null instead of throwing
      }
      console.error('Error in generateReply:', error);
      return null; // Return null on error instead of throwing
    }
  }

  // Send/paste reply to active app
  async sendReply(reply, appName, clipboard, simulatePaste) {
    try {
      // First copy to clipboard
      clipboard.writeText(reply);
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Simulate paste (Cmd+V / Ctrl+V)
      simulatePaste();
      
      // For some apps, might need to press Enter to send
      // This could be configurable per app
      return true;
    } catch (error) {
      console.error('Error sending reply:', error);
      return false;
    }
  }

  // Get clipboard content (helper for message detection)
  getClipboardText(clipboard) {
    return clipboard.readText();
  }

  // Monitor clipboard as a proxy for new messages (simpler approach)
  // Note: This works by detecting when user copies a message in a watched app
  // For automatic detection, you'd need app-specific APIs or OCR
  startClipboardMonitoring(callback, clipboard) {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.messageCallbacks.push(callback);
    let lastClipboard = '';
    let lastTimestamp = Date.now();
    
    this.monitoringInterval = setInterval(() => {
      const currentClipboard = this.getClipboardText(clipboard);
      const now = Date.now();
      
      // If clipboard changed and it looks like a message (not a URL, not too short)
      if (currentClipboard && currentClipboard !== lastClipboard && 
          currentClipboard.length > 10 && 
          !currentClipboard.startsWith('http') &&
          !currentClipboard.startsWith('https') &&
          (now - lastTimestamp) > 1000) { // Avoid duplicate triggers
        
        lastTimestamp = now;
        
        // Check if it's from a watched app
        this.getActiveApp().then(activeApp => {
          const isWatchedApp = this.watchedApps.length === 0 || this.watchedApps.some(app => 
            activeApp.toLowerCase().includes(app.toLowerCase())
          );
          
          if (isWatchedApp) {
            lastClipboard = currentClipboard;
            this.handleNewMessage(activeApp, currentClipboard, activeApp).then(reply => {
              if (reply && callback) {
                callback({
                  app: activeApp,
                  message: currentClipboard,
                  reply: reply,
                  activeApp: activeApp
                });
              }
            }).catch(error => {
              console.error('Error handling message:', error);
            });
          }
        });
      }
    }, 2000);
  }
}

const chatAssistant = new ChatAssistant();
module.exports = chatAssistant;
module.exports.setAIService = setAIService;

