/**
 * Scrap App Identity and Recovery Module
 * Coordinates:
 * - Local RSA Key pair setup and backup (Master PIN)
 * - Encrypting/Decrypting the key vault using derived PIN keys
 * - Social Recovery (Tier 2) handshake using temporary tokens and Firebase
 */

const ScrapRecovery = {
  vault: {
    identityPublicKeyJwk: null,
    identityPrivateKeyJwk: null,
    encryptionPublicKeyJwk: null,
    encryptionPrivateKeyJwk: null,
    roomKeys: {} // roomId -> AES-GCM key in raw/jwk format
  },
  
  salt: null,
  identityKeyPair: null,
  encryptionKeyPair: null,
  roomKeysCache: {},

  async setupNewIdentity(pin) {
    console.log('Generating secure asymmetric identity keys...');
    // Generate Identity RSA-PSS keys
    this.identityKeyPair = await ScrapCrypto.generateIdentityKeyPair();
    // Generate Encryption RSA-OAEP keys
    this.encryptionKeyPair = await ScrapCrypto.generateAsymmetricEncryptionKeyPair();

    // Export to JWK
    this.vault.identityPublicKeyJwk = await ScrapCrypto.exportKeyToJwk(this.identityKeyPair.publicKey);
    this.vault.identityPrivateKeyJwk = await ScrapCrypto.exportKeyToJwk(this.identityKeyPair.privateKey);
    this.vault.encryptionPublicKeyJwk = await ScrapCrypto.exportKeyToJwk(this.encryptionKeyPair.publicKey);
    this.vault.encryptionPrivateKeyJwk = await ScrapCrypto.exportKeyToJwk(this.encryptionKeyPair.privateKey);
    this.vault.roomKeys = {};

    // Create a random salt
    this.salt = window.crypto.getRandomValues(new Uint8Array(16));
    
    // Encrypt vault using PIN
    return await this.saveVaultToLocalAndDrive(pin);
  },

  async unlockIdentity(pin, encryptedVaultBase64, saltBase64) {
    try {
      const salt = ScrapCrypto.base64ToArrayBuffer(saltBase64);
      const aesKey = await ScrapCrypto.deriveKeyFromPin(pin, salt);
      
      const encryptedBuffer = ScrapCrypto.base64ToArrayBuffer(encryptedVaultBase64);
      const decryptedBuffer = await ScrapCrypto.decryptData(encryptedBuffer, aesKey);
      
      const vaultStr = ScrapCrypto.bufferToString(decryptedBuffer);
      this.vault = JSON.parse(vaultStr);
      this.salt = new Uint8Array(salt);

      // Re-import keys
      this.identityKeyPair = {
        publicKey: await ScrapCrypto.importJwkToKey(
          this.vault.identityPublicKeyJwk,
          { name: 'RSA-PSS', hash: 'SHA-256' },
          ['verify']
        ),
        privateKey: await ScrapCrypto.importJwkToKey(
          this.vault.identityPrivateKeyJwk,
          { name: 'RSA-PSS', hash: 'SHA-256' },
          ['sign']
        )
      };

      this.encryptionKeyPair = {
        publicKey: await ScrapCrypto.importJwkToKey(
          this.vault.encryptionPublicKeyJwk,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          ['encrypt']
        ),
        privateKey: await ScrapCrypto.importJwkToKey(
          this.vault.encryptionPrivateKeyJwk,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          ['decrypt']
        )
      };

      console.log('Identity unlocked and keypairs imported successfully!');
      return true;
    } catch (e) {
      console.error('Failed to unlock identity (incorrect PIN or corrupt data):', e);
      return false;
    }
  },

  async saveVaultToLocalAndDrive(pin) {
    const saltBase64 = ScrapCrypto.arrayBufferToBase64(this.salt);
    const aesKey = await ScrapCrypto.deriveKeyFromPin(pin, this.salt);
    
    const vaultStr = JSON.stringify(this.vault);
    const vaultBuffer = ScrapCrypto.stringToBuffer(vaultStr);
    
    const encryptedBuffer = await ScrapCrypto.encryptData(vaultBuffer, aesKey);
    const encryptedVaultBase64 = ScrapCrypto.arrayBufferToBase64(encryptedBuffer);
    
    // Save to localStorage for quick boot
    const userId = (typeof ScrapFirebase !== 'undefined' && ScrapFirebase.userId) || localStorage.getItem('scrap_user_id') || 'default';
    localStorage.setItem(`scrap_local_vault_${userId}`, encryptedVaultBase64);
    localStorage.setItem(`scrap_local_salt_${userId}`, saltBase64);

    // In a live system, we also upload this string to the hidden App Folder in Drive:
    // await ScrapDrive.uploadFile('key_vault.json', encryptedBuffer, 'root_app_folder');
    
    return { encryptedVaultBase64, saltBase64 };
  },

  // Save key for a group room
  async saveRoomKey(roomId, aesKey) {
    if (!this.vault.roomKeys) {
      this.vault.roomKeys = {};
    }
    const rawKeyJwk = await ScrapCrypto.exportKeyToJwk(aesKey);
    this.vault.roomKeys[roomId] = rawKeyJwk;
    this.roomKeysCache[roomId] = aesKey; // Cache the CryptoKey in memory
    
    // Re-encrypt vault if PIN is stored in session
    const pin = sessionStorage.getItem('scrap_pin_session') || '000000';
    await this.saveVaultToLocalAndDrive(pin);
  },

  // Delete key for a group room
  async deleteRoomKey(roomId) {
    if (this.vault.roomKeys) {
      delete this.vault.roomKeys[roomId];
    }
    delete this.roomKeysCache[roomId];
    
    // Re-encrypt vault if PIN is stored in session
    const pin = sessionStorage.getItem('scrap_pin_session') || '000000';
    await this.saveVaultToLocalAndDrive(pin);
  },

  async getRoomKey(roomId) {
    if (this.roomKeysCache[roomId]) {
      return this.roomKeysCache[roomId];
    }
    if (!this.vault.roomKeys) {
      this.vault.roomKeys = {};
    }
    const keyJwk = this.vault.roomKeys[roomId];
    if (!keyJwk) return null;
    const importedKey = await ScrapCrypto.importJwkToKey(
      keyJwk,
      { name: 'AES-GCM', length: 256 },
      ['encrypt', 'decrypt']
    );
    this.roomKeysCache[roomId] = importedKey; // Cache the imported CryptoKey
    return importedKey;
  },

  // --- Social Recovery Mechanisms ---
  async generateSocialRecoveryToken(roomId) {
    // Generate temporary 4-digit token
    const token = Math.floor(1000 + Math.random() * 9000).toString();
    const roomKeyJwk = this.vault.roomKeys[roomId];
    
    // Save token to Firebase recovery channel for verification
    await ScrapFirebase.saveElement(roomId, `recovery_token_${this.vault.identityPublicKeyJwk.n.substring(0,8)}`, {
      token: token,
      roomKeyJwk: roomKeyJwk,
      approverName: ScrapFirebase.userName,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });
    
    return token;
  },

  async executeSocialRecovery(roomId, requesterPublicKeyJwk, approvalTokens) {
    // Collect approved tokens, encrypt room key with requester's public encryption key,
    // and broadcast back to the requester
    const roomKeyJwk = this.vault.roomKeys[roomId];
    if (!roomKeyJwk) return false;

    try {
      const pubKey = await ScrapCrypto.importJwkToKey(
        requesterPublicKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        ['encrypt']
      );

      // Encrypt the room key JSON
      const roomKeyStr = JSON.stringify(roomKeyJwk);
      const roomKeyBuffer = ScrapCrypto.stringToBuffer(roomKeyStr);
      
      const encryptedKey = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        pubKey,
        roomKeyBuffer
      );

      const encryptedBase64 = ScrapCrypto.arrayBufferToBase64(encryptedKey);
      
      await ScrapFirebase.saveElement(roomId, `recovered_key_${roomId}`, {
        encryptedRoomKey: encryptedBase64,
        forRoom: roomId,
        approvers: approvalTokens
      });

      return true;
    } catch(e) {
      console.error('Social recovery compilation failed:', e);
      return false;
    }
  }
};
window.ScrapRecovery = ScrapRecovery;
