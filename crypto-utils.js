const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Get or create encryption key
function getEncryptionKey(userDataPath) {
  const keyFile = path.join(userDataPath, '.encryption-key');
  let key;
  
  if (fs.existsSync(keyFile)) {
    key = fs.readFileSync(keyFile, 'utf8');
  } else {
    // Generate a new key
    key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, key, { mode: 0o600 }); // Only owner can read/write
  }
  
  return Buffer.from(key, 'hex');
}

// Encrypt data
function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Decrypt data
function decrypt(encryptedData, key) {
  try {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

module.exports = { getEncryptionKey, encrypt, decrypt };

