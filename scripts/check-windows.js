#!/usr/bin/env node
/**
 * Windows Compatibility Check Script
 * Run this to check if the system has all requirements for Economos
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

console.log('🔍 Economos Windows Compatibility Check\n');
console.log('='.repeat(50));

let issues = [];
let warnings = [];

// Main async function
async function runChecks() {
  // Check Node.js version
  console.log('\n✅ Checking Node.js...');
  try {
    const nodeVersion = process.version;
    console.log(`   Node.js: ${nodeVersion}`);
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    if (majorVersion < 16) {
      issues.push('Node.js version 16 or higher is required');
    }
  } catch (error) {
    issues.push('Could not determine Node.js version');
  }

  // Check if we're on Windows
  console.log('\n✅ Checking Platform...');
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Architecture: ${process.arch}`);
  if (process.platform !== 'win32') {
    warnings.push('This script is designed for Windows');
  }

  // Check file permissions
  console.log('\n✅ Checking File Permissions...');
  try {
    const testDir = path.join(process.env.APPDATA || process.env.USERPROFILE, 'economos-test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    fs.rmdirSync(testDir);
    console.log('   ✅ Can write to AppData directory');
  } catch (error) {
    issues.push(`Cannot write to AppData: ${error.message}`);
    console.log(`   ❌ Cannot write to AppData: ${error.message}`);
  }

  // Check if PowerShell is available
  console.log('\n✅ Checking PowerShell...');
  try {
    const { stdout } = await execAsync('powershell -command "Get-Host | Select-Object -ExpandProperty Version"');
    console.log(`   ✅ PowerShell available: ${stdout.trim()}`);
  } catch (error) {
    warnings.push('PowerShell may not be available (needed for some features)');
    console.log('   ⚠️  PowerShell not available');
  }

  // Check clipboard access
  console.log('\n✅ Checking Clipboard Access...');
  try {
    // Try to read clipboard (this might fail on Windows if clipboard is empty)
    await execAsync('powershell -command "Get-Clipboard"');
    console.log('   ✅ Can access clipboard');
  } catch (error) {
    warnings.push('Clipboard access test failed (may need permissions)');
    console.log('   ⚠️  Clipboard access test failed');
  }

  // Check if required files exist
  console.log('\n✅ Checking Required Files...');
  const requiredFiles = [
    'main.js',
    'index.html',
    'renderer.js',
    'package.json'
  ];

  requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
      console.log(`   ✅ ${file}`);
    } else {
      issues.push(`Missing required file: ${file}`);
      console.log(`   ❌ ${file} - MISSING`);
    }
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Summary:\n');

  if (issues.length === 0 && warnings.length === 0) {
    console.log('✅ All checks passed! Economos should work on this system.');
  } else {
    if (issues.length > 0) {
      console.log('❌ Issues found:');
      issues.forEach(issue => {
        console.log(`   • ${issue}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach(warning => {
        console.log(`   • ${warning}`);
      });
    }
    
    console.log('\n💡 Solutions:');
    console.log('   1. Check WINDOWS_TROUBLESHOOTING.md for detailed solutions');
    console.log('   2. Run as Administrator if permission issues');
    console.log('   3. Check Windows Event Viewer for application errors');
    console.log('   4. Ensure all required files are in the same directory');
  }

  console.log('\n');
}

// Run checks
runChecks().catch(error => {
  console.error('Error running checks:', error);
  process.exit(1);
});