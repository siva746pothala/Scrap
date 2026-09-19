/**
 * Scrap App Cryptographic Module (Web Crypto API)
 * Handles:
 * - PBKDF2 key derivation from PIN
 * - AES-GCM 256-bit symmetric encryption/decryption for media blobs and key vault
 * - RSA-PSS signature generation/verification for QR invitations
 * - RSA-OAEP asymmetric encryption for secure room key transfers
 * - Helper functions for key serialization (JWK, ArrayBuffer, Base64)
 */

const ScrapCrypto = {
  // --- Helper Functions ---
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  },

  stringToBuffer(str) {
    return new TextEncoder().encode(str);
  },

  bufferToString(buf) {
    return new TextDecoder().decode(buf);
  },

  async digestSha256(text) {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  },

  // --- AES-GCM 256-bit Symmetric Encryption ---
  async generateRoomKey() {
    return await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  },

  async encryptData(arrayBuffer, key) {
    // 12-byte IV is standard for AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      arrayBuffer
    );
    // Combine IV and Ciphertext for easy storage
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return combined.buffer;
  },

  async decryptData(combinedBuffer, key) {
    const combined = new Uint8Array(combinedBuffer);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    return await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );
  },

  // --- PBKDF2 Key Derivation from PIN ---
  async deriveKeyFromPin(pin, salt) {
    const pinBuffer = this.stringToBuffer(pin);
    const importedSecret = await window.crypto.subtle.importKey(
      'raw',
      pinBuffer,
      'PBKDF2',
      false,
      ['deriveKey', 'deriveBits']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      importedSecret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  // --- RSA Keypair Generation for Signatures/Identity ---
  async generateIdentityKeyPair() {
    return await window.crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['sign', 'verify']
    );
  },

  // --- RSA Key Encryption/Decryption ---
  async generateAsymmetricEncryptionKeyPair() {
    return await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['encrypt', 'decrypt']
    );
  },

  // --- Serialization ---
  async exportKeyToJwk(key) {
    return await window.crypto.subtle.exportKey('jwk', key);
  },

  async importJwkToKey(jwk, algo, usages) {
    // Keep usages flexible and safe for both AES and RSA keys
    return await window.crypto.subtle.importKey('jwk', jwk, algo, true, usages);
  },

  // --- Signature Functions ---
  async signData(dataStr, privateKey) {
    const dataBuffer = this.stringToBuffer(dataStr);
    const signature = await window.crypto.subtle.sign(
      { name: 'RSA-PSS', saltLength: 32 },
      privateKey,
      dataBuffer
    );
    return this.arrayBufferToBase64(signature);
  },

  async verifySignature(dataStr, signatureBase64, publicKey) {
    try {
      const dataBuffer = this.stringToBuffer(dataStr);
      const signatureBuffer = this.base64ToArrayBuffer(signatureBase64);
      return await window.crypto.subtle.verify(
        { name: 'RSA-PSS', saltLength: 32 },
        publicKey,
        signatureBuffer,
        dataBuffer
      );
    } catch (e) {
      console.error('Signature verification error:', e);
      return false;
    }
  },

  // --- String & JSON Object E2EE Encryption/Decryption ---
  async encryptText(textStr, key) {
    if (!textStr || typeof textStr !== 'string') return textStr;
    const buffer = this.stringToBuffer(textStr);
    const combined = await this.encryptData(buffer, key);
    return this.arrayBufferToBase64(combined);
  },

  async decryptText(base64Str, key) {
    if (!base64Str || typeof base64Str !== 'string') return base64Str;
    const combined = this.base64ToArrayBuffer(base64Str);
    const decrypted = await this.decryptData(combined, key);
    return this.bufferToString(decrypted);
  }
};
window.ScrapCrypto = ScrapCrypto;
