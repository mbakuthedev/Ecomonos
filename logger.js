const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_LOG_FILES = 5; // Keep 5 log files (rotate)

class Logger {
  constructor() {
    this.logDir = null;
    this.logFile = null;
    this.errorLogFile = null;
    this.currentLogLevel = LOG_LEVELS.INFO;
    this.init();
  }

  init() {
    try {
      // Wait for app to be ready if needed
      if (app && app.isReady && app.isReady() && app.getPath) {
        this.initializeLogFiles();
      } else {
        // If app not ready, wait for app.whenReady
        if (app && app.whenReady) {
          app.whenReady().then(() => {
            // Add a small delay to ensure app is fully ready
            setTimeout(() => {
              try {
                if (app && app.getPath) {
                  this.initializeLogFiles();
                }
              } catch (error) {
                console.error('Failed to initialize log files after app ready:', error);
              }
            }, 100);
          }).catch(error => {
            console.error('App.whenReady failed:', error);
          });
        } else {
          // Fallback: try after a delay
          setTimeout(() => {
            try {
              if (app && app.getPath) {
                this.initializeLogFiles();
              }
            } catch (error) {
              console.error('Failed to initialize log files:', error);
            }
          }, 500);
        }
      }
    } catch (error) {
      console.error('Failed to initialize logger:', error);
    }
  }

  initializeLogFiles() {
    try {
      // Set log directory in user data folder
      this.logDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      // Set log file paths
      const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      this.logFile = path.join(this.logDir, `economos-${dateStr}.log`);
      this.errorLogFile = path.join(this.logDir, `economos-error-${dateStr}.log`);

      // Set log level from environment or default to INFO
      const envLogLevel = process.env.ECONOMOS_LOG_LEVEL;
      if (envLogLevel) {
        const level = LOG_LEVEL_NAMES.indexOf(envLogLevel.toUpperCase());
        if (level >= 0) {
          this.currentLogLevel = level;
        }
      }

      // Initial log entry
      this.info('Logger initialized', { logDir: this.logDir });
    } catch (error) {
      console.error('Failed to initialize log files:', error);
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    let logLine = `[${timestamp}] [${levelName}] ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        logLine += `\n  Error: ${data.message}`;
        if (data.stack) {
          logLine += `\n  Stack: ${data.stack}`;
        }
      } else if (typeof data === 'object') {
        try {
          logLine += `\n  Data: ${JSON.stringify(data, null, 2)}`;
        } catch (e) {
          logLine += `\n  Data: [Circular or non-serializable]`;
        }
      } else {
        logLine += ` ${data}`;
      }
    }
    
    return logLine + '\n';
  }

  rotateLogs(logFilePath) {
    try {
      if (!fs.existsSync(logFilePath)) {
        return;
      }

      const stats = fs.statSync(logFilePath);
      if (stats.size < MAX_LOG_SIZE) {
        return; // No need to rotate
      }

      // Find the highest numbered backup
      const baseName = path.basename(logFilePath, '.log');
      const dir = path.dirname(logFilePath);
      let maxNum = 0;

      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const match = file.match(new RegExp(`^${baseName}-(\\d+)\\.log$`));
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxNum) {
            maxNum = num;
          }
        }
      });

      // Rotate existing backups
      for (let i = maxNum; i >= 1; i--) {
        const oldFile = path.join(dir, `${baseName}-${i}.log`);
        const newFile = path.join(dir, `${baseName}-${i + 1}.log`);
        if (fs.existsSync(oldFile)) {
          if (i + 1 > MAX_LOG_FILES) {
            // Delete oldest
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Move current log to backup-1
      if (maxNum + 1 <= MAX_LOG_FILES) {
        fs.renameSync(logFilePath, path.join(dir, `${baseName}-1.log`));
      } else {
        // Too many files, just truncate
        fs.truncateSync(logFilePath, 0);
      }
    } catch (error) {
      console.error('Error rotating logs:', error);
    }
  }

  writeLog(level, message, data = null) {
    if (level < this.currentLogLevel) {
      return; // Skip logs below current level
    }

    try {
      const logLine = this.formatMessage(level, message, data);
      
      // Always output to console first (for debugging)
      if (level >= LOG_LEVELS.WARN) {
        console.error(logLine.trim());
      } else {
        console.log(logLine.trim());
      }
      
      // Try to write to file if initialized
      if (!this.logFile || !this.logDir) {
        // Logger not initialized yet, only console output
        return;
      }
      
      try {
        // Rotate if needed before writing
        this.rotateLogs(this.logFile);
        
        // Write to main log file
        fs.appendFileSync(this.logFile, logLine, 'utf8');
        
        // Also write errors to error log file
        if (level >= LOG_LEVELS.ERROR && this.errorLogFile) {
          this.rotateLogs(this.errorLogFile);
          fs.appendFileSync(this.errorLogFile, logLine, 'utf8');
        }
      } catch (fileError) {
        // If file write fails, still log to console
        console.error('Failed to write to log file:', fileError.message);
      }
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  debug(message, data = null) {
    this.writeLog(LOG_LEVELS.DEBUG, message, data);
  }

  info(message, data = null) {
    this.writeLog(LOG_LEVELS.INFO, message, data);
  }

  warn(message, data = null) {
    this.writeLog(LOG_LEVELS.WARN, message, data);
  }

  error(message, data = null) {
    this.writeLog(LOG_LEVELS.ERROR, message, data);
  }

  critical(message, data = null) {
    this.writeLog(LOG_LEVELS.CRITICAL, message, data);
  }

  // Get log directory path (for UI)
  getLogDirectory() {
    return this.logDir;
  }

  // Read log file content
  readLogs(lines = 500, errorOnly = false) {
    try {
      const logFilePath = errorOnly ? this.errorLogFile : this.logFile;
      
      if (!fs.existsSync(logFilePath)) {
        return { logs: [], path: logFilePath };
      }

      const content = fs.readFileSync(logFilePath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      
      // Return last N lines
      const logs = allLines.slice(-lines);
      
      return {
        logs: logs,
        path: logFilePath,
        totalLines: allLines.length,
        showingLines: logs.length
      };
    } catch (error) {
      console.error('Error reading logs:', error);
      return { logs: [], path: null, error: error.message };
    }
  }

  // Get all log files
  getAllLogFiles() {
    try {
      if (!fs.existsSync(this.logDir)) {
        return [];
      }

      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('economos-') && file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(this.logDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            isError: file.includes('error')
          };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified)); // Newest first

      return files;
    } catch (error) {
      console.error('Error getting log files:', error);
      return [];
    }
  }

  // Read specific log file
  readLogFile(filePath, lines = 500) {
    try {
      if (!fs.existsSync(filePath)) {
        return { logs: [], path: filePath };
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      const logs = allLines.slice(-lines);

      return {
        logs: logs,
        path: filePath,
        totalLines: allLines.length,
        showingLines: logs.length
      };
    } catch (error) {
      return { logs: [], path: filePath, error: error.message };
    }
  }

  // Clear old log files (older than X days)
  clearOldLogs(daysToKeep = 7) {
    try {
      if (!fs.existsSync(this.logDir)) {
        return { deleted: 0 };
      }

      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      let deleted = 0;

      const files = fs.readdirSync(this.logDir);
      files.forEach(file => {
        if (file.startsWith('economos-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        }
      });

      this.info(`Cleared ${deleted} old log files`, { daysToKeep });
      return { deleted };
    } catch (error) {
      this.error('Error clearing old logs', error);
      return { deleted: 0, error: error.message };
    }
  }

  // Intelligent log analysis - analyze logs for insights
  analyzeLogs(filePath = null, lines = 5000) {
    try {
      const logFilePath = filePath || this.logFile;
      
      if (!fs.existsSync(logFilePath)) {
        return this.getEmptyInsights();
      }

      const content = fs.readFileSync(logFilePath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      const logs = allLines.slice(-lines);

      // Parse log entries
      const entries = logs.map(line => {
        const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\]\s*(.+)$/);
        if (match) {
          const [, timestamp, level, message] = match;
          return {
            timestamp: new Date(timestamp),
            level: level.toUpperCase(),
            message: message.trim(),
            raw: line
          };
        }
        return null;
      }).filter(entry => entry !== null);

      // Calculate statistics
      const stats = {
        total: entries.length,
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        critical: 0,
        last24h: 0
      };

      const now = Date.now();
      const last24hTime = now - (24 * 60 * 60 * 1000);

      entries.forEach(entry => {
        const level = entry.level.toLowerCase();
        if (stats.hasOwnProperty(level)) {
          stats[level]++;
        }
        if (entry.timestamp.getTime() >= last24hTime) {
          stats.last24h++;
        }
      });

      // Detect error patterns
      const errorPatterns = this.detectErrorPatterns(entries);
      
      // Detect alerts (critical issues)
      const alerts = this.detectAlerts(entries, stats);

      // Detect common issues
      const patterns = this.detectCommonPatterns(entries);

      return {
        stats,
        alerts,
        patterns,
        errorPatterns,
        analyzed: entries.length
      };
    } catch (error) {
      console.error('Error analyzing logs:', error);
      return this.getEmptyInsights();
    }
  }

  getEmptyInsights() {
    return {
      stats: { total: 0, debug: 0, info: 0, warn: 0, error: 0, critical: 0, last24h: 0 },
      alerts: [],
      patterns: [],
      errorPatterns: [],
      analyzed: 0
    };
  }

  detectErrorPatterns(entries) {
    const errorMessages = entries
      .filter(e => e.level === 'ERROR' || e.level === 'CRITICAL')
      .map(e => e.message.toLowerCase());

    // Count error frequencies
    const errorCounts = {};
    errorMessages.forEach(msg => {
      // Extract key error type (first few words)
      const key = msg.substring(0, 50).replace(/\d+/g, 'N').trim();
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    });

    // Return top 5 most common errors
    return Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));
  }

  detectAlerts(entries, stats) {
    const alerts = [];

    // High error rate
    if (stats.error > 0 && stats.total > 0) {
      const errorRate = (stats.error / stats.total) * 100;
      if (errorRate > 10) {
        alerts.push({
          type: 'high_error_rate',
          severity: 'warning',
          message: `High error rate: ${errorRate.toFixed(1)}% (${stats.error} errors)`,
          suggestion: 'Review recent errors for patterns'
        });
      }
    }

    // Critical errors
    if (stats.critical > 0) {
      alerts.push({
        type: 'critical_errors',
        severity: 'critical',
        message: `${stats.critical} critical error(s) detected`,
        suggestion: 'Immediate attention required'
      });
    }

    // Recent errors spike
    const recentErrors = entries
      .filter(e => (e.level === 'ERROR' || e.level === 'CRITICAL') && 
                   e.timestamp.getTime() >= Date.now() - (60 * 60 * 1000))
      .length;
    
    if (recentErrors > 5) {
      alerts.push({
        type: 'error_spike',
        severity: 'warning',
        message: `${recentErrors} errors in the last hour`,
        suggestion: 'Check for system issues'
      });
    }

    // No logs (might indicate problem)
    if (stats.total === 0) {
      alerts.push({
        type: 'no_logs',
        severity: 'info',
        message: 'No log entries found',
        suggestion: 'Logging may be disabled or no activity'
      });
    }

    return alerts;
  }

  detectCommonPatterns(entries) {
    const patterns = [];

    // Check for common issues
    const hasClipboardErrors = entries.some(e => 
      e.message.toLowerCase().includes('clipboard') && 
      (e.level === 'ERROR' || e.level === 'WARN')
    );

    const hasAIFailures = entries.some(e =>
      e.message.toLowerCase().includes('ai') && 
      (e.message.toLowerCase().includes('fail') || e.message.toLowerCase().includes('error'))
    );

    const hasFileErrors = entries.some(e =>
      (e.message.toLowerCase().includes('file') || e.message.toLowerCase().includes('fs')) &&
      e.level === 'ERROR'
    );

    if (hasClipboardErrors) {
      patterns.push({
        type: 'clipboard_issues',
        message: 'Clipboard-related errors detected',
        count: entries.filter(e => 
          e.message.toLowerCase().includes('clipboard') && 
          (e.level === 'ERROR' || e.level === 'WARN')
        ).length
      });
    }

    if (hasAIFailures) {
      patterns.push({
        type: 'ai_failures',
        message: 'AI service failures detected',
        count: entries.filter(e =>
          e.message.toLowerCase().includes('ai') && 
          (e.message.toLowerCase().includes('fail') || e.message.toLowerCase().includes('error'))
        ).length
      });
    }

    if (hasFileErrors) {
      patterns.push({
        type: 'file_errors',
        message: 'File system errors detected',
        count: entries.filter(e =>
          (e.message.toLowerCase().includes('file') || e.message.toLowerCase().includes('fs')) &&
          e.level === 'ERROR'
        ).length
      });
    }

    return patterns;
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;
