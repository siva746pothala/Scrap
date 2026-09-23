/**
 * Scrap App PocketBase Sync Interface
 * Replaces Firebase RTDB and Google Drive sync logic with PocketBase
 */


const ScrapFirebase = {
  roomId: null,
  userId: null,
  userName: null,

  elements: {},
  connections: {},
  presence: {},
  alerts: [],

  onElementsUpdateCallback: null,
  onPresenceUpdateCallback: null,
  onAlertTriggeredCallback: null,
  onConnectionsUpdateCallback: null,

  currentBoardRecordId: null,
  localMediaFiles: {},
  mediaCacheRAM: {},
  currentBoardMedia: [],
  syncTimeout: null,
  isSyncingInProgress: false,

  initialize(config, userId, userName) {
    if (window.pb && pb.authStore.isValid && pb.authStore.model) {
      this.userId = pb.authStore.model.id;
      this.userName = pb.authStore.model.name || pb.authStore.model.username || 'Squadmate';
      return;
    }
    this.userId = userId || localStorage.getItem('scrap_user_id');
    // Always prefer the freshest name: passed arg > localStorage > fallback
    const storedName = localStorage.getItem('scrap_user_display_name');
    this.userName = (userName && userName.trim()) ? userName.trim()
      : (storedName && storedName.trim()) ? storedName.trim()
      : 'Squadmate';
  },

  getMemberDisplayName(userId, fallbackEl) {
    const roomTitle = window.ScrapApp?.currentRoomTitle;
    if (fallbackEl && fallbackEl.ownerName && fallbackEl.ownerName !== 'Squadmate' && fallbackEl.ownerName !== 'Creator' && fallbackEl.ownerName !== 'Unknown' && fallbackEl.ownerName !== roomTitle) {
      return fallbackEl.ownerName;
    }
    if (fallbackEl && fallbackEl.userName && fallbackEl.userName !== 'Squadmate' && fallbackEl.userName !== 'Creator' && fallbackEl.userName !== 'Unknown' && fallbackEl.userName !== roomTitle) {
      return fallbackEl.userName;
    }
    if (window.ScrapCanvas && Array.isArray(window.ScrapCanvas.joinedMembers)) {
      const member = window.ScrapCanvas.joinedMembers.find(m => m.id === userId);
      if (member && member.name && member.name !== 'Squadmate' && member.name !== 'Creator' && member.name !== roomTitle) {
        return member.name;
      }
    }
    const storedName = localStorage.getItem('scrap_user_display_name');
    if (storedName && storedName.trim() && storedName.trim() !== roomTitle) return storedName.trim();
    if (this.userName && this.userName !== 'Squadmate' && this.userName !== roomTitle) return this.userName;
    return 'Squadmate';
  },

  setRoom(roomId) {
    this.roomId = String(roomId || '');
    this.currentBoardRecordId = this.roomId;
  },

  saveLocalRoomData(roomId, type, data) {
    try {
      let cleanData = data;
      if (type === 'elements' && data && typeof data === 'object') {
        cleanData = {};
        for (const [k, el] of Object.entries(data)) {
          if (!el) continue;
          const { _decryptedDataUrl, _decryptedSrc, _decryptedStrokes, ...rest } = el;
          cleanData[k] = rest;
        }
      }
      const strValue = JSON.stringify(cleanData);
      const storageKey = `scrap_local_${type}_${roomId}`;
      if (window.ScrapStorage && typeof window.ScrapStorage.set === 'function') {
        window.ScrapStorage.set(storageKey, strValue).catch(() => {});
      } else {
        localStorage.setItem(storageKey, strValue);
      }
    } catch (e) {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('scrap_elements_cache_') || k.startsWith('scrap_local_elements_') || k.startsWith('scrap_cache_time_'))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}
    }
  },

  getLocalRoomData(roomId, type) {
    const storageKey = `scrap_local_${type}_${roomId}`;
    const val = localStorage.getItem(storageKey);
    try {
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  },

  async saveElement(roomId, elementId, data) {
    if (!this.knownElementIds) this.knownElementIds = new Set();
    this.knownElementIds.add(elementId);

    // Register timestamp in ScrapCanvas.lastLocalEditTimes to protect against real-time purge
    if (window.ScrapCanvas) {
      if (!window.ScrapCanvas.lastLocalEditTimes) window.ScrapCanvas.lastLocalEditTimes = {};
      window.ScrapCanvas.lastLocalEditTimes[elementId] = Date.now();
    }

    const existing = this.elements[elementId];
    const isPendingMediaUpload = !!(data._pendingFileName || data._isPendingSync);

    const payload = {
      ...data,
      id: elementId,
      createdAt: (existing && existing.createdAt) || data.createdAt || Date.now(),
      updatedAt: Date.now(),
      ownerId: this.userId,
      ownerName: this.getMemberDisplayName(this.userId, data)
    };

    if (isPendingMediaUpload) {
      payload._isPendingSync = true;
    } else {
      delete payload._isPendingSync;
      delete payload._pendingFileName;
    }

    this.elements[elementId] = payload;
    this.saveLocalRoomData(roomId, 'elements', this.elements);
    localStorage.removeItem(`scrap_elements_cache_${roomId}`);

    if (this.onElementsUpdateCallback) {
      this.onElementsUpdateCallback(this.elements);
    }

    this.debounceSync();
  },

  async saveViewport(roomId, scrollLeft, scrollTop) {
    if (scrollLeft === 0 && scrollTop === 0) return; // Ignore layout collapses/transitions
    localStorage.setItem(`canvas_scroll_left_${roomId}`, String(scrollLeft));
    localStorage.setItem(`canvas_scroll_top_${roomId}`, String(scrollTop));
  },

  async updateMultipleElements(roomId, updates) {
    let changed = false;

    for (const [key, val] of Object.entries(updates)) {
      if (val === null) {
        delete this.elements[key];
        changed = true;
      } else {
        const existing = this.elements[key];
        this.elements[key] = {
          ...val,
          id: key,
          createdAt: (existing && existing.createdAt) || (val && val.createdAt) || Date.now(),
          updatedAt: Date.now(),
          ownerId: this.userId,
          ownerName: this.getMemberDisplayName(this.userId, val)
        };
        localStorage.removeItem(`scrap_elements_cache_${roomId}`);
        changed = true;
      }
    }

    if (changed) {
      this.saveLocalRoomData(roomId, 'elements', this.elements);
      if (this.onElementsUpdateCallback) {
        this.onElementsUpdateCallback(this.elements);
      }
      this.debounceSync();
    }
  },

  async deleteElement(roomId, elementId) {
    if (!this.deletedElementIds) this.deletedElementIds = {};
    this.deletedElementIds[elementId] = Date.now();

    if (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes) {
      delete window.ScrapCanvas.lastLocalEditTimes[elementId];
    }
    const el = this.elements[elementId];
    if (el && el._pendingFileName && window.ScrapDrive) {
      ScrapDrive.deleteLocalCacheFile(el._pendingFileName).catch(() => {});
    }
    delete this.elements[elementId];
    this.saveLocalRoomData(roomId, 'elements', this.elements);

    if (this.onElementsUpdateCallback) {
      this.onElementsUpdateCallback(this.elements);
    }

    this.debounceSync();
  },

  async saveConnection(roomId, connectionId, data) {
    const payload = {
      ...data,
      id: connectionId,
      updatedAt: Date.now(),
      ownerId: this.userId,
      ownerName: this.userName
    };

    this.connections[connectionId] = payload;
    this.saveLocalRoomData(roomId, 'connections', this.connections);

    if (this.onConnectionsUpdateCallback) {
      this.onConnectionsUpdateCallback(this.connections);
    }

    this.debounceSync();
  },

  async deleteConnection(roomId, connectionId) {
    delete this.connections[connectionId];
    this.saveLocalRoomData(roomId, 'connections', this.connections);

    if (this.onConnectionsUpdateCallback) {
      this.onConnectionsUpdateCallback(this.connections);
    }

    this.debounceSync();
  },

  broadcastPresence(roomId, x, y) {
    // 1. Instant local trigger for cursor animations
    if (this.onPresenceUpdateCallback) {
      this.onPresenceUpdateCallback({
        userId: this.userId,
        userName: this.userName,
        x: x,
        y: y,
        updatedAt: Date.now()
      });
    }

    // 2. Throttle backend presence updates to once every 25 seconds to optimize server load and save battery
    const now = Date.now();
    if (!this.lastPresencePingTime || now - this.lastPresencePingTime > 25000) {
      this.lastPresencePingTime = now;
      this.pingPresenceOnServer(roomId, x, y).catch(console.error);
    }
  },

  async pingPresenceOnServer(roomId, x, y) {
    if (!window.pb || !pb.authStore.isValid || !roomId) return;
    try {
      let record;
      try {
        record = await pb.collection('presence').getFirstListItem(`user = "${this.userId}" && board = "${roomId}"`);
      } catch (err) {
        // Not found, will create one below
      }

      const presenceData = {
        user: this.userId,
        board: roomId,
        username: this.userName,
        x: x,
        y: y,
        last_active: new Date().toISOString(),
        updated: new Date().toISOString()
      };

      if (record) {
        await pb.collection('presence').update(record.id, presenceData);
      } else {
        await pb.collection('presence').create(presenceData);
      }
    } catch (e) {
      console.warn('[Presence Server Ping] Failed:', e);
    }
  },

  disconnect() {
    this.roomId = null;
    this.elements = {};
    this.connections = {};
    this.localMediaFiles = {};
    this.mediaCacheRAM = {};
    try {
      window.pb.collection('boards').unsubscribe('*');
      window.pb.collection('presence').unsubscribe('*');
    } catch (e) { }
  },

  debounceSync() {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    this.syncTimeout = setTimeout(() => {
      this.syncBoardToPocketBase().catch(console.error);
    }, 400);
  },

  async syncBoardToPocketBase() {
    this.syncTimeout = null;
    if (!window.pb || !pb.authStore.isValid || !this.roomId) return;

    // Safety Guard 1: Do NOT push to PocketBase if initial room load hasn't completed
    if (!this.isInitialLoadDone) {
      console.warn('[PocketBase Sync] Room initial load in progress. Guarding against accidental room state overwrite.');
      return;
    }

    // Safety Guard 2: If local elements map is empty, restore from disk cache or abort
    if (!this.elements || Object.keys(this.elements).length === 0) {
      const cachedElements = this.getLocalRoomData(this.roomId, 'elements');
      if (cachedElements && Object.keys(cachedElements).length > 0) {
        this.elements = cachedElements;
      } else {
        console.warn('[PocketBase Sync] Local elements map is empty. Aborting sync to prevent room data wipe.');
        return;
      }
    }

    this.isSyncingInProgress = true;

    const dateStr = window.ScrapApp.currentDate || new Date().toISOString().split('T')[0];
    
    // Strip heavy transient in-memory properties (like base64 data URLs) before JSON sync to prevent HTTP 400 payload body size overflow
    const sanitizedElements = {};
    if (this.elements) {
      for (const [key, el] of Object.entries(this.elements)) {
        if (!el) continue;
        const { _decryptedDataUrl, ...cleanEl } = el;
        sanitizedElements[key] = cleanEl;
      }
    }

    const canvasState = {
      elements: sanitizedElements,
      connections: this.connections
    };

    try {
      let record;
      const updateData = {
        board_date: dateStr,
        board_state: JSON.stringify(canvasState)
      };

      const titleToSync = window.ScrapApp && window.ScrapApp.currentRoomTitle;
      const targetRecordId = this.currentBoardRecordId || this.roomId;
      if (targetRecordId) {
        if (titleToSync && titleToSync !== targetRecordId && titleToSync !== this.roomId && titleToSync !== 'pb_temp_room') {
          updateData.title = titleToSync;
        }
        record = await pb.collection('boards').update(targetRecordId, updateData);
        this.currentBoardRecordId = record.id;
      } else {
        updateData.title = (titleToSync && titleToSync !== 'pb_temp_room') ? titleToSync : 'Squad Space';
        updateData.user = pb.authStore.model.id;
        record = await pb.collection('boards').create(updateData);
        this.currentBoardRecordId = record.id;
      }
      this.currentBoardMedia = record.media || [];

      // Clear _isPendingSync flags upon successful server acknowledgement
      let elementsChanged = false;
      for (const el of Object.values(this.elements)) {
        if (el && el._isPendingSync) {
          delete el._isPendingSync;
          elementsChanged = true;
        }
      }
      if (elementsChanged) {
        this.saveLocalRoomData(this.roomId, 'elements', this.elements);
      }

      this.syncRetryCount = 0;
      console.log('[PocketBase Sync] Board successfully synced (JSON state only)');
    } catch (err) {
      console.error('[PocketBase Sync] Failed to sync board state:', err);

      // Bounded retry logic (No infinite loops!)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.log('[PocketBase Sync] Network is offline. Pausing retry queue until online event.');
        return;
      }

      this.syncRetryCount = (this.syncRetryCount || 0) + 1;
      if (this.syncRetryCount <= 5) {
        const delay = Math.min(60000, Math.pow(2, this.syncRetryCount) * 1000);
        console.log(`[PocketBase Sync] Scheduling retry #${this.syncRetryCount} in ${delay}ms...`);
        setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            this.syncBoardToPocketBase().catch(console.error);
          }
        }, delay);
      } else if (this.syncRetryCount <= 10) {
        console.log('[PocketBase Sync] Cool-down mode: Scheduling retry in 5 minutes...');
        setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            this.syncBoardToPocketBase().catch(console.error);
          }
        }, 300000);
      } else {
        console.warn('[PocketBase Sync] Max active retries reached. Background retries paused until network event or manual trigger.');
      }
    } finally {
      this.isSyncingInProgress = false;
    }
  },

  async loadBoardFromPocketBase(dateStr) {
    if (!window.pb || !pb.authStore.isValid || !this.roomId) return;
    const requestedRoomId = this.roomId;
    const requestedSubscriptionToken = this.roomSubscriptionToken;

    try {
      const record = await pb.collection('boards').getOne(requestedRoomId, { expand: 'members,user' });
      if (this.roomId !== requestedRoomId || this.roomSubscriptionToken !== requestedSubscriptionToken) return;
      this.currentBoardRecordId = record.id;
      this.currentBoardMedia = record.media || [];

      if (record && record.title && record.title !== record.id && window.ScrapApp) {
        const currentTitle = window.ScrapApp.currentRoomTitle;
        if (!currentTitle || currentTitle === record.id || currentTitle === 'Squad Space') {
          window.ScrapApp.currentRoomTitle = record.title;
          localStorage.setItem('scrap_current_room_title', record.title);
          localStorage.setItem('scrap_room_title_' + record.id, record.title);
          const titleEl = document.getElementById('canvas-room-title');
          if (titleEl) titleEl.innerText = `ROOM: ${record.title.toUpperCase()}`;
        }
      }

      if (record && window.ScrapCanvas) {
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
        this.isGroupVault = rawMembers.length > 0;
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

        window.ScrapCanvas.joinedMembers = allMembers;
        if (typeof window.ScrapCanvas.updateActiveMembersListUI === 'function') {
          window.ScrapCanvas.updateActiveMembersListUI();
        }
      }

      if (record.board_state) {
        const state = typeof record.board_state === 'string' ? JSON.parse(record.board_state) : record.board_state;
        const serverElements = (state && state.elements) || {};
        const serverConnections = (state && state.connections) || {};

        // Merge server elements with existing local elements (preserving pending unsynced items)
        const mergedElements = {};
        for (const [id, serverEl] of Object.entries(serverElements)) {
          const deletedTime = (this.deletedElementIds && this.deletedElementIds[id]) || 0;
          if (deletedTime > 0 && Date.now() - deletedTime < 30000) {
            continue;
          }
          mergedElements[id] = serverEl;
        }
        let hasPendingLocalItems = false;

        for (const [id, localEl] of Object.entries(this.elements || {})) {
          const deletedTime = (this.deletedElementIds && this.deletedElementIds[id]) || 0;
          if (deletedTime > 0 && Date.now() - deletedTime < 30000) {
            continue;
          }
          if (localEl && localEl._isPendingSync) {
            mergedElements[id] = localEl;
            hasPendingLocalItems = true;
          } else {
            const lastEdit = (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes && window.ScrapCanvas.lastLocalEditTimes[id]) || 0;
            if (lastEdit > 0 && (Date.now() - lastEdit < 15000) && !serverElements[id]) {
              mergedElements[id] = localEl;
              hasPendingLocalItems = true;
            }
          }
        }

        this.elements = mergedElements;

        const mergedConnections = { ...serverConnections };
        for (const [id, localConn] of Object.entries(this.connections || {})) {
          if (localConn && localConn._isPendingSync) {
            mergedConnections[id] = localConn;
            hasPendingLocalItems = true;
          }
        }
        this.connections = mergedConnections;

        if (hasPendingLocalItems) {
          console.log('[PocketBase Load] Preserved pending local items. Triggering sync to update server record.');
          this.debounceSync();
        }
      }

      this.knownElementIds = new Set(Object.keys(this.elements));
      this.saveLocalRoomData(this.roomId, 'elements', this.elements);
      this.saveLocalRoomData(this.roomId, 'connections', this.connections);
      this.isInitialLoadDone = true;

      if (this.onElementsUpdateCallback) this.onElementsUpdateCallback(this.elements);
      if (this.onConnectionsUpdateCallback) this.onConnectionsUpdateCallback(this.connections);

    } catch (err) {
      if (err.status === 404) {
        if (this.currentBoardRecordId) {
          window.ScrapDialog.alert('🚨 You no longer have access to this room.').then(() => {
            const backBtn = document.getElementById('btn-canvas-back');
            if (backBtn) backBtn.click();
          });
          return;
        }
        console.log('[PocketBase load] Board record not found, will be created on first sync');
      } else {
        console.error('[PocketBase load] Error loading board:', err);
      }
    }
  },

  debounceSync() {
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      this.syncBoardToPocketBase().catch(console.error);
    }, 500);
  },

  async subscribeToRoom(roomId, onElementsUpdate, onPresenceUpdate, onAlertTriggered, onConnectionsUpdate) {
    const subscriptionToken = (this.roomSubscriptionToken || 0) + 1;
    this.roomSubscriptionToken = subscriptionToken;
    this.isInitialLoadDone = false;
    this.setRoom(roomId);

    this.onElementsUpdateCallback = onElementsUpdate;
    this.onPresenceUpdateCallback = onPresenceUpdate;
    this.onAlertTriggeredCallback = onAlertTriggered;
    this.onConnectionsUpdateCallback = onConnectionsUpdate;

    this.elements = this.getLocalRoomData(roomId, 'elements') || {};
    this.connections = this.getLocalRoomData(roomId, 'connections') || {};
    this.knownElementIds = new Set(Object.keys(this.elements));

    if (onElementsUpdate) onElementsUpdate(this.elements);
    if (onConnectionsUpdate) onConnectionsUpdate(this.connections);

    const dateStr = window.ScrapApp.currentDate || new Date().toISOString().split('T')[0];
    this.loadBoardFromPocketBase(dateStr).catch(console.error);

    // Setup PocketBase subscription for real-time sync
    try {
      pb.collection('boards').subscribe(this.roomId, (e) => {
        if (this.roomSubscriptionToken !== subscriptionToken || this.roomId !== roomId) return;
        if (e.action === 'update') {
          this.currentBoardRecordId = e.record.id;
          this.currentBoardMedia = e.record.media || [];

          if (e.record && e.record.title && e.record.title !== e.record.id && window.ScrapApp) {
            const currentTitle = window.ScrapApp.currentRoomTitle;
            if (!currentTitle || currentTitle === e.record.id) {
              window.ScrapApp.currentRoomTitle = e.record.title;
              localStorage.setItem('scrap_current_room_title', e.record.title);
              localStorage.setItem('scrap_room_title_' + e.record.id, e.record.title);
              const titleEl = document.getElementById('canvas-room-title');
              if (titleEl) titleEl.innerText = `ROOM: ${e.record.title.toUpperCase()}`;
            }
          }

          // Extract and update joined members on realtime updates
          if (e.record) {
            pb.collection('boards').getOne(this.roomId, { expand: 'members,user' }).then(record => {
              if (record && window.ScrapCanvas) {
                const owner = record.expand && record.expand.user;
                const membersList = record.expand && record.expand.members ? record.expand.members : [];
                const allMembers = [];
                if (owner) {
                  allMembers.push({
                    id: owner.id,
                    name: owner.name || owner.username || 'Creator',
                    avatar: owner.avatar || '',
                    encrypted_avatar: owner.encrypted_avatar || ''
                  });
                } else if (record.user) {
                  allMembers.push({
                    id: record.user,
                    name: 'Creator',
                    avatar: '',
                    encrypted_avatar: ''
                  });
                }

                // Map expanded members by ID
                const expandedMap = {};
                membersList.forEach(m => {
                  if (m && m.id) expandedMap[m.id] = m;
                });

                // Use record.members (which is always present) to list joined members
                const rawMembers = record.members || [];
                this.isGroupVault = rawMembers.length > 0;
                rawMembers.forEach(mid => {
                  if (owner && mid === owner.id) return;
                  if (mid === record.user) return;
                  const expandedUser = expandedMap[mid];
                  allMembers.push({
                    id: mid,
                    name: expandedUser ? (expandedUser.name || expandedUser.username || 'Squadmate') : 'Squadmate',
                    avatar: expandedUser ? (expandedUser.avatar || '') : '',
                    encrypted_avatar: expandedUser ? (expandedUser.encrypted_avatar || '') : ''
                  });
                });

                window.ScrapCanvas.joinedMembers = allMembers;
                if (typeof window.ScrapCanvas.updateActiveMembersListUI === 'function') {
                  window.ScrapCanvas.updateActiveMembersListUI();
                }
              }
            }).catch(err => {
              console.warn('[Realtime Members Update] Failed to fetch expanded members:', err);
            });
          }

          if (this.syncTimeout || this.isSyncingInProgress) {
            console.log('[PocketBase Subscribe] Ignored update event to prevent overwriting local pending changes');
            return;
          }

          const state = typeof e.record.board_state === 'string' ? JSON.parse(e.record.board_state) : e.record.board_state;
          const serverElements = (state && state.elements) || {};
          const serverConnections = (state && state.connections) || {};

          // Direct prompt for recovery_request elements to bypass date filters / canvas rendering
          for (const [id, data] of Object.entries(serverElements)) {
            if (data && data.type === 'recovery_request') {
              const isMe = data.userId === this.userId;
              if (!isMe && !window[`active_recovery_prompt_${id}`]) {
                window[`active_recovery_prompt_${id}`] = true;
                setTimeout(async () => {
                  if (await window.ScrapDialog.confirm(`👥 SQUAD KEY RECOVERY:\n"${data.userName}" is requesting room decryption access. Approve access?`)) {
                    try {
                      const roomKey = await ScrapRecovery.getRoomKey(this.roomId);
                      if (!roomKey) throw new Error('You do not have the decryption key for this room.');
                      const roomKeyJwk = await ScrapCrypto.exportKeyToJwk(roomKey);

                      const pubKey = await ScrapCrypto.importJwkToKey(
                        data.publicKeyJwk,
                        { name: 'RSA-OAEP', hash: 'SHA-256' },
                        ['encrypt']
                      );

                      const roomKeyStr = JSON.stringify(roomKeyJwk);
                      const roomKeyBuffer = ScrapCrypto.stringToBuffer(roomKeyStr);
                      const encryptedKey = await window.crypto.subtle.encrypt(
                        { name: 'RSA-OAEP' },
                        pubKey,
                        roomKeyBuffer
                      );
                      const encryptedBase64 = ScrapCrypto.arrayBufferToBase64(encryptedKey);

                      const respElement = {
                        type: 'recovery_response',
                        targetUserId: data.userId,
                        encryptedRoomKey: encryptedBase64,
                        date: data.date || new Date().toISOString().split('T')[0]
                      };
                      await this.saveElement(this.roomId, `recovery_resp_${data.userId}`, respElement);
                      await this.syncBoardToPocketBase();
                      await window.ScrapDialog.alert(`✅ Access approved for "${data.userName}".`);
                    } catch (err) {
                      await window.ScrapDialog.alert('Failed to approve recovery: ' + err.message);
                    }
                  }
                  delete window[`active_recovery_prompt_${id}`];
                }, 100);
              }
            }
          }

          // Determine if current room is a Solo Vault
          const storedIsGroup = localStorage.getItem('scrap_room_is_group_' + this.roomId);
          const isSoloVault = storedIsGroup === 'false' ||
                              (this.isGroupVault === false) ||
                              this.roomId === this.userId ||
                              this.roomId.startsWith('solo_') ||
                              this.roomId.includes('_solo') ||
                              (window.ScrapCanvas && Array.isArray(window.ScrapCanvas.joinedMembers) && window.ScrapCanvas.joinedMembers.length <= 1);

          // Merge elements based on updatedAt timestamp
          let changed = false;
          for (const [id, serverEl] of Object.entries(serverElements)) {
            // Block re-inserting elements that were deleted locally
            const deletedTime = (this.deletedElementIds && this.deletedElementIds[id]) || 0;
            if (deletedTime > 0 && Date.now() - deletedTime < 30000) {
              continue;
            }

            const isBrandNewElement = !this.knownElementIds.has(id);
            this.knownElementIds.add(id);

            const localEl = this.elements[id];

            // Prevent overwriting elements that were recently edited/dragged locally
            const lastEdit = (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes && window.ScrapCanvas.lastLocalEditTimes[id]) || 0;
            if (Date.now() - lastEdit < 10000 && localEl) {
              continue;
            }

            // Trigger notification alert ONLY when a BRAND NEW element is created in a GROUP vault by a squadmate
            const createdAtMs = serverEl.createdAt ? (typeof serverEl.createdAt === 'number' ? serverEl.createdAt : new Date(serverEl.createdAt).getTime()) : 0;
            const isNewlyCreated = createdAtMs > 0 && (Date.now() - createdAtMs) < 30000 && (Date.now() - createdAtMs) >= 0;

            if (isBrandNewElement && !isSoloVault && this.isInitialLoadDone && serverEl && serverEl.ownerId && serverEl.ownerId !== this.userId && !id.startsWith('recovery_') && isNewlyCreated) {
              const authorName = this.getMemberDisplayName(serverEl.ownerId, serverEl);
              let label = 'added a new item to the group board! ✨';
              if (serverEl.type === 'photo') label = 'added a new photo 📷';
              else if (serverEl.type === 'text') label = 'added a text sticker 📝';
              else if (serverEl.type === 'sticker') label = 'added a graphic sticker 🎨';
              else if (serverEl.type === 'doodle') label = 'added a doodle drawing ✏️';
              else if (serverEl.type === 'voice') label = 'shared a voice note 🎙️';
              else if (serverEl.type === 'music') label = 'shared a music track 🎵';
              else if (serverEl.type === 'video') label = 'shared a video note 🎬';

              if (window.ScrapNotifications && typeof window.ScrapNotifications.triggerGroupPushNotification === 'function') {
                window.ScrapNotifications.triggerGroupPushNotification(authorName, label, this.roomId);
              } else if (this.onAlertTriggeredCallback) {
                this.onAlertTriggeredCallback({
                  userId: serverEl.ownerId,
                  userName: authorName,
                  type: 'new_element',
                  detail: label,
                  timestamp: Date.now()
                });
              }
            }

            if (!localEl || !localEl.updatedAt || !serverEl.updatedAt || serverEl.updatedAt > localEl.updatedAt) {
              this.elements[id] = serverEl;
              changed = true;
            }
          }
          // Real-Time Remote Deletion Sync: If element is missing from server and not currently pending upload, delete locally
          for (const id of Object.keys(this.elements)) {
            if (!serverElements[id]) {
              const localEl = this.elements[id];
              const isLocalPendingUpload = localEl && (localEl._isPendingSync || localEl._pendingFileName);
              if (!isLocalPendingUpload) {
                delete this.elements[id];
                changed = true;
              }
            }
          }

          // Merge connections
          let connChanged = false;
          for (const [id, serverConn] of Object.entries(serverConnections)) {
            const localConn = this.connections[id];
            if (!localConn || !localConn.updatedAt || !serverConn.updatedAt || serverConn.updatedAt > localConn.updatedAt) {
              this.connections[id] = serverConn;
              connChanged = true;
            }
          }
          for (const id of Object.keys(this.connections)) {
            if (!serverConnections[id]) {
              const lastEdit = (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes && window.ScrapCanvas.lastLocalEditTimes[id]) || 0;
              if (Date.now() - lastEdit > 5000) {
                delete this.connections[id];
                connChanged = true;
              }
            }
          }

          if (changed) {
            this.saveLocalRoomData(this.roomId, 'elements', this.elements);
            if (this.onElementsUpdateCallback) {
              this.onElementsUpdateCallback(this.elements);
            }
          }
          if (connChanged) {
            this.saveLocalRoomData(this.roomId, 'connections', this.connections);
            if (this.onConnectionsUpdateCallback) {
              this.onConnectionsUpdateCallback(this.connections);
            }
          }
        }
      });

      // Setup realtime presence subscription
      try {
        await pb.collection('presence').unsubscribe('*');
      } catch (e) {}

      await pb.collection('presence').subscribe('*', (e) => {
        if (e.record.board === this.roomId && e.record.user !== this.userId) {
          if (e.action === 'create' || e.action === 'update') {
            if (this.onPresenceUpdateCallback) {
              this.onPresenceUpdateCallback({
                userId: e.record.user,
                userName: e.record.username || 'Squadmate',
                x: e.record.x,
                y: e.record.y,
                updatedAt: e.record.last_active ? (isNaN(e.record.last_active) ? Date.parse(e.record.last_active) : Number(e.record.last_active)) : Date.now()
              });
            }
          }
        }
      });
    } catch (subErr) {
      console.error('[PocketBase Subscribe] Subscription setup failed:', subErr);
    }
  },


  async getUserRooms(userId) {
    const targetUserId = userId || (window.pb && pb.authStore.isValid && pb.authStore.model && pb.authStore.model.id) || 'guest';
    const cacheKey = 'scrap_user_rooms_cache_' + targetUserId;

    if (!window.pb || !pb.authStore.isValid) {
      try {
        const cached = window.ScrapStorage && typeof window.ScrapStorage.get === 'function'
          ? await window.ScrapStorage.get(cacheKey)
          : localStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) : [];
      } catch (_) {
        return [];
      }
    }

    try {
      const records = await pb.collection('boards').getFullList({
        filter: `user = "${pb.authStore.model.id}" || members ~ "${pb.authStore.model.id}"`,
        sort: '-created'
      });
      const roomList = records.map(r => ({
        id: r.id,
        title: r.title || 'Squad Space',
        createdBy: r.user || pb.authStore.model.id,
        isGroup: r.members && r.members.length > 0,
        avatar: r.avatar || '',
        encrypted_avatar: r.encrypted_avatar || ''
      }));

      // Cache room list to Native Disk Storage for offline / weak mobile data support
      const strVal = JSON.stringify(roomList);
      if (window.ScrapStorage && typeof window.ScrapStorage.set === 'function') {
        await window.ScrapStorage.set(cacheKey, strVal).catch(() => {});
      } else {
        localStorage.setItem(cacheKey, strVal);
      }

      return roomList;
    } catch (e) {
      console.error('[PocketBase getUserRooms] Network Error, loading disk cached room list:', e);
      try {
        const cached = window.ScrapStorage && typeof window.ScrapStorage.get === 'function'
          ? await window.ScrapStorage.get(cacheKey)
          : localStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) : [];
      } catch (_) {
        return [];
      }
    }
  },

  async prepareAccountDeletion(userId) {
    console.log(`[PocketBase prepareAccountDeletion] Starting for user ${userId}. Auth valid: ${Boolean(window.pb && pb.authStore.isValid)}.`);
    if (!window.pb || !pb.authStore.isValid || !userId) {
      throw new Error('Not authenticated.');
    }

    const ownedBoards = await pb.collection('boards').getFullList({ filter: `user = "${userId}"` });
    const memberBoards = await pb.collection('boards').getFullList({ filter: `members ~ "${userId}"` });
    const boards = [...new Map([...ownedBoards, ...memberBoards].map(board => [board.id, board])).values()];
    console.log(`[PocketBase prepareAccountDeletion] Found ${boards.length} room(s) for user ${userId}.`);
    const deletedSoloRoomIds = [];

    for (const board of boards) {
      const members = Array.isArray(board.members) ? board.members : [];
      const isOwner = board.user === userId;
      const remainingMembers = members.filter(memberId => memberId !== userId);

      if (isOwner && remainingMembers.length === 0) {
        console.log(`[PocketBase prepareAccountDeletion] Solo room ${board.id}: deleting room and media first.`);
        await this.deleteRoom(board.id);
        deletedSoloRoomIds.push(board.id);
      } else if (isOwner) {
        console.log(`[PocketBase prepareAccountDeletion] Group owner room ${board.id}: transferring ownership.`);
        // Preserve a group space by transferring ownership to a remaining member.
        await pb.collection('boards').update(board.id, {
          user: remainingMembers[0],
          members: remainingMembers
        });
      } else if (members.includes(userId)) {
        console.log(`[PocketBase prepareAccountDeletion] Group member room ${board.id}: removing membership.`);
        await pb.collection('boards').update(board.id, {
          members: remainingMembers
        });
      }
    }

    try {
      const presenceRecords = await pb.collection('presence').getFullList({
        filter: `user = "${userId}"`
      });
      for (const presence of presenceRecords) {
        await pb.collection('presence').delete(presence.id);
      }
    } catch (e) {
      console.warn('[PocketBase prepareAccountDeletion] Presence cleanup failed:', e);
    }

    return { deletedSoloRoomIds };
  },

  async createRoom(folderId, title, userId, members) {
    if (!window.pb || !pb.authStore.isValid) return 'pb_temp_room';
    try {
      const record = await pb.collection('boards').create({
        title: title,
        board_date: new Date().toISOString().split('T')[0],
        user: pb.authStore.model.id,
        board_state: JSON.stringify({ elements: {}, connections: {} })
      });
      return record.id;
    } catch (e) {
      console.error('[PocketBase createRoom] Error:', e);
      throw e;
    }
  },

  async joinRoom(roomId, userId) {
    if (!window.pb || !pb.authStore.isValid) {
      throw new Error('Not authenticated with PocketBase. Please log in first.');
    }
    try {
      const board = await pb.collection('boards').getOne(roomId);
      const currentMembers = board.members || [];
      if (!currentMembers.includes(userId)) {
        currentMembers.push(userId);
        await pb.collection('boards').update(roomId, {
          members: currentMembers
        });
      }
      console.log(`[PocketBase joinRoom] User ${userId} successfully joined room ${roomId}`);
    } catch (e) {
      console.error('[PocketBase joinRoom] Error:', e);
      throw e;
    }
  },

  async leaveRoom(roomId, userId) {
    if (!window.pb || !pb.authStore.isValid) return;
    try {
      const board = await pb.collection('boards').getOne(roomId);
      const currentMembers = board.members || [];
      const updatedMembers = currentMembers.filter(id => id !== userId);
      await pb.collection('boards').update(roomId, {
        members: updatedMembers
      });
      console.log(`[PocketBase leaveRoom] User ${userId} successfully left room ${roomId}`);
    } catch (e) {
      console.error('[PocketBase leaveRoom] Error:', e);
      throw e;
    }
  },

  async deleteRoom(roomId) {
    console.log(`[PocketBase deleteRoom] Requested for room ${roomId}. Auth valid: ${Boolean(window.pb && pb.authStore.isValid)}.`);
    if (!window.pb || !pb.authStore.isValid) {
      throw new Error('Not authenticated.');
    }
    try {
      console.log(`[PocketBase deleteRoom] Deleting room ${roomId} and its media...`);
      const board = await pb.collection('boards').getOne(roomId);
      
      // 1. Gather all files in the board state
      let elements = {};
      if (board.board_state) {
        try {
          const state = typeof board.board_state === 'string' ? JSON.parse(board.board_state) : board.board_state;
          elements = state.elements || {};
        } catch (e) {
          console.warn('[deleteRoom] Failed to parse board_state:', e);
        }
      }

      // Iterate through elements to find file IDs to delete
      const fileIdsToDelete = new Set();
      const addMediaReference = (value) => {
        if (typeof value === 'string' && value.trim()) {
          fileIdsToDelete.add(value.trim());
        } else if (value && typeof value === 'object') {
          ['fileId', 'audioFileId', 'videoFileId', 'key', 'name'].forEach(field => {
            if (typeof value[field] === 'string' && value[field].trim()) {
              fileIdsToDelete.add(value[field].trim());
            }
          });
        }
      };
      Object.values(elements).forEach(el => {
        const elementData = el && (el.data || el);
        if (elementData) {
          addMediaReference(elementData.fileId);
          addMediaReference(elementData.audioFileId);
          addMediaReference(elementData.videoFileId);
          if (elementData.encryptedDataOrFileId) {
            const isFileId = elementData.encryptedDataOrFileId.length < 200;
            if (isFileId) {
              addMediaReference(elementData.encryptedDataOrFileId);
            }
          }
        }
      });
      if (Array.isArray(board.media)) {
        board.media.forEach(addMediaReference);
      }

      // 2. Delete files from Cloudflare R2 & local disk cache
      console.log(`[PocketBase deleteRoom] Found ${fileIdsToDelete.size} files to delete.`);
      if (fileIdsToDelete.size > 0 && (!window.ScrapDrive || typeof window.ScrapDrive.deleteFile !== 'function')) {
        throw new Error('R2 file manager is unavailable; room deletion was cancelled.');
      }
      for (const fileId of fileIdsToDelete) {
        try {
          await window.ScrapDrive.deleteFile(fileId);
          console.log(`[PocketBase deleteRoom] Deleted file: ${fileId}`);
        } catch (fileErr) {
          throw new Error(`Failed to delete media file ${fileId}: ${fileErr.message}`);
        }
      }

      // 3. Delete presence records for this board
      try {
        const presenceList = await pb.collection('presence').getFullList({
          filter: `board = "${roomId}"`
        });
        for (const p of presenceList) {
          await pb.collection('presence').delete(p.id);
        }
        console.log(`[PocketBase deleteRoom] Deleted presence records.`);
      } catch (presenceErr) {
        console.warn(`[PocketBase deleteRoom] Failed to delete presence records:`, presenceErr);
      }

      // 4. Finally, delete the board record itself
      await pb.collection('boards').delete(roomId);
      console.log(`[PocketBase deleteRoom] Board record ${roomId} successfully deleted.`);
    } catch (e) {
      console.error('[PocketBase deleteRoom] Error:', e);
      throw e;
    }
  },

  async removeMember(roomId, userId) {
    if (!window.pb || !pb.authStore.isValid) return;
    try {
      const board = await pb.collection('boards').getOne(roomId);
      const currentMembers = board.members || [];
      const updatedMembers = currentMembers.filter(id => id !== userId);
      await pb.collection('boards').update(roomId, {
        members: updatedMembers
      });
      console.log(`[PocketBase removeMember] User ${userId} successfully removed from room ${roomId}`);
    } catch (e) {
      console.error('[PocketBase removeMember] Error:', e);
      throw e;
    }
  },

  getBlockedUsers() {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      try {
        return JSON.parse(localStorage.getItem('scrap_blocked_users') || '[]');
      } catch (e) {
        return [];
      }
    }
    const blocked = pb.authStore.model.blocked || [];
    localStorage.setItem('scrap_blocked_users', JSON.stringify(blocked));
    return blocked;
  },

  async toggleBlockUser(targetUserId) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const currentBlocked = pb.authStore.model.blocked || [];
    let updatedBlocked = [];
    let isBlocking = false;
    
    if (currentBlocked.includes(targetUserId)) {
      updatedBlocked = currentBlocked.filter(id => id !== targetUserId);
    } else {
      updatedBlocked = [...currentBlocked, targetUserId];
      isBlocking = true;
    }
    
    await pb.collection('users').update(pb.authStore.model.id, {
      blocked: updatedBlocked
    });
    
    pb.authStore.model.blocked = updatedBlocked;
    localStorage.setItem('scrap_blocked_users', JSON.stringify(updatedBlocked));
    
    return isBlocking;
  },

  async compressImage(file, targetSizeKb = 50, maxDimension = 512) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return file;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if width or height exceeds maxDimension
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Iterate quality to meet the targetBytes size
          let quality = 0.8;
          const targetBytes = targetSizeKb * 1024;

          const attemptExport = (q) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                resolve(file);
                return;
              }
              if (blob.size <= targetBytes || q <= 0.2) {
                const nameWithoutExt = file.name ? file.name.replace(/\.[^/.]+$/, "") : "avatar";
                const compressedFile = new File([blob], nameWithoutExt + ".jpg", {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                attemptExport(q - 0.15);
              }
            }, 'image/jpeg', q);
          };

          attemptExport(quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  },

  async getUserAvatarCryptoKey(targetUserId = null, roomId = null) {
    // If a target user ID is provided (or current user logged in), personal avatars are encrypted with deterministic user key
    const userId = targetUserId || (window.pb && pb.authStore.isValid && pb.authStore.model ? pb.authStore.model.id : null);
    if (userId) {
      const salt = new Uint8Array([115, 99, 114, 97, 112, 97, 118, 97]); // 'scrapava'
      return await ScrapCrypto.deriveKeyFromPin(userId, salt);
    }
    let roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
    if (roomKey && typeof roomKey === 'object' && roomKey.algorithm) return roomKey;
    return null;
  },

  async getRoomAvatarCryptoKey(roomId) {
    let roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
    if (roomKey && typeof roomKey === 'object' && roomKey.algorithm) return roomKey;
    return null;
  },

  async uploadRoomAvatar(roomId, file) {
    if (!window.pb || !pb.authStore.isValid) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const cryptoKey = await this.getRoomAvatarCryptoKey(roomId);
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(compressedFile);
      });
      if (cryptoKey && dataUrl && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
        const encData = await ScrapCrypto.encryptText(dataUrl, cryptoKey);
        formData.append('encrypted_avatar', encData);
      }
    } catch (cryptoErr) {
      console.warn('[Avatar] Encryption error for room avatar:', cryptoErr);
    }

    const updatedRecord = await pb.collection('boards').update(roomId, formData);
    return dataUrl || updatedRecord.encrypted_avatar;
  },

  async uploadUserAvatar(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const roomId = this.roomId || localStorage.getItem('scrap_current_room_id');
      const cryptoKey = await this.getUserAvatarCryptoKey(pb.authStore.model.id, roomId);
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(compressedFile);
      });
      if (cryptoKey && dataUrl && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
        const encData = await ScrapCrypto.encryptText(dataUrl, cryptoKey);
        formData.append('encrypted_avatar', encData);
      }
    } catch (cryptoErr) {
      console.warn('[Avatar] Encryption error for user avatar:', cryptoErr);
    }

    const updatedRecord = await pb.collection('users').update(pb.authStore.model.id, formData);
    if (updatedRecord.encrypted_avatar) {
      pb.authStore.model.encrypted_avatar = updatedRecord.encrypted_avatar;
    }
    return dataUrl || updatedRecord.encrypted_avatar;
  },

  async uploadUserCustomBg(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 200, 1920);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const roomId = this.roomId || localStorage.getItem('scrap_current_room_id');
      console.log(`[PocketBase removeMember] User ${userId} successfully removed from room ${roomId}`);
    } catch (e) {
      console.error('[PocketBase removeMember] Error:', e);
      throw e;
    }
  },

  getBlockedUsers() {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      try {
        return JSON.parse(localStorage.getItem('scrap_blocked_users') || '[]');
      } catch (e) {
        return [];
      }
    }
    const blocked = pb.authStore.model.blocked || [];
    localStorage.setItem('scrap_blocked_users', JSON.stringify(blocked));
    return blocked;
  },

  async toggleBlockUser(targetUserId) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const currentBlocked = pb.authStore.model.blocked || [];
    let updatedBlocked = [];
    let isBlocking = false;
    
    if (currentBlocked.includes(targetUserId)) {
      updatedBlocked = currentBlocked.filter(id => id !== targetUserId);
    } else {
      updatedBlocked = [...currentBlocked, targetUserId];
      isBlocking = true;
    }
    
    await pb.collection('users').update(pb.authStore.model.id, {
      blocked: updatedBlocked
    });
    
    pb.authStore.model.blocked = updatedBlocked;
    localStorage.setItem('scrap_blocked_users', JSON.stringify(updatedBlocked));
    
    return isBlocking;
  },

  async compressImage(file, targetSizeKb = 50, maxDimension = 512) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return file;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if width or height exceeds maxDimension
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Iterate quality to meet the targetBytes size
          let quality = 0.8;
          const targetBytes = targetSizeKb * 1024;

          const attemptExport = (q) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                resolve(file);
                return;
              }
              if (blob.size <= targetBytes || q <= 0.2) {
                const nameWithoutExt = file.name ? file.name.replace(/\.[^/.]+$/, "") : "avatar";
                const compressedFile = new File([blob], nameWithoutExt + ".jpg", {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                attemptExport(q - 0.15);
              }
            }, 'image/jpeg', q);
          };

          attemptExport(quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  },

  async getUserAvatarCryptoKey(targetUserId = null, roomId = null) {
    // If a target user ID is provided (or current user logged in), personal avatars are encrypted with deterministic user key
    const userId = targetUserId || (window.pb && pb.authStore.isValid && pb.authStore.model ? pb.authStore.model.id : null);
    if (userId) {
      const salt = new Uint8Array([115, 99, 114, 97, 112, 97, 118, 97]); // 'scrapava'
      return await ScrapCrypto.deriveKeyFromPin(userId, salt);
    }
    let roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
    if (roomKey && typeof roomKey === 'object' && roomKey.algorithm) return roomKey;
    return null;
  },

  async getRoomAvatarCryptoKey(roomId) {
    let roomKey = roomId ? await ScrapRecovery.getRoomKey(roomId) : null;
    if (roomKey && typeof roomKey === 'object' && roomKey.algorithm) return roomKey;
    return null;
  },

  async uploadRoomAvatar(roomId, file) {
    if (!window.pb || !pb.authStore.isValid) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const cryptoKey = await this.getRoomAvatarCryptoKey(roomId);
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(compressedFile);
      });
      if (cryptoKey && dataUrl && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
        const encData = await ScrapCrypto.encryptText(dataUrl, cryptoKey);
        formData.append('encrypted_avatar', encData);
      }
    } catch (cryptoErr) {
      console.warn('[Avatar] Encryption error for room avatar:', cryptoErr);
    }

    const updatedRecord = await pb.collection('boards').update(roomId, formData);
    return dataUrl || updatedRecord.encrypted_avatar;
  },

  async uploadUserAvatar(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const roomId = this.roomId || localStorage.getItem('scrap_current_room_id');
      const cryptoKey = await this.getUserAvatarCryptoKey(pb.authStore.model.id, roomId);
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(compressedFile);
      });
      if (cryptoKey && dataUrl && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
        const encData = await ScrapCrypto.encryptText(dataUrl, cryptoKey);
        formData.append('encrypted_avatar', encData);
      }
    } catch (cryptoErr) {
      console.warn('[Avatar] Encryption error for user avatar:', cryptoErr);
    }

    const updatedRecord = await pb.collection('users').update(pb.authStore.model.id, formData);
    if (updatedRecord.encrypted_avatar) {
      pb.authStore.model.encrypted_avatar = updatedRecord.encrypted_avatar;
    }
    return dataUrl || updatedRecord.encrypted_avatar;
  },

  async uploadUserCustomBg(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 200, 1920);
    const formData = new FormData();
    let dataUrl = '';

    try {
      const roomId = this.roomId || localStorage.getItem('scrap_current_room_id');
      const cryptoKey = await this.getUserAvatarCryptoKey(pb.authStore.model.id, roomId);
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(compressedFile);
      });
      if (cryptoKey && dataUrl && window.ScrapCrypto && typeof ScrapCrypto.encryptText === 'function') {
        const encData = await ScrapCrypto.encryptText(dataUrl, cryptoKey);
        formData.append('encrypted_custom_bg', encData);
      }
    } catch (cryptoErr) {
      console.warn('[Custom BG] Encryption error for user custom background:', cryptoErr);
    }

    const updatedRecord = await pb.collection('users').update(pb.authStore.model.id, formData);
    if (updatedRecord.encrypted_custom_bg) {
      pb.authStore.model.encrypted_custom_bg = updatedRecord.encrypted_custom_bg;
    }
    return dataUrl || updatedRecord.encrypted_custom_bg;
  },

  broadcastAlert(roomId, type, message) {
    console.log('[PocketBase Alert] Broadcast:', type, message);
    if (this.onAlertTriggeredCallback) {
      this.onAlertTriggeredCallback({
        userId: this.userId,
        userName: this.userName,
        type,
        message,
        timestamp: Date.now()
      });
    }
  },

  async flushPendingSyncQueue() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.log('[ScrapSync] Network is offline. Pausing queue flush.');
      return;
    }

    this.syncRetryCount = 0;

    // Scan elements for pending media binary uploads to Cloudflare R2
    let updatedMedia = false;
    for (const [id, el] of Object.entries(this.elements || {})) {
      if (el && el._isPendingSync && el._pendingFileName && window.ScrapDrive) {
        try {
          console.log(`[ScrapSync] Resuming pending binary upload for element ${id}: ${el._pendingFileName}`);
          const fileBuffer = await ScrapDrive.readLocalCacheFile(el._pendingFileName);
          if (fileBuffer) {
            const uploadRes = await ScrapDrive.uploadFile(el._pendingFileName, fileBuffer, this.roomId);
            if (uploadRes && uploadRes.id) {
              el.fileId = uploadRes.id;
              if (el.type === 'voice' || el.type === 'music') el.audioFileId = uploadRes.id;
              if (el.type === 'video') el.videoFileId = uploadRes.id;
              delete el._pendingFileName;
              delete el._isPendingSync;
              updatedMedia = true;
            }
          }
        } catch (mediaErr) {
          console.warn(`[ScrapSync] Failed to resume upload for ${id}:`, mediaErr);
        }
      }
    }

    if (updatedMedia) {
      this.saveLocalRoomData(this.roomId, 'elements', this.elements);
      if (this.onElementsUpdateCallback) {
        this.onElementsUpdateCallback(this.elements);
      }
    }

    this.syncBoardToPocketBase().catch(console.error);
  }
};

window.ScrapFirebase = ScrapFirebase;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[ScrapNetwork] Network connection restored! Flushing pending sync queue...');
    if (window.ScrapFirebase && typeof window.ScrapFirebase.flushPendingSyncQueue === 'function') {
      window.ScrapFirebase.flushPendingSyncQueue();
    }
  });
}
