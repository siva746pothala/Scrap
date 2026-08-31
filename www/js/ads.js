/**
 * ============================================================
 * SCRAP MEMORIES — AD MANAGER
 * Completely isolated from app.js / canvas.js
 *
 * Uses TWO PocketBase collections:
 *
 *  1. 'ad_config'  — AdMob IDs + frequency settings (single record)
 *  2. 'ads'        — Each ad is its own record with file uploads
 *
 * For 'ads' collection:
 *   Just upload your image/video in PocketBase — URLs are built automatically!
 *   No manual URL typing needed.
 *
 * Ad Types (set 'type' field in PocketBase):
 *   "banner" → inline card ad in rooms list
 *   "video"  → thumbnail card → fullscreen video player on tap
 * ============================================================
 */

const ScrapAds = (() => {

  // ─────────────────────────────────────────────────────────────
  // POCKETBASE SETTINGS
  // ─────────────────────────────────────────────────────────────

  const PB_URL            = 'https://api.myscrapmemories.com';
  const ADS_COLLECTION    = 'ads';        // Collection with individual ad records
  const CONFIG_COLLECTION = 'ad_config';  // Collection with AdMob IDs + settings

  // ─────────────────────────────────────────────────────────────
  // FALLBACK CONFIG (used when PocketBase unreachable)
  // ─────────────────────────────────────────────────────────────

  const FALLBACK_CONFIG = {
    admobEnabled:            false,
    admobBannerUnitId:       '',
    admobInterstitialUnitId: '',
    adEveryNRooms:           6,
    maxAdsInList:            2,
    interstitialEveryNSaves: 3,
  };

  // ─────────────────────────────────────────────────────────────
  // INTERNAL STATE
  // ─────────────────────────────────────────────────────────────

  let _config     = { ...FALLBACK_CONFIG };
  let _ads        = [];      // Active ads loaded in-memory from PocketBase (starts empty)
  let _adIndex    = 0;
  let _saveCount  = 0;
  let _admobReady = false;
  let _pendingInterstitial = false;
  let _lastInterstitialTime = 0;
  let _admobBannerShowing = false;

  // ─────────────────────────────────────────────────────────────
  // CHECK USER AD ELIGIBILITY
  // ─────────────────────────────────────────────────────────────

  function _shouldShowAds() {
    if (!window.pb || !pb.authStore.isValid || !pb.authStore.model) {
      return true; // Default to showing ads if user is not fully logged in or loading initial state
    }
    const user = pb.authStore.model;
    
    // 1. If user explicitly has show_ads set to false
    if (user.show_ads === false) {
      return false;
    }

    // 2. If ads_start_date is defined and it's currently in the future
    if (user.ads_start_date) {
      const startDate = new Date(user.ads_start_date);
      // Reset time to start of the day to allow showing ads on that day
      startDate.setHours(0, 0, 0, 0);
      
      const now = new Date();
      if (now < startDate) {
        return false;
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD POCKETBASE FILE URL
  // PocketBase auto-generates filenames when you upload.
  // URL format: /api/files/{collection}/{recordId}/{filename}
  // ─────────────────────────────────────────────────────────────

  function _fileUrl(collectionId, recordId, filename) {
    if (!filename) return '';
    return `${PB_URL}/api/files/${collectionId}/${recordId}/${filename}`;
  }

  // ─────────────────────────────────────────────────────────────
  // FETCH AD CONFIG (AdMob IDs + frequency settings)
  // ─────────────────────────────────────────────────────────────

  async function _fetchAdConfig() {
    try {
      if (window.pb) {
        // Always query network to get real-time configurations instantly
        const records = await pb.collection(CONFIG_COLLECTION).getList(1, 1, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
          cache: 'no-store'
        });
        const record = records.items?.[0];
        if (record) {
          _applyConfig(record);
          console.log('[ScrapAds] Remote config loaded successfully');
        }
      } else {
        throw new Error('PocketBase SDK client not initialized');
      }
    } catch (e) {
      console.warn('[ScrapAds] Config fetch failed:', e.message, '— using fallback config');
    }
  }

  function _applyConfig(r) {
    if (typeof r.admob_enabled        === 'boolean') _config.admobEnabled             = r.admob_enabled;
    if (r.admob_banner_id)                           _config.admobBannerUnitId        = r.admob_banner_id;
    if (r.admob_interstitial_id)                     _config.admobInterstitialUnitId  = r.admob_interstitial_id;
    if (typeof r.ad_every_n_rooms     === 'number')  _config.adEveryNRooms            = Math.max(6, r.ad_every_n_rooms); // Policy safeguard: minimum 6 rooms to prevent excessive density
    if (typeof r.max_ads_in_list      === 'number')  _config.maxAdsInList             = r.max_ads_in_list;
    if (typeof r.interstitial_every_n === 'number')  _config.interstitialEveryNSaves  = r.interstitial_every_n;
  }

  // ─────────────────────────────────────────────────────────────
  // FETCH ADS from 'ads' collection
  // Each record = one ad. Files are uploaded directly in PocketBase.
  // URL is built automatically from record ID + filename.
  // ─────────────────────────────────────────────────────────────

  async function _fetchAds() {
    try {
      if (!window.pb) throw new Error('PocketBase SDK client not initialized');

      console.log('[ScrapAds] Fetching fresh ads via PocketBase SDK...');

      let userArea = pb.authStore.model?.area || '';
      console.log('[ScrapAds] User object area value:', userArea);

      // If userArea is stored as a string name (e.g. "Bachupally"), resolve it to its relation ID
      if (userArea && userArea.length > 0) {
        try {
          const areaRecords = await pb.collection('areas').getFullList({
            filter: `area_name = "${userArea}"`,
            requestKey: null
          });
          if (areaRecords && areaRecords.length > 0) {
            const resolvedId = areaRecords[0].id;
            console.log(`[ScrapAds] Resolved user area name "${userArea}" to ID: ${resolvedId}`);
            userArea = resolvedId;
          }
        } catch (resolveErr) {
          console.warn('[ScrapAds] Failed to resolve area name to ID:', resolveErr);
        }
      }

      let filterExpr = 'active = true';
      if (userArea) {
        filterExpr += ` && (areas = null || areas = "" || areas:length = 0 || areas ?~ "${userArea}")`;
      } else {
        filterExpr += ' && (areas = null || areas = "" || areas:length = 0)';
      }

      console.log(`[ScrapAds] Querying ads with area-based filter: ${filterExpr}`);

      // Fetch only active, matched ads via the SDK
      const result = await pb.collection(ADS_COLLECTION).getList(1, 50, {
        filter: filterExpr,
        sort: 'order,created',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        cache: 'no-store'
      });
      const raw = result.items || [];
      console.log(`[ScrapAds] PocketBase SDK returned ${raw.length} matched ad(s)`);

      // Map raw records to clean ad structures
      _ads = raw.map(r => ({
        id:          r.id,
        type:        (r.type || 'banner').toLowerCase(),
        icon:        r.icon || '📢',
        title:       r.title || '',
        subtitle:    r.subtitle || '',
        ctaText:     r.cta_text || '',
        ctaUrl:      r.cta_url || '',
        accentColor: r.accent_color || '#39ff14',
        ctaBgColor:  r.cta_bg_color || '#39ff14',
        imageUrl:     _fileUrl(r.collectionId || ADS_COLLECTION, r.id, r.image),
        videoUrl:     _fileUrl(r.collectionId || ADS_COLLECTION, r.id, r.video),
        thumbnailUrl: _fileUrl(r.collectionId || ADS_COLLECTION, r.id, r.thumbnail),
      }));

      if (!_ads.length) {
        console.warn('[ScrapAds] ads collection is empty or no active ads — showing no ads');
      }

    } catch (e) {
      console.warn('[ScrapAds] Ads fetch failed:', e.message, '— leaving ads empty');
      _ads = [];
    }
  }


  // ─────────────────────────────────────────────────────────────
  // ADMOB INIT
  // ─────────────────────────────────────────────────────────────

  async function _initAdMob() {
    if (!_config.admobEnabled || !window.AdMob) return false;
    try {
      await AdMob.initialize({ requestTrackingAuthorization: false });
      _admobReady = true;
      console.log('[ScrapAds] AdMob ready');
      return true;
    } catch (e) {
      console.warn('[ScrapAds] AdMob init failed:', e);
      return false;
    }
  }

  async function _showAdMobBanner() {
    if (!_config.admobEnabled || !_admobReady || !window.AdMob || !_config.admobBannerUnitId) return;
    if (_admobBannerShowing) return;
    try {
      const { BannerAdPosition } = window.AdMob;
      await AdMob.showBanner({
        adId: _config.admobBannerUnitId,
        position: BannerAdPosition.BOTTOM,
        margin: 0,
        isTesting: false,
        npa: false
      });
      _admobBannerShowing = true;
      console.log('[ScrapAds] AdMob banner displayed successfully');
    } catch (e) {
      console.warn('[ScrapAds] AdMob banner display failed:', e);
    }
  }

  async function _hideAdMobBanner() {
    if (!window.AdMob || !_admobBannerShowing) return;
    try {
      await AdMob.removeBanner();
      _admobBannerShowing = false;
      console.log('[ScrapAds] AdMob banner removed');
    } catch (e) {
      console.warn('[ScrapAds] AdMob banner remove failed:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // OPEN URL HELPER
  // ─────────────────────────────────────────────────────────────

  function _openUrl(url) {
    if (!url) return;
    try {
      if (window.Capacitor?.Plugins?.Browser) {
        window.Capacitor.Plugins.Browser.open({ url });
      } else {
        window.open(url, '_blank');
      }
    } catch (_) { window.open(url, '_blank'); }
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD BANNER AD CARD
  // ─────────────────────────────────────────────────────────────

  function _buildBannerCard(initialAd) {
    const wrapper = document.createElement('div');
    wrapper.className = 'scrap-ad-slot';

    let currentAd = initialAd;

    function getHTML(ad) {
      if (ad.imageUrl) {
        return `
          <div class="scrap-custom-ad ad-banner-layout" data-ad-id="${ad.id}"
               style="--ad-accent: ${ad.accentColor}; opacity: 1; transition: opacity 0.4s ease;">
             <div class="ad-label">Sponsored</div>
             <div class="ad-banner-img-container">
               <img src="${ad.imageUrl}" class="ad-banner-img" alt="${ad.title}">
             </div>
             <div class="ad-banner-footer">
               <div class="ad-body">
                 <div class="ad-title">${ad.title}</div>
                 <div class="ad-subtitle">${ad.subtitle}</div>
               </div>
               ${ad.ctaText
                 ? `<button class="ad-cta" style="background:${ad.ctaBgColor};color:#000;">
                      ${ad.ctaText}
                    </button>`
                 : ''}
             </div>
          </div>
        `;
      } else {
        return `
          <div class="scrap-custom-ad ad-standard-layout" data-ad-id="${ad.id}"
               style="--ad-accent: ${ad.accentColor}; opacity: 1; transition: opacity 0.4s ease;">
             <div class="ad-label">Sponsored</div>
             <div class="ad-icon">${ad.icon}</div>
             <div class="ad-body">
               <div class="ad-title">${ad.title}</div>
               <div class="ad-subtitle">${ad.subtitle}</div>
             </div>
             ${ad.ctaText
               ? `<button class="ad-cta" style="background:${ad.ctaBgColor};color:#000;">
                      ${ad.ctaText}
                    </button>`
               : ''}
          </div>
        `;
      }
    }

    wrapper.innerHTML = getHTML(currentAd);

    function bindClick(el, ad) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _openUrl(ad.ctaUrl);
      });
    }

    bindClick(wrapper.querySelector('.scrap-custom-ad'), currentAd);

    // Auto-scroll (cycle) ads dynamically if multiple ads are available and visible
    if (_ads.length > 1) {
      let intervalId = null;

      const startCycle = () => {
        if (intervalId) return;
        intervalId = setInterval(() => {
          if (!document.body.contains(wrapper)) {
            stopCycle();
            return;
          }

          const card = wrapper.querySelector('.scrap-custom-ad');
          if (!card) return;

          // Step 1: Fade out
          card.style.opacity = '0';

          // Step 2: Swap content and fade back in after transition completes
          setTimeout(() => {
            if (!document.body.contains(wrapper)) {
              stopCycle();
              return;
            }

            const currentIndex = _ads.findIndex(a => a.id === currentAd.id);
            const nextIndex = (currentIndex === -1 ? 0 : currentIndex + 1) % _ads.length;
            currentAd = _ads[nextIndex];

            wrapper.innerHTML = getHTML(currentAd);
            const newCard = wrapper.querySelector('.scrap-custom-ad');
            
            bindClick(newCard, currentAd);

            // Force a reflow to trigger opacity transition
            newCard.style.opacity = '0';
            newCard.getBoundingClientRect(); 
            newCard.style.opacity = '1';
          }, 400);

        }, 30000); // Transition every 30 seconds (compliant with ad refresh rate policies)
      };

      const stopCycle = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      // Set up IntersectionObserver to only refresh when ad card is in view
      if (window.IntersectionObserver) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              startCycle();
            } else {
              stopCycle();
            }
          });
        }, { threshold: 0.1 });
        
        observer.observe(wrapper);

        // Clean up observer if element is destroyed
        const destroyCheck = setInterval(() => {
          if (!document.body.contains(wrapper)) {
            observer.disconnect();
            stopCycle();
            clearInterval(destroyCheck);
          }
        }, 10000);
      } else {
        startCycle(); // Fallback if IntersectionObserver is not supported
      }
    }

    return wrapper;
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD VIDEO AD CARD (thumbnail → tap → fullscreen player)
  // ─────────────────────────────────────────────────────────────

  function _buildVideoCard(ad) {
    const wrapper = document.createElement('div');
    wrapper.className = 'scrap-ad-slot';

    const thumbHtml = ad.thumbnailUrl
      ? `<img src="${ad.thumbnailUrl}" class="ad-video-thumb" alt="${ad.title}">`
      : `<div class="ad-video-thumb-placeholder">${ad.icon}</div>`;

    wrapper.innerHTML = `
      <div class="scrap-video-ad" data-ad-id="${ad.id}"
           style="--ad-accent: ${ad.accentColor};">
        <div class="ad-label">Sponsored</div>
        <div class="ad-video-preview">
          ${thumbHtml}
          <div class="ad-video-play-btn">▶</div>
        </div>
        <div class="ad-body">
          <div class="ad-title">${ad.title}</div>
          <div class="ad-subtitle">${ad.subtitle || 'Tap to watch'}</div>
        </div>
      </div>
    `;

    wrapper.querySelector('.scrap-video-ad').addEventListener('click', (e) => {
      e.stopPropagation();
      _playVideoAd(ad);
    });

    return wrapper;
  }

  // ─────────────────────────────────────────────────────────────
  // FULLSCREEN VIDEO PLAYER
  // ─────────────────────────────────────────────────────────────

  function _playVideoAd(ad) {
    if (!ad.videoUrl) { _openUrl(ad.ctaUrl); return; }

    const overlay = document.createElement('div');
    overlay.className = 'scrap-video-overlay';

    const SKIP_AFTER = 5;
    let skipEnabled  = false;

    overlay.innerHTML = `
      <div class="scrap-video-container">
        <video id="scrap-ad-video" class="scrap-ad-video"
               autoplay playsinline src="${ad.videoUrl}">
        </video>
        <button id="scrap-video-skip" class="scrap-video-skip" disabled>
          <span id="scrap-skip-timer">${SKIP_AFTER}</span>s
        </button>
        <div class="scrap-video-sponsored">Sponsored</div>
        <div class="scrap-video-cta-bar">
          <div>
            <div class="scrap-video-ad-title">${ad.title}</div>
            <div class="scrap-video-ad-sub">${ad.subtitle}</div>
          </div>
          ${ad.ctaText
            ? `<button id="scrap-video-cta-btn" class="scrap-video-cta-btn"
                 style="background:${ad.ctaBgColor};color:#000;">
                 ${ad.ctaText}
               </button>`
            : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('scrap-video-overlay--visible'));

    const video   = overlay.querySelector('#scrap-ad-video');
    const skipBtn = overlay.querySelector('#scrap-video-skip');
    const timerEl = overlay.querySelector('#scrap-skip-timer');
    const ctaBtn  = overlay.querySelector('#scrap-video-cta-btn');

    const close = () => {
      clearInterval(countdown);
      video.pause();
      overlay.classList.remove('scrap-video-overlay--visible');
      setTimeout(() => overlay.remove(), 300);
    };

    let remaining = SKIP_AFTER;
    const countdown = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(countdown);
        skipEnabled = true;
        skipBtn.disabled = false;
        skipBtn.classList.add('scrap-video-skip--active');
        skipBtn.innerHTML = 'Skip ✕';
      }
    }, 1000);

    skipBtn.addEventListener('click', () => { if (skipEnabled) close(); });
    video.addEventListener('ended', close);
    video.addEventListener('error', close);
    ctaBtn?.addEventListener('click', () => { _openUrl(ad.ctaUrl); close(); });
  }

  // ─────────────────────────────────────────────────────────────
  // GET NEXT AD ELEMENT
  // ─────────────────────────────────────────────────────────────

  function _nextAdElement() {
    if (!_ads.length) return null;
    const ad   = _ads[_adIndex % _ads.length];
    _adIndex++;
    return ad.type === 'video' ? _buildVideoCard(ad) : _buildBannerCard(ad);
  }

  // ─────────────────────────────────────────────────────────────
  // INJECT ADS INTO ROOMS LIST
  // ─────────────────────────────────────────────────────────────

  function injectIntoRoomsList() {
    try {
      if (!_shouldShowAds()) {
        console.log('[ScrapAds] Skipping injection: ads are disabled for this user.');
        return;
      }

      if (_pendingInterstitial) {
        _pendingInterstitial = false;
        setTimeout(() => {
          _showInterstitialNow();
        }, 500);
      }

      const container = document.getElementById('rooms-container');
      if (!container) { console.warn('[ScrapAds] rooms-container not found'); return; }

      // Defer execution slightly to let rooms rendering fully settle and paint
      setTimeout(() => {
        // Clear any previously injected ad slots
        container.querySelectorAll('.scrap-ad-slot').forEach(s => s.remove());

        const roomCards = Array.from(container.children).filter(
          el => !el.classList.contains('scrap-ad-slot')
        );

        if (roomCards.length === 0 || _ads.length === 0) {
          console.log('[ScrapAds] No rooms or no ads to display.');
          return;
        }

        console.log(`[ScrapAds] Rooms found: ${roomCards.length} | Ads loaded: ${_ads.length} | Base Interval: ${_config.adEveryNRooms}`);

        let injected = 0;

        // Safeguard / Smart rule for short feeds:
        if (roomCards.length <= 2) {
          // If 1 or 2 rooms, display exactly 1 ad at the very end
          const el = _nextAdElement();
          if (el) {
            container.appendChild(el);
            injected++;
            console.log('[ScrapAds] Short list: injected 1 custom ad at the end.');
          }
          return;
        }

        // Standard feeding strategy for 3+ rooms:
        // 1. Inject inline ads at the configured interval
        roomCards.forEach((card, idx) => {
          if (injected >= _config.maxAdsInList) return;
          if ((idx + 1) % _config.adEveryNRooms === 0) {
            const el = _nextAdElement();
            if (el) {
              card.insertAdjacentElement('afterend', el);
              injected++;
            }
          }
        });

        // 2. "Scroll to End" Append:
        // If we haven't reached the maxAdsInList limit, and the very last element of the container is a Room Card (not an ad)
        // we append one final ad at the bottom of the container.
        if (injected < _config.maxAdsInList && injected < _ads.length) {
          const lastChild = container.lastElementChild;
          if (lastChild && !lastChild.classList.contains('scrap-ad-slot')) {
            const el = _nextAdElement();
            if (el) {
              container.appendChild(el);
              injected++;
              console.log('[ScrapAds] Feed end: appended 1 ad at the bottom of the list.');
            }
          }
        }

        console.log(`[ScrapAds] Total ads injected: ${injected}`);
      }, 50);
    } catch (e) {
      console.warn('[ScrapAds] injectIntoRoomsList error (non-fatal):', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // INTERSTITIAL — call after saving a memory
  // ─────────────────────────────────────────────────────────────

  async function onMemorySaved() {
    try {
      if (!_shouldShowAds()) return;

      _saveCount++;
      if (_saveCount % _config.interstitialEveryNSaves !== 0) return;

      console.log('[ScrapAds] Memory saved. Queuing interstitial ad for next natural break (returning to dashboard).');
      _pendingInterstitial = true;
    } catch (e) {
      console.warn('[ScrapAds] onMemorySaved error (non-fatal):', e);
    }
  }

  async function _showInterstitialNow() {
    try {
      if (!_shouldShowAds()) return;

      // If AdMob is enabled but no Interstitial ID is provided, skip interstitials completely
      if (_config.admobEnabled && !_config.admobInterstitialUnitId) {
        console.log('[ScrapAds] AdMob enabled but no Interstitial ID provided. Skipping interstitials.');
        return;
      }

      const now = Date.now();
      const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between interstitials
      if (now - _lastInterstitialTime < COOLDOWN_MS) {
        console.log('[ScrapAds] Skipping interstitial: cooling down to prevent user disturbance.');
        return;
      }

      _lastInterstitialTime = now;

      // Try AdMob first
      if (_config.admobEnabled && _admobReady && window.AdMob && _config.admobInterstitialUnitId) {
        try {
          await AdMob.prepareInterstitial({ adId: _config.admobInterstitialUnitId });
          await AdMob.showInterstitial();
          return;
        } catch (e) { console.warn('[ScrapAds] AdMob interstitial failed:', e); }
      }

      // Fallback to custom ad
      if (!_ads.length) return;
      const ad   = _ads[_adIndex % _ads.length];
      _adIndex++;

      if (ad.type === 'video') {
        _playVideoAd(ad);
      } else {
        _showBannerInterstitial(ad);
      }
    } catch (e) {
      console.warn('[ScrapAds] _showInterstitialNow error (non-fatal):', e);
    }
  }

  function _showBannerInterstitial(ad) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);
      display:flex;align-items:center;justify-content:center;
      padding:24px;opacity:0;transition:opacity 0.3s ease;
    `;

    const imgBlock = ad.imageUrl
      ? `<img src="${ad.imageUrl}"
           style="width:80px;height:80px;border-radius:16px;object-fit:cover;margin-bottom:14px;">`
      : `<div style="font-size:48px;margin-bottom:14px;">${ad.icon}</div>`;

    overlay.innerHTML = `
      <div style="
        background:linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02));
        border:1px solid rgba(255,255,255,0.1);border-radius:24px;
        padding:28px 20px 20px;width:100%;max-width:300px;
        text-align:center;position:relative;box-shadow:0 0 60px rgba(0,0,0,0.8);
      ">
        <button id="s-ad-skip" style="
          position:absolute;top:12px;right:12px;
          background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.5);
          font-size:10px;font-family:monospace;letter-spacing:1px;text-transform:uppercase;
          padding:4px 10px;border-radius:999px;cursor:pointer;
        ">Skip ✕</button>
        ${imgBlock}
        <div style="font-size:9px;color:rgba(255,255,255,0.35);text-transform:uppercase;
          letter-spacing:1.5px;font-family:monospace;margin-bottom:8px;">Sponsored</div>
        <div style="font-size:18px;font-weight:800;font-family:'Space Grotesk',sans-serif;
          color:rgba(255,255,255,0.95);margin-bottom:6px;">${ad.title}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.45);font-family:monospace;
          margin-bottom:20px;">${ad.subtitle}</div>
        ${ad.ctaText ? `<button id="s-ad-cta" style="
          background:${ad.ctaBgColor};color:#000;border:none;border-radius:999px;
          padding:12px 32px;font-size:12px;font-weight:800;
          font-family:'Space Grotesk',sans-serif;text-transform:uppercase;
          cursor:pointer;width:100%;">${ad.ctaText}</button>` : ''}
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    const close = () => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('#s-ad-skip')?.addEventListener('click', close);
    overlay.querySelector('#s-ad-cta')?.addEventListener('click', () => {
      _openUrl(ad.ctaUrl);
      close();
    });

    setTimeout(close, 6000);
  }

  // ─────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────

  async function init() {
    try {
      // If we are not authenticated yet, skip remote fetch (it will be called again in _finishLogin)
      if (window.pb && pb.authStore.isValid) {
        // Refresh auth to fetch latest user fields from DB (show_ads, ads_start_date)
        try {
          await pb.collection('users').authRefresh();
        } catch (e) {
          console.warn('[ScrapAds] User auth refresh failed, using cached model:', e);
        }



        if (!_shouldShowAds()) {
          console.log('[ScrapAds] Ads are disabled for this user. Clearing ads state.');
          _ads = [];
          
          // Remove any rendered ads immediately if ads were disabled
          const container = document.getElementById('rooms-container');
          if (container) {
            container.querySelectorAll('.scrap-ad-slot').forEach(s => s.remove());
          }
          return;
        }

        _ads = []; // Clear the old ads in-memory immediately so we don't display stale ones during loading!
        await Promise.all([_fetchAdConfig(), _fetchAds()]);
        await _initAdMob();
        console.log(`[ScrapAds] Ready | Ads: ${_ads.length} | AdMob: ${_config.admobEnabled}`);
        
        // Inject ads in case the dashboard room list has already rendered
        injectIntoRoomsList();
      } else {
        console.log('[ScrapAds] Initialized (waiting for auth)');
      }
    } catch (e) {
      console.warn('[ScrapAds] init error (non-fatal):', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────

  return {
    init,
    injectIntoRoomsList,
    onMemorySaved,
    showAdMobBanner: _showAdMobBanner,
    hideAdMobBanner: _hideAdMobBanner,
    getConfig: () => ({ ..._config }),
    getAds:    () => [..._ads],
  };
})();

// Expose to window explicitly
window.ScrapAds = ScrapAds;

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ScrapAds.init());
} else {
  ScrapAds.init();
}
