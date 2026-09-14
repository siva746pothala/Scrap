/**
 * ==========================================================================
 * Scrap App - Interactive Canvas & Room Dashboard Tour Guide Module (js/tour.js)
 * ==========================================================================
 * Fully isolated tour guide engine that guides users through every single menu button
 * on both the Room List Dashboard and the Live Canvas without interfering with canvas logic.
 */

window.ScrapTour = (function () {
  'use strict';

  const STORAGE_KEY_CANVAS = 'scrap_tour_completed';
  const STORAGE_KEY_DASHBOARD = 'scrap_dashboard_tour_completed';

  // Step definitions for Room List Dashboard
  const DASHBOARD_STEPS = [
    {
      id: 'step-dashboard-welcome',
      target: '#dashboard-welcome',
      title: '🏠 Welcome to Mitrava Vault!',
      description: 'Your central hub! Here you can view your active canvas rooms, squad spaces, and account settings.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'step-dashboard-avatar',
      target: '#dashboard-avatar-container',
      title: '👤 Profile & Avatar',
      description: 'View your profile avatar and user status header.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'step-dashboard-settings',
      target: '#btn-dashboard-settings',
      title: '⚙️ Vault Settings',
      description: 'Customize app themes, manage encryption keys, and log out or adjust vault preferences.',
      position: 'bottom-right',
      requiresMenu: false
    },
    {
      id: 'step-dashboard-rooms',
      target: '#rooms-container',
      title: '🎨 Active Rooms & Vaults',
      description: 'Tap on any room card in this list to enter your interactive multiplayer canvas board!',
      position: 'center',
      requiresMenu: false
    },
    {
      id: 'step-dashboard-helper',
      target: '#btn-dashboard-helper',
      title: '🤖 AI Helper Robot',
      description: 'Drag this floating robot anywhere on your screen, or tap it to reveal/hide your rooms list.',
      position: 'bottom-right',
      requiresMenu: false
    },
    {
      id: 'step-dashboard-fab',
      target: '#btn-fab-actions',
      title: '➕ Create & Join Rooms',
      description: 'Tap this action button anytime to create a new canvas room or scan a QR code to join friends!',
      position: 'top-center',
      requiresMenu: false
    }
  ];

  // Step definitions for every exact menu button on the canvas
  const CANVAS_STEPS = [
    {
      id: 'step-welcome',
      target: '#canvas-workspace',
      title: '🎨 Welcome to Mitrava Canvas!',
      description: 'Your interactive multiplayer space. Let’s quickly tour every menu button so you can master your board!',
      position: 'center',
      requiresMenu: false
    },
    {
      id: 'btn-canvas-back',
      target: '#btn-canvas-back',
      title: '◀ Exit Canvas',
      description: 'Tap here anytime to leave the canvas and return back to your dashboard workspace.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'canvas-room-title',
      target: '#canvas-room-title',
      title: '🟢 Room Status & Title',
      description: 'Shows your current room name and live connection indicator showing active online status.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'btn-toggle-members',
      target: '#btn-toggle-members',
      title: '👥 Room Squad Members',
      description: 'Open the active members sidebar panel to view who is currently live in this canvas with you.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'btn-room-scrapbook',
      target: '#btn-room-scrapbook',
      title: '📖 Shared Scrapbook',
      description: 'Access the room scrapbook viewer to look through saved history and memories created together.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'btn-room-mood',
      target: '#btn-room-mood',
      title: '📡 Mood Radar',
      description: 'Broadcast live mood radar signals and view real-time emotional reactions from your squad.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'canvas-date-picker',
      target: '#canvas-date-picker',
      title: '📅 Date Picker Filter',
      description: 'Filter elements on your canvas board by specific creation dates.',
      position: 'bottom-left',
      requiresMenu: false
    },
    {
      id: 'btn-hud-toggle-menu',
      target: '#btn-hud-toggle-menu',
      title: '⚙️ Options Gear Menu',
      description: 'Tap this gear icon to toggle the vertical options menu for room management.',
      position: 'bottom-right',
      requiresMenu: false
    },
    {
      id: 'btn-show-invite',
      target: '#btn-show-invite',
      title: '👥 Invite Squad',
      description: 'Generates your room invite QR code and link so friends can join your space.',
      position: 'bottom-right',
      requiresMenu: true
    },
    {
      id: 'btn-show-security',
      target: '#btn-show-security',
      title: '🔐 Security & Key Hashes',
      description: 'Inspect End-to-End Encryption key hashes confirming your canvas data is 100% private.',
      position: 'bottom-right',
      requiresMenu: true
    },
    {
      id: 'btn-export-backup',
      target: '#btn-export-backup',
      title: '💾 Cryptographic Backup',
      description: 'Export an encrypted cryptographic backup file of your entire canvas room to local storage.',
      position: 'bottom-right',
      requiresMenu: true
    },
    {
      id: 'btn-canvas-recenter',
      target: '#btn-canvas-recenter',
      title: '🎯 Recenter View',
      description: 'Instantly resets your canvas view back to the center origin point if you ever get lost.',
      position: 'bottom-right',
      requiresMenu: true
    },
    {
      id: 'btn-leave-room',
      target: '#btn-leave-room',
      title: '🚪 Leave Space',
      description: 'Safely disconnect from the active multiplayer room.',
      position: 'bottom-right',
      requiresMenu: true
    },
    {
      id: 'tool-camera',
      target: '#tool-camera',
      title: '📸 Snap / Upload Image',
      description: 'Capture a quick camera photo or upload an image file directly onto your canvas.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-text',
      target: '#tool-text',
      title: '📝 Text Sticker',
      description: 'Add customizable colored sticky notes and text blocks anywhere on your board.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-doodle',
      target: '#tool-doodle',
      title: '✏️ Pencil Doodle',
      description: 'Open the full-screen neon drawing drawer to paint sketches with sparkle and glow effects.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-emoji',
      target: '#tool-emoji',
      title: '😀 Emoji Reactions',
      description: 'Drop large animated emoji stickers directly onto your canvas elements.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-link',
      target: '#tool-link',
      title: '🔗 Element Connector',
      description: 'Draw connecting lines and arrows between related canvas stickies and photos.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-voice',
      target: '#tool-voice',
      title: '🎤 Voice Notes',
      description: 'Record audio voice clips directly into your canvas items that anyone in the room can play.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-video',
      target: '#tool-video',
      title: '📹 Video Stickers',
      description: 'Record or attach playable video clips right onto your collage board.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'tool-container',
      target: '#tool-container',
      title: '📦 Group Containers',
      description: 'Create organized grouping frames to group multiple notes and items together.',
      position: 'top-center',
      requiresMenu: false
    },
    {
      id: 'step-zoom-info',
      target: '#canvas-workspace',
      title: '🔍 Touch Gestures & Zooming',
      description: 'Drag anywhere on the background to pan. Use two fingers to pinch-zoom in and out freely!',
      position: 'center',
      requiresMenu: false
    }
  ];

  let currentTourMode = 'canvas'; // 'dashboard' or 'canvas'
  let currentStepIndex = 0;
  let tourOverlayEl = null;
  let spotlightEl = null;
  let cardEl = null;
  let isActive = false;

  function getCurrentSteps() {
    return currentTourMode === 'dashboard' ? DASHBOARD_STEPS : CANVAS_STEPS;
  }

  function getStorageKey() {
    return currentTourMode === 'dashboard' ? STORAGE_KEY_DASHBOARD : STORAGE_KEY_CANVAS;
  }

  function createTourDOM() {
    if (document.getElementById('scrap-tour-overlay')) return;

    tourOverlayEl = document.createElement('div');
    tourOverlayEl.id = 'scrap-tour-overlay';
    tourOverlayEl.innerHTML = `
      <div class="tour-backdrop" id="tour-backdrop-area"></div>
      <svg id="tour-arrow-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#39ff14" id="tour-arrow-head"/>
          </marker>
        </defs>
        <path id="tour-arrow-line" d="M0,0 Q0,0 0,0" marker-end="url(#arrow-head)"/>
      </svg>
      <div id="scrap-tour-spotlight"></div>
      <div id="scrap-tour-card">
        <div class="tour-card-header">
          <span class="tour-step-badge" id="tour-badge">STEP 1/6</span>
          <button class="tour-btn tour-btn-skip" id="tour-btn-skip">SKIP TOUR ✕</button>
        </div>
        <div class="tour-arrow-label" id="tour-arrow-label">
          <span class="tour-arrow-label-dot"></span>
          <span id="tour-arrow-label-text">TARGET MENU</span>
        </div>
        <div class="tour-step-title" id="tour-title">Welcome</div>
        <div class="tour-step-description" id="tour-desc">Description</div>
        <div class="tour-controls">
          <button class="tour-btn tour-btn-prev" id="tour-btn-prev">PREV</button>
          <button class="tour-btn tour-btn-next" id="tour-btn-next">NEXT ▶</button>
        </div>
      </div>
    `;

    document.body.appendChild(tourOverlayEl);

    spotlightEl = document.getElementById('scrap-tour-spotlight');
    cardEl = document.getElementById('scrap-tour-card');

    document.getElementById('tour-btn-next').addEventListener('click', nextStep);
    document.getElementById('tour-btn-prev').addEventListener('click', prevStep);
    document.getElementById('tour-btn-skip').addEventListener('click', endTour);

    // Prevent direct canvas/screen touch triggers when tapping tour buttons
    cardEl.addEventListener('touchstart', (e) => e.stopPropagation());
    cardEl.addEventListener('touchmove', (e) => e.stopPropagation());
    cardEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    cardEl.addEventListener('wheel', (e) => e.stopPropagation());
  }

  function ensureMenuState(requiresMenu) {
    const menuEl = document.getElementById('hud-collapsible-menu');
    if (!menuEl) return;

    const steps = getCurrentSteps();
    if (requiresMenu) {
      menuEl.classList.remove('hidden');
    } else {
      const currentStep = steps[currentStepIndex];
      if (currentStep && currentStep.target === '#btn-hud-toggle-menu') {
        menuEl.classList.add('hidden');
      }
    }
  }

  function renderStep(index) {
    const steps = getCurrentSteps();
    if (index < 0 || index >= steps.length) return;
    currentStepIndex = index;
    const step = steps[index];

    ensureMenuState(step.requiresMenu);

    const badgeEl = document.getElementById('tour-badge');
    const titleEl = document.getElementById('tour-title');
    const descEl = document.getElementById('tour-desc');
    const prevBtn = document.getElementById('tour-btn-prev');
    const nextBtn = document.getElementById('tour-btn-next');

    badgeEl.textContent = `STEP ${index + 1}/${steps.length}`;
    titleEl.textContent = step.title;
    descEl.textContent = step.description;

    prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = index === steps.length - 1 ? 'FINISH 🎉' : 'NEXT ▶';

    // Rebind tour navigation buttons to clean functions
    const newNext = nextBtn.cloneNode(true);
    const newPrev = prevBtn.cloneNode(true);
    const skipBtn = document.getElementById('tour-btn-skip');

    nextBtn.parentNode.replaceChild(newNext, nextBtn);
    prevBtn.parentNode.replaceChild(newPrev, prevBtn);

    newNext.addEventListener('click', nextStep);
    newPrev.addEventListener('click', prevStep);

    if (skipBtn) {
      const newSkip = skipBtn.cloneNode(true);
      skipBtn.parentNode.replaceChild(newSkip, skipBtn);
      newSkip.addEventListener('click', endTour);
    }

    // Position spotlight around target element
    setTimeout(() => {
      const targetNode = document.querySelector(step.target);
      if (!targetNode || step.position === 'center' || targetNode.offsetWidth === 0 || targetNode.offsetHeight === 0) {
        // Fallback or center position
        spotlightEl.style.width = '0px';
        spotlightEl.style.height = '0px';
        spotlightEl.style.opacity = '0';
        const arrowLine = document.getElementById('tour-arrow-line');
        if (arrowLine) arrowLine.setAttribute('d', 'M0,0 Q0,0 0,0');
        
        cardEl.style.top = '50%';
        cardEl.style.left = '50%';
        cardEl.style.transform = 'translate(-50%, -50%)';
        return;
      }

      spotlightEl.style.opacity = '1';
      const rect = targetNode.getBoundingClientRect();
      const padding = 8;
      const spotWidth = rect.width + padding * 2;
      const spotHeight = rect.height + padding * 2;
      const spotLeft = rect.left - padding;
      const spotTop = rect.top - padding;

      spotlightEl.style.width = `${spotWidth}px`;
      spotlightEl.style.height = `${spotHeight}px`;
      spotlightEl.style.left = `${spotLeft}px`;
      spotlightEl.style.top = `${spotTop}px`;
      spotlightEl.style.borderRadius = `${Math.min(spotWidth, spotHeight) / 2}px`;

      // Position Tooltip Card dynamically
      cardEl.style.transform = 'none';
      const cardRect = cardEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let cardLeft = (viewportWidth - cardRect.width) / 2;
      let cardTop = (viewportHeight - cardRect.height) / 2;

      if (step.position === 'bottom-left' || step.position === 'bottom-right') {
        cardTop = Math.min(spotTop + spotHeight + 24, viewportHeight - cardRect.height - 20);
        if (step.position === 'bottom-left') {
          cardLeft = Math.max(16, spotLeft);
        } else {
          cardLeft = Math.min(viewportWidth - cardRect.width - 16, spotLeft + spotWidth - cardRect.width);
        }
      } else if (step.position === 'top-center') {
        cardTop = Math.max(16, spotTop - cardRect.height - 24);
        cardLeft = (viewportWidth - cardRect.width) / 2;
      }

      const finalCardLeft = Math.max(12, Math.min(cardLeft, viewportWidth - cardRect.width - 12));
      const finalCardTop = Math.max(12, Math.min(cardTop, viewportHeight - cardRect.height - 12));
      cardEl.style.left = `${finalCardLeft}px`;
      cardEl.style.top = `${finalCardTop}px`;

      // Calculate SVG Arrow curve from Card edge to Target Center
      const arrowLine = document.getElementById('tour-arrow-line');
      const arrowLabel = document.getElementById('tour-arrow-label');
      const arrowLabelText = document.getElementById('tour-arrow-label-text');

      if (arrowLine && arrowLabel) {
        if (step.position === 'center') {
          arrowLine.setAttribute('d', 'M0,0 Q0,0 0,0');
        } else {
          arrowLabelText.textContent = `POINTING TO: ${step.title.toUpperCase()}`;
          
          // Target center
          const targetCenterX = rect.left + rect.width / 2;
          const targetCenterY = rect.top + rect.height / 2;

          // Card edge point depending on relative position
          const updatedCardRect = {
            left: finalCardLeft,
            top: finalCardTop,
            width: cardRect.width,
            height: cardRect.height
          };

          let startX = updatedCardRect.left + updatedCardRect.width / 2;
          let startY = updatedCardRect.top;

          if (targetCenterY > updatedCardRect.top + updatedCardRect.height) {
            // Target is below card
            startY = updatedCardRect.top + updatedCardRect.height;
          } else if (targetCenterY < updatedCardRect.top) {
            // Target is above card
            startY = updatedCardRect.top;
          }

          // Calculate outer circle edge target point so arrow head stops AT the outer spotlight boundary, not inside the element/image
          let endX = targetCenterX;
          let endY = targetCenterY;

          if (targetCenterY > startY) {
            // Pointing down to target -> stop at top outer edge of spotlight circle
            endY = spotTop - 2;
          } else if (targetCenterY < startY) {
            // Pointing up to target -> stop at bottom outer edge of spotlight circle
            endY = spotTop + spotHeight + 2;
          } else {
            // Side positioning
            endX = startX > targetCenterX ? spotLeft + spotWidth + 2 : spotLeft - 2;
          }

          // Control point for smooth curve
          const controlX = (startX + endX) / 2 + (endX > startX ? 20 : -20);
          const controlY = (startY + endY) / 2;

          arrowLine.setAttribute('d', `M ${startX},${startY} Q ${controlX},${controlY} ${endX},${endY}`);
        }
      }
    }, 50);
  }

  function isUpdateModalActive() {
    return !!(window.isUpdateModalActive || document.getElementById('mitrava-update-modal'));
  }

  function startTour(mode = 'canvas', force = false) {
    if (isUpdateModalActive()) {
      console.log('⚡ [ScrapTour] Update alert modal active. Skipping tour guide.');
      return;
    }
    currentTourMode = mode;
    const storageKey = getStorageKey();
    if (!force) {
      const completed = localStorage.getItem(storageKey);
      if (completed === 'true') return;
    }

    // Clean up any active date field tooltips or banners when tour guide starts
    const emptyBanner = document.getElementById('canvas-empty-date-info-banner');
    if (emptyBanner) emptyBanner.remove();

    const emptySvg = document.getElementById('canvas-empty-date-arrow-svg');
    if (emptySvg) emptySvg.remove();

    const photoTip = document.getElementById('canvas-photo-longpress-tip');
    if (photoTip) photoTip.remove();

    createTourDOM();
    isActive = true;
    currentStepIndex = 0;
    if (tourOverlayEl) {
      tourOverlayEl.style.display = 'block';
      tourOverlayEl.style.pointerEvents = 'auto';
      // Force reflow for smooth opacity transition
      tourOverlayEl.offsetHeight;
      tourOverlayEl.classList.add('tour-active');
    }
    renderStep(0);
  }

  function nextStep() {
    const steps = getCurrentSteps();
    if (currentStepIndex < steps.length - 1) {
      renderStep(currentStepIndex + 1);
    } else {
      endTour();
    }
  }

  function prevStep() {
    if (currentStepIndex > 0) {
      renderStep(currentStepIndex - 1);
    }
  }

  function endTour() {
    isActive = false;
    if (tourOverlayEl) {
      tourOverlayEl.classList.remove('tour-active');
      tourOverlayEl.style.pointerEvents = 'none';
      setTimeout(() => {
        if (!isActive && tourOverlayEl) {
          tourOverlayEl.style.display = 'none';
        }
      }, 350);
    }
    // Close options menu if opened by tour
    const menuEl = document.getElementById('hud-collapsible-menu');
    if (menuEl) menuEl.classList.add('hidden');

    localStorage.setItem(getStorageKey(), 'true');
  }

  function initCanvasOnboarding() {
    if (isUpdateModalActive()) return;
    setTimeout(() => {
      if (isUpdateModalActive()) return;
      startTour('canvas', false);
    }, 600);
  }

  function initDashboardOnboarding() {
    if (isUpdateModalActive()) return;
    setTimeout(() => {
      if (isUpdateModalActive()) return;
      startTour('dashboard', false);
    }, 600);
  }

  function showTip(options = {}) {
    if (isUpdateModalActive()) {
      console.log('⚡ [ScrapTour] Update alert modal active. Skipping tip.');
      return;
    }
    createTourDOM();
    isActive = true;

    const {
      targetElement = null,
      title = '',
      message = '',
      position = 'center',
      stepIndex = 1,
      totalSteps = 1,
      onDismiss = null
    } = options;

    if (tourOverlayEl) {
      tourOverlayEl.style.display = 'block';
      tourOverlayEl.style.pointerEvents = 'auto';
      tourOverlayEl.offsetHeight;
      tourOverlayEl.classList.add('tour-active');
    }

    const badgeEl = document.getElementById('tour-badge');
    const titleEl = document.getElementById('tour-title');
    const descEl = document.getElementById('tour-desc');
    const prevBtn = document.getElementById('tour-btn-prev');
    const nextBtn = document.getElementById('tour-btn-next');
    const arrowLine = document.getElementById('tour-arrow-line');

    if (badgeEl) badgeEl.textContent = `TIP ${stepIndex}/${totalSteps}`;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;

    if (prevBtn) prevBtn.style.visibility = 'hidden';
    if (nextBtn) nextBtn.textContent = 'GOT IT 👍';

    // Position Card dynamically or center on screen
    setTimeout(() => {
      let targetNode = null;
      if (typeof targetElement === 'string') {
        targetNode = document.querySelector(targetElement);
      } else if (targetElement && targetElement.nodeType) {
        targetNode = targetElement;
      }

      if (!targetNode || position === 'center' || targetNode.offsetWidth === 0 || targetNode.offsetHeight === 0) {
        if (spotlightEl) {
          spotlightEl.style.width = '0px';
          spotlightEl.style.height = '0px';
          spotlightEl.style.opacity = '0';
        }
        if (arrowLine) arrowLine.setAttribute('d', 'M0,0 Q0,0 0,0');

        if (cardEl) {
          cardEl.style.position = 'fixed';
          cardEl.style.top = '50%';
          cardEl.style.left = '50%';
          cardEl.style.transform = 'translate(-50%, -50%)';
        }
        return;
      }

      if (spotlightEl) spotlightEl.style.opacity = '1';
      const rect = targetNode.getBoundingClientRect();
      const padding = 8;
      const spotWidth = rect.width + padding * 2;
      const spotHeight = rect.height + padding * 2;
      const spotLeft = rect.left - padding;
      const spotTop = rect.top - padding;

      if (spotlightEl) {
        spotlightEl.style.width = `${spotWidth}px`;
        spotlightEl.style.height = `${spotHeight}px`;
        spotlightEl.style.left = `${spotLeft}px`;
        spotlightEl.style.top = `${spotTop}px`;
        spotlightEl.style.borderRadius = `${Math.min(spotWidth, spotHeight) / 2}px`;
      }

      if (cardEl) {
        cardEl.style.transform = 'none';
        const cardRect = cardEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let cardLeft = (viewportWidth - cardRect.width) / 2;
        let cardTop = (viewportHeight - cardRect.height) / 2;

        if (position === 'bottom-left' || position === 'bottom-right') {
          cardTop = Math.min(spotTop + spotHeight + 24, viewportHeight - cardRect.height - 20);
          if (position === 'bottom-left') {
            cardLeft = Math.max(16, spotLeft);
          } else {
            cardLeft = Math.min(viewportWidth - cardRect.width - 16, spotLeft + spotWidth - cardRect.width);
          }
        } else if (position === 'top-center') {
          cardTop = Math.max(16, spotTop - cardRect.height - 24);
          cardLeft = (viewportWidth - cardRect.width) / 2;
        }

        const finalCardLeft = Math.max(12, Math.min(cardLeft, viewportWidth - cardRect.width - 12));
        const finalCardTop = Math.max(12, Math.min(cardTop, viewportHeight - cardRect.height - 12));
        cardEl.style.left = `${finalCardLeft}px`;
        cardEl.style.top = `${finalCardTop}px`;
      }
    }, 50);

    const handleDismiss = () => {
      endTour();
      if (typeof onDismiss === 'function') onDismiss();
    };

    if (nextBtn) {
      const newNext = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNext, nextBtn);
      newNext.addEventListener('click', handleDismiss);
    }
  }

  return {
    start: function (mode = 'canvas', force = true) { startTour(mode, force); },
    startDashboard: function (force = true) { startTour('dashboard', force); },
    startCanvas: function (force = true) { startTour('canvas', force); },
    initDashboardOnboarding: initDashboardOnboarding,
    initCanvasOnboarding: initCanvasOnboarding,
    initOnboarding: initCanvasOnboarding,
    showTip: showTip,
    isActive: function () { return isActive; },
    cleanup: endTour,
    next: nextStep,
    prev: prevStep,
    end: endTour
  };
})();

// Global event listener for Replay Tour Guide button
document.addEventListener('click', (e) => {
  const replayBtn = e.target.closest('#btn-replay-tour');
  if (replayBtn && window.ScrapTour) {
    const isDashboardVisible = !document.getElementById('screen-dashboard')?.classList.contains('hidden');
    window.ScrapTour.start(isDashboardVisible ? 'dashboard' : 'canvas', true);
  }
});
