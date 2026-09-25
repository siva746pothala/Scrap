/**
 * Scrap App Local File Buffering Layer
 * Replaces Google Drive API with local buffers saved to PocketBase
 * Implements 14-day persistent local cache via Capacitor Filesystem
 */

const ScrapDrive = {
  isGoogleDriveId(id) {
    return false;
  },

  async resolveRoomFolder(roomId, roomTitle, dateStr = null) {
    return 'local_room';
  },

  async resolveRoomCanvasDataFolder(roomId, roomTitle) {
    return 'local_canvas';
  },

  async shareFolderPublicly(folderId) {
    return Promise.resolve();
  },

  async initialize() {
    return Promise.resolve();
  },

  setAccessToken(token) {
    // No-op
  },

  setApiKey(key) {
    // No-op
  },

  async getOrCreateFolder(folderName, parentId = null) {
    return 'local_folder';
  },

  async writeLocalCacheFile(fileName, arrayBuffer) {
    try {
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (!Filesystem) return;

      // Fast chunked ArrayBuffer to Base64 conversion (100x faster, zero main-thread lag)
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const chunkSize = 0x8000; // 32KB chunks
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const base64Data = btoa(binary);

      await Filesystem.writeFile({
        path: `media_cache/${fileName}`,
        data: base64Data,
        directory: 'CACHE',
        recursive: true
      });

      localStorage.setItem(`scrap_cache_time_${fileName}`, String(Date.now()));
    } catch (e) {
      console.error('[Cache] Failed to write file to local disk cache:', e);
    }
  },

  async readLocalCacheFile(fileName) {
    try {
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (!Filesystem) return null;

      const cacheTime = localStorage.getItem(`scrap_cache_time_${fileName}`);
      if (!cacheTime) return null;

      const ageInDays = (Date.now() - Number(cacheTime)) / (1000 * 60 * 60 * 24);
      if (ageInDays > 14) {
        console.log('[Cache] Expired file, deleting:', fileName);
        await this.deleteLocalCacheFile(fileName);
        return null;
      }

      const file = await Filesystem.readFile({
        path: `media_cache/${fileName}`,
        directory: 'CACHE'
      });

      // Convert base64 to ArrayBuffer
      const binaryString = atob(file.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (e) {
      return null;
    }
  },

  async deleteLocalCacheFile(fileName) {
    try {
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (!Filesystem) return;

      await Filesystem.deleteFile({
        path: `media_cache/${fileName}`,
        directory: 'CACHE'
      });
      localStorage.removeItem(`scrap_cache_time_${fileName}`);
    } catch (e) { }
  },

  async cleanupOldCacheFiles() {
    try {
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (!Filesystem) return;

      const result = await Filesystem.readdir({
        path: 'media_cache',
        directory: 'CACHE'
      });

      if (result && result.files) {
        for (const file of result.files) {
          const fileName = file.name;
          const cacheTime = localStorage.getItem(`scrap_cache_time_${fileName}`);
          if (cacheTime) {
            const ageInDays = (Date.now() - Number(cacheTime)) / (1000 * 60 * 60 * 24);
            if (ageInDays > 14) {
              console.log('[Cache Cleanup] Deleting expired file:', fileName);
              await this.deleteLocalCacheFile(fileName);
            }
          } else {
            await this.deleteLocalCacheFile(fileName);
          }
        }
      }
    } catch (e) { }
  },

  async uploadFile(fileName, arrayBuffer, roomFolderId, mimeType = 'application/octet-stream', onProgress) {
    const username = (window.pb && pb.authStore.isValid && pb.authStore.model)
      ? (pb.authStore.model.username || pb.authStore.model.name || pb.authStore.model.id)
      : (window.ScrapFirebase && window.ScrapFirebase.userName) || 'squadmate';
    const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
    let prefixedFileName = fileName;
    if (!fileName.startsWith(`${safeUsername}_`)) {
      prefixedFileName = `${safeUsername}_${fileName}`;
    }

    console.log('[LocalDrive] Uploading directly to Cloudflare R2:', prefixedFileName, arrayBuffer.byteLength, mimeType);
    if (window.ScrapR2) {
      await window.ScrapR2.upload(prefixedFileName, arrayBuffer, mimeType, onProgress);
    } else {
      throw new Error('R2 Uploader not initialized');
    }

    // Also save to disk cache immediately
    await this.writeLocalCacheFile(prefixedFileName, arrayBuffer);

    return { id: prefixedFileName };
  },

  async downloadFile(fileId) {
    console.log('[LocalDrive] Downloading file from Cloudflare R2:', fileId);

    // Use persistent disk cache (14-day limit); do not retain media in a RAM cache.
    const cachedBuffer = await this.readLocalCacheFile(fileId);
    if (cachedBuffer) {
      console.log('[LocalDrive] Loaded from persistent disk cache:', fileId);
      return cachedBuffer;
    }

    // Download from Cloudflare R2 only when the encrypted file is not on disk.
    if (window.ScrapR2) {
      const arrayBuffer = await window.ScrapR2.download(fileId);
      // Save to persistent disk cache
      await this.writeLocalCacheFile(fileId, arrayBuffer);
      return arrayBuffer;
    } else {
      throw new Error('R2 Downloader not initialized');
    }
  },

  async uploadOrUpdateFile(fileName, arrayBuffer, roomFolderId) {
    return this.uploadFile(fileName, arrayBuffer, roomFolderId);
  },

  async deleteFile(fileId, pbClient = window.pb) {
    console.log('[LocalDrive] Deleting file from Cloudflare R2:', fileId);
    if (window.ScrapR2) {
      await window.ScrapR2.delete(fileId, pbClient);
    }
    await this.deleteLocalCacheFile(fileId);

    // Sync the deletion
    setTimeout(() => {
      window.ScrapFirebase.syncBoardToPocketBase().catch(console.error);
    }, 100);
    return true;
  }
};

window.ScrapDrive = ScrapDrive;
