#!/bin/bash
# Build script for Economos - creates installers for all platforms

echo "🚀 Building Economos installers..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found. Installing dependencies..."
    npm install
fi

# Build for all platforms
echo "📦 Building for Windows..."
npm run build:win

echo "📦 Building for macOS..."
npm run build:mac

echo "📦 Building for Linux..."
npm run build:linux

echo ""
echo "✅ Build complete!"
echo ""
echo "📁 Installers created in dist/ folder:"
echo ""
ls -lh dist/*.exe dist/*.dmg dist/*.AppImage dist/*.deb 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "📤 Next steps:"
echo "   1. Test the installers on their respective platforms"
echo "   2. Upload to GitHub Releases or your website"
echo "   3. Share the download links with users"
echo ""
