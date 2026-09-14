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

  setRoom(roomId) {
    this.roomId = String(roomId || '');
    this.currentBoardRecordId = this.roomId;
  },

  saveLocalRoomData(roomId, type, data) {
    localStorage.setItem(`scrap_local_${type}_${roomId}`, JSON.stringify(data));
  },

  getLocalRoomData(roomId, type) {
    const val = localStorage.getItem(`scrap_local_${type}_${roomId}`);
    try {
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  },

  async saveElement(roomId, elementId, data) {
    const payload = {
      ...data,
      id: elementId,
      updatedAt: Date.now(),
      ownerId: this.userId,
      ownerName: this.userName
    };

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
        this.elements[key] = {
          ...val,
          id: key,
          updatedAt: Date.now(),
          ownerId: this.userId,
          ownerName: this.userName
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

    // 2. Throttle backend presence updates to once every 5 seconds to optimize server load
    const now = Date.now();
    if (!this.lastPresencePingTime || now - this.lastPresencePingTime > 5000) {
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
    try {
      window.pb.collection('boards').unsubscribe('*');
      window.pb.collection('presence').unsubscribe('*');
    } catch (e) { }
  },

  async syncBoardToPocketBase() {
    this.syncTimeout = null;
    if (!window.pb || !pb.authStore.isValid) return;

    this.isSyncingInProgress = true;

    const dateStr = window.ScrapApp.currentDate || new Date().toISOString().split('T')[0];
    const canvasState = {
      elements: this.elements,
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
      console.log('[PocketBase Sync] Board successfully synced (JSON state only)');
    } catch (err) {
      console.error('[PocketBase Sync] Failed to sync board state:', err);
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
        this.elements = state.elements || {};
        this.connections = state.connections || {};
      }

      this.saveLocalRoomData(this.roomId, 'elements', this.elements);
      this.saveLocalRoomData(this.roomId, 'connections', this.connections);

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
    this.setRoom(roomId);

    this.onElementsUpdateCallback = onElementsUpdate;
    this.onPresenceUpdateCallback = onPresenceUpdate;
    this.onAlertTriggeredCallback = onAlertTriggered;
    this.onConnectionsUpdateCallback = onConnectionsUpdate;

    this.elements = this.getLocalRoomData(roomId, 'elements') || {};
    this.connections = this.getLocalRoomData(roomId, 'connections') || {};

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

          // Merge elements based on updatedAt timestamp
          let changed = false;
          for (const [id, serverEl] of Object.entries(serverElements)) {
            const localEl = this.elements[id];

            // Prevent overwriting elements that were recently edited/dragged locally
            const lastEdit = (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes && window.ScrapCanvas.lastLocalEditTimes[id]) || 0;
            if (Date.now() - lastEdit < 10000 && localEl) {
              continue;
            }

            if (!localEl || !localEl.updatedAt || !serverEl.updatedAt || serverEl.updatedAt > localEl.updatedAt) {
              this.elements[id] = serverEl;
              changed = true;
            }
          }
          // Purge deleted elements
          for (const id of Object.keys(this.elements)) {
            if (!serverElements[id]) {
              const lastEdit = (window.ScrapCanvas && window.ScrapCanvas.lastLocalEditTimes && window.ScrapCanvas.lastLocalEditTimes[id]) || 0;
              if (Date.now() - lastEdit > 5000) {
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
    if (!window.pb || !pb.authStore.isValid) return [];
    try {
      const records = await pb.collection('boards').getFullList({
        filter: `user = "${pb.authStore.model.id}" || members ~ "${pb.authStore.model.id}"`,
        sort: '-created'
      });
      return records.map(r => ({
        id: r.id,
        title: r.title || 'Squad Space',
        createdBy: r.user || pb.authStore.model.id,
        isGroup: r.members && r.members.length > 0,
        avatar: r.avatar || ''
      }));
    } catch (e) {
      console.error('[PocketBase getUserRooms] Error:', e);
      return [];
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

  async uploadRoomAvatar(roomId, file) {
    if (!window.pb || !pb.authStore.isValid) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    formData.append('avatar', compressedFile);
    const updatedRecord = await pb.collection('boards').update(roomId, formData);
    return updatedRecord.avatar;
  },

  async uploadUserAvatar(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 50, 512);
    const formData = new FormData();
    formData.append('avatar', compressedFile);
    const updatedRecord = await pb.collection('users').update(pb.authStore.model.id, formData);
    pb.authStore.model.avatar = updatedRecord.avatar;
    return updatedRecord.avatar;
  },

  async uploadUserCustomBg(file) {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      throw new Error('Not authenticated with PocketBase.');
    }
    const compressedFile = await this.compressImage(file, 200, 1920);
    const formData = new FormData();
    formData.append('custom_bg', compressedFile);
    const updatedRecord = await pb.collection('users').update(pb.authStore.model.id, formData);
    pb.authStore.model.custom_bg = updatedRecord.custom_bg;
    return updatedRecord.custom_bg;
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
  }
};

window.ScrapFirebase = ScrapFirebase;
