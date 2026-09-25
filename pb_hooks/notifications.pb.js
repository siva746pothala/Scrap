// pb_hooks/notifications.pb.js

// Hook triggered AFTER a board record is updated in the database
onRecordAfterUpdateRequest((e) => {
  try {
    const board = e.record;
    const oldBoard = e.originalRecord;
    const boardTitle = board.get("title") || "Squad Space";
    const boardId = board.id;

    console.log("[Notifications] Board update detected for room:", boardId);

    // 1. Parse board_state JSON column from PocketBase
    let newElements = {};
    let oldElements = {};

    try {
      let strNew = board.getString("board_state") || "";
      if (!strNew) {
        const rawNew = board.get("board_state");
        strNew = typeof rawNew === "string" ? rawNew : JSON.stringify(rawNew || {});
      }
      const parsedNew = JSON.parse(strNew || "{}");
      newElements = (parsedNew && parsedNew.elements) ? parsedNew.elements : (parsedNew || {});
    } catch(err) {
      console.warn("[Notifications] Error parsing new board_state:", err.message);
      newElements = {};
    }

    try {
      let strOld = "";
      if (oldBoard) {
        strOld = oldBoard.getString("board_state") || "";
        if (!strOld) {
          const rawOld = oldBoard.get("board_state");
          strOld = typeof rawOld === "string" ? rawOld : JSON.stringify(rawOld || {});
        }
      }
      const parsedOld = JSON.parse(strOld || "{}");
      oldElements = (parsedOld && parsedOld.elements) ? parsedOld.elements : (parsedOld || {});
    } catch(err) {
      oldElements = {};
    }
    // Find newly added elements.
    // TWO conditions must BOTH be true to count as "new":
    //  1. The key did not exist in the previous board_state snapshot
    //  2. The element's createdAt timestamp is within the last 2 minutes
    //
    // Condition 2 is the critical safety net: originalRecord.board_state is
    // often empty/null (PocketBase doesn't always populate JSON columns on it),
    // which makes oldElements = {} and every canvas element look "added".
    // A stale createdAt timestamp ensures old elements are always skipped.
    const RECENTLY_ADDED_MS = 120000; // 2 minutes
    const nowMs = Date.now();

    const newKeys = Object.keys(newElements);


    const addedKeys = newKeys.filter(function(k) {
      if (oldElements[k]) return false; // existed in previous snapshot — not new
      const el = newElements[k] || {};
      const ts = el.createdAt || el.updatedAt || 0;
      const isRecent = (nowMs - ts) < RECENTLY_ADDED_MS;
      if (!isRecent) {
        console.log("[Notifications] Skipping old element (stale timestamp):", k, "| age(s):", Math.round((nowMs - ts) / 1000));
      }
      return isRecent;
    });

    if (addedKeys.length === 0) {
      console.log("[Notifications] No genuinely new element found. Skipping.");
      return;
    }


    // DEDUPLICATION SHIELD: skip element IDs notified within the last 90 seconds.
    // 90s covers the two-phase photo save: initial metadata write + post-R2-upload fileId patch.
    // Uses $app.store() — PocketBase's built-in process-lifetime KV cache — because
    // module-level variables are NOT shared across Goja hook invocations.
    const DEDUP_KEY = "notif_dedup_map";
    const DEDUP_TTL = 90000;  // 90 seconds
    const CLEANUP_TTL = 600000; // 10 minutes

    let notifiedMap = $app.store().get(DEDUP_KEY);
    if (!notifiedMap || typeof notifiedMap !== "object") {
      notifiedMap = {};
    }

    const unnotifiedKeys = addedKeys.filter(function(k) {
      const lastTime = notifiedMap[boardId + ":" + k] || 0;
      return (Date.now() - lastTime) > DEDUP_TTL;
    });

    if (unnotifiedKeys.length === 0) {
      console.log("[Notifications] Newly added element(s) were already notified. Skipping duplicate push.");
      return;
    }

    // Mark these element IDs as notified now
    const notifyTs = Date.now();
    unnotifiedKeys.forEach(function(k) {
      notifiedMap[boardId + ":" + k] = notifyTs;
    });

    // Cleanup entries older than 10 minutes to prevent unbounded growth
    const now = Date.now();
    Object.keys(notifiedMap).forEach(function(k) {
      if (now - notifiedMap[k] > CLEANUP_TTL) {
        delete notifiedMap[k];
      }
    });

    // Persist the updated map back to the store
    $app.store().set(DEDUP_KEY, notifiedMap);

    // Determine the type of the newly added item
    const lastAddedKey = unnotifiedKeys[unnotifiedKeys.length - 1];
    const lastAddedItem = newElements[lastAddedKey] || {};
    const itemType = lastAddedItem ? (lastAddedItem.type || "") : "";

    console.log("[Notifications] Newly added item key:", lastAddedKey, "| Type:", itemType);

    // 2. Identify active user — prefer ownerName stored IN the element (e.auth is null for SDK saves)
    //    Fall back to e.auth only if the element has no ownerName field.
    const activeUser = e.auth;
    const elementOwnerName = lastAddedItem.ownerName || lastAddedItem.userName || "";
    const elementOwnerId  = lastAddedItem.ownerId  || lastAddedItem.userId  || "";

    const activeUserName = elementOwnerName
      || (activeUser ? (activeUser.get("name") || activeUser.get("username") || "") : "")
      || "Squadmate";

    const activeUserId = elementOwnerId
      || (activeUser ? activeUser.id : "");

    console.log("[Notifications] Active user resolved as:", activeUserName, "| id:", activeUserId);
    // Customize message based on the exact item type
    let actionMessage = "added a new item to the board! ✨";
    if (itemType === "photo") actionMessage = "added a new photo 📷";
    else if (itemType === "text") actionMessage = "added a text sticker 📝";
    else if (itemType === "sticker") actionMessage = "added a graphic sticker 🎨";
    else if (itemType === "doodle") actionMessage = "added a doodle drawing ✏️";
    else if (itemType === "voice") actionMessage = "shared a voice note 🎙️";
    else if (itemType === "music") actionMessage = "shared a music track 🎵";
    else if (itemType === "video") actionMessage = "shared a video note 🎬";

    const notificationBody = activeUserName + " " + actionMessage;
    console.log("[Notifications] Notification text:", notificationBody);

    // 3. Gather room members
    let members = [];
    try {
      const rawMembers = board.get("members");
      const strMembers = typeof rawMembers === "string" ? rawMembers : JSON.stringify(rawMembers || []);
      members = JSON.parse(strMembers || "[]");
    } catch (_) { members = []; }

    const creatorId = board.get("user");
    if (creatorId && members.indexOf(creatorId) === -1) {
      members.push(creatorId);
    }

    // Filter out the active user (don't notify the editor)
    const targetUserIds = members.filter(function(id) {
      return id !== activeUserId;
    });

    console.log("[Notifications] Target member IDs count:", targetUserIds.length);

    if (targetUserIds.length === 0) {
      console.log("[Notifications] No target squadmates to notify in this room.");
      return;
    }

    // 4. Retrieve FCM push tokens from database
    const pushTokens = [];
    targetUserIds.forEach(function(userId) {
      try {
        const userRecord = $app.dao().findRecordById("users", userId);
        const token = userRecord.get("fcm_token");
        if (token && token.trim() !== "") {
          pushTokens.push(token);
        }
      } catch (err) {
        console.warn("[Notifications] Could not fetch user or fcm_token for ID:", userId);
      }
    });

    console.log("[Notifications] Found valid FCM push tokens count:", pushTokens.length);

    if (pushTokens.length === 0) {
      console.log("[Notifications] No FCM push tokens found for target members.");
      return;
    }

    // 5. Request the Google OAuth2 access token from local PM2 service on port 3000
    console.log("[Notifications] Fetching OAuth2 token from http://127.0.0.1:3000/token ...");
    const tokenRes = $http.send({
      url: "http://127.0.0.1:3000/token",
      method: "GET"
    });

    if (tokenRes.statusCode !== 200) {
      console.error("[Notifications] Failed to retrieve Google access token from local PM2 service. Code:", tokenRes.statusCode);
      return;
    }

    let accessToken = "";
    try {
      const parsedTokenObj = typeof tokenRes.raw === "string" ? JSON.parse(tokenRes.raw) : tokenRes.raw;
      accessToken = parsedTokenObj.token || parsedTokenObj.access_token || "";
    } catch (tErr) {
      console.error("[Notifications] Failed to parse access token JSON:", tErr.message);
      return;
    }

    if (!accessToken) {
      console.error("[Notifications] Access token is empty!");
      return;
    }

    // 6. Firebase Project ID
    const firebaseProjectId = "scrap-1a355";

    // 7. Send push notifications to target tokens using FCM HTTP v1
    pushTokens.forEach(function(token) {
      try {
        const response = $http.send({
          url: "https://fcm.googleapis.com/v1/projects/" + firebaseProjectId + "/messages:send",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + accessToken
          },
          body: JSON.stringify({
            message: {
              token: token,
              notification: {
                title: boardTitle,
                body: notificationBody
              },
              android: {
                notification: {
                  channel_id: "scrap_activity"
                }
              },
              data: {
                roomId: boardId
              }
            }
          })
        });

        console.log("[Notifications] FCM HTTP v1 Response Code:", response.statusCode);
      } catch (fcmErr) {
        console.error("[Notifications] Failed sending push to token: " + token + " | Error: " + fcmErr.message);
      }
    });

  } catch (err) {
    console.error("[Notifications] Hook error:", err.message);
  }
}, "boards");
