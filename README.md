# Economos - Multi-Clipboard Manager

A powerful desktop application that runs in the background and keeps track of your clipboard history, enhanced with AI-powered features for intelligent text processing and automation.

## ✨ Features

### Core Clipboard Management
- 🔄 **Automatic Clipboard Monitoring**: Automatically saves every text you copy
- ⌨️ **Keyboard Shortcuts**: Press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux) to open the history window
- 🔢 **Quick Paste**: Press number keys (1-9) to instantly paste items, or click to auto-paste
- 🔍 **Search**: Quickly find items in your clipboard history with keyword search
- 📋 **Persistent Storage**: Your clipboard history is saved and persists across app restarts
- 🎯 **System Tray**: Runs quietly in the background with a system tray icon
- 🎨 **Modern UI**: Clean, dark-themed interface with category badges
- 🗑️ **Delete Items**: Remove individual items from history with one click

### 🔒 Privacy & Security Features
- **Private Mode**: Temporarily disable clipboard logging (🔒 button)
- **Encryption**: Encrypt your clipboard history on disk with AES-256-CBC
- **App Exclusion**: Exclude specific applications (e.g., password managers) from being logged
- **In-Memory Only**: Store history only in RAM, never on disk (perfect for maximum privacy)
- **Auto-Categorization**: AI automatically tags clips as "code", "email", "link", "note", "password", etc.

### 🤖 AI-Powered Features

Economos includes advanced AI features powered by Groq (primary) and OpenAI (fallback), with automatic rate limit handling and retry logic.

#### 🧾 Smart Paste
Intelligently clean and format copied text:
- Remove unnecessary line breaks and whitespace
- Format JSON data with proper indentation
- Rewrite text in different tones (professional, casual, formal, friendly)
- General text reformatting for better readability

#### 🧠 Clipboard Brain (Semantic Search)
Search your clipboard history by meaning, not just keywords:
- Uses AI embeddings to find semantically similar content
- Understands context and intent behind your queries
- Falls back to keyword search if AI is unavailable

#### 💬 Auto Reply Generator
Draft intelligent replies from multiple messages:
- Copy multiple messages from conversations
- AI analyzes context and generates appropriate replies
- Customize reply tone and style

#### 📝 Instant Formatter
Convert and reformat text in various ways:
- HTML ↔ Markdown conversion
- JSON formatting and beautification
- Code formatting
- Case conversion (uppercase, lowercase, capitalize)
- Remove all formatting to plain text

#### 🏷️ Clipboard Categories
AI automatically categorizes your clipboard items:
- Code snippets, emails, links, notes, passwords, numbers, commands, JSON, XML, HTML
- Visual category badges for easy identification
- Filter and organize by category

## 📥 Download & Installation

### Ready-to-Use Downloads

**macOS (Apple Silicon - ARM64)**
- [Download DMG Installer](dist/Economos-1.0.0-arm64.dmg) (89 MB)
- [Download ZIP (Portable)](dist/Economos-1.0.0-arm64-mac.zip) (86 MB)

**macOS (Intel - x64)**
- Build from source (see below) or download from releases

**Windows**
- Build from source (see below) or download from releases
- Includes both installer (.exe) and portable (.zip) versions

**Linux**
- Build from source (see below) or download from releases
- Includes both AppImage (portable) and .deb (installer) packages

### Installation Instructions

#### macOS
1. Download the `.dmg` file
2. Double-click to open
3. Drag "Economos" to your Applications folder
4. Open from Applications (you may need to allow it in System Preferences → Security & Privacy)
5. **Important**: Grant Accessibility permissions when prompted (required for auto-paste functionality)

#### Windows
1. Download the `.exe` installer
2. Run the installer and follow the setup wizard
3. Launch Economos from the Start menu
4. The app will run in the system tray

#### Linux
**AppImage (Recommended)**
1. Download the `.AppImage` file
2. Make it executable: `chmod +x Economos-1.0.0.AppImage`
3. Run: `./Economos-1.0.0.AppImage`

**Debian/Ubuntu (.deb)**
1. Download the `.deb` package
2. Install: `sudo dpkg -i economos_1.0.0_amd64.deb`
3. Launch from your applications menu

## 🛠️ Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- npm (comes with Node.js)
- For macOS: Xcode Command Line Tools
- For Windows: Visual Studio Build Tools
- For Linux: build-essential, python3, and libxtst-dev

### Development Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd economos
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application:
   ```bash
   npm start
   ```

### Building Distributable Packages

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

3. The built packages will be in the `dist/` directory

## 📖 Usage Guide

### Getting Started

1. **Launch the app**: Open Economos - it starts in the background
2. **Open history**: Press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux)
3. **Paste items**:
   - **Click** on any item to automatically paste it into your active application
   - Press **number keys (1-9)** to paste the first 9 items
   - Use **arrow keys** to navigate and press **Enter** to paste
4. **Search**: Type in the search box to filter your clipboard history
5. **AI Semantic Search**: Click the 🧠 button to enable semantic search by meaning

### Privacy Features

#### Private Mode
- Click the **🔒 button** in the header to toggle private mode
- When enabled, clipboard items won't be saved (indicated by active state)
- Perfect for temporarily disabling logging

#### Encryption
1. Open **Settings** (⚙ button)
2. Enable **"Enable Encryption"**
3. Your clipboard history will be encrypted on disk
4. Encryption key is stored securely in the app's user data directory

#### Exclude Apps
1. Open **Settings** (⚙ button)
2. Enter an app name in the "Excluded Apps" field (e.g., "1Password", "Chrome")
3. Click **"Add"**
4. The app will never log clipboard items when that application is active

#### In-Memory Only
1. Open **Settings** (⚙ button)
2. Enable **"In-Memory Only"**
3. History is never written to disk (lost on app restart)
4. Maximum privacy mode

### AI Features Setup

1. Open **Settings** (⚙ button)
2. Enable **"Enable AI Features"**
3. Enter your API keys:
   - **Groq API Key** (recommended - faster, free tier available): Get from [console.groq.com](https://console.groq.com)
   - **OpenAI API Key** (fallback): Get from [platform.openai.com](https://platform.openai.com)
4. Optionally enable **"Auto-categorize"** to automatically tag clipboard items
5. Click **"AI Features"** (🤖 button) to access:
   - **Smart Paste**: Clean and format text
   - **Formatter**: Convert between formats (HTML/Markdown/JSON/etc.)
   - **Reply Generator**: Create replies from messages

### AI Features Usage

#### Smart Paste
1. Copy some text
2. Open Economos and click **"AI Features"** → **"Smart Paste"** tab
3. Paste your text in the input field
4. Select options (remove line breaks, format JSON, rewrite tone)
5. Click **"Smart Paste & Copy"**
6. The cleaned text is copied to your clipboard

#### Semantic Search
1. Click the **🧠 button** next to the search box
2. Type a query describing what you're looking for (e.g., "that code snippet about authentication")
3. Results are sorted by semantic similarity
4. Click on results to paste

#### Reply Generator
1. Copy multiple messages from a conversation
2. Open **"AI Features"** → **"Reply Generator"** tab
3. Paste the messages in the input field
4. Optionally add context
5. Click **"Generate Reply"**
6. The generated reply is copied to your clipboard

#### Instant Formatter
1. Copy text that needs formatting
2. Open **"AI Features"** → **"Formatter"** tab
3. Paste your text
4. Select format type (HTML→Markdown, JSON format, etc.)
5. Click **"Format & Copy"**

## ⌨️ Keyboard Shortcuts

- `Cmd+Shift+V` / `Ctrl+Shift+V`: Open/close history window
- `1-9`: Paste item at that position (1-9)
- `Arrow Up/Down`: Navigate through items
- `Enter`: Paste selected item
- `Esc`: Close window or settings panel
- `Cmd+F` / `Ctrl+F`: Focus search box

## 🎯 System Tray

Right-click the system tray icon to:
- Show history window
- Toggle Private Mode
- Start/Stop monitoring (pause clipboard tracking)
- Clear clipboard history
- Quit the application

The tray icon tooltip shows the current monitoring status (Active/Paused/Private Mode).

## ⚙️ Technical Details

- **Framework**: Electron (cross-platform desktop app)
- **Packaging**: electron-builder for distribution
- **Storage**: JSON format in app's user data directory (or encrypted, or in-memory)
- **Encryption**: AES-256-CBC using Node.js crypto module
- **AI Providers**: Groq (primary, fast) with OpenAI (fallback)
- **Rate Limiting**: Automatic retry with exponential backoff
- **Maximum history**: 100 items (automatically pruned)
- **Duplicate detection**: Automatically avoids duplicate entries
- **Cross-platform paste**: Uses platform-specific methods (AppleScript/PowerShell/xdotool)

### System Requirements

- **macOS**: macOS 10.12+ (for APFS-based DMG)
- **Windows**: Windows 10 or later
- **Linux**: Most modern distributions with GTK3
- **Permissions**: 
  - macOS: Accessibility permissions (for auto-paste)
  - Linux: May require xdotool or ydotool for auto-paste

### File Locations

Clipboard history and settings are stored in:
- **macOS**: `~/Library/Application Support/economos/`
- **Windows**: `%APPDATA%/economos/`
- **Linux**: `~/.config/economos/`

## 🔐 Privacy & Security

- All clipboard data is stored locally on your machine
- Encryption keys are generated locally and never transmitted
- AI features send data to Groq/OpenAI APIs (configure in settings)
- No telemetry or tracking
- Open source - you can audit the code

## 🚀 Future Enhancements

- Image clipboard support
- File clipboard support
- Customizable keyboard shortcuts
- History size configuration
- Cloud sync (optional, encrypted)
- Multiple clipboard slots (clipboard manager style)
- Plugin system for custom AI features

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## 🐛 Troubleshooting

### Auto-paste not working
- **macOS**: Grant Accessibility permissions in System Preferences → Security & Privacy → Privacy → Accessibility
- **Linux**: Install xdotool: `sudo apt-get install xdotool` (Debian/Ubuntu) or `sudo yum install xdotool` (RHEL/CentOS)
- **Windows**: Should work automatically, but may require running as administrator in some cases

### AI features not working
- Ensure you've entered a Groq or OpenAI API key in Settings
- Check your internet connection
- Verify API key is valid
- Check console logs for error messages

### Build errors
- Ensure you have all build dependencies installed
- Try `npm install --force` to reinstall dependencies
- For native module issues, ensure you have the correct build tools installed

## 📧 Support

For issues, feature requests, or questions, please open an issue on the repository.

---

**Made with ❤️ for productivity enthusiasts**
