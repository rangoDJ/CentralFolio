const crypto = require('crypto');

if (!process.env.MASTER_KEY) {
  console.warn(
    '\x1b[33m[CentralFolio] WARNING: MASTER_KEY env var is not set. ' +
    'Using the default insecure key — secrets in the database are not properly protected. ' +
    'Set MASTER_KEY in your .env file. Generate one with: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\x1b[0m'
  );
}

// Generate a deterministic 32-byte key bound to this instance via MASTER_KEY.
const ENCRYPTION_KEY = crypto.scryptSync(process.env.MASTER_KEY || 'central_folio_default_secure_key', 'folio_salt_2026', 32);
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (!text) return text;
  
  // Create initialization vector required for AES-256-GCM
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // GCM provides authenticated encryption, meaning it generates a tag preventing ciphertext tampering
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encrypted payload
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
  // If no auth tag colons exist, it's either an empty string or legacy plaintext fallback
  if (!text || !text.includes(':')) return text; 
  
  try {
    const parts = text.split(':');
    if (parts.length !== 3) return text;
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    // Logged at DEBUG — may be legacy plaintext value migrated from unencrypted store
    require('./logger').make('crypto').debug('Decryption failed, treating as plaintext', { error: err.message });
    return text;
  }
}

module.exports = { encrypt, decrypt };
