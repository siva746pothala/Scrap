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

    // Sync master vault package to PocketBase under user email (non-blocking)
    this.syncVaultToServer(encryptedVaultBase64, saltBase64).catch(err => {
      console.warn('[ScrapRecovery] Cloud vault sync warning:', err);
    });
    
    return { encryptedVaultBase64, saltBase64 };
  },

  async syncVaultToServer(vaultBase64 = null, saltBase64 = null) {
    try {
      const email = (window.pb && pb.authStore && pb.authStore.isValid && pb.authStore.model && pb.authStore.model.email) || null;
      if (!email) return false;

      const userId = (typeof ScrapFirebase !== 'undefined' && ScrapFirebase.userId) || localStorage.getItem('scrap_user_id') || 'default';
      const vault = vaultBase64 || localStorage.getItem(`scrap_local_vault_${userId}`);
      const salt = saltBase64 || localStorage.getItem(`scrap_local_salt_${userId}`);

      if (!vault || !salt) return false;

      const pbUrl = (window.pb && pb.baseUrl) || 'https://api.myscrapmemories.com';
      const res = await fetch(`${pbUrl}/api/sync-user-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), vault: vault, salt: salt })
      });
      const data = await res.json();
      return data && data.success;
    } catch (e) {
      console.warn('[ScrapRecovery] syncVaultToServer error:', e);
      return false;
    }
  },

  async requestOtpKeyRecovery(email) {
    try {
      const pbUrl = (window.pb && pb.baseUrl) || 'https://api.myscrapmemories.com';
      const res = await fetch(`${pbUrl}/api/request-vault-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: (email || '').trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to request OTP');
      }
      return data; // { success: true, otpId: '...' }
    } catch (e) {
      console.error('[ScrapRecovery] requestOtpKeyRecovery error:', e);
      throw e;
    }
  },

  async verifyOtpAndRestoreVault(email, otpCode, otpId = '') {
    try {
      const pbUrl = (window.pb && pb.baseUrl) || 'https://api.myscrapmemories.com';
      const res = await fetch(`${pbUrl}/api/verify-vault-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: (email || '').trim().toLowerCase(),
          otpCode: (otpCode || '').trim(),
          otpId: otpId
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Invalid OTP verification');
      }

      // Unlock vault payload using session PIN
      const pin = sessionStorage.getItem('scrap_pin_session') || '000000';
      const restored = await this.unlockIdentity(pin, data.vault, data.salt);
      if (restored) {
        // Save to local storage for quick offline access
        const userId = (typeof ScrapFirebase !== 'undefined' && ScrapFirebase.userId) || localStorage.getItem('scrap_user_id') || 'default';
        localStorage.setItem(`scrap_local_vault_${userId}`, data.vault);
        localStorage.setItem(`scrap_local_salt_${userId}`, data.salt);
      }
      return restored;
    } catch (e) {
      console.error('[ScrapRecovery] verifyOtpAndRestoreVault error:', e);
      throw e;
    }
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
  async deleteRoomKey(roomId, targetTitle = '') {
    // Retrieve room title BEFORE clearing localStorage keys so we can match export filenames
    const cachedTitle = localStorage.getItem(`scrap_room_title_${roomId}`) || '';
    const rawTitle = targetTitle || cachedTitle;
    const roomTitle = rawTitle ? rawTitle.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 8) : '';

    // Grab target room key JWK from memory/vault before removing it
    let targetKeyK = null;
    if (this.vault && this.vault.roomKeys && this.vault.roomKeys[roomId]) {
      targetKeyK = this.vault.roomKeys[roomId].k || null;
    }

    if (this.vault && this.vault.roomKeys) {
      delete this.vault.roomKeys[roomId];
    }
    delete this.roomKeysCache[roomId];
    
    // Clean up room-specific local storage keys & native preferences
    const roomKeysToClean = [
      `scrap_room_is_owner_${roomId}`,
      `scrap_room_title_${roomId}`,
      `scrap_room_canvas_data_${roomId}`,
      `scrap_robo_x`,
      `scrap_robo_y`
    ];

    roomKeysToClean.forEach(k => localStorage.removeItem(k));
    if (window.ScrapStorage) {
      for (const k of roomKeysToClean) {
        await ScrapStorage.remove(k).catch(() => {});
      }
    }

    // Clean up exported key files from phone storage (DOCUMENTS and CACHE directories)
    try {
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (Filesystem) {
        const sessionPin = sessionStorage.getItem('scrap_pin_session') || '000000';
        for (const dir of ['DOCUMENTS', 'CACHE']) {
          try {
            const res = await Filesystem.readdir({ path: '', directory: dir });
            if (res && res.files) {
              for (const file of res.files) {
                const fileName = typeof file === 'string' ? file : file.name;
                if (fileName && fileName.endsWith('.scrapkey')) {
                  const lowerName = fileName.toLowerCase();
                  let shouldDelete = false;

                  if (roomTitle && lowerName.includes(roomTitle)) {
                    shouldDelete = true;
                  } else {
                    // Read file content as backup check to see if it belongs to this room
                    try {
                      const fileRes = await Filesystem.readFile({
                        path: fileName,
                        directory: dir,
                        encoding: 'utf8'
                      });
                      const content = fileRes && (fileRes.data || fileRes.content || fileRes);
                      const str = typeof content === 'string' ? content : JSON.stringify(content);
                      
                      let parsed = null;
                      try { parsed = typeof content === 'object' ? content : JSON.parse(str); } catch (_) {}

                      if (parsed) {
                        if (parsed.roomId === roomId || (roomTitle && parsed.roomTitle && parsed.roomTitle.toLowerCase().includes(roomTitle))) {
                          shouldDelete = true;
                        } else if (parsed.vault && parsed.salt) {
                          const userId = (typeof ScrapFirebase !== 'undefined' && ScrapFirebase.userId) || localStorage.getItem('scrap_user_id') || 'default';
                          const curVault = localStorage.getItem(`scrap_local_vault_${userId}`);
                          const curSalt = localStorage.getItem(`scrap_local_salt_${userId}`);

                          if ((curVault && parsed.vault === curVault) || (curSalt && parsed.salt === curSalt)) {
                            shouldDelete = true;
                          } else {
                            // Try unlocking vault to check if this scrapkey file contains key for roomId or matching key bytes
                            try {
                              const saltBuf = ScrapCrypto.base64ToArrayBuffer(parsed.salt);
                              const aesKey = await ScrapCrypto.deriveKeyFromPin(sessionPin, saltBuf);
                              const decBuf = await ScrapCrypto.decryptData(ScrapCrypto.base64ToArrayBuffer(parsed.vault), aesKey);
                              const fileVaultStr = ScrapCrypto.bufferToString(decBuf);
                              const fileVault = JSON.parse(fileVaultStr);
                              if (fileVault && fileVault.roomKeys) {
                                if (fileVault.roomKeys[roomId]) {
                                  shouldDelete = true;
                                } else if (targetKeyK) {
                                  for (const rk of Object.values(fileVault.roomKeys)) {
                                    if (rk && rk.k === targetKeyK) {
                                      shouldDelete = true;
                                      break;
                                    }
                                  }
                                }
                              }
                            } catch (_) {}
                          }
                        }
                      }
                      if (!shouldDelete && str && ((roomId && str.includes(roomId)) || (roomTitle && str.toLowerCase().includes(roomTitle)))) {
                        shouldDelete = true;
                      }
                    } catch (_) {}
                  }

                  if (shouldDelete) {
                    console.log(`[deleteRoomKey] Deleting backup key file: ${dir}/${fileName}`);
                    await Filesystem.deleteFile({ path: fileName, directory: dir }).catch(() => {});
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    } catch (fsErr) {
      console.warn('[deleteRoomKey] Filesystem cleanup warning:', fsErr);
    }

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
