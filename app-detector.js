const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Get the currently active application (for app exclusion feature)
async function getActiveApp() {
  try {
    if (process.platform === 'darwin') {
      // macOS
      const { stdout } = await execAsync("osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'");
      return stdout.trim();
    } else if (process.platform === 'win32') {
      // Windows
      const { stdout } = await execAsync('powershell -command "(Get-Process -Id (Get-WindowThreadProcessId (Get-ForegroundWindow))).ProcessName"');
      return stdout.trim();
    } else {
      // Linux
      const { stdout } = await execAsync('xdotool getactivewindow getwindowclassname 2>/dev/null || echo "unknown"');
      return stdout.trim();
    }
  } catch (error) {
    console.error('Error getting active app:', error);
    return 'unknown';
  }
}

module.exports = { getActiveApp };

