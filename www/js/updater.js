/**
 * Mitrava Auto-Update Manager
 * 1. Checks internet connectivity on startup.
 * 2. Checks Google Play Store In-App Update status (AppUpdate native plugin).
 * 3. Prompts user with custom modal dialog to update.
 * 4. Downloads update in background and automatically installs & reopens app.
 */

(function () {
  // SET TO true TO FORCE TEST THE UPDATE ALERT UI LOCALLY ON DEMO/DEBUG BUILDS
  const TEST_UPDATE_UI = false;

  if (TEST_UPDATE_UI) {
    window.isUpdateModalActive = true;
  }

  const AppUpdater = {
    async init() {
      if (TEST_UPDATE_UI) {
        window.isUpdateModalActive = true;
        console.log('⚡ [AppUpdater] TEST_UPDATE_UI is enabled. Displaying update modal dialog.');
        this.showUpdateDialog({ updateAvailable: true });
        return;
      }

      // Check network connectivity first
      const isOnline = await this.checkNetworkStatus();
      if (!isOnline) {
        console.warn('⚡ [AppUpdater] Device offline or server unreachable. Skipping update check.');
        return;
      }

      // Check if user previously snoozed the update prompt (24h cooldown)
      const snoozedUntil = parseInt(localStorage.getItem('mitrava_update_snoozed_until') || '0', 10);
      if (snoozedUntil > 0) {
        if (Date.now() < snoozedUntil) {
          console.log('⚡ [AppUpdater] Update prompt is currently snoozed by user.');
          return;
        } else {
          // 24 hours have passed -> clear expired snooze timestamp
          localStorage.removeItem('mitrava_update_snoozed_until');
        }
      }

      // Perform update check
      this.checkForUpdates();
    },

    async checkNetworkStatus() {
      if (!navigator.onLine) return false;
      try {
        const response = await fetch('https://api.myscrapmemories.com/api/health', {
          method: 'GET',
          cache: 'no-store'
        }).catch(() => null);
        return response ? response.ok : navigator.onLine;
      } catch (e) {
        return navigator.onLine;
      }
    },

    async checkForUpdates() {
      if (!window.Capacitor || !window.Capacitor.isPluginAvailable('AppUpdate')) {
        console.log('⚡ [AppUpdater] Native AppUpdate plugin not available in web preview context.');
        return;
      }

      try {
        const updateInfo = await window.Capacitor.Plugins.AppUpdate.checkForUpdate();
        console.log('⚡ [AppUpdater] Update info:', updateInfo);

        if (updateInfo && updateInfo.updateAvailable) {
          window.isUpdateModalActive = true;
          this.showUpdateDialog(updateInfo);
        } else {
          window.isUpdateModalActive = false;
        }
      } catch (err) {
        window.isUpdateModalActive = false;
        console.error('⚡ [AppUpdater] Error checking for updates:', err);
      }
    },

    isGatewayActive() {
      const gw = document.getElementById('screen-gateway');
      if (gw && !gw.classList.contains('hidden')) return true;
      if (window.App && window.App.activeScreen === 'screen-gateway') return true;
      const splash = document.getElementById('scrap-loading-splash');
      if (splash && !splash.classList.contains('hidden')) return true;
      return false;
    },

    showUpdateDialog(updateInfo) {
      if (document.getElementById('mitrava-update-modal')) return;

      // Do NOT show update alert on Enter Email / Auth screen; defer until dashboard load
      if (this.isGatewayActive()) {
        console.log('⚡ [AppUpdater] User is currently on Enter Email / Auth screen. Deferring update alert until login.');
        this.pendingUpdateInfo = updateInfo;
        if (!this.gatewayCheckInterval) {
          let gatewayChecks = 0;
          this.gatewayCheckInterval = setInterval(() => {
            gatewayChecks++;
            if (!this.isGatewayActive() || gatewayChecks >= 100) {
              clearInterval(this.gatewayCheckInterval);
              this.gatewayCheckInterval = null;
              if (!this.isGatewayActive() && this.pendingUpdateInfo) {
                const info = this.pendingUpdateInfo;
                this.pendingUpdateInfo = null;
                this.showUpdateDialog(info);
              }
            }
          }, 800);
        }
        return;
      }

      window.isUpdateModalActive = true;

      // Clean up any visible tour guides or canvas/photo tooltips when update alert is shown
      if (window.ScrapTour && typeof window.ScrapTour.cleanup === 'function') {
        try { window.ScrapTour.cleanup(); } catch (e) { }
      }
      const activeBanner = document.getElementById('canvas-empty-date-info-banner');
      if (activeBanner) activeBanner.remove();
      const activeSvg = document.getElementById('canvas-empty-date-arrow-svg');
      if (activeSvg) activeSvg.remove();
      const activePhotoTip = document.getElementById('canvas-photo-longpress-tip');
      if (activePhotoTip) activePhotoTip.remove();

      const modal = document.createElement('div');
      modal.id = 'mitrava-update-modal';
      modal.className = 'fixed inset-0 z-[99999999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 font-sans';
      modal.innerHTML = `
        <div class="bg-white border border-gray-200 rounded-3xl p-6 max-w-sm w-full shadow-[0_20px_60px_rgba(0,0,0,0.4)] text-gray-900 text-center animate-fade-in relative z-[99999999]">
          <div class="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-200 shadow-sm">
            <svg class="w-9 h-9 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
          </div>
          
          <h2 class="text-xl font-black tracking-wide text-gray-900 mb-2">New Update Available! 🎉</h2>
          <p class="text-xs text-gray-600 mb-6 leading-relaxed font-medium">
            A new version of Mitrava is available on Google Play. Update now for new features, speed improvements, and stability!
          </p>

          <div id="update-progress-container" class="hidden mb-5">
            <div class="flex justify-between text-xs font-bold text-emerald-600 mb-1.5">
              <span>Downloading update in background...</span>
              <span id="update-progress-percent">0%</span>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200">
              <div id="update-progress-bar" class="bg-emerald-500 h-full w-0 transition-all duration-300 shadow-sm"></div>
            </div>
          </div>

          <div class="flex gap-3" id="update-button-group">
            <button id="btn-update-later" class="flex-1 py-3 px-4 rounded-xl border border-gray-300 bg-gray-100 text-gray-700 font-bold text-xs uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition">
              Later
            </button>
            <button id="btn-update-now" class="flex-1 py-3 px-4 rounded-xl bg-emerald-500 text-white font-black text-xs uppercase tracking-wider shadow-md hover:bg-emerald-600 active:scale-95 transition cursor-pointer" style="color: #ffffff !important; font-weight: 900 !important; background-color: #10b981 !important;">
              UPDATE NOW
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const btnLater = document.getElementById('btn-update-later');
      const btnNow = document.getElementById('btn-update-now');

      btnLater.addEventListener('click', () => {
        // Snooze update prompt for 24 hours so user is not repeatedly interrupted
        localStorage.setItem('mitrava_update_snoozed_until', (Date.now() + 24 * 60 * 60 * 1000).toString());
        window.isUpdateModalActive = false;
        modal.remove();
      });

      btnNow.addEventListener('click', async () => {
        // Clear snoozed timestamp when user chooses to update
        localStorage.removeItem('mitrava_update_snoozed_until');
        document.getElementById('update-button-group').classList.add('hidden');
        document.getElementById('update-progress-container').classList.remove('hidden');

        try {
          // Listen for download progress & completion
          const AppUpdatePlugin = window.Capacitor.Plugins.AppUpdate;

          if (AppUpdatePlugin.addListener) {
            AppUpdatePlugin.addListener('onUpdateProgress', (data) => {
              if (data.totalBytesToDownload > 0) {
                const pct = Math.round((data.bytesDownloaded / data.totalBytesToDownload) * 100);
                document.getElementById('update-progress-percent').textContent = `${pct}%`;
                document.getElementById('update-progress-bar').style.width = `${pct}%`;
              }
            });

            AppUpdatePlugin.addListener('onUpdateDownloaded', async () => {
              document.getElementById('update-progress-percent').textContent = '100%';
              document.getElementById('update-progress-bar').style.width = '100%';

              // Automatically complete update and reopen app
              setTimeout(async () => {
                await AppUpdatePlugin.completeUpdate();
              }, 500);
            });
          }

          // Trigger native flexible update flow
          await AppUpdatePlugin.startFlexibleUpdate();
        } catch (err) {
          console.error('⚡ [AppUpdater] Update failed:', err);
          // Fallback redirect to Play Store listing if in-app update API encounters error
          window.open('https://play.google.com/store/apps/details?id=com.memories.scrap', '_system');
          modal.remove();
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      AppUpdater.init();
    });
  } else {
    AppUpdater.init();
  }

  window.AppUpdater = AppUpdater;
})();
