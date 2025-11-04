# Economos - Multi-Clipboard Manager

A desktop application that runs in the background and keeps track of your clipboard history, allowing you to quickly access and paste previously copied items.

## Features

- 🔄 **Automatic Clipboard Monitoring**: Automatically saves every text you copy
- ⌨️ **Keyboard Shortcuts**: Press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux) to open the history window
- 🔢 **Quick Paste**: Press number keys (1-9) to instantly paste items
- 🔍 **Search**: Quickly find items in your clipboard history
- 📋 **Persistent Storage**: Your clipboard history is saved and persists across app restarts
- 🎯 **System Tray**: Runs quietly in the background with a system tray icon
- 🎨 **Modern UI**: Clean, dark-themed interface

## Installation

### For Development

1. Make sure you have [Node.js](https://nodejs.org/) installed
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the application:
   ```bash
   npm start
   ```

### Building Distributable Packages

To create installable packages for distribution:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build for your platform:
   ```bash
   # Build for macOS (creates .dmg and .zip)
   npm run build:mac
   
   # Build for Windows (creates .exe installer and portable)
   npm run build:win
   
   # Build for Linux (creates .AppImage and .deb)
   npm run build:linux
   
   # Build for current platform
   npm run build
   ```

3. The built packages will be in the `dist/` directory:
   - **macOS**: `Economos-1.0.0.dmg` (installer) and `Economos-1.0.0-mac.zip` (portable)
   - **Windows**: `Economos Setup 1.0.0.exe` (installer) and `Economos-1.0.0-win.zip` (portable)
   - **Linux**: `Economos-1.0.0.AppImage` (portable) and `economos_1.0.0_amd64.deb` (installer)

### Distribution

The built packages can be shared directly:
- **macOS**: Users can double-click the `.dmg` file to install
- **Windows**: Users can run the `.exe` installer
- **Linux**: Users can run the `.AppImage` directly or install the `.deb` package

## Usage

1. **Start the app**: Run the app - it will start in the background
2. **Open history**: Press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux)
3. **Paste items**:
   - Click on any item in the list
   - Press number keys (1-9) to paste the first 9 items
   - Use arrow keys to navigate and press Enter to paste
4. **Search**: Type in the search box to filter your clipboard history
5. **Start/Stop Monitoring**: 
   - Click the pause/play button (⏸/▶) in the header
   - Or use the system tray menu: Right-click tray icon → "Start/Stop Monitoring"
   - When paused, the app won't save new clipboard items
6. **Close**: Press `Esc` or click the × button

## Keyboard Shortcuts

- `Cmd+Shift+V` / `Ctrl+Shift+V`: Open/close history window
- `1-9`: Paste item at that position
- `Arrow Up/Down`: Navigate through items
- `Enter`: Paste selected item
- `Esc`: Close window
- `Cmd+F` / `Ctrl+F`: Focus search box

## System Tray

Right-click the system tray icon to:
- Show history window
- Start/Stop monitoring (pause clipboard tracking)
- Clear clipboard history
- Quit the application

The tray icon tooltip shows the current monitoring status (Active/Paused).

## Technical Details

- Built with Electron
- Packaged with electron-builder for cross-platform distribution
- Clipboard history is stored in JSON format in the app's user data directory
- Maximum history size: 100 items
- Automatically avoids duplicate entries
- Monitoring can be paused/resumed without restarting the app

## Future Enhancements

- Image clipboard support
- File clipboard support
- Customizable keyboard shortcuts
- History size configuration
- Cloud sync
- Encryption for sensitive clipboard data

## License

MIT
