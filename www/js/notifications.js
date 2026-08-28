/**
 * Scrap App Push Notifications Manager
 * Interacts with @capacitor/push-notifications to register FCM tokens
 * and sync them back to the PocketBase user record.
 */

const ScrapNotifications = {
  async init() {
    const PushNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
    if (!PushNotifications) {
      console.log('[Push] Not available on this platform (e.g. running in web browser).');
      return;
    }

    try {
      // 1. Request permission to show notifications
      let perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[Push] Permission denied by user.');
        return;
      }

      // 2. Create notification channel (Required for Android 8.0+)
      await PushNotifications.createChannel({
        id: 'scrap_activity',
        name: 'Room Activity',
        description: 'Notifications for multiplayer activity in your Scrap rooms',
        importance: 4, // High importance (plays sound and shows banner)
        visibility: 1, // Public visibility
        sound: 'default',
        vibration: true
      });

      // 3. Register the device with the APNS/FCM service
      await PushNotifications.register();

      // 3. Handle registration success and retrieve the token
      PushNotifications.addListener('registration', async (token) => {
        console.log('[Push] Registration success. Token:', token.value);
        
        // Sync the FCM Token to the PocketBase user record
        if (window.pb && pb.authStore.isValid && pb.authStore.model) {
          const userId = pb.authStore.model.id;
          try {
            await pb.collection('users').update(userId, {
              fcm_token: token.value
            });
            console.log('[Push] FCM Token synced to PocketBase users collection.');
          } catch (pbErr) {
            console.error('[Push] Failed to sync FCM token to PocketBase:', pbErr);
          }
        }
      });

      // 4. Handle registration errors
      PushNotifications.addListener('registrationError', (error) => {
        console.error('[Push] Registration error:', error);
      });

      // 5. Handle receiving notifications when the app is in the foreground
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Push] Notification received in foreground:', notification);
        // Custom visual cue or alert if needed when in foreground
      });

      // 6. Handle action performed (user tapped the notification)
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('[Push] Action performed:', action);
        // You can use action.notification.data to route the user to the correct board!
        if (action.notification && action.notification.data && action.notification.data.roomId) {
          const roomId = action.notification.data.roomId;
          console.log('[Push] Navigating directly to room:', roomId);
          setTimeout(() => {
            if (window.ScrapApp && typeof window.ScrapApp.openRoomDirectly === 'function') {
              window.ScrapApp.openRoomDirectly(roomId);
            }
          }, 1000);
        }
      });

    } catch (err) {
      console.error('[Push] Initialization error:', err);
    }
  }
};

window.ScrapNotifications = ScrapNotifications;
