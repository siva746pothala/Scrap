/**
 * S3/Cloudflare R2 Direct File Manager
 * Requests secure pre-signed URLs from PocketBase server and interacts with R2 directly.
 */

const ScrapR2 = {
  endpoint: 'https://4d6b71a94148fa81bf2f974ffa012d16.r2.cloudflarestorage.com',
  bucket: 'myscrap-media',

  async getPresignedUrl(method, fileName, mimeType = '') {
    if (!window.pb) {
      throw new Error("PocketBase client is not initialized.");
    }
    // Requests the pre-signed URL for the specified method (PUT, GET, or DELETE)
    const response = await window.pb.send("/api/r2-presign", {
      query: { 
        filename: fileName,
        method: method,
        mimeType: mimeType
      }
    });
    return response.uploadUrl;
  },

  async upload(fileName, arrayBuffer, mimeType) {
    try {
      const uploadUrl = await this.getPresignedUrl('PUT', fileName, mimeType);

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType
        },
        body: new Blob([arrayBuffer], { type: mimeType })
      });

      if (!res.ok) {
        let errBody = '';
        try {
          errBody = await res.text();
        } catch (e) {}
        throw new Error(`R2 Upload failed: status ${res.status} - ${errBody}`);
      }
      return true;
    } catch (error) {
      console.error("R2 Upload error:", error);
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

  async delete(fileName) {
    try {
      const deleteUrl = await this.getPresignedUrl('DELETE', fileName);

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
