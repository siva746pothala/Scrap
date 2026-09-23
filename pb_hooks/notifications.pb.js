// pb_hooks/notifications.pb.js

// Hook triggered AFTER a board record is updated in the database
onRecordAfterUpdateRequest((e) => {
  try {
    const board = e.record;
    const oldBoard = e.originalRecord;
    const boardTitle = board.get("title") || "Squad Space";
    const boardId = board.id;
    
    console.log("[Notifications] Board update detected for room:", boardId);

    // Persistent deduplication map in Goja execution scope
    if (typeof this.__notifiedMap === "undefined") {
      this.__notifiedMap = {};
    }
    const notifiedMap = this.__notifiedMap;

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

    const newKeys = Object.keys(newElements);
    const oldKeys = Object.keys(oldElements);

    // Find the newly added element key(s)
    const addedKeys = newKeys.filter(function(k) {
      return !oldElements[k];
    });

    if (addedKeys.length === 0) {
      console.log("[Notifications] No new element added key found. Skipping.");
      return;
    }

    // DEDUPLICATION SHIELD: Filter out items that were already notified in the last 60 seconds
    const unnotifiedKeys = addedKeys.filter(function(k) {
      const lastTime = notifiedMap[k] || 0;
      return (Date.now() - lastTime) > 60000;
    });

    if (unnotifiedKeys.length === 0) {
      console.log("[Notifications] Newly added element(s) were already notified. Skipping duplicate push.");
      return;
    }

    // Mark these element IDs as notified now
    unnotifiedKeys.forEach(function(k) {
      notifiedMap[k] = Date.now();
    });

    // Cleanup old items from deduplication cache older than 10 minutes
    const now = Date.now();
    Object.keys(notifiedMap).forEach(function(k) {
      if (now - notifiedMap[k] > 600000) {
        delete notifiedMap[k];
      }
    });

    // Determine the type of the newly added item
    const lastAddedKey = unnotifiedKeys[unnotifiedKeys.length - 1];
    const lastAddedItem = newElements[lastAddedKey] || {};
    const itemType = lastAddedItem ? (lastAddedItem.type || "") : "";

    console.log("[Notifications] Newly added item key:", lastAddedKey, "| Type:", itemType);

    // 2. Identify active user
    const activeUser = e.auth; 
    const activeUserName = activeUser ? (activeUser.get("name") || activeUser.get("username") || "Squadmate") : "Squadmate";
    const activeUserId = activeUser ? activeUser.id : "";

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
