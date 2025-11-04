// Cross-platform key simulation for paste
// Uses multiple fallback methods for maximum compatibility

let robotjs = null;
let platform = process.platform;
const { exec } = require('child_process');

// Try to load robotjs
try {
  robotjs = require('robotjs');
} catch (error) {
  console.warn('robotjs not available, using fallback methods:', error.message);
}

// Simulate paste keypress with multiple fallback options
function simulatePaste() {
  // Try robotjs first (most reliable if available)
  if (robotjs) {
    try {
      if (platform === 'darwin') {
        // macOS: Cmd+V
        robotjs.keyTap('v', 'command');
        return true;
      } else if (platform === 'win32') {
        // Windows: Ctrl+V
        robotjs.keyTap('v', 'control');
        return true;
      } else {
        // Linux: Ctrl+V
        robotjs.keyTap('v', 'control');
        return true;
      }
    } catch (error) {
      console.warn('robotjs failed, trying fallback:', error.message);
      // Fall through to fallback methods
    }
  }
  
  // Fallback to shell commands
  return simulatePasteFallback();
}

// Fallback method using shell commands
function simulatePasteFallback() {
  try {
    if (platform === 'darwin') {
      // macOS: Use AppleScript (most reliable on macOS)
      // Note: May require Accessibility permissions in System Preferences
      exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 
        (error, stdout, stderr) => {
          if (error) {
            console.warn('AppleScript paste failed. You may need to grant Accessibility permissions.', error.message);
            // Try alternative method
            tryAlternativePaste();
          }
        });
      return true;
    } else if (platform === 'win32') {
      // Windows: Use PowerShell
      exec('powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')\'"',
        (error) => {
          if (error) {
            console.warn('PowerShell paste failed:', error.message);
            tryAlternativePaste();
          }
        });
      return true;
    } else {
      // Linux: Use xdotool (most common) or ydotool
      exec('xdotool key ctrl+v', (error) => {
        if (error) {
          // Try ydotool as alternative
          exec('ydotool key 29:1 47:1 47:0 29:0', (error2) => {
            if (error2) {
              console.warn('Linux paste failed. Install xdotool or ydotool.', error.message);
            }
          });
        }
      });
      return true;
    }
  } catch (error) {
    console.error('Fallback paste simulation failed:', error);
    return false;
  }
}

// Alternative paste method for when primary fails
function tryAlternativePaste() {
  if (platform === 'darwin') {
    // Try using cliclick if available
    exec('which cliclick', (error) => {
      if (!error) {
        exec('cliclick kd:cmd t:v ku:cmd', () => {});
      }
    });
  }
}

module.exports = { simulatePaste };

