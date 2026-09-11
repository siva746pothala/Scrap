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
      title: '🏠 Welcome to Scrap Vault!',
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
      title: '🎨 Welcome to Scrap Canvas!',
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
      <div id="scrap-tour-spotlight"></div>
      <div id="scrap-tour-card">
        <div class="tour-card-header">
          <span class="tour-step-badge" id="tour-badge">STEP 1/6</span>
          <button class="tour-btn tour-btn-skip" id="tour-btn-skip">SKIP TOUR ✕</button>
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

    // Position spotlight around target element
    setTimeout(() => {
      const targetNode = document.querySelector(step.target);
      if (!targetNode || step.position === 'center' || targetNode.offsetWidth === 0 || targetNode.offsetHeight === 0) {
        // Fallback or center position
        spotlightEl.style.width = '0px';
        spotlightEl.style.height = '0px';
        spotlightEl.style.opacity = '0';
        
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
        cardTop = Math.min(spotTop + spotHeight + 16, viewportHeight - cardRect.height - 20);
        if (step.position === 'bottom-left') {
          cardLeft = Math.max(16, spotLeft);
        } else {
          cardLeft = Math.min(viewportWidth - cardRect.width - 16, spotLeft + spotWidth - cardRect.width);
        }
      } else if (step.position === 'top-center') {
        cardTop = Math.max(16, spotTop - cardRect.height - 20);
        cardLeft = (viewportWidth - cardRect.width) / 2;
      }

      cardEl.style.left = `${Math.max(12, Math.min(cardLeft, viewportWidth - cardRect.width - 12))}px`;
      cardEl.style.top = `${Math.max(12, Math.min(cardTop, viewportHeight - cardRect.height - 12))}px`;
    }, 50);
  }

  function startTour(mode = 'canvas', force = false) {
    currentTourMode = mode;
    const storageKey = getStorageKey();
    if (!force) {
      const completed = localStorage.getItem(storageKey);
      if (completed === 'true') return;
    }

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
    setTimeout(() => {
      startTour('canvas', false);
    }, 600);
  }

  function initDashboardOnboarding() {
    setTimeout(() => {
      startTour('dashboard', false);
    }, 600);
  }

  return {
    start: function (mode = 'canvas', force = true) { startTour(mode, force); },
    startDashboard: function (force = true) { startTour('dashboard', force); },
    startCanvas: function (force = true) { startTour('canvas', force); },
    initDashboardOnboarding: initDashboardOnboarding,
    initCanvasOnboarding: initCanvasOnboarding,
    initOnboarding: initCanvasOnboarding,
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
