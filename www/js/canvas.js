/**
 * Scrap App Interactive Canvas Engine
 * Coordinates:
 * - Panning, zooming, and grid-rendering of the collage canvas
 * - Dragging, rotating, and scaling of items (images, text stickers, doodles)
 * - Doodle drawing actions
 * - Real-time tracking of cursor movement (presence bubbles)
 * - Canvas state compilation for saving/loading
 */

const ScrapCanvas = {
  doodleSparkleIntervals: {},
  draggedChildren: [],
  canvasEl: null,
  workspaceEl: null,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  scrollStartX: 0,
  scrollStartY: 0,
  hasCenteredInitially: false,
  isPanning: false,
  activeElement: null,
  activeElementId: null,
  dragStartX: 0,
  dragStartY: 0,
  elemStartX: 0,
  elemStartY: 0,
  elemStartAngle: 0,
  elemStartScale: 1,
  isRotatingScaling: false,
  isPinchingElement: false,
  isBoardPinching: false,
  elemStartDist: 0,
  elemStartAngle: 0,
  lastLocalEditTimes: {},



  // Doodle variables
  isDoodling: false,
  doodleColor: '#00FF66',
  doodleBrushSize: 5,
  currentDoodlePoints: [],
  currentDoodleStrokes: [],

  pendingEmoji: null,
  currentDate: new Date().toISOString().split('T')[0],

  _stickerCache: {},
  getTransparentSticker(srcUrl, callback) {
    if (this._stickerCache[srcUrl]) {
      callback(this._stickerCache[srcUrl]);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = srcUrl;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixelData = imgData.data;

        for (let i = 0; i < pixelData.length; i += 4) {
          const r = pixelData[i];
          const g = pixelData[i + 1];
          const b = pixelData[i + 2];
          if (r > 240 && g > 240 && b > 240) {
            pixelData[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        const resultUrl = canvas.toDataURL();
        this._stickerCache[srcUrl] = resultUrl;
        callback(resultUrl);
      } catch (err) {

        // Fallback to raw src URL directly
        this._stickerCache[srcUrl] = srcUrl;
        callback(srcUrl);
      }
    };
    img.onerror = (err) => {

      callback(srcUrl);
    };
  },

  // Element registry (local mirror)
  elements: {},
  connections: {},
  lastConnectionLocalEditTimes: {},
  isConnectionSelectionMode: false,
  connectionSourceId: null,
  connectionTargetId: null,
  connectionsSvgEl: null,
  connectionLabelsEl: null,
  zoom: 1.0,

  clearCanvas() {
    this.elements = {};
    this.connections = {};
    this.lastConnectionLocalEditTimes = {};
    this.activeMembers = {};
    this.resetCollageFlowToolbar();
    const listEl = document.getElementById('active-members-list');
    if (listEl) listEl.innerHTML = '';
    if (this.canvasEl) {
      // Remove all elements whose ID starts with 'item_'
      this.canvasEl.querySelectorAll('[id^="item_"]').forEach(el => el.remove());
    }
    if (this.connectionsSvgEl) {
      this.connectionsSvgEl.innerHTML = '';
    }
    if (this.connectionLabelsEl) {
      this.connectionLabelsEl.innerHTML = '';
    }
    const presenceContainer = document.getElementById('canvas-presence-container');
    if (presenceContainer) {
      presenceContainer.innerHTML = '';
    }
  },

  initialize(workspaceId, canvasId) {
    this.workspaceEl = document.getElementById(workspaceId);
    this.canvasEl = document.getElementById(canvasId);
    this.connectionsSvgEl = document.getElementById('canvas-connections-svg');
    this.connectionLabelsEl = document.getElementById('canvas-connection-labels');

    // Clear elements from memory and DOM on initialization (prevent room switching ghost artifacts)
    this.clearCanvas();

    // Restore saved zoom level for this room or fallback to 1.0
    const rId = ScrapFirebase.roomId;
    const savedZoom = rId ? localStorage.getItem(`canvas_zoom_${rId}`) : null;
    this.zoom = savedZoom ? parseFloat(savedZoom) : 1.0;
    if (this.canvasEl) {
      this.canvasEl.style.transform = `scale(${this.zoom})`;
    }
    localStorage.setItem('canvas_zoom_level', String(this.zoom));

    this.initCollageFlowToolbar();
    this.setupWorkspaceEvents();
  },

  setupWorkspaceEvents() {
    // Canvas Panning via Native Scroll simulation on Desktop mouse drag
    this.workspaceEl.addEventListener('mousedown', (e) => {
      if (e.target === this.workspaceEl || e.target === this.canvasEl) {
        this.activeElement = null;
        this.activeElementId = null;
        this.isPanning = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.scrollStartX = this.workspaceEl.scrollLeft;
        this.scrollStartY = this.workspaceEl.scrollTop;
        this.workspaceEl.style.cursor = 'grabbing';
      }
    });

    // Clicking workspace background deselects selected element controls and records click coordinate
    this.workspaceEl.addEventListener('click', (e) => {
      if (e.target === this.workspaceEl || e.target === this.canvasEl) {
        document.querySelectorAll('.active-controls').forEach(el => {
          el.classList.remove('active-controls');
        });
        this.activeElement = null;
        this.activeElementId = null;
        const rect = this.workspaceEl.getBoundingClientRect();
        this.lastTouchX = e.clientX - rect.left;
        this.lastTouchY = e.clientY - rect.top;
      }
    });

    // Save scroll position to preserve layout coordinates
    this.workspaceEl.addEventListener('scroll', () => {
      if (ScrapFirebase.roomId &&
        this.workspaceEl.dataset.scrollLocked !== 'true' &&
        this.workspaceEl.offsetWidth > 0 &&
        this.workspaceEl.offsetHeight > 0) {
        ScrapFirebase.saveViewport(ScrapFirebase.roomId, this.workspaceEl.scrollLeft, this.workspaceEl.scrollTop);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.workspaceEl.scrollLeft = this.scrollStartX - dx;
        this.workspaceEl.scrollTop = this.scrollStartY - dy;

        // Broadcast mouse presence
        this.reportPresence(e);
      } else if (this.activeElement && !this.isRotatingScaling) {
        // Dragging element
        const dx = (e.clientX - this.dragStartX) / this.zoom;
        const dy = (e.clientY - this.dragStartY) / this.zoom;

        const elId = this.activeElementId;
        const elemData = this.elements[elId];
        if (elemData) {
          this.lastLocalEditTimes[elId] = Date.now();
          elemData.x = this.elemStartX + dx;
          elemData.y = this.elemStartY + dy;
          this.updateElementStyle(elId);

          if (this.draggedChildren && this.draggedChildren.length > 0) {
            this.draggedChildren.forEach(child => {
              const childData = this.elements[child.id];
              if (childData) {
                this.lastLocalEditTimes[child.id] = Date.now();
                childData.x = child.startX + dx;
                childData.y = child.startY + dy;
                this.updateElementStyle(child.id);
              }
            });
          }
        }
      } else if (this.activeElement && this.isRotatingScaling) {
        // Rotate & Scale element
        const elId = this.activeElementId;
        const elemData = this.elements[elId];
        if (elemData) {
          this.lastLocalEditTimes[elId] = Date.now();
          const rect = this.activeElement.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          // Calculate angle relatively
          const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
          elemData.rotation = Math.round(this.elemStartRotation + (angle - this.elemStartAngle));

          // Calculate scale relatively
          const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
          elemData.scale = Math.max(0.4, Math.min(3.0, this.elemStartScale * (dist / (this.elemStartDist || 1))));

          this.updateElementStyle(elId);
        }
      }

      // Update coordinates tracker when mouse moves on canvas
      if (!this.isPanning && (e.target === this.workspaceEl || e.target === this.canvasEl)) {
        this.reportPresence(e);
      }
    });

    window.addEventListener('mouseup', async () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.workspaceEl.style.cursor = 'default';
      }

      if (this.activeElement) {
        const elId = this.activeElementId;
        const elemData = this.elements[elId];

        // Keep local lock active
        this.lastLocalEditTimes[elId] = Date.now();

        this.activeElement = null;
        this.activeElementId = null;
        this.isRotatingScaling = false;

        // Save final position with overlap sticker detection
        if (elemData) {
          try {
            await this.saveElementWithStickCheck(elId, elemData);
          } finally {
            // Extend lock slightly after save completes
            this.lastLocalEditTimes[elId] = Date.now();
          }
        }

        if (this.draggedChildren && this.draggedChildren.length > 0) {
          const children = [...this.draggedChildren];
          this.draggedChildren = [];
          children.forEach(async (child) => {
            const childData = this.elements[child.id];
            if (childData) {
              try {
                this.lastLocalEditTimes[child.id] = Date.now();
                await this.saveElementWithStickCheck(child.id, childData);
              } finally {
                this.lastLocalEditTimes[child.id] = Date.now();
              }
            }
          });
        }
      }
    });

    // Mobile / Touch deselect helper setup
    let workspaceLastTap = 0;

    // Pinch-to-zoom state variables
    let startTouchDist = 0;
    let startZoom = 1.0;

    this.workspaceEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const touchesOverElement = Array.from(e.touches).some((touch) => {
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          return target && target.closest && target.closest('[id^="item_"]');
        });
        if (touchesOverElement && this.activeElement) return;

        e.preventDefault();
        this.isBoardPinching = true;
        this.activeElement = null;
        this.activeElementId = null;
        this.isPinchingElement = false;
        this.isPanning = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        startTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        startZoom = this.zoom || 1.0;
        return;
      }

      if (e.target === this.workspaceEl || e.target === this.canvasEl) {
        this.activeElement = null;
        this.activeElementId = null;
        this.isPinchingElement = false;
      }
      if (this.activeElement || this.isDraggingWire) return; // Ignore workspace interactions while dragging elements or connections

      if (e.touches.length === 1) {
        // Deselect controls on backdrop touch
        document.querySelectorAll('.active-controls').forEach(el => {
          el.classList.remove('active-controls');
        });
        // Start manual single-finger panning
        this.isPanning = true;
        const touch = e.touches[0];
        this.dragStartX = touch.clientX;
        this.dragStartY = touch.clientY;
        this.scrollStartX = this.workspaceEl.scrollLeft;
        this.scrollStartY = this.workspaceEl.scrollTop;

        // Track touch location relative to the workspace for precise placement
        const rect = this.workspaceEl.getBoundingClientRect();
        this.lastTouchX = touch.clientX - rect.left;
        this.lastTouchY = touch.clientY - rect.top;
      }
    }, { passive: false });

    this.workspaceEl.addEventListener('touchmove', (e) => {
      if (this.isDraggingWire) {
        e.preventDefault();
        return;
      }

      if (this.isPinchingElement) return;

      if (e.touches.length === 2 && this.isBoardPinching) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (startTouchDist > 0) {
          const ratio = dist / startTouchDist;
          const newZoom = Math.min(Math.max(startZoom * ratio, 0.35), 2.5);
          this.setZoom(newZoom);
        }
        return;
      }

      if (this.activeElement) return;

      if (e.touches.length === 1 && this.isPanning) {
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - this.dragStartX;
        const dy = touch.clientY - this.dragStartY;
        if (this.panAnimationFrame) {
          cancelAnimationFrame(this.panAnimationFrame);
        }
        this.panAnimationFrame = requestAnimationFrame(() => {
          this.workspaceEl.scrollLeft = this.scrollStartX - dx;
          this.workspaceEl.scrollTop = this.scrollStartY - dy;
        });
      }
    }, { passive: false });

    this.workspaceEl.addEventListener('touchend', (e) => {
      this.isPanning = false;
      if (e.touches.length < 2) {
        startTouchDist = 0;
        this.isBoardPinching = false;
      }

      // Prevent browser double-tap viewport zoom
      const now = Date.now();
      if (now - workspaceLastTap < 300) {
        e.preventDefault();
      }
      workspaceLastTap = now;
    }, { passive: false });

    // Wheel zoom support for desktop testing
    this.workspaceEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY * -0.005;
        const newZoom = Math.min(Math.max((this.zoom || 1.0) + delta, 0.35), 2.5);
        this.setZoom(newZoom);
      }
    }, { passive: false });

    // Window level touch move/end handlers to drag/rotate/scale elements
    window.addEventListener('touchmove', (e) => {
      if (this.activeElement) {
        const elId = this.activeElementId;
        const elemData = this.elements[elId];
        if (!elemData) return;

        this.lastLocalEditTimes[elId] = Date.now();

        if (e.touches.length === 2 && this.isPinchingElement) {
          e.preventDefault();
          const touch1 = e.touches[0];
          const touch2 = e.touches[1];
          const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
          const angle = Math.atan2(touch1.clientY - touch2.clientY, touch1.clientX - touch2.clientX) * (180 / Math.PI);

          if (this.elemStartDist > 10) {
            elemData.scale = Math.max(0.4, Math.min(3.0, this.elemStartScale * (dist / this.elemStartDist)));
            elemData.rotation = Math.round(this.elemStartRotation + (angle - this.elemStartAngle));
            this.updateElementStyle(elId);
          }
        } else if (e.touches.length === 1 && !this.isPinchingElement) {
          e.preventDefault(); // Prevent scrolling background on mobile
          const touch = e.touches[0];
          if (!this.isRotatingScaling) {
            // Dragging element
            const dx = (touch.clientX - this.dragStartX) / this.zoom;
            const dy = (touch.clientY - this.dragStartY) / this.zoom;
            elemData.x = this.elemStartX + dx;
            elemData.y = this.elemStartY + dy;
            this.updateElementStyle(elId);

            if (this.draggedChildren && this.draggedChildren.length > 0) {
              this.draggedChildren.forEach(child => {
                const childData = this.elements[child.id];
                if (childData) {
                  this.lastLocalEditTimes[child.id] = Date.now();
                  childData.x = child.startX + dx;
                  childData.y = child.startY + dy;
                  this.updateElementStyle(child.id);
                }
              });
            }
          } else {
            // Rotate & Scale element
            const rect = this.activeElement.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const angle = Math.atan2(touch.clientY - centerY, touch.clientX - centerX) * (180 / Math.PI);
            elemData.rotation = Math.round(this.elemStartRotation + (angle - this.elemStartAngle));

            const dist = Math.hypot(touch.clientX - centerX, touch.clientY - centerY);
            elemData.scale = Math.max(0.4, Math.min(3.0, this.elemStartScale * (dist / (this.elemStartDist || 1))));

            this.updateElementStyle(elId);
          }
        }
      }
    }, { passive: false });

    window.addEventListener('touchstart', (e) => {
      if (this.activeElement && e.touches.length === 2) {
        this.isPinchingElement = true;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        this.elemStartDist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        this.elemStartAngle = Math.atan2(touch1.clientY - touch2.clientY, touch1.clientX - touch2.clientX) * (180 / Math.PI);

        const data = this.elements[this.activeElementId];
        if (data) {
          this.elemStartScale = data.scale || 1.0;
          this.elemStartRotation = data.rotation || 0;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', async () => {
      this.isPinchingElement = false;
      if (this.activeElement) {
        const elId = this.activeElementId;
        const elemData = this.elements[elId];

        // Keep local lock active
        this.lastLocalEditTimes[elId] = Date.now();

        this.activeElement = null;
        this.activeElementId = null;
        this.isRotatingScaling = false;

        // Save final position with overlap sticker detection
        if (elemData) {
          try {
            await this.saveElementWithStickCheck(elId, elemData);
          } finally {
            // Extend the lock slightly after save completes to let polling catch up
            this.lastLocalEditTimes[elId] = Date.now();
          }
        }

        if (this.draggedChildren && this.draggedChildren.length > 0) {
          const children = [...this.draggedChildren];
          this.draggedChildren = [];
          children.forEach(async (child) => {
            const childData = this.elements[child.id];
            if (childData) {
              try {
                this.lastLocalEditTimes[child.id] = Date.now();
                await this.saveElementWithStickCheck(child.id, childData);
              } finally {
                this.lastLocalEditTimes[child.id] = Date.now();
              }
            }
          });
        }
      }
    });

    window.addEventListener('touchcancel', () => {
      this.isPinchingElement = false;
      this.activeElement = null;
      this.activeElementId = null;
      this.isRotatingScaling = false;
      this.draggedChildren = [];
    });
  },

  async saveElementWithStickCheck(id, data) {
    if (!data) return;

    // Check if it's an emoji/text sticker overlapping a photo
    // Check if it's an emoji/text sticker or doodle overlapping a photo
    if (data.type === 'text' || data.type === 'doodle' || data.type === 'sticker') {
      // 1. Estimate/get sticker dimensions for exact center detection
      let stickerW = 0;
      let stickerH = 0;

      if (data.type === 'doodle') {
        stickerW = data.width || 192;
        stickerH = data.height || 192;
      } else if (data.type === 'sticker') {
        stickerW = data.width || 80;
        stickerH = data.height || 80;
      } else {
        const domEl = document.getElementById(`item_${id}`);
        stickerW = domEl ? domEl.clientWidth : 0;
        stickerH = domEl ? domEl.clientHeight : 0;

        if (!stickerW || !stickerH) {
          let isEmojiText = false;
          try {
            const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
            isEmojiText = data.text ? emojiRegex.test(data.text) : false;
          } catch (e) {
            isEmojiText = data.text ? (data.text.length <= 4 && /[^\x00-\x7F]/.test(data.text)) : false;
          }
          if (isEmojiText) {
            stickerW = 60; // Emojis are now 44px + margins
            stickerH = 60;
          } else {
            // Text stickers are now text-2xl (~24px font size, ~14px width per character)
            stickerW = Math.max(85, (data.text ? data.text.length : 5) * 14 + 28);
            stickerH = 54;
          }
        }
      }

      const emCenterX = data.x + (stickerW / 2);
      const emCenterY = data.y + (stickerH / 2);

      let overlappingPhotoId = null;
      let overlappingPhotoData = null;

      // 2. Perform accurate projection boundary check to support rotated/scaled photo margins (including bottom white space)
      for (const [otherId, other] of Object.entries(this.elements)) {
        if (other && other.type === 'photo' && (other.date || this.currentDate) === this.currentDate && otherId !== id) {
          const pw = 192; // Photo base width
          const ph = 216; // Photo base height

          // Photo center
          const PX = other.x + pw / 2;
          const PY = other.y + ph / 2;

          // Offset vector
          const dx = emCenterX - PX;
          const dy = emCenterY - PY;

          // Rotate vector backwards by photo rotation
          const theta = other.rotation || 0;
          const rad = -theta * Math.PI / 180;
          const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
          const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

          // Account for photo scale
          const photoScale = other.scale || 1.0;
          const relCenterX = rx / photoScale;
          const relCenterY = ry / photoScale;

          // Project to photo card local coordinates (0 to pw, 0 to ph)
          const lx = (pw / 2) + relCenterX;
          const ly = (ph / 2) + relCenterY;



          if (data.type === 'doodle') {
            // Doodle/brush color ONLY sticks if placed strictly on the bottom 1/4 white space of the card (ly >= 170)
            if (lx >= 0 && lx <= pw && ly >= 170 && ly <= ph + 10) {
              overlappingPhotoId = otherId;
              overlappingPhotoData = other;

              break;
            }
          } else {
            // Text stickers/emojis can stick anywhere on the card
            if (lx >= 0 && lx <= pw && ly >= 0 && ly <= ph) {
              overlappingPhotoId = otherId;
              overlappingPhotoData = other;
              break;
            }
          }
        }
      }

      if (overlappingPhotoId && overlappingPhotoData) {
        // Detect if emoji or styled text or doodle or graphic sticker
        let itemTypeName = "sticker";
        if (data.type === 'doodle') {
          itemTypeName = "drawing";
        } else if (data.type === 'sticker') {
          itemTypeName = "graphic sticker";
        } else {
          let isEmoji = false;
          try {
            const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
            isEmoji = data.text ? emojiRegex.test(data.text) : false;
          } catch (e) {
            isEmoji = data.text ? (data.text.length <= 4 && /[^\x00-\x7F]/.test(data.text)) : false;
          }
          itemTypeName = isEmoji ? "emoji" : "sticker";
        }

        if (await window.ScrapDialog.confirm(`Attach and lock this ${itemTypeName} onto this photo?`)) {
          // Photo card center on canvas (the photo card is exactly 192px wide by 216px high)
          const PX = overlappingPhotoData.x + 96;
          const PY = overlappingPhotoData.y + 108;

          // Calculate relative vector from photo center to sticker center
          const dx = emCenterX - PX;
          const dy = emCenterY - PY;

          // Rotate vector backwards by photo's rotation angle to align with the photo's local coordinates
          const theta = overlappingPhotoData.rotation || 0;
          const rad = -theta * Math.PI / 180;
          const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
          const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

          // Account for photo's scale factor
          const photoScale = overlappingPhotoData.scale || 1.0;
          const relCenterX = rx / photoScale;
          const relCenterY = ry / photoScale;

          overlappingPhotoData.stickers = overlappingPhotoData.stickers || {};
          const stickerId = `sticker_${Date.now()}`;
          const newSticker = {
            x: relCenterX,
            y: relCenterY,
            rotation: (data.rotation || 0) - (overlappingPhotoData.rotation || 0),
            scale: (data.scale || 1.0) / photoScale
          };
          if (data.type === 'doodle') {
            newSticker.type = 'doodle';
            newSticker.strokes = data.strokes || [];
            newSticker.color = data.color || '#00FF66';
            newSticker.width = stickerW;
            newSticker.height = stickerH;
          } else if (data.type === 'sticker') {
            newSticker.type = 'sticker';
            newSticker.src = data.src;
            newSticker.width = stickerW;
            newSticker.height = stickerH;
          } else {
            newSticker.text = data.text;
          }
          overlappingPhotoData.stickers[stickerId] = newSticker;

          // Immediately purge old independent element from DOM and cache locally so it disappears instantly and prevents duplicate render flicker!
          const oldDomEl = document.getElementById(`item_${id}`);
          if (oldDomEl) oldDomEl.remove();
          delete this.elements[id];

          // Immediately update the photo element DOM locally so it renders the new stickers instantly!
          this.renderOrUpdateElementDom(overlappingPhotoId, overlappingPhotoData);

          // Then, execute atomic save on Firebase
          const updates = {};
          updates[overlappingPhotoId] = overlappingPhotoData;
          updates[id] = null; // Setting a key to null deletes it in Firebase!

          await ScrapFirebase.updateMultipleElements(ScrapFirebase.roomId, updates);
          return;
        }
      }
    }

    await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, data);
  },

  applyCanvasTransform() {
    this.canvasEl.style.transform = `scale(${this.zoom})`;
  },

  setZoom(value) {
    this.zoom = Math.min(Math.max(Number(value) || 1.0, 0.35), 2.5);
    if (this.canvasEl) {
      this.applyCanvasTransform();
    }

    localStorage.setItem('canvas_zoom_level', String(this.zoom));
    const roomId = (window.ScrapApp && window.ScrapApp.currentRoomId) || ScrapFirebase.roomId;
    if (roomId) {
      localStorage.setItem(`canvas_zoom_${roomId}`, String(this.zoom));
    }
    if (this.connections) {
      this.renderConnections(this.connections);
    }
  },

  centerOnElement(x, y, w = 176, h = 200, isFallback = false) {
    if (!this.workspaceEl) return;

    // Wait 80ms for layout to settle after a zoom transform change
    setTimeout(() => {
      const width = this.workspaceEl.clientWidth;
      const height = this.workspaceEl.clientHeight;

      if (width === 0 || height === 0) {
        setTimeout(() => this.centerOnElement(x, y, w, h, isFallback), 100);
        return;
      }

      // The scroll container (#canvas-workspace) operates in unscaled layout pixels.
      // CSS scale() on #canvas-board is VISUAL only — it does NOT change scrollLeft/scrollTop bounds.
      // The board has a fixed 3000px CSS margin, and element x,y are in board-space coordinates.
      // So the scroll offset to center element (x, y) includes the active zoom:
      //   scrollLeft = boardMargin + zoom * (x + w/2) - viewportWidth/2
      const boardMargin = 3000;
      const zoom = this.zoom || 1.0;
      const scrollLeftVal = Math.round(boardMargin + zoom * (x + w / 2) - width / 2);
      const scrollTopVal = Math.round(boardMargin + zoom * (y + h / 2) - height / 2);

      // Apply scroll in next paint frame
      requestAnimationFrame(() => {
        this.workspaceEl.scrollLeft = scrollLeftVal;
        this.workspaceEl.scrollTop = scrollTopVal;

        if (!isFallback) {
          this.hasCenteredInitially = true;
        }
      });
    }, 80);
  },

  restoreScrollPosition(left, top) {
    if (!this.workspaceEl) return;
    const width = this.workspaceEl.clientWidth;
    const height = this.workspaceEl.clientHeight;

    if (width === 0 || height === 0) {
      setTimeout(() => this.restoreScrollPosition(left, top), 100);
      return;
    }

    requestAnimationFrame(() => {
      this.workspaceEl.scrollLeft = left;
      this.workspaceEl.scrollTop = top;
      this.hasCenteredInitially = true;
    });
  },

  spawnEmojiBurst(domEl, emoji) {
    if (!domEl || !this.canvasEl) return;

    // Calculate coordinates relative to the canvas board space (independent of zoom scale)
    let x = domEl.offsetLeft + domEl.clientWidth / 2;
    let y = domEl.offsetTop + domEl.clientHeight / 2;

    const elId = domEl.id;
    if (elId && this.elements[elId]) {
      const elData = this.elements[elId];
      x = (Number(elData.x) || 0) + (domEl.clientWidth / 2 || 88);
      y = (Number(elData.y) || 0) + (domEl.clientHeight / 2 || 100);
    }

    // Spawn multiple floating emoji particles with randomized drift/size properties
    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('span');
      particle.className = 'floating-emoji-particle';
      particle.innerText = emoji;
      particle.style.fontSize = `${Math.floor(Math.random() * 12) + 24}px`;
      particle.style.left = `${x + (Math.random() * 50 - 25)}px`;
      particle.style.top = `${y + (Math.random() * 50 - 25)}px`;

      const driftRot = Math.random() * 50 - 25;
      particle.style.setProperty('--rot-deg', `${driftRot}deg`);
      particle.style.animationDelay = `${Math.random() * 0.2}s`;
      particle.style.animationDuration = `${0.7 + Math.random() * 0.4}s`;

      this.canvasEl.appendChild(particle);

      // Automatic DOM cleanup
      setTimeout(() => {
        particle.remove();
      }, 1500);
    }
  },

  spawnFullScreenSparks(emoji) {
    const count = 35;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'screen-spark-particle';
      p.innerText = emoji;

      const size = Math.floor(Math.random() * 14) + 24; // Generates sizes between 24px and 38px
      const left = Math.floor(Math.random() * 100);
      const delay = Math.random() * 1.2;
      const duration = 2.2 + Math.random() * 1.2;
      const driftX = Math.floor(Math.random() * 120) - 60;
      const driftRot = Math.floor(Math.random() * 90) - 45;

      p.style.fontSize = `${size}px`;
      p.style.left = `${left}vw`;
      p.style.animationDelay = `${delay}s`;
      p.style.animationDuration = `${duration}s`;
      p.style.setProperty('--drift-x', `${driftX}px`);
      p.style.setProperty('--drift-rot', `${driftRot}deg`);

      document.body.appendChild(p);

      setTimeout(() => {
        p.remove();
      }, (delay + duration + 0.5) * 1000);
    }
  },

  reportPresence(e) {
    // Map screen coordinate to canvas coordinate using native scroll offsets
    const rect = this.workspaceEl.getBoundingClientRect();
    const clientX = e ? e.clientX : (rect.left + rect.width / 2);
    const clientY = e ? e.clientY : (rect.top + rect.height / 2);
    const boardMargin = 3000;
    const x = Math.round((clientX - rect.left + this.workspaceEl.scrollLeft - boardMargin) / this.zoom);
    const y = Math.round((clientY - rect.top + this.workspaceEl.scrollTop - boardMargin) / this.zoom);
    ScrapFirebase.broadcastPresence(ScrapFirebase.roomId, x, y);
  },

  renderElements(elementsMap) {
    const map = elementsMap ? { ...elementsMap } : {};

    // Detect spark elements for reaction triggers
    for (const [id, data] of Object.entries(map)) {
      if (data && data.type === 'spark') {
        if (data.userName !== (ScrapFirebase.userName || 'Squadmate')) {
          if (!this.processedSparkIds) this.processedSparkIds = new Set();
          if (!this.processedSparkIds.has(id)) {
            this.processedSparkIds.add(id);
            this.spawnFullScreenSparks(data.emoji || '❤️');
            if (data.targetElementId === 'center') {
              this.spawnEmojiBurstOnBubble(data.emoji || '❤️');
            } else if (data.targetElementId) {
              const targetDom = document.getElementById(data.targetElementId);
              if (targetDom) {
                this.spawnEmojiBurst(targetDom, data.emoji || '❤️');
              }
            }
          }
        }
        delete map[id];
      } else if (data && data.type === 'mood') {
        delete map[id];
      }
    }

    // Automatically purge legacy offline lofi synth elements (which lack audioFileId)
    for (const [id, data] of Object.entries(map)) {
      if (data && data.type === 'music' && !data.audioFileId) {
        delete map[id];
        ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);
      }
    }

    const incomingIds = Object.keys(map);

    const isCollageFlowActive = Boolean(this.currentCollageFilter && this.currentCollageFilter !== 'all') || Boolean(document.getElementById('collage-flow-filter-bar') && !document.getElementById('collage-flow-filter-bar').classList.contains('hidden'));

    // Clear elements from DOM that are no longer in DB or don't match the selected date (unless Collage Flow is active)
    document.querySelectorAll('[id^="item_"]').forEach(domEl => {
      const id = domEl.id.replace('item_', '');
      const data = map[id];
      const elDate = data ? (data.date || this.currentDate) : null;

      let shouldPurge = !incomingIds.includes(id);
      if (!shouldPurge && !isCollageFlowActive) {
        shouldPurge = (elDate !== this.currentDate);
      }

      if (shouldPurge) {
        this.stopDoodleSparkleLoop(id);
        domEl.remove();
        if (!incomingIds.includes(id)) {
          delete this.elements[id];
        }
      }
    });

    // Update or add elements matching the selected date
    for (const [id, data] of Object.entries(map)) {
      if (!data) continue;

      // If this element is currently being dragged/edited locally, IGNORE database coordinates to prevent snap-back!
      if (this.activeElementId === id && this.elements[id]) {

        data.x = this.elements[id].x;
        data.y = this.elements[id].y;
        data.scale = this.elements[id].scale;
        data.rotation = this.elements[id].rotation;
      } else {
        // Prevent snapping back to old database coordinates if edited recently (cooldown lock)
        const lastEdit = this.lastLocalEditTimes[id] || 0;
        const timeDiff = Date.now() - lastEdit;

        const localPhoto = this.elements[id];
        const localStickersCount = (localPhoto && localPhoto.stickers) ? Object.keys(localPhoto.stickers).length : 0;
        const dbStickersCount = (data && data.stickers) ? Object.keys(data.stickers).length : 0;

        // Release lock only if coordinates and sticker/text configurations match
        if (localPhoto &&
          Math.abs(data.x - localPhoto.x) < 1 &&
          Math.abs(data.y - localPhoto.y) < 1 &&
          localStickersCount === dbStickersCount &&
          (data.polaroidText || '') === (localPhoto.polaroidText || '')) {
          this.lastLocalEditTimes[id] = 0;
        } else if (timeDiff < 10000 && localPhoto) {
          data.x = localPhoto.x;
          data.y = localPhoto.y;
          data.scale = localPhoto.scale;
          data.rotation = localPhoto.rotation;
          data.stickers = localPhoto.stickers;
          data.polaroidText = localPhoto.polaroidText;
        }
      }

      const isCollageFlowActive = Boolean(this.currentCollageFilter && this.currentCollageFilter !== 'all') || Boolean(document.getElementById('collage-flow-filter-bar') && !document.getElementById('collage-flow-filter-bar').classList.contains('hidden'));

      let shouldRender = false;
      if (isCollageFlowActive) {
        shouldRender = true;
      } else {
        const elDate = data.date || this.currentDate;
        shouldRender = (elDate === this.currentDate);
      }

      if (shouldRender) {
        try {
          this.renderOrUpdateElementDom(id, data);
        } catch (e) { }
      } else {
        const existing = document.getElementById(`item_${id}`);
        if (existing) existing.remove();
      }
    }

    // Save elements map only after merging coords
    this.elements = map;

    // Cache elements to local storage to prevent positioning race conditions during re-syncs
    if (ScrapFirebase.roomId && map) {
      localStorage.setItem(`scrap_elements_cache_${ScrapFirebase.roomId}`, JSON.stringify(map));
    }

    if (!this.hasCenteredInitially && Object.keys(map).length > 0) {
      const activePhotos = Object.values(map).filter(
        el => el && el.type === 'photo' && (el.date === this.currentDate)
      );
      if (activePhotos.length > 0) {
        activePhotos.sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
        const focusPhoto = activePhotos[0];
        this.centerOnElement(Number(focusPhoto.x) || 2412, Number(focusPhoto.y) || 2400, 224, 250, false);
      } else {
        this.centerOnElement(2500, 2500, 0, 0, true);
      }
    }

    // Automatically center view on the newly created element if it's pending
    if (window.pendingScrollToElementId) {
      const data = map[window.pendingScrollToElementId];
      if (data) {
        window.pendingScrollToElementId = null;
        // Wait slightly for DOM layouts to settle and container bounds to expand
        setTimeout(() => {
          this.centerOnElement(Number(data.x) || 2412, Number(data.y) || 2400, 192, 216);
        }, 100);
      }
    }

    // Evaluate empty date message and photo long-press tooltip by default
    this.checkEmptyDateMessage(map);
    this.checkFirstPhotoTip(map);

    if (this.currentCollageFilter && this.currentCollageFilter !== 'all') {
      const allDomItems = Array.from(document.querySelectorAll('[id^="item_"]'));
      allDomItems.forEach(domEl => {
        const id = domEl.id.replace('item_', '');
        const itemData = map[id];
        if (itemData) {
          this.applyCollageFlowFilterSingle(domEl, itemData);
        }
      });
    }
  },

  checkEmptyDateMessage(map) {
    const bannerId = 'canvas-empty-date-info-banner';
    const svgId = 'canvas-empty-date-arrow-svg';
    const existing = document.getElementById(bannerId);
    const existingSvg = document.getElementById(svgId);

    const collageFlowBar = document.getElementById('collage-flow-filter-bar');
    if (collageFlowBar && !collageFlowBar.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const hudMenu = document.getElementById('hud-collapsible-menu');
    if (hudMenu && !hudMenu.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    // Hide tooltip when Scrapbook modal, Mood Radar modal, or Squad Members sidebar are active
    const modalScrapbook = document.getElementById('modal-scrapbook');
    if (modalScrapbook && !modalScrapbook.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const modalMood = document.getElementById('modal-mood-calendar');
    if (modalMood && !modalMood.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const membersSidebar = document.getElementById('members-sidebar');
    if (membersSidebar && !membersSidebar.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const activeScreen = document.querySelector('.screen:not(.hidden)');
    if (activeScreen && activeScreen.id !== 'screen-canvas') {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const qrModal = document.getElementById('modal-inapp-qr-scanner');
    if (qrModal && !qrModal.classList.contains('hidden')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    if ((window.ScrapTour && typeof ScrapTour.isActive === 'function' && ScrapTour.isActive()) || window.isUpdateModalActive || document.getElementById('mitrava-update-modal')) {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const targetDate = this.currentDate || todayStr;

    const items = Object.values(map || this.elements || {}).filter(el => {
      if (!el) return false;
      const elDate = el.date || todayStr;
      return elDate === targetDate;
    });

    if (items.length === 0) {
      if (!existing) {
        const inputEl = document.getElementById('canvas-date-picker');
        const pickerPill = (inputEl && inputEl.parentElement) ? inputEl.parentElement : inputEl;

        // Create SVG Arrow overlay matching Tour Guide arrow style
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.id = svgId;
        svgEl.setAttribute('class', 'fixed inset-0 w-full h-full pointer-events-none z-[99989] overflow-visible');
        svgEl.innerHTML = `
          <defs>
            <marker id="canvas-date-arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#39ff14" id="canvas-date-arrow-head-path"/>
            </marker>
          </defs>
          <path id="canvas-date-arrow-line" d="M0,0 Q0,0 0,0" marker-end="url(#canvas-date-arrow-head)" stroke="#39ff14" stroke-width="2.5" stroke-dasharray="8 5" fill="none" style="filter: drop-shadow(0 0 5px rgba(57, 255, 20, 0.75)); animation: dashFlow 1s linear infinite;"/>
        `;
        document.body.appendChild(svgEl);

        const banner = document.createElement('div');
        banner.id = bannerId;
        banner.className = 'animate-fade-in';
        banner.style.position = 'fixed';
        banner.style.zIndex = '99990';
        banner.style.background = 'rgba(10, 4, 20, 0.97)';
        banner.style.border = '2px solid #39ff14';
        banner.style.borderRadius = '18px';
        banner.style.padding = '12px';
        banner.style.boxShadow = '0 0 20px rgba(57, 255, 20, 0.5), 0 16px 40px rgba(0, 0, 0, 0.95)';
        banner.style.backdropFilter = 'blur(20px)';
        banner.style.webkitBackdropFilter = 'blur(20px)';
        banner.style.color = '#ffffff';
        banner.style.fontFamily = "'Space Grotesk', system-ui, -apple-system, sans-serif";
        banner.style.maxWidth = '240px';
        banner.style.pointerEvents = 'auto';

        banner.innerHTML = `
          <div class="tour-arrow-label" style="margin-top: 2px; margin-bottom: 6px;">
            <span class="tour-arrow-label-dot"></span>
            <span>POINTING TO: DATE PICKER</span>
          </div>
          <div class="tour-step-description" style="font-size: 11px; line-height: 1.45; margin-bottom: 10px;">Select another date or upload photos!</div>
          <div class="tour-controls" style="justify-content: flex-end; padding-top: 8px;">
            <button id="${bannerId}-gotit" class="tour-btn tour-btn-next" style="padding: 4px 12px; font-size: 10px;">GOT IT 👍</button>
          </div>
        `;

        document.body.appendChild(banner);

        // Position banner and calculate SVG curve line pointing directly at date picker pill
        const updatePositionAndArrow = () => {
          if (pickerPill) {
            const rect = pickerPill.getBoundingClientRect();
            banner.style.top = `${rect.bottom + 24}px`;
            banner.style.left = `${Math.max(12, rect.left - 10)}px`;

            const cardRect = banner.getBoundingClientRect();
            const targetCenterX = rect.left + rect.width / 2;
            const targetCenterY = rect.bottom + 2;

            const startX = cardRect.left + cardRect.width / 3;
            const startY = cardRect.top;

            const controlX = (startX + targetCenterX) / 2 + (targetCenterX > startX ? 15 : -15);
            const controlY = (startY + targetCenterY) / 2;

            const arrowLine = document.getElementById('canvas-date-arrow-line');
            if (arrowLine) {
              arrowLine.setAttribute('d', `M ${startX},${startY} Q ${controlX},${controlY} ${targetCenterX},${targetCenterY}`);
            }
          } else {
            banner.style.top = '75px';
            banner.style.left = '16px';
          }
        };

        setTimeout(updatePositionAndArrow, 40);

        const dismiss = (e) => {
          if (e) e.stopPropagation();
          banner.remove();
          const curSvg = document.getElementById(svgId);
          if (curSvg) curSvg.remove();
          setTimeout(() => {
            if (typeof this.checkFirstPhotoTip === 'function') {
              this.checkFirstPhotoTip(this.elements);
            }
          }, 120);
        };

        const gotItBtn = document.getElementById(`${bannerId}-gotit`);
        const closeBtn = document.getElementById(`${bannerId}-close`);

        if (gotItBtn) gotItBtn.addEventListener('click', dismiss);
        if (closeBtn) closeBtn.addEventListener('click', dismiss);
      }
    } else {
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
    }
  },

  checkFirstPhotoTip(map) {
    const tipId = 'canvas-photo-longpress-tip';
    const existing = document.getElementById(tipId);

    const activeScreen = document.querySelector('.screen:not(.hidden)');
    if (activeScreen && activeScreen.id !== 'screen-canvas') {
      if (existing) existing.remove();
      return;
    }

    if ((window.ScrapTour && typeof ScrapTour.isActive === 'function' && ScrapTour.isActive()) || window.isUpdateModalActive || document.getElementById('mitrava-update-modal')) {
      if (existing) existing.remove();
      return;
    }

    if (localStorage.getItem('scrap_photo_longpress_tip_dismissed') === 'true') {
      if (existing) existing.remove();
      return;
    }

    const elementsMap = (map && Object.keys(map).length > 0) ? map : (this.elements || {});
    const photos = Object.entries(elementsMap).filter(
      ([id, el]) => el && (el.type === 'photo' || el.type === 'image')
    );

    if (photos.length === 0) {
      if (existing) existing.remove();
      return;
    }

    let firstUploadTime = parseInt(localStorage.getItem('scrap_first_photo_upload_time') || '0', 10);
    if (!firstUploadTime) {
      firstUploadTime = Date.now();
      localStorage.setItem('scrap_first_photo_upload_time', firstUploadTime.toString());
    }

    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    if (Date.now() - firstUploadTime > THREE_DAYS_MS) {
      if (existing) existing.remove();
      return;
    }

    const showTipForPhoto = (attempts = 0) => {
      let photoDom = null;
      for (const [id] of photos) {
        const dom = document.getElementById(`item_${id}`);
        if (dom && dom.offsetWidth > 0 && dom.offsetHeight > 0) {
          photoDom = dom;
          break;
        }
      }

      if (!photoDom) {
        if (attempts < 25) setTimeout(() => showTipForPhoto(attempts + 1), 120);
        return;
      }

      const rect = photoDom.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        if (attempts < 25) setTimeout(() => showTipForPhoto(attempts + 1), 120);
        return;
      }

      const photoCenterX = rect.left + (rect.width / 2);
      const isAbove = rect.top > 110;
      const tipTop = isAbove ? (rect.top - 96) : (rect.bottom + 12);

      const tooltipWidth = 230;
      let tipLeft = photoCenterX - (tooltipWidth / 2);
      tipLeft = Math.max(12, Math.min(tipLeft, window.innerWidth - tooltipWidth - 12));

      const arrowX = Math.max(16, Math.min(photoCenterX - tipLeft - 6, tooltipWidth - 24));
      const arrowStyle = isAbove
        ? `position: absolute; bottom: -8px; left: ${arrowX}px; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 8px solid #39ff14;`
        : `position: absolute; top: -8px; left: ${arrowX}px; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 8px solid #39ff14;`;

      const currentExisting = document.getElementById(tipId);
      if (currentExisting) {
        currentExisting.style.display = 'block';
        currentExisting.style.top = `${tipTop}px`;
        currentExisting.style.left = `${tipLeft}px`;
        const arrowEl = currentExisting.querySelector('.photo-tip-arrow');
        if (arrowEl) arrowEl.style.cssText = arrowStyle;
        return;
      }

      requestAnimationFrame(() => {
        if (document.getElementById(tipId)) return;

        const banner = document.createElement('div');
        banner.id = tipId;
        banner.style.position = 'fixed';
        banner.style.top = `${tipTop}px`;
        banner.style.left = `${tipLeft}px`;
        banner.style.width = `${tooltipWidth}px`;
        banner.style.background = 'rgba(10, 4, 20, 0.97)';
        banner.style.border = '1.5px solid rgba(57, 255, 20, 0.35)';
        banner.style.borderRadius = '20px';
        banner.style.padding = '14px 16px 12px';
        banner.style.boxShadow = '0 24px 60px rgba(0, 0, 0, 0.95), 0 0 24px rgba(57, 255, 20, 0.15)';
        banner.style.backdropFilter = 'blur(20px)';
        banner.style.webkitBackdropFilter = 'blur(20px)';
        banner.style.zIndex = '99995';
        banner.style.color = '#ffffff';
        banner.style.fontFamily = "'Space Grotesk', system-ui, -apple-system, sans-serif";

        banner.innerHTML = `
          <div class="photo-tip-arrow" style="${arrowStyle}"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 9px; font-weight: 800; color: #39ff14; text-transform: uppercase; letter-spacing: 0.14em; background: rgba(57, 255, 20, 0.1); padding: 3px 9px; border-radius: 99px; border: 1px solid rgba(57, 255, 20, 0.25);">
              💡 PHOTO TIP
            </span>
            <button id="${tipId}-close" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.5); font-size: 11px; font-weight: 800; cursor: pointer; padding: 2px 4px;">
              ✕
            </button>
          </div>
          <div style="font-size: 14px; font-weight: 800; color: #ffffff; margin-bottom: 4px;">Long-Press Photo</div>
          <div style="font-size: 11px; line-height: 1.5; color: rgba(255, 255, 255, 0.8); margin-bottom: 10px;">
            Tap & hold photo for borders, doodles, captions & reactions!
          </div>
          <div style="display: flex; justify-content: flex-end; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
            <button id="${tipId}-gotit" style="background: #39ff14; color: #000000; font-size: 10px; font-weight: 900; text-transform: uppercase; padding: 5px 14px; border-radius: 99px; border: none; cursor: pointer; box-shadow: 0 0 12px rgba(57, 255, 20, 0.35);">
              GOT IT 👍
            </button>
          </div>
        `;
        document.body.appendChild(banner);

        const dismissTip = () => {
          localStorage.setItem('scrap_photo_longpress_tip_dismissed', 'true');
          if (banner) banner.remove();
        };

        const closeBtn = document.getElementById(`${tipId}-close`);
        const gotItBtn = document.getElementById(`${tipId}-gotit`);
        if (closeBtn) closeBtn.addEventListener('click', dismissTip);
        if (gotItBtn) gotItBtn.addEventListener('click', dismissTip);

        photoDom.addEventListener('contextmenu', dismissTip, { once: true });
      });
    };

    // Display tip automatically BY DEFAULT over photo
    showTipForPhoto();
  },

  renderOrUpdateElementDom(id, data) {
    if (!data) return;

    // Check if flagged, reported, or if owner is blocked
    const localKey = `scrap_reported_${ScrapFirebase.roomId}`;
    let reportedList = [];
    try {
      reportedList = JSON.parse(localStorage.getItem(localKey) || '[]');
    } catch (e) { }

    const blockedUsers = window.ScrapFirebase && typeof ScrapFirebase.getBlockedUsers === 'function'
      ? ScrapFirebase.getBlockedUsers()
      : [];

    if (data.flagged || reportedList.includes(id) || blockedUsers.includes(data.ownerId)) {
      const existing = document.getElementById(`item_${id}`);
      if (existing) {
        existing.remove();
      }
      return;
    }

    // Inject CSS rule for control handles if missing
    if (!document.getElementById('control-handles-css')) {
      const style = document.createElement('style');
      style.id = 'control-handles-css';
      style.textContent = `
        .control-handle {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.2s ease-in-out;
        }
        .active-controls {
          outline: 2px dashed #b026ff !important;
          outline-offset: 4px !important;
          box-shadow: 0 0 15px rgba(176, 38, 255, 0.45) !important;
        }
        .active-controls .control-handle {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
      `;
      document.head.appendChild(style);
    }

    let domEl = document.getElementById(`item_${id}`);

    if (!domEl) {
      domEl = document.createElement('div');
      domEl.id = `item_${id}`;
      domEl.className = 'absolute select-none cursor-pointer group';

      // Control UI overlays — rotate, delete, report, reaction, and (for photos) border-style picker
      const isPhoto = data && data.type === 'photo';
      domEl.innerHTML = `
        <div class="element-content w-full h-full relative"></div>
        <div class="control-handle absolute -top-3 -right-3 w-6 h-6 bg-cyber-green text-black rounded-full flex items-center justify-center text-xs rotate-trigger">↻</div>
        <div class="control-handle absolute -top-3 -left-3 w-6 h-6 bg-alert-pink text-white rounded-full flex items-center justify-center text-xs delete-trigger">✕</div>
        <div class="control-handle absolute -top-3 w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-[10px] report-trigger" title="Report Content" style="left: 20px;">🚩</div>
        <div class="control-handle absolute -top-3 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-[10px] reaction-trigger" title="Send Reaction Bomb" style="left: 44px;">💥</div>
        ${isPhoto ? '<div class="control-handle absolute -bottom-3 w-6 h-6 bg-yellow-400 text-black rounded-full flex items-center justify-center text-xs border-style-trigger" title="Change border style" style="right: 48px;">🎨</div><div class="control-handle absolute -bottom-3 w-6 h-6 bg-cyan-400 text-black rounded-full flex items-center justify-center text-xs filter-style-trigger" title="Change photo filter" style="right: 20px;">🎬</div>' : ''}
      `;

      this.canvasEl.appendChild(domEl);
      this.attachElementEvents(domEl, id);
    }

    // Update Content based on type
    const contentContainer = domEl.querySelector('.element-content');

    if (data.type === 'photo') {
      if (!contentContainer.querySelector('img')) {
        const borderStyle = data.borderStyle || 'classic';
        const borderCSS = ScrapCanvas.getPolaroidBorderCSS(borderStyle);
        const filterClass = data.filterStyle ? `filter-${data.filterStyle}` : '';
        contentContainer.innerHTML = `
          <div class="polaroid-wrapper w-48 p-2.5 rounded-xl shadow-2xl relative" style="${borderCSS.wrapper}">
            <!-- Washi tape decorations -->
            <div class="washi-tape-decor absolute inset-0 pointer-events-none z-20 ${borderStyle === 'washi_tape' ? '' : 'hidden'}">
              <div class="absolute -top-3.5 -left-3 w-10 h-4 bg-yellow-400/40 border border-yellow-400/20 rotate-[-25deg] shadow-sm" style="background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px);"></div>
              <div class="absolute -top-3.5 -right-3 w-10 h-4 bg-pink-400/40 border border-pink-400/20 rotate-[25deg] shadow-sm" style="background-image: repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px);"></div>
            </div>
            <div class="relative w-full h-40 bg-black overflow-hidden flex items-center justify-center border border-gray-200" style="${borderCSS.photo || ''}">
              <span class="loading-label text-[10px] font-space text-purple-600 animate-pulse font-bold">Decrypting...</span>
              <img class="w-full h-full object-cover hidden select-none ${filterClass}" alt="Photo" draggable="false" />
            </div>
            <!-- Polaroid space footer (user-editable) -->
            <div class="h-6 flex items-center justify-center mt-2 px-1 font-space text-[8px] tracking-wider uppercase font-bold select-none polaroid-footer-click border-t border-dashed pt-1 cursor-edit" style="${borderCSS.footer || 'color:#000;border-color:#ccc'}">
              <span class="footer-text truncate text-center">${data.polaroidText || ''}</span>
            </div>
            <!-- Sticker container -->
            <div class="stickers-overlay absolute inset-0 pointer-events-none z-10"></div>
          </div>
        `;

        // Lazy load and decrypt in memory
        this.decryptAndDisplayImage(id, data.encryptedData || data.fileId, contentContainer);
      } else {
        // If already rendered, apply updated border style if changed
        const polaroidWrapper = contentContainer.querySelector('.polaroid-wrapper');
        if (polaroidWrapper) {
          const borderCSS = ScrapCanvas.getPolaroidBorderCSS(data.borderStyle || 'classic');
          polaroidWrapper.setAttribute('style', borderCSS.wrapper);
          const footerEl = contentContainer.querySelector('.polaroid-footer-click');
          if (footerEl) footerEl.setAttribute('style', borderCSS.footer || 'color:#000;border-color:#ccc');

          const washiDecor = contentContainer.querySelector('.washi-tape-decor');
          if (washiDecor) {
            if (data.borderStyle === 'washi_tape') {
              washiDecor.classList.remove('hidden');
            } else {
              washiDecor.classList.add('hidden');
            }
          }
        }
        // Also apply filter class update
        const img = contentContainer.querySelector('img');
        if (img) {
          img.className = 'w-full h-full object-cover select-none';
          if (data.filterStyle) {
            img.classList.add(`filter-${data.filterStyle}`);
          }
        }
      }

      // Update polaroid text dynamically if it changed
      const footerTextEl = contentContainer.querySelector('.footer-text');
      if (footerTextEl) {
        footerTextEl.innerText = data.polaroidText || '';
      }

      // Update stickers / export notifications
      const overlay = contentContainer.querySelector('.stickers-overlay');
      if (overlay) {
        overlay.innerHTML = '';

        // Render any relative attached stickers with correct size, style, and positioning
        if (data.stickers) {
          Object.entries(data.stickers).forEach(([stickerId, s]) => {
            const sEl = document.createElement('div');
            sEl.className = 'absolute select-none pointer-events-auto cursor-pointer group/sticker';
            // Position using relative center offset from photo card center (96, 108)
            sEl.style.left = `${96 + s.x}px`;
            sEl.style.top = `${108 + s.y}px`;
            sEl.style.transform = `translate(-50%, -50%) rotate(${s.rotation || 0}deg) scale(${s.scale || 1.0})`;

            // Tap sticker to unlock/detach back to independent canvas board element
            const handleDetachSticker = async (evt) => {
              evt.stopPropagation();
              if (evt.cancelable) evt.preventDefault();

              const collageFlowBar = document.getElementById('collage-flow-filter-bar');
              if (collageFlowBar && !collageFlowBar.classList.contains('hidden')) return;

              let itemTypeName = "element";
              if (s.type === 'doodle') itemTypeName = "drawing";
              else if (s.type === 'sticker') itemTypeName = "graphic sticker";
              else {
                let isEmoji = false;
                try {
                  const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
                  isEmoji = s.text ? emojiRegex.test(s.text) : false;
                } catch (e) {
                  isEmoji = s.text ? (s.text.length <= 4 && /[^\x00-\x7F]/.test(s.text)) : false;
                }
                itemTypeName = isEmoji ? "emoji" : "text sticker";
              }

              if (await window.ScrapDialog.confirm(`🔓 Unlock & detach this ${itemTypeName} from this photo?`)) {
                // Calculate absolute coordinates on canvas board for detached element
                const photoScale = data.scale || 1.0;
                const theta = data.rotation || 0;
                const rad = theta * Math.PI / 180;
                const rx = (s.x || 0) * photoScale;
                const ry = (s.y || 0) * photoScale;

                const dx = rx * Math.cos(rad) - ry * Math.sin(rad);
                const dy = rx * Math.sin(rad) + ry * Math.cos(rad);

                const PX = (data.x || 0) + 96;
                const PY = (data.y || 0) + 108;

                const newAbsCenterX = PX + dx;
                const newAbsCenterY = PY + dy;

                const detachedId = `${s.type || 'text'}_${Date.now()}`;
                const newElement = {
                  type: s.type || 'text',
                  x: Math.round(newAbsCenterX - 50),
                  y: Math.round(newAbsCenterY - 20),
                  rotation: (data.rotation || 0) + (s.rotation || 0),
                  scale: (photoScale) * (s.scale || 1.0),
                  zIndex: ScrapCanvas.getMaxZIndex(s.type || 'text') + 1,
                  date: data.date || ScrapCanvas.currentDate
                };

                if (s.type === 'doodle') {
                  newElement.type = 'doodle';
                  newElement.strokes = s.strokes || [];
                  newElement.color = s.color || '#00FF66';
                  newElement.width = s.width || 192;
                  newElement.height = s.height || 192;
                } else if (s.type === 'sticker') {
                  newElement.type = 'sticker';
                  newElement.src = s.src;
                  newElement.width = s.width || 80;
                  newElement.height = s.height || 80;
                } else {
                  newElement.text = s.text;
                }

                // 1. Remove sticker from photo local stickers map
                delete data.stickers[stickerId];
                if (Object.keys(data.stickers).length === 0) {
                  delete data.stickers;
                }

                // 2. Add detached element to local canvas elements map
                ScrapCanvas.elements[detachedId] = newElement;

                // 3. Render updated photo DOM & new detached element DOM instantly
                ScrapCanvas.renderOrUpdateElementDom(id, data);
                ScrapCanvas.renderOrUpdateElementDom(detachedId, newElement);

                // 4. Atomic save on Firebase
                const updates = {};
                updates[id] = data;
                updates[detachedId] = newElement;
                await ScrapFirebase.updateMultipleElements(ScrapFirebase.roomId, updates);
              }
            };

            sEl.addEventListener('click', handleDetachSticker);
            sEl.addEventListener('touchend', (e) => {
              handleDetachSticker(e);
            });

            // Prevent touch/click events from bubbling up to parent polaroid photo card
            const blockParentInteractions = (e) => {
              e.stopPropagation();
              if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            };
            sEl.addEventListener('pointerdown', blockParentInteractions);
            sEl.addEventListener('mousedown', blockParentInteractions);
            sEl.addEventListener('touchstart', blockParentInteractions);

            if (s.type === 'doodle') {
              sEl.style.width = `${s.width || 192}px`;
              sEl.style.height = `${s.height || 192}px`;
              sEl.innerHTML = `<canvas class="w-full h-full pointer-events-none"></canvas>`;
              const canvas = sEl.querySelector('canvas');
              this.drawDoodleOnElementCanvas(canvas, s);
            } else if (s.type === 'sticker') {
              sEl.style.width = `${s.width || 80}px`;
              sEl.style.height = `${s.height || 80}px`;
              sEl.innerHTML = `<img class="w-full h-full object-contain pointer-events-none select-none opacity-0 transition-opacity" alt="Sticker" draggable="false" />`;
              const img = sEl.querySelector('img');
              this.getTransparentSticker(s.src, (url) => {
                img.src = url;
                img.classList.remove('opacity-0');
              });
            } else {
              // Detect if emoji or styled text
              let isEmoji = false;
              try {
                const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
                isEmoji = emojiRegex.test(s.text);
              } catch (e) {
                isEmoji = s.text.length <= 4 && /[^\x00-\x7F]/.test(s.text);
              }

              if (isEmoji) {
                sEl.innerHTML = `
                  <div class="select-none leading-none text-center pointer-events-none" style="font-size: 44px;">
                    ${s.text}
                  </div>
                `;
              } else {
                sEl.innerHTML = `
                  <div class="px-3 py-2 bg-purple-900 border border-cyber-green text-cyber-green font-mono text-2xl rounded shadow-lg whitespace-nowrap pointer-events-none">
                    ${s.text}
                  </div>
                `;
              }
            }
            overlay.appendChild(sEl);
          });
        }

        if (data.exportedBy) {
          overlay.innerHTML += `
            <div class="absolute top-2 left-2 right-2 bg-[#ff00ab] text-white text-[8px] py-0.5 px-1 font-bold rounded animate-bounce text-center uppercase tracking-wider border border-white">
              ✨ ${data.exportedBy} exported!
            </div>
          `;
        }
        if (data.caption) {
          overlay.innerHTML += `
            <div class="absolute bottom-2 left-2 right-2 bg-black/85 text-[#39ff14] text-[9px] p-1 font-space rounded border border-[#39ff14]/30 truncate">
              ${data.caption}
            </div>
          `;
        }
      }
    } else if (data.type === 'recovery_request') {
      contentContainer.innerHTML = '';
    } else if (data.type === 'recovery_response') {
      contentContainer.innerHTML = '';
    } else if (data.type === 'text') {
      let isEmoji = false;
      try {
        const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
        isEmoji = emojiRegex.test(data.text);
      } catch (e) {
        isEmoji = data.text.length <= 4 && /[^\x00-\x7F]/.test(data.text);
      }
      if (isEmoji) {
        contentContainer.innerHTML = `
          <div class="select-none leading-none text-center pointer-events-none" style="font-size: 44px;">
            ${data.text}
          </div>
        `;
      } else {
        // Y2K Gradient Word-Art sticker with glowing background borders
        contentContainer.innerHTML = `
          <div class="px-4 py-2.5 bg-black/90 border-2 border-purple-500 text-white rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.5)] whitespace-nowrap pointer-events-none font-sans font-black tracking-wider text-xl" style="background-image: linear-gradient(135deg, #2a085c 0%, #0d0221 100%);">
            <span style="background: linear-gradient(45deg, #ff00ab 0%, #00f0ff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 4px rgba(255,0,171,0.4));">${data.text}</span>
          </div>
        `;
      }
    } else if (data.type === 'sticker') {
      let img = contentContainer.querySelector('img');
      if (!img) {
        contentContainer.innerHTML = `<img class="w-full h-full object-contain pointer-events-none select-none opacity-0 transition-opacity" alt="Sticker" draggable="false"  />`;
        img = contentContainer.querySelector('img');
      }

      // Only process transparency if the source has changed or is not yet set
      const currentSrc = img.getAttribute('data-original-src');
      if (!img.src || currentSrc !== data.src) {
        img.setAttribute('data-original-src', data.src);
        this.getTransparentSticker(data.src, (url) => {
          img.src = url;
          img.classList.remove('opacity-0');
        });
      } else {
        img.classList.remove('opacity-0');
      }
    } else if (data.type === 'doodle') {

      let canvas = contentContainer.querySelector('canvas');
      if (!canvas) {
        contentContainer.innerHTML = `<canvas class="w-full h-full pointer-events-none"></canvas>`;
        canvas = contentContainer.querySelector('canvas');
      }
      this.drawDoodleOnElementCanvas(canvas, data);
      if (data.wobble) {
        canvas.classList.add('wobble-active');
      } else {
        canvas.classList.remove('wobble-active');
      }

      if (data.sparkles) {
        this.startDoodleSparkleLoop(domEl, id);
      } else {
        this.stopDoodleSparkleLoop(id);
      }
    } else if (data.type === 'container') {
      let card = contentContainer.querySelector('.container-card');
      if (!card) {
        contentContainer.innerHTML = `
          <div class="container-card w-full h-full rounded-2xl border border-[#b026ff]/35 bg-gradient-to-br from-[#19112a] to-[#0b0713] flex flex-col relative select-none animate-fade-in pointer-events-none" style="padding-top: 36px;">
            <!-- Interactive Drag/Zoom Border Edges -->
            <div class="absolute top-0 left-0 right-0 h-9 pointer-events-auto cursor-move" style="z-index: 10;"></div>
            <div class="absolute bottom-0 left-0 right-0 h-4 pointer-events-auto cursor-ns-resize" style="z-index: 10;"></div>
            <div class="absolute top-0 bottom-0 left-0 w-4 pointer-events-auto cursor-ew-resize" style="z-index: 10;"></div>
            <div class="absolute top-0 bottom-0 right-0 w-4 pointer-events-auto cursor-ew-resize" style="z-index: 10;"></div>
            
            <!-- Header Title Bar (Drag handle) -->
            <div class="absolute top-0 left-0 right-0 h-9 bg-black/35 rounded-t-2xl border-b border-white/5 flex items-center justify-between px-3.5 pointer-events-auto" style="z-index: 11;">
              <!-- Left: Window controls indicator dots -->
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-[#ff0055] shadow-[0_0_6px_#ff0055]"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_6px_#00f0ff]"></span>
              </div>
              
              <!-- Center: Monospace Title -->
              <span class="container-title font-mono text-[10px] font-extrabold tracking-widest text-white/90 truncate max-w-[60%] text-center uppercase">${data.title || ''}</span>
              
              <!-- Right placeholder for alignment -->
              <div></div>
            </div>
            
            <!-- Clean interior frame container space -->
            <div class="flex-1"></div>
          </div>
        `;
      } else {
        const titleEl = card.querySelector('.container-title');
        if (titleEl) titleEl.textContent = data.title || '';
      }
    } else if (data.type === 'voice' || data.type === 'music') {
      // Inject CSS rule for rotating cassette spindles if missing
      if (!document.getElementById('spindle-spin-css')) {
        const style = document.createElement('style');
        style.id = 'spindle-spin-css';
        style.textContent = `
          @keyframes spindle-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .voice-cassette.playing .spindle-wheel {
            animation: spindle-spin 1.8s linear infinite !important;
          }
        `;
        document.head.appendChild(style);
      }

      // Render voice/music note as a cassette tape sticker with date & time label
      const parsedTime = parseInt(id.replace('voice_', '').replace('music_', ''));
      const timestamp = data.createdAt || (isNaN(parsedTime) ? Date.now() : parsedTime);
      const dateObj = new Date(timestamp);
      const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const formattedTime = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

      const isSong = data.type === 'music';
      const timeLabel = isSong ? `🎵 Song - ${formattedDate}` : `🗣 Voice - ${formattedDate} ${formattedTime}`;

      const existingTape = contentContainer.querySelector('.voice-cassette');
      const hasNewSpindles = contentContainer.querySelector('.spindle-wheel');

      const borderCol = isSong ? 'rgba(224,160,255,0.5)' : 'rgba(255,74,74,0.5)';
      const spindleCol = isSong ? 'border-purple-400' : 'border-red-400';
      const styleSpindleLines = isSong ? 'bg-purple-400' : 'bg-red-400';
      const textCol = isSong ? 'text-purple-300' : 'text-red-400';
      const backgroundGrad = isSong ? 'linear-gradient(135deg,#0d051c 0%,#200e3b 100%)' : 'linear-gradient(135deg,#1a0a2e 0%,#2d1b69 100%)';
      const labelBg = isSong ? 'rgba(224, 160, 255, 0.95)' : 'rgba(255, 255, 255, 0.95)';

      if (!existingTape || !hasNewSpindles) {
        contentContainer.innerHTML = `
          <div class="voice-cassette-container flex flex-col items-center gap-1 w-full h-full relative">
            <!-- Retro Label Strip -->
            <div class="voice-label-strip rounded py-0.5 truncate px-1 uppercase tracking-wider font-bold font-mono text-center shadow-md"
                 style="background-color: ${labelBg} !important; color: #120920 !important; font-size: 7px !important; line-height: 9px !important; width: 170px;">
              ${timeLabel}
            </div>
            <!-- Cassette Body -->
            <div class="voice-cassette relative rounded-lg shadow-2xl flex flex-col items-center justify-center cursor-pointer select-none animate-fade-in"
                 style="background: ${backgroundGrad}; border: 1.5px solid ${borderCol}; --play-duration: ${data.duration || 15000}ms; padding-top: ${data.title ? '28px' : '0px'}; width: 200px; height: 115px;">
              ${data.title ? `
              <!-- Custom written title tape -->
              <div class="voice-title-label absolute top-2 left-2 right-2 text-center text-[9px] font-mono tracking-wide text-white/90 bg-black/35 px-1.5 py-0.5 rounded truncate uppercase font-bold border border-white/5 shadow-sm" style="max-width: 180px;">
                ${data.title}
              </div>
              ` : ''}
              <!-- Spindles -->
              <div class="flex items-center gap-2 justify-center w-full px-2">
                <!-- Left Spindle with Reel -->
                <div class="relative w-11 h-11 flex items-center justify-center">
                  <!-- Left Tape Reel -->
                  <div class="tape-reel-left absolute rounded-full bg-[#ff9800] border border-[#ffb74d]/40 shadow-inner" style="width: 42px; height: 42px;"></div>
                  <!-- Spindle Wheel -->
                  <div class="spindle-wheel w-7 h-7 bg-black rounded-full border border-gray-500 flex items-center justify-center relative z-10">
                    <div class="absolute w-[3px] h-[18px] ${styleSpindleLines} rounded-full"></div>
                    <div class="absolute w-[18px] h-[3px] ${styleSpindleLines} rounded-full"></div>
                    <div class="absolute w-1.5 h-1.5 rounded-full bg-black border border-gray-500"></div>
                  </div>
                </div>

                <!-- Center Tape Window showing moving magnetic tape and Play/Pause symbol -->
                <div class="w-16 h-9 bg-black/50 border border-white/15 rounded flex items-center justify-center overflow-hidden relative">
                  <!-- Moving tape line -->
                  <div class="magnetic-tape-line absolute h-0.5 bg-[#ff9800] opacity-90 w-[200%] left-0" style="top: 50%; transform: translateY(-50%);"></div>
                  <!-- Play/Pause Symbol -->
                  <span class="voice-play-label relative z-10 ${textCol} font-bold text-xs">▶</span>
                </div>

                <!-- Right Spindle with Reel -->
                <div class="relative w-11 h-11 flex items-center justify-center">
                  <!-- Right Tape Reel -->
                  <div class="tape-reel-right absolute rounded-full bg-[#ff9800] border border-[#ffb74d]/40 shadow-inner" style="width: 22px; height: 22px;"></div>
                  <!-- Spindle Wheel -->
                  <div class="spindle-wheel w-7 h-7 bg-black rounded-full border-2 ${spindleCol} flex items-center justify-center relative z-10">
                    <div class="absolute w-[3px] h-[18px] ${styleSpindleLines} rounded-full"></div>
                    <div class="absolute w-[18px] h-[3px] ${styleSpindleLines} rounded-full"></div>
                    <div class="absolute w-1.5 h-1.5 rounded-full bg-black border border-gray-500"></div>
                  </div>
                </div>
              </div>
            </div>
            ${isSong ? `
            <!-- Floating jumping music notes overlay -->
            <div class="music-notes-particles absolute -top-8 left-0 right-0 flex justify-around pointer-events-none opacity-0 select-none transition-opacity duration-300">
              <span class="note-1 text-sm text-[#39ff14] filter drop-shadow-[0_0_3px_#39ff14]">🎵</span>
              <span class="note-2 text-sm text-[#ff00ab] filter drop-shadow-[0_0_3px_#ff00ab]">🎶</span>
              <span class="note-3 text-sm text-[#00f0ff] filter drop-shadow-[0_0_3px_#00f0ff]">🎵</span>
            </div>
            ` : ''}
          </div>
        `;

        // Tap to play voice note
        const cassette = contentContainer.querySelector('.voice-cassette');
        if (cassette) {
          cassette.addEventListener('click', async (e) => {
            e.stopPropagation();
            const playLabel = cassette.querySelector('.voice-play-label');

            // Toggle pause if clicked again
            if (ScrapCanvas.activePlayingId === id && ScrapCanvas.currentlyPlayingAudio) {
              ScrapCanvas.currentlyPlayingAudio.pause();
              return;
            }

            // Stop other voice notes from overlapping
            if (ScrapCanvas.currentlyPlayingAudio) {
              ScrapCanvas.currentlyPlayingAudio.pause();
            }

            try {
              // Use roomId with fallback chain to ensure key is always resolved
              const roomId = ScrapFirebase.roomId
                || localStorage.getItem('scrap_current_room_id')
                || null;
              if (!roomId) throw new Error('Room ID not found.');

              if (!data.audioFileId && !data.encryptedAudio) {
                // Duration-only voice note. Just animate the visual indicator for the recorded duration.
                const dur = data.duration || 3000;
                cassette.classList.add('playing');
                if (playLabel) playLabel.textContent = '⏸';
                setTimeout(() => {
                  cassette.classList.remove('playing');
                  if (playLabel) playLabel.textContent = '▶';
                }, dur);
                return;
              }

              let encBuf;
              if (data.audioFileId) {
                // Download audio from Google Drive
                const raw = await ScrapDrive.downloadFile(data.audioFileId);
                // Normalize to plain ArrayBuffer (handles ArrayBufferView, ArrayBuffer, etc.)
                encBuf = raw instanceof ArrayBuffer ? raw : raw.buffer ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw;
              } else if (data.encryptedAudio) {
                // Backward compatibility fallback for legacy base64 audio
                encBuf = ScrapCrypto.base64ToArrayBuffer(data.encryptedAudio);
              } else {
                throw new Error('No audio payload found on this voice note.');
              }

              let decBuf;
              if (data.encrypted === false) {
                decBuf = encBuf;
              } else {
                const roomKey = await ScrapRecovery.getRoomKey(roomId);
                if (!roomKey) throw new Error('Room key not found. Re-open the room to restore access.');
                decBuf = await ScrapCrypto.decryptData(encBuf, roomKey);
              }

              // Use audio/mp4 which covers both .m4a and .aac MPEG_4 containers recorded on Android
              const mimeType = data.mimeType || 'audio/mp4';
              const blob = new Blob([decBuf], { type: mimeType });
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);

              const cleanup = () => {
                cassette.classList.remove('playing');
                if (playLabel) playLabel.textContent = '▶';
                try { URL.revokeObjectURL(url); } catch (ex) { }
                if (ScrapCanvas.currentlyPlayingAudio === audio) {
                  ScrapCanvas.currentlyPlayingAudio = null;
                  ScrapCanvas.activePlayingId = null;
                }
              };

              audio.onended = cleanup;
              audio.onpause = cleanup;
              audio.onerror = () => {
                cleanup();
                window.ScrapDialog.alert('Could not play voice note. Unsupported audio format on this device.');
              };

              ScrapCanvas.currentlyPlayingAudio = audio;
              ScrapCanvas.activePlayingId = id;
              cassette.classList.add('playing');
              if (playLabel) playLabel.textContent = '⏸';

              // play() returns a Promise on modern browsers — catch it to avoid unhandled rejections
              const playPromise = audio.play();
              if (playPromise) {
                playPromise.catch(err => {
                  cleanup();
                  console.warn('[Audio] play() rejected:', err);
                });
              }
            } catch (err) {
              if (playLabel) playLabel.textContent = '▶';
              await window.ScrapDialog.alert('Could not play voice note: ' + err.message);
            }
          });
        }
      } else {
        // Inject label strip into existing tape wrapper if missing, and keep it updated
        let labelStrip = contentContainer.querySelector('.voice-label-strip');
        if (!labelStrip) {
          labelStrip = document.createElement('div');
          labelStrip.className = 'voice-label-strip w-[210px] rounded py-0.5 truncate px-1 uppercase tracking-wider font-bold font-mono text-center shadow-md';
          labelStrip.setAttribute('style', 'background-color: rgba(255, 255, 255, 0.95) !important; color: #120920 !important; font-size: 8px !important; line-height: 10px !important;');
          const containerDiv = contentContainer.querySelector('.voice-cassette-container');
          if (containerDiv) {
            containerDiv.insertBefore(labelStrip, existingTape);
          } else {
            existingTape.parentNode.insertBefore(labelStrip, existingTape);
          }
        }
        labelStrip.textContent = timeLabel;

        // Update custom title label on the cassette body if present
        let titleEl = contentContainer.querySelector('.voice-title-label');
        if (data.title) {
          const cleanTitle = data.title.substring(0, 12);
          if (!titleEl) {
            titleEl = document.createElement('div');
            titleEl.className = 'voice-title-label absolute top-3 left-3 right-3 text-center text-[12px] font-mono tracking-wide text-white/90 bg-black/35 px-2 py-0.5 rounded truncate max-w-[210px] uppercase font-bold border border-white/5 shadow-sm';
            const bodyDiv = contentContainer.querySelector('.voice-cassette');
            if (bodyDiv) {
              bodyDiv.insertBefore(titleEl, bodyDiv.firstChild);
              bodyDiv.style.paddingTop = '36px';
            }
          }
          titleEl.textContent = cleanTitle;
        } else if (titleEl) {
          titleEl.remove();
          const bodyDiv = contentContainer.querySelector('.voice-cassette');
          if (bodyDiv) bodyDiv.style.paddingTop = '0px';
        }
      }
    } else if (data.type === 'video') {
      const parsedTime = parseInt(id.replace('video_', ''));
      const timestamp = data.createdAt || (isNaN(parsedTime) ? Date.now() : parsedTime);
      const dateObj = new Date(timestamp);
      const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const formattedTime = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
      const timeLabel = `${formattedDate} ${formattedTime}`;

      const existingVideo = contentContainer.querySelector('.video-card');
      if (!existingVideo) {
        contentContainer.innerHTML = `
          <div class="video-sticker-container flex flex-col items-center gap-2.5 w-full h-full">
            <!-- Camcorder Tape Label -->
            <div class="video-label-strip rounded-full py-1 truncate px-2.5 uppercase tracking-widest font-extrabold font-mono text-center shadow-[0_0_12px_rgba(0,240,255,0.3)] border border-[#00f0ff]/40"
                 style="background: rgba(18, 9, 32, 0.85) !important; color: #00f0ff !important; font-size: 9px !important; line-height: 12px !important; backdrop-filter: blur(4px); width: 140px;">
              ${timeLabel}
            </div>
            <!-- Video Frame / Viewfinder -->
            <div class="video-card relative bg-[#090312] border border-white/10 rounded-2xl shadow-[0_15px_35px_rgba(0,0,0,0.6),0_0_15px_rgba(255,0,171,0.25)] flex items-center justify-center overflow-hidden cursor-pointer select-none transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_20px_40px_rgba(0,0,0,0.8),0_0_25px_rgba(255,0,171,0.4)]" style="outline: 1px solid rgba(255, 0, 171, 0.3); outline-offset: -3px; width: 170px; height: 125px;">
              <!-- CRT Scanline overlay -->
              <div class="absolute inset-0 pointer-events-none opacity-40 mix-blend-overlay" style="background: repeating-linear-gradient(0deg, rgba(0,0,0,0.15), rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px);"></div>
              
              <!-- Inline Video Player -->
              <video class="w-full h-full object-cover hidden pointer-events-none" playsinline loop></video>
              
              <!-- Video Poster / Play Button Overlay -->
              <div class="video-poster-overlay absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#120921]/60 to-purple-950/45 transition-colors duration-300">
                <!-- Custom Camcorder Viewfinder Overlays -->
                <!-- Top Left: REC indicator -->
                <div class="absolute top-2 left-2.5 flex items-center gap-1.5 pointer-events-none select-none">
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-red-600 absolute"></span>
                  <span class="text-[7px] font-mono font-black text-red-500 tracking-wider">REC</span>
                </div>
                <!-- Top Right: Battery/STBY -->
                <div class="absolute top-2 right-2.5 flex items-center gap-1 pointer-events-none select-none">
                  <span class="text-[7px] font-mono text-[#00f0ff] font-bold">STBY</span>
                  <span class="text-[7px] font-mono text-white/50">SP 1080P</span>
                </div>
                <!-- Four Viewfinder Corner brackets -->
                <div class="absolute top-2 left-2 w-1.5 h-1.5 border-t border-l border-white/40 pointer-events-none"></div>
                <div class="absolute top-2 right-2 w-1.5 h-1.5 border-t border-r border-white/40 pointer-events-none"></div>
                <div class="absolute bottom-2 left-2 w-1.5 h-1.5 border-b border-l border-white/40 pointer-events-none"></div>
                <div class="absolute bottom-2 right-2 w-1.5 h-1.5 border-b border-r border-white/40 pointer-events-none"></div>
                
                <!-- Glowing Neo-Retro Play Button -->
                <div class="w-11 h-11 rounded-full bg-black/40 border border-white/10 backdrop-filter blur-[1px] flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-transform duration-300 hover:scale-110 active:scale-95">
                  <svg class="w-4 h-4 text-white fill-current filter drop-shadow-[0_0_4px_rgba(255,255,255,0.6)]" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
                
                <span class="text-[8px] font-mono text-white/70 uppercase tracking-widest mt-2.5 font-bold drop-shadow-sm select-none hidden"></span>
              </div>
            </div>
          </div>
        `;

      } else {
        let labelStrip = contentContainer.querySelector('.video-label-strip');
        if (!labelStrip) {
          labelStrip = document.createElement('div');
          labelStrip.className = 'video-label-strip w-[130px] rounded-full py-1 truncate px-2.5 uppercase tracking-widest font-extrabold font-mono text-center shadow-[0_0_12px_rgba(0,240,255,0.3)] border border-[#00f0ff]/40';
          labelStrip.setAttribute('style', 'background: rgba(18, 9, 32, 0.85) !important; color: #00f0ff !important; font-size: 9px !important; line-height: 12px !important; backdrop-filter: blur(4px);');
          const containerDiv = contentContainer.querySelector('.video-sticker-container');
          if (containerDiv) {
            containerDiv.insertBefore(labelStrip, existingVideo);
          } else {
            existingVideo.parentNode.insertBefore(labelStrip, existingVideo);
          }
        }
        labelStrip.textContent = timeLabel;
      }

      const card = contentContainer.querySelector('.video-card');
      const video = contentContainer.querySelector('video');
      const overlay = contentContainer.querySelector('.video-poster-overlay');
      const statusText = overlay ? overlay.querySelector('span:last-child') : null;

      if (card && video && !card.dataset.listenerAttached) {
        card.dataset.listenerAttached = 'true';

        // Unified handler for 3D Viewfinder Card Tilt (works for both Mouse and Touch inputs)
        const handleMove = (clientX, clientY) => {
          const rect = card.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;
          const xc = rect.width / 2;
          const yc = rect.height / 2;
          const dx = x - xc;
          const dy = y - yc;
          // Rotate up to 12 degrees max
          const rotX = -(dy / yc) * 12;
          const rotY = (dx / xc) * 12;

          card.style.transition = 'none';
          card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.04, 1.04, 1.04)`;
        };

        const handleReset = () => {
          card.style.transition = 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), shadow 0.4s ease';
          card.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        };

        // Desktop Mouse Listeners
        card.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
        card.addEventListener('mouseleave', handleReset);

        // Native Android Touch Listeners
        card.addEventListener('touchstart', (e) => {
          if (e.touches && e.touches.length >= 2) return; // Allow pinch-zoom bubbling!
          if (e.touches && e.touches[0]) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
            // Do NOT stopPropagation — allows parent item touchstart to fire & set activeElement for dragging
          }
        }, { passive: false });

        card.addEventListener('touchmove', (e) => {
          if (e.touches && e.touches.length >= 2) return; // Allow pinch-zoom bubbling!
          // If parent item is being dragged, skip 3D tilt & let event bubble to window drag handler
          if (this.activeElement) return;
          if (e.touches && e.touches[0]) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
          }
        }, { passive: false });

        card.addEventListener('touchend', (e) => {
          handleReset();
          // Do NOT stopPropagation — allows window touchend handler to save final drag position
        });

        card.addEventListener('touchcancel', (e) => {
          handleReset();
          // Do NOT stopPropagation
        });

        card.addEventListener('click', async (e) => {
          e.stopPropagation();

          if (video.paused === false && !video.ended) {
            video.pause();
            if (overlay) overlay.classList.remove('hidden');
            if (statusText) statusText.textContent = '▶ Tap to Play';
            return;
          }

          if (video.src) {
            try {
              if (overlay) overlay.classList.add('hidden');
              video.classList.remove('hidden');
              await video.play();
            } catch (playErr) {
              console.error('[Video] Play failed:', playErr);
            }
            return;
          }

          if (statusText) statusText.textContent = '⏳ Loading...';

          try {
            const roomId = ScrapFirebase.roomId
              || localStorage.getItem('scrap_current_room_id')
              || null;
            if (!roomId) throw new Error('Room ID not found.');

            if (!data.videoFileId) throw new Error('Video file payload not found.');

            const raw = await ScrapDrive.downloadFile(data.videoFileId);
            const encBuf = raw instanceof ArrayBuffer ? raw : raw.buffer ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw;

            // Decryption bypassed per user request for testing
            const decBuf = encBuf;

            const blob = new Blob([decBuf], { type: data.mimeType || 'video/mp4' });
            const localUrl = URL.createObjectURL(blob);
            video.src = localUrl;
            video.classList.remove('hidden');
            if (overlay) overlay.classList.add('hidden');

            await video.play();
          } catch (err) {
            console.error('[Video] Download/Play error:', err);
            if (statusText) statusText.textContent = '▶ Tap to Play';
            window.ScrapDialog.alert('Could not play video: ' + err.message);
          }
        });
      }
    }

    this.updateElementStyle(id, data);
    this.applyCollageFlowFilterSingle(domEl, data);
  },

  // Polaroid border CSS definitions
  getPolaroidBorderCSS(style) {
    const styles = {
      classic: {
        wrapper: 'background:#fff;',
        footer: 'color:#000;border-color:#ccc;'
      },
      washi_tape: {
        wrapper: 'background: #fffdf9; border: 1px solid #e7e3d4; box-shadow: 0 4px 10px rgba(0,0,0,0.1);',
        footer: 'color:#5d5746;border-color:#e7e3d4;'
      },
      cow_print: {
        wrapper: 'background: #fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\'%3E%3Cellipse cx=\'15\' cy=\'12\' rx=\'10\' ry=\'8\' fill=\'%23222\'/%3E%3Cellipse cx=\'42\' cy=\'35\' rx=\'12\' ry=\'9\' fill=\'%23222\'/%3E%3Cellipse cx=\'30\' cy=\'55\' rx=\'8\' ry=\'6\' fill=\'%23222\'/%3E%3C/svg%3E") repeat; border: 3px solid #222;',
        footer: 'color:#222;border-color:#444;'
      },
      checkerboard: {
        wrapper: 'background: repeating-conic-gradient(#ff00ab 0% 25%, #fff 0% 50%) 0 0/16px 16px; border: 3px solid #ff00ab;',
        footer: 'color:#ff00ab;border-color:#ff00ab;'
      },
      holographic: {
        wrapper: 'background: linear-gradient(135deg,#ff0080,#ff8c00,#40e0d0,#7b2ff7,#ff0080); background-size:300% 300%; border: 3px solid #fff; animation: holo-shift 3s ease infinite;',
        footer: 'color:#fff;border-color:#fff; text-shadow: 0 0 6px #ff00ab;'
      },
      neon_pink: {
        wrapper: 'background:#120920; border: 3px solid #ff00ab; box-shadow: 0 0 12px #ff00ab, inset 0 0 8px rgba(255,0,171,0.15);',
        footer: 'color:#ff00ab;border-color:#ff00ab;text-shadow: 0 0 4px #ff00ab;'
      },
      neon_green: {
        wrapper: 'background:#071a0e; border: 3px solid #39ff14; box-shadow: 0 0 12px #39ff14, inset 0 0 8px rgba(57,255,20,0.12);',
        footer: 'color:#39ff14;border-color:#39ff14;text-shadow: 0 0 4px #39ff14;'
      },
      retro_pink: {
        wrapper: 'background: linear-gradient(145deg,#ffb3d9,#ff69b4); border: 4px solid #ff1493;',
        footer: 'color:#8b0057;border-color:#ff1493;'
      },
      dark_chrome: {
        wrapper: 'background: linear-gradient(135deg,#1c1c2e,#2d2d44); border: 3px solid #888; box-shadow: 0 0 8px #555;',
        footer: 'color:#ccc;border-color:#555;'
      },
      // --- Holographic Animated Variants ---
      aurora: {
        wrapper: 'background: linear-gradient(135deg,#00ff87,#00c9ff,#7b2ff7,#00ff87); background-size:400% 400%; border: 3px solid #00ff87; animation: aurora-shift 4s ease infinite;',
        footer: 'color:#00ff87;border-color:#00ff87;text-shadow:0 0 6px #00ff87;'
      },
      galaxy: {
        wrapper: 'background: linear-gradient(135deg,#0f0c29,#302b63,#24243e,#7b2ff7,#ff00cc,#0f0c29); background-size:400% 400%; border: 3px solid #7b2ff7; box-shadow:0 0 16px rgba(123,47,247,0.6); animation: galaxy-shift 5s ease infinite;',
        footer: 'color:#cc99ff;border-color:#7b2ff7;text-shadow:0 0 6px #7b2ff7;'
      },
      ocean: {
        wrapper: 'background: linear-gradient(135deg,#00b4db,#0083b0,#00f2fe,#4facfe,#00b4db); background-size:400% 400%; border: 3px solid #00f2fe; box-shadow:0 0 14px rgba(0,242,254,0.5); animation: ocean-shift 3.5s ease infinite;',
        footer: 'color:#00f2fe;border-color:#00f2fe;text-shadow:0 0 6px #00b4db;'
      },
      sunset: {
        wrapper: 'background: linear-gradient(135deg,#f7971e,#ffd200,#ff512f,#dd2476,#f7971e); background-size:400% 400%; border: 3px solid #ffd200; box-shadow:0 0 14px rgba(255,210,0,0.5); animation: sunset-shift 3s ease infinite;',
        footer: 'color:#ffd200;border-color:#ff512f;text-shadow:0 0 6px #f7971e;'
      },
      vaporwave: {
        wrapper: 'background: linear-gradient(135deg,#ff6ec7,#a855f7,#06b6d4,#ff6ec7); background-size:400% 400%; border: 3px solid #ff6ec7; box-shadow:0 0 18px rgba(255,110,199,0.6); animation: vapor-shift 4s ease infinite;',
        footer: 'color:#ff6ec7;border-color:#a855f7;text-shadow:0 0 6px #ff6ec7;'
      },
      midnight_prism: {
        wrapper: 'background: linear-gradient(135deg,#1a0533,#0d1f3c,#1a0533,#3b0066,#001f3c); background-size:400% 400%; border: 3px solid rgba(180,100,255,0.8); box-shadow:0 0 20px rgba(100,0,200,0.5),inset 0 0 10px rgba(180,100,255,0.1); animation: prism-shift 6s ease infinite;',
        footer: 'color:#cc88ff;border-color:rgba(180,100,255,0.7);text-shadow:0 0 6px #9933ff;'
      }
    };
    return styles[style] || styles.classic;
  },

  decryptQueue: null,

  async decryptAndDisplayImage(id, encryptedDataOrFileId, container) {
    if (!this.decryptQueue) {
      this.decryptQueue = Promise.resolve();
    }

    // Queue decryptions sequentially to prevent concurrent Web Crypto thread race conditions
    this.decryptQueue = this.decryptQueue.then(async () => {
      const getRoomId = () =>
        (window.ScrapApp && window.ScrapApp.currentRoomId) ||
        ScrapFirebase.roomId ||
        null;

      const isFileId = encryptedDataOrFileId && encryptedDataOrFileId.length < 200;


      try {
        if (!encryptedDataOrFileId) {
          throw new Error('No encrypted data or file ID provided.');
        }

        let encryptedBuffer;
        if (isFileId) {
          // If it's a fileId, download it from drive (legacy support)

          encryptedBuffer = await ScrapDrive.downloadFile(encryptedDataOrFileId);
        } else {
          // Otherwise, it's a Base64 encryptedData string, decode it directly

          encryptedBuffer = ScrapCrypto.base64ToArrayBuffer(encryptedDataOrFileId);
        }

        // Attempt 1: get room key immediately
        let roomId = getRoomId();
        let roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;

        // Retry once after 600ms — handles the race where saveRoomKey() is still
        // mid-flight when the first Firebase poll fires and triggers rendering.
        if (!roomKey) {

          await new Promise(resolve => setTimeout(resolve, 600));
          roomId = getRoomId();
          roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
        }

        if (!roomKey) {
          throw new Error(`No Room Key for Room: ${roomId}. Key may not have been received via QR yet.`);
        }


        const decrypted = await ScrapCrypto.decryptData(encryptedBuffer, roomKey);

        const base64 = ScrapCrypto.arrayBufferToBase64(decrypted);
        const url = `data:image/jpeg;base64,${base64}`;

        const img = container.querySelector('img');
        const loader = container.querySelector('.loading-label');
        if (img && loader) {
          img.src = url;
          img.classList.remove('hidden');
          loader.classList.add('hidden');

          // The reel can open before decryption finishes. Keep its active slide in sync.
          if (this.storyReelItems && this.storyReelItems[this.storyReelIndex] &&
            this.storyReelItems[this.storyReelIndex].id === id) {
            const reelImg = document.getElementById('story-reel-img');
            if (reelImg) reelImg.src = url;
          }
        }

      } catch (e) {

        const loader = container.querySelector('.loading-label');
        if (loader) {
          loader.innerText = '⚠️ Decrypt Error';
          loader.className = 'text-xs text-alert-pink';
        }
      }
    }).catch(err => {

    });
  },

  drawDoodleOnElementCanvas(canvas, pointsOrElement, color) {
    const elementData = (pointsOrElement && typeof pointsOrElement === 'object' && !Array.isArray(pointsOrElement)) ? pointsOrElement : null;
    const w = elementData ? (elementData.width || 200) : 200;
    const h = elementData ? (elementData.height || 200) : 200;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (elementData && elementData.strokes && elementData.strokes.length > 0) {
      elementData.strokes.forEach(stroke => {
        if (!stroke.points || stroke.points.length < 1) return;

        if (stroke.points.length === 1) {
          ctx.beginPath();
          if (stroke.color === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = stroke.points[0].w || 14;
            ctx.shadowBlur = 0;
          } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color || elementData.color || '#39ff14';
            ctx.lineWidth = stroke.points[0].w || 4;
            if (stroke.glow) {
              ctx.shadowColor = ctx.strokeStyle;
              ctx.shadowBlur = 12;
            } else {
              ctx.shadowBlur = 0;
            }
          }
          ctx.arc(stroke.points[0].x, stroke.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
          if (stroke.color === 'eraser') {
            ctx.fill();
          } else {
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
          }
        } else {
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.beginPath();
            ctx.moveTo(stroke.points[i - 1].x, stroke.points[i - 1].y);
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            if (stroke.color === 'eraser') {
              ctx.globalCompositeOperation = 'destination-out';
              ctx.lineWidth = stroke.points[i].w || 14;
              ctx.shadowBlur = 0;
            } else {
              ctx.globalCompositeOperation = 'source-over';
              ctx.strokeStyle = stroke.color || elementData.color || '#39ff14';
              ctx.lineWidth = stroke.points[i].w || 4;
              if (stroke.glow) {
                ctx.shadowColor = ctx.strokeStyle;
                ctx.shadowBlur = 12;
              } else {
                ctx.shadowBlur = 0;
              }
            }
            ctx.stroke();
          }
        }
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
    } else {
      const points = elementData ? elementData.points : pointsOrElement;
      const strokeColor = elementData ? elementData.color : color;
      if (!points || points.length < 1) return;

      if (points.length === 1) {
        ctx.beginPath();
        ctx.strokeStyle = strokeColor || '#00FF66';
        ctx.lineWidth = points[0].w || 4;
        ctx.globalCompositeOperation = 'source-over';
        ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        for (let i = 1; i < points.length; i++) {
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.strokeStyle = strokeColor || '#00FF66';
          ctx.lineWidth = points[i].w || 4;
          ctx.globalCompositeOperation = 'source-over';
          ctx.stroke();
        }
      }
    }
  },

  startDoodleSparkleLoop(domEl, id) {
    if (this.doodleSparkleIntervals[id]) return;

    this.doodleSparkleIntervals[id] = setInterval(() => {
      if (!domEl || !document.body.contains(domEl)) {
        this.stopDoodleSparkleLoop(id);
        return;
      }
      const canvas = domEl.querySelector('canvas');
      if (!canvas) return;

      const sparkle = document.createElement('div');
      sparkle.className = 'doodle-sparkle';

      // Random position inside the canvas bounds
      const x = Math.random() * canvas.clientWidth;
      const y = Math.random() * canvas.clientHeight;

      sparkle.style.left = `${x}px`;
      sparkle.style.top = `${y}px`;

      // Neon glowing colors
      const colors = ['#39ff14', '#00f0ff', '#ff00ab', '#ffc837', '#ff4a4a', '#b026ff'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      sparkle.style.backgroundColor = randomColor;
      sparkle.style.boxShadow = `0 0 8px ${randomColor}, 0 0 16px ${randomColor}`;

      domEl.appendChild(sparkle);
      setTimeout(() => {
        sparkle.remove();
      }, 500);
    }, 400); // Emits a sparkle every 400ms
  },

  stopDoodleSparkleLoop(id) {
    if (this.doodleSparkleIntervals[id]) {
      clearInterval(this.doodleSparkleIntervals[id]);
      delete this.doodleSparkleIntervals[id];
    }
  },

  findOverlappingElements(containerId) {
    const container = this.elements[containerId];
    if (!container || container.type !== 'container') return [];

    const pw = 320;
    const ph = 320;
    const PX = container.x + pw / 2;
    const PY = container.y + ph / 2;
    const theta = container.rotation || 0;
    const rad = -theta * Math.PI / 180;
    const containerScale = container.scale || 1.0;

    const overlapping = [];

    for (const [otherId, other] of Object.entries(this.elements)) {
      if (other && otherId !== containerId && (other.date || this.currentDate) === this.currentDate) {
        let otherW = 100;
        let otherH = 100;

        if (other.type === 'photo') {
          otherW = 192;
          otherH = 216;
        } else if (other.type === 'doodle') {
          otherW = other.width || 192;
          otherH = other.height || 192;
        } else if (other.type === 'sticker') {
          otherW = other.width || 200;
          otherH = other.height || 200;
        } else if (other.type === 'voice' || other.type === 'music') {
          otherW = 280;
          otherH = 210;
        } else if (other.type === 'video') {
          otherW = 160;
          otherH = 130;
        } else if (other.type === 'text') {
          const domEl = document.getElementById(`item_${otherId}`);
          otherW = domEl ? domEl.clientWidth : 120;
          otherH = domEl ? domEl.clientHeight : 50;
        }

        const emCenterX = other.x + (otherW / 2);
        const emCenterY = other.y + (otherH / 2);

        const dx = emCenterX - PX;
        const dy = emCenterY - PY;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

        const lx = (pw / 2) + (rx / containerScale);
        const ly = (ph / 2) + (ry / containerScale);

        if (lx >= 0 && lx <= pw && ly >= 0 && ly <= ph) {
          overlapping.push(otherId);
        }
      }
    }

    return overlapping;
  },

  updateElementStyle(id, elementData = null) {
    const domEl = document.getElementById(`item_${id}`);
    const data = elementData || this.elements[id];
    if (domEl && data) {
      domEl.style.left = `${data.x}px`;
      domEl.style.top = `${data.y}px`;
      domEl.style.transform = `rotate(${data.rotation || 0}deg) scale(${data.scale || 1})`;

      // Determine baseline zIndex by type if not explicitly set
      let defaultZ = 1;
      if (data.type === 'photo' || data.type === 'container') {
        // Dynamic time-based zIndex sorting: newer photos/containers stack on top of older ones
        const timeOffset = Math.floor(((data.updatedAt || Date.now()) - 1720000000000) / 1000);
        defaultZ = 10 + Math.max(0, timeOffset);
      }
      else if (data.type === 'doodle') defaultZ = 1000000;
      else if (data.type === 'text' || data.type === 'sticker' || data.type === 'voice' || data.type === 'music' || data.type === 'video') defaultZ = 3000000; // Emojis/Stickers/Voice/Music/Video notes always default to on top of photos/doodles

      let actualZ = data.zIndex || defaultZ;
      if ((data.type === 'text' || data.type === 'sticker' || data.type === 'voice' || data.type === 'music' || data.type === 'video') && actualZ < 3000000) {
        actualZ = 3000000 + actualZ; // Shift it up into the sticker layer!
      }
      domEl.style.zIndex = actualZ;
      domEl.style.pointerEvents = data.type === 'container' ? 'none' : 'auto';

      // Explicit parent dimensions to avoid container collapse in WebViews
      const content = domEl.querySelector('.element-content');
      if (data.type === 'photo') {
        domEl.style.width = '192px';
        domEl.style.height = '216px';
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'container') {
        domEl.style.width = '320px';
        domEl.style.height = '320px';
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'doodle') {
        const dw = data.width || 192;
        const dh = data.height || 192;
        domEl.style.width = `${dw}px`;
        domEl.style.height = `${dh}px`;
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'sticker') {
        const dw = data.width || 200;
        const dh = data.height || 200;
        domEl.style.width = `${dw}px`;
        domEl.style.height = `${dh}px`;
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'voice' || data.type === 'music') {
        domEl.style.width = '220px';
        domEl.style.height = '160px';
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'video') {
        domEl.style.width = '180px';
        domEl.style.height = '175px';
        if (content) {
          content.style.width = '100%';
          content.style.height = '100%';
        }
      } else if (data.type === 'text') {
        domEl.style.width = 'auto';
        domEl.style.height = 'auto';
        if (content) {
          content.style.width = 'auto';
          content.style.height = 'auto';
        }
      }

      // Redraw connection lines in real-time during dragging
      if (this.connections) {
        this.renderConnections(this.connections);
      }
    }
  },

  getMaxZIndex(type) {
    let maxZ = 0;
    if (type === 'photo') maxZ = 10;
    else if (type === 'container') maxZ = 500000;
    else if (type === 'doodle') maxZ = 1000000;
    else if (type === 'text' || type === 'sticker' || type === 'voice' || type === 'music' || type === 'video') maxZ = 2000000;

    const isStickerType = (t) => t === 'text' || t === 'sticker' || t === 'voice' || t === 'music' || t === 'video';

    if (this.elements) {
      Object.values(this.elements).forEach(el => {
        if (el && el.zIndex) {
          if (isStickerType(type) && isStickerType(el.type)) {
            if (el.zIndex > maxZ) {
              maxZ = el.zIndex;
            }
          } else if (el.type === type && el.zIndex > maxZ) {
            maxZ = el.zIndex;
          }
        }
      });
    }
    return maxZ;
  },

  bringToFront(id) {
    const data = this.elements[id];
    if (!data) return;

    // Find the highest zIndex currently on the board for this element type
    const maxZ = this.getMaxZIndex(data.type);

    // Increment and assign within its strict layer boundary
    let newZ = maxZ + 1;
    if (data.type === 'photo') {
      newZ = Math.max(10, newZ);
      if (newZ > 499999) newZ = 10;
    } else if (data.type === 'container') {
      newZ = Math.max(500000, newZ);
      if (newZ > 999999) newZ = 500000;
    } else if (data.type === 'doodle') {
      newZ = Math.max(1000000, newZ);
      if (newZ > 1999999) newZ = 1000000;
    } else if (data.type === 'text' || data.type === 'sticker' || data.type === 'voice' || data.type === 'music' || data.type === 'video') {
      newZ = Math.max(2000000, newZ);
      if (newZ > 2999999) newZ = 2000000;
    }

    if (data.zIndex !== newZ) {
      data.zIndex = newZ;
      this.updateElementStyle(id);

      // Save it to Firebase so it updates for all other users
      ScrapFirebase.saveElement(ScrapFirebase.roomId, id, data);
    }
  },

  initRotateScaleStart(e, id, domEl, isTouch = false) {
    const data = this.elements[id];
    if (!data) return;

    this.elemStartScale = data.scale || 1.0;
    this.elemStartRotation = data.rotation || 0;

    const rect = domEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    this.elemStartDist = Math.hypot(clientX - centerX, clientY - centerY);
    this.elemStartAngle = Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
  },

  attachElementEvents(domEl, id) {
    // Click selection toggler & double-tap to edit/delete
    let lastTap = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    let longPressTimer = null;
    let longPressTriggered = false;
    let longPressX = 0;
    let longPressY = 0;

    const startLongPress = (clientX, clientY) => {
      // In Collage Flow mode, suppress long press controls/menus completely
      const collageFlowBar = document.getElementById('collage-flow-filter-bar');
      if (collageFlowBar && !collageFlowBar.classList.contains('hidden')) {
        return;
      }
      longPressTriggered = false;
      longPressX = clientX;
      longPressY = clientY;
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        // Show delete and rotate controls on long press
        document.querySelectorAll('.active-controls').forEach(el => {
          if (el !== domEl) el.classList.remove('active-controls');
        });
        domEl.classList.add('active-controls');
        if (navigator.vibrate) navigator.vibrate(50); // slight haptic feedback
      }, 600); // 600ms threshold for long press
    };

    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    // Cancel on movement
    domEl.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      if (touch && Math.hypot(touch.clientX - longPressX, touch.clientY - longPressY) > 8) {
        cancelLongPress();
      }
    });
    domEl.addEventListener('touchcancel', cancelLongPress);

    domEl.addEventListener('mousemove', (e) => {
      if (Math.hypot(e.clientX - longPressX, e.clientY - longPressY) > 8) {
        cancelLongPress();
      }
    });
    domEl.addEventListener('mouseup', cancelLongPress);
    domEl.addEventListener('mouseleave', cancelLongPress);

    domEl.addEventListener('click', async (e) => {
      if (e.target.classList.contains('control-handle') || e.target.closest('.control-handle')) return;
      e.stopPropagation();

      // If we just triggered a long press, ignore the click to avoid instant toggle
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }

      this.bringToFront(id); // Bring to front on click

      const now = Date.now();
      if (now - lastTap < 300) {
        // Double tap / double click detected! Trigger edit options.
        if (this.elements[id].type === 'text' && id.startsWith('text_')) {
          const currentText = this.elements[id].text || '';
          const val = await window.ScrapDialog.prompt('Edit text sticker:', currentText);
          if (val !== null && val.trim()) {
            const updatedData = {
              ...this.elements[id],
              text: val.trim()
            };
            ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
          }
        } else if (this.elements[id].type === 'doodle') {
          window.dispatchEvent(new CustomEvent('show_doodle_color_picker', { detail: { id, data: this.elements[id] } }));
        } else if (this.elements[id].type === 'photo') {
          if (await window.ScrapDialog.confirm('Delete this photo from canvas globally?')) {
            const fileId = this.elements[id].fileId;
            ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);
            if (fileId) {
              ScrapDrive.deleteFile(fileId);
            }
          }
        } else if (this.elements[id].type === 'voice' || this.elements[id].type === 'music') {
          if (await window.ScrapDialog.confirm(`Delete this ${this.elements[id].type === 'music' ? 'music beat' : 'voice recording'} from canvas globally?`)) {
            const itemData = this.elements[id];
            if (itemData.type === 'music' && window.ScrapApp && window.ScrapApp.activeMusicSynths && window.ScrapApp.activeMusicSynths[id]) {
              window.ScrapApp.activeMusicSynths[id].stop();
              delete window.ScrapApp.activeMusicSynths[id];
            }
            const fileId = itemData.fileId || itemData.audioFileId || itemData.videoFileId;
            await ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);
            if (fileId) {
              try {
                await ScrapDrive.deleteFile(fileId);
              } catch (err) {
                console.warn('[Delete] File purge failed:', err);
              }
            }
          }
        }
      } else {
        // Single tap/click - select
        if (this.isConnectionSelectionMode) {
          this.handleConnectionCandidateSelection(id, domEl);
          lastTap = now;
          return;
        }
        // Removed: domEl.classList.toggle('active-controls') on single tap!
      }
      lastTap = now;
    });

    // Standard Drag Initiation
    domEl.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('control-handle') || e.target.closest('.control-handle')) return;
      if (!e.target.classList.contains('voice-cassette') && !e.target.closest('.voice-cassette') &&
        !e.target.classList.contains('video-card') && !e.target.closest('.video-card')) {
        e.preventDefault();
      }
      e.stopPropagation();
      this.bringToFront(id); // Bring to front on drag start
      this.activeElement = domEl;
      this.activeElementId = id;

      const data = this.elements[id];
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.elemStartX = data.x;
      this.elemStartY = data.y;

      // Group dragging for container (photo) elements
      this.draggedChildren = [];
      if (data && data.type === 'container') {
        const childIds = this.findOverlappingElements(id);
        childIds.forEach(childId => {
          const childData = this.elements[childId];
          if (childData) {
            this.draggedChildren.push({
              id: childId,
              startX: childData.x,
              startY: childData.y
            });
          }
        });
      }

      startLongPress(e.clientX, e.clientY);
    });

    // Touch Drag Initiation
    domEl.addEventListener('touchstart', (e) => {
      if (e.target.classList.contains('control-handle') || e.target.closest('.control-handle')) return;
      e.stopPropagation();

      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();

      if (!e.target.classList.contains('polaroid-footer-click') && !e.target.closest('.polaroid-footer-click') &&
        !e.target.classList.contains('voice-cassette') && !e.target.closest('.voice-cassette') &&
        !e.target.classList.contains('video-card') && !e.target.closest('.video-card')) {
        e.preventDefault(); // Prevents system dragging/magnifying/scrolling
      }

      this.bringToFront(id); // Bring to front on touch start

      this.activeElement = domEl;
      this.activeElementId = id;

      const data = this.elements[id];

      // Group dragging for container (photo) elements
      this.draggedChildren = [];
      if (data && data.type === 'container') {
        const childIds = this.findOverlappingElements(id);
        childIds.forEach(childId => {
          const childData = this.elements[childId];
          if (childData) {
            this.draggedChildren.push({
              id: childId,
              startX: childData.x,
              startY: childData.y
            });
          }
        });
      }

      if (e.touches.length === 2) {
        this.isPinchingElement = true;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        this.elemStartDist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        this.elemStartAngle = Math.atan2(touch1.clientY - touch2.clientY, touch1.clientX - touch2.clientX) * (180 / Math.PI);
        this.elemStartScale = data.scale || 1.0;
        this.elemStartRotation = data.rotation || 0;
      } else {
        this.isPinchingElement = false;
        const touch = e.touches[0];
        this.dragStartX = touch.clientX;
        this.dragStartY = touch.clientY;
        this.elemStartX = data.x;
        this.elemStartY = data.y;
      }

      startLongPress(touch.clientX, touch.clientY);
    }, { passive: false });

    // Touch Tap and Selection Handler
    domEl.addEventListener('touchend', async (e) => {
      cancelLongPress();
      if (e.target.classList.contains('control-handle') || e.target.closest('.control-handle')) return;

      // If long press was triggered, consume the event
      if (longPressTriggered) {
        longPressTriggered = false;
        e.preventDefault();
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
      const duration = Date.now() - touchStartTime;

      if (duration < 250 && dist < 8) {
        // Quick Tap detected - toggle selection & bring to front
        const now = Date.now();
        if (now - lastTap < 300) {
          // Trigger double tap edit/delete
          if (this.elements[id].type === 'text' && id.startsWith('text_')) {
            const currentText = this.elements[id].text || '';
            const val = await window.ScrapDialog.prompt('Edit text sticker:', currentText);
            if (val !== null && val.trim()) {
              const updatedData = {
                ...this.elements[id],
                text: val.trim()
              };
              ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
            }
          } else if (this.elements[id].type === 'doodle') {
            window.dispatchEvent(new CustomEvent('show_doodle_color_picker', { detail: { id, data: this.elements[id] } }));
          } else if (this.elements[id].type === 'photo') {
            if (await window.ScrapDialog.confirm('Delete this photo from canvas globally?')) {
              const fileId = this.elements[id].fileId;
              ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);
              if (fileId) {
                ScrapDrive.deleteFile(fileId);
              }
            }
          }
        } else {
          if (this.isConnectionSelectionMode) {
            this.handleConnectionCandidateSelection(id, domEl);
            lastTap = now;
            return;
          }
          // Removed active-controls toggle on single tap
          this.bringToFront(id);

          // Smoothly center viewport on the single-tapped element
          const data = this.elements[id];
          if (data) {
            this.centerOnElement(data.x, data.y, domEl.clientWidth || 176, domEl.clientHeight || 200);
          }
        }
        lastTap = now;
      }
    });

    // Rotate / Scale handle
    const rotateTrigger = domEl.querySelector('.rotate-trigger');
    rotateTrigger.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.activeElement = domEl;
      this.activeElementId = id;
      this.isRotatingScaling = true;
      this.initRotateScaleStart(e, id, domEl, false);
    });

    // Touch Rotate / Scale handle
    rotateTrigger.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.activeElement = domEl;
      this.activeElementId = id;
      this.isRotatingScaling = true;
      this.initRotateScaleStart(e, id, domEl, true);
    }, { passive: false });



    // Custom Polaroid Footer Text Edit trigger
    const footerBtn = domEl.querySelector('.polaroid-footer-click');
    if (footerBtn) {
      footerBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentText = this.elements[id].polaroidText || '';
        const val = await window.ScrapDialog.prompt('Edit Polaroid footer text:', currentText);
        if (val !== null) {
          const updatedData = {
            ...this.elements[id],
            polaroidText: val.trim()
          };
          await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
        }
      });
    }

    // Custom Container Frame Title Edit trigger
    const containerCard = domEl.querySelector('.container-card');
    if (containerCard) {
      containerCard.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const currentText = this.elements[id].title || '';
        const val = await window.ScrapDialog.prompt('Edit Group Frame Title (Max 12 chars):', currentText);
        if (val !== null) {
          const updatedData = {
            ...this.elements[id],
            title: val.trim().substring(0, 12)
          };
          await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
        }
      });
      let lastContainerTap = 0;
      containerCard.addEventListener('touchstart', async (e) => {
        const now = Date.now();
        if (now - lastContainerTap < 300) {
          e.stopPropagation();
          const currentText = this.elements[id].title || '';
          const val = await window.ScrapDialog.prompt('Edit Group Frame Title (Max 12 chars):', currentText);
          if (val !== null) {
            const updatedData = {
              ...this.elements[id],
              title: val.trim().substring(0, 12)
            };
            await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
          }
        }
        lastContainerTap = now;
      }, { passive: true });
    }

    // Delete trigger
    const deleteTrigger = domEl.querySelector('.delete-trigger');

    const executeDeletion = async () => {
      if (!this.elements[id]) return;
      if (await window.ScrapDialog.confirm('Delete this from canvas globally?')) {
        const itemData = this.elements[id];
        if (!itemData) return;

        // Stop music synth context if playing
        if (itemData.type === 'music' && window.ScrapApp && window.ScrapApp.activeMusicSynths && window.ScrapApp.activeMusicSynths[id]) {
          window.ScrapApp.activeMusicSynths[id].stop();
          delete window.ScrapApp.activeMusicSynths[id];
        }

        const fileId = itemData.fileId || itemData.audioFileId || itemData.videoFileId;
        await ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);
        if (fileId) {
          try {
            await ScrapDrive.deleteFile(fileId);
          } catch (err) {
            console.error('[Delete] Google Drive file deletion failed:', err);
            await window.ScrapDialog.alert('Failed to delete media file from Google Drive: ' + err.message);
          }
        }
      }
    };

    // Desktop click handler
    deleteTrigger.addEventListener('click', async (e) => {
      e.stopPropagation();
      await executeDeletion();
    });

    // Mobile touch handler
    deleteTrigger.addEventListener('touchstart', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await executeDeletion();
    }, { passive: false });

    // Report trigger
    const reportTrigger = domEl.querySelector('.report-trigger');
    if (reportTrigger) {
      const executeReport = async () => {
        if (!this.elements[id]) return;
        if (await window.ScrapDialog.confirm('⚠️ REPORT CONTENT:\nAre you sure you want to report this content for violating community safety guidelines? It will be deleted globally.')) {
          const itemData = this.elements[id];
          if (!itemData) return;

          // Hide immediately in UI
          domEl.classList.add('hidden');
          domEl.remove();

          // Stop music synth context if playing
          if (itemData.type === 'music' && window.ScrapApp && window.ScrapApp.activeMusicSynths && window.ScrapApp.activeMusicSynths[id]) {
            window.ScrapApp.activeMusicSynths[id].stop();
            delete window.ScrapApp.activeMusicSynths[id];
          }

          // Save reported status locally
          const localKey = `scrap_reported_${ScrapFirebase.roomId}`;
          let reportedList = [];
          try {
            reportedList = JSON.parse(localStorage.getItem(localKey) || '[]');
          } catch (e) { }
          if (!reportedList.includes(id)) {
            reportedList.push(id);
            localStorage.setItem(localKey, JSON.stringify(reportedList));
          }

          // Delete globally from backend database (Firebase + elements sync folder)
          await ScrapFirebase.deleteElement(ScrapFirebase.roomId, id);

          // Delete media file (doodle, photo, audio) from Google Drive storage
          const fileId = itemData.fileId || itemData.audioFileId || itemData.videoFileId;
          if (fileId) {
            try {
              await ScrapDrive.deleteFile(fileId);
            } catch (err) {
              console.error('[Report Auto-Delete] Google Drive file deletion failed:', err);
            }
          }

          await window.ScrapDialog.alert('Content reported and deleted globally. Thank you for keeping the space safe.');
        }
      };

      reportTrigger.addEventListener('click', async (e) => {
        e.stopPropagation();
        await executeReport();
      });
      reportTrigger.addEventListener('touchstart', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await executeReport();
      }, { passive: false });
    }

    // Reaction trigger
    const reactionTrigger = domEl.querySelector('.reaction-trigger');
    if (reactionTrigger) {
      const executeReaction = async () => {
        // Remove existing picker if showing
        const existing = document.getElementById('reaction-picker-toolbar');
        if (existing) existing.remove();

        const picker = document.createElement('div');
        picker.id = 'reaction-picker-toolbar';
        const lx = domEl.offsetLeft + domEl.clientWidth / 2;
        const ly = domEl.offsetTop + domEl.clientHeight + 12; // Floating below bottom border

        picker.style.position = 'absolute';
        picker.style.display = 'flex';
        picker.style.flexDirection = 'row';
        picker.style.alignItems = 'center';
        picker.style.padding = '8px 14px';
        picker.style.backgroundColor = '#120921';
        picker.style.border = '2px solid rgba(168, 85, 247, 0.8)';
        picker.style.borderRadius = '9999px';
        picker.style.boxShadow = '0 12px 30px rgba(0,0,0,0.85)';
        picker.style.zIndex = '3000';
        picker.style.left = `${lx}px`;
        picker.style.top = `${ly}px`;
        picker.style.transform = 'translate(-50%, 0)';
        picker.style.pointerEvents = 'auto';

        // Inject styles dynamically to hide scrollbar in the mobile webview
        const styleId = 'reaction-picker-toolbar-scroll-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            .reaction-scroll-track::-webkit-scrollbar {
              display: none !important;
            }
            .reaction-scroll-track {
              -ms-overflow-style: none !important;
              scrollbar-width: none !important;
            }
          `;
          document.head.appendChild(style);
        }

        picker.innerHTML = `
          <button class="picker-scroll-btn scroll-left text-purple-400 font-bold px-2 select-none active:scale-75 transition-transform" style="font-size: 22px; background: none; border: none; outline: none; cursor: pointer;">◀</button>
          <div class="reaction-scroll-track flex flex-row items-center gap-[24px] overflow-x-auto" style="max-width: 300px; white-space: nowrap; -webkit-overflow-scrolling: touch; pointer-events: auto;">
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😊" style="cursor:pointer; font-size: 34px;">😊</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🙂" style="cursor:pointer; font-size: 34px;">🙂</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😀" style="cursor:pointer; font-size: 34px;">😀</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😁" style="cursor:pointer; font-size: 34px;">😁</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🥰" style="cursor:pointer; font-size: 34px;">🥰</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="❤️" style="cursor:pointer; font-size: 34px;">❤️</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🔥" style="cursor:pointer; font-size: 34px;">🔥</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😂" style="cursor:pointer; font-size: 34px;">😂</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😍" style="cursor:pointer; font-size: 34px;">😍</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🤩" style="cursor:pointer; font-size: 34px;">🤩</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😜" style="cursor:pointer; font-size: 34px;">😜</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🤪" style="cursor:pointer; font-size: 34px;">🤪</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😎" style="cursor:pointer; font-size: 34px;">😎</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="💀" style="cursor:pointer; font-size: 34px;">💀</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🎉" style="cursor:pointer; font-size: 34px;">🎉</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="💯" style="cursor:pointer; font-size: 34px;">💯</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="👍" style="cursor:pointer; font-size: 34px;">👍</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😮" style="cursor:pointer; font-size: 34px;">😮</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😢" style="cursor:pointer; font-size: 34px;">😢</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😡" style="cursor:pointer; font-size: 34px;">😡</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🙌" style="cursor:pointer; font-size: 34px;">🙌</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="✨" style="cursor:pointer; font-size: 34px;">✨</span>
            <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="👀" style="cursor:pointer; font-size: 34px;">👀</span>
          </div>
          <button class="picker-scroll-btn scroll-right text-purple-400 font-bold px-2 select-none active:scale-75 transition-transform" style="font-size: 22px; background: none; border: none; outline: none; cursor: pointer;">▶</button>
        `;

        this.canvasEl.appendChild(picker);

        // Bind scroll button clicks
        const track = picker.querySelector('.reaction-scroll-track');
        picker.querySelector('.scroll-left').addEventListener('click', (e) => {
          e.stopPropagation();
          track.scrollBy({ left: -100, behavior: 'smooth' });
        });
        picker.querySelector('.scroll-right').addEventListener('click', (e) => {
          e.stopPropagation();
          track.scrollBy({ left: 100, behavior: 'smooth' });
        });

        // Bind emoji click/touchstart handlers
        picker.querySelectorAll('span[data-emoji]').forEach(el => {
          const handler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const emoji = el.getAttribute('data-emoji');
            this.spawnEmojiBurst(domEl, emoji);
            this.spawnFullScreenSparks(emoji);
            picker.remove();

            // Sync spark alert dynamically over PocketBase
            const sparkId = 'spark_' + Date.now();
            ScrapFirebase.saveElement(ScrapFirebase.roomId, sparkId, {
              type: 'spark',
              emoji: emoji,
              targetElementId: id,
              userName: ScrapFirebase.userName || 'Squadmate',
              timestamp: Date.now(),
              date: this.currentDate
            }).then(() => {
              setTimeout(() => {
                ScrapFirebase.deleteElement(ScrapFirebase.roomId, sparkId);
              }, 2000);
            });
          };
          el.addEventListener('click', handler);
          el.addEventListener('touchstart', handler, { passive: false });
        });

        // Close on clicking elsewhere (bulletproof mobile verification)
        const closeHandler = (e) => {
          if (picker.contains(e.target) || reactionTrigger.contains(e.target)) {
            return;
          }
          picker.remove();
          document.removeEventListener('pointerdown', closeHandler);
        };
        setTimeout(() => {
          document.addEventListener('pointerdown', closeHandler);
        }, 50);
      };

      reactionTrigger.addEventListener('click', async (e) => {
        e.stopPropagation();
        await executeReaction();
      });
      reactionTrigger.addEventListener('touchstart', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await executeReaction();
      }, { passive: false });
    }

    // Border Style Trigger (only for photos)
    const borderTrigger = domEl.querySelector('.border-style-trigger');
    if (borderTrigger) {
      const openBorderPicker = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const currentStyle = (this.elements[id] && this.elements[id].borderStyle) || 'classic';

        // Show a beautiful custom picker modal
        const existing = document.getElementById('polaroid-border-picker-modal');
        if (existing) existing.remove();

        const borderOptions = [
          { key: 'classic', emoji: '🤍', label: 'Classic' },
          { key: 'washi_tape', emoji: '🎗️', label: 'Washi Tape' },
          { key: 'cow_print', emoji: '🐄', label: 'Cow Print' },
          { key: 'checkerboard', emoji: '♟️', label: 'Checker' },
          { key: 'retro_pink', emoji: '🌸', label: 'Retro Pink' },
          { key: 'neon_pink', emoji: '💗', label: 'Neon Pink' },
          { key: 'neon_green', emoji: '💚', label: 'Neon Green' },
          { key: 'dark_chrome', emoji: '🖤', label: 'Dark Chrome' },
          // Holographic styles
          { key: 'holographic', emoji: '🌈', label: 'Holo Classic' },
          { key: 'aurora', emoji: '🌌', label: 'Aurora' },
          { key: 'galaxy', emoji: '🔮', label: 'Galaxy' },
          { key: 'ocean', emoji: '🌊', label: 'Ocean' },
          { key: 'sunset', emoji: '🌅', label: 'Sunset' },
          { key: 'vaporwave', emoji: '💜', label: 'Vaporwave' },
          { key: 'midnight_prism', emoji: '✨', label: 'Prism' },
        ];

        const modal = document.createElement('div');
        modal.id = 'polaroid-border-picker-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;';
        modal.innerHTML = `
          <div style="background:#120921;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:20px 16px 32px;width:100%;max-width:480px;">
            <div style="text-align:center;margin-bottom:16px;">
              <span style="color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-weight:bold;opacity:0.7;">// Choose Polaroid Style</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
              ${borderOptions.map(opt => {
          const css = ScrapCanvas.getPolaroidBorderCSS(opt.key);
          const isActive = opt.key === currentStyle;
          return `
                  <button data-style="${opt.key}" style="
                    ${css.wrapper}
                    border-radius:10px;
                    padding:10px 4px;
                    display:flex;flex-direction:column;align-items:center;gap:4px;
                    cursor:pointer;
                    outline:${isActive ? '3px solid #39ff14' : 'none'};
                    outline-offset:2px;
                    min-height:64px;
                    transition:all 0.2s;
                  ">
                    <span style="font-size:22px">${opt.emoji}</span>
                    <span style="font-size:8px;font-family:monospace;font-weight:bold;text-transform:uppercase;letter-spacing:1px;${css.footer}">${opt.label}</span>
                  </button>
                `;
        }).join('')}
            </div>
            <button id="polaroid-border-picker-cancel" style="
              display:block;margin:16px auto 0;
              background:rgba(255,255,255,0.08);color:#fff;border:none;
              padding:8px 24px;border-radius:99px;font-size:11px;font-family:monospace;
              text-transform:uppercase;letter-spacing:2px;cursor:pointer;">
              Cancel
            </button>
          </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('[data-style]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const chosen = btn.getAttribute('data-style');
            modal.remove();
            const updatedData = { ...this.elements[id], borderStyle: chosen };
            this.elements[id] = updatedData;
            this.lastLocalEditTimes[id] = Date.now();
            this.renderOrUpdateElementDom(id, updatedData);
            await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
          });
        });

        document.getElementById('polaroid-border-picker-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      };

      borderTrigger.addEventListener('click', openBorderPicker);
      borderTrigger.addEventListener('touchstart', openBorderPicker, { passive: false });
    }

    // Photo Filter Style Trigger (only for photos)
    const filterTrigger = domEl.querySelector('.filter-style-trigger');
    if (filterTrigger) {
      const openFilterPicker = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const currentFilter = (this.elements[id] && this.elements[id].filterStyle) || 'none';

        const filterOptions = [
          { key: 'none', emoji: '📷', label: 'None' },
          { key: 'mono', emoji: '🖤', label: 'Mono' },
          { key: 'golden-hour', emoji: '🌅', label: 'Golden' },
          { key: 'cyber-matrix', emoji: '👽', label: 'Matrix' },
          { key: 'retro-vhs', emoji: '📼', label: 'VHS Scan' },
          { key: 'vaporwave', emoji: '💜', label: 'Vaporwave' },
          { key: 'cyber-neon', emoji: '🧬', label: 'Neon' },
          { key: 'matcha', emoji: '🍵', label: 'Matcha' }
        ];

        const existing = document.getElementById('photo-filter-picker-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'photo-filter-picker-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;';
        modal.innerHTML = `
          <div style="background:#120921;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:20px 16px 32px;width:100%;max-width:480px;">
            <div style="text-align:center;margin-bottom:16px;">
              <span style="color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-weight:bold;opacity:0.7;">// Choose Photo Filter</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
              ${filterOptions.map(opt => {
          const isActive = opt.key === currentFilter;
          return `
                  <button data-filter="${opt.key}" style="
                    background: ${isActive ? 'rgba(57,255,20,0.1)' : 'rgba(255,255,255,0.04)'};
                    border: 1px solid ${isActive ? '#39ff14' : 'rgba(255,255,255,0.1)'};
                    border-radius:10px;
                    padding:10px 4px;
                    display:flex;flex-direction:column;align-items:center;gap:4px;
                    cursor:pointer;
                    outline:${isActive ? '3px solid #39ff14' : 'none'};
                    outline-offset:2px;
                    min-height:64px;
                    transition:all 0.2s;
                    color:#fff;
                  ">
                    <span style="font-size:22px">${opt.emoji}</span>
                    <span style="font-size:8px;font-family:monospace;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#fff;">${opt.label}</span>
                  </button>
                `;
        }).join('')}
            </div>
            <button id="photo-filter-picker-cancel" style="
              display:block;margin:16px auto 0;
              background:rgba(255,255,255,0.08);color:#fff;border:none;
              padding:8px 24px;border-radius:99px;font-size:11px;font-family:monospace;
              text-transform:uppercase;letter-spacing:2px;cursor:pointer;">
              Cancel
            </button>
          </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('[data-filter]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const chosen = btn.getAttribute('data-filter');
            modal.remove();
            const updatedData = { ...this.elements[id], filterStyle: chosen };
            this.elements[id] = updatedData;
            this.lastLocalEditTimes[id] = Date.now();
            this.renderOrUpdateElementDom(id, updatedData);
            await ScrapFirebase.saveElement(ScrapFirebase.roomId, id, updatedData);
          });
        });

        document.getElementById('photo-filter-picker-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      };

      filterTrigger.addEventListener('click', openFilterPicker);
      filterTrigger.addEventListener('touchstart', openFilterPicker, { passive: false });
    }
  },

  activeMembers: {},

  updateActiveMembersListUI() {
    const listEl = document.getElementById('members-sidebar-list');
    if (!listEl) return;

    this.activeMembers = this.activeMembers || {};
    const now = Date.now();

    // Sync activeMembers avatars from joinedMembers
    Object.keys(this.activeMembers).forEach(uid => {
      const matched = (this.joinedMembers || []).find(m => m.id === uid);
      if (matched) {
        this.activeMembers[uid].avatar = matched.avatar || '';
      }
    });

    // Include ourselves in the active members list
    if (window.ScrapFirebase && ScrapFirebase.userId) {
      this.activeMembers[ScrapFirebase.userId] = {
        userName: ScrapFirebase.userName,
        avatar: (window.pb && pb.authStore.model && pb.authStore.model.avatar) || '',
        updatedAt: now
      };
    }

    // Prune members inactive for more than 12 seconds
    for (const [uid, member] of Object.entries(this.activeMembers)) {
      if (now - member.updatedAt > 12000) {
        delete this.activeMembers[uid];
      }
    }

    // Load blocked list
    const blockedUsers = window.ScrapFirebase && typeof ScrapFirebase.getBlockedUsers === 'function'
      ? ScrapFirebase.getBlockedUsers()
      : [];

    this.joinedMembers = this.joinedMembers || [];
    const isRoomOwner = localStorage.getItem('scrap_room_is_owner_' + (window.ScrapFirebase && ScrapFirebase.roomId)) === 'true';

    // Inline helper to render the display items using current state
    const renderList = () => {
      // Map joined members to active state
      let displayMembers = [];
      if (this.joinedMembers.length > 0) {
        this.joinedMembers.forEach(jm => {
          const isActive = this.activeMembers[jm.id] ? true : false;
          displayMembers.push({
            id: jm.id,
            name: jm.name,
            isActive: isActive,
            avatar: jm.avatar || ''
          });
        });
      } else {
        // Fallback if joinedMembers list hasn't loaded yet
        Object.entries(this.activeMembers).forEach(([uid, member]) => {
          displayMembers.push({
            id: uid,
            name: member.userName,
            isActive: true,
            avatar: member.avatar || ''
          });
        });
      }

      listEl.innerHTML = '';
      displayMembers.forEach(member => {
        const uid = member.id;
        const uName = (member.name && typeof member.name === 'string' && member.name.trim()) ? member.name.trim() : 'Squadmate';
        const initials = uName.substring(0, 2).toUpperCase();
        const isMe = uid === (window.ScrapFirebase && ScrapFirebase.userId);
        const isBlocked = blockedUsers.includes(uid);

        const statusText = member.isActive ? 'Active Now' : 'Offline';
        const statusColor = member.isActive ? 'text-green-600' : 'text-gray-400';
        const avatarBorder = member.isActive ? 'border-green-500' : 'border-gray-300';
        const avatarBg = member.isActive ? 'bg-green-50' : 'bg-gray-100';
        const avatarText = member.isActive ? 'text-green-600' : 'text-gray-500';
        const rowBg = isBlocked ? 'bg-rose-50 border-rose-200' : 'bg-transparent border-transparent';
        let avatarUrl = '';
        if (member.avatar) {
          avatarUrl = `https://api.myscrapmemories.com/api/files/users/${uid}/${member.avatar}`;
        } else if (isMe && window.pb && pb.authStore.model && pb.authStore.model.avatar) {
          avatarUrl = `https://api.myscrapmemories.com/api/files/users/${uid}/${pb.authStore.model.avatar}`;
        }

        const itemEl = document.createElement('div');
        itemEl.className = 'flex items-center gap-3 w-full cursor-pointer py-1.5 px-2 border border-transparent rounded-xl transition-all border-b border-slate-100 last:border-0 pointer-events-auto ' + rowBg;

        itemEl.innerHTML = `
          <!-- Avatar -->
          <div class="w-7 h-7 rounded-full border ${avatarBorder} ${avatarBg} flex items-center justify-center text-[9px] font-bold font-sans ${avatarText} flex-shrink-0 shadow-sm overflow-hidden">
            ${avatarUrl ? `<img src="${avatarUrl}" class="w-full h-full object-cover animate-fade-in" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="fallback-initials" style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${initials}</span>` : initials}
          </div>
          <!-- Name & Status -->
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-[9.5px] text-slate-900 font-bold truncate leading-tight member-display-name">${uName}${isMe ? ' (You)' : ''}</span>
            <span class="text-[6.5px] ${statusColor} font-mono uppercase tracking-wider font-bold mt-0.5">${isBlocked ? 'Blocked' : statusText}</span>
          </div>
        `;

        // Click row -> Open custom modal bottom sheet (safe, no layout shift!)
        if (!isMe) {
          itemEl.addEventListener('click', () => {
            this.showMemberActionsModal(
              { id: uid, name: uName, avatar: member.avatar },
              isRoomOwner,
              isBlocked
            );
          });
        }

        listEl.appendChild(itemEl);
      });
    };

    // Render immediately using cache
    renderList();

    // Sync floating edge bubbles
    this.updateSideSquadBubbles();
  },

  // Helper action to toggle block status (called from modal)
  async toggleBlockUserAction(uid, uName) {
    try {
      if (window.ScrapFirebase && typeof ScrapFirebase.toggleBlockUser === 'function') {
        const currentBlocked = ScrapFirebase.getBlockedUsers();
        const isCurrentlyBlocked = currentBlocked.includes(uid);

        if (isCurrentlyBlocked) {
          await ScrapFirebase.toggleBlockUser(uid);
          await window.ScrapDialog.alert(`"${uName}" has been unblocked.`);
        } else {
          if (await window.ScrapDialog.confirm(`Are you sure you want to block "${uName}"? Their content and presence will be hidden from your canvas.`)) {
            await ScrapFirebase.toggleBlockUser(uid);
            await window.ScrapDialog.alert(`"${uName}" has been blocked.`);
          }
        }
      } else {
        let blocked = JSON.parse(localStorage.getItem('scrap_blocked_users') || '[]');
        if (blocked.includes(uid)) {
          blocked = blocked.filter(id => id !== uid);
          localStorage.setItem('scrap_blocked_users', JSON.stringify(blocked));
          await window.ScrapDialog.alert(`"${uName}" has been unblocked.`);
        } else {
          if (await window.ScrapDialog.confirm(`Are you sure you want to block "${uName}"? Their content and presence will be hidden from your canvas.`)) {
            blocked.push(uid);
            localStorage.setItem('scrap_blocked_users', JSON.stringify(blocked));
            await window.ScrapDialog.alert(`"${uName}" has been blocked.`);
          }
        }
      }
    } catch (err) {
      await window.ScrapDialog.alert('Failed to update block status: ' + err.message);
    }
    this.updateActiveMembersListUI();
    if (window.ScrapFirebase && ScrapFirebase.elements) {
      this.renderElements(ScrapFirebase.elements);
    }
  },

  // Helper action to remove participant (called from modal)
  async removeMemberAction(uid, uName) {
    if (await window.ScrapDialog.confirm(`Are you sure you want to remove "${uName}" from this room?`)) {
      try {
        if (window.ScrapFirebase && typeof window.ScrapFirebase.removeMember === 'function') {
          await window.ScrapFirebase.removeMember(ScrapFirebase.roomId, uid);
          await window.ScrapDialog.alert(`"${uName}" has been removed.`);
        }
      } catch (kickErr) {
        await window.ScrapDialog.alert('Failed to remove member: ' + kickErr.message);
      }
      this.updateActiveMembersListUI();
    }
  },

  // Modal Bottom Sheet dialog to select member actions safely without layout shifts
  showMemberActionsModal(member, isRoomOwner, isBlocked) {
    const initials = member.name.substring(0, 2).toUpperCase();

    let avatarUrl = '';
    if (member.avatar) {
      avatarUrl = `https://api.myscrapmemories.com/api/files/users/${member.id}/${member.avatar}`;
    }

    // Create dark backdrop overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 z-[100] flex items-end sm:items-center justify-center p-4 transition-all duration-300 pointer-events-auto opacity-0';

    // Create card container
    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl w-full max-w-xs p-5 shadow-2xl transition-all duration-300 transform translate-y-full sm:translate-y-0 sm:scale-95 text-black flex flex-col gap-4 select-none';

    card.innerHTML = `
      <div class="flex items-center gap-3 border-b border-slate-100 pb-3">
        <div class="w-9 h-9 rounded-full border border-purple-200 bg-purple-50 flex items-center justify-center text-xs font-bold text-purple-600 flex-shrink-0 overflow-hidden">
          ${avatarUrl ? `<img src="${avatarUrl}" class="w-full h-full object-cover animate-fade-in" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="fallback-initials" style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${initials}</span>` : initials}
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-[11px] font-bold text-slate-900 truncate">${member.name}</span>
          <span class="text-[7.5px] text-slate-400 font-mono uppercase tracking-wider font-bold">Room Participant</span>
        </div>
        <button class="btn-close-modal bg-red-600 hover:bg-red-700 text-white rounded px-2 py-0.5 text-xs font-bold font-sans transition-colors">✕</button>
      </div>
      
      <div class="flex flex-col gap-2">
        <!-- Block Button -->
        <button class="btn-modal-block w-full py-2.5 rounded-xl border font-bold text-[9px] uppercase tracking-wider transition-all active:scale-95 ${isBlocked
        ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
        : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-250'
      }">
          ${isBlocked ? '🛡️ Unblock User' : '🚫 Block User'}
        </button>
        
        <!-- Remove Button (Only for owner) -->
        ${isRoomOwner ? `
          <button class="btn-modal-remove w-full py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-bold text-[9px] uppercase tracking-wider transition-all active:scale-95 hover:bg-red-100">
            🚪 Remove User
          </button>
        ` : ''}
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Trigger transition animations
    setTimeout(() => {
      overlay.classList.remove('opacity-0');
      card.classList.remove('translate-y-full', 'sm:scale-95');
    }, 20);

    const closeModal = () => {
      overlay.classList.add('opacity-0');
      card.classList.add('translate-y-full', 'sm:scale-95');
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    card.querySelector('.btn-close-modal').addEventListener('click', closeModal);

    card.querySelector('.btn-modal-block').addEventListener('click', async () => {
      closeModal();
      await this.toggleBlockUserAction(member.id, member.name);
    });

    if (isRoomOwner) {
      card.querySelector('.btn-modal-remove').addEventListener('click', async () => {
        closeModal();
        await this.removeMemberAction(member.id, member.name);
      });
    }
  },

  refreshJoinedMembers() {
    if (window.pb && pb.authStore.isValid && window.ScrapFirebase && ScrapFirebase.roomId) {
      pb.collection('boards').getOne(ScrapFirebase.roomId, { expand: 'members,user' })
        .then(record => {
          const owner = record.expand && record.expand.user;
          const membersList = record.expand && record.expand.members ? record.expand.members : [];
          const allMembers = [];
          if (owner) {
            allMembers.push({
              id: owner.id,
              name: owner.name || owner.username || 'Creator',
              avatar: owner.avatar || ''
            });
          } else if (record.user) {
            allMembers.push({
              id: record.user,
              name: 'Creator',
              avatar: ''
            });
          }

          // Map expanded members by ID
          const expandedMap = {};
          membersList.forEach(m => {
            if (m && m.id) expandedMap[m.id] = m;
          });

          // Use record.members (which is always present) to list joined members
          const rawMembers = record.members || [];
          rawMembers.forEach(mid => {
            if (owner && mid === owner.id) return;
            if (mid === record.user) return;
            const expandedUser = expandedMap[mid];
            allMembers.push({
              id: mid,
              name: expandedUser ? (expandedUser.name || expandedUser.username || 'Squadmate') : 'Squadmate',
              avatar: expandedUser ? (expandedUser.avatar || '') : ''
            });
          });

          this.joinedMembers = allMembers;
          this.updateActiveMembersListUI();
        })
        .catch(err => {
          console.warn('[Members Refresh] Failed to refresh members from DB:', err);
        });
    }
  },

  // --- Rendering cursor bubbles for other users on the side wall of the screen ---
  renderUserPresence(presence) {
    // Add/update to active members list
    this.activeMembers = this.activeMembers || {};
    this.activeMembers[presence.userId] = {
      userName: presence.userName,
      activeEmoji: presence.activeEmoji,
      updatedAt: Date.now()
    };
    this.updateActiveMembersListUI();
  },

  updateSideSquadBubbles() {
    let container = document.getElementById('active-squad-bubbles-wall');

    // Hide squad bubbles container if not on canvas screen or not logged in
    const activeScreen = window.ScrapApp ? window.ScrapApp.activeScreen : '';
    const isLoggedIn = window.pb && pb.authStore.isValid;
    if (activeScreen !== 'screen-canvas' || !isLoggedIn) {
      if (container) container.classList.add('hidden');
      return;
    }

    if (!container) {
      container = document.createElement('div');
      container.id = 'active-squad-bubbles-wall';
      container.className = 'fixed right-4 top-28 flex flex-col gap-3 z-50 pointer-events-none';
      document.body.appendChild(container);
    }
    container.classList.remove('hidden');

    const now = Date.now();
    container.innerHTML = '';

    // Load blocked list
    const blockedUsers = window.ScrapFirebase && typeof ScrapFirebase.getBlockedUsers === 'function'
      ? ScrapFirebase.getBlockedUsers()
      : [];

    Object.entries(this.activeMembers || {}).forEach(([uid, member]) => {
      // Exclude ourselves and blocked users
      if (uid === (window.ScrapFirebase && window.ScrapFirebase.userId) || blockedUsers.includes(uid)) {
        return;
      }

      // Only show if active within last 12 seconds
      if (now - member.updatedAt > 12000) {
        return;
      }

      const uName = (member && typeof member.userName === 'string' && member.userName.trim()) ? member.userName.trim() : 'Squadmate';
      const initials = uName.substring(0, 2).toUpperCase();

      const avatarFilename = member.avatar || (() => {
        const matched = (this.joinedMembers || []).find(m => m.id === uid);
        return matched ? matched.avatar : '';
      })();
      const avatarUrl = avatarFilename ? `https://api.myscrapmemories.com/api/files/users/${uid}/${avatarFilename}` : '';

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'flex items-center justify-end gap-2 pointer-events-auto';
      bubbleEl.innerHTML = `
        <div class="relative group flex items-center justify-end">
          <!-- Hover Username Tooltip -->
          <span class="mr-2 text-[9px] font-mono text-[#39ff14] bg-black/95 border border-[#39ff14]/30 px-2 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 uppercase tracking-wider select-none pointer-events-none">
            ${uName} ${member.activeEmoji || ''}
          </span>
          <!-- Glowing Blinking Circle -->
          <div class="squad-bubble-click w-10 h-10 rounded-full border-2 border-[#39ff14] bg-purple-950/90 flex items-center justify-center text-xs font-mono font-bold text-[#39ff14] shadow-[0_0_10px_#39ff14] animate-pulse cursor-pointer overflow-hidden">
            ${avatarUrl ? `<img src="${avatarUrl}" class="w-full h-full object-cover animate-fade-in" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="fallback-initials" style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${initials}</span>` : initials}
          </div>
        </div>
      `;

      const bubbleBtn = bubbleEl.querySelector('.squad-bubble-click');
      if (bubbleBtn) {
        const handler = (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.openSquadBubbleReactionPicker(uid, bubbleBtn);
        };
        bubbleBtn.addEventListener('click', handler);
        bubbleBtn.addEventListener('touchstart', handler, { passive: false });
      }

      container.appendChild(bubbleEl);
    });
  },

  openSquadBubbleReactionPicker(uid, bubbleBtn) {
    const existing = document.getElementById('reaction-picker-squad');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'reaction-picker-squad';

    const rect = bubbleBtn.getBoundingClientRect();

    picker.style.position = 'fixed';
    picker.style.display = 'flex';
    picker.style.flexDirection = 'row';
    picker.style.alignItems = 'center';
    picker.style.padding = '6px 12px';
    picker.style.backgroundColor = '#120921';
    picker.style.border = '1.5px solid rgba(168, 85, 247, 0.7)';
    picker.style.borderRadius = '9999px';
    picker.style.boxShadow = '0 12px 30px rgba(0,0,0,0.85)';
    picker.style.zIndex = '3100';
    picker.style.right = `${window.innerWidth - rect.left + 10}px`;
    picker.style.top = `${rect.top + (rect.height / 2)}px`;
    picker.style.transform = 'translateY(-50%)';
    picker.style.pointerEvents = 'auto';

    // Inject styles dynamically to hide scrollbar in the mobile webview
    const styleId = 'reaction-picker-squad-scroll-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .reaction-scroll-track::-webkit-scrollbar {
          display: none !important;
        }
        .reaction-scroll-track {
          -ms-overflow-style: none !important;
          scrollbar-width: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    picker.innerHTML = `
      <button class="picker-scroll-btn scroll-left text-purple-400 font-bold px-2 select-none active:scale-75 transition-transform" style="font-size: 20px; background: none; border: none; outline: none; cursor: pointer;">◀</button>
      <div class="reaction-scroll-track flex flex-row items-center gap-[20px] overflow-x-auto" style="max-width: 250px; white-space: nowrap; -webkit-overflow-scrolling: touch; pointer-events: auto;">
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😊" style="cursor:pointer; font-size: 28px;">😊</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🙂" style="cursor:pointer; font-size: 28px;">🙂</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😀" style="cursor:pointer; font-size: 28px;">😀</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😁" style="cursor:pointer; font-size: 28px;">😁</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🥰" style="cursor:pointer; font-size: 28px;">🥰</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="❤️" style="cursor:pointer; font-size: 28px;">❤️</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🔥" style="cursor:pointer; font-size: 28px;">🔥</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😂" style="cursor:pointer; font-size: 28px;">😂</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😍" style="cursor:pointer; font-size: 28px;">😍</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🤩" style="cursor:pointer; font-size: 28px;">🤩</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😜" style="cursor:pointer; font-size: 28px;">😜</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🤪" style="cursor:pointer; font-size: 28px;">🤪</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😎" style="cursor:pointer; font-size: 28px;">😎</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="💀" style="cursor:pointer; font-size: 28px;">💀</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🎉" style="cursor:pointer; font-size: 28px;">🎉</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="💯" style="cursor:pointer; font-size: 28px;">💯</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="👍" style="cursor:pointer; font-size: 28px;">👍</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😮" style="cursor:pointer; font-size: 28px;">😮</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😢" style="cursor:pointer; font-size: 28px;">😢</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="😡" style="cursor:pointer; font-size: 28px;">😡</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="🙌" style="cursor:pointer; font-size: 28px;">🙌</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="✨" style="cursor:pointer; font-size: 28px;">✨</span>
        <span class="cursor-pointer text-xl hover:scale-125 active:scale-95 transition-transform duration-100" data-emoji="👀" style="cursor:pointer; font-size: 28px;">👀</span>
      </div>
      <button class="picker-scroll-btn scroll-right text-purple-400 font-bold px-2 select-none active:scale-75 transition-transform" style="font-size: 20px; background: none; border: none; outline: none; cursor: pointer;">▶</button>
    `;

    document.body.appendChild(picker);

    // Bind scroll button clicks
    const track = picker.querySelector('.reaction-scroll-track');
    picker.querySelector('.scroll-left').addEventListener('click', (e) => {
      e.stopPropagation();
      track.scrollBy({ left: -90, behavior: 'smooth' });
    });
    picker.querySelector('.scroll-right').addEventListener('click', (e) => {
      e.stopPropagation();
      track.scrollBy({ left: 90, behavior: 'smooth' });
    });

    picker.querySelectorAll('span[data-emoji]').forEach(el => {
      const handler = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const emoji = el.getAttribute('data-emoji');
        this.spawnEmojiBurstOnBubble(emoji);
        this.spawnFullScreenSparks(emoji);
        picker.remove();

        // Sync spark alert dynamically over PocketBase
        const sparkId = 'spark_' + Date.now();
        ScrapFirebase.saveElement(ScrapFirebase.roomId, sparkId, {
          type: 'spark',
          emoji: emoji,
          targetElementId: 'center',
          userName: ScrapFirebase.userName || 'Squadmate',
          timestamp: Date.now(),
          date: this.currentDate
        }).then(() => {
          setTimeout(() => {
            ScrapFirebase.deleteElement(ScrapFirebase.roomId, sparkId);
          }, 2000);
        });
      };
      el.addEventListener('click', handler);
      el.addEventListener('touchstart', handler, { passive: false });
    });

    const closeHandler = (e) => {
      if (picker.contains(e.target) || bubbleBtn.contains(e.target)) {
        return;
      }
      picker.remove();
      document.removeEventListener('pointerdown', closeHandler);
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', closeHandler);
    }, 50);
  },

  spawnEmojiBurstOnBubble(emoji, bubbleEl = null) {
    let x, y;
    if (bubbleEl) {
      const rect = bubbleEl.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else {
      x = window.innerWidth / 2;
      y = window.innerHeight / 2;
    }

    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('span');
      particle.className = 'floating-emoji-particle';
      particle.style.position = 'fixed';
      particle.style.zIndex = '3100';
      particle.innerText = emoji;
      particle.style.fontSize = `${Math.floor(Math.random() * 12) + 24}px`;
      particle.style.left = `${x + (Math.random() * 40 - 20)}px`;
      particle.style.top = `${y + (Math.random() * 40 - 20)}px`;

      const driftRot = Math.random() * 50 - 25;
      particle.style.setProperty('--rot-deg', `${driftRot}deg`);
      particle.style.animationDelay = `${Math.random() * 0.2}s`;
      particle.style.animationDuration = `${0.7 + Math.random() * 0.4}s`;

      document.body.appendChild(particle);

      setTimeout(() => {
        particle.remove();
      }, 1500);
    }
  },

  // --- Connection Selection & Drawing Methods ---
  enterConnectionMode(vibe, theme) {
    this.isConnectionSelectionMode = true;
    this.connectionSourceId = null;
    this.connectionTargetId = null;
    this.selectedConnectionVibe = vibe || 'Ride or Die';
    this.selectedConnectionTheme = theme || 'neon';

    // Add highlighting class to show all targets are connectable
    if (this.canvasEl) this.canvasEl.classList.add('connecting-mode-active');

    document.getElementById('connection-mode-helper').classList.remove('hidden');

    const bottomBar = document.getElementById('canvas-bottom-bar');
    if (bottomBar) bottomBar.classList.add('hidden');

    document.querySelectorAll('.active-controls').forEach(el => el.classList.remove('active-controls'));
  },

  exitConnectionMode() {
    this.isConnectionSelectionMode = false;
    this.connectionSourceId = null;
    this.connectionTargetId = null;

    // Remove highlighting class from canvas board
    if (this.canvasEl) this.canvasEl.classList.remove('connecting-mode-active');

    document.getElementById('connection-mode-helper').classList.add('hidden');

    document.querySelectorAll('.connecting-candidate').forEach(el => el.classList.remove('connecting-candidate'));

    const bottomBar = document.getElementById('canvas-bottom-bar');
    if (bottomBar) bottomBar.classList.remove('hidden');
  },

  handleConnectionCandidateSelection(id, domEl) {
    if (!this.connectionSourceId) {
      this.connectionSourceId = id;
      domEl.classList.add('connecting-candidate');

    } else if (this.connectionSourceId === id) {
      domEl.classList.remove('connecting-candidate');
      this.connectionSourceId = null;

    } else {
      this.connectionTargetId = id;
      domEl.classList.add('connecting-candidate');


      // Auto-create connection immediately using pre-selected options
      const fromId = this.connectionSourceId;
      const toId = this.connectionTargetId;
      const connId = 'conn_' + Date.now();

      const connectionData = {
        from: fromId,
        to: toId,
        label: this.selectedConnectionVibe,
        theme: this.selectedConnectionTheme,
        date: this.currentDate
      };


      ScrapFirebase.saveConnection(ScrapFirebase.roomId, connId, connectionData);

      // Auto-exit connection selection mode
      this.exitConnectionMode();
    }
  },

  renderConnections(connectionsMap) {
    if (!this.connectionsSvgEl) return;
    this.connectionsSvgEl.innerHTML = '';
    if (this.connectionLabelsEl) this.connectionLabelsEl.innerHTML = '';

    // Clear all existing hanging/depth style classes first
    document.querySelectorAll('.hanging-canvas').forEach(el => {
      el.classList.remove('hanging-canvas', 'hanging-canvas-front', 'hanging-canvas-back');
    });
    document.querySelectorAll('.heartbeat-throb').forEach(el => {
      el.classList.remove('heartbeat-throb');
    });
    document.querySelectorAll('.balloon-drift').forEach(el => {
      el.classList.remove('balloon-drift');
    });

    const incomingMap = connectionsMap || {};

    // Merge coords for recently edited connections to prevent snapping and blinking
    for (const [connId, conn] of Object.entries(incomingMap)) {
      if (!conn) continue;

      const lastEdit = this.lastConnectionLocalEditTimes[connId] || 0;
      const timeDiff = Date.now() - lastEdit;

      if (timeDiff < 10000 && this.connections[connId]) {
        conn.offsetStartX = this.connections[connId].offsetStartX;
        conn.offsetStartY = this.connections[connId].offsetStartY;
        conn.offsetEndX = this.connections[connId].offsetEndX;
        conn.offsetEndY = this.connections[connId].offsetEndY;
        conn.ctrl1OffsetX = this.connections[connId].ctrl1OffsetX;
        conn.ctrl1OffsetY = this.connections[connId].ctrl1OffsetY;
        conn.ctrl2OffsetX = this.connections[connId].ctrl2OffsetX;
        conn.ctrl2OffsetY = this.connections[connId].ctrl2OffsetY;
      }
    }

    this.connections = incomingMap;

    for (const [connId, conn] of Object.entries(this.connections)) {
      if (!conn || conn.date !== this.currentDate) continue;

      const fromEl = document.getElementById(`item_${conn.from}`);
      const toEl = document.getElementById(`item_${conn.to}`);
      if (!fromEl || !toEl) continue;

      const fromData = this.elements[conn.from];
      const toData = this.elements[conn.to];
      if (!fromData || !toData) continue;

      const w1 = fromEl.clientWidth || 176;
      const h1 = fromEl.clientHeight || 200;
      const x1 = Number(fromData.x) + w1 / 2;
      const y1 = Number(fromData.y) + h1 / 2;

      const w2 = toEl.clientWidth || 176;
      const h2 = toEl.clientHeight || 200;
      const x2 = Number(toData.x) + w2 / 2;
      const y2 = Number(toData.y) + h2 / 2;

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      if (conn.theme === 'streetlight') {
        const wx1 = x1 + (conn.offsetStartX || 0);
        const wy1 = y1 + (conn.offsetStartY || 0);
        const wx2 = x2 + (conn.offsetEndX || 0);
        const wy2 = y2 + (conn.offsetEndY || 0);

        const wmidX = (wx1 + wx2) / 2;
        const wmidY = (wy1 + wy2) / 2;

        const ctrl1X = wmidX + (conn.ctrl1OffsetX !== undefined ? conn.ctrl1OffsetX : -30);
        const ctrl1Y = wmidY + (conn.ctrl1OffsetY !== undefined ? conn.ctrl1OffsetY : 50);
        const ctrl2X = wmidX + (conn.ctrl2OffsetX !== undefined ? conn.ctrl2OffsetX : 30);
        const ctrl2Y = wmidY + (conn.ctrl2OffsetY !== undefined ? conn.ctrl2OffsetY : 50);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${wx1} ${wy1} C ${ctrl1X} ${ctrl1Y} ${ctrl2X} ${ctrl2Y} ${wx2} ${wy2}`);
        path.setAttribute('class', 'connection-streetlight-wire');
        path.setAttribute('id', `conn_${connId}`);
        this.connectionsSvgEl.appendChild(path);

        // Dynamically calculate number of bulbs based on distance
        const dx = wx2 - wx1;
        const dy = wy2 - wy1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const desiredGap = 70;
        const numBulbs = Math.max(1, Math.floor(dist / desiredGap));
        const tVals = [];
        for (let i = 1; i <= numBulbs; i++) {
          tVals.push(i / (numBulbs + 1));
        }

        tVals.forEach(t => {
          const bx = Math.round(
            Math.pow(1 - t, 3) * wx1 +
            3 * Math.pow(1 - t, 2) * t * ctrl1X +
            3 * (1 - t) * Math.pow(t, 2) * ctrl2X +
            Math.pow(t, 3) * wx2
          );
          const by = Math.round(
            Math.pow(1 - t, 3) * wy1 +
            3 * Math.pow(1 - t, 2) * t * ctrl1Y +
            3 * (1 - t) * Math.pow(t, 2) * ctrl2Y +
            Math.pow(t, 3) * wy2
          );

          const bulbGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

          const base = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          base.setAttribute('d', `M ${bx - 3} ${by} L ${bx + 3} ${by} L ${bx + 2.5} ${by + 4.5} L ${bx - 2.5} ${by + 4.5} Z`);
          base.setAttribute('fill', '#5a5566');
          bulbGroup.appendChild(base);

          const glass = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          glass.setAttribute('d', `M ${bx - 2.5} ${by + 4.5} C ${bx - 6.5} ${by + 8.5}, ${bx - 6.5} ${by + 14.5}, ${bx} ${by + 17.5} C ${bx + 6.5} ${by + 14.5}, ${bx + 6.5} ${by + 8.5}, ${bx + 2.5} ${by + 4.5} Z`);
          glass.setAttribute('class', 'streetlight-bulb');
          bulbGroup.appendChild(glass);

          this.connectionsSvgEl.appendChild(bulbGroup);
        });

        // Add physics-based hanging sways to connected polaroids
        const fromContent = fromEl.querySelector('.element-content');
        const toContent = toEl.querySelector('.element-content');
        if (fromContent) fromContent.classList.add('hanging-canvas', 'hanging-canvas-front');
        if (toContent) toContent.classList.add('hanging-canvas', 'hanging-canvas-back');

        // Draw active HTML drag handles when in design mode (Option 2)
        if (this.editingConnectionId === connId && this.connectionLabelsEl) {
          // Add thick invisible touch catcher to let user touch anywhere on the wire to move the closest circle
          const touchPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          touchPath.setAttribute('d', `M ${wx1} ${wy1} C ${ctrl1X} ${ctrl1Y} ${ctrl2X} ${ctrl2Y} ${wx2} ${wy2}`);
          touchPath.setAttribute('stroke', 'transparent');
          touchPath.setAttribute('stroke-width', '40');
          touchPath.setAttribute('fill', 'none');
          touchPath.setAttribute('style', 'cursor: grab; pointer-events: stroke !important;');
          this.connectionsSvgEl.appendChild(touchPath);

          const handles = [
            { type: 'start', x: wx1, y: wy1, color: '#39ff14' },
            { type: 'ctrl1', x: ctrl1X, y: ctrl1Y, color: '#00f0ff' },
            { type: 'ctrl2', x: ctrl2X, y: ctrl2Y, color: '#ff00ab' },
            { type: 'end', x: wx2, y: wy2, color: '#ffcc00' }
          ];

          const activeHandlesDOM = [];

          handles.forEach((hSpec, handleIndex) => {
            const handleEl = document.createElement('div');
            handleEl.className = 'absolute rounded-full border-2 border-white shadow-lg cursor-grab z-50 select-none';
            handleEl.style.width = '48px';
            handleEl.style.height = '48px';
            handleEl.style.backgroundColor = hSpec.color;
            handleEl.style.left = `${hSpec.x}px`;
            handleEl.style.top = `${hSpec.y}px`;
            handleEl.style.transform = 'translate(-50%, -50%)';
            handleEl.style.touchAction = 'none';
            handleEl.style.pointerEvents = 'auto';

            const startDrag = (evt, customStartClientX, customStartClientY) => {
              if (evt) {
                evt.stopPropagation();
                evt.preventDefault();
              }
              this.isPanning = false;
              this.isDraggingWire = true;

              const startTouchX = customStartClientX !== undefined ? customStartClientX : (evt.touches ? evt.touches[0].clientX : evt.clientX);
              const startTouchY = customStartClientY !== undefined ? customStartClientY : (evt.touches ? evt.touches[0].clientY : evt.clientY);

              const initStartX = conn.offsetStartX || 0;
              const initStartY = conn.offsetStartY || 0;
              const initEndX = conn.offsetEndX || 0;
              const initEndY = conn.offsetEndY || 0;
              const initCtrl1X = conn.ctrl1OffsetX !== undefined ? conn.ctrl1OffsetX : -30;
              const initCtrl1Y = conn.ctrl1OffsetY !== undefined ? conn.ctrl1OffsetY : 50;
              const initCtrl2X = conn.ctrl2OffsetX !== undefined ? conn.ctrl2OffsetX : 30;
              const initCtrl2Y = conn.ctrl2OffsetY !== undefined ? conn.ctrl2OffsetY : 50;

              const onDrag = (moveEvt) => {
                moveEvt.stopPropagation();
                moveEvt.preventDefault();

                this.lastConnectionLocalEditTimes[connId] = Date.now();

                const curTouchX = moveEvt.touches ? moveEvt.touches[0].clientX : moveEvt.clientX;
                const curTouchY = moveEvt.touches ? moveEvt.touches[0].clientY : moveEvt.clientY;
                const deltaX = (curTouchX - startTouchX) / this.zoom;
                const deltaY = (curTouchY - startTouchY) / this.zoom;

                if (hSpec.type === 'start') {
                  conn.offsetStartX = Math.round(initStartX + deltaX);
                  conn.offsetStartY = Math.round(initStartY + deltaY);
                } else if (hSpec.type === 'end') {
                  conn.offsetEndX = Math.round(initEndX + deltaX);
                  conn.offsetEndY = Math.round(initEndY + deltaY);
                } else if (hSpec.type === 'ctrl1') {
                  conn.ctrl1OffsetX = Math.round(initCtrl1X + deltaX);
                  conn.ctrl1OffsetY = Math.round(initCtrl1Y + deltaY);
                } else if (hSpec.type === 'ctrl2') {
                  conn.ctrl2OffsetX = Math.round(initCtrl2X + deltaX);
                  conn.ctrl2OffsetY = Math.round(initCtrl2Y + deltaY);
                }

                // Update path and handles position inline without destroying DOM
                const updatedWx1 = x1 + (conn.offsetStartX || 0);
                const updatedWy1 = y1 + (conn.offsetStartY || 0);
                const updatedWx2 = x2 + (conn.offsetEndX || 0);
                const updatedWy2 = y2 + (conn.offsetEndY || 0);
                const updatedWmidX = (updatedWx1 + updatedWx2) / 2;
                const updatedWmidY = (updatedWy1 + updatedWy2) / 2;
                const updatedCtrl1X = updatedWmidX + (conn.ctrl1OffsetX !== undefined ? conn.ctrl1OffsetX : -30);
                const updatedCtrl1Y = updatedWmidY + (conn.ctrl1OffsetY !== undefined ? conn.ctrl1OffsetY : 50);
                const updatedCtrl2X = updatedWmidX + (conn.ctrl2OffsetX !== undefined ? conn.ctrl2OffsetX : 30);
                const updatedCtrl2Y = updatedWmidY + (conn.ctrl2OffsetY !== undefined ? conn.ctrl2OffsetY : 50);

                const wirePath = document.getElementById(`conn_${connId}`);
                if (wirePath) {
                  wirePath.setAttribute('d', `M ${updatedWx1} ${updatedWy1} C ${updatedCtrl1X} ${updatedCtrl1Y} ${updatedCtrl2X} ${updatedCtrl2Y} ${updatedWx2} ${updatedWy2}`);
                  if (touchPath) {
                    touchPath.setAttribute('d', `M ${updatedWx1} ${updatedWy1} C ${updatedCtrl1X} ${updatedCtrl1Y} ${updatedCtrl2X} ${updatedCtrl2Y} ${updatedWx2} ${updatedWy2}`);
                  }
                }

                // Move all handles DOM visually
                activeHandlesDOM.forEach(hDOM => {
                  const finalX = hDOM.type === 'start' ? updatedWx1 :
                    hDOM.type === 'end' ? updatedWx2 :
                      hDOM.type === 'ctrl1' ? updatedCtrl1X : updatedCtrl2X;
                  const finalY = hDOM.type === 'start' ? updatedWy1 :
                    hDOM.type === 'end' ? updatedWy2 :
                      hDOM.type === 'ctrl1' ? updatedCtrl1Y : updatedCtrl2Y;
                  hDOM.el.style.left = `${finalX}px`;
                  hDOM.el.style.top = `${finalY}px`;
                });
              };

              const endDrag = async () => {
                window.removeEventListener('mousemove', onDrag);
                window.removeEventListener('mouseup', endDrag);
                window.removeEventListener('touchmove', onDrag);
                window.removeEventListener('touchend', endDrag);
                this.isDraggingWire = false;

                // Snap-to-element check on dropping Start/End handles
                if (hSpec.type === 'start' || hSpec.type === 'end') {
                  const dropX = hSpec.type === 'start' ? x1 + (conn.offsetStartX || 0) : x2 + (conn.offsetEndX || 0);
                  const dropY = hSpec.type === 'start' ? y1 + (conn.offsetStartY || 0) : y2 + (conn.offsetEndY || 0);

                  let snappedElementId = null;
                  for (const [elId, elData] of Object.entries(this.elements)) {
                    if (!elData) continue;
                    // Prevent linking an element to itself
                    if (hSpec.type === 'start' && elId === conn.to) continue;
                    if (hSpec.type === 'end' && elId === conn.from) continue;

                    const scale = elData.scale || 1.0;
                    const w = (elData.type === 'photo' ? 192 : 100) * scale;
                    const h = (elData.type === 'photo' ? 216 : 100) * scale;

                    if (dropX >= elData.x && dropX <= elData.x + w && dropY >= elData.y && dropY <= elData.y + h) {
                      snappedElementId = elId;
                      break;
                    }
                  }

                  if (snappedElementId) {
                    if (hSpec.type === 'start') {
                      conn.from = snappedElementId;
                      conn.offsetStartX = 0;
                      conn.offsetStartY = 0;
                    } else {
                      conn.to = snappedElementId;
                      conn.offsetEndX = 0;
                      conn.offsetEndY = 0;
                    }
                  }
                }

                // Save updated coordinates to Firebase database
                const activeRoomId = (window.ScrapApp && window.ScrapApp.currentRoomId) || ScrapFirebase.roomId;
                if (activeRoomId) {
                  try {
                    await ScrapFirebase.saveConnection(activeRoomId, connId, conn);
                  } finally {
                    this.lastConnectionLocalEditTimes[connId] = Date.now();
                  }
                }

                this.renderConnections(this.connections);
              };

              window.addEventListener('mousemove', onDrag, { passive: false });
              window.addEventListener('mouseup', endDrag);
              window.addEventListener('touchmove', onDrag, { passive: false });
              window.addEventListener('touchend', endDrag);
            };

            handleEl.addEventListener('mousedown', startDrag);
            handleEl.addEventListener('touchstart', startDrag, { passive: false });

            this.connectionLabelsEl.appendChild(handleEl);
            activeHandlesDOM.push({ type: hSpec.type, el: handleEl, startDragFunc: startDrag });
          });

          // Tap on wire snap-closest-handle-to-finger behavior
          const onTouchWire = (evt) => {
            evt.stopPropagation();
            evt.preventDefault();
            this.isPanning = false;

            const clientTouchX = evt.touches ? evt.touches[0].clientX : evt.clientX;
            const clientTouchY = evt.touches ? evt.touches[0].clientY : evt.clientY;

            // Convert client coordinates to unscaled board coordinates
            const rect = this.workspaceEl.getBoundingClientRect();
            const boardMarginVal = 3000;
            const touchX = Math.round((clientTouchX - rect.left + this.workspaceEl.scrollLeft - boardMarginVal) / this.zoom);
            const touchY = Math.round((clientTouchY - rect.top + this.workspaceEl.scrollTop - boardMarginVal) / this.zoom);

            // Find closest handle index to touch point
            const points = [
              { type: 'start', x: wx1, y: wy1 },
              { type: 'ctrl1', x: ctrl1X, y: ctrl1Y },
              { type: 'ctrl2', x: ctrl2X, y: ctrl2Y },
              { type: 'end', x: wx2, y: wy2 }
            ];

            let closestIdx = 0;
            let minDistance = Infinity;
            points.forEach((pt, idx) => {
              const d = Math.hypot(touchX - pt.x, touchY - pt.y);
              if (d < minDistance) {
                minDistance = d;
                closestIdx = idx;
              }
            });

            const targetHandle = points[closestIdx];

            // Instantly snap that handle to the touch position
            if (targetHandle.type === 'start') {
              conn.offsetStartX = touchX - x1;
              conn.offsetStartY = touchY - y1;
            } else if (targetHandle.type === 'end') {
              conn.offsetEndX = touchX - x2;
              conn.offsetEndY = touchY - y2;
            } else if (targetHandle.type === 'ctrl1') {
              const currentMidX = (x1 + (conn.offsetStartX || 0) + x2 + (conn.offsetEndX || 0)) / 2;
              const currentMidY = (y1 + (conn.offsetStartY || 0) + y2 + (conn.offsetEndY || 0)) / 2;
              conn.ctrl1OffsetX = touchX - currentMidX;
              conn.ctrl1OffsetY = touchY - currentMidY;
            } else if (targetHandle.type === 'ctrl2') {
              const currentMidX = (x1 + (conn.offsetStartX || 0) + x2 + (conn.offsetEndX || 0)) / 2;
              const currentMidY = (y1 + (conn.offsetStartY || 0) + y2 + (conn.offsetEndY || 0)) / 2;
              conn.ctrl2OffsetX = touchX - currentMidX;
              conn.ctrl2OffsetY = touchY - currentMidY;
            }

            // Move handle visually
            const hDOM = activeHandlesDOM.find(h => h.type === targetHandle.type);
            if (hDOM) {
              hDOM.el.style.left = `${touchX}px`;
              hDOM.el.style.top = `${touchY}px`;

              // Trigger drag start sequence immediately on the snapped handle!
              hDOM.startDragFunc(null, clientTouchX, clientTouchY);
            }
          };

          touchPath.addEventListener('mousedown', onTouchWire);
          touchPath.addEventListener('touchstart', onTouchWire, { passive: false });
        }

      } else if (conn.theme === 'heartbeat') {
        // Draw heartbeat EKG pulse line between points
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;

        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;

        const pt1 = { x: x1 + dx * 0.4, y: y1 + dy * 0.4 };
        const pt2 = { x: x1 + dx * 0.44, y: y1 + dy * 0.44 };
        const pt3 = { x: x1 + dx * 0.48, y: y1 + dy * 0.48 };
        const pt4 = { x: x1 + dx * 0.52, y: y1 + dy * 0.52 };
        const pt5 = { x: x1 + dx * 0.56, y: y1 + dy * 0.56 };
        const pt6 = { x: x1 + dx * 0.6, y: y1 + dy * 0.6 };

        const ekgPath = `M ${x1} ${y1} ` +
          `L ${pt1.x} ${pt1.y} ` +
          `L ${pt2.x - px * 8} ${pt2.y - py * 8} ` +
          `L ${pt3.x + px * 28} ${pt3.y + py * 28} ` +
          `L ${pt4.x - px * 32} ${pt4.y - py * 32} ` +
          `L ${pt5.x + px * 12} ${pt5.y + py * 12} ` +
          `L ${pt6.x} ${pt6.y} ` +
          `L ${x2} ${y2}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ekgPath);
        path.setAttribute('class', 'connection-heartbeat-line');
        path.setAttribute('id', `conn_${connId}`);
        this.connectionsSvgEl.appendChild(path);

        const fromContent = fromEl.querySelector('.element-content');
        const toContent = toEl.querySelector('.element-content');
        if (fromContent) fromContent.classList.add('heartbeat-throb');
        if (toContent) toContent.classList.add('heartbeat-throb');

      } else if (conn.theme === 'balloons') {
        // Draw vertical sagging wire (float upward sag)
        const sag = -45;
        const controlY = midY + sag;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} Q ${midX} ${controlY} ${x2} ${y2}`);
        path.setAttribute('class', 'connection-balloons-wire');
        path.setAttribute('id', `conn_${connId}`);
        this.connectionsSvgEl.appendChild(path);

        // Place 3 drifting balloon emoji groups
        const tVals = [0.3, 0.5, 0.7];
        tVals.forEach(t => {
          const bx = Math.round(Math.pow(1 - t, 2) * x1 + 2 * (1 - t) * t * midX + Math.pow(t, 2) * x2);
          const by = Math.round(Math.pow(1 - t, 2) * y1 + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * y2);

          const balloonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          balloonGroup.setAttribute('transform', `translate(${bx}, ${by})`);
          balloonGroup.setAttribute('class', 'drifting-balloon');

          const stringPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          stringPath.setAttribute('d', 'M 0 3 Q -6 18 4 34 T -2 50 T 0 64');
          stringPath.setAttribute('stroke', '#ffffff');
          stringPath.setAttribute('stroke-width', '1');
          stringPath.setAttribute('stroke-opacity', '0.75');
          stringPath.setAttribute('fill', 'none');
          stringPath.setAttribute('class', 'balloon-string-line');
          balloonGroup.appendChild(stringPath);

          const balloonText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          balloonText.setAttribute('x', '0');
          balloonText.setAttribute('y', '2');
          balloonText.setAttribute('text-anchor', 'middle');
          balloonText.setAttribute('font-size', '18');
          balloonText.textContent = '🎈';
          balloonGroup.appendChild(balloonText);

          this.connectionsSvgEl.appendChild(balloonGroup);
        });

        const fromContent = fromEl.querySelector('.element-content');
        const toContent = toEl.querySelector('.element-content');
        if (fromContent) fromContent.classList.add('balloon-drift');
        if (toContent) toContent.classList.add('balloon-drift');

      } else {
        // Render standard straight Family Tree connection lines (Neon Laser / Red Yarn)
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('id', `conn_${connId}`);

        const themeClass = conn.theme === 'yarn' ? 'connection-yarn-line' :
          conn.theme === 'spark' ? 'connection-spark-line' :
            conn.theme === 'chain' ? 'connection-chain-line' :
              conn.theme === 'rainbow' ? 'connection-rainbow-line' :
                'connection-neon-line';
        line.setAttribute('class', themeClass);
        this.connectionsSvgEl.appendChild(line);
      }

      // Unified relationship label rendering for all themes (makes them fully editable/deletable)
      if (this.connectionLabelsEl) {
        let lx = midX;
        let ly = midY;

        if (conn.theme === 'streetlight') {
          const wy1 = y1 + (conn.offsetStartY || 0);
          const wy2 = y2 + (conn.offsetEndY || 0);
          const wmidY = (wy1 + wy2) / 2;
          const ctrl1Y = wmidY + (conn.ctrl1OffsetY !== undefined ? conn.ctrl1OffsetY : 50);
          const ctrl2Y = wmidY + (conn.ctrl2OffsetY !== undefined ? conn.ctrl2OffsetY : 50);
          const wireMidY = (ctrl1Y + ctrl2Y) / 2;
          ly = Math.round(wireMidY) + 64; // Safely place below the active wire bend and handles
        } else if (conn.theme === 'balloons') {
          const controlY = midY - 45; // sag is -45
          ly = Math.round(0.25 * y1 + 0.5 * controlY + 0.25 * y2) - 24;
        }

        const labelEl = document.createElement('div');
        labelEl.id = `label_${connId}`;

        // Select background styling based on theme
        const bgCol = conn.theme === 'heartbeat' ? 'bg-[#ff003c]/95 border-[#ff3b30] text-white' :
          conn.theme === 'balloons' ? 'bg-[#00f0ff]/95 border-[#00ffff] text-black' :
            conn.theme === 'streetlight' ? 'bg-[#ff9900]/95 border-[#ffd700] text-white' :
              'bg-[#120921]/95 border border-[#ff00ab]/50 text-white';

        labelEl.className = `absolute pointer-events-auto ${bgCol} border rounded-full px-2.5 py-0.5 text-[6px] font-bold uppercase tracking-wider cursor-pointer shadow-2xl select-none font-space`;
        labelEl.style.left = `${lx}px`;
        labelEl.style.top = `${ly}px`;
        labelEl.style.transform = 'translate(-50%, -50%)';
        labelEl.innerText = conn.label || conn.theme.toUpperCase();

        const handleLabelTap = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (this.editingConnectionId) return; // Prevent modal popup while designing wire
          window.dispatchEvent(new CustomEvent('show_manage_connection', {
            detail: { id: connId, conn }
          }));
        };

        labelEl.addEventListener('click', handleLabelTap);
        labelEl.addEventListener('touchend', handleLabelTap);
        this.connectionLabelsEl.appendChild(labelEl);
      }
    }
  },

  // ==============================================
  // COLLAGE FLOW TIME FILTER ENGINE
  // ==============================================
  currentCollageFilter: 'all',

  initCollageFlowToolbar() {
    const bar = document.getElementById('collage-flow-filter-bar');
    if (!bar) return;

    this.initStoryReelEvents();

    // Filter Chips
    const chips = bar.querySelectorAll('.collage-flow-chip');
    chips.forEach(chip => {
      const selectFilter = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const yearSelect = document.getElementById('collage-flow-year-select');
        if (yearSelect) yearSelect.value = '';
        this.setCollageFlowFilter(chip.dataset.filter);
      };

      chip.addEventListener('click', selectFilter);
      chip.addEventListener('touchend', (e) => {
        // Only trigger if user tapped (didn't drag the bar)
        if (!bar.dataset.wasDragging) {
          selectFilter(e);
        }
      });
    });

    // Year Dropdown
    const yearSelect = document.getElementById('collage-flow-year-select');
    if (yearSelect) {
      this.populateCollageFlowYears(yearSelect);
      yearSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          chips.forEach(c => c.classList.remove('active'));
          this.setCollageFlowFilter('year:' + val);
        } else {
          chips[0]?.click();
        }
      });
    }

    // Touch / Mouse Dragging anywhere on toolbar
    if (bar) {
      let isDragging = false;
      let hasMoved = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
      let rafId = null;
      let currentDx = 0, currentDy = 0;

      const updatePosition = () => {
        if (!isDragging) return;
        const newLeft = Math.max(8, Math.min(window.innerWidth - 80, initialLeft + currentDx));
        const newTop = Math.max(8, Math.min(window.innerHeight - 60, initialTop + currentDy));
        bar.style.left = `${newLeft}px`;
        bar.style.top = `${newTop}px`;
        rafId = null;
      };

      const onStart = (e) => {
        // If user tapped a button or select dropdown, don't drag
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;

        const touch = e.touches ? e.touches[0] : e;
        if (!touch) return;
        isDragging = true;
        hasMoved = false;
        bar.dataset.wasDragging = '';
        startX = touch.clientX;
        startY = touch.clientY;
        const rect = bar.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        bar.style.transition = 'none';
        bar.style.willChange = 'left, top';
      };

      const onMove = (e) => {
        if (!isDragging) return;
        const touch = e.touches ? e.touches[0] : e;
        if (!touch) return;
        currentDx = touch.clientX - startX;
        currentDy = touch.clientY - startY;

        if (Math.abs(currentDx) > 5 || Math.abs(currentDy) > 5) {
          hasMoved = true;
          bar.dataset.wasDragging = 'true';
          if (!rafId) {
            rafId = requestAnimationFrame(updatePosition);
          }
          if (e.cancelable) e.preventDefault();
        }
      };

      const onEnd = () => {
        if (isDragging) {
          isDragging = false;
          bar.style.willChange = 'auto';
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          setTimeout(() => {
            bar.dataset.wasDragging = '';
          }, 100);
        }
      };

      bar.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove, { passive: false });
      window.addEventListener('mouseup', onEnd);

      bar.addEventListener('touchstart', onStart, { passive: true });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onEnd);
    }
  },

  populateCollageFlowYears(selectEl) {
    const years = new Set();
    const currentYear = new Date().getFullYear();
    years.add(currentYear);

    Object.values(this.elements || {}).forEach(item => {
      const dateStr = item.date || item.createdAt;
      if (dateStr) {
        const yr = new Date(dateStr).getFullYear();
        if (!isNaN(yr)) years.add(yr);
      }
    });

    const sortedYears = Array.from(years).sort((a, b) => b - a);
    selectEl.innerHTML = '<option value="">Year...</option>' +
      sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  },

  parseLocalDate(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'number') return new Date(dateStr);
    const parts = String(dateStr).split('T')[0].split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(dateStr);
  },

  applyCollageFlowFilterSingle(domEl, itemData) {
    if (!domEl) return;
    const filterType = this.currentCollageFilter || 'all';
    if (filterType === 'all') {
      domEl.classList.remove('element-filtered-dimmed');
      domEl.classList.add('element-filtered-active');
      return;
    }
    if (filterType === 'none' || !itemData) {
      domEl.classList.remove('element-filtered-active');
      domEl.classList.add('element-filtered-dimmed');
      return;
    }

    // Build real calendar today string in local time
    const localNow = new Date();
    const todayYear = localNow.getFullYear();
    const todayMonth = String(localNow.getMonth() + 1).padStart(2, '0');
    const todayDay = String(localNow.getDate()).padStart(2, '0');
    const calendarTodayStr = `${todayYear}-${todayMonth}-${todayDay}`;

    // "currentDate" is the board date the user is browsing (date picker value)
    const boardDate = this.currentDate || calendarTodayStr;

    // Resolve item's date string
    const fallbackDateStr = itemData.createdAt
      ? new Date(itemData.createdAt).toLocaleDateString('en-CA')
      : boardDate;
    const itemDateStr = itemData.date || fallbackDateStr;

    // For time-range filters, measure days from the actual calendar today (not board date)
    const itemDate = this.parseLocalDate(itemDateStr) || localNow;
    const calToday = this.parseLocalDate(calendarTodayStr);
    const diffDays = (calToday.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);

    let isMatch = false;

    if (filterType === 'today') {
      // STRICT: only show photos from today's actual calendar date
      isMatch = (itemDateStr === calendarTodayStr);
    } else if (filterType === 'last2days') {
      // Today + yesterday: diffDays is 0 (today), 1 (yesterday)
      isMatch = (diffDays >= 0 && diffDays < 2);
    } else if (filterType === 'last7days') {
      // Last 7 days: diffDays 0-6
      isMatch = (diffDays >= 0 && diffDays < 7);
    } else if (filterType === 'last2weeks') {
      // Rolling two weeks: today plus the previous 13 calendar days.
      isMatch = (diffDays >= 0 && diffDays < 14);
    } else if (filterType.startsWith('year:')) {
      const targetYear = parseInt(filterType.split(':')[1], 10);
      isMatch = (itemDate.getFullYear() === targetYear);
    } else if (filterType.startsWith('date:')) {
      isMatch = itemDateStr === filterType.slice(5);
    }

    if (isMatch) {
      domEl.classList.remove('element-filtered-dimmed');
      domEl.classList.add('element-filtered-active');
    } else {
      domEl.classList.remove('element-filtered-active');
      domEl.classList.add('element-filtered-dimmed');
    }
  },

  setCollageFlowFilter(filterType) {
    this.currentCollageFilter = filterType;

    // Use ALL elements from ScrapFirebase (all dates) for collage mode,
    // so chips like "Today", "Last 2 Days", "7 Days" show photos across dates.
    const allElements = (window.ScrapFirebase && window.ScrapFirebase.elements && Object.keys(window.ScrapFirebase.elements).length > 0)
      ? window.ScrapFirebase.elements
      : this.elements;

    console.log('[CollageFlow] setCollageFlowFilter:', filterType, 'elementCount:', allElements ? Object.keys(allElements).length : 0);

    const filteredPhotos = this.getCollageFlowPhotos(allElements, filterType);
    this.storyReelItems = filteredPhotos;

    if (filterType !== 'none' && filterType !== 'all') {
      this.openStoryReel(filteredPhotos);
    }
  },

  getCollageFlowPhotos(allElements, filterType) {
    const localNow = new Date();
    const calendarTodayStr = [
      localNow.getFullYear(),
      String(localNow.getMonth() + 1).padStart(2, '0'),
      String(localNow.getDate()).padStart(2, '0')
    ].join('-');

    return Object.entries(allElements || {})
      .filter(([, item]) => item && item.type === 'photo')
      .filter(([, item]) => {
        const itemDateStr = item.date || (item.createdAt
          ? new Date(item.createdAt).toLocaleDateString('en-CA')
          : calendarTodayStr);
        const itemDate = this.parseLocalDate(itemDateStr) || localNow;
        const diffDays = (this.parseLocalDate(calendarTodayStr).getTime() - itemDate.getTime()) /
          (1000 * 60 * 60 * 24);

        if (filterType === 'today') return itemDateStr === calendarTodayStr;
        if (filterType === 'last2days') return diffDays >= 0 && diffDays < 2;
        if (filterType === 'last7days') return diffDays >= 0 && diffDays < 7;
        if (filterType === 'last2weeks') return diffDays >= 0 && diffDays < 14;
        if (filterType.startsWith('year:')) {
          return itemDate.getFullYear() === parseInt(filterType.slice(5), 10);
        }
        if (filterType.startsWith('date:')) return itemDateStr === filterType.slice(5);
        return false;
      })
      .map(([id, item]) => ({ id, ...item }));
  },

  updateDatePickerVisibility() {
    const datePickerContainer = document.getElementById('canvas-date-picker-container');
    const collageFlowBar = document.getElementById('collage-flow-filter-bar');
    const bottomBar = document.getElementById('canvas-bottom-bar');
    const workspace = document.getElementById('canvas-workspace');

    if (!datePickerContainer) return;

    const isCollageFlowActive = collageFlowBar && !collageFlowBar.classList.contains('hidden');

    if (isCollageFlowActive) {
      document.body.classList.add('collage-flow-mode-active');
      datePickerContainer.classList.add('hidden');
      if (workspace) {
        workspace.style.display = 'none';
        workspace.style.pointerEvents = 'none';
      }
      if (bottomBar) bottomBar.classList.add('hidden');
      const existing = document.getElementById('canvas-empty-date-info-banner');
      const existingSvg = document.getElementById('canvas-empty-date-arrow-svg');
      if (existing) existing.remove();
      if (existingSvg) existingSvg.remove();
    } else {
      document.body.classList.remove('collage-flow-mode-active');
      datePickerContainer.classList.remove('hidden');
      if (workspace) {
        workspace.style.display = '';
        workspace.style.pointerEvents = '';
      }
      if (bottomBar) bottomBar.classList.remove('hidden');
      this.closeStoryReel();
    }
  },

  resetCollageFlowToolbar() {
    this.closeStoryReel();
    document.body.classList.remove('collage-flow-mode-active');
    const bar = document.getElementById('collage-flow-filter-bar');
    if (bar) {
      bar.classList.add('hidden');
      bar.style.left = '';
      bar.style.top = '';
      bar.style.willChange = 'auto';
      const todayChip = bar.querySelector('.collage-flow-chip[data-filter="today"]');
      if (todayChip) {
        const chips = bar.querySelectorAll('.collage-flow-chip');
        chips.forEach(c => c.classList.remove('active'));
        todayChip.classList.add('active');
      }
      const yearSelect = document.getElementById('collage-flow-year-select');
      if (yearSelect) yearSelect.value = '';
    }
    this.currentCollageFilter = 'all';
    this.setCollageFlowFilter('all');
    this.updateDatePickerVisibility();
  },

  // ==============================================
  // STORY REEL SLIDESHOW & WEB AUDIO SYNTHESIZER
  // ==============================================
  storyReelItems: [],
  storyReelIndex: 0,
  storyReelTimer: null,
  storyReelIsPaused: false,
  storyReelLoadToken: 0,
  storyReelEventsInitialized: false,
  audioCtx: null,
  bgMusicOscillators: [],
  bgMusicIsMuted: true,

  initStoryReelEvents() {
    if (this.storyReelEventsInitialized) return;
    this.storyReelEventsInitialized = true;

    const btnReel = document.getElementById('btn-collage-story-reel');
    if (btnReel) {
      btnReel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStoryReel();
      });
    }

    const btnClose = document.getElementById('btn-close-story-reel');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.closeStoryReel());
    }

    const btnPause = document.getElementById('btn-story-reel-pause');
    if (btnPause) {
      let lastTapTime = 0;
      const handlePauseTap = (e) => {
        const now = Date.now();
        if (now - lastTapTime < 300) return;
        lastTapTime = now;
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.toggleStoryReelPause();
      };
      btnPause.addEventListener('click', handlePauseTap);
      btnPause.addEventListener('touchstart', handlePauseTap, { passive: false });
    }

    const btnNext = document.getElementById('btn-story-reel-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => this.nextStoryReelSlide());
    }

    const tapPrev = document.getElementById('story-reel-tap-prev');
    if (tapPrev) {
      tapPrev.addEventListener('click', () => this.prevStoryReelSlide());
    }

    const tapNext = document.getElementById('story-reel-tap-next');
    if (tapNext) {
      tapNext.addEventListener('click', () => this.nextStoryReelSlide());
    }

    const btnMusic = document.getElementById('btn-story-music-toggle');
    if (btnMusic) {
      btnMusic.addEventListener('click', () => this.toggleStoryReelMusic());
    }
  },

  getActiveCollageElements() {
    const allElements = (window.ScrapFirebase && window.ScrapFirebase.elements && Object.keys(window.ScrapFirebase.elements).length > 0)
      ? window.ScrapFirebase.elements
      : (this.elements || {});

    // First try DOM elements with element-filtered-active
    const activeDomEls = Array.from(document.querySelectorAll('.element-filtered-active[id^="item_"]'));
    let items = [];

    activeDomEls.forEach(el => {
      const id = el.id.replace('item_', '');
      const data = allElements && allElements[id];
      if (data) {
        items.push({ id, ...data });
      }
    });

    // Fallback: If DOM elements haven't rendered or active class was pending, test allElements directly
    if (items.length === 0 && this.currentCollageFilter && this.currentCollageFilter !== 'none') {
      const localNow = new Date();
      const todayYear = localNow.getFullYear();
      const todayMonth = String(localNow.getMonth() + 1).padStart(2, '0');
      const todayDay = String(localNow.getDate()).padStart(2, '0');
      const calendarTodayStr = `${todayYear}-${todayMonth}-${todayDay}`;

      Object.keys(allElements).forEach(id => {
        const itemData = allElements[id];
        if (!itemData) return;
        const itemDateStr = itemData.date || (itemData.createdAt ? new Date(itemData.createdAt).toLocaleDateString('en-CA') : calendarTodayStr);
        const itemDate = this.parseLocalDate(itemDateStr) || localNow;
        const calToday = this.parseLocalDate(calendarTodayStr);
        const diffDays = (calToday.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);

        let isMatch = false;
        const filterType = this.currentCollageFilter;

        if (filterType === 'all') isMatch = true;
        else if (filterType === 'today') isMatch = (itemDateStr === calendarTodayStr);
        else if (filterType === 'last2days') isMatch = (diffDays >= 0 && diffDays < 2);
        else if (filterType === 'last7days') isMatch = (diffDays >= 0 && diffDays < 7);
        else if (filterType.startsWith('year:')) isMatch = (itemDate.getFullYear() === parseInt(filterType.split(':')[1], 10));
        else if (filterType.startsWith('date:')) isMatch = itemDateStr === filterType.slice(5);

        if (isMatch) {
          items.push({ id, ...itemData });
        }
      });
    }

    return items.filter(item => item.type === 'photo');
  },

  openStoryReel(items = null) {
    items = items || this.getActiveCollageElements();
    if (!items || items.length === 0) {
      if (window.ScrapApp && typeof window.ScrapApp.showToast === 'function') {
        window.ScrapApp.showToast('No photos found in current filter!');
      }
      return;
    }

    this.storyReelItems = items;
    this.storyReelIndex = 0;
    this.storyReelIsPaused = false;
    this.bgMusicIsMuted = true;
    const musicIcon = document.getElementById('story-music-icon');
    if (musicIcon) musicIcon.textContent = '🔇';

    const btnPause = document.getElementById('btn-story-reel-pause');
    if (btnPause) {
      btnPause.textContent = '⏸ Pause';
    }

    this.storyReelLoadToken++;

    const modal = document.getElementById('story-reel-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.body.classList.add('story-reel-active');
    }

    this.buildStoryReelBars();
    this.renderStoryReelSlide(0);
    this.startStoryReelTimer();
    this.stopBackgroundMusic();
  },

  closeStoryReel() {
    const modal = document.getElementById('story-reel-modal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('story-reel-active');
    this.storyReelLoadToken++;

    // Instantly release photo base64 image data from RAM
    const imgEl = document.getElementById('story-reel-img');
    if (imgEl) {
      imgEl.src = '';
      imgEl.removeAttribute('src');
    }
    this.storyReelItems = [];

    if (this.storyReelTimer) {
      clearInterval(this.storyReelTimer);
      this.storyReelTimer = null;
    }
    this.stopBackgroundMusic();
  },

  buildStoryReelBars() {
    const container = document.getElementById('story-reel-progress-container');
    if (!container) return;
    container.innerHTML = '';

    const total = this.storyReelItems.length;
    for (let i = 0; i < total; i++) {
      const barBg = document.createElement('div');
      barBg.className = 'flex-1 bg-white/20 rounded-full overflow-hidden h-full';

      const barFill = document.createElement('div');
      barFill.className = 'h-full bg-white transition-all duration-100 ease-linear story-bar-fill';
      barFill.id = `story-bar-fill-${i}`;
      barFill.style.width = '0%';

      barBg.appendChild(barFill);
      container.appendChild(barBg);
    }

    const totalEl = document.getElementById('story-reel-total-count');
    if (totalEl) totalEl.textContent = total;
  },

  renderStoryReelSlide(index) {
    if (!this.storyReelItems || this.storyReelItems.length === 0) return;
    if (index < 0 || index >= this.storyReelItems.length) return;

    this.storyReelIndex = index;
    const item = this.storyReelItems[index];

    const imgEl = document.getElementById('story-reel-img');
    if (imgEl) {
      imgEl.removeAttribute('src');
      imgEl.alt = 'Loading photo';
    }
    this.loadStoryReelPhoto(item);

    const attachmentsEl = document.getElementById('story-reel-attachments');
    if (attachmentsEl) {
      attachmentsEl.innerHTML = '';
      Object.values(item.stickers || {}).forEach(sticker => {
        const attachment = document.createElement('div');
        attachment.className = 'absolute pointer-events-none select-none';
        attachment.style.left = `${50 + ((sticker.x || 0) / 1.92)}%`;
        attachment.style.top = `${50 + ((sticker.y || 0) / 2.16)}%`;
        attachment.style.transform = `translate(-50%, -50%) rotate(${sticker.rotation || 0}deg) scale(${sticker.scale || 1})`;

        if (sticker.type === 'sticker' && sticker.src) {
          const image = document.createElement('img');
          image.src = sticker.src;
          image.alt = '';
          image.draggable = false;
          image.style.width = `${(sticker.width || 80) / 1.92}vw`;
          image.style.height = `${(sticker.height || 80) / 2.16}vh`;
          image.className = 'object-contain';
          attachment.appendChild(image);
        } else if (sticker.type === 'doodle' && sticker.strokes) {
          const drawing = document.createElement('canvas');
          drawing.width = sticker.width || 192;
          drawing.height = sticker.height || 192;
          drawing.style.width = `${(sticker.width || 192) / 1.92}vw`;
          drawing.style.height = `${(sticker.height || 192) / 2.16}vh`;
          this.drawDoodleOnElementCanvas(drawing, sticker);
          attachment.appendChild(drawing);
        } else if (sticker.text) {
          attachment.textContent = sticker.text;
          attachment.style.fontSize = '32px';
          attachment.style.whiteSpace = 'nowrap';
        }
        attachmentsEl.appendChild(attachment);
      });
    }

    // Update Author & Date
    const authorEl = document.getElementById('story-reel-author');
    if (authorEl) {
      authorEl.textContent = item.author || item.userName || 'Memory Story';
    }

    const dateEl = document.getElementById('story-reel-date');
    if (dateEl) {
      dateEl.textContent = item.date || item.createdAt || 'Scrap Memory';
    }

    // Update Caption
    const captionContainer = document.getElementById('story-reel-caption-container');
    if (captionContainer) captionContainer.classList.add('hidden');

    // Update Progress Bars
    for (let i = 0; i < this.storyReelItems.length; i++) {
      const barFill = document.getElementById(`story-bar-fill-${i}`);
      if (barFill) {
        if (i < index) {
          barFill.style.width = '100%';
        } else if (i === index) {
          barFill.style.width = '0%';
        } else {
          barFill.style.width = '0%';
        }
      }
    }

    const currentIdxEl = document.getElementById('story-reel-current-idx');
    if (currentIdxEl) currentIdxEl.textContent = index + 1;
  },

  async loadStoryReelPhoto(item) {
    const loadToken = ++this.storyReelLoadToken;
    const imgEl = document.getElementById('story-reel-img');
    if (!imgEl || !item) return;

    try {
      const encryptedData = item.encryptedData || item.fileId;
      if (!encryptedData) throw new Error('Photo data is unavailable.');

      const roomId = (window.ScrapApp && window.ScrapApp.currentRoomId) || ScrapFirebase.roomId;
      const diskCacheName = `collage_photo_${roomId || 'room'}_${item.id}.enc`;
      let encryptedBuffer;
      const cachedBuffer = await ScrapDrive.readLocalCacheFile(diskCacheName);
      if (cachedBuffer) {
        encryptedBuffer = cachedBuffer;
      } else if (item.fileId && !item.encryptedData) {
        encryptedBuffer = await ScrapDrive.downloadFile(item.fileId);
        await ScrapDrive.writeLocalCacheFile(diskCacheName, encryptedBuffer);
      } else {
        encryptedBuffer = ScrapCrypto.base64ToArrayBuffer(encryptedData);
        await ScrapDrive.writeLocalCacheFile(diskCacheName, encryptedBuffer);
      }

      const roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
      if (!roomKey) throw new Error('Room key unavailable.');

      const decrypted = await ScrapCrypto.decryptData(encryptedBuffer, roomKey);
      if (loadToken !== this.storyReelLoadToken ||
        this.storyReelItems[this.storyReelIndex] !== item) return;

      imgEl.src = `data:image/jpeg;base64,${ScrapCrypto.arrayBufferToBase64(decrypted)}`;
      imgEl.alt = 'Memory photo';
    } catch (error) {
      if (loadToken === this.storyReelLoadToken) {
        imgEl.alt = 'Unable to load photo';
        console.warn('[StoryReel] Photo load failed:', error);
      }
    }
  },

  startStoryReelTimer() {
    if (this.storyReelTimer) clearInterval(this.storyReelTimer);

    let progress = 0;
    const stepDurationMs = 50;
    const totalSlideMs = 4000;
    const increment = (stepDurationMs / totalSlideMs) * 100;

    this.storyReelTimer = setInterval(() => {
      if (this.storyReelIsPaused) return;

      progress += increment;
      const barFill = document.getElementById(`story-bar-fill-${this.storyReelIndex}`);
      if (barFill) {
        barFill.style.width = `${Math.min(100, progress)}%`;
      }

      if (progress >= 100) {
        progress = 0;
        if (this.storyReelIndex < this.storyReelItems.length - 1) {
          this.renderStoryReelSlide(this.storyReelIndex + 1);
        } else {
          // Photos display completed -> Stop slideshow & stop music
          this.closeStoryReel();
        }
      }
    }, stepDurationMs);
  },

  toggleStoryReelPause() {
    this.storyReelIsPaused = !this.storyReelIsPaused;
    const btnPause = document.getElementById('btn-story-reel-pause');
    if (btnPause) {
      btnPause.textContent = this.storyReelIsPaused ? '▶ Resume' : '⏸ Pause';
    }
  },

  nextStoryReelSlide() {
    if (this.storyReelIndex < this.storyReelItems.length - 1) {
      this.renderStoryReelSlide(this.storyReelIndex + 1);
      this.startStoryReelTimer();
    } else {
      this.closeStoryReel();
    }
  },

  prevStoryReelSlide() {
    if (this.storyReelIndex > 0) {
      this.renderStoryReelSlide(this.storyReelIndex - 1);
      this.startStoryReelTimer();
    } else {
      this.renderStoryReelSlide(0);
      this.startStoryReelTimer();
    }
  },

  // Synthesize rich ambient melody music using Web Audio API (LOUDER VOLUME & CLEAR HARMONICS)
  startBackgroundMusic() {
    if (this.bgMusicIsMuted) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      this.stopBackgroundMusic();

      const masterGain = this.audioCtx.createGain();
      masterGain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      masterGain.connect(this.audioCtx.destination);

      // Slow, single-note memory melody instead of a repeating chord beat.
      const memoryMelody = [392.00, 440.00, 493.88, 440.00, 392.00, 329.63, 349.23, 392.00];
      let melodyIndex = 0;
      const playMemoryNote = () => {
        if (!this.audioCtx || this.bgMusicIsMuted) return;

        this.bgMusicOscillators.forEach(osc => {
          try { osc.stop(); osc.disconnect(); } catch (e) { }
        });
        this.bgMusicOscillators = [];

        const osc = this.audioCtx.createOscillator();
        const oscGain = this.audioCtx.createGain();
        const now = this.audioCtx.currentTime;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(memoryMelody[melodyIndex], now);

        const vibrato = this.audioCtx.createOscillator();
        const vibratoGain = this.audioCtx.createGain();
        vibrato.frequency.setValueAtTime(5.1, now);
        vibratoGain.gain.setValueAtTime(2, now);
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        oscGain.gain.setValueAtTime(0.001, now);
        oscGain.gain.exponentialRampToValueAtTime(0.16, now + 0.45);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 2.25);
        osc.connect(oscGain);
        oscGain.connect(masterGain);
        osc.start(now);
        vibrato.start(now);
        osc.stop(now + 2.35);
        vibrato.stop(now + 2.35);
        this.bgMusicOscillators.push(osc);
        melodyIndex = (melodyIndex + 1) % memoryMelody.length;
      };

      playMemoryNote();
      this.musicInterval = setInterval(() => playMemoryNote(), 2400);
    } catch (err) {
      console.warn('[StoryReel] Web Audio playback failed:', err);
    }
  },

  stopBackgroundMusic() {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    if (this.bgMusicOscillators) {
      this.bgMusicOscillators.forEach(osc => {
        try { osc.stop(); osc.disconnect(); } catch (e) { }
      });
      this.bgMusicOscillators = [];
    }
  },

  toggleStoryReelMusic() {
    this.bgMusicIsMuted = !this.bgMusicIsMuted;
    const musicStatus = document.getElementById('story-music-status');
    const musicIcon = document.getElementById('story-music-icon');

    if (this.bgMusicIsMuted) {
      if (musicStatus) musicStatus.textContent = 'Muted';
      if (musicIcon) musicIcon.textContent = '🔇';
      this.stopBackgroundMusic();
    } else {
      if (musicIcon) musicIcon.textContent = '🎵';
      this.startBackgroundMusic();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (ScrapCanvas && typeof ScrapCanvas.initStoryReelEvents === 'function') {
    ScrapCanvas.initStoryReelEvents();
  }
});

window.ScrapCanvas = ScrapCanvas;
