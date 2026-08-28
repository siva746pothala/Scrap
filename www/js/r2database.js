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

      // Convert arrayBuffer to base64
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
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

  async uploadFile(fileName, arrayBuffer, roomFolderId, mimeType = 'application/octet-stream') {
    // Extract current username for easy identification in Cloudflare console list
    const username = (window.pb && pb.authStore.isValid && pb.authStore.model)
      ? (pb.authStore.model.username || pb.authStore.model.name || pb.authStore.model.id)
      : (window.ScrapFirebase && window.ScrapFirebase.userName) || 'squadmate';

    const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
    const prefixedFileName = `${safeUsername}_${fileName}`;

    console.log('[LocalDrive] Uploading directly to Cloudflare R2:', prefixedFileName, arrayBuffer.byteLength, mimeType);
    if (window.ScrapR2) {
      await window.ScrapR2.upload(prefixedFileName, arrayBuffer, mimeType);
    } else {
      throw new Error('R2 Uploader not initialized');
    }

    if (window.ScrapFirebase) {
      if (!window.ScrapFirebase.mediaCacheRAM) {
        window.ScrapFirebase.mediaCacheRAM = {};
      }
      const blob = new Blob([arrayBuffer], { type: mimeType });
      window.ScrapFirebase.mediaCacheRAM[prefixedFileName] = blob;
    }

    // Also save to disk cache immediately
    await this.writeLocalCacheFile(prefixedFileName, arrayBuffer);

    // Auto sync board state to PocketBase
    setTimeout(() => {
      if (window.ScrapFirebase && typeof window.ScrapFirebase.syncBoardToPocketBase === 'function') {
        window.ScrapFirebase.syncBoardToPocketBase().catch(console.error);
      }
    }, 100);

    return { id: prefixedFileName };
  },

  async downloadFile(fileId) {
    console.log('[LocalDrive] Downloading file from Cloudflare R2:', fileId);

    // 1. Check RAM buffer
    if (window.ScrapFirebase && window.ScrapFirebase.mediaCacheRAM && window.ScrapFirebase.mediaCacheRAM[fileId]) {
      return await window.ScrapFirebase.mediaCacheRAM[fileId].arrayBuffer();
    }

    // 2. Check persistent disk cache (14-day limit)
    const cachedBuffer = await this.readLocalCacheFile(fileId);
    if (cachedBuffer) {
      console.log('[LocalDrive] Loaded from persistent disk cache:', fileId);
      return cachedBuffer;
    }

    // 3. Fallback: Download from Cloudflare R2 directly
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

  async deleteFile(fileId) {
    console.log('[LocalDrive] Deleting file from Cloudflare R2:', fileId);
    if (window.ScrapR2) {
      await window.ScrapR2.delete(fileId);
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
