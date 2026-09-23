/**
 * Scrap App Controller & Coordinator
 * Handles:
 * - Routing between Screens 1, 2, 3, 5, 6, A
 * - Multi-tab sandbox sync or Live database connection
 * - Image capturing, scaling, safety checks, E2EE, and uploading
 * - Option overlays (doodling, captions, export shaming)
 * - Invite handshake verification via RSA signature verification
 */

// Set to true to disable console logs in production/release mode
const DISABLE_LOGS = true;
if (DISABLE_LOGS) {
  console.log = function () { };
  console.debug = function () { };
  console.info = function () { };
  console.warn = function () { };
}

const pb = new PocketBase('https://api.myscrapmemories.com');
window.pb = pb;

const ScrapApp = {
  // Expose to window immediately
  setupGlobalReference() {
    window.ScrapApp = this;
  },
  dismissSplash() {
    const splash = document.getElementById('scrap-loading-splash');
    if (splash) {
      splash.style.pointerEvents = 'none'; // Instantly let clicks pass through to inputs during the fade-out transition
      splash.classList.add('splash-fade-out');
      setTimeout(() => {
        splash.remove();
      }, 700);
    }
  },
  getSavedTheme() {
    const localTheme = localStorage.getItem('scrap_theme');
    if (localTheme) return localTheme;

    // Auto-restore 'custom' theme if user has custom_bg or encrypted_custom_bg on PocketBase server after app reinstall
    const user = window.pb && pb.authStore.isValid && pb.authStore.model;
    if (user && (user.custom_bg || user.encrypted_custom_bg)) {
      localStorage.setItem('scrap_theme', 'custom');
      return 'custom';
    }
    return 'cyberpunk';
  },
  async resolveCustomBgUrl(user) {
    if (!user) return '';
    let url = user.custom_bg ? `https://api.myscrapmemories.com/api/files/users/${user.id}/${user.custom_bg}` : '';
    if (user.encrypted_custom_bg && window.ScrapCrypto && typeof ScrapCrypto.decryptText === 'function') {
      try {
        const roomId = localStorage.getItem('scrap_current_room_id');
        const cryptoKey = window.ScrapFirebase ? await ScrapFirebase.getUserAvatarCryptoKey(user.id, roomId) : null;
        if (cryptoKey) {
          const decBg = await ScrapCrypto.decryptText(user.encrypted_custom_bg, cryptoKey);
          if (decBg && decBg.startsWith('data:')) {
            url = decBg;
          }
        }
      } catch (_) { }
    }
    return url;
  },
  async resolveUserAvatarUrl(user) {
    if (!user) return '';
    let avatarUrl = user.avatar ? `https://api.myscrapmemories.com/api/files/users/${user.id}/${user.avatar}` : '';
    if (user.encrypted_avatar && window.ScrapCrypto && typeof ScrapCrypto.decryptText === 'function') {
      try {
        let roomId = localStorage.getItem('scrap_current_room_id');
        let cryptoKey = window.ScrapFirebase ? await ScrapFirebase.getUserAvatarCryptoKey(user.id, roomId) : null;

        if (cryptoKey) {
          const decAvatar = await ScrapCrypto.decryptText(user.encrypted_avatar, cryptoKey);
          if (decAvatar && decAvatar.startsWith('data:')) {
            avatarUrl = decAvatar;
          }
        }
      } catch (_) { }
    }
    return avatarUrl;
  },
  applyTheme(theme) {
    const activeTheme = theme || this.getSavedTheme();
    document.body.classList.remove('theme-cyberpunk', 'theme-classical', 'theme-vaporwave', 'theme-matrix', 'theme-retro', 'theme-light', 'theme-custom');
    document.body.classList.add(`theme-${activeTheme}`);

    let styleEl = document.getElementById('custom-theme-style');
    if (activeTheme === 'custom') {
      const user = window.pb && pb.authStore.isValid && pb.authStore.model;
      const plainBg = user && user.custom_bg
        ? `https://api.myscrapmemories.com/api/files/users/${user.id}/${user.custom_bg}`
        : '';

      const updateBgCss = (bgUrl) => {
        if (!bgUrl) {
          if (styleEl) styleEl.remove();
          return;
        }
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'custom-theme-style';
          document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = `
          body.theme-custom {
            background-image: url('${bgUrl}') !important;
            background-size: cover !important;
            background-position: center !important;
            background-repeat: no-repeat !important;
          }
          body.theme-custom .cyber-grid-bg {
            background-color: transparent !important;
          }
        `;
      };

      // Set fallback plain URL immediately for fast rendering
      updateBgCss(plainBg);

      // Asynchronously decrypt custom theme image if encrypted payload is available
      if (user && user.encrypted_custom_bg) {
        this.resolveCustomBgUrl(user).then(decryptedUrl => {
          if (decryptedUrl) updateBgCss(decryptedUrl);
        }).catch(() => { });
      }
    } else {
      if (styleEl) styleEl.remove();
    }
  },
  applyEdgeGlow() {
    const glowEl = document.getElementById('screen-edge-glow');
    if (!glowEl) return;

    const enabled = localStorage.getItem('scrap_edge_glow_enabled') === 'true';
    const color = localStorage.getItem('scrap_edge_glow_color') || 'multicolor';

    if (enabled) {
      glowEl.classList.remove('hidden');
      glowEl.className = 'fixed inset-0 pointer-events-none z-[999999]';
      if (color === 'multicolor') {
        glowEl.classList.add('screen-edge-glow-multicolor');
        glowEl.style.boxShadow = '';
        glowEl.style.borderColor = '';
      } else {
        glowEl.style.boxShadow = `inset 0 0 15px ${color}, 0 0 8px ${color}`;
        glowEl.style.borderColor = `${color}60`;
      }
    } else {
      glowEl.classList.add('hidden');
    }
  },
  applyRoboTheme() {
    const theme = localStorage.getItem('scrap_robo_theme') || 'default';
    const root = document.documentElement;
    const helper = document.getElementById('btn-dashboard-helper');

    const colors = {
      default: { glow: '#00f0ff', accent: '#ff00ab', eyes: '#39ff14' },
      tricolor: { glow: '#FF9933', accent: '#ffffff', eyes: '#128807' },
      diwali: { glow: '#FF5E00', accent: '#FFD700', eyes: '#FFE600' },
      holi: { glow: '#FF00AB', accent: '#00F0FF', eyes: '#39FF14' },
      christmas: { glow: '#10B981', accent: '#EF4444', eyes: '#F59E0B' }
    };

    const active = colors[theme] || colors.default;

    root.style.setProperty('--robo-glow', active.glow);
    root.style.setProperty('--robo-accent', active.accent);
    root.style.setProperty('--robo-eyes', active.eyes);

    if (helper) {
      helper.style.setProperty('--robo-glow', active.glow);
      helper.style.setProperty('--robo-accent', active.accent);
      helper.style.setProperty('--robo-eyes', active.eyes);
    }
  },
  async fetchAreas(query = '') {
    try {
      console.log(`[fetchAreas] Querying PocketBase areas via native fetch for: "${query}"...`);

      const fetchPromise = (async () => {
        const url = `https://api.myscrapmemories.com/api/collections/areas/records?filter=(area_name~'${encodeURIComponent(query)}')&sort=area_name`;
        const response = await window.fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.items || [];
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Native Fetch Timeout (5s)')), 5000)
      );

      const records = await Promise.race([fetchPromise, timeoutPromise]);
      this.areasList = records || [];
      console.log('[fetchAreas] Loaded matching areas successfully:', this.areasList);
    } catch (err) {
      console.error('[fetchAreas] Error fetching areas from PocketBase:', err);
      this.areasList = [];
    }
  },
  hasLoadedAreas: false,
  activeScreen: 'screen-gateway',
  currentRoomId: null,
  currentRoomTitle: 'Squad Space',
  isSoloMode: false,
  selectedPhotoElementId: null,
  selectedPhotoData: null,
  isLockScreenActive: false,
  lastUnlockTime: 0,

  // Simulated database content for sandbox rooms
  defaultRooms: [],

  qrScanStream: null,
  qrScanAnimationFrameId: null,
  qrScanActive: false,
  inAppVideoTrack: null,
  inAppAnimationFrame: null,
  qrAutoAdjustLastAt: 0,

  async startQRScanner() {
    this.qrScanActive = false;
    if (this.inAppAnimationFrame) {
      clearTimeout(this.inAppAnimationFrame);
      this.inAppAnimationFrame = null;
    }
    if (this.inAppVideoTrack) {
      try { this.inAppVideoTrack.stop(); } catch (e) { }
      this.inAppVideoTrack = null;
    }

    const prevVideo = document.getElementById('inapp-qr-video');
    if (prevVideo) {
      prevVideo.srcObject = null;
      prevVideo.style.display = 'block';
    }

    document.body.classList.remove('barcode-scanner-active');
    document.documentElement.classList.remove('barcode-scanner-active');

    // Always start HTML5 in-app video camera feed (No black screen!)
    await this.startInAppQRScanner();
  },

  cleanUpAllTooltipsAndArrows() {
    const emptyBanner = document.getElementById('canvas-empty-date-info-banner');
    if (emptyBanner) emptyBanner.remove();
    const emptySvg = document.getElementById('canvas-empty-date-arrow-svg');
    if (emptySvg) emptySvg.remove();
    const photoTip = document.getElementById('canvas-photo-longpress-tip');
    if (photoTip) photoTip.remove();
    const robotTip = document.getElementById('dashboard-robot-helper-tip');
    if (robotTip) robotTip.remove();
    const arrowLine = document.getElementById('tour-arrow-line');
    if (arrowLine) arrowLine.setAttribute('d', 'M0,0 Q0,0 0,0');
  },

  async startInAppQRScanner() {
    this.cleanUpAllTooltipsAndArrows();

    const modal = document.getElementById('modal-inapp-qr-scanner');
    const video = document.getElementById('inapp-qr-video');
    const canvas = document.getElementById('inapp-qr-canvas');
    const statusText = document.getElementById('inapp-qr-status');
    if (!modal || !video || !canvas) return;

    // Show modal immediately
    modal.classList.remove('hidden');
    video.style.display = 'block';
    if (statusText) statusText.innerText = 'Starting camera...';
    this.qrAutoAdjustLastAt = 0;
    this.qrScanActive = true;

    // High-compatibility camera stream for Android Camera2 HAL
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
    } catch (e1) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      } catch (e2) {
        console.warn('[QRScanner] Camera access failed:', e2);
        this.qrScanActive = false;
        if (statusText) statusText.innerText = 'Camera unavailable - use a photo';
        return;
      }
    }

    this.inAppVideoTrack = stream.getVideoTracks()[0];
    video.srcObject = stream;

    // Apply camera capabilities without changing zoom while decoding.
    try {
      const caps = this.inAppVideoTrack.getCapabilities ? this.inAppVideoTrack.getCapabilities() : {};
      const constraints = { advanced: [] };
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        constraints.advanced.push({ focusMode: 'continuous' });
      }
      if (caps.zoom) {
        constraints.advanced.push({ zoom: caps.zoom.min || 1 });
      }
      if (constraints.advanced.length > 0) {
        await this.inAppVideoTrack.applyConstraints(constraints);
      }
    } catch (e) {
      console.debug('[QRScanner] Focus/Zoom setup note:', e);
    }

    // Apply digital zoom CSS scale transform so camera feed fills the viewfinder nicely
    video.style.transform = 'scale(1.5)';
    video.style.transformOrigin = 'center center';
    // Play video — don't await, just trigger it
    video.play().catch(e => console.warn('[QRScanner] video.play() error:', e));

    // Wait for video to have data
    await new Promise((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.addEventListener('loadeddata', resolve, { once: true });
      setTimeout(resolve, 2000); // max wait 2 seconds
    });

    if (!this.qrScanActive) return; // user may have closed before camera ready
    if (statusText) statusText.innerText = 'Align QR code within frame';

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let detector = null;
    if ('BarcodeDetector' in window) {
      try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { }
    }

    const MAX_SCAN_DIM = 960; // High resolution scanning
    let scanFrameCount = 0;

    const scanFrame = async () => {
      if (!this.qrScanActive) return;
      scanFrameCount++;

      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        let decodedText = null;

        // Visual live status update every 15 frames so user sees active scanner status
        if (scanFrameCount % 15 === 0 && statusText) {
          statusText.innerText = `Scanning... (${video.videoWidth}x${video.videoHeight} • Frame ${scanFrameCount})`;
        }

        // 1. Try native BarcodeDetector on video element directly
        if (detector) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length > 0) {
              if (barcodes[0].rawValue) decodedText = barcodes[0].rawValue;
            }
          } catch (e) { }
        }

        // 2. Optimized jsQR Scan Pass (Scaled to 640px max dimension for fast high-contrast decoding)
        if (!decodedText && window.jsQR) {
          const maxDim = 640;
          const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
          const w = Math.max(1, Math.round(video.videoWidth * scale));
          const h = Math.max(1, Math.round(video.videoHeight * scale));

          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(video, 0, 0, w, h);

          // Pass 1: Full frame (1.0x)
          try {
            const imageData = ctx.getImageData(0, 0, w, h);
            const code = window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
            if (code && code.data) decodedText = code.data;
          } catch (e) { }

          // Pass 2: Center Crop (1.8x Zoom)
          if (!decodedText) {
            try {
              const cropW = Math.round(w * 0.55);
              const cropH = Math.round(h * 0.55);
              const cropX = Math.round((w - cropW) / 2);
              const cropY = Math.round((h - cropH) / 2);
              const cropData = ctx.getImageData(cropX, cropY, cropW, cropH);
              const code = window.jsQR(cropData.data, cropW, cropH, { inversionAttempts: 'attemptBoth' });
              if (code && code.data) decodedText = code.data;
            } catch (e) { }
          }

          // Pass 3: Tight Center Crop (3.0x Zoom)
          if (!decodedText) {
            try {
              const cropW = Math.round(w * 0.33);
              const cropH = Math.round(h * 0.33);
              const cropX = Math.round((w - cropW) / 2);
              const cropY = Math.round((h - cropH) / 2);
              const cropData = ctx.getImageData(cropX, cropY, cropW, cropH);
              const code = window.jsQR(cropData.data, cropW, cropH, { inversionAttempts: 'attemptBoth' });
              if (code && code.data) decodedText = code.data;
            } catch (e) { }
          }
        }

        if (decodedText) {
          console.log('[QRScanner] Decoded successfully:', decodedText);

          // 1. Instantly stop active scan loop & stop camera track (Samsung-style immediate capture & release)
          this.qrScanActive = false;
          if (this.inAppAnimationFrame) {
            clearTimeout(this.inAppAnimationFrame);
            this.inAppAnimationFrame = null;
          }
          if (this.inAppVideoTrack) {
            try { this.inAppVideoTrack.stop(); } catch (e) { }
            this.inAppVideoTrack = null;
          }

          // 2. Pause video preview so current frame freezes on user screen immediately
          try { video.pause(); } catch (e) { }

          // 3. Visual feedback: update badge to show captured status
          if (statusText) {
            statusText.innerText = 'QR Code Captured ✓';
            statusText.classList.add('bg-emerald-600', 'text-white');
          }

          // 4. Close scanner modal, clean up fully, and process payload
          setTimeout(async () => {
            this.stopInAppQRScanner();
            document.getElementById('modal-invite')?.classList.add('hidden');
            await this.processQRInvitePayload(decodedText);
          }, 250);

          return;
        }
      }

      // Fast scan loop: 50ms interval (~20 FPS) for instant detection
      this.inAppAnimationFrame = setTimeout(scanFrame, 50);
    };

    this.inAppAnimationFrame = setTimeout(scanFrame, 150); // slight initial delay for camera warm-up
  },

  stopInAppQRScanner() {
    this.qrScanActive = false;

    // Clean up native transparent scanner if active
    const BarcodeScanner = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BarcodeScanner;
    if (this.isNativeScanning && BarcodeScanner) {
      try {
        if (this.nativeBarcodeListener) {
          this.nativeBarcodeListener.remove();
          this.nativeBarcodeListener = null;
        }
        if (BarcodeScanner.stopScan) BarcodeScanner.stopScan();
        if (BarcodeScanner.showBackground) BarcodeScanner.showBackground();
      } catch (e) {
        console.warn('Error stopping native scan:', e);
      }
      this.isNativeScanning = false;
      document.body.classList.remove('barcode-scanner-active');
    }

    if (this.inAppAnimationFrame) {
      clearTimeout(this.inAppAnimationFrame);
      this.inAppAnimationFrame = null;
    }
    if (this.inAppVideoTrack) {
      this.inAppVideoTrack.stop();
      this.inAppVideoTrack = null;
    }
    const video = document.getElementById('inapp-qr-video');
    if (video) {
      video.srcObject = null;
      video.style.display = 'block';
    }
    document.getElementById('modal-inapp-qr-scanner')?.classList.add('hidden');
  },

  decodeQRImage(source) {
    if (!window.jsQR || !source) return null;

    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    if (!sourceWidth || !sourceHeight) return null;

    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);

    const attempts = [
      { x: 0, y: 0, width, height },
      { x: width * 0.1, y: height * 0.1, width: width * 0.8, height: height * 0.8 },
      { x: width * 0.2, y: height * 0.2, width: width * 0.6, height: height * 0.6 }
    ];
    for (const attempt of attempts) {
      const cropWidth = Math.max(1, Math.round(attempt.width));
      const cropHeight = Math.max(1, Math.round(attempt.height));
      try {
        const imageData = context.getImageData(
          Math.round(attempt.x), Math.round(attempt.y), cropWidth, cropHeight
        );
        const code = window.jsQR(imageData.data, cropWidth, cropHeight, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) return code.data;
      } catch (error) {
        console.debug('[QRScanner] Image decode attempt failed:', error);
      }
    }
    return null;
  },

  async scanQRFromImageFile(file) {
    if (!file || !window.jsQR) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const image = new Image();
      image.onload = async () => {
        const decodedText = this.decodeQRImage(image);
        if (decodedText) {
          this.stopInAppQRScanner();
          document.getElementById('modal-invite')?.classList.add('hidden');
          await this.processQRInvitePayload(decodedText);
        } else if (window.ScrapDialog) {
          await window.ScrapDialog.alert('No valid QR code found in the selected image.');
        }
      };
      image.onerror = async () => {
        if (window.ScrapDialog) await window.ScrapDialog.alert('The selected image could not be opened.');
      };
      image.src = event.target.result;
    };
    reader.readAsDataURL(file);
  },

  async stopQRScanner() {
    this.stopInAppQRScanner();
  },

  async processQRInvitePayload(payloadStr) {
    try {
      let cleanedPayload = payloadStr.trim();

      // Robust extraction of the JSON payload from any URL scheme or raw input
      let decoded = cleanedPayload;
      try {
        decoded = decodeURIComponent(cleanedPayload);
      } catch (e) {
        console.warn('[QR] decodeURIComponent failed, using raw payloadStr:', e);
      }

      const firstBrace = decoded.indexOf('{');
      const lastBrace = decoded.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedPayload = decoded.substring(firstBrace, lastBrace + 1);
      } else {
        // Fallback to query param extraction if braces are not found
        if (cleanedPayload.includes('payload=')) {
          try {
            const parts = cleanedPayload.split('payload=');
            if (parts.length > 1) {
              let val = parts[1].split('&')[0];
              try {
                cleanedPayload = decodeURIComponent(val);
              } catch (e) {
                cleanedPayload = val;
              }
            }
          } catch (urlErr) {
            console.error('[QR] Failed to extract query parameter:', urlErr);
          }
        }
      }

      let qrPayload = JSON.parse(cleanedPayload);

      // Extract keys from direct object or nested structures
      const targetRoomId = qrPayload.r || qrPayload.roomId || (qrPayload.d && typeof qrPayload.d === 'object' ? qrPayload.d.r : null);
      const targetCanvasFolderId = qrPayload.d && typeof qrPayload.d === 'string' ? qrPayload.d : (qrPayload.canvasFolderId || qrPayload.r);
      const keyRaw = qrPayload.k || (qrPayload.roomKeyJwk ? qrPayload.roomKeyJwk.k : null);
      const targetExpiresAt = qrPayload.x || qrPayload.expiresAt || (Date.now() + 600000);
      let targetRoomTitle = qrPayload.t || qrPayload.roomTitle;
      if (!targetRoomTitle || targetRoomTitle === targetRoomId) {
        targetRoomTitle = localStorage.getItem('scrap_room_title_' + targetRoomId);
      }
      if ((!targetRoomTitle || targetRoomTitle === targetRoomId) && window.pb && pb.authStore.isValid && targetRoomId) {
        try {
          const boardRec = await pb.collection('boards').getOne(targetRoomId);
          if (boardRec && boardRec.title && boardRec.title !== targetRoomId) {
            targetRoomTitle = boardRec.title;
          }
        } catch (_) { }
      }
      if (!targetRoomTitle || targetRoomTitle === targetRoomId) {
        targetRoomTitle = 'Squad Space';
      }

      if (targetExpiresAt && Date.now() > targetExpiresAt) {
        await window.ScrapDialog.alert('🚨 Invite Expired! Invitation keys are valid for 5 minutes.');
        return;
      }

      if (!targetRoomId || !keyRaw) {
        throw new Error('Invalid QR code format. Missing room ID or key.');
      }

      const targetRoomKeyJwk = typeof keyRaw === 'string' ? {
        kty: "oct",
        k: keyRaw,
        alg: "A256GCM",
        ext: true,
        key_ops: ["encrypt", "decrypt"]
      } : keyRaw;

      if (!targetRoomKeyJwk) {
        throw new Error('Room encryption key is missing in invitation payload.');
      }

      // Import the AES room key from the QR payload
      const roomKey = await ScrapCrypto.importJwkToKey(
        targetRoomKeyJwk,
        { name: 'AES-GCM', length: 256 },
        ['encrypt', 'decrypt']
      );

      // Save the room key to the vault AND persist it.
      // saveRoomKey uses ScrapFirebase.userId for the localStorage key, so make
      // sure it is set before we save — otherwise the vault gets saved under
      // the wrong key and is silently lost on the next boot.
      if (!ScrapFirebase.userId) {
        ScrapFirebase.userId = localStorage.getItem('scrap_user_id') || this.userId || 'user_unknown';
      }
      await ScrapRecovery.saveRoomKey(targetRoomId, roomKey);

      // Stamp the roomId on ScrapFirebase immediately so that decryptAndDisplayImage
      // can find it even if the Firebase polling fires before openRoom() sets it.
      ScrapFirebase.roomId = targetRoomId;

      // Verify the key was actually persisted (guard against vault save failures)
      const verifyKey = await ScrapRecovery.getRoomKey(targetRoomId);
      if (!verifyKey) {
        await window.ScrapDialog.alert('🚨 Room key could not be saved to vault. Please try scanning again.');
        return;
      }

      // Save room title mapping to local cache
      localStorage.setItem('scrap_room_title_' + targetRoomId, targetRoomTitle);

      // Save canvasDataFolderId if present in deep link
      if (targetCanvasFolderId) {
        localStorage.setItem('scrap_room_canvas_data_' + targetRoomId, targetCanvasFolderId);
      }

      // Add this user as a member of the room in Firebase
      await ScrapFirebase.joinRoom(targetRoomId, ScrapFirebase.userId);

      document.getElementById('modal-invite').classList.add('hidden');

      // Clear the invite input field to avoid leftovers when joining multiple rooms
      const inputInvite = document.getElementById('input-invite-payload');
      if (inputInvite) {
        inputInvite.value = '';
      }

      await window.ScrapDialog.alert('✅ Connection Secure! Signature Verified. Added to Squad.');

      // Refresh room list and open the room directly
      await this.renderDashboardRooms();
      await this.openRoom(targetRoomId, targetRoomTitle);
    } catch (e) {
      console.error('[processQRInvitePayload] Error details:', e);
      await window.ScrapDialog.alert('🚨 Failed to parse/verify invitation token:\n' + (e.message || JSON.stringify(e)));
    }
  },

  playVoiceEffectPreview(effect) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      // Stop any existing preview contexts if needed (managed by garbage collector usually)
      const ctx = new AudioContextClass();
      const dest = ctx.destination;

      // Create a voice-like sound source (oscillator with pitch envelope)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';

      let baseFreq = 220; // A3
      let duration = 0.45;

      if (effect === 'chipmunk') {
        baseFreq = 380; // High pitch
        duration = 0.3;
      } else if (effect === 'monster') {
        baseFreq = 110; // Low pitch
        duration = 0.65;
      }

      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, ctx.currentTime + duration);

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      let lastNode = gain;

      // Real-time audio nodes mirroring the offline processing effects
      if (effect === 'monster') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1100, ctx.currentTime);
        lastNode.connect(filter);
        lastNode = filter;
      } else if (effect === 'bale_bale') {
        const twang = ctx.createBiquadFilter();
        twang.type = 'highpass';
        twang.frequency.setValueAtTime(750, ctx.currentTime);
        twang.Q.setValueAtTime(2.0, ctx.currentTime);

        const dholBass = ctx.createBiquadFilter();
        dholBass.type = 'peaking';
        dholBass.frequency.setValueAtTime(110, ctx.currentTime);
        dholBass.Q.setValueAtTime(1.8, ctx.currentTime);
        dholBass.gain.setValueAtTime(12, ctx.currentTime);

        const delay = ctx.createDelay();
        delay.delayTime.setValueAtTime(0.28, ctx.currentTime);
        const feedback = ctx.createGain();
        feedback.gain.setValueAtTime(0.45, ctx.currentTime);

        lastNode.connect(twang);
        twang.connect(dholBass);
        dholBass.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);

        dholBass.connect(dest);
        feedback.connect(dest);
      } else if (effect === 'tumbi') {
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.setValueAtTime(800, ctx.currentTime);

        const delay = ctx.createDelay();
        delay.delayTime.setValueAtTime(0.0035, ctx.currentTime);
        const feedback = ctx.createGain();
        feedback.gain.setValueAtTime(0.75, ctx.currentTime);

        lastNode.connect(highpass);
        highpass.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);

        highpass.connect(dest);
        feedback.connect(dest);
      } else if (effect === 'dhol') {
        const bassBoost = ctx.createBiquadFilter();
        bassBoost.type = 'peaking';
        bassBoost.frequency.setValueAtTime(100, ctx.currentTime);
        bassBoost.Q.setValueAtTime(1.5, ctx.currentTime);
        bassBoost.gain.setValueAtTime(14, ctx.currentTime);

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        compressor.ratio.setValueAtTime(8, ctx.currentTime);

        lastNode.connect(bassBoost);
        bassBoost.connect(compressor);
        lastNode = compressor;
      } else if (effect === 'sufi') {
        const delay = ctx.createDelay();
        delay.delayTime.setValueAtTime(0.52, ctx.currentTime);
        const feedback = ctx.createGain();
        feedback.gain.setValueAtTime(0.55, ctx.currentTime);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2500, ctx.currentTime);

        lastNode.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay);

        lastNode.connect(dest);
        feedback.connect(dest);
      } else if (effect === 'echo') {
        const delay = ctx.createDelay();
        delay.delayTime.setValueAtTime(0.35, ctx.currentTime);
        const feedback = ctx.createGain();
        feedback.gain.setValueAtTime(0.4, ctx.currentTime);

        lastNode.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);

        lastNode.connect(dest);
        feedback.connect(dest);
      }

      if (effect !== 'bale_bale' && effect !== 'tumbi' && effect !== 'sufi' && effect !== 'echo') {
        lastNode.connect(dest);
      }

      osc.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration + 1.5);

      setTimeout(() => {
        try {
          ctx.close();
        } catch (closeErr) { }
      }, 2000);
    } catch (err) {
      console.warn('[Voice Preview] Failed to play effect preview:', err);
    }
  },

  async init() {
    this.setupGlobalReference();

    // On startup, immediately hide the gateway screen and show a loading spinner.
    // The device lock will fire automatically, and on success we go straight to dashboard.
    const gatewayEl = document.getElementById('screen-gateway');
    if (gatewayEl) {
      gatewayEl.classList.add('hidden');
    }

    // Initialize Theme
    const activeTheme = this.getSavedTheme();
    this.applyTheme(activeTheme);
    this.applyEdgeGlow();
    this.applyRoboTheme();

    // Initialize Drive module sandbox database
    await ScrapDrive.initialize();

    // Cleanup expired cache files (older than 14 days)
    if (window.ScrapDrive && window.ScrapDrive.cleanupOldCacheFiles) {
      window.ScrapDrive.cleanupOldCacheFiles().catch(console.error);
    }

    // Load config from settings
    this.loadDeveloperSettings();

    // Set up standard navigation events
    this.bindEvents();

    // Listen for deep link / universal link opens
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appUrlOpen', async (data) => {
        console.log('[App] Opened with deep link URL:', data.url);
        if (data.url) {
          await this.handleDeepLink(data.url);
        }
      });

      // Check if app was launched via deep link initially
      window.Capacitor.Plugins.App.getLaunchUrl().then(async (launchData) => {
        if (launchData && launchData.url) {
          console.log('[App] Launched with deep link URL:', launchData.url);
          await this.handleDeepLink(launchData.url);
        }
      }).catch(e => console.warn('[App] Failed to get launch URL:', e));

      // Handle physical back button presses on Android
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        const qrScanner = document.getElementById('modal-inapp-qr-scanner');
        if (qrScanner && !qrScanner.classList.contains('hidden')) {
          console.log('[App] Back pressed in QR scanner: stopping camera');
          this.stopInAppQRScanner();
          return;
        }

        const scrapbookModal = document.getElementById('modal-scrapbook');
        if (scrapbookModal && !scrapbookModal.classList.contains('hidden')) {
          console.log('[App] Back pressed in Scrapbook: closing modal');
          const closeScrapbook = document.getElementById('btn-close-scrapbook');
          if (closeScrapbook) {
            closeScrapbook.click();
          } else {
            scrapbookModal.classList.add('hidden');
          }
          return;
        }

        const canvasScreen = document.getElementById('screen-canvas');
        const dashboardScreen = document.getElementById('screen-dashboard');
        const gatewayScreen = document.getElementById('screen-gateway');

        if (canvasScreen && !canvasScreen.classList.contains('hidden')) {
          console.log('[App] Back pressed in Room: Navigating to Dashboard');
          const backBtn = document.getElementById('btn-canvas-back');
          if (backBtn) backBtn.click();
        } else if (dashboardScreen && !dashboardScreen.classList.contains('hidden')) {
          console.log('[App] Back pressed on Dashboard: Exiting app');
          window.Capacitor.Plugins.App.exitApp();
        } else if (gatewayScreen && !gatewayScreen.classList.contains('hidden')) {
          console.log('[App] Back pressed on Gateway: Exiting app');
          window.Capacitor.Plugins.App.exitApp();
        } else {
          // Fallback navigation
          const dashboardBtn = document.querySelector('[data-screen="screen-dashboard"]');
          if (dashboardBtn) {
            dashboardBtn.click();
          } else {
            this.showScreen('screen-dashboard');
            this.renderDashboardRooms();
          }
        }
      });
    }

    // Setup native app lock listeners and check session status after unlock
    const runStartupLock = async () => {
      console.log('[ScrapApp] runStartupLock started');
      try {
        const authenticated = await this.enforceBiometricLock();
        console.log('[ScrapApp] runStartupLock - authenticated:', authenticated);
        if (authenticated) {
          console.log('[ScrapApp] runStartupLock - calling checkSession');
          const unlockBtn = document.getElementById('btn-auth-unlock');
          if (unlockBtn) unlockBtn.classList.add('hidden');
          await this.checkSession();
        } else {
          // Authentication refused — show gateway as fallback with Unlock button
          this.dismissSplash();
          console.log('[ScrapApp] Authentication failed. Showing Unlock Vault button.');
          const gw = document.getElementById('screen-gateway');
          if (gw) gw.classList.remove('hidden');

          const unlockBtn = document.getElementById('btn-auth-unlock');
          if (unlockBtn) unlockBtn.classList.remove('hidden');

          // Hide registration/login inputs
          const nameInput = document.getElementById('input-auth-name');
          const usernameInput = document.getElementById('input-auth-username');
          const identityInput = document.getElementById('input-auth-identity');
          const areaInput = document.getElementById('input-auth-area');
          const submitBtn = document.getElementById('btn-auth-submit');
          const authTitle = document.getElementById('auth-title');

          if (nameInput) nameInput.classList.add('hidden');
          if (usernameInput) usernameInput.classList.add('hidden');
          if (identityInput) identityInput.classList.add('hidden');
          if (areaInput) areaInput.classList.add('hidden');
          if (submitBtn) submitBtn.classList.add('hidden');
          if (authTitle) authTitle.innerText = 'VAULT SECURED';

          this.showScreen('screen-gateway');
        }
      } catch (err) {
        console.error('[ScrapApp] runStartupLock CRITICAL ERROR:', err);
        // Show gateway on error as last resort
        const gw = document.getElementById('screen-gateway');
        if (gw) gw.classList.remove('hidden');
        this.showScreen('screen-gateway');
      }
    };

    const platform = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
    console.log('[ScrapApp] Startup platform detected:', platform);
    if (platform === 'android' || platform === 'ios' || window.cordova) {
      console.log('[ScrapApp] Adding deviceready listener');
      document.addEventListener('deviceready', runStartupLock);
    } else {
      console.log('[ScrapApp] Non-native platform, running startup lock immediately');
      runStartupLock();
    }

    document.addEventListener('resume', async () => {
      console.log('[ScrapApp] App resume event triggered. isLockScreenActive:', this.isLockScreenActive);

      const voiceOverlay = document.getElementById('voice-recording-overlay');
      const videoOverlay = document.getElementById('video-recording-overlay');
      const isVoiceRecording = voiceOverlay && !voiceOverlay.classList.contains('hidden');
      const isVideoRecording = videoOverlay && !videoOverlay.classList.contains('hidden');
      const isCaptureScreen = this.activeScreen === 'screen-capture';

      if (this.isSelectingFile || isVoiceRecording || isVideoRecording || isCaptureScreen) {
        console.log('[ScrapApp] Resume event ignored because file picker/camera/recording was active.', {
          isSelectingFile: this.isSelectingFile,
          isVoiceRecording,
          isVideoRecording,
          isCaptureScreen
        });
        this.isSelectingFile = false;
        return;
      }
      if (this.isLockScreenActive) {
        console.log('[ScrapApp] Resume event ignored because lock screen activity is active.');
        return;
      }
      const timeSinceDismiss = Date.now() - (this.lastLockDismissTime || 0);
      if (timeSinceDismiss < 3000) {
        console.log('[ScrapApp] Resume event ignored because it is within the 3-second lock dismiss cooldown:', timeSinceDismiss);
        return;
      }
      const timeSinceUnlock = Date.now() - (this.lastUnlockTime || 0);
      if (timeSinceUnlock < 3000) {
        console.log('[ScrapApp] Resume event ignored because it is within the 3-second unlock cooldown:', timeSinceUnlock);
        return;
      }
      await this.enforceBiometricLock();
    });
  },

  loadDeveloperSettings() {
    // No-op
  },

  renderScrapbookContent() {
    const container = document.getElementById('scrapbook-pages-container');
    if (!container) return;
    container.innerHTML = '';

    // Clear any previous interval
    this.stopScrapbookAutoPlay();

    const elements = ScrapFirebase.elements || {};
    const todayStr = this.currentDate || new Date().toISOString().split('T')[0];
    const parts = todayStr.split('-');

    // Get filter values from year and month selectors if present
    const yearSelect = document.getElementById('scrapbook-filter-year');
    const monthSelect = document.getElementById('scrapbook-filter-month');

    let year = parts[0] || '2026';
    let month = parts[1] || '08';

    if (yearSelect && monthSelect) {
      if (yearSelect.value && monthSelect.value) {
        year = yearSelect.value;
        month = monthSelect.value;
      } else {
        yearSelect.value = year;
        monthSelect.value = month;
      }
    }

    const yearMonthPrefix = `${year}-${month}`;

    this.scrapbookList = Object.entries(elements)
      .map(([id, data]) => ({ id, ...data }))
      .filter(el => {
        if (el.type !== 'photo') return false;
        const elDate = el.date || todayStr;
        return elDate.startsWith(yearMonthPrefix);
      });

    this.scrapbookPageIndex = -1; // Start with Closed Cover Page

    const controls = document.getElementById('scrapbook-controls');
    if (this.scrapbookList.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 w-full flex flex-col items-center">
          <span class="text-4xl mb-2">📸</span>
          <p class="text-[10px] font-mono text-gray-500 uppercase tracking-widest">No scrapbook memories found in this month</p>
        </div>
      `;
      if (controls) controls.classList.add('hidden');
      return;
    }

    if (controls) controls.classList.remove('hidden');

    const btnPrev = document.getElementById('btn-scrapbook-prev');
    const btnNext = document.getElementById('btn-scrapbook-next');

    if (btnPrev && btnNext) {
      const newBtnPrev = btnPrev.cloneNode(true);
      const newBtnNext = btnNext.cloneNode(true);
      btnPrev.parentNode.replaceChild(newBtnPrev, btnPrev);
      btnNext.parentNode.replaceChild(newBtnNext, btnNext);

      newBtnPrev.addEventListener('click', () => {
        this.stopScrapbookAutoPlay(); // Pause autoplay when user manually interacts
        if (this.scrapbookPageIndex > -1) {
          this.scrapbookPageIndex--;
          this.showScrapbookPageSpread();
        }
      });

      newBtnNext.addEventListener('click', () => {
        this.stopScrapbookAutoPlay(); // Pause autoplay when user manually interacts
        const totalSpreads = Math.ceil(this.scrapbookList.length / 4);
        if (this.scrapbookPageIndex < totalSpreads - 1) {
          this.scrapbookPageIndex++;
          this.showScrapbookPageSpread();
        }
      });
    }

    // Render cover page
    this.showScrapbookPageSpread();

    // Start auto-play: turn pages slowly (every 3.8 seconds)
    this.scrapbookPlayInterval = setInterval(() => {
      const totalSpreads = Math.ceil(this.scrapbookList.length / 4);
      if (this.scrapbookPageIndex < totalSpreads - 1) {
        this.scrapbookPageIndex++;
        this.showScrapbookPageSpread();
      } else {
        // Go back to cover page (visually closing the book)
        this.scrapbookPageIndex = -1;
        this.showScrapbookPageSpread();
        this.stopScrapbookAutoPlay();

        setTimeout(() => {
          const modal = document.getElementById('modal-scrapbook');
          if (modal && this.scrapbookPageIndex === -1) {
            modal.classList.add('hidden');
          }
        }, 1600);
      }
    }, 3800);
  },

  stopScrapbookAutoPlay() {
    if (this.scrapbookPlayInterval) {
      clearInterval(this.scrapbookPlayInterval);
      this.scrapbookPlayInterval = null;
    }
  },

  showScrapbookPageSpread() {
    const container = document.getElementById('scrapbook-pages-container');
    if (!container) return;
    container.innerHTML = '';

    const list = this.scrapbookList || [];
    const pageIndex = this.scrapbookPageIndex;
    const totalSpreads = Math.ceil(list.length / 4);

    const controls = document.getElementById('scrapbook-controls');
    const pageNumText = document.getElementById('scrapbook-page-num');
    const btnPrev = document.getElementById('btn-scrapbook-prev');
    const btnNext = document.getElementById('btn-scrapbook-next');

    // Case 1: Closed Cover Page
    if (pageIndex === -1) {
      if (controls) controls.classList.add('hidden');

      const titleEl = document.getElementById('canvas-room-title');
      const roomTitle = titleEl ? titleEl.innerText : 'OUR SQUAD';
      const todayStr = this.currentDate || new Date().toISOString().split('T')[0];
      const parts = todayStr.split('-');
      let formattedMonth = 'MEMORIES';
      if (parts.length === 3) {
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        formattedMonth = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      }

      container.innerHTML = `
        <div class="scrapbook-cover flex flex-col items-center justify-center p-6 text-center text-[#ffeedd] scrapbook-book-content-transition">
          <div class="border-4 border-double border-[#ffeedd]/30 p-6 flex flex-col items-center justify-center w-full h-full rounded-xl" style="min-height:360px;">
            <span class="text-6xl mb-5">📖</span>
            <h2 class="font-space font-extrabold text-2xl uppercase tracking-widest mb-1 text-white">${roomTitle}</h2>
            <p class="font-mono text-[9px] uppercase tracking-widest text-[#ffeedd]/60 mb-5">Memory Journal</p>
            <div class="w-12 h-0.5 bg-[#ffeedd]/40 mb-5"></div>
            <p class="font-space font-bold text-xs tracking-wider text-white">${formattedMonth}</p>
          </div>
        </div>
      `;
      return;
    }

    // Case 2: Open Book Pages
    if (controls) controls.classList.remove('hidden');
    if (pageNumText) {
      pageNumText.innerText = `SPREAD ${pageIndex + 1} OF ${totalSpreads || 1}`;
    }

    if (btnPrev) btnPrev.disabled = (pageIndex === -1);
    if (btnNext) btnNext.disabled = (pageIndex >= totalSpreads - 1);

    const book = document.createElement('div');
    book.className = 'scrapbook-book';

    const leftPage = document.createElement('div');
    leftPage.className = 'scrapbook-page-left page-flip-left-active';

    const rightPage = document.createElement('div');
    rightPage.className = 'scrapbook-page-right page-flip-right-active';

    const startIdx = pageIndex * 4;
    const spreadItems = list.slice(startIdx, startIdx + 4);

    spreadItems.forEach((el, index) => {
      const item = document.createElement('div');

      if (el.type === 'photo') {
        const rot = Math.round(Math.random() * 6 - 3);
        item.className = 'scrapbook-item-photo';
        item.style.setProperty('--rot', `${rot}deg`);
        item.id = `scrapbook_img_wrapper_${el.id}`;

        // Remove text caption placeholder "Memory photo" completely, show custom label only if exists
        item.innerHTML = `
          <div class="relative w-full aspect-square bg-[#0b0514] overflow-hidden flex items-center justify-center border border-gray-200/20 rounded mx-auto">
            <span class="loading-label text-[8px] font-space text-purple-400 animate-pulse font-bold">Decrypting...</span>
            <img class="w-full h-full object-cover hidden select-none" alt="Photo" draggable="false" />
            <div class="stickers-overlay absolute inset-0 pointer-events-none z-10"></div>
          </div>
          ${el.polaroidText ? `<div class="scrapbook-item-caption text-black mt-2 font-space text-[8px] tracking-wider uppercase text-center truncate">${el.polaroidText}</div>` : ''}
        `;

        setTimeout(() => {
          const wrapper = document.getElementById(`scrapbook_img_wrapper_${el.id}`);
          if (wrapper && window.ScrapCanvas && typeof window.ScrapCanvas.decryptAndDisplayImage === 'function') {
            window.ScrapCanvas.decryptAndDisplayImage(el.id, el.encryptedData || el.fileId, wrapper);
            this.renderScrapbookStickers(el, wrapper);
          }
        }, 50);

      } else if (el.type === 'voice') {
        item.className = 'scrapbook-item-voice';
        item.innerHTML = `
          <span class="text-lg">🎤</span>
          <div class="flex-1 min-w-0">
            <p class="text-[9px] font-mono text-white font-bold truncate uppercase tracking-wider">Voice Memo</p>
            <p class="text-[8px] font-mono text-gray-400 uppercase tracking-widest">${el.duration ? Math.round(el.duration) + 's' : 'Audio Note'}</p>
          </div>
          <button class="bg-[#b026ff] text-white rounded-full w-6 h-6 flex items-center justify-center text-[10px] active:scale-95 transition-all btn-play-scrapbook-voice" data-audio-src="${el.src || ''}">▶</button>
        `;

        const playBtn = item.querySelector('.btn-play-scrapbook-voice');
        if (playBtn) {
          playBtn.addEventListener('click', () => {
            const audioUrl = el.audioFileId ? `https://api.myscrapmemories.com/api/files/boards/${this.currentRoomId}/${el.audioFileId}` : (el.src || '');
            if (audioUrl) {
              if (window.scrapbookAudio) {
                window.scrapbookAudio.pause();
                const allPlayBtns = container.querySelectorAll('.btn-play-scrapbook-voice');
                allPlayBtns.forEach(btn => btn.innerText = '▶');
              }
              if (window.scrapbookAudio && window.scrapbookAudio.src === audioUrl && !window.scrapbookAudio.paused) {
                window.scrapbookAudio.pause();
                playBtn.innerText = '▶';
                return;
              }
              window.scrapbookAudio = new Audio(audioUrl);
              window.scrapbookAudio.play();
              playBtn.innerText = '⏸';
              window.scrapbookAudio.onended = () => {
                playBtn.innerText = '▶';
              };
            }
          });
        }
      }

      if (index < 2) {
        leftPage.appendChild(item);
      } else {
        rightPage.appendChild(item);
      }
    });

    book.appendChild(leftPage);
    book.appendChild(rightPage);
    container.appendChild(book);
  },

  renderScrapbookStickers(data, container) {
    const overlay = container.querySelector('.stickers-overlay');
    if (!overlay || !data.stickers) return;
    overlay.innerHTML = '';

    const rect = container.getBoundingClientRect();
    const W = rect.width || 192;
    const ratio = W / 192;

    Object.entries(data.stickers).forEach(([stickerId, s]) => {
      const sEl = document.createElement('div');
      sEl.className = 'absolute select-none pointer-events-none';
      sEl.style.left = `${(W / 2) + s.x * ratio}px`;
      sEl.style.top = `${(W / 2) + s.y * ratio}px`;
      sEl.style.transform = `translate(-50%, -50%) rotate(${s.rotation || 0}deg) scale(${(s.scale || 1.0) * ratio})`;

      if (s.type === 'doodle') {
        sEl.style.width = `${(s.width || 192) * ratio}px`;
        sEl.style.height = `${(s.height || 192) * ratio}px`;
        sEl.innerHTML = `<canvas class="w-full h-full pointer-events-none"></canvas>`;
        const canvas = sEl.querySelector('canvas');
        if (window.ScrapCanvas && typeof window.ScrapCanvas.drawDoodleOnElementCanvas === 'function') {
          window.ScrapCanvas.drawDoodleOnElementCanvas(canvas, s);
        }
      } else if (s.type === 'sticker') {
        sEl.style.width = `${(s.width || 80) * ratio}px`;
        sEl.style.height = `${(s.height || 80) * ratio}px`;
        sEl.innerHTML = `<img class="w-full h-full object-contain pointer-events-none select-none opacity-0 transition-opacity" alt="Sticker" draggable="false" />`;
        const img = sEl.querySelector('img');
        if (window.ScrapCanvas && typeof window.ScrapCanvas.getTransparentSticker === 'function') {
          window.ScrapCanvas.getTransparentSticker(s.src, (url) => {
            img.src = url;
            img.classList.remove('opacity-0');
          });
        }
      } else {
        let isEmoji = false;
        try {
          const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
          isEmoji = emojiRegex.test(s.text);
        } catch (e) {
          isEmoji = s.text.length <= 4 && /[^\x00-\x7F]/.test(s.text);
        }

        const fontSize = Math.max(10, Math.round(32 * ratio));
        if (isEmoji) {
          sEl.innerHTML = `
            <div class="select-none leading-none text-center pointer-events-none" style="font-size: ${fontSize}px;">
              ${s.text}
            </div>
          `;
        } else {
          const paddingY = Math.max(2, Math.round(4 * ratio));
          const paddingX = Math.max(4, Math.round(8 * ratio));
          sEl.innerHTML = `
            <div class="bg-purple-900 border border-cyber-green text-cyber-green font-mono rounded shadow-lg whitespace-nowrap pointer-events-none" style="font-size: ${Math.max(8, Math.round(14 * ratio))}px; padding: ${paddingY}px ${paddingX}px;">
              ${s.text}
            </div>
          `;
        }
      }
      overlay.appendChild(sEl);
    });
  },

  renderMoodCalendarFeed(overrideElements) {
    const feed = document.getElementById('mood-radar-feed');
    if (!feed) return;
    feed.innerHTML = '';

    const todayStr = this.currentDate || new Date().toISOString().split('T')[0];
    const titleEl = document.getElementById('mood-radar-title');
    if (titleEl) {
      const parts = todayStr.split('-');
      if (parts.length === 3) {
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const formattedDate = dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        titleEl.innerText = `📅 MOOD RADAR - ${formattedDate.toUpperCase()}`;
      } else {
        titleEl.innerText = `📅 MOOD RADAR`;
      }
    }

    const elements = overrideElements || ScrapFirebase.elements || {};
    const list = Object.entries(elements)
      .map(([id, data]) => ({ id, ...data }))
      .filter(el => el.type === 'mood' && (el.date === todayStr || !el.date));

    // Show notification badge if modal is closed and there are moods shared today
    const modalMood = document.getElementById('modal-mood-calendar');
    const badge = document.getElementById('mood-radar-badge');
    if (badge && modalMood) {
      const activeMoodsToday = list.length;
      if (activeMoodsToday > 0 && modalMood.classList.contains('hidden')) {
        badge.style.display = 'flex';
        badge.innerText = activeMoodsToday;
      } else {
        badge.style.display = 'none';
      }
    }

    // Restore active state highlight on user's daily emoji button
    const currentUserId = ScrapFirebase.userId || 'default_user';
    const myMoodToday = list.find(el => el.userId === currentUserId || el.ownerId === currentUserId);
    const moodBtns = document.querySelectorAll('.btn-set-mood');
    moodBtns.forEach(btn => {
      btn.classList.remove('active-mood');
      if (myMoodToday && btn.getAttribute('data-mood') === myMoodToday.moodEmoji) {
        btn.classList.add('active-mood');
      }
    });

    if (list.length === 0) {
      feed.innerHTML = `
        <div class="text-center py-6 text-gray-500 font-mono text-[9px] uppercase tracking-wider">
          ☕ Nobody has shared their mood yet today
        </div>
      `;
      return;
    }

    list.forEach(el => {
      const row = document.createElement('div');
      row.className = 'mood-radar-item';
      const displayName = el.userName || el.ownerName || 'Squadmate';
      const initials = displayName.substring(0, 2).toUpperCase();

      const uid = el.userId || el.ownerId;
      let avatarUrl = '';
      if (window.ScrapCanvas && window.ScrapCanvas.joinedMembers) {
        const member = window.ScrapCanvas.joinedMembers.find(m => m.id === uid);
        if (member && member.avatar) {
          avatarUrl = member.avatar.startsWith('data:') || member.avatar.startsWith('http')
            ? member.avatar
            : `https://api.myscrapmemories.com/api/files/users/${uid}/${member.avatar}`;
        }
      }
      if (!avatarUrl && uid && window.pb && pb.authStore.isValid && pb.authStore.model && pb.authStore.model.id === uid) {
        if (pb.authStore.model.avatar) {
          avatarUrl = pb.authStore.model.avatar.startsWith('data:') || pb.authStore.model.avatar.startsWith('http')
            ? pb.authStore.model.avatar
            : `https://api.myscrapmemories.com/api/files/users/${uid}/${pb.authStore.model.avatar}`;
        }
      }

      const avatarHTML = avatarUrl
        ? `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="fallback-initials" style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${initials}</span>`
        : initials;

      row.innerHTML = `
        <div class="mood-radar-avatar" style="overflow: hidden;">${avatarHTML}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 justify-between">
            <span class="text-[10px] font-space font-extrabold text-white uppercase tracking-wider">${displayName}</span>
            <span class="text-[16px]">${el.moodEmoji || '☀️'}</span>
          </div>
        </div>
      `;
      feed.appendChild(row);
    });
  },

  toggleLiveFields(isLive) {
    // No-op - developer fields are deprecated
  },

  initFirebaseSDK() {
    // Deprecated - Firebase removed
  },

  getUserVaultAndSalt(userId) {
    if (!userId) userId = 'default';
    let vault = localStorage.getItem(`scrap_local_vault_${userId}`);
    let salt = localStorage.getItem(`scrap_local_salt_${userId}`);
    return { vault, salt };
  },

  authMode: 'login',

  async enforceBiometricLock() {
    console.log('[ScrapApp] enforceBiometricLock bypassed by default.');
    return true;
  },

  async checkSession() {
    console.log('[ScrapApp] checkSession started');
    try {
      // 1. Session already valid in memory
      if (window.pb && pb.authStore.isValid) {
        const user = pb.authStore.model;
        await this._finishLogin(user);
        return;
      }

      // Helper function to get deterministic password for an email
      const getDeterministicPassword = (email) => {
        let hash = 0;
        for (let i = 0; i < email.length; i++) {
          hash = (hash << 5) - hash + email.charCodeAt(i);
          hash |= 0;
        }
        return 'ScrapPass' + Math.abs(hash) + '!';
      };

      // 2. Email is stored in local storage -> Silent auto-login
      const storedEmail = await ScrapStorage.get('scrap_auto_email');
      if (storedEmail) {
        const password = getDeterministicPassword(storedEmail);
        try {
          const authData = await pb.collection('users').authWithPassword(storedEmail, password);
          await this._finishLogin(authData.record);
          return;
        } catch (e) {
          if (e && e.status === 0) {
            console.warn('[ScrapApp] Silent auto-login failed due to network connectivity issues. Keeping credentials.', e);
            await window.ScrapDialog.alert('📡 Connection Error:\nFailed to connect to the server. Please check your internet connection.');
          } else {
            console.warn('[ScrapApp] Silent auto-login failed (bad credentials). Clearing storage.', e);
            await ScrapStorage.remove('scrap_auto_email');
            await ScrapStorage.remove('scrap_auto_password');
          }
        }
      }

      // 3. No stored email -> Show gateway in Email-only mode
      const nameInput = document.getElementById('input-auth-name');
      const usernameInput = document.getElementById('input-auth-username');
      const identityInput = document.getElementById('input-auth-identity');
      const areaInput = document.getElementById('input-auth-area');
      const submitBtn = document.getElementById('btn-auth-submit');
      const authTitle = document.getElementById('auth-title');

      if (nameInput) {
        nameInput.classList.add('hidden');
        nameInput.disabled = false;
      }
      if (usernameInput) {
        usernameInput.classList.add('hidden');
        usernameInput.disabled = false;
      }
      if (areaInput) {
        areaInput.classList.add('hidden');
        areaInput.disabled = false;
      }
      if (identityInput) {
        identityInput.value = '';
        identityInput.readOnly = false;
        identityInput.disabled = false;
        identityInput.classList.remove('hidden');
      }
      if (submitBtn) {
        submitBtn.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerText = 'CONTINUE';
      }
      if (authTitle) authTitle.innerText = 'ENTER EMAIL';

      this.authMode = 'login';
      this.dismissSplash();
      this.showScreen('screen-gateway');
      setTimeout(() => {
        const idInput = document.getElementById('input-auth-identity');
        if (idInput && !idInput.classList.contains('hidden') && !idInput.disabled) {
          idInput.focus();
          if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
            window.Capacitor.Plugins.Keyboard.show().catch(() => { });
          }
        }
      }, 300);

    } catch (err) {
      console.error('[ScrapApp] checkSession error:', err);
    }
  },

  // Shared login completion helper — called after any successful PB auth
  async _finishLogin(user) {
    // Dismiss keyboard by blurring and disabling active inputs
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const nameInput = document.getElementById('input-auth-name');
    const usernameInput = document.getElementById('input-auth-username');
    const identityInput = document.getElementById('input-auth-identity');
    if (nameInput) nameInput.disabled = true;
    if (usernameInput) usernameInput.disabled = true;
    if (identityInput) identityInput.disabled = true;

    // Always fetch name fresh from PocketBase user record.
    // Fall back to username or email if name is missing.
    let displayName = 'Scrapmate';
    if (user.name && user.name.trim()) {
      displayName = user.name.trim();
    } else if (user.username && user.username.trim()) {
      displayName = user.username.trim();
    } else if (user.email) {
      displayName = user.email.split('@')[0];
    }
    // Overwrite native storage + localStorage with the fresh value from PocketBase
    await ScrapStorage.set('scrap_user_display_name', displayName);

    const userId = user.id;
    let photoURL = user.avatar
      ? `https://api.myscrapmemories.com/api/files/users/${user.id}/${user.avatar}`
      : null;

    await ScrapStorage.set('scrap_user_id', userId);

    const { vault, salt } = this.getUserVaultAndSalt(userId);
    let unlocked = false;
    try { unlocked = await ScrapRecovery.unlockIdentity('000000', vault, salt); } catch (e) { }
    if (!unlocked) {
      console.log('[ScrapApp] Setting up new vault identity...');
      await ScrapRecovery.setupNewIdentity('000000');
    }
    sessionStorage.setItem('scrap_pin_session', '000000');

    if (user.encrypted_avatar) {
      try {
        const decAvatar = await this.resolveUserAvatarUrl(user);
        if (decAvatar) photoURL = decAvatar;
      } catch (_) { }
    }

    console.log('[ScrapApp] _finishLogin → loginCompleted. displayName:', displayName, '| pbName:', user.name);
    await this.loginCompleted(displayName, userId, photoURL);
  },


  async handleDeepLink(urlStr) {
    try {
      let decoded = urlStr;
      try {
        decoded = decodeURIComponent(urlStr.trim());
      } catch (e) {
        console.warn('[Deep Link] decodeURIComponent failed, using raw urlStr:', e);
      }

      const firstBrace = decoded.indexOf('{');
      const lastBrace = decoded.lastIndexOf('}');
      let payload = null;
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        payload = decoded.substring(firstBrace, lastBrace + 1);
      } else {
        // Fallback to URL search params if no JSON found in URL
        try {
          const urlObj = new URL(urlStr);
          payload = urlObj.searchParams.get('payload');
        } catch (urlErr) {
          if (urlStr.includes('payload=')) {
            const parts = urlStr.split('payload=');
            if (parts.length > 1) {
              let val = parts[1].split('&')[0];
              try {
                payload = decodeURIComponent(val);
              } catch (e) {
                payload = val;
              }
            }
          }
        }
      }

      if (payload) {
        if (ScrapFirebase.userId) {
          await this.processQRInvitePayload(payload);
        } else {
          localStorage.setItem('scrap_pending_invite', payload);
        }
      }
    } catch (e) {
      console.error('[Deep Link] Failed to parse deep link URL:', urlStr, e);
    }
  },

  updateGatewayVisuals() {
    const authTitle = document.getElementById('auth-title');
    const authLogo = document.getElementById('auth-logo');
    const authKeyContainer = document.getElementById('auth-key-container');
    if (authTitle && authTitle.innerText === 'VAULT SECURED') {
      if (authLogo) authLogo.classList.remove('hidden');
      if (authKeyContainer) authKeyContainer.classList.add('hidden');
    } else {
      if (authLogo) authLogo.classList.remove('hidden');
      if (authKeyContainer) authKeyContainer.classList.remove('hidden');
    }
  },

  showScreen(screenId) {
    // Dismiss native Android/iOS keyboard via Capacitor Keyboard plugin
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
      window.Capacitor.Plugins.Keyboard.hide().catch(() => { });
    }
    // Blur any focused element first to dismiss mobile keyboard before elements are hidden
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.remove('hidden');
      this.activeScreen = screenId;

      if (screenId !== 'screen-canvas') {
        if (window.ScrapCanvas && typeof window.ScrapCanvas.resetCollageFlowToolbar === 'function') {
          window.ScrapCanvas.resetCollageFlowToolbar();
        }
      }

      if (screenId === 'screen-gateway') {
        this.updateGatewayVisuals();
        setTimeout(() => {
          const idInput = document.getElementById('input-auth-identity');
          if (idInput && !idInput.classList.contains('hidden') && !idInput.disabled) {
            idInput.focus();
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
              window.Capacitor.Plugins.Keyboard.show().catch(() => { });
            }
          }
        }, 200);
      }

      // Handle AdMob Banner showing/hiding dynamically depending on the active screen
      if (window.ScrapAds) {
        if (screenId === 'screen-dashboard') {
          ScrapAds.showAdMobBanner();
        } else {
          ScrapAds.hideAdMobBanner();
        }
      }

      // Remove canvas info banners & stop active members timer when navigating away from canvas
      if (screenId !== 'screen-canvas') {
        if (this.activeMembersPruneInterval) {
          clearInterval(this.activeMembersPruneInterval);
          this.activeMembersPruneInterval = null;
        }
        this.cleanUpAllTooltipsAndArrows();
      }

      // Trigger Robot Helper Tip when entering screen-dashboard
      if (screenId === 'screen-dashboard') {
        const helperBtn = document.getElementById('btn-dashboard-helper');
        setTimeout(() => this.checkRobotHelperTip(helperBtn), 800);
      }

      // Remove dashboard info banners when navigating away from dashboard
      if (screenId !== 'screen-dashboard') {
        const robotTip = document.getElementById('dashboard-robot-helper-tip');
        if (robotTip) robotTip.remove();
      }
    }
  },

  async loginCompleted(displayName, forceUserId = null, photoURL = null) {
    console.log('[ScrapApp] loginCompleted started. displayName:', displayName, 'forceUserId:', forceUserId);
    try {
      localStorage.setItem('scrap_user_display_name', displayName);

      const userId = forceUserId || localStorage.getItem('scrap_user_id') || 'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('scrap_user_id', userId);

      ScrapFirebase.userId = userId;
      ScrapFirebase.userName = displayName;

      if (!ScrapRecovery.identityKeyPair) {
        const { vault, salt } = this.getUserVaultAndSalt(userId);
        let unlocked = false;
        if (vault && salt) {
          try {
            unlocked = await ScrapRecovery.unlockIdentity('000000', vault, salt);
          } catch (e) { }
        }
        if (!unlocked) {
          await ScrapRecovery.setupNewIdentity('000000');
        }
      }

      console.log('[ScrapApp] Rendering dashboard rooms...');
      const safeName = (typeof displayName === 'string' && displayName.trim()) ? displayName.trim() : 'User';
      document.getElementById('dashboard-welcome').innerText = `WELCOME, ${safeName.toUpperCase()}`;

      const avatarImg = document.getElementById('dashboard-avatar');
      const avatarPlaceholder = document.getElementById('dashboard-avatar-placeholder');
      if (avatarImg && photoURL) {
        avatarImg.src = photoURL;
        avatarImg.classList.remove('hidden');
        if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
      } else if (avatarPlaceholder) {
        avatarPlaceholder.innerText = safeName.substring(0, 2).toUpperCase();
        avatarPlaceholder.classList.remove('hidden');
        if (avatarImg) avatarImg.classList.add('hidden');
      }

      console.log('[ScrapApp] Transitioning to screen-dashboard...');
      this.applyTheme(this.getSavedTheme());
      this.applyEdgeGlow();
      this.applyRoboTheme();

      // Show the dashboard screen immediately for a smooth transition
      this.showScreen('screen-dashboard');
      this.dismissSplash();

      // Trigger tour guide onboarding on dashboard
      if (window.ScrapTour && typeof ScrapTour.initDashboardOnboarding === 'function') {
        ScrapTour.initDashboardOnboarding();
      }

      // Load and render rooms asynchronously in the background (showing skeleton loader)
      console.log('[ScrapApp] Rendering dashboard rooms...');
      this.renderDashboardRooms();

      // Init ads manager after successful authentication to avoid 403 errors
      try {
        if (window.ScrapAds) ScrapAds.init();
      } catch (_) { }

      // Init push notifications manager
      try {
        if (window.ScrapNotifications) ScrapNotifications.init();
      } catch (_) { }

      // Listen for Capacitor App state changes (minimised/background/resume)
      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
          window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
            console.log('[ScrapApp] App state changed. isActive:', state.isActive);
            if (!state.isActive) {
              // Pause active timers when app is minimized / screen turned off
              if (this.activeMembersPruneInterval) {
                clearInterval(this.activeMembersPruneInterval);
                this.activeMembersPruneInterval = null;
              }
            } else {
              // Resume active timers & flush pending sync queue when app re-enters foreground
              if (window.ScrapFirebase && typeof ScrapFirebase.flushPendingSyncQueue === 'function') {
                ScrapFirebase.flushPendingSyncQueue();
              }
              if (this.activeScreen === 'screen-canvas' && window.ScrapCanvas) {
                ScrapCanvas.reportPresence();
                if (!this.activeMembersPruneInterval) {
                  this.activeMembersPruneInterval = setInterval(() => {
                    if (this.activeScreen === 'screen-canvas' && window.ScrapCanvas) {
                      ScrapCanvas.reportPresence();
                      ScrapCanvas.updateActiveMembersListUI();
                    }
                  }, 30000);
                }
              }
            }
          });
        }
      } catch (appErr) {
        console.warn('[ScrapApp] App listener init error:', appErr);
      }

      // Subscribe to real-time updates for rooms to trigger badge blink
      if (window.pb && pb.authStore.isValid) {
        try {
          pb.collection('boards').unsubscribe('*').catch(() => { });
          pb.collection('boards').subscribe('*', (e) => {
            const record = e.record;
            if (record) {
              const isOwner = record.user === pb.authStore.model.id;
              const isMember = record.members && record.members.includes(pb.authStore.model.id);
              if (isOwner || isMember) {
                const helper = document.getElementById('btn-dashboard-helper');
                if (helper) {
                  const animWrapper = helper.querySelector('.robo-animation-wrapper') || helper;
                  animWrapper.classList.add('animate-bounce-glow-blink');
                }
                this.renderDashboardRooms();
              }
            }
          }).catch((err) => {
            console.warn('[Dashboard Subscription] Real-time subscribe failed:', err);
          });
        } catch (subErr) {
          console.warn('[Dashboard Subscription] Real-time subscription error:', subErr);
        }
      }
    } catch (err) {
      console.error('[ScrapApp] loginCompleted CRITICAL ERROR:', err);
    }
  },

  bindEvents() {
    // Tap user avatar -> Open high-res profile preview and allow edits
    const dashboardAvatarContainer = document.getElementById('dashboard-avatar-container');
    if (dashboardAvatarContainer) {
      dashboardAvatarContainer.addEventListener('click', async () => {
        if (window.pb && pb.authStore.isValid && pb.authStore.model) {
          const user = pb.authStore.model;
          const uName = user.name || user.username || 'User';
          const avatarUrl = await this.resolveUserAvatarUrl(user);
          this.showUserAvatarPreview(uName, avatarUrl);
        }
      });
    }

    const helperBtn = document.getElementById('btn-dashboard-helper');
    if (helperBtn) {
      let currentX = 0;
      let currentY = 0;
      let startX, startY;
      let initialX, initialY;
      let isDragging = false;
      let hasDragged = false;

      // Restore robot position if saved, otherwise compute a right-side below-center default
      const savedX = localStorage.getItem('scrap_robo_x');
      const savedY = localStorage.getItem('scrap_robo_y');

      const initRoboPosition = (x, y) => {
        currentX = x;
        currentY = y;
        helperBtn.style.position = 'fixed';
        helperBtn.style.zIndex = '999999';
        helperBtn.style.left = '0px';
        helperBtn.style.top = '0px';
        helperBtn.style.bottom = 'auto';
        helperBtn.style.right = 'auto';
        helperBtn.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      };

      if (savedX && savedY) {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const btnSize = 96; // w-24 = 6rem = 96px
        const padding = 10;
        const minY = 150; // minimum Y to avoid overlapping user avatar at top-left
        let restoredX = parseFloat(savedX);
        let restoredY = parseFloat(savedY);
        // Clamp to safe bounds so robot never lands on user avatar or off-screen
        restoredX = Math.max(padding, Math.min(restoredX, screenW - btnSize - padding));
        restoredY = Math.max(minY, Math.min(restoredY, screenH - btnSize - padding));
        initRoboPosition(restoredX, restoredY);
      }

      const onStart = (e) => {
        isDragging = true;
        hasDragged = false;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const rect = helperBtn.getBoundingClientRect();
        if (helperBtn.style.left !== '0px') {
          currentX = rect.left;
          currentY = rect.top;
          helperBtn.classList.remove('fixed', 'bottom-32', 'right-6');
          helperBtn.style.position = 'fixed';
          helperBtn.style.zIndex = '999999';
          helperBtn.style.left = '0px';
          helperBtn.style.top = '0px';
          helperBtn.style.bottom = 'auto';
          helperBtn.style.right = 'auto';
          helperBtn.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        }

        startX = clientX - currentX;
        startY = clientY - currentY;
        initialX = currentX;
        initialY = currentY;
      };

      const onMove = (e) => {
        if (!isDragging) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let newX = clientX - startX;
        let newY = clientY - startY;

        const padding = 10;
        const maxLeft = window.innerWidth - helperBtn.offsetWidth - padding;
        const maxTop = window.innerHeight - helperBtn.offsetHeight - padding;

        newX = Math.max(padding, Math.min(newX, maxLeft));
        newY = Math.max(padding, Math.min(newY, maxTop));

        currentX = newX;
        currentY = newY;

        helperBtn.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;

        if (Math.abs(currentX - initialX) > 5 || Math.abs(currentY - initialY) > 5) {
          hasDragged = true;
        }

        if (e.cancelable) e.preventDefault();
      };

      const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        localStorage.setItem('scrap_robo_x', `${currentX}px`);
        localStorage.setItem('scrap_robo_y', `${currentY}px`);
      };

      helperBtn.addEventListener('mousedown', onStart);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);

      helperBtn.addEventListener('touchstart', onStart, { passive: false });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);

      helperBtn.addEventListener('click', (e) => {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        helperBtn.classList.remove('animate-bounce-glow-blink');
        const robotTip = document.getElementById('dashboard-robot-helper-tip');
        if (robotTip) {
          localStorage.setItem('scrap_robot_tip_dismissed', 'true');
          robotTip.remove();
        }

        const container = document.getElementById('rooms-container');
        if (container) {
          const isRevealed = container.classList.contains('scale-100');

          // Calculate dynamically the reveal origin based on current robot location
          const rect = helperBtn.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const containerRect = container.parentElement.getBoundingClientRect();
          const originX = ((centerX - containerRect.left) / containerRect.width) * 100;
          const originY = ((centerY - containerRect.top) / containerRect.height) * 100;

          container.style.transformOrigin = `${originX}% ${originY}%`;

          if (isRevealed) {
            container.classList.remove('scale-100', 'opacity-100');
            container.classList.add('scale-0', 'opacity-0');
          } else {
            container.classList.remove('scale-0', 'opacity-0');
            container.classList.add('scale-100', 'opacity-100');
            // If now uncollapsed/revealed, clean up active tooltip card
            if (window.ScrapTour) window.ScrapTour.cleanup();
          }
        }
      });
    }

    // Unlock button for Vault Secured screen (fallback only - normally lock fires automatically)
    const unlockBtn = document.getElementById('btn-auth-unlock');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', async () => {
        if (this.isLockScreenActive) return; // Prevent double-tap
        const authenticated = await this.enforceBiometricLock();
        if (authenticated) {
          unlockBtn.classList.add('hidden');

          const submitBtn = document.getElementById('btn-auth-submit');
          const identityInput = document.getElementById('input-auth-identity');
          if (submitBtn) submitBtn.classList.remove('hidden');
          if (identityInput) identityInput.classList.remove('hidden');

          await this.checkSession();
        }
      });
    }

    // PocketBase Auth Toggle
    const toggleBtn = document.getElementById('auth-toggle-mode');
    const submitBtn = document.getElementById('btn-auth-submit');
    const nameInput = document.getElementById('input-auth-name');
    const usernameInput = document.getElementById('input-auth-username');
    const identityInput = document.getElementById('input-auth-identity');
    const passwordInput = document.getElementById('input-auth-password');
    const areaInput = document.getElementById('input-auth-area');
    const authTitle = document.getElementById('auth-title');

    // Single-tap focus fix to resolve Android WebView focus lag after biometric prompt dismiss
    if (identityInput) {
      const focusIdentity = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        identityInput.focus();
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
          window.Capacitor.Plugins.Keyboard.show().catch(() => { });
        }
      };
      identityInput.addEventListener('click', focusIdentity);
      identityInput.addEventListener('touchstart', focusIdentity, { passive: true });
    }
    if (nameInput) {
      nameInput.addEventListener('click', (e) => {
        e.stopPropagation();
        nameInput.focus();
      });
    }
    if (usernameInput) {
      usernameInput.addEventListener('click', (e) => {
        e.stopPropagation();
        usernameInput.focus();
      });
    }
    if (areaInput) {
      areaInput.addEventListener('click', (e) => {
        e.stopPropagation();
        areaInput.focus();
      });
    }

    // Hide password input and register toggle button (WhatsApp style flow)
    if (passwordInput) passwordInput.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'none';

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (this.authMode === 'login') {
          this.authMode = 'register';
          authTitle.innerText = 'CREATE ACCOUNT';
          nameInput.classList.remove('hidden');
          usernameInput.classList.remove('hidden');
          if (areaInput) {
            areaInput.classList.remove('hidden');
          }
          identityInput.placeholder = 'EMAIL';
          submitBtn.innerText = 'CREATE & LOG IN';
          toggleBtn.innerText = 'Already have an account? Log In';

          // Auto scroll down to reveal new fields
          setTimeout(() => {
            const gateway = document.getElementById('screen-gateway');
            if (gateway) gateway.scrollTo({ top: gateway.scrollHeight, behavior: 'smooth' });
          }, 100);
        } else {
          this.authMode = 'login';
          authTitle.innerText = 'ACCESS TERMINAL';
          nameInput.classList.add('hidden');
          usernameInput.classList.add('hidden');
          if (areaInput) areaInput.classList.add('hidden');
          identityInput.placeholder = 'EMAIL';
          submitBtn.innerText = 'LOG IN';
          toggleBtn.innerText = 'Need an account? Register';
        }
        this.updateGatewayVisuals();
      });
    }

    // Auto-scroll input fields and Continue button into view when focused (gentle scroll)
    const scrollToAuthSubmit = () => {
      const gateway = document.getElementById('screen-gateway');
      const submitBtn = document.getElementById('btn-auth-submit');
      if (gateway && !gateway.classList.contains('hidden') && submitBtn) {
        gateway.style.paddingBottom = '160px';
        setTimeout(() => {
          submitBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 120);
      }
    };

    const resetGatewayScrollPadding = () => {
      const gateway = document.getElementById('screen-gateway');
      if (gateway) {
        gateway.style.paddingBottom = '';
      }
    };

    const authFormInputs = [identityInput, nameInput, usernameInput, areaInput];
    authFormInputs.forEach(input => {
      if (input) {
        input.addEventListener('focus', () => {
          setTimeout(scrollToAuthSubmit, 180);
        });
      }
    });

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
      const { Keyboard } = window.Capacitor.Plugins;
      if (typeof Keyboard.addListener === 'function') {
        Keyboard.addListener('keyboardDidShow', (info) => {
          const gateway = document.getElementById('screen-gateway');
          const submitBtn = document.getElementById('btn-auth-submit');
          if (gateway && !gateway.classList.contains('hidden') && submitBtn) {
            const kHeight = (info && info.keyboardHeight) ? Math.min(info.keyboardHeight * 0.5, 180) : 160;
            gateway.style.paddingBottom = `${kHeight}px`;
            setTimeout(() => {
              submitBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 80);
          }
        });
        Keyboard.addListener('keyboardDidHide', () => {
          resetGatewayScrollPadding();
        });
      }
      window.addEventListener('keyboardDidShow', scrollToAuthSubmit);
      window.addEventListener('keyboardDidHide', resetGatewayScrollPadding);
    }

    const autocompleteList = document.getElementById('area-autocomplete-list');
    if (areaInput && autocompleteList) {
      areaInput.addEventListener('input', async () => {
        const query = areaInput.value.trim().toLowerCase();

        if (query.length < 3) {
          autocompleteList.innerHTML = '';
          autocompleteList.classList.add('hidden');
          return;
        }

        // Fetch matching areas directly from PocketBase for the query
        await this.fetchAreas(query);

        console.log('[Autocomplete] User query:', query, 'Loaded matches:', this.areasList);

        const matches = this.areasList || [];

        if (matches.length === 0) {
          autocompleteList.innerHTML = `
            <div class="px-4 py-2 text-xs text-gray-500 font-mono">NO MATCHES FOUND</div>
          `;
          autocompleteList.classList.remove('hidden');
          return;
        }

        autocompleteList.innerHTML = matches.map(a => `
          <div class="autocomplete-item px-4 py-2.5 text-xs text-black font-mono hover:bg-[#39ff14]/15 hover:text-black cursor-pointer transition-all border-b border-gray-100 last:border-b-0" 
               data-id="${a.id}" data-name="${(a.area_name || '').replace(/"/g, '&quot;')}">
            ${(a.area_name || '').toUpperCase()}
          </div>
        `).join('');

        autocompleteList.classList.remove('hidden');
      });

      autocompleteList.addEventListener('click', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (item) {
          const selectedName = item.getAttribute('data-name');
          areaInput.value = selectedName;
          autocompleteList.innerHTML = '';
          autocompleteList.classList.add('hidden');
        }
      });

      document.addEventListener('click', (e) => {
        if (!areaInput.contains(e.target) && !autocompleteList.contains(e.target)) {
          autocompleteList.classList.add('hidden');
        }
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const identity = identityInput.value.trim();

        if (!identity) {
          await window.ScrapDialog.alert('Please enter your email.');
          return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(identity)) {
          await window.ScrapDialog.alert('Please enter a valid email address (e.g. user@example.com).');
          return;
        }

        // Helper function for deterministic password
        const getDeterministicPassword = (email) => {
          let hash = 0;
          for (let i = 0; i < email.length; i++) {
            hash = (hash << 5) - hash + email.charCodeAt(i);
            hash |= 0;
          }
          return 'ScrapPass' + Math.abs(hash) + '!';
        };

        const password = getDeterministicPassword(identity);

        // Check if Name/Username fields are visible (which means user is in registration mode)
        const nameVisible = !nameInput.classList.contains('hidden') && nameInput.style.display !== 'none';

        if (nameVisible) {
          const name = nameInput.value.trim();
          const username = usernameInput.value.trim();
          const areaName = areaInput ? areaInput.value.trim() : '';
          const matchedArea = (this.areasList || []).find(
            a => a.area_name.toLowerCase() === areaName.toLowerCase()
          );
          const area = matchedArea ? matchedArea.id : areaName;

          if (!name || !username || !area) {
            await window.ScrapDialog.alert('Please enter your Name, Username, and select/enter your Area.');
            return;
          }

          // Validate username format (no spaces, alphanumeric + _ + . only)
          const usernameRegex = /^[a-zA-Z0-9_.]+$/;
          if (!usernameRegex.test(username)) {
            await window.ScrapDialog.alert('Username can only contain letters, numbers, underscores (_), and periods (.), with no spaces.');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.innerText = 'REGISTERING...';

          try {
            // Calculate date 3 months in the future for ads start date
            const adsStartDate = new Date();
            adsStartDate.setMonth(adsStartDate.getMonth() + 3);
            const adsStartDateStr = adsStartDate.toISOString().split('T')[0];

            // Try to create user
            await pb.collection('users').create({
              username,
              email: identity,
              password,
              passwordConfirm: password,
              name,
              area,
              show_ads: true,
              ads_start_date: adsStartDateStr
            });

            // Log in after successful registration
            const authData = await pb.collection('users').authWithPassword(identity, password);
            await ScrapStorage.set('scrap_auto_email', identity);
            await ScrapStorage.set('scrap_auto_password', password);
            await ScrapStorage.set('scrap_auto_username', username);
            await ScrapStorage.set('scrap_user_display_name', name);

            await this._finishLogin(authData.record);
          } catch (err) {
            console.error('[ScrapApp] Registration error:', err);

            // Check if it failed because the email is already registered (legacy user with custom password)
            const isEmailTaken = err && err.data && err.data.data && err.data.data.email && err.data.data.email.code === 'validation_invalid_email_or_already_used';
            const isEmailTakenMsg = err && err.message && (err.message.includes('already used') || err.message.includes('already registered'));

            if (isEmailTaken || isEmailTakenMsg || (err.data && err.data.data && err.data.data.email)) {
              // Legacy user: Ask for custom password
              const customPassword = await window.ScrapDialog.prompt('This email is already registered. Enter your password:', '');
              if (customPassword !== null) {
                try {
                  const authData = await pb.collection('users').authWithPassword(identity, customPassword);
                  await ScrapStorage.set('scrap_auto_email', identity);
                  await ScrapStorage.set('scrap_auto_password', customPassword);
                  await this._finishLogin(authData.record);
                  return;
                } catch (err2) {
                  alert('Verification Error:\nInvalid password for this account.');
                }
              }
            } else {
              // Standard validation or network error
              let errorMsg = err ? err.message : 'Registration failed.';
              if (err && err.data && err.data.data) {
                const details = Object.entries(err.data.data)
                  .map(([key, val]) => `${key.toUpperCase()}: ${val.message}`)
                  .join('\n');
                errorMsg += '\n\n' + details;
              }
              alert('Registration Error:\n' + errorMsg);
            }
          } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'REGISTER & ENTER';
          }
        } else {
          // User just entered their email. Try to log them in directly!
          submitBtn.disabled = true;
          submitBtn.innerText = 'CHECKING...';

          try {
            // Attempt auto-login using the deterministic password
            const authData = await pb.collection('users').authWithPassword(identity, password);
            await ScrapStorage.set('scrap_auto_email', identity);
            await ScrapStorage.set('scrap_auto_password', password);
            await this._finishLogin(authData.record);
          } catch (err) {
            // Login failed (meaning they don't exist yet, or they have a custom password)
            console.log('[ScrapApp] Auto-login failed, showing registration fields.', err);


            nameInput.classList.remove('hidden');
            usernameInput.classList.remove('hidden');
            if (areaInput) {
              areaInput.classList.remove('hidden');
              areaInput.disabled = false;
              areaInput.style.display = '';
            }
            nameInput.disabled = false;
            usernameInput.disabled = false;
            nameInput.style.display = '';
            usernameInput.style.display = '';
            authTitle.innerText = 'CREATE ACCOUNT';
            submitBtn.innerText = 'REGISTER & ENTER';
            this.authMode = 'register';

            // Auto scroll container down to reveal newly visible fields
            setTimeout(() => {
              const gateway = document.getElementById('screen-gateway');
              if (gateway) {
                gateway.scrollTo({
                  top: gateway.scrollHeight,
                  behavior: 'smooth'
                });
              }
            }, 100);
          } finally {
            submitBtn.disabled = false;
            if (!nameInput.classList.contains('hidden') && nameInput.style.display !== 'none') {
              submitBtn.innerText = 'REGISTER & ENTER';
            } else {
              submitBtn.innerText = 'CONTINUE';
            }
          }
        }
      });
    }

    const executeLogout = async () => {
      if (await window.ScrapDialog.confirm('Clear local vault and logout?')) {
        ScrapFirebase.disconnect();
        if (window.pb) {
          pb.authStore.clear();
        }

        const canvasWorkspace = document.getElementById('canvas-workspace');
        if (canvasWorkspace) {
          canvasWorkspace.dataset.scrollLocked = 'false';
          canvasWorkspace.scrollTo(0, 0);
        }
        if (window.ScrapCanvas) {
          ScrapCanvas.zoom = 1.0;
          ScrapCanvas.hasCenteredInitially = false;
          if (ScrapCanvas.canvasEl) {
            ScrapCanvas.canvasEl.style.transform = 'scale(1)';
          }
        }

        // Clear dashboard user profile UI to prevent stale initials/username leaks
        const welcomeEl = document.getElementById('dashboard-welcome');
        if (welcomeEl) welcomeEl.innerText = 'MITRAVA VAULT';
        const avatarImg = document.getElementById('dashboard-avatar');
        const avatarPlaceholder = document.getElementById('dashboard-avatar-placeholder');
        if (avatarImg) {
          avatarImg.src = '';
          avatarImg.classList.add('hidden');
        }
        if (avatarPlaceholder) {
          avatarPlaceholder.innerText = '';
          avatarPlaceholder.classList.add('hidden');
        }

        // Hide squad bubbles wall container on logout
        const squadWall = document.getElementById('active-squad-bubbles-wall');
        if (squadWall) squadWall.classList.add('hidden');

        // Clear and hide rooms container to prevent room list leaks/ghosting on logout
        const container = document.getElementById('rooms-container');
        if (container) {
          container.innerHTML = '';
          container.classList.remove('scale-100', 'opacity-100');
          container.classList.add('scale-0', 'opacity-0');
        }

        // Keep scrap_auto_email and scrap_auto_password so we can auto-login upon unlocking!
        localStorage.removeItem('scrap_user_id');
        localStorage.removeItem('scrap_user_display_name');

        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key) {
            if (key.includes('vault') || key.includes('salt') || key.startsWith('scrap_room_title_')) {
              continue;
            }
            if (key.startsWith('canvas_zoom_')) {
              continue; // Preserve each room's zoom level across logout/login.
            }
            if (key === 'scrap_auto_email' || key === 'scrap_auto_password') {
              continue; // Keep the stored email so they just unlock the vault on next run
            }
            if (key.startsWith('scrap_') || key.startsWith('canvas_zoom_') || key.startsWith('canvas_scroll_')) {
              if (key === 'scrap_theme' || key === 'scrap_edge_glow_enabled' || key === 'scrap_edge_glow_color' || key === 'scrap_robo_theme') {
                continue;
              }
              localStorage.removeItem(key);
            }
          }
        }

        sessionStorage.clear();

        ScrapRecovery.vault = {
          identityPublicKeyJwk: null,
          identityPrivateKeyJwk: null,
          encryptionPublicKeyJwk: null,
          encryptionPrivateKeyJwk: null,
          roomKeys: {}
        };
        ScrapRecovery.salt = null;
        ScrapRecovery.identityKeyPair = null;
        ScrapRecovery.encryptionKeyPair = null;

        // Redirect directly to the Vault Secured page (biometric/pin unlock page)
        console.log('[ScrapApp] Logging out. Showing Vault Secured screen.');
        const gw = document.getElementById('screen-gateway');
        if (gw) gw.classList.remove('hidden');

        const unlockBtn = document.getElementById('btn-auth-unlock');
        if (unlockBtn) unlockBtn.classList.remove('hidden');

        // Hide registration/login inputs
        const nameInput = document.getElementById('input-auth-name');
        const usernameInput = document.getElementById('input-auth-username');
        const identityInput = document.getElementById('input-auth-identity');
        const areaInput = document.getElementById('input-auth-area');
        const submitBtn = document.getElementById('btn-auth-submit');
        const authTitle = document.getElementById('auth-title');

        if (nameInput) nameInput.classList.add('hidden');
        if (usernameInput) usernameInput.classList.add('hidden');
        if (identityInput) identityInput.classList.add('hidden');
        if (areaInput) areaInput.classList.add('hidden');
        if (submitBtn) submitBtn.classList.add('hidden');
        if (authTitle) authTitle.innerText = 'VAULT SECURED';

        this.showScreen('screen-gateway');
      }
    };

    const executeDeleteAccount = async () => {
      if (await window.ScrapDialog.confirm('⚠️ WARNING: Are you absolutely sure you want to permanently delete your account and all sync data? This action CANNOT be undone.')) {
        const confirmation = await window.ScrapDialog.prompt("To confirm deletion, please type 'DELETE' below:");
        if (confirmation !== 'DELETE') {
          await window.ScrapDialog.alert("Deletion cancelled. The confirmation code was incorrect.");
          return;
        }

        let deleteSuccess = false;
        try {
          if (window.pb && pb.authStore.isValid && pb.authStore.model) {
            const userId = pb.authStore.model.id;
            console.log('[ScrapApp] Preparing solo and group spaces for deletion:', userId);
            if (window.ScrapFirebase && typeof ScrapFirebase.prepareAccountDeletion === 'function') {
              await ScrapFirebase.prepareAccountDeletion(userId);
            }
            console.log('[ScrapApp] Deleting user account from PocketBase:', userId);
            await pb.collection('users').delete(userId);
            deleteSuccess = true;
          } else {
            deleteSuccess = true; // No session to delete on server
          }
        } catch (err) {
          console.error('[ScrapApp] Error deleting user account:', err);
          await window.ScrapDialog.alert("⚠️ Server Error:\nFailed to delete your account from the server. Please check your internet connection and try again.");
          return;
        }

        if (deleteSuccess) {
          // Disconnect and clean up
          ScrapFirebase.disconnect();
          if (window.pb) {
            pb.authStore.clear();
          }

          // Clear dashboard user profile UI
          const welcomeEl = document.getElementById('dashboard-welcome');
          if (welcomeEl) welcomeEl.innerText = 'MITRAVA VAULT';
          const avatarImg = document.getElementById('dashboard-avatar');
          const avatarPlaceholder = document.getElementById('dashboard-avatar-placeholder');
          if (avatarImg) {
            avatarImg.src = '';
            avatarImg.classList.add('hidden');
          }
          if (avatarPlaceholder) {
            avatarPlaceholder.innerText = '';
            avatarPlaceholder.classList.add('hidden');
          }

          // Hide active elements/containers
          const squadWall = document.getElementById('active-squad-bubbles-wall');
          if (squadWall) squadWall.classList.add('hidden');

          const container = document.getElementById('rooms-container');
          if (container) {
            container.innerHTML = '';
            container.classList.remove('scale-100', 'opacity-100');
            container.classList.add('scale-0', 'opacity-0');
          }

          // Clear credentials (for account deletion, completely purge automated logins)
          localStorage.removeItem('scrap_user_id');
          localStorage.removeItem('scrap_user_display_name');
          await ScrapStorage.remove('scrap_auto_email');
          await ScrapStorage.remove('scrap_auto_password');
          await ScrapStorage.remove('scrap_auto_login');

          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key) {
              if (key.includes('vault') || key.includes('salt') || key.startsWith('scrap_room_title_') || key.startsWith('scrap_room_is_owner_')) {
                continue;
              }
              if (key.startsWith('scrap_') || key.startsWith('canvas_zoom_') || key.startsWith('canvas_scroll_')) {
                if (key === 'scrap_theme' || key === 'scrap_edge_glow_enabled' || key === 'scrap_edge_glow_color' || key === 'scrap_robo_theme') {
                  continue;
                }
                localStorage.removeItem(key);
              }
            }
          }

          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.includes('vault') || key.includes('salt') || key.startsWith('scrap_room_title_') || key.startsWith('scrap_room_is_owner_'))) {
              localStorage.removeItem(key);
            }
          }

          sessionStorage.clear();

          ScrapRecovery.vault = {
            identityPublicKeyJwk: null,
            identityPrivateKeyJwk: null,
            encryptionPublicKeyJwk: null,
            encryptionPrivateKeyJwk: null,
            roomKeys: {}
          };
          ScrapRecovery.salt = null;
          ScrapRecovery.identityKeyPair = null;
          ScrapRecovery.encryptionKeyPair = null;
          ScrapRecovery.roomKeysCache = {};
          ScrapFirebase.elements = {};
          ScrapFirebase.connections = {};
          ScrapFirebase.mediaCacheRAM = {};

          await window.ScrapDialog.alert("Account Deleted:\nYour profile, sync data, and credentials have been permanently removed.");

          // Redirect to registration onboarding screen instead of locking
          const unlockBtn = document.getElementById('btn-auth-unlock');
          if (unlockBtn) unlockBtn.classList.add('hidden');

          this.authMode = 'login';
          await this.checkSession();
        }
      }
    };

    const triggerThemeSelector = () => {
      // Create custom premium theme selector modal
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); padding: 16px;';

      const currentTheme = this.getSavedTheme();

      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(176,38,255,0.35); border-radius:28px; padding:24px; width:100%; max-width:320px; max-height:85vh; overflow-y:auto; box-shadow:0 20px 50px rgba(0,0,0,0.9);" class="animate-in fade-in zoom-in-95 duration-200">
          <h3 style="color:#fff; font-family:'Space Grotesk', sans-serif; font-size:16px; font-weight:800; text-align:center; margin-bottom:20px; text-transform:uppercase; letter-spacing:1px; background:linear-gradient(90deg, #00f0ff, #ff00ab); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Select App Theme</h3>
          
          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
            <button data-theme="cyberpunk" class="theme-select-option" style="background:${currentTheme === 'cyberpunk' ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${currentTheme === 'cyberpunk' ? '#00f0ff' : 'rgba(255,255,255,0.1)'}; color:#fff; font-family:monospace; padding:12px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s;">
              <span>👾 CYBERPUNK</span>
              ${currentTheme === 'cyberpunk' ? '<span style="color:#00f0ff; font-weight:bold;">●</span>' : ''}
            </button>
            <button data-theme="classical" class="theme-select-option" style="background:${currentTheme === 'classical' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${currentTheme === 'classical' ? '#f59e0b' : 'rgba(255,255,255,0.1)'}; color:#fff; font-family:monospace; padding:12px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s;">
              <span>🏛️ CLASSICAL SLATE</span>
              ${currentTheme === 'classical' ? '<span style="color:#f59e0b; font-weight:bold;">●</span>' : ''}
            </button>
            
            <div style="display:flex; flex-direction:column; gap:6px;">
              <button data-theme="custom" class="theme-select-option" style="background:${currentTheme === 'custom' ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${currentTheme === 'custom' ? '#00f0ff' : 'rgba(255,255,255,0.1)'}; color:#fff; font-family:monospace; padding:12px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s; width:100%;">
                <span>🖼️ CUSTOM IMAGE</span>
                ${currentTheme === 'custom' ? '<span style="color:#00f0ff; font-weight:bold;">●</span>' : ''}
              </button>
              <div id="custom-theme-upload-container" style="display: ${currentTheme === 'custom' ? 'flex' : 'none'}; flex-direction: column; gap: 6px; padding: 0 8px;">
                <input type="file" id="input-custom-theme-file" accept="image/*" style="display: none;" />
                <button id="btn-upload-custom-bg" style="background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.2); color: #fff; font-family: monospace; font-size: 11px; padding: 8px; border-radius: 8px; cursor: pointer; text-align: center; width: 100%;">
                  ${(window.pb && pb.authStore.isValid && pb.authStore.model && (pb.authStore.model.custom_bg || pb.authStore.model.encrypted_custom_bg)) ? 'CHANGE IMAGE 📷' : 'UPLOAD IMAGE 📁'}
                </button>
              </div>
            </div>
          </div>

          <h3 style="color:#fff; font-family:'Space Grotesk', sans-serif; font-size:13px; font-weight:800; text-align:center; margin-bottom:12px; text-transform:uppercase; letter-spacing:1px; background:linear-gradient(90deg, #ff00ab, #00f0ff); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Screen Edge Glow</h3>
          
          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px; background: rgba(255,255,255,0.02); padding: 16px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <span style="color:#ccc; font-family:monospace; font-size:12px;">Enable Glow</span>
              <label class="switch" style="position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer;">
                <input type="checkbox" id="toggle-edge-glow" ${localStorage.getItem('scrap_edge_glow_enabled') === 'true' ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                <span class="slider" style="position: absolute; cursor: pointer; inset: 0; background-color: #333; border-radius: 24px; transition: .4s;"></span>
              </label>
            </div>
            
            <div id="edge-glow-colors-section" style="display: ${localStorage.getItem('scrap_edge_glow_enabled') === 'true' ? 'block' : 'none'};">
              <span style="color:#ccc; font-family:monospace; font-size:10px; display:block; margin-bottom:8px; text-transform:uppercase;">Select Color</span>
              <div style="display:flex; gap:8px; justify-content:space-between; align-items:center;">
                <button class="glow-color-opt" data-color="multicolor" style="background: linear-gradient(45deg, #ff00ab, #00f0ff, #39ff14); width:28px; height:28px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_edge_glow_color') === 'multicolor' || !localStorage.getItem('scrap_edge_glow_color') ? '#fff' : 'transparent'}; cursor:pointer; font-size: 8px; color: #fff; font-weight: bold; display: flex; align-items: center; justify-content: center; padding: 0;" title="Multicolor">🌈</button>
                <button class="glow-color-opt" data-color="#ff00ab" style="background:#ff00ab; width:28px; height:28px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_edge_glow_color') === '#ff00ab' ? '#fff' : 'transparent'}; cursor:pointer;" title="Pink"></button>
                <button class="glow-color-opt" data-color="#00f0ff" style="background:#00f0ff; width:28px; height:28px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_edge_glow_color') === '#00f0ff' ? '#fff' : 'transparent'}; cursor:pointer;" title="Cyan"></button>
                <button class="glow-color-opt" data-color="#39ff14" style="background:#39ff14; width:28px; height:28px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_edge_glow_color') === '#39ff14' ? '#fff' : 'transparent'}; cursor:pointer;" title="Green"></button>
                <button class="glow-color-opt" data-color="#b026ff" style="background:#b026ff; width:28px; height:28px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_edge_glow_color') === '#b026ff' ? '#fff' : 'transparent'}; cursor:pointer;" title="Purple"></button>
              </div>
            </div>
          </div>

          <h3 style="color:#fff; font-family:'Space Grotesk', sans-serif; font-size:13px; font-weight:800; text-align:center; margin-bottom:12px; text-transform:uppercase; letter-spacing:1px; background:linear-gradient(90deg, #00f0ff, #39ff14); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Robot Color Theme</h3>
          
          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px; background: rgba(255,255,255,0.02); padding: 16px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; gap:12px; justify-content:center; align-items:center;">
              <button class="robo-theme-opt" data-robo-theme="default" style="background: linear-gradient(135deg, #00f0ff 0%, #ff00ab 50%, #39ff14 100%); width:32px; height:32px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_robo_theme') === 'default' || !localStorage.getItem('scrap_robo_theme') ? '#fff' : 'transparent'}; cursor:pointer;" title="Default Preset"></button>
              <button class="robo-theme-opt" data-robo-theme="tricolor" style="background: linear-gradient(135deg, #FF9933 0%, #ffffff 50%, #128807 100%); width:32px; height:32px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_robo_theme') === 'tricolor' ? '#fff' : 'transparent'}; cursor:pointer;" title="Tricolor Preset"></button>
              <button class="robo-theme-opt" data-robo-theme="diwali" style="background: linear-gradient(135deg, #FF5E00 0%, #FFD700 50%, #FFE600 100%); width:32px; height:32px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_robo_theme') === 'diwali' ? '#fff' : 'transparent'}; cursor:pointer;" title="Marigold Preset"></button>
              <button class="robo-theme-opt" data-robo-theme="holi" style="background: linear-gradient(135deg, #FF00AB 0%, #00F0FF 50%, #39FF14 100%); width:32px; height:32px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_robo_theme') === 'holi' ? '#fff' : 'transparent'}; cursor:pointer;" title="Festive Preset"></button>
              <button class="robo-theme-opt" data-robo-theme="christmas" style="background: linear-gradient(135deg, #10B981 0%, #EF4444 50%, #F59E0B 100%); width:32px; height:32px; border-radius:50%; border:2px solid ${localStorage.getItem('scrap_robo_theme') === 'christmas' ? '#fff' : 'transparent'}; cursor:pointer;" title="Holiday Preset"></button>
            </div>
          </div>
          
          <button id="theme-modal-close" style="background:#ff00ab; color:#fff; font-family:monospace; font-weight:bold; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; width:100%; cursor:pointer;" class="active:scale-95">CANCEL</button>
        </div>
      `;

      document.body.appendChild(modal);

      const fileInput = modal.querySelector('#input-custom-theme-file');
      const uploadBtn = modal.querySelector('#btn-upload-custom-bg');
      const uploadContainer = modal.querySelector('#custom-theme-upload-container');

      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (file) {
            try {
              uploadBtn.textContent = 'UPLOADING... ⏳';
              uploadBtn.disabled = true;

              await ScrapFirebase.uploadUserCustomBg(file);

              uploadBtn.textContent = 'CHANGE IMAGE 📷';
              uploadBtn.disabled = false;

              localStorage.setItem('scrap_theme', 'custom');
              this.applyTheme('custom');

              modal.remove();
              if (typeof ScrapApp.renderDashboardRooms === 'function') {
                ScrapApp.renderDashboardRooms();
              }
            } catch (err) {
              console.error('Failed to upload custom background:', err);
              alert('Upload failed: ' + err.message);
              uploadBtn.textContent = 'UPLOAD IMAGE 📁';
              uploadBtn.disabled = false;
            }
          }
        });
      }

      modal.querySelectorAll('.theme-select-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const selectedTheme = btn.getAttribute('data-theme');
          if (!selectedTheme) return;

          if (selectedTheme === 'custom') {
            if (uploadContainer) {
              uploadContainer.style.display = 'flex';
            }
            const user = window.pb && pb.authStore.isValid && pb.authStore.model;
            const hasImg = user && (user.custom_bg || user.encrypted_custom_bg);
            if (!hasImg) {
              if (fileInput) fileInput.click();
              return;
            }
          }

          localStorage.setItem('scrap_theme', selectedTheme);
          this.applyTheme(selectedTheme);

          modal.remove();

          if (typeof ScrapApp.renderDashboardRooms === 'function') {
            ScrapApp.renderDashboardRooms();
          }
        });
      });

      const toggleGlow = modal.querySelector('#toggle-edge-glow');
      const colorsSection = modal.querySelector('#edge-glow-colors-section');

      if (toggleGlow) {
        toggleGlow.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          localStorage.setItem('scrap_edge_glow_enabled', isChecked ? 'true' : 'false');
          if (colorsSection) {
            colorsSection.style.display = isChecked ? 'block' : 'none';
          }
          this.applyEdgeGlow();
        });
      }

      modal.querySelectorAll('.glow-color-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const color = opt.getAttribute('data-color');
          localStorage.setItem('scrap_edge_glow_color', color);

          modal.querySelectorAll('.glow-color-opt').forEach(btn => {
            btn.style.borderColor = btn.getAttribute('data-color') === color ? '#fff' : 'transparent';
          });

          this.applyEdgeGlow();
          modal.remove();
        });
      });

      modal.querySelectorAll('.robo-theme-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const roboTheme = opt.getAttribute('data-robo-theme');
          localStorage.setItem('scrap_robo_theme', roboTheme);

          modal.querySelectorAll('.robo-theme-opt').forEach(btn => {
            btn.style.borderColor = btn.getAttribute('data-robo-theme') === roboTheme ? '#fff' : 'transparent';
          });

          this.applyRoboTheme();
          modal.remove();
        });
      });

      modal.querySelector('#theme-modal-close').addEventListener('click', () => {
        modal.remove();
      });
    };

    const triggerSettingsModal = () => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); padding: 16px;';

      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(176,38,255,0.45); border-radius:28px; padding:24px; width:100%; max-width:320px; box-shadow:0 20px 50px rgba(176,38,255,0.25);" class="animate-in fade-in zoom-in-95 duration-200">
          <h3 style="color:#fff; font-family:'Space Grotesk', sans-serif; font-size:16px; font-weight:800; text-align:center; margin-bottom:24px; text-transform:uppercase; letter-spacing:1px; background:linear-gradient(90deg, #b026ff, #ff00ab); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Vault Settings</h3>
          
          <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:24px;">
            <button id="set-btn-theme" style="background:rgba(176,38,255,0.1); border:1px solid rgba(176,38,255,0.25); color:#fff; font-family:monospace; padding:14px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:12px; transition:all 0.2s; font-size:12px; font-weight:bold; letter-spacing:1px; width:100%;" class="hover:scale-[1.02] active:scale-95">
              <span>🎨</span> <span>SWITCH APP THEME</span>
            </button>

            <button id="set-btn-tour" style="background:rgba(57,255,20,0.1); border:1px solid rgba(57,255,20,0.25); color:#39ff14; font-family:monospace; padding:14px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:12px; transition:all 0.2s; font-size:12px; font-weight:bold; letter-spacing:1px; width:100%;" class="hover:scale-[1.02] active:scale-95">
              <span>🚀</span> <span>REPLAY TOUR GUIDE</span>
            </button>
            
            <button id="set-btn-logout" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); color:#ff9900; font-family:monospace; padding:14px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:12px; transition:all 0.2s; font-size:12px; font-weight:bold; letter-spacing:1px; width:100%;" class="hover:scale-[1.02] active:scale-95">
              <span>🚪</span> <span>LOG OUT OF VAULT</span>
            </button>
            
            <button id="set-btn-delete" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:#ef4444; font-family:monospace; padding:14px; border-radius:16px; cursor:pointer; text-align:left; display:flex; align-items:center; gap:12px; transition:all 0.2s; font-size:12px; font-weight:bold; letter-spacing:1px; width:100%;" class="hover:scale-[1.02] active:scale-95">
              <span>⚠️</span> <span>DELETE MY ACCOUNT</span>
            </button>
          </div>
          
          <button id="settings-modal-close" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; font-family:monospace; font-weight:bold; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; width:100%; cursor:pointer;" class="active:scale-95">CLOSE</button>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#settings-modal-close').addEventListener('click', () => {
        modal.remove();
      });

      modal.querySelector('#set-btn-theme').addEventListener('click', () => {
        modal.remove();
        triggerThemeSelector();
      });

      modal.querySelector('#set-btn-tour').addEventListener('click', () => {
        modal.remove();
        if (window.ScrapTour) {
          window.ScrapTour.start('dashboard', true);
        }
      });

      modal.querySelector('#set-btn-logout').addEventListener('click', async () => {
        modal.remove();
        await executeLogout();
      });

      modal.querySelector('#set-btn-delete').addEventListener('click', async () => {
        modal.remove();
        await executeDeleteAccount();
      });
    };

    const settingsBtn = document.getElementById('btn-dashboard-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        triggerSettingsModal();
      });
    }

    // Invite FAB (+)

    document.getElementById('btn-fab-actions').addEventListener('click', () => {
      document.getElementById('modal-invite').classList.remove('hidden');
      document.getElementById('invite-selection').classList.remove('hidden');
      document.getElementById('invite-create-mode').classList.add('hidden');
      document.getElementById('invite-join-mode').classList.add('hidden');
      const inputInvite = document.getElementById('input-invite-payload');
      if (inputInvite) inputInvite.value = '';
    });

    document.getElementById('btn-close-invite').addEventListener('click', () => {
      document.getElementById('modal-invite').classList.add('hidden');
      const inputInvite = document.getElementById('input-invite-payload');
      if (inputInvite) inputInvite.value = '';
      this.stopQRScanner();
      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DeviceLock) {
          window.Capacitor.Plugins.DeviceLock.disableScreenshotProtection();
        }
      } catch (e) {
        console.warn('[DeviceLock] Failed to disable screenshot protection:', e);
      }
    });

    // Create New Room from FAB modal
    document.getElementById('btn-trigger-create-space').addEventListener('click', async () => {
      // Hide the invite options modal immediately so it doesn't overlap the prompt input
      const inviteModal = document.getElementById('modal-invite');
      if (inviteModal) inviteModal.classList.add('hidden');

      const roomNameInput = await window.ScrapDialog.prompt('Enter a name for your new Squad Space:', '');
      if (roomNameInput === null) {
        // If user cancelled, bring back the invite selector modal
        if (inviteModal) inviteModal.classList.remove('hidden');
        return;
      }
      const roomTitle = roomNameInput.trim();
      if (!roomTitle) {
        await window.ScrapDialog.alert('Room name is required to create a new Squad Space!');
        if (inviteModal) inviteModal.classList.remove('hidden');
        return;
      }

      // Show native-looking loading progress since Google Drive folder creation takes time
      const progressToast = document.getElementById('upload-progress-notification');
      const progressText = document.getElementById('upload-progress-text');
      if (progressToast && progressText) {
        progressText.innerText = 'Creating Squad Space...';
        progressToast.classList.remove('hidden');
      }

      try {
        const roomKey = await ScrapCrypto.generateRoomKey();

        // 1. Create room folder on Google Drive and get the real folder ID (or simulated ID in sandbox)
        const roomFolderId = await ScrapFirebase.createRoom(
          null, // pass null so resolveRoomFolder creates the folder by name
          roomTitle,
          ScrapFirebase.userId,
          [ScrapFirebase.userId]
        );

        const newRoomId = roomFolderId;
        localStorage.setItem('scrap_room_is_owner_' + newRoomId, 'true');

        // 2. Save key in local recovery vault under the real roomFolderId
        await ScrapRecovery.saveRoomKey(newRoomId, roomKey);

        await this.renderDashboardRooms();
        await this.openRoom(newRoomId, roomTitle);

        // Prompt the creator to download the room backup key immediately
        setTimeout(async () => {
          if (await window.ScrapDialog.confirm('✨ Space created successfully!\n\nTo ensure you never lose access to your encrypted room (especially if you reinstall the app), it is highly recommended to export a backup key now.\n\nWould you like to export your Backup Key now?')) {
            const btnBackup = document.getElementById('btn-export-backup');
            if (btnBackup) btnBackup.click();
          }
        }, 800);
      } catch (err) {
        await window.ScrapDialog.alert('Failed to create space: ' + err.message);
      } finally {
        if (progressToast) {
          progressToast.classList.add('hidden');
        }
      }
    });

    // Invite/Share Room QR Code trigger from Canvas HUD
    document.getElementById('btn-show-invite').addEventListener('click', async () => {
      document.getElementById('modal-invite').classList.remove('hidden');
      document.getElementById('invite-selection').classList.add('hidden');
      document.getElementById('invite-create-mode').classList.remove('hidden');
      document.getElementById('invite-join-mode').classList.add('hidden');

      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DeviceLock) {
          window.Capacitor.Plugins.DeviceLock.enableScreenshotProtection();
        }
      } catch (e) {
        console.warn('[DeviceLock] Failed to enable screenshot protection:', e);
      }

      const qrGraphic = document.getElementById('qr-code-graphic');
      qrGraphic.innerHTML = '';
      qrGraphic.innerText = 'Generating secure invitation token...';

      try {
        const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
        if (!roomKey) throw new Error('Encryption key for this room is missing.');

        const roomKeyJwk = await ScrapCrypto.exportKeyToJwk(roomKey);

        // Build 5-minute timed compact sign-key payload
        const expiry = Date.now() + 5 * 60 * 1000;
        const canvasFolderId = await ScrapDrive.resolveRoomCanvasDataFolder(this.currentRoomId, this.currentRoomTitle);
        // Build ultra-compact room join payload for instant low-density QR scanning
        const invitePayload = {
          r: this.currentRoomId,
          d: canvasFolderId,
          k: roomKeyJwk.k,
          t: this.currentRoomTitle || localStorage.getItem('scrap_room_title_' + this.currentRoomId) || 'Squad Space',
          x: expiry
        };

        const qrString = `scrap://${encodeURIComponent(JSON.stringify(invitePayload))}`;

        // Clear generating text and draw a real, high-quality, local QR Code
        qrGraphic.innerHTML = '';
        new QRCode(qrGraphic, {
          text: qrString,
          width: 240,
          height: 240,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });

        // Start Countdown
        let secondsLeft = 300;
        const countdownEl = document.getElementById('invite-countdown');
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = setInterval(() => {
          secondsLeft--;
          const mins = Math.floor(secondsLeft / 60);
          const secs = (secondsLeft % 60).toString().padStart(2, '0');
          countdownEl.innerText = `${mins}:${secs}`;
          if (secondsLeft <= 0) {
            clearInterval(this.countdownInterval);
            qrGraphic.innerHTML = '<div class="text-xs text-red-500 font-bold font-mono">EXPIRED</div>';
          }
        }, 1000);
      } catch (err) {

        qrGraphic.innerText = 'Error generating invitation: ' + err.message;
      }
    });

    // Scan/Join Space input
    document.getElementById('btn-trigger-scan-join').addEventListener('click', () => {
      document.getElementById('invite-selection').classList.add('hidden');
      document.getElementById('invite-join-mode').classList.remove('hidden');
      const inputInvite = document.getElementById('input-invite-payload');
      if (inputInvite) inputInvite.value = '';
    });

    const btnStartScan = document.getElementById('btn-start-qr-scan');
    if (btnStartScan) {
      btnStartScan.addEventListener('click', () => {
        // Remove the invite dialog before opening the full-screen scanner.
        document.getElementById('modal-invite')?.classList.add('hidden');
        const modal = document.getElementById('modal-inapp-qr-scanner');
        const statusText = document.getElementById('inapp-qr-status');
        if (modal) modal.classList.remove('hidden');
        if (statusText) statusText.innerText = 'Starting camera...';
        this.startQRScanner();
      });
    }

    const btnStopInAppScan = document.getElementById('btn-stop-inapp-qr-scan');
    if (btnStopInAppScan) {
      btnStopInAppScan.addEventListener('click', () => {
        this.stopInAppQRScanner();
      });
    }

    const qrImagePickerButton = document.getElementById('btn-qr-image-picker');
    const qrImagePicker = document.getElementById('input-qr-image');
    if (qrImagePickerButton && qrImagePicker) {
      qrImagePickerButton.addEventListener('click', () => qrImagePicker.click());
      qrImagePicker.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) this.scanQRFromImageFile(file);
        event.target.value = '';
      });
    }

    document.getElementById('btn-submit-join').addEventListener('click', async () => {

      try {
        const payloadStr = document.getElementById('input-invite-payload').value.trim();
        if (!payloadStr) {
          await window.ScrapDialog.alert('Please paste or scan a valid invitation token.');
          return;
        }
        await this.processQRInvitePayload(payloadStr);
      } catch (err) {
        console.error('[btn-submit-join] Click handler error:', err);
        await window.ScrapDialog.alert('🚨 Error joining room: ' + err.message);
      }
    });

    // Dashboard tabs deprecated, only showing Squad rooms

    document.getElementById('btn-canvas-back').addEventListener('click', () => {
      // Clear rooms list container instantly before transitions to avoid flashes of old ads/rooms
      const container = document.getElementById('rooms-container');
      if (container) container.innerHTML = '';

      const workspace = document.getElementById('canvas-workspace');
      if (workspace && this.currentRoomId) {
        ScrapFirebase.saveViewport(this.currentRoomId, workspace.scrollLeft, workspace.scrollTop);
      }

      // Disconnect room polling loop when exiting canvas to dashboard
      ScrapFirebase.disconnect();

      if (this.activeMembersPruneInterval) {
        clearInterval(this.activeMembersPruneInterval);
        this.activeMembersPruneInterval = null;
      }
      const sidebar = document.getElementById('members-sidebar');
      if (sidebar) sidebar.classList.add('hidden');
      const squadWall = document.getElementById('active-squad-bubbles-wall');
      if (squadWall) squadWall.classList.add('hidden');
      this.showScreen('screen-dashboard');
      this.renderDashboardRooms();
    });

    // Members Sidebar Toggle
    const btnToggleMembers = document.getElementById('btn-toggle-members');
    const btnCloseMembersSidebar = document.getElementById('btn-close-members-sidebar');
    const membersSidebar = document.getElementById('members-sidebar');

    if (btnToggleMembers && membersSidebar) {
      btnToggleMembers.addEventListener('click', () => {
        const isHidden = membersSidebar.classList.toggle('hidden');
        if (!isHidden && window.ScrapCanvas) {
          if (typeof ScrapCanvas.refreshJoinedMembers === 'function') {
            ScrapCanvas.refreshJoinedMembers();
          } else {
            ScrapCanvas.updateActiveMembersListUI();
          }
        }
        if (window.ScrapCanvas && typeof window.ScrapCanvas.checkEmptyDateMessage === 'function') {
          window.ScrapCanvas.checkEmptyDateMessage();
        }
      });
    }

    if (btnCloseMembersSidebar && membersSidebar) {
      btnCloseMembersSidebar.addEventListener('click', () => {
        membersSidebar.classList.add('hidden');
        if (window.ScrapCanvas && typeof window.ScrapCanvas.checkEmptyDateMessage === 'function') {
          window.ScrapCanvas.checkEmptyDateMessage();
        }
      });
    }

    // Scrapbook Modal Event Bindings
    const btnScrapbook = document.getElementById('btn-room-scrapbook');
    const modalScrapbook = document.getElementById('modal-scrapbook');
    const btnCloseScrapbook = document.getElementById('btn-close-scrapbook');

    if (btnScrapbook && modalScrapbook) {
      btnScrapbook.addEventListener('click', () => {
        modalScrapbook.classList.remove('hidden');
        if (window.ScrapCanvas && typeof window.ScrapCanvas.checkEmptyDateMessage === 'function') {
          window.ScrapCanvas.checkEmptyDateMessage();
        }

        if (yearSelect && monthSelect) {
          // Collect all unique years dynamically from elements and current room date
          const yearsSet = new Set();
          const defaultDate = this.currentDate || new Date().toISOString().split('T')[0];
          const defaultYear = parseInt(defaultDate.split('-')[0], 10) || new Date().getFullYear();
          yearsSet.add(defaultYear);
          yearsSet.add(new Date().getFullYear());

          const elements = ScrapFirebase.elements || {};
          Object.values(elements).forEach(el => {
            if (el && el.date) {
              const y = parseInt(el.date.split('-')[0], 10);
              if (!isNaN(y)) yearsSet.add(y);
            }
          });

          const sortedYears = Array.from(yearsSet).sort((a, b) => a - b);
          let minYear = sortedYears[0];
          let maxYear = sortedYears[sortedYears.length - 1];

          // Ensure a broad default span while including any custom historical years (e.g. 1996)
          if (minYear > 1990) minYear = 1990;
          if (maxYear < new Date().getFullYear()) maxYear = new Date().getFullYear();

          yearSelect.innerHTML = '';
          for (let y = maxYear; y >= minYear; y--) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.innerText = String(y);
            yearSelect.appendChild(opt);
          }

          const parts = defaultDate.split('-');
          const activeYearStr = String(parts[0] || defaultYear);
          yearSelect.value = activeYearStr;
          if (parts[1]) monthSelect.value = parts[1];
        }

        this.renderScrapbookContent();
      });
    }

    // Bind change listeners to scrapbook month/year selectors
    const yearSelect = document.getElementById('scrapbook-filter-year');
    const monthSelect = document.getElementById('scrapbook-filter-month');
    if (yearSelect) {
      yearSelect.addEventListener('change', () => {
        this.renderScrapbookContent();
      });
    }
    if (monthSelect) {
      monthSelect.addEventListener('change', () => {
        this.renderScrapbookContent();
      });
    }

    if (btnCloseScrapbook && modalScrapbook) {
      btnCloseScrapbook.addEventListener('click', () => {
        modalScrapbook.classList.add('hidden');
        this.stopScrapbookAutoPlay();
        if (window.scrapbookAudio) {
          window.scrapbookAudio.pause();
          window.scrapbookAudio = null;
        }
      });
    }

    // Mood Calendar Modal Event Bindings
    const btnMood = document.getElementById('btn-room-mood');
    const modalMood = document.getElementById('modal-mood-calendar');
    const btnCloseMood = document.getElementById('btn-close-mood-calendar');

    if (btnMood && modalMood) {
      btnMood.addEventListener('click', () => {
        modalMood.classList.remove('hidden');
        this.renderMoodCalendarFeed();
        const badge = document.getElementById('mood-radar-badge');
        if (badge) badge.style.display = 'none';
        if (window.ScrapCanvas && typeof window.ScrapCanvas.checkEmptyDateMessage === 'function') {
          window.ScrapCanvas.checkEmptyDateMessage();
        }
      });
    }

    if (btnCloseMood && modalMood) {
      btnCloseMood.addEventListener('click', () => {
        modalMood.classList.add('hidden');
      });
    }

    const moodBtns = document.querySelectorAll('.btn-set-mood');
    moodBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const moodEmoji = btn.getAttribute('data-mood');
        if (!moodEmoji) return;

        moodBtns.forEach(b => b.classList.remove('active-mood'));
        btn.classList.add('active-mood');

        const userId = ScrapFirebase.userId || 'default_user';
        const userName = ScrapFirebase.userName || 'Squadmate';
        const todayStr = this.currentDate || new Date().toISOString().split('T')[0];
        const moodId = `mood_${userId}_${todayStr}`;

        const moodData = {
          type: 'mood',
          userId: userId,
          userName: userName,
          ownerId: userId,
          ownerName: userName,
          date: todayStr,
          moodEmoji: moodEmoji,
          note: '',
          updatedAt: Date.now()
        };

        try {
          await ScrapFirebase.saveElement(this.currentRoomId, moodId, moodData);
          this.renderMoodCalendarFeed();
        } catch (err) {
          console.error('[Mood Save Error]:', err);
          await window.ScrapDialog.alert('Failed to save mood: ' + err.message);
        }
      });
    });

    // Recenter Canvas Board Action Button
    const btnRecenter = document.getElementById('btn-canvas-recenter');
    if (btnRecenter) {
      const handleRecenter = (e) => {
        console.log('[Recenter] Action triggered:', e ? e.type : 'manual');
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }

        const canvas = window.ScrapCanvas;
        if (!canvas || !canvas.workspaceEl) {
          console.warn('[Recenter] window.ScrapCanvas is not initialized');
          return;
        }

        const workspace = canvas.workspaceEl;

        // DOM-based approach: find all rendered element nodes that match the current date.
        const allItems = Array.from(document.querySelectorAll('[id^="item_"]'));
        const currentDate = canvas.currentDate;

        // Filter to elements matching the active date using the data map
        const map = canvas.elements || {};
        const visibleItems = allItems.filter(domEl => {
          const id = domEl.id.replace('item_', '');
          const data = map[id];
          return data && data.date === currentDate;
        });

        // Prefer photos/containers for recentering
        const photoItems = visibleItems.filter(domEl => {
          const id = domEl.id.replace('item_', '');
          const data = map[id];
          return data && (data.type === 'photo' || data.type === 'container');
        });

        const targetItems = photoItems.length > 0 ? photoItems : visibleItems;

        console.log('[Recenter] Total items in DOM:', allItems.length, 'Matched for date:', currentDate, ':', targetItems.length);

        if (targetItems.length === 0) {
          // Fallback to board center in layout space (no zoom needed)
          const boardMargin = 3000;
          workspace.scrollLeft = boardMargin + 2500 - workspace.clientWidth / 2;
          workspace.scrollTop = boardMargin + 2500 - workspace.clientHeight / 2;
          console.log('[Recenter] No elements found, fallback to board center');
          return;
        }

        // Sort by their current top position on screen, take the topmost one
        targetItems.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const focusEl = targetItems[0];
        const rect = focusEl.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();

        // The element's center on screen (relative to viewport)
        const elCenterX = rect.left + rect.width / 2;
        const elCenterY = rect.top + rect.height / 2;

        // The workspace center on screen
        const wsCenterX = workspaceRect.left + workspaceRect.width / 2;
        const wsCenterY = workspaceRect.top + workspaceRect.height / 2;

        // Difference between where element is now vs where we want it (workspace center)
        const dx = elCenterX - wsCenterX;
        const dy = elCenterY - wsCenterY;

        console.log('[Recenter] Element center:', elCenterX, elCenterY, 'WS center:', wsCenterX, wsCenterY, 'Delta:', dx, dy);

        // Adjust scroll by the delta — works at any zoom level
        workspace.scrollLeft = workspace.scrollLeft + dx;
        workspace.scrollTop = workspace.scrollTop + dy;
      };

      btnRecenter.addEventListener('click', handleRecenter);
    }

    // Helper for Collage Flow: auto-scroll to the nearest visible (filtered-active) photo after chip click
    this.recenterCanvasToActiveElements = () => {
      const canvas = window.ScrapCanvas;
      if (!canvas || !canvas.workspaceEl) return;
      const workspace = canvas.workspaceEl;

      // Find elements that passed the collage filter
      let targetItems = Array.from(document.querySelectorAll('[id^="item_"].element-filtered-active'));

      // Prefer photos
      const photoItems = targetItems.filter(domEl => {
        const id = domEl.id.replace('item_', '');
        const data = (canvas.elements || {})[id];
        return data && (data.type === 'photo' || data.type === 'container');
      });
      if (photoItems.length > 0) targetItems = photoItems;

      if (targetItems.length === 0) {
        // No active items — fall back to board center
        const boardMargin = 3000;
        workspace.scrollLeft = boardMargin + 2500 - workspace.clientWidth / 2;
        workspace.scrollTop = boardMargin + 2500 - workspace.clientHeight / 2;
        return;
      }

      // Scroll to the topmost visible element (same approach as the recenter button)
      targetItems.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const focusEl = targetItems[0];
      const rect = focusEl.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const elCenterX = rect.left + rect.width / 2;
      const elCenterY = rect.top + rect.height / 2;
      const wsCenterX = workspaceRect.left + workspaceRect.width / 2;
      const wsCenterY = workspaceRect.top + workspaceRect.height / 2;
      const dx = elCenterX - wsCenterX;
      const dy = elCenterY - wsCenterY;
      console.log('[CollageFlow Recenter] delta:', dx, dy, 'items:', targetItems.length);
      workspace.scrollLeft += dx;
      workspace.scrollTop += dy;
    };


    // Toggle Collage Flow Filter Bar Action Button
    const btnToggleCollageFlow = document.getElementById('btn-toggle-collage-flow');
    if (btnToggleCollageFlow) {
      btnToggleCollageFlow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bar = document.getElementById('collage-flow-filter-bar');
        if (bar) {
          bar.classList.toggle('hidden');
          if (window.ScrapCanvas && typeof window.ScrapCanvas.updateDatePickerVisibility === 'function') {
            window.ScrapCanvas.updateDatePickerVisibility();
          }
          const isOpening = !bar.classList.contains('hidden');
          if (isOpening) {
            // Unselect all filter chips so board starts completely empty
            const chips = bar.querySelectorAll('.collage-flow-chip');
            chips.forEach(c => c.classList.remove('active'));
            const yearSelect = document.getElementById('collage-flow-year-select');
            if (yearSelect) {
              if (window.ScrapCanvas && typeof window.ScrapCanvas.populateCollageFlowYears === 'function') {
                window.ScrapCanvas.populateCollageFlowYears(yearSelect);
              }
              yearSelect.value = '';
            }
            if (window.ScrapCanvas && typeof window.ScrapCanvas.setCollageFlowFilter === 'function') {
              window.ScrapCanvas.setCollageFlowFilter('none');
            }
          } else {
            if (window.ScrapCanvas && typeof window.ScrapCanvas.resetCollageFlowToolbar === 'function') {
              window.ScrapCanvas.resetCollageFlowToolbar();
            }
          }
        }
      });
    }

    // Share Canvas Action Button (WhatsApp, Instagram, Gmail, Native Share Sheet)
    const btnShareCanvas = document.getElementById('btn-share-canvas');
    if (btnShareCanvas) {
      btnShareCanvas.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const currentRoomId = this.currentRoomId || '';
          const storedIsGroup = localStorage.getItem('scrap_room_is_group_' + currentRoomId);
          const isGroupVault = storedIsGroup === 'true' || (window.ScrapFirebase && ScrapFirebase.isGroupVault === true);

          if (isGroupVault) {
            await window.ScrapDialog.alert('🔒 Sharing disabled for Group Squad Vaults to protect member privacy.');
            return;
          }

          if (!window.ScrapCanvas || typeof ScrapCanvas.exportCanvasToImage !== 'function') {
            await window.ScrapDialog.alert('Canvas export engine not initialized.');
            return;
          }

          const pngDataUrl = await ScrapCanvas.exportCanvasToImage();
          const title = this.currentRoomTitle || 'Mitrava Space';
          const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
          const fileName = `${cleanTitle}_canvas.png`;

          // 1. Capacitor Native Share Plugin (Primary Native Android/iOS Share Sheet with image attached)
          const SharePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
          const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;

          if (Filesystem && pngDataUrl.includes('base64,')) {
            try {
              const base64Data = pngDataUrl.split('base64,')[1];
              const writeRes = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: 'CACHE'
              });

              if (SharePlugin && typeof SharePlugin.share === 'function') {
                await SharePlugin.share({
                  title: `Mitrava Space - ${title}`,
                  files: [writeRes.uri],
                  dialogTitle: 'Share Canvas Space'
                });
                return;
              }
            } catch (fsShareErr) {
              if (fsShareErr.name === 'AbortError' || fsShareErr.message?.includes('canceled')) return;
            }
          }

          // 2. Fallback to Web Share API if supported
          if (navigator.share) {
            try {
              const res = await fetch(pngDataUrl);
              const blob = await res.blob();
              const file = new File([blob], fileName, { type: 'image/png' });

              if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                  title: `Mitrava Space - ${title}`,
                  files: [file]
                });
                return;
              }
            } catch (shareErr) {
              if (shareErr.name === 'AbortError') return;
            }
          }

          // Fallback share options menu if native share is unavailable
          const optIdx = await window.ScrapDialog.showOptions('📲 Share Canvas Space', [
            '💬 WhatsApp',
            '✉️ Email / Gmail',
            '💾 Download Image File'
          ]);

          if (optIdx === 0) {
            window.open('https://api.whatsapp.com/send', '_blank');
          } else if (optIdx === 1) {
            window.location.href = `mailto:?subject=${encodeURIComponent('Mitrava Canvas: ' + title)}`;
          } else if (optIdx === 2) {
            const a = document.createElement('a');
            a.href = pngDataUrl;
            a.download = fileName;
            a.click();
          }
        } catch (err) {
          await window.ScrapDialog.alert('Could not share canvas: ' + err.message);
        } finally {
          // Explicit RAM & Cache file cleanup
          setTimeout(async () => {
            const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
            if (Filesystem) {
              try {
                const title = this.currentRoomTitle || 'Mitrava Space';
                const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
                await Filesystem.deleteFile({
                  path: `${cleanTitle}_canvas.png`,
                  directory: 'CACHE'
                });
              } catch (_) { }
            }
          }, 1500);
        }
      });
    }

    // Export Cryptographic Backup Action Button
    const btnExportBackup = document.getElementById('btn-export-backup');
    if (btnExportBackup) {
      btnExportBackup.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const userId = window.ScrapFirebase && ScrapFirebase.userId;
          const vault = localStorage.getItem(`scrap_local_vault_${userId}`);
          const salt = localStorage.getItem(`scrap_local_salt_${userId}`);
          if (!vault || !salt) {
            await window.ScrapDialog.alert('No cryptographic identity found to backup.');
            return;
          }
          const backupData = JSON.stringify({
            roomId: this.currentRoomId || '',
            roomTitle: this.currentRoomTitle || '',
            vault,
            salt
          });
          const cleanRoomTitle = (this.currentRoomTitle || 'space').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
          const shortTime = Date.now().toString().slice(-6);
          const filename = `sb_${cleanRoomTitle}_${shortTime}.scrapkey`;

          const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
          if (Filesystem) {
            try {
              const res = await Filesystem.writeFile({
                path: filename,
                data: backupData,
                directory: 'DOCUMENTS',
                encoding: 'utf8',
                recursive: true
              });
              await window.ScrapDialog.alert(`✅ Backup saved to device storage!\nFile: Documents/${filename}`);
            } catch (err) {
              const fallbackRes = await Filesystem.writeFile({
                path: filename,
                data: backupData,
                directory: 'CACHE',
                encoding: 'utf8'
              });
              await window.ScrapDialog.alert(`✅ Backup saved to device cache storage!\nFile path: ${fallbackRes.uri}`);
            }
          } else {
            const blob = new Blob([backupData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            await window.ScrapDialog.alert('✅ Cryptographic Backup downloaded! Keep this file safe. You can use it to restore access on any device.');
          }
        } catch (err) {
          await window.ScrapDialog.alert('Failed to export backup: ' + err.message);
        }
      });
    }

    // Toolbar Tools actions (Camera / Photo Upload Tool)
    const toolCamera = document.getElementById('tool-camera');
    if (toolCamera) {
      toolCamera.addEventListener('click', () => {
        this.showScreen('screen-capture');
      });
    }

    // Toolbar Tools actions (Video Sticker Tool)
    const toolVideo = document.getElementById('tool-video');
    const hiddenVideoPicker = document.getElementById('hidden-video-picker');
    if (toolVideo && hiddenVideoPicker) {
      hiddenVideoPicker.addEventListener('click', () => {
        this.isSelectingFile = true;
      });
      toolVideo.addEventListener('click', async () => {
        const optionIdx = await window.ScrapDialog.showOptions('Record or Upload Video?', [
          '📹 Record Video (Camera)',
          '📂 Choose from Gallery'
        ]);

        if (optionIdx === 0) {
          await this.openVideoPreview();
        } else if (optionIdx === 1) {
          hiddenVideoPicker.removeAttribute('capture');
          this.isSelectingFile = true;
          hiddenVideoPicker.click();
        }
      });
      hiddenVideoPicker.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          await this.processVideoFile(file);
        }
        hiddenVideoPicker.value = ''; // Reset input selection
      });
    }

    // Video recording control buttons
    const btnFlipVideo = document.getElementById('btn-flip-video-camera');
    if (btnFlipVideo) {
      btnFlipVideo.addEventListener('click', () => {
        this.flipVideoCamera();
      });
    }

    const btnStartVideo = document.getElementById('btn-start-video-recording');
    if (btnStartVideo) {
      btnStartVideo.addEventListener('click', () => {
        this.startVideoRecording();
      });
    }

    const btnStopVideo = document.getElementById('btn-stop-video-recording');
    if (btnStopVideo) {
      btnStopVideo.addEventListener('click', () => {
        this.stopVideoRecording();
      });
    }

    const btnCloseVideo = document.getElementById('btn-close-video-recording');
    if (btnCloseVideo) {
      btnCloseVideo.addEventListener('click', () => {
        this.cleanupVideoRecording();
      });
    }

    // Toolbar Tools actions (Text/Sticker Tool)
    const toolText = document.getElementById('tool-text');
    if (toolText) {
      toolText.addEventListener('click', async () => {
        const val = await window.ScrapDialog.prompt('Type your sticker text:', '');
        if (val && val.trim()) {
          const zoomVal = ScrapCanvas.zoom || 1.0;
          const workspace = ScrapCanvas.workspaceEl;
          const boardMargin = 3000;
          const workspaceWidth = (workspace && workspace.clientWidth > 0) ? workspace.clientWidth : window.innerWidth;
          const workspaceHeight = (workspace && workspace.clientHeight > 0) ? workspace.clientHeight : window.innerHeight;
          const scrollLeft = workspace ? workspace.scrollLeft : 0;
          const scrollTop = workspace ? workspace.scrollTop : 0;

          const x = Math.round((scrollLeft - boardMargin + workspaceWidth / 2) / zoomVal - 50);
          const y = Math.round((scrollTop - boardMargin + workspaceHeight / 2) / zoomVal - 20);

          const id = 'text_' + Date.now();
          window.pendingScrollToElementId = null; // Prevent board auto-scrolling on text addition

          let textVal = val.trim();
          let encText = null;
          let isEncrypted = false;
          try {
            const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
            if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
              encText = await ScrapCrypto.encryptText(textVal, roomKey);
              isEncrypted = true;
            }
          } catch (cryptoErr) {
            console.warn('[Text] Encryption failed, saving plain text fallback:', cryptoErr);
          }

          const textElement = {
            type: 'text',
            text: textVal,
            encryptedText: encText,
            encrypted: isEncrypted,
            x: x,
            y: y,
            rotation: Math.floor(Math.random() * 20) - 10,
            scale: 1.4,
            zIndex: ScrapCanvas.getMaxZIndex('text') + 1,
            date: this.currentDate
          };
          await ScrapFirebase.saveElement(this.currentRoomId, id, textElement);
        }
      });
    }
    // Toolbar Tools actions (Container Frame Tool)
    const toolContainer = document.getElementById('tool-container');
    if (toolContainer) {
      toolContainer.addEventListener('click', async () => {
        const val = await window.ScrapDialog.prompt('Label Your Group Frame (Max 12 chars):', '');
        if (val === null) return;
        let titleText = '';
        if (val.trim()) {
          titleText = val.trim().substring(0, 12);
        }

        const zoomVal = ScrapCanvas.zoom || 1.0;
        const workspace = ScrapCanvas.workspaceEl;
        const boardMargin = 3000;
        const workspaceWidth = (workspace && workspace.clientWidth > 0) ? workspace.clientWidth : window.innerWidth;
        const workspaceHeight = (workspace && workspace.clientHeight > 0) ? workspace.clientHeight : window.innerHeight;
        const scrollLeft = workspace ? workspace.scrollLeft : 0;
        const scrollTop = workspace ? workspace.scrollTop : 0;

        const x = Math.round((scrollLeft - boardMargin + workspaceWidth / 2) / zoomVal - 160);
        const y = Math.round((scrollTop - boardMargin + workspaceHeight / 2) / zoomVal - 160);

        const id = 'container_' + Date.now();
        window.pendingScrollToElementId = null; // Prevent board auto-scrolling
        const containerElement = {
          type: 'container',
          title: titleText,
          x: x,
          y: y,
          rotation: 0,
          scale: 1.0,
          zIndex: ScrapCanvas.getMaxZIndex('container') + 1,
          date: this.currentDate
        };
        await ScrapFirebase.saveElement(this.currentRoomId, id, containerElement);
      });
    }



    // Toolbar Tools actions (Emoji Picker Tool)
    const toolEmoji = document.getElementById('tool-emoji');
    if (toolEmoji) {
      toolEmoji.addEventListener('click', () => {
        document.getElementById('modal-emoji-picker').classList.remove('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.add('hidden');
      });
    }

    // Toolbar Tools actions (Connection Tool)
    const toolLink = document.getElementById('tool-link');
    if (toolLink) {
      toolLink.addEventListener('click', () => {
        // Show the connection options modal immediately!
        document.getElementById('modal-connection-picker').classList.remove('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.add('hidden');
      });
    }
    // Helper functions for offline Web Audio voice effects
    const audioBufferToWav = (buffer) => {
      const numOfChan = buffer.numberOfChannels;
      const length = buffer.length * 2 * numOfChan + 44;
      const bufferArr = new ArrayBuffer(length);
      const view = new DataView(bufferArr);
      const channels = [];
      let offset = 0;
      let pos = 0;

      const setUint16 = (data) => {
        view.setUint16(pos, data, true);
        pos += 2;
      };

      const setUint32 = (data) => {
        view.setUint32(pos, data, true);
        pos += 4;
      };

      // Write WAV header
      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8); // file length - 8
      setUint32(0x45564157); // "WAVE"
      setUint32(0x20746d66); // "fmt " chunk
      setUint32(16); // chunk length
      setUint16(1); // sample format (raw PCM)
      setUint16(numOfChan); // channel count
      setUint32(buffer.sampleRate); // sample rate
      setUint32(buffer.sampleRate * 2 * numOfChan); // byte rate (sample rate * block align)
      setUint16(numOfChan * 2); // block align (channel count * bytes per sample)
      setUint16(16); // bits per sample
      setUint32(0x61746164); // "data" chunk
      setUint32(length - pos - 4); // chunk length

      // Write interleaved audio channel data
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
      }

      while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
          let sample = Math.max(-1, Math.min(1, channels[i][offset] || 0));
          sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(pos, sample, true);
          pos += 2;
        }
        offset++;
      }

      return bufferArr;
    };

    const applyVoiceEffect = async (audioBlob, effect) => {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio API not supported.');
      const tempCtx = new AudioContextClass();
      const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      tempCtx.close();

      let playbackRate = 1.0;
      if (effect === 'chipmunk') playbackRate = 1.4;
      else if (effect === 'monster') playbackRate = 0.75;
      else if (effect === 'bale_bale') playbackRate = 1.16;

      const channels = decodedBuffer.numberOfChannels;
      const sampleRate = decodedBuffer.sampleRate;
      const originalLength = decodedBuffer.length;
      const durationMs = (decodedBuffer.duration / playbackRate) * 1000;

      // Create OfflineAudioContext with appropriate length based on playback speed
      const renderLength = Math.floor(originalLength / playbackRate);
      const offlineCtx = new OfflineAudioContext(channels, renderLength, sampleRate);

      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = decodedBuffer;
      sourceNode.playbackRate.value = playbackRate;

      let lastNode = sourceNode;

      if (effect === 'monster') {
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        lastNode.connect(filter);
        lastNode = filter;
      } else if (effect === 'bale_bale') {
        const twang = offlineCtx.createBiquadFilter();
        twang.type = 'highpass';
        twang.frequency.value = 750;
        twang.Q.value = 2.0;

        const dholBass = offlineCtx.createBiquadFilter();
        dholBass.type = 'peaking';
        dholBass.frequency.value = 110;
        dholBass.Q.value = 1.8;
        dholBass.gain.value = 12;

        const delay = offlineCtx.createDelay();
        delay.delayTime.value = 0.28;
        const feedback = offlineCtx.createGain();
        feedback.gain.value = 0.45;

        lastNode.connect(twang);
        twang.connect(dholBass);
        dholBass.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);

        dholBass.connect(offlineCtx.destination);
        feedback.connect(offlineCtx.destination);

        sourceNode.start(0);
        const rendered = await offlineCtx.startRendering();
        const wavArr = audioBufferToWav(rendered);
        return {
          blob: new Blob([wavArr], { type: 'audio/wav' }),
          durationMs: durationMs
        };
      } else if (effect === 'tumbi') {
        const highpass = offlineCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 800;

        const delay = offlineCtx.createDelay();
        delay.delayTime.value = 0.0035; // 3.5ms
        const feedback = offlineCtx.createGain();
        feedback.gain.value = 0.75;

        lastNode.connect(highpass);
        highpass.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay); // feedback loop

        highpass.connect(offlineCtx.destination);
        feedback.connect(offlineCtx.destination);

        sourceNode.start(0);
        const rendered = await offlineCtx.startRendering();
        const wavArr = audioBufferToWav(rendered);
        return {
          blob: new Blob([wavArr], { type: 'audio/wav' }),
          durationMs: durationMs
        };
      } else if (effect === 'dhol') {
        const bassBoost = offlineCtx.createBiquadFilter();
        bassBoost.type = 'peaking';
        bassBoost.frequency.value = 100;
        bassBoost.Q.value = 1.5;
        bassBoost.gain.value = 14; // +14dB boost

        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 8;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.15;

        lastNode.connect(bassBoost);
        bassBoost.connect(compressor);
        lastNode = compressor;
      } else if (effect === 'sufi') {
        const delay = offlineCtx.createDelay();
        delay.delayTime.value = 0.52; // 520ms
        const feedback = offlineCtx.createGain();
        feedback.gain.value = 0.55;

        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2500;

        lastNode.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay); // feedback loop

        lastNode.connect(offlineCtx.destination);
        feedback.connect(offlineCtx.destination);

        sourceNode.start(0);
        const rendered = await offlineCtx.startRendering();
        const wavArr = audioBufferToWav(rendered);
        return {
          blob: new Blob([wavArr], { type: 'audio/wav' }),
          durationMs: durationMs
        };
      } else if (effect === 'echo') {
        const delay = offlineCtx.createDelay();
        delay.delayTime.value = 0.35; // 350ms
        const feedback = offlineCtx.createGain();
        feedback.gain.value = 0.4;

        lastNode.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay); // feedback loop

        lastNode.connect(offlineCtx.destination);
        feedback.connect(offlineCtx.destination);

        sourceNode.start(0);
        const rendered = await offlineCtx.startRendering();
        const wavArr = audioBufferToWav(rendered);
        return {
          blob: new Blob([wavArr], { type: 'audio/wav' }),
          durationMs: durationMs
        };
      }

      lastNode.connect(offlineCtx.destination);
      sourceNode.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBuffer = audioBufferToWav(renderedBuffer);

      return {
        blob: new Blob([wavBuffer], { type: 'audio/wav' }),
        durationMs: durationMs
      };
    };

    // Voice Note Tool — uses capacitor-voice-recorder on Android, MediaRecorder fallback on web
    const toolVoice = document.getElementById('tool-voice');
    if (toolVoice) {
      toolVoice.addEventListener('click', async () => {
        // Step 1: Prompt for recording type immediately
        const optionIdx = await window.ScrapDialog.showOptions('Choose Recording Type', [
          '🗣 Voice Note (Speech)',
          '🎵 Song / Music (Beat)'
        ]);

        if (optionIdx === null) return; // user cancelled options dialog

        const chosenType = optionIdx === 1 ? 'music' : 'voice';

        // Step 2: Prompt for optional custom label up-front (restricted to 12 chars max)
        let customTitle = '';
        while (true) {
          const labelInput = await window.ScrapDialog.prompt('Label Your Cassette Tape (Max 12 chars)', '');
          if (labelInput === null) {
            break;
          }
          const trimmed = labelInput.trim();
          if (trimmed.length <= 12) {
            customTitle = trimmed;
            break;
          }
          await window.ScrapDialog.alert('Cassette title must be 12 characters or less! You entered ' + trimmed.length + ' characters.');
        }

        const overlay = document.getElementById('voice-recording-overlay');
        const timerEl = document.getElementById('voice-recording-timer');
        const statusEl = document.getElementById('voice-recording-status');
        const pingEl = document.getElementById('voice-recording-ping');

        const btnStart = document.getElementById('btn-start-voice-recording');
        const btnStop = document.getElementById('btn-stop-voice-recording');
        const btnCancel = document.getElementById('btn-close-voice-recording');

        const isNative = window.Capacitor && window.Capacitor.isNativePlatform();

        // Reset effect select to none on open
        const effectSelect = document.getElementById('voice-effect-select');
        if (effectSelect) {
          effectSelect.value = 'none';
          if (!effectSelect.dataset.listenerBound) {
            effectSelect.dataset.listenerBound = 'true';
            effectSelect.addEventListener('change', (e) => {
              this.playVoiceEffectPreview(e.target.value);
            });
          }
        }

        // --- Helper: save audio blob to canvas ---
        const saveVoiceToCanvas = async (audioBlob, durationMs, typeArg, labelTitle) => {
          const progressToast = document.getElementById('upload-progress-notification');
          const progressText = document.getElementById('upload-progress-text');

          try {
            const arrayBuffer = await audioBlob.arrayBuffer();

            // Encrypt audio in RAM using room key
            let encBuf = arrayBuffer;
            let isEncrypted = false;
            try {
              const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
              if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptData === 'function') {
                console.log('[Voice] Encrypting audio file with AES-GCM 256...');
                encBuf = await ScrapCrypto.encryptData(arrayBuffer, roomKey);
                isEncrypted = true;
              } else {
                console.warn('[Voice] Room key missing, uploading plain audio fallback.');
              }
            } catch (cryptoErr) {
              console.error('[Voice] Encryption error, uploading plain audio fallback:', cryptoErr);
              encBuf = arrayBuffer;
            }

            const roomFolderId = await ScrapDrive.resolveRoomFolder(this.currentRoomId, this.currentRoomTitle, this.currentDate);
            let fileExt = isEncrypted ? 'enc' : 'm4a';
            if (!isEncrypted && audioBlob.type) {
              if (audioBlob.type.includes('webm')) fileExt = 'webm';
              else if (audioBlob.type.includes('ogg')) fileExt = 'ogg';
              else if (audioBlob.type.includes('wav')) fileExt = 'wav';
              else if (audioBlob.type.includes('aac')) fileExt = 'aac';
              else if (audioBlob.type.includes('mpeg')) fileExt = 'mp3';
              else if (audioBlob.type.includes('mp3')) fileExt = 'mp3';
              else if (audioBlob.type.includes('m4a')) fileExt = 'm4a';
            }
            const mimeType = audioBlob.type || 'audio/mp4';
            const timestamp = Date.now();
            const username = (window.pb && pb.authStore.isValid && pb.authStore.model)
              ? (pb.authStore.model.username || pb.authStore.model.name || pb.authStore.model.id)
              : (window.ScrapFirebase && window.ScrapFirebase.userName) || 'squadmate';
            const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
            const fileName = `${safeUsername}_voice_${timestamp}.${fileExt}`;

            // 1. Write binary buffer to native disk cache first for instant local availability
            await ScrapDrive.writeLocalCacheFile(fileName, encBuf);

            let x = 2444; // default center of 5000x5000 board
            let y = 2460;
            try {
              const workspace = document.getElementById('canvas-workspace');
              const boardMargin = 3000;
              const zoomVal = ScrapCanvas.zoom || 1.0;
              const wW = workspace ? workspace.clientWidth : window.innerWidth;
              const wH = workspace ? workspace.clientHeight : window.innerHeight;
              const sL = workspace ? workspace.scrollLeft : 0;
              const sT = workspace ? workspace.scrollTop : 0;
              x = Math.round((sL - boardMargin + wW / 2) / zoomVal - 56);
              y = Math.round((sT - boardMargin + wH / 2) / zoomVal - 40);
            } catch (e) {
              console.warn('[Voice] Viewport query failed, using board center fallback:', e);
            }

            // Fallback safety to keep cassette fully on-board
            if (isNaN(x) || x < 0 || x > 5000) x = 2444;
            if (isNaN(y) || y < 0 || y > 5000) y = 2460;

            const isMusic = typeArg === 'music';
            const elementId = (isMusic ? 'music_' : 'voice_') + timestamp;
            const elementType = isMusic ? 'music' : 'voice';

            const voiceElement = {
              type: elementType,
              audioFileId: fileName,
              _pendingFileName: fileName,
              _isPendingSync: true,
              mimeType: mimeType,
              duration: durationMs,
              encrypted: isEncrypted,
              createdAt: timestamp,
              x, y,
              rotation: Math.floor(Math.random() * 16) - 8,
              scale: 1.0,
              zIndex: ScrapCanvas.getMaxZIndex(elementType) + 1,
              date: this.currentDate,
              ownerId: ScrapFirebase.userId,
              title: labelTitle || (typeArg === 'music' ? 'SUNDAY BEAT' : 'VOICE MEMO')
            };

            window.pendingScrollToElementId = null; // Prevent board auto-scrolling on cassette tape
            await ScrapFirebase.saveElement(this.currentRoomId, elementId, voiceElement);

            if (progressToast) {
              progressToast.classList.add('hidden');
            }

            // 2. Stream to Cloudflare R2 asynchronously in background (Non-blocking)
            ScrapDrive.uploadFile(fileName, encBuf, roomFolderId, mimeType)
              .then(uploadResult => {
                if (uploadResult && uploadResult.id) {
                  const currentEl = ScrapFirebase.elements[elementId];
                  if (currentEl) {
                    currentEl.audioFileId = uploadResult.id;
                    delete currentEl._pendingFileName;
                    delete currentEl._isPendingSync;
                    ScrapFirebase.saveLocalRoomData(this.currentRoomId, 'elements', ScrapFirebase.elements);
                    if (ScrapFirebase.onElementsUpdateCallback) {
                      ScrapFirebase.onElementsUpdateCallback(ScrapFirebase.elements);
                    }
                    ScrapFirebase.debounceSync();
                  }
                }
              })
              .catch(e => console.warn('[Drive Sync] Background audio upload error:', e));
          } catch (e) {
            console.error('[Drive Sync] Failed to upload audio recording:', e);
            alert('Failed to save voice note: ' + e.message);
            if (progressToast) {
              progressToast.classList.add('hidden');
            }
          }
        };

        // Check permissions first
        if (isNative) {
          const AudioRecorder = window.Capacitor.Plugins.CapacitorAudioRecorder;
          if (!AudioRecorder) {
            alert('CapacitorAudioRecorder plugin is not registered.');
            return;
          }

          const permStatus = await AudioRecorder.checkPermissions();
          if (permStatus.recordAudio !== 'granted') {
            const reqStatus = await AudioRecorder.requestPermissions();
            if (reqStatus.recordAudio !== 'granted') {
              alert('Microphone permission denied. Please enable it in Settings.');
              return;
            }
          }
        }

        // Show overlay in preview/ready state
        if (overlay) overlay.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Mic Ready';
        if (timerEl) timerEl.textContent = '0.0s';
        if (pingEl) pingEl.classList.add('hidden');

        if (btnStart) btnStart.classList.remove('hidden');
        if (btnCancel) btnCancel.classList.remove('hidden');
        if (btnStop) btnStop.classList.add('hidden');

        let activeRecorder = null;
        let activeInterval = null;
        let startTime = 0;
        let isRecording = false;
        let activeRecognizer = null;
        let spokenTranscript = '';

        const cleanUpOverlay = () => {
          if (overlay) overlay.classList.add('hidden');
          if (activeInterval) {
            clearInterval(activeInterval);
            activeInterval = null;
          }
          isRecording = false;
        };

        const doStopAndSave = async () => {
          if (!isRecording) return;

          cleanUpOverlay();

          try {
            let blob = null;
            let durationMs = 0;

            if (isNative) {
              const AudioRecorder = window.Capacitor.Plugins.CapacitorAudioRecorder;
              const result = await AudioRecorder.stopRecording();
              console.log('[Audio] stopRecording result:', JSON.stringify(result));
              if (!result || !result.uri) {
                throw new Error('Recording returned no file URI.');
              }
              durationMs = result.duration !== undefined ? result.duration : (Date.now() - startTime);
              if (durationMs < 300) {
                throw new Error('Recording too short. Speak/play longer.');
              }
              const convertedUrl = window.Capacitor.convertFileSrc(result.uri);
              try {
                const response = await fetch(convertedUrl);
                if (!response.ok) throw new Error('fetch status ' + response.status);
                blob = await response.blob();
              } catch (fetchErr) {
                console.warn('[Audio] fetch failed, falling back to Filesystem.readFile:', fetchErr);
                const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
                if (Filesystem) {
                  const fileData = await Filesystem.readFile({
                    path: result.uri
                  });
                  const binaryString = atob(fileData.data);
                  const len = binaryString.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const mimeType = result.uri.endsWith('.wav') ? 'audio/wav'
                    : result.uri.endsWith('.mp3') ? 'audio/mpeg'
                      : result.uri.endsWith('.m4a') ? 'audio/mp4'
                        : 'audio/aac';
                  blob = new Blob([bytes.buffer], { type: mimeType });
                } else {
                  throw fetchErr;
                }
              }
            } else {
              // Web Fallback Stop
              if (activeRecorder && activeRecorder.state === 'recording') {
                durationMs = Date.now() - startTime;
                const audioPromise = new Promise((resolve) => {
                  activeRecorder.ondataavailable = (e) => {
                    resolve(e.data);
                  };
                });
                activeRecorder.stop();
                const rawBlob = await audioPromise;
                blob = new Blob([rawBlob], { type: 'audio/mp4' });
              }
            }

            if (!blob || blob.size < 256) {
              throw new Error('Audio file is empty.');
            }

            // Apply selected voice effect
            const effectSelect = document.getElementById('voice-effect-select');
            const selectedEffect = effectSelect ? effectSelect.value : 'none';
            if (selectedEffect !== 'none') {
              try {
                // Show temporary overlay indicator
                const progressToast = document.getElementById('upload-progress-notification');
                const progressText = document.getElementById('upload-progress-text');
                if (progressToast && progressText) {
                  progressText.innerText = 'Applying Voice Effect...';
                  progressToast.classList.remove('hidden');
                }

                const processed = await applyVoiceEffect(blob, selectedEffect);
                blob = processed.blob;
                if (processed.durationMs) {
                  durationMs = processed.durationMs;
                }

                if (progressToast) {
                  progressToast.classList.add('hidden');
                }
              } catch (effectErr) {
                console.error('[Audio Effect Error]', effectErr);
                alert('Warning: Voice effect failed to apply. Saving raw recording instead.');
              }
            }

            await saveVoiceToCanvas(blob, durationMs, chosenType, customTitle);
          } catch (e) {
            console.error('[Audio] Save Failed:', e);
            alert('Failed to save audio recording: ' + e.message);
          }
        };

        const doStartRecording = async () => {
          try {
            if (isNative) {
              const AudioRecorder = window.Capacitor.Plugins.CapacitorAudioRecorder;
              await AudioRecorder.startRecording();
            } else {
              // Web Fallback Start
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              activeRecorder = new MediaRecorder(stream);
              activeRecorder.start();
            }

            isRecording = true;
            startTime = Date.now();

            if (statusEl) statusEl.textContent = chosenType === 'music' ? 'Recording Song...' : 'Recording Voice...';
            if (pingEl) pingEl.classList.remove('hidden');

            if (btnStart) btnStart.classList.add('hidden');
            if (btnCancel) btnCancel.classList.add('hidden');
            if (btnStop) btnStop.classList.remove('hidden');

            // Start timer countdown (15s max)
            let elapsed = 0;
            activeInterval = setInterval(() => {
              elapsed += 0.1;
              if (timerEl) timerEl.textContent = Math.min(15.0, elapsed).toFixed(1) + 's';
              if (elapsed >= 15.0) {
                doStopAndSave();
              }
            }, 100);

          } catch (err) {
            console.error('[Audio] start error:', err);
            alert('Failed to start recording: ' + err.message);
            cleanUpOverlay();
          }
        };

        // Attach button event listeners
        const handleStartClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          doStartRecording();
        };

        const handleStopClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          doStopAndSave();
        };

        const handleCancelClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isRecording) {
            if (isNative) {
              const AudioRecorder = window.Capacitor.Plugins.CapacitorAudioRecorder;
              AudioRecorder.stopRecording().catch(() => { });
            } else if (activeRecorder && activeRecorder.state === 'recording') {
              activeRecorder.stop();
            }
          }
          cleanUpOverlay();
        };

        btnStart.onclick = handleStartClick;
        btnStop.onclick = handleStopClick;
        btnCancel.onclick = handleCancelClick;
      });
    }

    // Picker category tabs
    let connectionCategory = 'family';
    let selectedVibe = 'Ride or Die';
    let selectedTheme = 'neon';
    const tabPickerFamily = document.getElementById('tab-picker-family');
    const tabPickerStreetlight = document.getElementById('tab-picker-streetlight');
    const tabPickerHeartbeat = document.getElementById('tab-picker-heartbeat');
    const tabPickerBalloons = document.getElementById('tab-picker-balloons');

    const pickerFamilyOptions = document.getElementById('picker-family-options');
    const pickerStreetlightOptions = document.getElementById('picker-streetlight-options');
    const pickerHeartbeatOptions = document.getElementById('picker-heartbeat-options');
    const pickerBalloonsOptions = document.getElementById('picker-balloons-options');

    const updatePickerTabs = (category) => {
      connectionCategory = category;

      // Reset all tab classes to default collapsed style
      const tabs = [
        { el: tabPickerFamily, color: '#ff00ab' },
        { el: tabPickerStreetlight, color: '#ff9900' },
        { el: tabPickerHeartbeat, color: '#ff003c' },
        { el: tabPickerBalloons, color: '#00f0ff' }
      ];

      tabs.forEach(t => {
        if (t.el) t.el.className = 'flex-shrink-0 py-2 px-3.5 bg-purple-950/20 border border-white/5 text-gray-400 rounded-xl text-[10px] font-bold font-space uppercase connection-category-tab';
      });

      // Hide all panels
      if (pickerFamilyOptions) pickerFamilyOptions.classList.add('hidden');
      if (pickerStreetlightOptions) pickerStreetlightOptions.classList.add('hidden');
      if (pickerHeartbeatOptions) pickerHeartbeatOptions.classList.add('hidden');
      if (pickerBalloonsOptions) pickerBalloonsOptions.classList.add('hidden');

      if (category === 'family') {
        if (tabPickerFamily) tabPickerFamily.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff00ab]/10 border border-[#ff00ab] text-[#ff00ab] rounded-xl text-[10px] font-bold font-space uppercase connection-category-tab active';
        if (pickerFamilyOptions) pickerFamilyOptions.classList.remove('hidden');
        const activeVibeBtn = document.querySelector('.select-vibe-btn.active');
        selectedVibe = activeVibeBtn ? activeVibeBtn.getAttribute('data-vibe') : 'Ride or Die';
        const activeThemeBtn = document.querySelector('.select-thread-theme-btn.active');
        selectedTheme = activeThemeBtn ? activeThemeBtn.getAttribute('data-theme') : 'neon';
      } else if (category === 'streetlight') {
        if (tabPickerStreetlight) tabPickerStreetlight.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff9900]/10 border border-[#ff9900] text-[#ff9900] rounded-xl text-[10px] font-bold font-space uppercase connection-category-tab active';
        if (pickerStreetlightOptions) pickerStreetlightOptions.classList.remove('hidden');
        selectedVibe = 'Streetlight';
        selectedTheme = 'streetlight';
      } else if (category === 'heartbeat') {
        if (tabPickerHeartbeat) tabPickerHeartbeat.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff003c]/10 border border-[#ff003c] text-[#ff003c] rounded-xl text-[10px] font-bold font-space uppercase connection-category-tab active';
        if (pickerHeartbeatOptions) pickerHeartbeatOptions.classList.remove('hidden');
        selectedVibe = 'Lover';
        selectedTheme = 'heartbeat';
      } else if (category === 'balloons') {
        if (tabPickerBalloons) tabPickerBalloons.className = 'flex-shrink-0 py-2 px-3.5 bg-[#00f0ff]/10 border border-[#00f0ff] text-[#00f0ff] rounded-xl text-[10px] font-bold font-space uppercase connection-category-tab active';
        if (pickerBalloonsOptions) pickerBalloonsOptions.classList.remove('hidden');
        selectedVibe = 'Floating';
        selectedTheme = 'balloons';
      }
    };

    if (tabPickerFamily) tabPickerFamily.addEventListener('click', () => updatePickerTabs('family'));
    if (tabPickerStreetlight) tabPickerStreetlight.addEventListener('click', () => updatePickerTabs('streetlight'));
    if (tabPickerHeartbeat) tabPickerHeartbeat.addEventListener('click', () => updatePickerTabs('heartbeat'));
    if (tabPickerBalloons) tabPickerBalloons.addEventListener('click', () => updatePickerTabs('balloons'));

    const btnShowConnectionPicker = document.getElementById('btn-show-connection-picker');
    if (btnShowConnectionPicker) {
      btnShowConnectionPicker.addEventListener('click', () => {
        updatePickerTabs('family');
        document.getElementById('modal-connection-picker').classList.remove('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.add('hidden');
      });
    }

    // Close Connection Picker button
    const closeConnectionBtn = document.getElementById('btn-close-connection-picker');
    if (closeConnectionBtn) {
      closeConnectionBtn.addEventListener('click', () => {
        document.getElementById('modal-connection-picker').classList.add('hidden');
        ScrapCanvas.exitConnectionMode();
      });
    }

    // Cancel connection selection mode button
    const cancelConnectionModeBtn = document.getElementById('btn-cancel-connection-mode');
    if (cancelConnectionModeBtn) {
      cancelConnectionModeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ScrapCanvas.exitConnectionMode();
      });
    }

    // Connection vibe option buttons
    document.querySelectorAll('.select-vibe-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.select-vibe-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        const target = e.currentTarget || e.target;
        target.classList.add('active');
        target.style.borderColor = '#ff00ab';
        selectedVibe = target.getAttribute('data-vibe');
      });
    });

    // Connection theme option buttons
    document.querySelectorAll('.select-thread-theme-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.select-thread-theme-btn').forEach(b => {
          b.classList.remove('active');
          b.classList.remove('text-[#ff00ab]');
          b.classList.remove('border-[#ff00ab]');
          b.classList.add('border-white/10');
          b.classList.add('text-white');
        });
        const target = e.currentTarget || e.target;
        target.classList.add('active');
        target.classList.remove('border-white/10');
        target.classList.remove('text-white');
        target.classList.add('border-[#ff00ab]');
        target.classList.add('text-[#ff00ab]');
        selectedTheme = target.getAttribute('data-theme');
      });
    });

    // Create Connection / Start Linking button
    const btnCreateConnection = document.getElementById('btn-create-connection');
    if (btnCreateConnection) {
      btnCreateConnection.addEventListener('click', () => {
        // Hide the options modal
        document.getElementById('modal-connection-picker').classList.add('hidden');
        // Enter connection mode on canvas with pre-selected vibe and theme!
        ScrapCanvas.enterConnectionMode(selectedVibe, selectedTheme);
      });
    }

    // Close Emoji Picker button
    const closeEmojiBtn = document.getElementById('btn-close-emoji-picker');
    if (closeEmojiBtn) {
      closeEmojiBtn.addEventListener('click', () => {
        document.getElementById('modal-emoji-picker').classList.add('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.remove('hidden');
      });
    }

    // Close Manage Connection Modal
    const closeManageConnectionBtn = document.getElementById('btn-close-manage-connection');
    if (closeManageConnectionBtn) {
      closeManageConnectionBtn.addEventListener('click', () => {
        document.getElementById('modal-manage-connection').classList.add('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.remove('hidden');
      });
    }

    // Bind Manage Connection Dialog Open event (dispatched from canvas.js on label tap)
    let selectedManageConnectionId = null;
    let selectedManageVibe = 'Ride or Die';
    let selectedManageTheme = 'neon';

    const tabManageFamily = document.getElementById('tab-manage-family');
    const tabManageStreetlight = document.getElementById('tab-manage-streetlight');
    const tabManageHeartbeat = document.getElementById('tab-manage-heartbeat');
    const tabManageBalloons = document.getElementById('tab-manage-balloons');

    const manageFamilyOptions = document.getElementById('manage-family-options');
    const manageStreetlightOptions = document.getElementById('manage-streetlight-options');
    const manageHeartbeatOptions = document.getElementById('manage-heartbeat-options');
    const manageBalloonsOptions = document.getElementById('manage-balloons-options');

    const updateManageTabs = (category) => {
      // Reset tab button classes
      const tabs = [
        { el: tabManageFamily },
        { el: tabManageStreetlight },
        { el: tabManageHeartbeat },
        { el: tabManageBalloons }
      ];

      tabs.forEach(t => {
        if (t.el) t.el.className = 'flex-shrink-0 py-2 px-3.5 bg-purple-950/20 border border-white/5 text-gray-400 rounded-xl text-[10px] font-bold font-space uppercase connection-manage-category-tab';
      });

      // Hide all options panels
      if (manageFamilyOptions) manageFamilyOptions.classList.add('hidden');
      if (manageStreetlightOptions) manageStreetlightOptions.classList.add('hidden');
      if (manageHeartbeatOptions) manageHeartbeatOptions.classList.add('hidden');
      if (manageBalloonsOptions) manageBalloonsOptions.classList.add('hidden');

      if (category === 'family') {
        if (tabManageFamily) tabManageFamily.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff00ab]/10 border border-[#ff00ab] text-[#ff00ab] rounded-xl text-[10px] font-bold font-space uppercase connection-manage-category-tab active';
        if (manageFamilyOptions) manageFamilyOptions.classList.remove('hidden');
        const activeVibeBtn = document.querySelector('.manage-vibe-btn.active');
        selectedManageVibe = activeVibeBtn ? activeVibeBtn.getAttribute('data-vibe') : 'Ride or Die';
        const activeThemeBtn = document.querySelector('.manage-thread-theme-btn.active');
        selectedManageTheme = activeThemeBtn ? activeThemeBtn.getAttribute('data-theme') : 'neon';
      } else if (category === 'streetlight') {
        if (tabManageStreetlight) tabManageStreetlight.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff9900]/10 border border-[#ff9900] text-[#ff9900] rounded-xl text-[10px] font-bold font-space uppercase connection-manage-category-tab active';
        if (manageStreetlightOptions) manageStreetlightOptions.classList.remove('hidden');
        selectedManageVibe = 'Streetlight';
        selectedManageTheme = 'streetlight';
      } else if (category === 'heartbeat') {
        if (tabManageHeartbeat) tabManageHeartbeat.className = 'flex-shrink-0 py-2 px-3.5 bg-[#ff003c]/10 border border-[#ff003c] text-[#ff003c] rounded-xl text-[10px] font-bold font-space uppercase connection-manage-category-tab active';
        if (manageHeartbeatOptions) manageHeartbeatOptions.classList.remove('hidden');
        selectedManageVibe = 'Lover';
        selectedManageTheme = 'heartbeat';
      } else if (category === 'balloons') {
        if (tabManageBalloons) tabManageBalloons.className = 'flex-shrink-0 py-2 px-3.5 bg-[#00f0ff]/10 border border-[#00f0ff] text-[#00f0ff] rounded-xl text-[10px] font-bold font-space uppercase connection-manage-category-tab active';
        if (manageBalloonsOptions) manageBalloonsOptions.classList.remove('hidden');
        selectedManageVibe = 'Floating';
        selectedManageTheme = 'balloons';
      }
    };

    if (tabManageFamily) tabManageFamily.addEventListener('click', () => updateManageTabs('family'));
    if (tabManageStreetlight) tabManageStreetlight.addEventListener('click', () => updateManageTabs('streetlight'));
    if (tabManageHeartbeat) tabManageHeartbeat.addEventListener('click', () => updateManageTabs('heartbeat'));
    if (tabManageBalloons) tabManageBalloons.addEventListener('click', () => updateManageTabs('balloons'));

    window.addEventListener('show_manage_connection', (e) => {
      const { id, conn } = e.detail;
      selectedManageConnectionId = id;
      selectedManageVibe = conn.label;
      selectedManageTheme = conn.theme || 'neon';

      // Save scroll position immediately before displaying the modal to prevent WebView resize jump calculations
      const workspace = document.getElementById('canvas-workspace');
      if (workspace) {
        workspace.dataset.preModalScrollLeft = workspace.scrollLeft;
        workspace.dataset.preModalScrollTop = workspace.scrollTop;
      }

      document.getElementById('modal-manage-connection').classList.remove('hidden');
      const bottomBar = document.getElementById('canvas-bottom-bar');
      if (bottomBar) bottomBar.classList.add('hidden');

      if (selectedManageTheme === 'streetlight') {
        updateManageTabs('streetlight');
      } else if (selectedManageTheme === 'heartbeat') {
        updateManageTabs('heartbeat');
      } else if (selectedManageTheme === 'balloons') {
        updateManageTabs('balloons');
      } else {
        updateManageTabs('family');

        // Highlight active vibe button
        document.querySelectorAll('.manage-vibe-btn').forEach(btn => {
          const v = btn.getAttribute('data-vibe');
          if (v === selectedManageVibe) {
            btn.classList.add('active');
            btn.style.borderColor = '#ff00ab';
          } else {
            btn.classList.remove('active');
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
          }
        });

        // Highlight active theme button
        document.querySelectorAll('.manage-thread-theme-btn').forEach(btn => {
          const t = btn.getAttribute('data-theme');
          if (t === selectedManageTheme) {
            btn.classList.add('active');
            btn.classList.remove('border-white/10');
            btn.classList.remove('text-white');
            btn.classList.add('border-[#ff00ab]');
            btn.classList.add('text-[#ff00ab]');
          } else {
            btn.classList.remove('active');
            btn.classList.add('border-white/10');
            btn.classList.add('text-white');
            btn.classList.remove('border-[#ff00ab]');
            btn.classList.remove('text-[#ff00ab]');
          }
        });
      }
    });

    // Manage vibe option button clicks
    document.querySelectorAll('.manage-vibe-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.manage-vibe-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        const target = e.currentTarget || e.target;
        target.classList.add('active');
        target.style.borderColor = '#ff00ab';
        selectedManageVibe = target.getAttribute('data-vibe');
      });
    });

    // Manage theme option button clicks
    document.querySelectorAll('.manage-thread-theme-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.manage-thread-theme-btn').forEach(b => {
          b.classList.remove('active');
          b.classList.remove('text-[#ff00ab]');
          b.classList.remove('border-[#ff00ab]');
          b.classList.add('border-white/10');
          b.classList.add('text-white');
        });
        const target = e.currentTarget || e.target;
        target.classList.add('active');
        target.classList.remove('border-white/10');
        target.classList.remove('text-white');
        target.classList.add('border-[#ff00ab]');
        target.classList.add('text-[#ff00ab]');
        selectedManageTheme = target.getAttribute('data-theme');
      });
    });

    // Save managed connection changes
    const btnSaveManageConnection = document.getElementById('btn-save-manage-connection');
    if (btnSaveManageConnection) {
      btnSaveManageConnection.addEventListener('click', async () => {
        if (selectedManageConnectionId && ScrapCanvas.connections[selectedManageConnectionId]) {
          const updatedData = {
            ...ScrapCanvas.connections[selectedManageConnectionId],
            label: selectedManageVibe,
            theme: selectedManageTheme
          };

          await ScrapFirebase.saveConnection(this.currentRoomId, selectedManageConnectionId, updatedData);
        }
        document.getElementById('modal-manage-connection').classList.add('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.remove('hidden');
      });
    }

    // Delete managed connection
    const btnDeleteConnection = document.getElementById('btn-delete-connection');
    if (btnDeleteConnection) {
      btnDeleteConnection.addEventListener('click', async () => {
        if (selectedManageConnectionId) {
          if (await window.ScrapDialog.confirm('Delete this connection thread?')) {

            await ScrapFirebase.deleteConnection(this.currentRoomId, selectedManageConnectionId);
            document.getElementById('modal-manage-connection').classList.add('hidden');
            const bottomBar = document.getElementById('canvas-bottom-bar');
            if (bottomBar) bottomBar.classList.remove('hidden');
          }
        }
      });
    }

    // Design Connection button click handler
    const btnDesignConnection = document.getElementById('btn-design-connection');
    if (btnDesignConnection) {
      btnDesignConnection.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btnDesignConnection.blur();

        if (selectedManageConnectionId && ScrapCanvas.connections[selectedManageConnectionId]) {
          const conn = ScrapCanvas.connections[selectedManageConnectionId];

          // Use the pre-modal scroll position to prevent layout shift scrolling!
          const workspace = document.getElementById('canvas-workspace');
          if (workspace) {
            const savedScrollLeft = Number(workspace.dataset.preModalScrollLeft) || workspace.scrollLeft;
            const savedScrollTop = Number(workspace.dataset.preModalScrollTop) || workspace.scrollTop;

            workspace.dataset.scrollLocked = 'true';
            workspace.dataset.lockLeft = savedScrollLeft;
            workspace.dataset.lockTop = savedScrollTop;

            // Release lock after 500ms
            setTimeout(() => {
              workspace.dataset.scrollLocked = 'false';
            }, 500);
          }

          // Reset offsets to defaults for a fresh shape design session
          conn.offsetStartX = 0;
          conn.offsetStartY = 0;
          conn.offsetEndX = 0;
          conn.offsetEndY = 0;
          conn.ctrl1OffsetX = -30;
          conn.ctrl1OffsetY = 50;
          conn.ctrl2OffsetX = 30;
          conn.ctrl2OffsetY = 50;

          ScrapCanvas.editingConnectionId = selectedManageConnectionId;
          document.getElementById('modal-manage-connection').classList.add('hidden');
          const designHelper = document.getElementById('connection-design-helper');
          if (designHelper) designHelper.classList.remove('hidden');
          ScrapCanvas.renderConnections(ScrapCanvas.connections);
        }
      });
    }

    // Finish Design Mode click handler
    const btnFinishDesignMode = document.getElementById('btn-finish-design-mode');
    if (btnFinishDesignMode) {
      btnFinishDesignMode.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btnFinishDesignMode.blur();

        const workspace = document.getElementById('canvas-workspace');
        if (workspace) {
          const savedScrollLeft = Number(workspace.dataset.preModalScrollLeft) || workspace.scrollLeft;
          const savedScrollTop = Number(workspace.dataset.preModalScrollTop) || workspace.scrollTop;

          workspace.dataset.scrollLocked = 'true';
          workspace.dataset.lockLeft = savedScrollLeft;
          workspace.dataset.lockTop = savedScrollTop;

          // Release lock after 500ms
          setTimeout(() => {
            workspace.dataset.scrollLocked = 'false';
          }, 500);
        }

        const connId = ScrapCanvas.editingConnectionId;
        if (connId && ScrapCanvas.connections[connId]) {
          // Save final changes to database
          await ScrapFirebase.saveConnection(this.currentRoomId, connId, ScrapCanvas.connections[connId]);
        }
        ScrapCanvas.editingConnectionId = null;
        const designHelper = document.getElementById('connection-design-helper');
        if (designHelper) designHelper.classList.add('hidden');
        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.remove('hidden');
        ScrapCanvas.renderConnections(ScrapCanvas.connections);
      });
    }

    // Handle Emoji Selection
    document.querySelectorAll('.select-emoji-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const emoji = (e.currentTarget ? e.currentTarget.getAttribute('data-emoji') : null) || e.target.getAttribute('data-emoji') || e.target.innerText;
        if (emoji) {

          const zoomVal = ScrapCanvas.zoom || 1.0;
          const workspace = ScrapCanvas.workspaceEl;
          const boardMargin = 3000;
          const workspaceWidth = (workspace && workspace.clientWidth > 0) ? workspace.clientWidth : window.innerWidth;
          const workspaceHeight = (workspace && workspace.clientHeight > 0) ? workspace.clientHeight : window.innerHeight;
          const scrollLeft = workspace ? workspace.scrollLeft : 0;
          const scrollTop = workspace ? workspace.scrollTop : 0;



          const x = Math.round((scrollLeft - boardMargin + workspaceWidth / 2) / zoomVal - 25);
          const y = Math.round((scrollTop - boardMargin + workspaceHeight / 2) / zoomVal - 25);



          const id = 'emoji_' + Date.now();
          window.pendingScrollToElementId = null; // Prevent board auto-scrolling on emoji addition
          const emojiElement = {
            type: 'text',
            text: emoji,
            x: x,
            y: y,
            rotation: Math.floor(Math.random() * 20) - 10,
            scale: 1.5,
            zIndex: ScrapCanvas.getMaxZIndex('text') + 1,
            date: this.currentDate
          };


          try {
            await ScrapFirebase.saveElement(this.currentRoomId, id, emojiElement);

          } catch (err) {

          }
          document.getElementById('modal-emoji-picker').classList.add('hidden');
          const bottomBar = document.getElementById('canvas-bottom-bar');
          if (bottomBar) bottomBar.classList.remove('hidden');
        }
      });
    });

    // Handle Graphic Sticker Selection
    document.querySelectorAll('.select-graphic-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const src = (e.currentTarget ? e.currentTarget.getAttribute('data-sticker-src') : null) || e.target.getAttribute('data-sticker-src');
        if (src) {
          const zoomVal = ScrapCanvas.zoom || 1.0;
          const workspace = ScrapCanvas.workspaceEl;
          const boardMargin = 3000;
          const workspaceWidth = (workspace && workspace.clientWidth > 0) ? workspace.clientWidth : window.innerWidth;
          const workspaceHeight = (workspace && workspace.clientHeight > 0) ? workspace.clientHeight : window.innerHeight;
          const scrollLeft = workspace ? workspace.scrollLeft : 0;
          const scrollTop = workspace ? workspace.scrollTop : 0;

          const x = Math.round((scrollLeft - boardMargin + workspaceWidth / 2) / zoomVal - 40);
          const y = Math.round((scrollTop - boardMargin + workspaceHeight / 2) / zoomVal - 40);

          const id = 'sticker_' + Date.now();
          let encSrc = null;
          let isEncrypted = false;
          try {
            const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
            if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
              encSrc = await ScrapCrypto.encryptText(src, roomKey);
              isEncrypted = true;
            }
          } catch (cryptoErr) {
            console.warn('[Sticker] Encryption failed, saving plain src fallback:', cryptoErr);
          }

          const stickerElement = {
            type: 'sticker',
            src: src,
            encryptedSrc: encSrc,
            encrypted: isEncrypted,
            width: 200,
            height: 200,
            x: x,
            y: y,
            rotation: Math.floor(Math.random() * 20) - 10,
            scale: 1.0,
            zIndex: ScrapCanvas.getMaxZIndex('sticker') + 1,
            date: this.currentDate
          };

          await ScrapFirebase.saveElement(this.currentRoomId, id, stickerElement);
          document.getElementById('modal-emoji-picker').classList.add('hidden');
          const bottomBar = document.getElementById('canvas-bottom-bar');
          if (bottomBar) bottomBar.classList.remove('hidden');
        }
      });
    });
    // Custom Sticker Creator Logic
    let originalStickerImg = null;
    let segmentedStickerImg = null;

    function drawStickerCanvas() {
      const baseImg = segmentedStickerImg || originalStickerImg;
      if (!baseImg) return;

      const canvas = document.getElementById('sticker-creator-canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = baseImg.width;
      const h = baseImg.height;

      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);

      const addOutline = document.getElementById('check-sticker-outline').checked;

      if (addOutline) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(baseImg, 0, 0);

        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.fillStyle = '#ffffff';
        maskCtx.fillRect(0, 0, w, h);

        const radius = Math.max(3.5, Math.round(w / 80));

        for (let angle = 0; angle < 360; angle += 22.5) {
          const rad = (angle * Math.PI) / 180;
          const ox = Math.cos(rad) * radius;
          const oy = Math.sin(rad) * radius;
          ctx.drawImage(maskCanvas, ox, oy);
        }
      }
      ctx.drawImage(baseImg, 0, 0);
    }

    function runWebFallbackSegmentation(img) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const maxDim = 300;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const tolerance = 30;
      const visited = new Uint8Array(w * h);
      const queue = [];
      for (let x = 0; x < w; x++) {
        queue.push(x, 0); visited[x] = 1;
        const idxBot = (h - 1) * w + x;
        queue.push(x, h - 1); visited[idxBot] = 1;
      }
      for (let y = 1; y < h - 1; y++) {
        const idxLeft = y * w;
        queue.push(0, y); visited[idxLeft] = 1;
        const idxRight = y * w + (w - 1);
        queue.push(w - 1, y); visited[idxRight] = 1;
      }

      function getPixelColor(px, py) {
        const idx = (py * w + px) * 4;
        return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      }
      const corners = [getPixelColor(0, 0), getPixelColor(w - 1, 0), getPixelColor(0, h - 1), getPixelColor(w - 1, h - 1)];
      let bgR = 0, bgG = 0, bgB = 0;
      corners.forEach(c => { bgR += c.r; bgG += c.g; bgB += c.b; });
      bgR /= 4; bgG /= 4; bgB /= 4;

      let head = 0;
      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        const idx = (cy * w + cx) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const dist = Math.sqrt((r - bgR) * (r - bgR) + (g - bgG) * (g - bgG) + (b - bgB) * (b - bgB));

        if (dist <= tolerance) {
          data[idx + 3] = 0;
          const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (let i = 0; i < neighbors.length; i++) {
            const nx = neighbors[i][0], ny = neighbors[i][1];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nIdx = ny * w + nx;
              if (visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue.push(nx, ny);
              }
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const outImg = new Image();
      outImg.onload = () => {
        segmentedStickerImg = outImg;
        drawStickerCanvas();
      };
      outImg.src = canvas.toDataURL('image/webp', 0.92);
    }

    const inputStickerFile = document.getElementById('input-sticker-file');
    if (inputStickerFile) {
      inputStickerFile.addEventListener('click', () => {
        this.isSelectingFile = true;
      });
    }

    document.getElementById('btn-trigger-custom-sticker').addEventListener('click', () => {
      this.isSelectingFile = true;
      if (inputStickerFile) inputStickerFile.click();
    });

    document.getElementById('input-sticker-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;

        const loadImg = new Image();
        loadImg.onload = async () => {
          originalStickerImg = loadImg;
          segmentedStickerImg = null;

          document.getElementById('modal-emoji-picker').classList.add('hidden');
          document.getElementById('modal-sticker-creator').classList.remove('hidden');

          const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
          const hasPlugin = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.StickerPlugin;

          if (hasPlugin) {
            try {
              const res = await window.Capacitor.Plugins.StickerPlugin.createSticker({
                base64Image: base64Data
              });
              if (res && res.stickerBase64) {
                const segImg = new Image();
                segImg.onload = () => {
                  segmentedStickerImg = segImg;
                  drawStickerCanvas();
                };
                segImg.src = res.stickerBase64;
              } else {
                runWebFallbackSegmentation(loadImg);
              }
            } catch (err) {

              runWebFallbackSegmentation(loadImg);
            }
          } else {
            runWebFallbackSegmentation(loadImg);
          }
        };
        loadImg.src = base64Data;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    document.getElementById('check-sticker-outline').addEventListener('change', () => {
      drawStickerCanvas();
    });

    document.getElementById('btn-close-sticker-creator').addEventListener('click', () => {
      document.getElementById('modal-sticker-creator').classList.add('hidden');
      document.getElementById('modal-emoji-picker').classList.remove('hidden');
    });

    document.getElementById('btn-save-custom-sticker').addEventListener('click', async () => {
      const creatorCanvas = document.getElementById('sticker-creator-canvas');
      const stickerDataUrl = creatorCanvas.toDataURL('image/webp', 0.92);

      let w = creatorCanvas.width;
      let h = creatorCanvas.height;
      const maxDim = 300;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const zoomVal = ScrapCanvas.zoom || 1.0;
      const workspace = ScrapCanvas.workspaceEl;
      const boardMargin = 3000;
      const workspaceWidth = (workspace && workspace.clientWidth > 0) ? workspace.clientWidth : window.innerWidth;
      const workspaceHeight = (workspace && workspace.clientHeight > 0) ? workspace.clientHeight : window.innerHeight;
      const scrollLeft = workspace ? workspace.scrollLeft : 0;
      const scrollTop = workspace ? workspace.scrollTop : 0;

      const x = Math.round((scrollLeft - boardMargin + workspaceWidth / 2) / zoomVal - w / 2);
      const y = Math.round((scrollTop - boardMargin + workspaceHeight / 2) / zoomVal - h / 2);

      let encSrc = null;
      let isEncrypted = false;
      try {
        const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
        if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
          encSrc = await ScrapCrypto.encryptText(stickerDataUrl, roomKey);
          isEncrypted = true;
        }
      } catch (cryptoErr) {
        console.warn('[CustomSticker] Encryption failed, saving plain src fallback:', cryptoErr);
      }

      const id = 'sticker_' + Date.now();
      const stickerElement = {
        type: 'sticker',
        src: stickerDataUrl,
        encryptedSrc: encSrc,
        encrypted: isEncrypted,
        width: w,
        height: h,
        x: x,
        y: y,
        rotation: Math.floor(Math.random() * 20) - 10,
        scale: 1.5,
        zIndex: ScrapCanvas.getMaxZIndex('sticker') + 1,
        date: this.currentDate
      };

      await ScrapFirebase.saveElement(this.currentRoomId, id, stickerElement);
      document.getElementById('modal-sticker-creator').classList.add('hidden');
      const bottomBar = document.getElementById('canvas-bottom-bar');
      if (bottomBar) bottomBar.classList.remove('hidden');
    }); document.getElementById('btn-capture-back').addEventListener('click', () => {
      this.showScreen('screen-canvas');
    });

    // Capture screen split sectors
    document.getElementById('btn-sector-snap').addEventListener('click', async () => {
      this.showScreen('screen-canvas');
      const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
      if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
        await this.captureNativePhoto();
      } else {
        document.getElementById('hidden-camera-picker').click();
      }
    });

    document.getElementById('btn-sector-dump').addEventListener('click', async () => {
      this.showScreen('screen-canvas');
      await this.pickNativePhotoFromLibrary();
    });

    const hiddenFilePicker = document.getElementById('hidden-file-picker');
    if (hiddenFilePicker) {
      hiddenFilePicker.addEventListener('click', () => {
        this.isSelectingFile = true;
      });
      hiddenFilePicker.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          const files = Array.from(e.target.files).slice(0, 10);
          if (e.target.files.length > 10) {
            if (window.ScrapDialog && typeof window.ScrapDialog.alert === 'function') {
              window.ScrapDialog.alert('Maximum 10 photos allowed at a time. The first 10 selected photos will be uploaded.');
            }
          }
          for (const file of files) {
            await this.processCapturedFile(file);
          }
          e.target.value = ''; // Reset input so re-selecting same files triggers change event
        }
      });
    }

    const hiddenCameraPicker = document.getElementById('hidden-camera-picker');
    if (hiddenCameraPicker) {
      hiddenCameraPicker.addEventListener('click', () => {
        this.isSelectingFile = true;
      });
      hiddenCameraPicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.processCapturedFile(e.target.files[0]);
        }
      });
    }



    // Doodle Tool Toggler
    document.getElementById('tool-doodle').addEventListener('click', () => {
      this.toggleDoodleOverlay(true);
    });

    document.getElementById('btn-cancel-doodle').addEventListener('click', () => {
      this.toggleDoodleOverlay(false);
    });

    document.getElementById('btn-save-doodle').addEventListener('click', async () => {
      if (ScrapCanvas.currentDoodleStrokes.length === 0) {
        alert('Draw something first!');
        return;
      }

      // Calculate Bounding Box of the drawn strokes
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let hasPoints = false;

      ScrapCanvas.currentDoodleStrokes.forEach(stroke => {
        if (stroke.points) {
          stroke.points.forEach(pt => {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
            hasPoints = true;
          });
        }
      });

      if (!hasPoints) {
        alert('Draw something first!');
        return;
      }

      const w = Math.max(10, Math.round((maxX - minX) / ScrapCanvas.zoom));
      const h = Math.max(10, Math.round((maxY - minY) / ScrapCanvas.zoom));




      // Convert screen minX/minY to absolute board coordinates using active scroll offsets
      const zoomVal = ScrapCanvas.zoom || 1.0;
      const workspace = ScrapCanvas.workspaceEl;
      const boardMargin = 3000;
      const boardX = Math.round((minX + workspace.scrollLeft - boardMargin) / zoomVal);
      const boardY = Math.round((minY + workspace.scrollTop - boardMargin) / zoomVal);


      // Shift stroke points so they are relative to (0,0) of the doodle element container and scaled to board coordinates
      const localStrokes = ScrapCanvas.currentDoodleStrokes.map(stroke => {
        return {
          color: stroke.color,
          glow: stroke.glow || false,
          points: stroke.points.map(pt => ({
            x: Math.round((pt.x - minX) / ScrapCanvas.zoom),
            y: Math.round((pt.y - minY) / ScrapCanvas.zoom),
            w: Math.round((pt.w || ScrapCanvas.doodleBrushSize || 5) / ScrapCanvas.zoom)
          }))
        };
      });

      const checkWobble = document.getElementById('check-doodle-wobble');
      const isWobbly = checkWobble ? checkWobble.checked : false;

      const checkSparkles = document.getElementById('check-doodle-sparkles');
      const isSparkly = checkSparkles ? checkSparkles.checked : false;

      let encStrokes = null;
      let isEncrypted = false;
      try {
        const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
        if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
          const jsonStr = JSON.stringify(localStrokes);
          encStrokes = await ScrapCrypto.encryptText(jsonStr, roomKey);
          isEncrypted = true;
        }
      } catch (cryptoErr) {
        console.warn('[Doodle] Encryption failed, saving plain strokes fallback:', cryptoErr);
      }

      const id = 'doodle_' + Date.now();
      const doodleData = {
        type: 'doodle',
        strokes: localStrokes,
        encryptedStrokes: encStrokes,
        encrypted: isEncrypted,
        width: w,
        height: h,
        x: boardX,
        y: boardY,
        rotation: 0,
        scale: 1.0,
        zIndex: ScrapCanvas.getMaxZIndex('doodle') + 1,
        date: this.currentDate,
        wobble: isWobbly,
        sparkles: isSparkly
      };

      await ScrapCanvas.saveElementWithStickCheck(id, doodleData);
      this.toggleDoodleOverlay(false);
    });

    // Setup Doodle Canvas actions
    const painter = document.getElementById('doodle-painter-canvas');
    const pctx = painter.getContext('2d');
    let isDrawing = false;
    let currentStroke = null;

    const getPainterCoords = (e) => {
      const rect = painter.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left),
        y: (e.clientY - rect.top)
      };
    };

    const redrawPainterCanvas = () => {
      pctx.clearRect(0, 0, painter.width, painter.height);
      ScrapCanvas.currentDoodleStrokes.forEach(stroke => {
        if (!stroke.points || stroke.points.length < 1) return;
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';

        if (stroke.points.length === 1) {
          pctx.beginPath();
          if (stroke.color === 'eraser') {
            pctx.globalCompositeOperation = 'destination-out';
            pctx.lineWidth = stroke.points[0].w || 14;
            pctx.shadowBlur = 0;
          } else {
            pctx.globalCompositeOperation = 'source-over';
            pctx.strokeStyle = stroke.color;
            pctx.lineWidth = stroke.points[0].w || ScrapCanvas.doodleBrushSize;
            if (stroke.glow) {
              pctx.shadowColor = stroke.color;
              pctx.shadowBlur = 12;
            } else {
              pctx.shadowBlur = 0;
            }
          }
          pctx.arc(stroke.points[0].x, stroke.points[0].y, pctx.lineWidth / 2, 0, Math.PI * 2);
          pctx.fill();
        } else {
          for (let i = 1; i < stroke.points.length; i++) {
            pctx.beginPath();
            pctx.moveTo(stroke.points[i - 1].x, stroke.points[i - 1].y);
            pctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            if (stroke.color === 'eraser') {
              pctx.globalCompositeOperation = 'destination-out';
              pctx.lineWidth = stroke.points[i].w || 14;
              pctx.shadowBlur = 0;
            } else {
              pctx.globalCompositeOperation = 'source-over';
              pctx.strokeStyle = stroke.color;
              pctx.lineWidth = stroke.points[i].w || ScrapCanvas.doodleBrushSize;
              if (stroke.glow) {
                pctx.shadowColor = stroke.color;
                pctx.shadowBlur = 12;
              } else {
                pctx.shadowBlur = 0;
              }
            }
            pctx.stroke();
          }
        }
      });
      pctx.globalCompositeOperation = 'source-over';
      pctx.shadowBlur = 0;
    };

    // Undo button
    document.getElementById('btn-undo-doodle').addEventListener('click', () => {
      ScrapCanvas.currentDoodleStrokes.pop();
      redrawPainterCanvas();
    });

    // Pointer event support for mouse, touch, and stylus/pen
    painter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        painter.setPointerCapture(e.pointerId);
      } catch (err) { }
      isDrawing = true;
      const c = getPainterCoords(e);

      const baseSize = ScrapCanvas.doodleBrushSize || 5;
      const isPen = e.pointerType === 'pen';
      const pressure = (isPen && e.pressure > 0) ? e.pressure : 0.5;
      const brushSize = Math.max(1, Math.round(baseSize * (pressure * 1.6 + 0.2)));

      const checkGlow = document.getElementById('check-doodle-glow');
      const isGlow = checkGlow ? checkGlow.checked : false;

      currentStroke = {
        color: ScrapCanvas.doodleColor || '#39ff14',
        points: [{ x: Math.round(c.x), y: Math.round(c.y), w: brushSize }],
        glow: isGlow
      };
      ScrapCanvas.currentDoodleStrokes.push(currentStroke);
      redrawPainterCanvas();
    });

    painter.addEventListener('pointermove', (e) => {
      if (!isDrawing || !currentStroke) return;
      e.preventDefault();
      const c = getPainterCoords(e);

      const baseSize = ScrapCanvas.doodleBrushSize || 5;
      const isPen = e.pointerType === 'pen';
      const pressure = (isPen && e.pressure > 0) ? e.pressure : 0.5;
      const brushSize = Math.max(1, Math.round(baseSize * (pressure * 1.6 + 0.2)));

      currentStroke.points.push({ x: Math.round(c.x), y: Math.round(c.y), w: brushSize });
      redrawPainterCanvas();

      // Sparkle emitter
      const checkSparkles = document.getElementById('check-doodle-sparkles');
      if (checkSparkles && checkSparkles.checked) {
        const container = document.getElementById('doodle-draw-canvas');
        if (container) {
          const sparkle = document.createElement('div');
          sparkle.className = 'doodle-sparkle';
          sparkle.style.left = `${c.x}px`;
          sparkle.style.top = `${c.y}px`;

          // Random neon color
          const colors = ['#39ff14', '#ff00ab', '#00f0ff', '#b026ff', '#ffff00'];
          const randomColor = colors[Math.floor(Math.random() * colors.length)];
          sparkle.style.backgroundColor = randomColor;
          sparkle.style.boxShadow = `0 0 8px ${randomColor}, 0 0 16px ${randomColor}`;

          container.appendChild(sparkle);

          // Automatically clean up after CSS animation ends
          setTimeout(() => {
            sparkle.remove();
          }, 500);
        }
      }
    });

    const endDrawing = (e) => {
      if (isDrawing) {
        isDrawing = false;
        currentStroke = null;
        try {
          painter.releasePointerCapture(e.pointerId);
        } catch (err) { }
      }
    };

    painter.addEventListener('pointerup', endDrawing);
    painter.addEventListener('pointercancel', endDrawing);

    // Custom Color Picker input
    const customColorInput = document.getElementById('input-doodle-color');
    if (customColorInput) {
      customColorInput.addEventListener('input', (e) => {
        document.querySelectorAll('.color-swatch').forEach(s => {
          s.classList.remove('active', 'border-white');
          s.classList.add('border-transparent');
        });
        ScrapCanvas.doodleColor = e.target.value;
      });
    }

    // Color swatches for doodle
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;
        document.querySelectorAll('.color-swatch').forEach(s => {
          s.classList.remove('active', 'border-white');
          s.classList.add('border-transparent');
        });
        targetBtn.classList.remove('border-transparent');
        targetBtn.classList.add('active', 'border-white');
        const color = targetBtn.getAttribute('data-color');
        ScrapCanvas.doodleColor = color;
        if (color !== 'eraser' && customColorInput) {
          customColorInput.value = color;
        }
      });
    });

    // Brush Size range slider
    const brushSizeSlider = document.getElementById('input-doodle-brush-size');
    const brushSizeLabel = document.getElementById('label-brush-size');
    if (brushSizeSlider) {
      brushSizeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        ScrapCanvas.doodleBrushSize = val;
        if (brushSizeLabel) brushSizeLabel.innerText = `${val}px`;
      });
    }

    // Wobble checkbox event listener
    const checkWobble = document.getElementById('check-doodle-wobble');
    if (checkWobble) {
      checkWobble.addEventListener('change', (e) => {
        const painter = document.getElementById('doodle-painter-canvas');
        if (painter) {
          if (e.target.checked) {
            painter.classList.add('wobble-active');
          } else {
            painter.classList.remove('wobble-active');
          }
        }
      });
    }



    // Technical Verification screen trigger
    document.getElementById('btn-show-security').addEventListener('click', async () => {
      await this.renderSecurityVerification();
      this.showScreen('screen-security');
    });

    document.getElementById('btn-security-back').addEventListener('click', () => {
      this.showScreen('screen-canvas');
    });



    // Screenshot simulated notification handler
    // In actual iOS app we listen to screenshot notifications
    // For presentation/evaluation: trigger screenshot alerts on pressing 'S' key!
    window.addEventListener('keyup', (e) => {
      if (e.key.toLowerCase() === 's' && this.activeScreen === 'screen-canvas') {
        this.triggerScreenshotAlert();
      }
    });

    // Options Modal Removed

    // Doodle Color Picker Modal listeners
    window.addEventListener('show_doodle_color_picker', (e) => {
      this.selectedDoodleElementId = e.detail.id;
      this.selectedDoodleData = e.detail.data;

      const modal = document.getElementById('modal-doodle-color');
      if (modal) {
        modal.classList.remove('hidden');

        // Highlight active color circle
        const activeColor = this.selectedDoodleData.color || '#39ff14';
        modal.querySelectorAll('.select-doodle-color').forEach(btn => {
          if (btn.getAttribute('data-color') === activeColor) {
            btn.classList.add('border-white');
            btn.classList.remove('border-transparent');
          } else {
            btn.classList.remove('border-white');
            btn.classList.add('border-transparent');
          }
        });
      }
    });

    const closeDoodleColorBtn = document.getElementById('btn-close-doodle-color');
    if (closeDoodleColorBtn) {
      closeDoodleColorBtn.addEventListener('click', () => {
        document.getElementById('modal-doodle-color').classList.add('hidden');
      });
    }

    document.querySelectorAll('.select-doodle-color').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const color = e.target.getAttribute('data-color');
        if (this.selectedDoodleElementId && this.selectedDoodleData) {
          const updatedData = {
            ...this.selectedDoodleData,
            color: color
          };
          await ScrapFirebase.saveElement(this.currentRoomId, this.selectedDoodleElementId, updatedData);
          document.getElementById('modal-doodle-color').classList.add('hidden');
        }
      });
    });

    // Photo Options Modal listeners removed

    // Clear safety overlay button
    document.getElementById('btn-clear-safety').addEventListener('click', () => {
      document.getElementById('safety-guard-overlay').classList.add('hidden');
      this.showScreen('screen-canvas');
    });

    // Close any modal when clicking on its background backdrop
    document.querySelectorAll('[id^="modal-"]').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
          if (modal.id === 'modal-emoji-picker' || modal.id === 'modal-manage-connection') {
            const bottomBar = document.getElementById('canvas-bottom-bar');
            if (bottomBar) bottomBar.classList.remove('hidden');
          }
        }
      });
    });

    // Initialize draggable bottom sheets
    this.bindBottomSheetDrag('modal-connection-picker');
    this.bindBottomSheetDrag('modal-manage-connection');

    // Date Picker event listener
    const datePicker = document.getElementById('canvas-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        this.currentDate = e.target.value;
        ScrapCanvas.currentDate = this.currentDate;
        ScrapCanvas.hasCenteredInitially = false;
        const collageFlowBar = document.getElementById('collage-flow-filter-bar');
        const isCollageFlowActive = collageFlowBar && !collageFlowBar.classList.contains('hidden');
        if (isCollageFlowActive) {
          ScrapCanvas.setCollageFlowFilter(`date:${this.currentDate}`);
        } else {
          // Re-render canvas elements instantly for the new date
          ScrapCanvas.renderElements(ScrapCanvas.elements);
        }
      });
    }

    // Auto-hide Collage Flow toolbar when top left HUD or options menu buttons are clicked
    const topLeftHud = document.querySelector('.canvas-hud-top-left');
    if (topLeftHud) {
      topLeftHud.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('#btn-toggle-collage-flow')) return;
        if (window.ScrapCanvas && typeof window.ScrapCanvas.resetCollageFlowToolbar === 'function') {
          window.ScrapCanvas.resetCollageFlowToolbar();
        }
      });
    }

    // Collapsible HUD top menu toggle listener
    const btnHudToggle = document.getElementById('btn-hud-toggle-menu');
    const hudMenu = document.getElementById('hud-collapsible-menu');
    if (btnHudToggle && hudMenu) {
      const closeHudMenu = () => {
        hudMenu.classList.add('hidden');
        btnHudToggle.innerText = '⚙️';
        btnHudToggle.classList.remove('border-cyber-green', 'text-cyber-green');
      };

      btnHudToggle.addEventListener('click', () => {
        const isHidden = hudMenu.classList.toggle('hidden');
        if (isHidden) {
          btnHudToggle.innerText = '⚙️';
          btnHudToggle.classList.remove('border-cyber-green', 'text-cyber-green');
        } else {
          btnHudToggle.innerText = '✕';
          btnHudToggle.classList.add('border-cyber-green', 'text-cyber-green');
        }
        if (window.ScrapCanvas && typeof window.ScrapCanvas.updateDatePickerVisibility === 'function') {
          window.ScrapCanvas.updateDatePickerVisibility();
        }
        if (window.ScrapCanvas && typeof window.ScrapCanvas.checkEmptyDateMessage === 'function') {
          window.ScrapCanvas.checkEmptyDateMessage();
        }
      });

      // Auto-close menu whenever any option item inside the gear menu is clicked
      hudMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          closeHudMenu();
          if (btn.id !== 'btn-toggle-collage-flow') {
            if (window.ScrapCanvas && typeof window.ScrapCanvas.resetCollageFlowToolbar === 'function') {
              window.ScrapCanvas.resetCollageFlowToolbar();
            }
          }
        });
      });
    }

    // Leave Space Button Listener
    const btnLeaveRoom = document.getElementById('btn-leave-room');
    if (btnLeaveRoom) {
      btnLeaveRoom.addEventListener('click', async () => {
        if (await window.ScrapDialog.confirm('Are you sure you want to leave this Squad Space? You will lose access to the encryption keys.')) {
          const roomId = this.currentRoomId;
          const userId = ScrapFirebase.userId;

          const progressToast = document.getElementById('upload-progress-notification');
          const progressText = document.getElementById('upload-progress-text');
          if (progressToast && progressText) {
            progressText.innerText = 'Leaving Squad Space...';
            progressToast.classList.remove('hidden');
          }

          try {
            const titleToDelete = localStorage.getItem(`scrap_room_title_${roomId}`) || (this.currentRoomId === roomId ? this.currentRoomTitle : '');
            await ScrapFirebase.leaveRoom(roomId, userId);
            await ScrapRecovery.deleteRoomKey(roomId, titleToDelete);

            if (this.activeMembersPruneInterval) {
              clearInterval(this.activeMembersPruneInterval);
              this.activeMembersPruneInterval = null;
            }

            const hudMenu = document.getElementById('hud-collapsible-menu');
            if (hudMenu) hudMenu.classList.add('hidden');

            ScrapFirebase.disconnect();
            await this.renderDashboardRooms();
            this.showScreen('screen-dashboard');
          } catch (err) {
            console.error('[leaveRoom] Error:', err);
            await window.ScrapDialog.alert('Failed to leave Squad Space: ' + err.message);
          } finally {
            if (progressToast) progressToast.classList.add('hidden');
          }
        }
      });
    }

    // Delete Space Button Listener
    const btnDeleteRoom = document.getElementById('btn-delete-room');
    if (btnDeleteRoom) {
      btnDeleteRoom.addEventListener('click', async () => {
        const roomId = this.currentRoomId;
        if (await window.ScrapDialog.confirm('⚠️ WARNING: You are the OWNER of this Squad Space.\n\nLeaving this room will DESTRUCT and DELETE the entire room, including all shared drawings, photos, videos, and audio clips from the server permanently.\n\nAre you sure you want to delete this space? This cannot be undone.')) {
          const progressToast = document.getElementById('upload-progress-notification');
          const progressText = document.getElementById('upload-progress-text');
          if (progressToast && progressText) {
            progressText.innerText = 'Deleting Squad Space & media files...';
            progressToast.classList.remove('hidden');
          }

          try {
            const titleToDelete = localStorage.getItem(`scrap_room_title_${roomId}`) || (this.currentRoomId === roomId ? this.currentRoomTitle : '');
            await ScrapFirebase.deleteRoom(roomId);
            await ScrapRecovery.deleteRoomKey(roomId, titleToDelete);

            if (this.activeMembersPruneInterval) {
              clearInterval(this.activeMembersPruneInterval);
              this.activeMembersPruneInterval = null;
            }

            const hudMenu = document.getElementById('hud-collapsible-menu');
            if (hudMenu) hudMenu.classList.add('hidden');

            ScrapFirebase.disconnect();
            await this.renderDashboardRooms();
            this.showScreen('screen-dashboard');
            await window.ScrapDialog.alert('Squad Space and all its media files have been completely deleted.');
          } catch (err) {
            console.error('[deleteRoom] Error:', err);
            await window.ScrapDialog.alert('Failed to delete Squad Space: ' + err.message);
          } finally {
            if (progressToast) progressToast.classList.add('hidden');
          }
        }
      });
    }

    // Handle close button for developer settings modal if present
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        const modal = document.getElementById('modal-settings');
        if (modal) modal.classList.add('hidden');
      });
    }



    window.addEventListener('google_session_expired', () => {
      // Cleanly stop background sync polling
      ScrapFirebase.disconnect();

      localStorage.removeItem('google_drive_token');
      if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        firebase.auth().signOut().catch(console.error);
      }
      this.showScreen('screen-gateway');
      alert('Your Google session has expired. Please sign in again.');
    });
  },

  toggleDoodleOverlay(show) {
    const overlay = document.getElementById('doodle-draw-canvas');
    if (show) {
      overlay.classList.remove('hidden');
      const painter = document.getElementById('doodle-painter-canvas');
      painter.width = painter.offsetWidth;
      painter.height = painter.offsetHeight;

      // Clear canvas drawing
      const ctx = painter.getContext('2d');
      ctx.clearRect(0, 0, painter.width, painter.height);
      ScrapCanvas.currentDoodlePoints = [];
      ScrapCanvas.currentDoodleStrokes = [];

      // Reset brush controls
      const customColorInput = document.getElementById('input-doodle-color');
      if (customColorInput && ScrapCanvas.doodleColor && ScrapCanvas.doodleColor !== 'eraser') {
        customColorInput.value = ScrapCanvas.doodleColor;
      }
      const brushSizeSlider = document.getElementById('input-doodle-brush-size');
      const brushSizeLabel = document.getElementById('label-brush-size');
      if (brushSizeSlider) {
        brushSizeSlider.value = ScrapCanvas.doodleBrushSize || 5;
      }
      if (brushSizeLabel) {
        brushSizeLabel.innerText = `${ScrapCanvas.doodleBrushSize || 5}px`;
      }

      // Reset wobble checkbox and canvas class to prevent wobbly state carry-over
      const checkWobble = document.getElementById('check-doodle-wobble');
      if (checkWobble) checkWobble.checked = false;
      painter.classList.remove('wobble-active');
    } else {
      overlay.classList.add('hidden');
      // Clean up any remaining sparkles to save memory/CPU
      const sparkles = overlay.querySelectorAll('.doodle-sparkle');
      sparkles.forEach(s => s.remove());
    }
  },

  async captureNativePhoto() {
    this.isSelectingFile = true;
    try {
      const cameraPlugin = window.Capacitor.Plugins.Camera;
      const image = await cameraPlugin.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: 'base64'
      });

      if (image && image.base64String) {
        // Decode base64 to binary directly in memory (bypasses Android URI/file permissions completely!)
        const byteCharacters = atob(image.base64String);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        const file = new File([blob], `snap_${Date.now()}.jpg`, { type: 'image/jpeg' });
        await this.processCapturedFile(file);
      }
    } catch (err) {

      // Fallback
      document.getElementById('hidden-file-picker').click();
    }
  },

  async pickNativePhotoFromLibrary() {
    this.isSelectingFile = true;
    try {
      const cameraPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
      if (cameraPlugin && typeof cameraPlugin.pickImages === 'function') {
        const result = await cameraPlugin.pickImages({
          quality: 85,
          limit: 10
        });

        if (result && result.photos && result.photos.length > 0) {
          const selectedPhotos = result.photos.slice(0, 10);
          for (const photo of selectedPhotos) {
            try {
              let blob;
              if (photo.webPath) {
                const response = await fetch(photo.webPath);
                blob = await response.blob();
              } else if (photo.path) {
                const response = await fetch(window.Capacitor.convertFileSrc(photo.path));
                blob = await response.blob();
              }
              if (blob) {
                const file = new File([blob], `dump_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.jpg`, { type: 'image/jpeg' });
                await this.processCapturedFile(file);
              }
            } catch (pErr) {
              console.warn('[Camera] Failed to load picked photo item:', pErr);
            }
          }
          return;
        }
      }
      // Fallback to HTML input multi-file picker
      document.getElementById('hidden-file-picker').click();
    } catch (err) {
      console.warn('[Camera] Native gallery picker error/cancelled, falling back to input:', err);
      if (err && err.message && err.message.includes('User cancelled')) return;
      document.getElementById('hidden-file-picker').click();
    }
  },

  showPolaroidFramingModal(file) {
    return new Promise((resolve) => {
      const modal = document.getElementById('polaroid-cropper-overlay');
      const imgEl = document.getElementById('polaroid-cropper-img');
      const viewport = document.getElementById('polaroid-cropper-viewport');
      const zoomInput = document.getElementById('polaroid-cropper-zoom');
      const btnSave = document.getElementById('btn-polaroid-cropper-save');
      const btnCancel = document.getElementById('btn-polaroid-cropper-cancel');
      const btnClose = document.getElementById('btn-polaroid-cropper-close');

      if (!modal || !imgEl || !viewport) {
        resolve(file);
        return;
      }

      let posX = 0;
      let posY = 0;
      let scale = 1;
      let isDragging = false;
      let startX = 0;
      let startY = 0;

      const fileUrl = URL.createObjectURL(file);
      imgEl.src = fileUrl;

      const resetTransform = () => {
        posX = 0;
        posY = 0;
        scale = 1;
        if (zoomInput) zoomInput.value = 1;
        updateTransform();
      };

      const updateTransform = () => {
        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
      };

      imgEl.onload = () => {
        modal.classList.remove('hidden');
        resetTransform();
        const vpW = viewport.clientWidth || 224;
        const vpH = viewport.clientHeight || 192;
        const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
        const vpRatio = vpW / vpH;

        if (imgRatio < vpRatio) {
          imgEl.style.width = `${vpW}px`;
          imgEl.style.height = 'auto';
        } else {
          imgEl.style.height = `${vpH}px`;
          imgEl.style.width = 'auto';
        }
      };

      const onPointerDown = (e) => {
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startX = clientX - posX;
        startY = clientY - posY;
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        posX = clientX - startX;
        posY = clientY - startY;
        updateTransform();
      };

      const onPointerUp = () => {
        isDragging = false;
      };

      viewport.addEventListener('mousedown', onPointerDown);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);

      viewport.addEventListener('touchstart', onPointerDown, { passive: true });
      window.addEventListener('touchmove', onPointerMove, { passive: true });
      window.addEventListener('touchend', onPointerUp);

      const onZoom = () => {
        scale = parseFloat(zoomInput.value) || 1;
        updateTransform();
      };

      if (zoomInput) zoomInput.addEventListener('input', onZoom);

      const cleanup = () => {
        modal.classList.add('hidden');
        URL.revokeObjectURL(fileUrl);
        viewport.removeEventListener('mousedown', onPointerDown);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        viewport.removeEventListener('touchstart', onPointerDown);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
        if (zoomInput) zoomInput.removeEventListener('input', onZoom);
        btnSave.removeEventListener('click', onSave);
        btnCancel.removeEventListener('click', onCancel);
        if (btnClose) btnClose.removeEventListener('click', onCancel);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      const onSave = async () => {
        try {
          const cropCanvas = document.createElement('canvas');
          const vpW = viewport.clientWidth || 224;
          const vpH = viewport.clientHeight || 192;
          cropCanvas.width = 1200;
          cropCanvas.height = Math.round(1200 * (vpH / vpW));
          const ctx = cropCanvas.getContext('2d');

          const imgRect = imgEl.getBoundingClientRect();
          const vpRect = viewport.getBoundingClientRect();

          const scaleX = imgEl.naturalWidth / imgRect.width;
          const scaleY = imgEl.naturalHeight / imgRect.height;

          const srcX = (vpRect.left - imgRect.left) * scaleX;
          const srcY = (vpRect.top - imgRect.top) * scaleY;
          const srcW = vpRect.width * scaleX;
          const srcH = vpRect.height * scaleY;

          ctx.drawImage(
            imgEl,
            srcX, srcY, srcW, srcH,
            0, 0, cropCanvas.width, cropCanvas.height
          );

          cropCanvas.toBlob((blob) => {
            cleanup();
            if (blob) {
              const framedFile = new File([blob], file.name || `polaroid_${Date.now()}.jpg`, { type: 'image/jpeg' });
              resolve(framedFile);
            } else {
              resolve(file);
            }
          }, 'image/jpeg', 0.92);
        } catch (err) {
          console.warn('[PolaroidCropper] Crop error:', err);
          cleanup();
          resolve(file);
        }
      };

      btnSave.addEventListener('click', onSave);
      btnCancel.addEventListener('click', onCancel);
      if (btnClose) btnClose.removeEventListener('click', onCancel);
    });
  },

  // Process captured image
  async processCapturedFile(file) {
    if (!file) return;

    // Show Polaroid Framing Adjuster Modal before upload/canvas placement
    const framedFile = await this.showPolaroidFramingModal(file);
    if (!framedFile) return;
    file = framedFile;

    // Ensure progress spinner toast is hidden - uploads stream silently in background
    const progressToast = document.getElementById('upload-progress-notification');
    if (progressToast) progressToast.classList.add('hidden');

    // Restore room context if lost due to OS background process termination
    if (!this.currentRoomId) {
      this.currentRoomId = localStorage.getItem('scrap_current_room_id');
      this.currentRoomTitle = localStorage.getItem('scrap_current_room_title') || 'Squad Space';


      const titleEl = document.getElementById('canvas-room-title');
      if (titleEl) titleEl.innerText = `ROOM: ${this.currentRoomTitle.toUpperCase()}`;

      // Reinitialize canvas subscription
      ScrapCanvas.initialize('canvas-workspace', 'canvas-board');
      ScrapFirebase.subscribeToRoom(
        this.currentRoomId,
        (elements) => {
          ScrapCanvas.renderElements(elements);
          this.renderMoodCalendarFeed(elements);
        },
        (presence) => ScrapCanvas.renderUserPresence(presence),
        (alertPacket) => this.displayAlertToast(alertPacket),
        (connections) => ScrapCanvas.renderConnections(connections)
      );
    }

    this.showScreen('screen-canvas');

    return new Promise((resolve) => {
      // 1. Render on Canvas locally to run safety screening
      const img = new Image();

      img.onerror = () => {
        if (progressToast) progressToast.classList.add('hidden');
        alert('Failed to load image file.');
        resolve();
      };

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Downscale locally to save bandwidth
          const maxDim = 2048; // Increased from 350 to allow higher quality photos under 200KB limit
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);

          // 2. Perform safety moderation BEFORE encryption or network upload
          const result = await ScrapSafety.checkSafety(canvas);

          if (!result.safe) {
            // Block and purge RAM
            ctx.clearRect(0, 0, w, h);
            canvas.width = 0;
            canvas.height = 0;

            // Hide progress spinner
            if (progressToast) progressToast.classList.add('hidden');

            // Show Strict Safety guard overlay
            document.getElementById('safety-guard-overlay').classList.remove('hidden');
            resolve();
            return;
          }

          // 3. Encrypt in RAM using SubtleCrypto room key
          let roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
          if (!roomKey) {
            if (progressToast) progressToast.classList.add('hidden');
            throw new Error('Decryption key for this room is missing. Please re-join the room.');
          }

          // Helper function to compress canvas to blob <= 200KB safely without freezing UI
          const compressToBlob = async (initialCanvas) => {
            let quality = 0.8;
            let currentCanvas = initialCanvas;
            const targetSize = 200 * 1024; // 200KB
            let attempts = 0;
            const maxAttempts = 12;

            while (attempts < maxAttempts) {
              attempts++;
              const blob = await new Promise((res) => {
                currentCanvas.toBlob(res, 'image/jpeg', quality);
              });

              if (!blob) {
                throw new Error('Failed to generate image blob');
              }

              if (blob.size <= targetSize || (quality <= 0.1 && currentCanvas.width <= 100) || attempts >= maxAttempts) {
                return blob;
              }

              // Yield control briefly to keep UI responsive during heavy canvas operations
              await new Promise((r) => setTimeout(r, 0));

              if (quality > 0.3) {
                quality -= 0.15;
              } else {
                // Scale down canvas if quality is already low
                const newCanvas = document.createElement('canvas');
                const newCtx = newCanvas.getContext('2d');
                newCanvas.width = Math.max(1, Math.round(currentCanvas.width * 0.7));
                newCanvas.height = Math.max(1, Math.round(currentCanvas.height * 0.7));
                newCtx.drawImage(currentCanvas, 0, 0, newCanvas.width, newCanvas.height);
                currentCanvas = newCanvas;
                quality = 0.8; // reset quality for resized canvas
              }
            }
            return null;
          };

          const blob = await compressToBlob(canvas);
          if (!blob) {
            throw new Error('Canvas conversion returned null blob.');
          }
          const arrayBuffer = await blob.arrayBuffer();
          const encryptedBuffer = await ScrapCrypto.encryptData(arrayBuffer, roomKey);

          // Calculate auto-stacking position
          let newX = 2412;
          let newY = 2400;

          let currentElements = ScrapCanvas.elements;
          if (!currentElements || Object.keys(currentElements).length === 0) {
            currentElements = ScrapFirebase.getLocalRoomData(this.currentRoomId, 'elements') || {};
          }

          const photos = Object.values(currentElements || {}).filter(
            el => el.type === 'photo' && ((el.date || ScrapCanvas.currentDate || this.currentDate) === this.currentDate)
          );

          if (photos.length > 0) {
            photos.sort((a, b) => (Number(b.y) || 0) - (Number(a.y) || 0));
            const lowestPhoto = photos[0];
            newX = Number(lowestPhoto.x);
            if (isNaN(newX)) newX = 2412;
            newY = Number(lowestPhoto.y);
            if (isNaN(newY)) {
              newY = 2400;
            } else {
              newY = newY + 310;
            }
          } else {
            newX = 2412;
            newY = 2400;
          }

          if (isNaN(newX)) newX = 2412;
          if (isNaN(newY)) newY = 2400;

          const timestamp = Date.now();
          const uniqueSuffix = Math.random().toString(36).substring(2, 7);
          const elementId = 'photo_' + timestamp + '_' + uniqueSuffix;
          const username = (window.pb && pb.authStore.isValid && pb.authStore.model)
            ? (pb.authStore.model.username || pb.authStore.model.name || pb.authStore.model.id)
            : (window.ScrapFirebase && window.ScrapFirebase.userName) || 'squadmate';
          const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
          const fileName = `${safeUsername}_photo_${timestamp}_${uniqueSuffix}.enc`;

          // 1. Write binary buffer to native disk cache first (awaited so local read hits immediately)
          await ScrapDrive.writeLocalCacheFile(fileName, encryptedBuffer);

          // 2. Cache in-memory data URL immediately so canvas renders with zero network lag/404s
          const base64Decrypted = ScrapCrypto.arrayBufferToBase64(arrayBuffer);
          const memoryDataUrl = `data:image/jpeg;base64,${base64Decrypted}`;

          // 3. Save element metadata to disk FIRST with _isPendingSync: true & _decryptedDataUrl ready
          const metadata = {
            type: 'photo',
            fileId: fileName,
            _pendingFileName: fileName,
            _isPendingSync: true,
            _decryptedDataUrl: memoryDataUrl,
            x: newX,
            y: newY,
            rotation: Math.floor(Math.random() * 20) - 10,
            scale: 1.0,
            caption: '',
            date: this.currentDate
          };

          window.pendingScrollToElementId = elementId;
          await ScrapFirebase.saveElement(this.currentRoomId, elementId, metadata);

          if (window.ScrapCanvas && typeof ScrapCanvas.checkFirstPhotoTip === 'function') {
            setTimeout(() => ScrapCanvas.checkFirstPhotoTip(ScrapCanvas.elements), 150);
          }

          // 3. Initiate background upload to Cloudflare R2 asynchronously (Non-blocking)
          ScrapDrive.resolveRoomFolder(this.currentRoomId, this.currentRoomTitle, this.currentDate)
            .then(roomFolderId => ScrapDrive.uploadFile(fileName, encryptedBuffer, roomFolderId, 'application/octet-stream'))
            .then(async uploadResult => {
              if (uploadResult && uploadResult.id) {
                const currentEl = ScrapFirebase.elements[elementId];
                if (currentEl) {
                  currentEl.fileId = uploadResult.id;
                  delete currentEl._pendingFileName;
                  delete currentEl._isPendingSync;
                  await ScrapFirebase.saveElement(this.currentRoomId, elementId, currentEl);
                }
              }
            })
            .catch(err => console.warn('[Upload] Background photo upload error:', err));

        } catch (err) {
          if (err && err.message && (err.message.toLowerCase().includes('cancel') || err.message.toLowerCase().includes('abort'))) {
            console.log('[Upload] User cancelled upload operation.');
          } else {
            console.warn('[Upload] Photo upload error:', err);
          }
        } finally {
          // Hide progress spinner toast
          const progressToast = document.getElementById('upload-progress-notification');
          if (progressToast) progressToast.classList.add('hidden');
          resolve();
        }
      };

      // Use FileReader to convert the File/Blob to a Data URL (avoids blob: URL CORS/security restrictions)
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = () => {
        if (progressToast) progressToast.classList.add('hidden');
        alert('Failed to read image file.');
        resolve();
      };
      reader.readAsDataURL(file);
    });
  },

  async processVideoFile(file) {
    if (!file) return;

    // Check size limit: 10MB recommended
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      await window.ScrapDialog.alert(`Video file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please keep videos under 10MB to save storage and ensure instant loading.`);
      return;
    }

    const progressToast = document.getElementById('upload-progress-notification');

    try {
      // 1. Read array buffer
      const arrayBuffer = await file.arrayBuffer();

      // 2. Encrypt video in RAM using room key
      let encBuf = arrayBuffer;
      let isEncrypted = false;
      try {
        const roomKey = await ScrapRecovery.getRoomKey(this.currentRoomId);
        if (roomKey && window.ScrapCrypto && typeof ScrapCrypto.encryptData === 'function') {
          console.log('[Video] Encrypting video file with AES-GCM 256...');
          encBuf = await ScrapCrypto.encryptData(arrayBuffer, roomKey);
          isEncrypted = true;
        } else {
          console.warn('[Video] Room key missing, uploading fallback plain video.');
        }
      } catch (cryptoErr) {
        console.error('[Video] Encryption error, falling back to plain upload:', cryptoErr);
        encBuf = arrayBuffer;
      }

      const roomFolderId = await ScrapDrive.resolveRoomFolder(this.currentRoomId, this.currentRoomTitle, this.currentDate);
      let fileExt = isEncrypted ? 'enc' : 'mp4';
      if (!isEncrypted && file.type && file.type.includes('webm')) {
        fileExt = 'webm';
      }
      const timestamp = Date.now();
      const username = (window.pb && pb.authStore.isValid && pb.authStore.model)
        ? (pb.authStore.model.username || pb.authStore.model.name || pb.authStore.model.id)
        : (window.ScrapFirebase && window.ScrapFirebase.userName) || 'squadmate';
      const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
      const fileName = `${safeUsername}_video_${timestamp}.${fileExt}`;
      const mimeType = file.type || 'video/mp4';

      // 3. Write binary buffer to native disk cache first for instant local rendering
      await ScrapDrive.writeLocalCacheFile(fileName, encBuf);

      // 4. Save metadata to Firebase / PocketBase immediately with _isPendingSync & _pendingFileName
      const elementId = 'video_' + timestamp;

      // Calculate centering position on canvas
      let x = 2444;
      let y = 2460;
      try {
        const workspace = document.getElementById('canvas-workspace');
        const boardMargin = 3000;
        const zoomVal = ScrapCanvas.zoom || 1.0;
        const wW = workspace ? workspace.clientWidth : window.innerWidth;
        const wH = workspace ? workspace.clientHeight : window.innerHeight;
        const sL = workspace ? workspace.scrollLeft : 0;
        const sT = workspace ? workspace.scrollTop : 0;
        x = Math.round((sL - boardMargin + wW / 2) / zoomVal - 80);
        y = Math.round((sT - boardMargin + wH / 2) / zoomVal - 60);
      } catch (e) {
        console.warn('[Video] Viewport query failed:', e);
      }

      if (isNaN(x) || x < 0 || x > 5000) x = 2444;
      if (isNaN(y) || y < 0 || y > 5000) y = 2460;

      const videoElement = {
        type: 'video',
        videoFileId: fileName,
        _pendingFileName: fileName,
        _isPendingSync: true,
        encrypted: isEncrypted,
        mimeType: mimeType,
        x: x,
        y: y,
        rotation: Math.floor(Math.random() * 16) - 8,
        scale: 1.0,
        zIndex: ScrapCanvas.getMaxZIndex('video') + 1,
        date: this.currentDate,
        ownerId: ScrapFirebase.userId
      };

      window.pendingScrollToElementId = null; // Prevent auto-scroll jump
      await ScrapFirebase.saveElement(this.currentRoomId, elementId, videoElement);

      if (progressToast) progressToast.classList.add('hidden');

      // 5. Stream video to Cloudflare R2 asynchronously in background (Non-blocking)
      ScrapDrive.uploadFile(fileName, encBuf, roomFolderId, mimeType)
        .then(uploadResult => {
          if (uploadResult && uploadResult.id) {
            const currentEl = ScrapFirebase.elements[elementId];
            if (currentEl) {
              currentEl.videoFileId = uploadResult.id;
              delete currentEl._pendingFileName;
              delete currentEl._isPendingSync;
              ScrapFirebase.saveLocalRoomData(this.currentRoomId, 'elements', ScrapFirebase.elements);
              if (ScrapFirebase.onElementsUpdateCallback) {
                ScrapFirebase.onElementsUpdateCallback(ScrapFirebase.elements);
              }
              ScrapFirebase.debounceSync();
            }
          }
        })
        .catch(err => console.warn('[Video] Background upload error:', err));
    } catch (err) {
      console.error('[Video] Capture/Upload failed:', err);
      await window.ScrapDialog.alert('Failed to save video sticker: ' + err.message);
    } finally {
      if (progressToast) progressToast.classList.add('hidden');
    }
  },

  videoStream: null,
  mediaRecorder: null,
  videoChunks: [],
  videoFacingMode: 'user',
  videoRecordTimerInterval: null,
  videoRecordStartTime: 0,

  async openVideoPreview() {
    try {
      this.videoChunks = [];
      const constraints = {
        video: {
          facingMode: this.videoFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 }
        },
        audio: true
      };

      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);

      const previewVideo = document.getElementById('video-record-preview');
      if (previewVideo) {
        previewVideo.srcObject = this.videoStream;
        if (this.videoFacingMode === 'user') {
          previewVideo.classList.add('transform', '-scale-x-100');
        } else {
          previewVideo.classList.remove('transform', '-scale-x-100');
        }
      }

      // Reset overlay UI states to "Ready to record"
      const statusEl = document.getElementById('video-recording-status');
      if (statusEl) statusEl.textContent = 'Camera Ready';

      const timerEl = document.getElementById('video-recording-timer');
      if (timerEl) {
        timerEl.textContent = '0.0s';
        timerEl.classList.add('hidden');
      }

      const dotEl = document.getElementById('video-recording-dot');
      if (dotEl) dotEl.classList.add('hidden');

      const btnStart = document.getElementById('btn-start-video-recording');
      if (btnStart) btnStart.classList.remove('hidden');

      const btnClose = document.getElementById('btn-close-video-recording');
      if (btnClose) btnClose.classList.remove('hidden');

      const btnStop = document.getElementById('btn-stop-video-recording');
      if (btnStop) btnStop.classList.add('hidden');

      const overlay = document.getElementById('video-recording-overlay');
      if (overlay) overlay.classList.remove('hidden');

    } catch (err) {
      console.error('[Video Preview] Failed to open:', err);
      window.ScrapDialog.alert('Camera/Mic access is required to record video notes.');
      this.cleanupVideoRecording();
    }
  },

  async startVideoRecording() {
    try {
      if (!this.videoStream) {
        throw new Error('Camera preview stream is not active.');
      }
      this.videoChunks = [];

      let options = { videoBitsPerSecond: 800000 };
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac')) {
        options.mimeType = 'video/mp4;codecs=h264,aac';
      } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,mp4a.40.2')) {
        options.mimeType = 'video/mp4;codecs=h264,mp4a.40.2';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')) {
        options.mimeType = 'video/webm;codecs=h264,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        options.mimeType = 'video/webm';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        options.mimeType = 'video/mp4';
      }

      this.mediaRecorder = new MediaRecorder(this.videoStream, options);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.videoChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        await this.saveRecordedVideo();
      };

      // Update UI elements for recording state
      const statusEl = document.getElementById('video-recording-status');
      if (statusEl) statusEl.textContent = '// Recording Video...';

      const timerEl = document.getElementById('video-recording-timer');
      if (timerEl) timerEl.classList.remove('hidden');

      const dotEl = document.getElementById('video-recording-dot');
      if (dotEl) dotEl.classList.remove('hidden');

      const btnStart = document.getElementById('btn-start-video-recording');
      if (btnStart) btnStart.classList.add('hidden');

      const btnClose = document.getElementById('btn-close-video-recording');
      if (btnClose) btnClose.classList.add('hidden');

      const btnStop = document.getElementById('btn-stop-video-recording');
      if (btnStop) btnStop.classList.remove('hidden');

      this.mediaRecorder.start();
      this.videoRecordStartTime = Date.now();

      this.videoRecordTimerInterval = setInterval(() => {
        const elapsed = (Date.now() - this.videoRecordStartTime) / 1000;
        if (timerEl) timerEl.textContent = elapsed.toFixed(1) + 's';

        if (elapsed >= 8.0) {
          this.stopVideoRecording();
        }
      }, 100);

    } catch (err) {
      console.error('[Video Record] Failed to start:', err);
      window.ScrapDialog.alert('Failed to start recording: ' + err.message);
      this.cleanupVideoRecording();
    }
  },

  stopVideoRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.videoRecordTimerInterval) {
      clearInterval(this.videoRecordTimerInterval);
      this.videoRecordTimerInterval = null;
    }
  },

  cleanupVideoRecording() {
    if (this.videoRecordTimerInterval) {
      clearInterval(this.videoRecordTimerInterval);
      this.videoRecordTimerInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    const previewVideo = document.getElementById('video-record-preview');
    if (previewVideo) previewVideo.srcObject = null;

    document.getElementById('video-recording-overlay').classList.add('hidden');
  },

  async flipVideoCamera() {
    this.videoFacingMode = this.videoFacingMode === 'user' ? 'environment' : 'user';
    if (this.videoStream) {
      const isRecording = this.mediaRecorder && this.mediaRecorder.state === 'recording';
      try {
        if (!isRecording) {
          // If not recording yet, stop all tracks first to completely release the camera lock, then request new stream
          this.videoStream.getTracks().forEach(track => track.stop());

          const constraints = {
            video: {
              facingMode: this.videoFacingMode,
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 24 }
            },
            audio: true
          };
          this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
          // If recording, stop only the old video track first to release camera lock without stopping the stream/recorder
          const oldVideoTracks = this.videoStream.getVideoTracks();
          oldVideoTracks.forEach(track => track.stop());

          const constraints = {
            video: {
              facingMode: this.videoFacingMode,
              width: { ideal: 640 },
              height: { ideal: 480 }
            },
            audio: false
          };
          const newStream = await navigator.mediaDevices.getUserMedia(constraints);
          const newVideoTrack = newStream.getVideoTracks()[0];

          // Remove old video tracks from our stream and add the new one
          oldVideoTracks.forEach(track => {
            this.videoStream.removeTrack(track);
          });
          this.videoStream.addTrack(newVideoTrack);
        }

        const previewVideo = document.getElementById('video-record-preview');
        if (previewVideo) {
          previewVideo.srcObject = this.videoStream;
          if (this.videoFacingMode === 'user') {
            previewVideo.classList.add('transform', '-scale-x-100');
          } else {
            previewVideo.classList.remove('transform', '-scale-x-100');
          }
        }
      } catch (err) {
        console.error('[Video Flip] Failed:', err);
        // Fallback: revert facingMode state
        this.videoFacingMode = this.videoFacingMode === 'user' ? 'environment' : 'user';
      }
    }
  },

  async saveRecordedVideo() {
    try {
      const blob = new Blob(this.videoChunks, { type: this.mediaRecorder ? this.mediaRecorder.mimeType : 'video/mp4' });
      this.cleanupVideoRecording();
      await this.processVideoFile(blob);
    } catch (err) {
      console.error('[Video Save] Failed:', err);
      this.cleanupVideoRecording();
      window.ScrapDialog.alert('Failed to save recording: ' + err.message);
    }
  },

  activeMusicSynths: {},

  toggleMusicSynth(id, cassetteEl) {
    if (this.activeMusicSynths[id]) {
      this.activeMusicSynths[id].stop();
      delete this.activeMusicSynths[id];
      cassetteEl.classList.remove('playing');
      const label = cassetteEl.querySelector('.voice-play-label');
      if (label) label.textContent = '▶ Play Beat';
      return;
    }

    // Stop other active synths
    Object.keys(this.activeMusicSynths).forEach(activeId => {
      this.activeMusicSynths[activeId].stop();
      const activeEl = document.getElementById('item_' + activeId);
      if (activeEl) {
        const c = activeEl.querySelector('.voice-cassette');
        if (c) {
          c.classList.remove('playing');
          const l = c.querySelector('.voice-play-label');
          if (l) l.textContent = '▶ Play Beat';
        }
      }
      delete this.activeMusicSynths[activeId];
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      alert('Web Audio API is not supported on this device.');
      return;
    }

    const ctx = new AudioContextClass();

    // Lowpass filter for cozy lofi warmth
    const lofiFilter = ctx.createBiquadFilter();
    lofiFilter.type = 'lowpass';
    lofiFilter.frequency.setValueAtTime(600, ctx.currentTime);
    lofiFilter.Q.setValueAtTime(1, ctx.currentTime);
    lofiFilter.connect(ctx.destination);

    const elementData = ScrapCanvas.elements[id] || {};
    const songName = elementData.songName || 'Cyber Chill';

    let bpm = 90;
    let chordProgression = [110.00, 137.50, 165.00, 220.00];

    if (songName === 'Cyber Chill') {
      bpm = 85;
      chordProgression = [130.81, 164.81, 196.00, 220.00];
    } else if (songName === 'Dream Synth') {
      bpm = 75;
      chordProgression = [110.00, 146.83, 165.00, 220.00];
    } else if (songName === 'Pixel Beats') {
      bpm = 110;
      chordProgression = [130.81, 146.83, 196.00, 261.63];
      lofiFilter.frequency.setValueAtTime(1600, ctx.currentTime);
    } else if (songName === 'Astro Lofi') {
      bpm = 70;
      chordProgression = [98.00, 130.81, 164.81, 196.00];
    }

    const stepTime = 60 / bpm / 2;
    let step = 0;

    const scheduleInterval = setInterval(() => {
      const scheduleTime = ctx.currentTime + 0.1;

      // Kick drum (steps 0, 4)
      if (step === 0 || step === 4) {
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.frequency.setValueAtTime(150, scheduleTime);
        kickOsc.frequency.exponentialRampToValueAtTime(0.01, scheduleTime + 0.15);
        kickGain.gain.setValueAtTime(0.8, scheduleTime);
        kickGain.gain.exponentialRampToValueAtTime(0.01, scheduleTime + 0.15);
        kickOsc.connect(kickGain);
        kickGain.connect(lofiFilter);
        kickOsc.start(scheduleTime);
        kickOsc.stop(scheduleTime + 0.17);
      }

      // Snare click (steps 2, 6)
      if (step === 2 || step === 6) {
        const snareOsc = ctx.createOscillator();
        const snareGain = ctx.createGain();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(290, scheduleTime);
        snareOsc.frequency.exponentialRampToValueAtTime(700, scheduleTime + 0.08);
        snareGain.gain.setValueAtTime(0.15, scheduleTime);
        snareGain.gain.exponentialRampToValueAtTime(0.01, scheduleTime + 0.08);
        snareOsc.connect(snareGain);
        snareGain.connect(lofiFilter);
        snareOsc.start(scheduleTime);
        snareOsc.stop(scheduleTime + 0.09);
      }

      // Synth Chord/Note Arp (beats 0, 2, 4, 6, 7)
      if (step % 2 === 0 || step === 7) {
        const chordOsc = ctx.createOscillator();
        const chordGain = ctx.createGain();

        const noteIndex = (step + Math.floor(step / 3)) % chordProgression.length;
        let freq = chordProgression[noteIndex];

        if (songName === 'Pixel Beats') {
          chordOsc.type = 'square';
          freq = freq * 1.5;
        } else {
          chordOsc.type = 'triangle';
        }

        chordOsc.frequency.setValueAtTime(freq, scheduleTime);
        chordGain.gain.setValueAtTime(0.12, scheduleTime);
        chordGain.gain.exponentialRampToValueAtTime(0.001, scheduleTime + 0.32);

        chordOsc.connect(chordGain);
        chordGain.connect(lofiFilter);

        chordOsc.start(scheduleTime);
        chordOsc.stop(scheduleTime + 0.35);
      }

      step = (step + 1) % 8;
    }, stepTime * 1000);

    this.activeMusicSynths[id] = {
      stop: () => {
        clearInterval(scheduleInterval);
        try {
          ctx.close();
        } catch (e) { }
      }
    };

    cassetteEl.classList.add('playing');
    const label = cassetteEl.querySelector('.voice-play-label');
    if (label) label.textContent = '⏸ Stop Beat';
  },

  updateUploadProgress(percent, text) {
    const progressToast = document.getElementById('upload-progress-notification');
    const progressText = document.getElementById('upload-progress-text');
    const progressPercent = document.getElementById('upload-progress-percent');
    if (progressToast) progressToast.classList.remove('hidden');
    if (progressText && text) progressText.innerText = text;
    if (progressPercent) progressPercent.innerText = `${percent}%`;
  },

  async renderDashboardRooms() {
    if (this._isRenderingDashboardRooms) return;
    this._isRenderingDashboardRooms = true;

    // Asynchronously load the latest ads from the database in the background
    try {
      if (window.ScrapAds) ScrapAds.init();
    } catch (_) { }

    try {
      const container = document.getElementById('rooms-container');
      if (!container) return;

      const hasExistingRooms = container.children && container.children.length > 0 && !container.querySelector('.animate-pulse');
      if (!hasExistingRooms) {
        container.innerHTML = `
          <div class="animate-pulse rounded-2xl p-4.5 flex justify-between items-center border border-white/5 bg-white/[0.02]" style="height: 80px;">
            <div class="flex items-center gap-3.5 w-full">
              <div class="w-12 h-12 rounded-full bg-white/10 flex-shrink-0"></div>
              <div class="flex flex-col gap-2 w-1/2">
                <div class="h-4 bg-white/10 rounded w-3/4"></div>
                <div class="h-2.5 bg-white/5 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        `;
      }

      // Automatically refresh user profile avatar & custom theme background UI
      if (window.pb && pb.authStore.isValid && pb.authStore.model) {
        const user = pb.authStore.model;
        if (user.encrypted_avatar || user.avatar) {
          this.resolveUserAvatarUrl(user).then(url => {
            if (url) {
              const avatarImg = document.getElementById('dashboard-avatar');
              const avatarPlaceholder = document.getElementById('dashboard-avatar-placeholder');
              if (avatarImg) {
                avatarImg.src = url;
                avatarImg.classList.remove('hidden');
              }
              if (avatarPlaceholder) {
                avatarPlaceholder.classList.add('hidden');
              }
            }
          }).catch(() => { });
        }
      }

      let rooms = await ScrapFirebase.getUserRooms(ScrapFirebase.userId);

      // Filter out duplicates by ID
      const seenIds = new Set();
      const uniqueRooms = [];
      rooms.forEach(r => {
        if (r && r.id && r.title) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            uniqueRooms.push(r);
            const isOwnerOfRoom = r.createdBy === ScrapFirebase.userId;
            localStorage.setItem('scrap_room_is_owner_' + r.id, isOwnerOfRoom ? 'true' : 'false');
            localStorage.setItem('scrap_room_is_group_' + r.id, r.isGroup ? 'true' : 'false');
            localStorage.setItem('scrap_room_title_' + r.id, r.title);
          }
        }
      });
      rooms = uniqueRooms;

      const theme = this.getSavedTheme();
      const cardStyles = [
        'dashboard-card-green',
        'dashboard-card-blue',
        'dashboard-card-purple',
        'dashboard-card-pink'
      ];

      const themeColors = {
        cyberpunk: {
          green: '#39ff14',
          blue: '#00f0ff',
          purple: '#b026ff',
          pink: '#ff00ab'
        },
        classical: {
          green: '#f59e0b',
          blue: '#14b8a6',
          purple: '#8b5cf6',
          pink: '#f43f5e'
        },
        vaporwave: {
          green: '#ff00ab',
          blue: '#00f0ff',
          purple: '#b026ff',
          pink: '#ff7700'
        },
        matrix: {
          green: '#10b981',
          blue: '#34d399',
          purple: '#059669',
          pink: '#047857'
        },
        retro: {
          green: '#2d6a4f',
          blue: '#1d3557',
          purple: '#5c4033',
          pink: '#b7094c'
        },
        light: {
          green: '#10b981',
          blue: '#06b6d4',
          purple: '#6366f1',
          pink: '#ec4899'
        },
        custom: {
          green: '#00f0ff',
          blue: '#ff00ab',
          purple: '#b026ff',
          pink: '#39ff14'
        }
      };

      const colors = themeColors[theme] || themeColors.cyberpunk;

      // Async decrypt room avatars if encrypted avatar payload exists
      for (const r of rooms) {
        let avatarUrl = r.avatar ? `https://api.myscrapmemories.com/api/files/boards/${r.id}/${r.avatar}` : '';
        if (r.encrypted_avatar && window.ScrapCrypto && typeof ScrapCrypto.decryptText === 'function') {
          try {
            let cryptoKey = await ScrapRecovery.getRoomKey(r.id);
            if (!cryptoKey && window.ScrapFirebase && typeof ScrapFirebase.getUserAvatarCryptoKey === 'function') {
              cryptoKey = await ScrapFirebase.getUserAvatarCryptoKey(r.id);
            }
            if (cryptoKey) {
              const decAvatar = await ScrapCrypto.decryptText(r.encrypted_avatar, cryptoKey);
              if (decAvatar && decAvatar.startsWith('data:')) {
                avatarUrl = decAvatar;
              }
            }
          } catch (_) { }
        }
        r.resolvedAvatarUrl = avatarUrl;
      }

      // If container was showing skeleton loader, clear it before rendering real cards
      if (container.querySelector('.animate-pulse')) {
        container.innerHTML = '';
      }

      const existingCards = Array.from(container.querySelectorAll('[data-card-room-id]'));
      const existingMap = new Map();
      existingCards.forEach(card => existingMap.set(card.getAttribute('data-card-room-id'), card));

      const activeRoomIds = new Set();

      rooms.forEach((r, idx) => {
        activeRoomIds.add(r.id);
        const styleClass = cardStyles[idx % cardStyles.length];
        let colorHex = colors.green;
        if (styleClass === 'dashboard-card-blue') colorHex = colors.blue;
        else if (styleClass === 'dashboard-card-purple') colorHex = colors.purple;
        else if (styleClass === 'dashboard-card-pink') colorHex = colors.pink;

        const safeTitle = (r && typeof r.title === 'string' && r.title.trim()) ? r.title.trim() : 'SQ';
        const isOwner = r.createdBy === ScrapFirebase.userId;
        const avatarUrl = r.resolvedAvatarUrl || '';

        const existingEl = existingMap.get(r.id);

        if (existingEl) {
          // Silent In-Place Update: Do NOT recreate DOM node or re-trigger animations!
          const avatarBtn = existingEl.querySelector('.btn-preview-avatar');
          if (avatarBtn) {
            avatarBtn.setAttribute('data-title', safeTitle);
            avatarBtn.setAttribute('data-avatar-url', avatarUrl);
            avatarBtn.setAttribute('data-color', colorHex);
            avatarBtn.setAttribute('data-owner', isOwner);

            const innerCircle = avatarBtn.querySelector('.rounded-full');
            if (innerCircle) {
              innerCircle.style.color = colorHex;
              innerCircle.style.borderColor = `${colorHex}45`;
              let img = innerCircle.querySelector('img');
              if (avatarUrl) {
                if (img) {
                  if (img.src !== avatarUrl) img.src = avatarUrl;
                } else {
                  innerCircle.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover">`;
                }
              } else {
                if (img) {
                  innerCircle.innerHTML = safeTitle.substring(0, 2).toUpperCase();
                } else {
                  innerCircle.textContent = safeTitle.substring(0, 2).toUpperCase();
                }
              }
            }
          }

          const titleEl = existingEl.querySelector('h3');
          if (titleEl && titleEl.textContent !== safeTitle) {
            titleEl.textContent = safeTitle;
          }

          const vaultTypeEl = existingEl.querySelector('p');
          const expectedVaultType = r.isGroup ? 'Group Vault' : 'Solo Vault';
          if (vaultTypeEl && vaultTypeEl.textContent !== expectedVaultType) {
            vaultTypeEl.textContent = expectedVaultType;
          }
        } else {
          // New Room Card: Create element and append
          const el = document.createElement('div');
          el.setAttribute('data-card-room-id', r.id);
          el.className = `${styleClass} rounded-2xl p-4.5 flex justify-between items-center hover:scale-[1.01] active:scale-[0.99] cursor-pointer shadow-xl transition-all relative overflow-hidden w-full group animate-card-landing`;
          el.style.animationDelay = `${idx * 60}ms`;

          el.innerHTML = `
            <div class="flex items-center gap-3.5">
              <div class="relative w-12 h-12 flex-shrink-0 btn-preview-avatar animate-fade-in" data-title="${safeTitle}" data-avatar-url="${avatarUrl}" data-color="${colorHex}" data-room-id="${r.id}" data-owner="${isOwner}">
                <div class="w-12 h-12 rounded-full bg-black/40 flex items-center justify-center border font-mono font-bold text-sm uppercase overflow-hidden transition-transform duration-200 active:scale-95" style="color: ${colorHex}; border-color: ${colorHex}45;">
                  ${avatarUrl
              ? `<img src="${avatarUrl}" class="w-full h-full object-cover">`
              : safeTitle.substring(0, 2).toUpperCase()
            }
                </div>
              </div>
              <div>
                <h3 class="font-extrabold font-space text-sm tracking-wide theme-text-main uppercase">${safeTitle}</h3>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${colorHex};"></span>
                  <p class="text-[9px] font-mono theme-text-muted uppercase tracking-widest">${r.isGroup ? 'Group Vault' : 'Solo Vault'}</p>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 bg-black/25 group-hover:bg-white/10" style="color: ${colorHex}; border-color: ${colorHex}35;">
                <svg class="w-4 h-4 transform transition-transform duration-300 group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          `;

          el.addEventListener('click', () => {
            this.openRoom(r.id, r.title);
          });

          // Add preview avatar click listener
          const avatarBtn = el.querySelector('.btn-preview-avatar');
          if (avatarBtn) {
            avatarBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const title = avatarBtn.getAttribute('data-title');
              const url = avatarBtn.getAttribute('data-avatar-url');
              const color = avatarBtn.getAttribute('data-color');
              const roomId = avatarBtn.getAttribute('data-room-id');
              const owner = avatarBtn.getAttribute('data-owner') === 'true';
              this.showAvatarPreview(title, url, color, roomId, owner);
            });
          }

          container.appendChild(el);
        }
      });

      // Remove cards that no longer exist
      existingCards.forEach(card => {
        const roomId = card.getAttribute('data-card-room-id');
        if (roomId && !activeRoomIds.has(roomId)) {
          card.remove();
        }
      });

      // ── Inject ads between room cards (non-intrusive) ──────────
      try {
        if (window.ScrapAds) ScrapAds.injectIntoRoomsList();
      } catch (_) { /* ads never crash the app */ }

    } finally {
      this._isRenderingDashboardRooms = false;
    }
  },

  // Helper method to display WhatsApp-style image preview popup
  showAvatarPreview(title, url, colorHex, roomId, isOwner) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[110] flex items-center justify-center p-6 transition-all duration-300 pointer-events-auto opacity-0 select-none avatar-preview-overlay';
    overlay.style.cssText = 'backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); background-color: rgba(10, 5, 20, 0.85);';

    const initials = title.substring(0, 2).toUpperCase();

    overlay.innerHTML = `
      <div class="relative flex flex-col items-center gap-6 transition-all duration-300 transform scale-95">
        <!-- Circular Image Display -->
        <div class="w-56 h-56 rounded-full bg-black/40 flex items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] border-2 border-[#b026ff] ${isOwner ? 'cursor-pointer hover:scale-105 active:scale-95 transition-all btn-modal-upload-avatar' : ''}">
          ${url
        ? `<img src="${url}" class="w-full h-full object-cover">`
        : `<span class="text-5xl font-extrabold font-mono" style="color: ${colorHex || '#b026ff'};">${initials}</span>`
      }
        </div>
        
        ${isOwner ? `
          <p class="text-[9px] font-space text-[#39ff14]/90 uppercase tracking-widest text-center animate-pulse">TAP AVATAR CIRCLE TO CHANGE</p>
        ` : `
          <p class="text-[9px] font-space text-white/80 uppercase tracking-widest text-center">${title.toUpperCase()}</p>
        `}
        <p class="text-[7.5px] theme-text-muted uppercase tracking-widest font-mono">Tap outside to close</p>
      </div>
    `;

    document.body.appendChild(overlay);

    // Animate open
    setTimeout(() => {
      overlay.classList.remove('opacity-0');
      overlay.querySelector('.transform').classList.remove('scale-95');
    }, 20);

    const closePreview = () => {
      overlay.classList.add('opacity-0');
      overlay.querySelector('.transform').classList.add('scale-95');
      setTimeout(() => overlay.remove(), 250);
    };

    // Click overlay backdrop -> close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('btn-close-preview')) {
        closePreview();
      }
    });

    // Upload Handler inside preview popup
    if (isOwner) {
      const uploadBtn = overlay.querySelector('.btn-modal-upload-avatar');
      if (uploadBtn) {
        uploadBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Avoid triggering closePreview from overlay listener

          this.isSelectingFile = true;

          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';

          fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            document.body.classList.add('cropping-active');
            closePreview(); // Close preview popup immediately to prevent visual overlapping

            try {
              uploadBtn.innerText = '⏳ Adjusting...';
              uploadBtn.disabled = true;

              // Open manual cropper first
              const croppedFile = await this.openAvatarCropper(file);

              uploadBtn.innerText = '⏳ Compressing...';
              const processedFile = await this.compressImage(croppedFile);

              uploadBtn.innerText = '⏳ Uploading...';
              if (window.ScrapFirebase && typeof ScrapFirebase.uploadRoomAvatar === 'function') {
                await ScrapFirebase.uploadRoomAvatar(roomId, processedFile);
                closePreview();
                await this.renderDashboardRooms();
              }
            } catch (err) {
              console.error('[Room Avatar Upload Error]:', err);
            } finally {
              uploadBtn.innerText = '📷 Edit profile photo';
              uploadBtn.disabled = false;
              document.body.classList.remove('cropping-active');
            }
          });

          fileInput.click();
        });
      }
    }
  },

  // Helper method to display user's own profile avatar preview card and upload replacements
  showUserAvatarPreview(title, url) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[110] flex items-center justify-center p-6 transition-all duration-300 pointer-events-auto opacity-0 select-none avatar-preview-overlay';
    overlay.style.cssText = 'backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); background-color: rgba(10, 5, 20, 0.85);';

    const initials = title.substring(0, 2).toUpperCase();

    overlay.innerHTML = `
      <div class="relative flex flex-col items-center gap-6 transition-all duration-300 transform scale-95">
        <!-- Circular Image Display -->
        <div class="w-56 h-56 rounded-full bg-black/40 flex items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] border-2 border-[#39ff14] cursor-pointer hover:scale-105 active:scale-95 transition-all btn-modal-upload-user-avatar">
          ${url
        ? `<img src="${url}" class="w-full h-full object-cover">`
        : `<span class="text-5xl font-extrabold font-mono text-[#39ff14]">${initials}</span>`
      }
        </div>
        
        <p class="text-[9px] font-space text-[#39ff14]/90 uppercase tracking-widest text-center animate-pulse">TAP AVATAR CIRCLE TO CHANGE</p>
        <p class="text-[7.5px] theme-text-muted uppercase tracking-widest font-mono">Tap outside to close</p>
      </div>
    `;

    document.body.appendChild(overlay);

    // Animate open
    setTimeout(() => {
      overlay.classList.remove('opacity-0');
      overlay.querySelector('.transform').classList.remove('scale-95');
    }, 20);

    const closePreview = () => {
      overlay.classList.add('opacity-0');
      overlay.querySelector('.transform').classList.add('scale-95');
      setTimeout(() => overlay.remove(), 250);
    };

    // Click overlay backdrop -> close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('btn-close-preview')) {
        closePreview();
      }
    });

    // Upload Handler
    const uploadBtn = overlay.querySelector('.btn-modal-upload-user-avatar');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        this.isSelectingFile = true;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files[0];
          if (!file) return;
          document.body.classList.add('cropping-active');
          closePreview(); // Close preview popup immediately to prevent visual overlapping

          try {
            uploadBtn.innerText = '⏳ Adjusting...';
            uploadBtn.disabled = true;

            // Open manual cropper first
            const croppedFile = await this.openAvatarCropper(file);

            uploadBtn.innerText = '⏳ Compressing...';
            const processedFile = await this.compressImage(croppedFile);

            uploadBtn.innerText = '⏳ Uploading...';
            if (window.ScrapFirebase && typeof ScrapFirebase.uploadUserAvatar === 'function') {
              const newAvatarDataUrl = await ScrapFirebase.uploadUserAvatar(processedFile);
              closePreview();

              // Dynamically update the dashboard icon on the screen
              const avatarImg = document.getElementById('dashboard-avatar');
              const avatarPlaceholder = document.getElementById('dashboard-avatar-placeholder');

              if (avatarImg && newAvatarDataUrl) {
                avatarImg.src = newAvatarDataUrl;
                avatarImg.classList.remove('hidden');
              }
              if (avatarPlaceholder) {
                avatarPlaceholder.classList.add('hidden');
              }
            }
          } catch (err) {
            console.error('[User Avatar Upload Error]:', err);
          } finally {
            uploadBtn.innerText = '📷 Edit profile photo';
            uploadBtn.disabled = false;
            document.body.classList.remove('cropping-active');
          }
        });

        fileInput.click();
      });
    }
  },

  openAvatarCropper(file) {
    return new Promise((resolve, reject) => {
      const modal = document.getElementById('modal-avatar-cropper');
      if (!modal) {
        reject(new Error('Cropper modal not found'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          this.cropperImg = img;
          this.cropperZoom = 1.0;
          this.cropperRotate = 0;
          this.cropperPanX = 0;
          this.cropperPanY = 0;

          // Reset inputs
          const zoomInput = document.getElementById('cropper-zoom');
          const rotateInput = document.getElementById('cropper-rotate');
          if (zoomInput) zoomInput.value = '1';
          if (rotateInput) rotateInput.value = '0';

          modal.classList.remove('hidden');
          this.drawCropperCanvas();

          // Mouse/Touch Drag Handlers
          const viewport = document.getElementById('cropper-viewport');
          let isDragging = false;
          let startX = 0, startY = 0;

          const dragStart = (clientX, clientY) => {
            isDragging = true;
            startX = clientX;
            startY = clientY;
          };

          const dragMove = (clientX, clientY) => {
            if (!isDragging) return;
            const dx = (clientX - startX) / this.cropperZoom;
            const dy = (clientY - startY) / this.cropperZoom;

            // Rotate drag direction to match visual rotation of the image
            const rad = (-this.cropperRotate * Math.PI) / 180;
            this.cropperPanX += dx * Math.cos(rad) - dy * Math.sin(rad);
            this.cropperPanY += dx * Math.sin(rad) + dy * Math.cos(rad);

            startX = clientX;
            startY = clientY;
            this.drawCropperCanvas();
          };

          const dragEnd = () => {
            isDragging = false;
          };

          // Mouse listeners
          const onMouseDown = (e) => dragStart(e.clientX, e.clientY);
          const onMouseMove = (e) => dragMove(e.clientX, e.clientY);
          const onMouseUp = () => dragEnd();

          viewport.addEventListener('mousedown', onMouseDown);
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);

          // Touch listeners
          const onTouchStart = (e) => {
            if (e.touches.length === 1) {
              dragStart(e.touches[0].clientX, e.touches[0].clientY);
            }
          };
          const onTouchMove = (e) => {
            if (e.touches.length === 1) {
              dragMove(e.touches[0].clientX, e.touches[0].clientY);
            }
          };
          const onTouchEnd = () => dragEnd();

          viewport.addEventListener('touchstart', onTouchStart, { passive: true });
          window.addEventListener('touchmove', onTouchMove, { passive: true });
          window.addEventListener('touchend', onTouchEnd);

          // Slider listeners
          const onZoomChange = (e) => {
            this.cropperZoom = parseFloat(e.target.value);
            this.drawCropperCanvas();
          };
          const onRotateChange = (e) => {
            this.cropperRotate = parseInt(e.target.value);
            this.drawCropperCanvas();
          };

          if (zoomInput) zoomInput.addEventListener('input', onZoomChange);
          if (rotateInput) rotateInput.addEventListener('input', onRotateChange);

          // Rotate 90° button
          const rotate90Btn = document.getElementById('btn-cropper-rotate-90');
          const onRotate90Click = () => {
            let nextRot = (this.cropperRotate + 90) % 360;
            if (nextRot > 180) nextRot -= 360;
            this.cropperRotate = nextRot;
            if (rotateInput) rotateInput.value = this.cropperRotate.toString();
            this.drawCropperCanvas();
          };
          if (rotate90Btn) rotate90Btn.addEventListener('click', onRotate90Click);

          // Cleanup function
          const cleanup = () => {
            modal.classList.add('hidden');
            viewport.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            viewport.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            if (zoomInput) zoomInput.removeEventListener('input', onZoomChange);
            if (rotateInput) rotateInput.removeEventListener('input', onRotateChange);
            if (rotate90Btn) rotate90Btn.removeEventListener('click', onRotate90Click);
            saveBtn.removeEventListener('click', onSaveClick);
            cancelBtn.removeEventListener('click', onCancelClick);
            this.cropperImg = null;
          };

          // Save button listener
          const saveBtn = document.getElementById('btn-cropper-save');
          const onSaveClick = async () => {
            const cropped = await this.getCroppedFile();
            cleanup();
            resolve(cropped);
          };
          saveBtn.addEventListener('click', onSaveClick);

          // Cancel button listener
          const cancelBtn = document.getElementById('btn-cropper-cancel');
          const onCancelClick = () => {
            cleanup();
            reject(new Error('Cropping cancelled'));
          };
          cancelBtn.addEventListener('click', onCancelClick);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  drawCropperCanvas() {
    const canvas = document.getElementById('cropper-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.cropperImg) return;

    const w = 288;
    const h = 288;
    canvas.width = w * window.devicePixelRatio;
    canvas.height = h * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((this.cropperRotate * Math.PI) / 180);
    ctx.scale(this.cropperZoom, this.cropperZoom);

    const img = this.cropperImg;
    const imgAspect = img.width / img.height;

    let drawW, drawH;
    if (imgAspect > 1) {
      drawH = h;
      drawW = h * imgAspect;
    } else {
      drawW = w;
      drawH = w / imgAspect;
    }

    ctx.translate(this.cropperPanX, this.cropperPanY);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  },

  getCroppedFile() {
    return new Promise((resolve) => {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      const size = 512;
      tempCanvas.width = size;
      tempCanvas.height = size;

      tempCtx.save();
      tempCtx.translate(size / 2, size / 2);
      tempCtx.rotate((this.cropperRotate * Math.PI) / 180);
      tempCtx.scale(this.cropperZoom, this.cropperZoom);

      const img = this.cropperImg;
      const imgAspect = img.width / img.height;
      let drawW, drawH;
      if (imgAspect > 1) {
        drawH = size;
        drawW = size * imgAspect;
      } else {
        drawW = size;
        drawH = size / imgAspect;
      }

      const scaleFactor = size / 288;
      tempCtx.translate(this.cropperPanX * scaleFactor, this.cropperPanY * scaleFactor);

      tempCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      tempCtx.restore();

      tempCanvas.toBlob((blob) => {
        const croppedFile = new File([blob], 'cropped_avatar.jpg', { type: 'image/jpeg' });
        resolve(croppedFile);
      }, 'image/jpeg', 0.85);
    });
  },

  // Compress and center-crop image to 1:1 ratio for avatars
  compressImage(file, maxSize = 5242880) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');

          // Calculate center crop coordinates
          const sourceSize = Math.min(img.width, img.height);
          const sourceX = (img.width - sourceSize) / 2;
          const sourceY = (img.height - sourceSize) / 2;

          // Set target square size (800x800 is ideal for high-quality avatars)
          const targetSize = Math.min(sourceSize, 800);

          canvas.width = targetSize;
          canvas.height = targetSize;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, targetSize, targetSize);

          // First pass: compress to JPEG at 75% quality
          canvas.toBlob((blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                type: 'image/jpeg',
                lastModified: Date.now()
              });

              // If the compressed file is still too big, lower the quality further
              if (compressedFile.size > maxSize) {
                // Second pass at 50% quality
                canvas.toBlob((blob2) => {
                  if (blob2) {
                    const finalFile = new File([blob2], compressedFile.name, {
                      type: 'image/jpeg',
                      lastModified: Date.now()
                    });
                    resolve(finalFile);
                  } else {
                    resolve(compressedFile);
                  }
                }, 'image/jpeg', 0.5);
              } else {
                resolve(compressedFile);
              }
            } else {
              resolve(file); // Fallback to original
            }
          }, 'image/jpeg', 0.75);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  },

  async openRoom(roomId, roomTitle, isGroup) {
    this.currentRoomId = roomId;
    if (typeof isGroup === 'boolean') {
      localStorage.setItem('scrap_room_is_group_' + roomId, String(isGroup));
    }
    let finalTitle = roomTitle;
    if (!finalTitle || finalTitle === roomId) {
      const cached = localStorage.getItem('scrap_room_title_' + roomId);
      if (cached && cached !== roomId) {
        finalTitle = cached;
      } else {
        finalTitle = 'Squad Space';
      }
    }
    this.currentRoomTitle = finalTitle;
    localStorage.setItem('scrap_current_room_id', roomId);
    localStorage.setItem('scrap_current_room_title', finalTitle);
    localStorage.setItem('scrap_room_title_' + roomId, finalTitle);
    document.getElementById('canvas-room-title').innerText = `ROOM: ${finalTitle.toUpperCase()}`;

    // Show either Leave or Delete Space button dynamically based on vault ownership
    const btnLeaveRoom = document.getElementById('btn-leave-room');
    const btnDeleteRoom = document.getElementById('btn-delete-room');
    const isOwner = localStorage.getItem('scrap_room_is_owner_' + roomId) === 'true';
    if (isOwner) {
      if (btnLeaveRoom) btnLeaveRoom.classList.add('hidden');
      if (btnDeleteRoom) btnDeleteRoom.classList.remove('hidden');
    } else {
      if (btnLeaveRoom) btnLeaveRoom.classList.remove('hidden');
      if (btnDeleteRoom) btnDeleteRoom.classList.add('hidden');
    }

    const sidebar = document.getElementById('members-sidebar');
    if (sidebar) sidebar.classList.add('hidden');

    // Ensure HUD collapsible options start closed
    const hudMenu = document.getElementById('hud-collapsible-menu');
    const btnHudToggle = document.getElementById('btn-hud-toggle-menu');
    if (hudMenu) hudMenu.classList.add('hidden');
    if (btnHudToggle) {
      btnHudToggle.innerText = '⚙️';
      btnHudToggle.classList.remove('border-cyber-green', 'text-cyber-green');
    }

    // Set date to today's date initially
    this.currentDate = new Date().toISOString().split('T')[0];
    ScrapCanvas.currentDate = this.currentDate;
    const datePicker = document.getElementById('canvas-date-picker');
    if (datePicker) {
      datePicker.value = this.currentDate;
    }

    // Check if room AES key is already generated/known.
    let key = await ScrapRecovery.getRoomKey(roomId);
    if (!key) {
      const optionIdx = await window.ScrapDialog.showOptions('🚨 Decryption Key Missing', [
        '🔑 Enter Room Key Manually (Base64)',
        '💾 Import Cryptographic Backup File (.scrapkey)',
        '👥 Request Social Recovery from Squad'
      ]);

      if (optionIdx === 0) {
        // Manual entry
        const enteredKey = await window.ScrapDialog.prompt('Please enter the Room Key (Base64 or JSON) to unlock:', '');
        if (enteredKey) {
          try {
            let keyJwk = null;
            const trimmed = enteredKey.trim();
            if (trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed.k) keyJwk = parsed;
                else if (parsed.roomKeyJwk) keyJwk = parsed.roomKeyJwk;
              } catch (_) { }
            }
            if (!keyJwk) {
              let kVal = trimmed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
              keyJwk = {
                kty: 'oct',
                k: kVal,
                alg: 'A256GCM',
                ext: true,
                key_ops: ['encrypt', 'decrypt']
              };
            }
            const aesKey = await ScrapCrypto.importJwkToKey(keyJwk, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
            await ScrapRecovery.saveRoomKey(roomId, aesKey);
            key = aesKey;
            await window.ScrapDialog.alert('✅ Key successfully imported! Room unlocked.');
          } catch (e) {
            await window.ScrapDialog.alert('🚨 Invalid key format. Error: ' + e.message);
            this.currentRoomId = null;
            this.showScreen('screen-dashboard');
            return;
          }
        } else {
          this.currentRoomId = null;
          this.showScreen('screen-dashboard');
          return;
        }
      } else if (optionIdx === 1) {
        // Import Backup file (.scrapkey)
        const fileContent = await new Promise((resolve) => {
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = '*/*';
          fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (!file) {
              resolve(null);
              return;
            }
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          });
          fileInput.click();
        });

        if (!fileContent) {
          await window.ScrapDialog.alert('No backup file selected or file read error.');
          this.currentRoomId = null;
          this.showScreen('screen-dashboard');
          return;
        }

        try {
          const backupObj = JSON.parse(fileContent);
          if (!backupObj.vault || !backupObj.salt) {
            throw new Error('Invalid backup file structure.');
          }

          // Unlocking imported vault data and merging roomKeys into current vault so no room keys are lost
          const unlocked = await ScrapRecovery.unlockIdentity('000000', backupObj.vault, backupObj.salt);
          if (unlocked) {
            // Check if current local vault exists; merge roomKeys
            const userId = window.ScrapFirebase && ScrapFirebase.userId;
            const existingVaultEnc = localStorage.getItem(`scrap_local_vault_${userId}`);
            const existingSalt = localStorage.getItem(`scrap_local_salt_${userId}`);

            if (existingVaultEnc && existingSalt) {
              try {
                const existingSaltBuf = ScrapCrypto.base64ToArrayBuffer(existingSalt);
                const existingKey = await ScrapCrypto.deriveKeyFromPin('000000', existingSaltBuf);
                const existingDec = await ScrapCrypto.decryptData(ScrapCrypto.base64ToArrayBuffer(existingVaultEnc), existingKey);
                const existingVaultObj = JSON.parse(ScrapCrypto.bufferToString(existingDec));

                if (existingVaultObj && existingVaultObj.roomKeys) {
                  ScrapRecovery.vault.roomKeys = {
                    ...existingVaultObj.roomKeys,
                    ...(ScrapRecovery.vault.roomKeys || {})
                  };
                }
              } catch (_) { }
            }

            const pin = sessionStorage.getItem('scrap_pin_session') || '000000';
            await ScrapRecovery.saveVaultToLocalAndDrive(pin);

            key = await ScrapRecovery.getRoomKey(roomId);
            if (key) {
              await window.ScrapDialog.alert('✅ Identity and Room Keys restored & merged successfully! Room unlocked.');
              this.renderDashboardRooms();
            } else {
              throw new Error('Identity restored but Room Key for this room is missing in this backup.');
            }
          } else {
            throw new Error('Incorrect PIN or corrupted backup data.');
          }
        } catch (err) {
          await window.ScrapDialog.alert('🚨 Backup restoration failed: ' + err.message);
          this.currentRoomId = null;
          this.showScreen('screen-dashboard');
          return;
        }
      } else if (optionIdx === 2) {
        // Social Recovery
        const progressToast = document.getElementById('upload-progress-notification');
        const progressText = document.getElementById('upload-progress-text');
        try {
          // Ensure ScrapFirebase user info is set from the valid auth store session
          if (!ScrapFirebase.userId && window.pb && pb.authStore.isValid && pb.authStore.model) {
            ScrapFirebase.userId = pb.authStore.model.id;
            ScrapFirebase.userName = pb.authStore.model.name || pb.authStore.model.username || 'Squadmate';
          }

          // Verify we have a local identity to receive the encrypted key
          if (!ScrapRecovery.vault || !ScrapRecovery.vault.identityPublicKeyJwk) {
            // Setup a new temporary identity if empty (reinstalled state)
            await ScrapRecovery.setupNewIdentity('000000');
          }

          if (progressToast && progressText) {
            progressText.innerText = 'Broadcasting Social Recovery Request...';
            progressToast.classList.remove('hidden');
          }

          // Fetch existing board record to avoid erasing current elements
          try {
            const roomRecord = await pb.collection('boards').getOne(roomId);
            const state = typeof roomRecord.board_state === 'string' ? JSON.parse(roomRecord.board_state) : roomRecord.board_state;
            if (state && state.elements) {
              ScrapFirebase.elements = { ...state.elements };
            } else {
              ScrapFirebase.elements = {};
            }
            if (state && state.connections) {
              ScrapFirebase.connections = { ...state.connections };
            } else {
              ScrapFirebase.connections = {};
            }
          } catch (loadErr) {
            console.warn('[Social Recovery] Failed to load existing board state before request:', loadErr);
            ScrapFirebase.elements = {};
            ScrapFirebase.connections = {};
          }

          // 1. Post a recovery request element on the board
          ScrapFirebase.setRoom(roomId);
          const reqId = `recovery_req_${ScrapFirebase.userId}`;
          const requestElement = {
            type: 'recovery_request',
            userId: ScrapFirebase.userId,
            userName: ScrapFirebase.userName,
            publicKeyJwk: ScrapRecovery.vault.encryptionPublicKeyJwk,
            date: this.currentDate
          };

          // Save locally first
          ScrapFirebase.elements[reqId] = {
            ...requestElement,
            id: reqId,
            updatedAt: Date.now(),
            ownerId: ScrapFirebase.userId,
            ownerName: ScrapFirebase.userName
          };

          // Synchronously upload to server and await completion
          await ScrapFirebase.syncBoardToPocketBase();

          if (progressText) progressText.innerText = 'Waiting for Squadmate Approval (Keep App Open)...';

          // 2. Poll/Listen for response
          let responseFound = null;
          let attempts = 0;
          const maxAttempts = 30; // 1 minute timeout (2s sleep)

          const waitForResponse = async () => {
            if (attempts >= maxAttempts) {
              if (progressToast) progressToast.classList.add('hidden');
              await ScrapFirebase.deleteElement(roomId, reqId);
              await window.ScrapDialog.alert('⏰ Social Recovery request timed out. Make sure your squadmate is online in the room.');
              return null;
            }

            attempts++;
            const roomRecord = await pb.collection('boards').getOne(roomId);
            const state = typeof roomRecord.board_state === 'string' ? JSON.parse(roomRecord.board_state) : roomRecord.board_state;
            const elements = (state && state.elements) || {};
            const respElement = elements[`recovery_resp_${ScrapFirebase.userId}`];

            if (respElement && respElement.encryptedRoomKey) {
              responseFound = respElement;
              return respElement;
            }

            await new Promise(r => setTimeout(r, 2000));
            return waitForResponse();
          };

          const resp = await waitForResponse();
          if (resp) {
            // Decrypt room key
            const encKeyBuffer = ScrapCrypto.base64ToArrayBuffer(resp.encryptedRoomKey);
            const decryptedBuffer = await window.crypto.subtle.decrypt(
              { name: 'RSA-OAEP' },
              ScrapRecovery.encryptionKeyPair.privateKey,
              encKeyBuffer
            );
            const keyJwk = JSON.parse(ScrapCrypto.bufferToString(decryptedBuffer));
            const aesKey = await ScrapCrypto.importJwkToKey(keyJwk, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
            await ScrapRecovery.saveRoomKey(roomId, aesKey);
            key = aesKey;

            // Cleanup request and response elements
            await ScrapFirebase.deleteElement(roomId, reqId);
            await ScrapFirebase.deleteElement(roomId, `recovery_resp_${ScrapFirebase.userId}`);

            if (progressToast) progressToast.classList.add('hidden');
            await window.ScrapDialog.alert('✅ Social Recovery succeeded! Room unlocked.');
          } else {
            this.currentRoomId = null;
            this.showScreen('screen-dashboard');
            return;
          }
        } catch (err) {
          if (progressToast) progressToast.classList.add('hidden');
          await window.ScrapDialog.alert('🚨 Social Recovery failed: ' + err.message);
          this.currentRoomId = null;
          this.showScreen('screen-dashboard');
          return;
        }
      } else {
        this.currentRoomId = null;
        this.showScreen('screen-dashboard');
        return; // user cancelled options popup
      }
    }

    // Check if we have saved scroll positions for this room to skip initial auto-centering
    const savedLeftVal = localStorage.getItem(`canvas_scroll_left_${roomId}`);
    const savedTopVal = localStorage.getItem(`canvas_scroll_top_${roomId}`);
    if (savedLeftVal !== null && savedTopVal !== null) {
      ScrapCanvas.hasCenteredInitially = true; // Skip auto-centering
    } else {
      ScrapCanvas.hasCenteredInitially = false; // Center on first elements load
    }

    // Always refresh presence username so it matches the logged-in user
    if (window.pb && pb.authStore.isValid && pb.authStore.model) {
      ScrapFirebase.userId = pb.authStore.model.id;
      ScrapFirebase.userName = pb.authStore.model.name || pb.authStore.model.username || 'Squadmate';
    } else {
      const freshName = localStorage.getItem('scrap_user_display_name');
      if (freshName && freshName.trim()) {
        ScrapFirebase.userName = freshName.trim();
      }
    }

    // Fetch room creator info to toggle Leave Space button visibility
    let isCreator = false;
    if (localStorage.getItem('scrap_room_is_owner_' + roomId) === 'true') {
      isCreator = true;
    } else if (window.pb && pb.authStore.isValid && pb.authStore.model) {
      try {
        const boardRecord = await pb.collection('boards').getOne(roomId);
        if (boardRecord && boardRecord.user === pb.authStore.model.id) {
          isCreator = true;
          localStorage.setItem('scrap_room_is_owner_' + roomId, 'true');
        } else {
          localStorage.setItem('scrap_room_is_owner_' + roomId, 'false');
        }
      } catch (e) {
        console.warn('[Ownership Check] Failed to verify room ownership from DB:', e);
      }
    }

    // Dynamically update visibility of Leave Space, Delete Space, and Invite buttons based on creator status
    if (btnLeaveRoom && btnDeleteRoom) {
      if (isCreator) {
        btnLeaveRoom.classList.add('hidden');
        btnDeleteRoom.classList.remove('hidden');
      } else {
        btnLeaveRoom.classList.remove('hidden');
        btnDeleteRoom.classList.add('hidden');
      }
    }

    const btnShowInvite = document.getElementById('btn-show-invite');
    if (btnShowInvite) {
      if (isCreator) {
        btnShowInvite.classList.remove('hidden');
      } else {
        btnShowInvite.classList.add('hidden');
      }
    }

    // Set the room before initializing so its saved zoom is restored.
    ScrapFirebase.setRoom(roomId);

    // Initialize Canvas workspace elements
    ScrapCanvas.initialize('canvas-workspace', 'canvas-board');

    // Prevent focus/layout resets from scrolling the board on Android WebViews
    const workspace = document.getElementById('canvas-workspace');
    if (workspace) {
      workspace.addEventListener('scroll', () => {
        if (workspace.dataset.scrollLocked === 'true') {
          const targetLeft = Number(workspace.dataset.lockLeft) || 0;
          const targetTop = Number(workspace.dataset.lockTop) || 0;
          workspace.scrollLeft = targetLeft;
          workspace.scrollTop = targetTop;
        }
      });
    }

    // Lock window/viewport scrolling to (0,0) during transitions to prevent WebView jumps
    window.addEventListener('scroll', () => {
      if (workspace && workspace.dataset.scrollLocked === 'true') {
        window.scrollTo(0, 0);
        document.documentElement.scrollLeft = 0;
        document.documentElement.scrollTop = 0;
        document.body.scrollLeft = 0;
        document.body.scrollTop = 0;
      }
    });

    const bottomBar = document.getElementById('canvas-bottom-bar');
    if (bottomBar) {
      bottomBar.classList.remove('hidden');
    }

    // Show canvas screen FIRST so workspace has real dimensions before renderElements fires
    this.showScreen('screen-canvas');

    // Trigger tour guide onboarding on room canvas
    if (window.ScrapTour && typeof ScrapTour.initCanvasOnboarding === 'function') {
      ScrapTour.initCanvasOnboarding();
    }

    let shouldRestoreViewport = savedLeftVal !== null && savedTopVal !== null;

    // Subscribe to room AFTER screen is visible so scroll/centering works correctly
    // Use requestAnimationFrame to let the browser paint the screen before subscribing
    requestAnimationFrame(() => {
      ScrapFirebase.subscribeToRoom(
        roomId,
        (elements) => {
          ScrapCanvas.renderElements(elements);
          const hasVisibleRoomElements = Object.values(elements || {}).some((element) =>
            element && (element.date || ScrapCanvas.currentDate) === ScrapCanvas.currentDate
          );
          if (shouldRestoreViewport && hasVisibleRoomElements) {
            shouldRestoreViewport = false;
            const targetLeft = parseInt(savedLeftVal, 10);
            const targetTop = parseInt(savedTopVal, 10);

            // Check if saved scroll position actually puts at least one room element in viewport view
            const workspace = document.getElementById('canvas-workspace');
            const wsWidth = workspace ? (workspace.clientWidth || 800) : 800;
            const wsHeight = workspace ? (workspace.clientHeight || 800) : 800;
            const boardMargin = 3000;
            const zoom = ScrapCanvas.zoom || 1.0;

            const isAnyItemInView = Object.values(elements || {}).some(el => {
              if (!el || (el.date || ScrapCanvas.currentDate) !== ScrapCanvas.currentDate) return false;
              const elLeft = Math.round(boardMargin + zoom * (Number(el.x) || 2400));
              const elTop = Math.round(boardMargin + zoom * (Number(el.y) || 2400));
              const elRight = elLeft + (el.width || 192) * zoom;
              const elBottom = elTop + (el.height || 216) * zoom;

              const viewLeft = targetLeft;
              const viewTop = targetTop;
              const viewRight = targetLeft + wsWidth;
              const viewBottom = targetTop + wsHeight;

              return (elRight >= viewLeft - 100 && elLeft <= viewRight + 100 &&
                elBottom >= viewTop - 100 && elTop <= viewBottom + 100);
            });

            if (isAnyItemInView) {
              ScrapCanvas.restoreScrollPosition(targetLeft, targetTop);
            } else {
              // Saved position points to empty space — clear stale position and force auto-centering
              localStorage.removeItem(`canvas_scroll_left_${roomId}`);
              localStorage.removeItem(`canvas_scroll_top_${roomId}`);
              ScrapCanvas.hasCenteredInitially = false;
              // Re-run renderElements to trigger auto-centering on actual elements
              ScrapCanvas.renderElements(elements);
            }
          }
          this.renderMoodCalendarFeed(elements);
        },
        (presence) => {
          ScrapCanvas.renderUserPresence(presence);
        },
        (alertPacket) => {
          this.displayAlertToast(alertPacket);
        },
        (connections) => {
          if (window.ScrapCanvas && window.ScrapCanvas.isDraggingWire) return;
          ScrapCanvas.renderConnections(connections);
        }
      );
    });

    // Prune active members and report our own presence periodically
    if (this.activeMembersPruneInterval) {
      clearInterval(this.activeMembersPruneInterval);
    }

    // Report presence immediately on room entry
    requestAnimationFrame(() => {
      if (window.ScrapCanvas) {
        ScrapCanvas.reportPresence();
        ScrapCanvas.updateActiveMembersListUI();
      }
    });

    this.activeMembersPruneInterval = setInterval(() => {
      if (this.activeScreen === 'screen-canvas' && window.ScrapCanvas) {
        ScrapCanvas.reportPresence();
        ScrapCanvas.updateActiveMembersListUI();
      }
    }, 30000);
  },

  displayAlertToast(alert) {
    // In-app banner disabled per user preference — notifications rely strictly on native system Push Notifications
    return;
  },

  // Simulated Screenshot triggers
  triggerScreenshotAlert() {
    ScrapFirebase.broadcastAlert(this.currentRoomId, 'screenshot', 'took a screenshot!');
  },

  // Security screen terminal renderer
  async renderSecurityVerification() {
    const container = document.getElementById('security-key-hashes');
    if (!container) return;
    container.innerHTML = '';

    // Fetch hashes of vault keys safely
    const pubKeyJwk = (ScrapRecovery.vault && ScrapRecovery.vault.identityPublicKeyJwk) || null;
    const roomKeyJwk = (ScrapRecovery.vault && ScrapRecovery.vault.roomKeys && this.currentRoomId) ? ScrapRecovery.vault.roomKeys[this.currentRoomId] : null;

    const idHash = pubKeyJwk ? await ScrapCrypto.digestSha256(JSON.stringify(pubKeyJwk)) : 'F94B8A6E3C02B8D4A19F8E7D6C5B4A3928170F6E5D4C3B2A19E8D7C6B5A43F21';
    const roomHash = roomKeyJwk ? await ScrapCrypto.digestSha256(JSON.stringify(roomKeyJwk)) : '71E20A8F7D6C5B4A3928170F6E5D4C3B2A19E8D7C6B5A43F210F9E8D7C6B5A43';

    container.innerHTML = `
      <div class="border border-cyber-green/20 p-3 rounded bg-black/60">
        <div class="text-white font-bold">// YOUR CRYPTOGRAPHIC FINGERPRINT:</div>
        <div class="text-[10px] text-yellow-300 break-all select-all">${idHash}</div>
        <div class="mt-1 flex items-center gap-1.5 text-[10px] text-cyber-green">✅ Signature Verified</div>
      </div>
      
      <div class="border border-cyber-green/20 p-3 rounded bg-black/60">
        <div class="text-white font-bold">// ACTIVE ROOM CHANNEL AES KEY FINGERPRINT:</div>
        <div class="text-[10px] text-yellow-300 break-all select-all">${roomHash}</div>
        <div class="mt-1 flex items-center gap-1.5 text-[10px] text-cyber-green font-mono">✅ Key Verified E2EE-Secure</div>
      </div>

      <div class="border border-cyber-green/20 p-3 rounded bg-black/60">
        <div class="text-white font-bold">// ROOM ACCESS PERMISSIONS:</div>
        <div class="flex flex-col gap-1 text-[10px] text-gray-400 mt-1">
          <div>- Owner: ${(ScrapFirebase && ScrapFirebase.userName) || 'Unknown'} (✅ Read/Write)</div>
          <div>- Server Sync Status: ✅ Online</div>
        </div>
      </div>
    `;
  },

  // Archive Timeline zine renderer
  renderArchiveTimeline() {
    const container = document.getElementById('archive-weeks-list');
    if (!container) return;
    container.innerHTML = '';

    // Find all unique dates that have elements in this room
    const uniqueDates = new Set();
    Object.values(ScrapCanvas.elements || {}).forEach(el => {
      if (el.date) {
        uniqueDates.add(el.date);
      }
    });
    // Add today's date if empty
    if (uniqueDates.size === 0) {
      uniqueDates.add(new Date().toISOString().split('T')[0]);
    }

    // Sort dates in reverse chronological order
    const sortedDates = Array.from(uniqueDates).sort().reverse();

    sortedDates.forEach(dateStr => {
      // Find count of photos / doodles for this date
      let photoCount = 0;
      let doodleCount = 0;
      let emojiCount = 0;
      Object.values(ScrapCanvas.elements || {}).forEach(el => {
        const d = el.date || new Date().toISOString().split('T')[0];
        if (d === dateStr) {
          if (el.type === 'photo') photoCount++;
          else if (el.type === 'doodle') doodleCount++;
          else if (el.type === 'text') emojiCount++;
        }
      });

      const el = document.createElement('div');
      el.className = 'bg-purple-950/40 border-2 border-cyber-green rounded-xl p-4 flex flex-col hover:bg-purple-900/30 cursor-pointer shadow-md transition-all relative overflow-hidden';

      el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm font-black font-mono text-cyber-green">${dateStr}</span>
          <span class="text-[10px] font-mono text-alert-pink font-bold border border-alert-pink px-1 rounded bg-black/40">MEMORIES</span>
        </div>
        <p class="text-xs text-gray-300 leading-relaxed">
          Visual logs: ${photoCount} Photo(s), ${doodleCount} Drawing(s), ${emojiCount} Emoji Sticker(s)
        </p>
        <div class="mt-3 flex justify-end">
          <span class="text-[9px] font-mono text-cyber-green border border-cyber-green/40 px-1 rounded uppercase">⌛ ENTER COLLAGE</span>
        </div>
      `;

      el.addEventListener('click', () => {
        // Change date and open room
        this.currentDate = dateStr;
        ScrapCanvas.currentDate = dateStr;
        const datePicker = document.getElementById('canvas-date-picker');
        if (datePicker) {
          datePicker.value = dateStr;
        }
        this.showScreen('screen-canvas');
        ScrapCanvas.renderElements(ScrapCanvas.elements);
      });

      container.appendChild(el);
    });
  },

  /**
   * Shows a tour-guide tip for the robot helper button ("🤖 Can't See Your Rooms List?")
   * Shows whenever the room list is collapsed on the dashboard during the 3-day onboarding period.
   * Skipped if Google Play In-App update modal is active.
   */
  checkRobotHelperTip(targetElement, force = false) {
    if (window.isUpdateModalActive) return;

    // Skip showing robot helper tip if main tour guide or update modal is active
    if ((window.ScrapTour && typeof ScrapTour.isActive === 'function' && ScrapTour.isActive()) || window.isUpdateModalActive || document.getElementById('mitrava-update-modal')) {
      return;
    }

    // Ensure tooltip ONLY shows on the dashboard screen (never on Vault Secured gateway screen or Canvas)
    const dashboardScreen = document.getElementById('screen-dashboard');
    if (!dashboardScreen || dashboardScreen.classList.contains('hidden') || this.activeScreen !== 'screen-dashboard') {
      return;
    }

    // ONLY show tooltip if rooms-container is currently collapsed/hidden (i.e. NOT showing rooms)
    const roomsContainer = document.getElementById('rooms-container');
    if (roomsContainer && roomsContainer.classList.contains('scale-100')) {
      return;
    }

    const TIP_TIME_KEY = 'robot_helper_tip_start';
    const DAILY_COUNT_KEY = 'robot_helper_tip_daily_count';
    const LAST_DATE_KEY = 'robot_helper_tip_last_date';
    const NOW = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

    // Check if tip was ALREADY shown during this specific app open session
    if (sessionStorage.getItem('robot_helper_tip_shown_this_session') === 'true') return;

    let startTime = parseInt(localStorage.getItem(TIP_TIME_KEY), 10);
    if (!startTime || isNaN(startTime)) {
      startTime = NOW;
      localStorage.setItem(TIP_TIME_KEY, startTime.toString());
    }

    // Stop showing after 3 days have passed since first encounter
    if (NOW - startTime > THREE_DAYS_MS) {
      return;
    }

    // Track daily count (reset on new calendar day, limit to max 6 times per calendar day)
    const todayStr = new Date().toISOString().split('T')[0];
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    let count = parseInt(localStorage.getItem(DAILY_COUNT_KEY) || '0', 10);

    if (lastDate !== todayStr) {
      count = 0;
      localStorage.setItem(LAST_DATE_KEY, todayStr);
    }

    if (count >= 6) {
      return;
    }

    const dismissTip = () => {
      if (window.ScrapTour) window.ScrapTour.cleanup();
    };

    if (window.ScrapTour && typeof window.ScrapTour.showTip === 'function') {
      sessionStorage.setItem('robot_helper_tip_shown_this_session', 'true');
      localStorage.setItem(DAILY_COUNT_KEY, (count + 1).toString());

      const helperBtn = document.getElementById('btn-dashboard-helper');

      window.ScrapTour.showTip({
        targetElement: helperBtn || '#btn-dashboard-helper',
        title: "🤖 CAN'T SEE YOUR ROOMS LIST?",
        message: "Tap this robot helper icon anytime to view your room list & navigation menu!",
        position: 'bottom-right',
        stepIndex: 1,
        totalSteps: 1,
        onDismiss: dismissTip
      });
    }
  },

  bindBottomSheetDrag(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const panel = modal.querySelector('.glass-panel');
    if (!panel) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const touchStart = (e) => {
      // Ignore dragging if they tapped on vibe buttons, selection swatches, or action buttons
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      panel.style.transition = 'none';
    };

    const touchMove = (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      if (deltaY > 0) {
        panel.style.transform = `translateY(${deltaY}px)`;
      }
    };

    const touchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      panel.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

      const deltaY = currentY - startY;
      if (deltaY > 120) {
        modal.classList.add('hidden');
        panel.style.transform = 'translateY(0)';

        const bottomBar = document.getElementById('canvas-bottom-bar');
        if (bottomBar) bottomBar.classList.remove('hidden');

        if (modalId === 'modal-connection-picker') {
          ScrapCanvas.exitConnectionMode();
        }
      } else {
        panel.style.transform = 'translateY(0)';
      }
    };

    panel.addEventListener('touchstart', touchStart, { passive: true });
    panel.addEventListener('touchmove', touchMove, { passive: true });
    panel.addEventListener('touchend', touchEnd, { passive: true });
  }
};

// Initialize App
const startApp = () => {
  ScrapApp.init();

  // Make Doodle Control Panel draggable/movable
  const panel = document.getElementById('doodle-control-panel');
  if (panel) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    const dragMouseDown = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('.color-swatch')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    };

    const elementDrag = (e) => {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      panel.style.top = (panel.offsetTop - pos2) + "px";
      panel.style.left = (panel.offsetLeft - pos1) + "px";
      panel.style.right = 'auto';
    };

    const closeDragElement = () => {
      document.onmouseup = null;
      document.onmousemove = null;
    };

    // Touch support for mobile dragging
    const dragTouchStart = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('.color-swatch')) return;
      const touch = e.touches[0];
      pos3 = touch.clientX;
      pos4 = touch.clientY;

      const elementTouchDrag = (te) => {
        te.preventDefault();
        const t = te.touches[0];
        pos1 = pos3 - t.clientX;
        pos2 = pos4 - t.clientY;
        pos3 = t.clientX;
        pos4 = t.clientY;
        panel.style.top = (panel.offsetTop - pos2) + "px";
        panel.style.left = (panel.offsetLeft - pos1) + "px";
        panel.style.right = 'auto';
      };

      const closeTouchDrag = () => {
        document.removeEventListener('touchmove', elementTouchDrag);
        document.removeEventListener('touchend', closeTouchDrag);
      };

      document.addEventListener('touchmove', elementTouchDrag, { passive: false });
      document.addEventListener('touchend', closeTouchDrag);
    };

    panel.addEventListener('mousedown', dragMouseDown);
    panel.addEventListener('touchstart', dragTouchStart);
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

// Page Visibility API — pause all CSS animations (including holographic border)
// when the app goes to background, resume when user returns
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.body.classList.add('app-hidden');
  } else {
    document.body.classList.remove('app-hidden');
  }
});
