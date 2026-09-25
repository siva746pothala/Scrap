/**
 * S3/Cloudflare R2 Direct File Manager
 * Requests secure pre-signed URLs from PocketBase server and interacts with R2 directly.
 */

const ScrapR2 = {
  endpoint: 'https://4d6b71a94148fa81bf2f974ffa012d16.r2.cloudflarestorage.com',
  bucket: 'myscrap-media',

  async getPresignedUrl(method, fileName, mimeType = '', pbClient = window.pb) {
    const client = pbClient || window.pb;
    if (!client) {
      throw new Error("PocketBase client is not initialized.");
    }
    // Requests the pre-signed URL for the specified method (PUT, GET, or DELETE)
    const response = await client.send("/api/r2-presign", {
      query: { 
        filename: fileName,
        method: method,
        mimeType: mimeType
      }
    });
    console.log('[r2-presign response]:', response);
    const url = (response && (response.uploadUrl || response.url || response.presignedUrl || response.upload_url)) || (typeof response === 'string' ? response : null);
    if (!url) {
      throw new Error(`Invalid pre-signed R2 URL response: ${JSON.stringify(response)}`);
    }
    return url;
  },

  async upload(fileName, arrayBuffer, mimeType, onProgress) {
    try {
      const uploadUrl = await this.getPresignedUrl('PUT', fileName, mimeType);
      console.log(`[ScrapR2] Uploading ${fileName} (${arrayBuffer.byteLength} bytes) to R2...`);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        if (mimeType) {
          try {
            xhr.setRequestHeader('Content-Type', mimeType);
          } catch (e) {}
        }

        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
              onProgress(percent);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log(`[ScrapR2] Upload success for ${fileName}`);
            if (typeof onProgress === 'function') onProgress(100);
            resolve(true);
          } else {
            console.error(`[ScrapR2] Upload failed for ${fileName}: status ${xhr.status}`, xhr.responseText);
            reject(new Error(`R2 Upload failed: status ${xhr.status} - ${xhr.responseText}`));
          }
        };

        xhr.onerror = (e) => {
          console.error(`[ScrapR2] Network error uploading ${fileName}:`, e);
          reject(new Error('R2 Upload network error'));
        };
        xhr.ontimeout = () => reject(new Error('R2 Upload timeout'));

        xhr.send(new Blob([arrayBuffer], { type: mimeType }));
      });
    } catch (error) {
      console.error("[ScrapR2] Upload error:", error);
      throw error;
    }
  },

  async download(fileName) {
    try {
      // If your bucket/files are public, you can fetch directly without signing:
      // const url = `https://your-public-cdn-domain.com/${fileName}`;
      // Otherwise, request a signed GET URL:
      const downloadUrl = await this.getPresignedUrl('GET', fileName);

      const res = await fetch(downloadUrl, {
        method: 'GET'
      });

      if (!res.ok) {
        throw new Error(`R2 Download failed: status ${res.status}`);
      }
      return await res.arrayBuffer();
    } catch (error) {
      console.error("R2 Download error:", error);
      throw error;
    }
  },

  async delete(fileName, pbClient = window.pb) {
    try {
      const deleteUrl = await this.getPresignedUrl('DELETE', fileName, '', pbClient);

      const res = await fetch(deleteUrl, {
        method: 'DELETE'
      });

      if (!res.ok) {
        let details = '';
        try {
          details = (await res.text()).trim();
        } catch (error) {}
        throw new Error(`R2 Delete failed: status ${res.status} for ${fileName}${details ? ` - ${details}` : ''}`);
      }
      return res.ok;
    } catch (error) {
      console.error("R2 Delete error:", error);
      throw error;
    }
  }
};

window.ScrapR2 = ScrapR2;
