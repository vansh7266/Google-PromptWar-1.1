'use strict';

/**
 * StadiumPulse — Pro-Grade Modular Application Logic
 * Optimized for Accessibility, Efficiency, and Google Services.
 *
 * @module app
 * @description Client-side logic for StadiumPulse PWA. Handles navigation,
 * data loading, Google Maps integration, AI chat, and accessibility preferences.
 */

/* =============================================================
   1. CONFIGURATION & STATE
   ============================================================= */

/**
 * Central application state store.
 * All UI-driving data lives here for a single source of truth.
 * @type {Object}
 */
const AppState = {
  currentView: 'dashboard',
  stadiums: [],
  selectedStadium: '',
  queues: [],
  crowds: [],
  alerts: [],
  schedule: [],
  phase: '',
  config: null,
  mapLoaded: false,
  mapLayer: 'heatmap',
  chatHistory: [],
  chatPending: false,
  preferences: { largeText: false, highContrast: false, calmMotion: false },
  queueFilter: 'all',
  previousMetrics: {
    avgCrowd: null,
    avgWait: null
  },
  lastUpdated: {},
  refreshTimers: {}
};

/** @const {string} API base URL (empty for same-origin) */
const API_BASE = '';

/** @const {number} Auto-refresh interval in milliseconds */
const REFRESH_INTERVAL = 30000;

/** @const {string} Default venue timezone */
const VENUE_TIMEZONE = 'Asia/Kolkata';

/** @const {string} Default locale for formatting */
const VENUE_LOCALE = 'en-IN';

/** @type {Map<string, Promise>} Cache for loaded script promises */
const ScriptPromises = new Map();

/** @const {string} LocalStorage key for stadium selection */
const STADIUM_STORAGE_KEY = 'stadiumpulse.selected-stadium';

/** @const {string} LocalStorage key for user preferences */
const PREFERENCE_STORAGE_KEY = 'stadiumpulse.preferences';

/** @type {number|null} Dashboard auto-refresh timer ID */
let dashboardRefreshTimer = null;

/** @const {string} DOM id for the Google Maps script tag */
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-script';

/** @const {number} Maximum time to wait for Google Maps to initialize */
const GOOGLE_MAPS_TIMEOUT_MS = 12000;

/* =============================================================
   2. UTILITY & ACCESSIBILITY HELPERS
   ============================================================= */

/**
 * Announces a message to screen readers via the live region.
 * Uses requestAnimationFrame to ensure the DOM change is picked up.
 * @param {string} message - The message to announce
 */
function announce(message) {
  const el = document.getElementById('live-announcer');
  if (el) {
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
  }
}

/**
 * Sanitizes a string to prevent XSS by escaping HTML entities.
 * @param {string} str - Raw string input
 * @returns {string} Escaped HTML-safe string
 */
function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Formats a timestamp into a human-readable time string.
 * @param {number|string} ts - Timestamp or ISO string
 * @param {Object} [options={}] - Additional Intl.DateTimeFormat options
 * @returns {string} Formatted time string
 */
function formatTime(ts, options = {}) {
  const d = new Date(ts);
  return new Intl.DateTimeFormat(VENUE_LOCALE, {
    timeZone: AppState.config?.venue?.timeZone || VENUE_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options
  }).format(d);
}

/**
 * Builds a full API URL with the stadium query parameter.
 * @param {string} url - API path (e.g., '/api/queues')
 * @param {string} [stadiumSlug] - Stadium slug override
 * @returns {string} Complete URL path with query string
 */
function buildApiUrl(url, stadiumSlug = AppState.selectedStadium) {
  const absolute = new URL(`${API_BASE}${url}`, window.location.origin);
  if (stadiumSlug && absolute.pathname !== '/api/stadiums') {
    absolute.searchParams.set('stadium', stadiumSlug);
  }
  return `${absolute.pathname}${absolute.search}`;
}

/**
 * Fetches JSON data from the API with error handling.
 * @param {string} url - API endpoint path
 * @param {Object} [options={}] - Fetch options (method, body, etc.)
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If the response is not ok
 */
async function apiFetch(url, options = {}) {
  try {
    const { stadium, ...fetchOptions } = options;
    const res = await fetch(buildApiUrl(url, stadium), {
      headers: { 'Content-Type': 'application/json' },
      ...fetchOptions
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    console.error(`API error [${url}]:`, err.message);
    throw err;
  }
}

/**
 * Creates a debounced version of a function.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* =============================================================
   3. NAVIGATION & VIEW MANAGEMENT
   ============================================================= */

/**
 * Navigates to a new view tab, updating the UI and loading view-specific data.
 * @param {string} viewId - The view identifier (e.g., 'dashboard', 'map', 'queues')
 */
function navigateTo(viewId) {
  if (AppState.currentView === viewId) return;

  AppState.currentView = viewId;

  // Update tab states
  document.querySelectorAll('.nav-item').forEach(btn => {
    const isActive = btn.dataset.view === viewId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // Update section visibility
  document.querySelectorAll('.view').forEach(section => {
    section.classList.toggle('active', section.id === `view-${viewId}`);
  });

  // Load view-specific data
  if (viewId === 'map') {
    if (!AppState.mapLoaded) initMap();
    else refreshCrowdData();
  } else if (viewId === 'queues') {
    loadQueues();
  } else if (viewId === 'schedule') {
    loadSchedule();
  }

  // Accessibility: focus the view heading and announce
  const newViewHeader = document.querySelector(`#view-${viewId} .view-title`);
  if (newViewHeader) newViewHeader.focus();

  announce(`Switched to ${viewId} view`);
  window.scrollTo(0, 0);
}

/**
 * Initializes bottom navigation click handlers and keyboard navigation.
 */
function initNav() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));

    // Arrow key navigation between tabs
    btn.addEventListener('keydown', (e) => {
      const items = Array.from(navItems);
      const index = items.indexOf(btn);
      let nextIndex = -1;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (index + 1) % items.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (index - 1 + items.length) % items.length;
      }

      if (nextIndex >= 0) {
        e.preventDefault();
        items[nextIndex].focus();
        navigateTo(items[nextIndex].dataset.view);
      }
    });
  });
}

/**
 * Scrolls an element into view with header offset compensation.
 * @param {HTMLElement} el - Target element to scroll to
 */
function smartScrollIntoView(el) {
  if (!el) return;
  const headerOffset = 70;
  const elementPosition = el.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
  window.scrollTo({
    top: offsetPosition,
    behavior: AppState.preferences.calmMotion ? 'auto' : 'smooth'
  });
}

/**
 * Updates the navigation badge for active alerts.
 */
function updateAlertBadge() {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  if (AppState.alerts && AppState.alerts.length > 0) {
    badge.style.display = 'flex';
    badge.textContent = AppState.alerts.length;
    badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 300 });
  } else {
    badge.style.display = 'none';
    badge.textContent = '0';
  }
}

/* =============================================================
   4. DATA LOADING & RENDERING
   ============================================================= */

/**
 * Fetches and renders the stadium catalog dropdown.
 * Restores previously selected stadium from localStorage.
 */
async function loadStadiumCatalog() {
  try {
    const data = await apiFetch('/api/stadiums');
    AppState.stadiums = data.stadiums;

    const select = document.getElementById('stadium-select');
    if (!select) return;

    select.innerHTML = AppState.stadiums.map(s => `
      <option value="${s.slug}" ${s.slug === data.defaultStadium ? 'selected' : ''}>
        ${sanitize(s.name)}
      </option>
    `).join('');

    const stored = loadSelectedStadiumFromStorage();
    if (stored && AppState.stadiums.find(s => s.slug === stored)) {
      select.value = stored;
      AppState.selectedStadium = stored;
    } else {
      AppState.selectedStadium = data.defaultStadium;
    }

    select.addEventListener('change', (e) => switchStadium(e.target.value));
  } catch (err) {
    console.error('Catalog load failed:', err);
  }
}

/**
 * Switches the active stadium and reloads all data.
 * @param {string} slug - Stadium slug identifier
 */
async function switchStadium(slug) {
  if (slug === AppState.selectedStadium) return;
  AppState.selectedStadium = slug;
  saveSelectedStadium(slug);
  AppState.config = null;
  AppState.mapLoaded = false;
  AppState.mapLayer = 'heatmap';
  syncMapFilterState('heatmap');
  map = null;
  clearHeatmap();
  clearMarkers(zoneMarkers);
  clearMarkers(facilityMarkers);

  announce(`Switching to ${slug} stadium data`);
  await loadConfig();
  await loadDashboard();
  if (AppState.currentView === 'map') initMap();
}

/**
 * Loads the venue configuration from the API and renders dependent UI sections.
 */
async function loadConfig() {
  try {
    const data = await apiFetch('/api/config');
    AppState.config = data;
    AppState.phase = data.phase;
    renderStadiumMeta();
    renderVenueStatus();
    renderChatWelcome();
    renderSuggestedQuestions();
    renderAccessibilityPanel();
  } catch (err) {
    console.error('Config load failed:', err);
  }
}

/**
 * Loads dashboard data (queues, crowds, alerts) in parallel and renders metrics.
 */
async function loadDashboard() {
  try {
    updateVenueClock();
    const [queuesData, crowdsData, alertsData] = await Promise.all([
      apiFetch('/api/queues'),
      apiFetch('/api/crowds'),
      apiFetch('/api/alerts')
    ]);

    AppState.queues = queuesData.queues;
    AppState.crowds = crowdsData.zones;
    AppState.alerts = alertsData.alerts;
    AppState.phase = queuesData.phase;
    AppState.lastUpdated.queues = queuesData.updatedAt;
    AppState.lastUpdated.crowds = crowdsData.updatedAt;
    AppState.lastUpdated.alerts = alertsData.updatedAt;

    renderDashboardMetrics();
    renderAlerts();
    renderStadiumMeta();
    renderVenueStatus();
    renderInsight();
    updateQueueRefreshTime(queuesData.updatedAt);
  } catch (err) {
    console.error('Dashboard load failed:', err);
  }
}

/**
 * Renders the dashboard metric cards with computed averages and trends.
 */
function renderDashboardMetrics() {
  if (!AppState.queues.length || !AppState.crowds.length) return;

  const avgWait = Math.round(AppState.queues.reduce((acc, q) => acc + q.waitMinutes, 0) / AppState.queues.length);
  const avgDensity = Math.round(AppState.crowds.reduce((acc, z) => acc + z.density, 0) / AppState.crowds.length);

  document.getElementById('stat-crowd').textContent = `${avgDensity}%`;
  document.getElementById('stat-avg-wait').textContent = `${avgWait}m`;
  document.getElementById('stat-alerts').textContent = AppState.alerts.length;
  document.getElementById('stat-next-event').textContent = getPhaseLabel().toUpperCase();

  // Update trend indicators
  if (AppState.previousMetrics.avgCrowd !== null) {
    const crowdTrend = document.getElementById('stat-crowd-trend');
    const diff = avgDensity - AppState.previousMetrics.avgCrowd;
    if (diff > 2) { crowdTrend.className = 'stat-trend up'; crowdTrend.textContent = '▲ Rising'; }
    else if (diff < -2) { crowdTrend.className = 'stat-trend down'; crowdTrend.textContent = '▼ Falling'; }
    else { crowdTrend.className = 'stat-trend stable'; crowdTrend.textContent = '● Stable'; }
  }

  if (AppState.previousMetrics.avgWait !== null) {
    const waitTrend = document.getElementById('stat-wait-trend');
    const diff = avgWait - AppState.previousMetrics.avgWait;
    if (diff > 1) { waitTrend.className = 'stat-trend up'; waitTrend.textContent = '▲ Rising'; }
    else if (diff < -1) { waitTrend.className = 'stat-trend down'; waitTrend.textContent = '▼ Falling'; }
    else { waitTrend.className = 'stat-trend stable'; waitTrend.textContent = '● Stable'; }
  }

  AppState.previousMetrics.avgCrowd = avgDensity;
  AppState.previousMetrics.avgWait = avgWait;

  const shortest = [...AppState.queues].sort((a, b) => a.waitMinutes - b.waitMinutes)[0];
  const calmest = [...AppState.crowds].sort((a, b) => a.density - b.density)[0];

  if (shortest) document.getElementById('hero-fastest-queue').textContent = shortest.name;
  if (calmest) document.getElementById('hero-calmest-zone').textContent = calmest.name;
}

/**
 * Renders alert cards in the dashboard alerts section.
 */
function renderAlerts() {
  const container = document.getElementById('alerts-container');
  updateAlertBadge();
  if (!container) return;

  if (!AppState.alerts.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="state-title">All Clear</div><div class="state-message">No active alerts for this venue.</div></div>`;
    return;
  }

  container.innerHTML = AppState.alerts.map(a => `
    <div class="card alert-card ${a.type}" role="alert">
      <div class="alert-icon" aria-hidden="true">${a.type === 'caution' ? '⚠️' : a.type === 'warning' ? '🔶' : 'ℹ️'}</div>
      <div class="alert-content">
        <div class="alert-title">${sanitize(a.title)}</div>
        <div class="alert-msg">${sanitize(a.message)}</div>
      </div>
    </div>
  `).join('');
}

/* =============================================================
   5. GOOGLE MAPS INTEGRATION [ADVANCED]
   ============================================================= */

/** @type {google.maps.Map|null} */
let map = null;

/** @type {google.maps.visualization.HeatmapLayer|null} */
let heatmapLayer = null;

/** @type {Array<{id: string, marker: Object}>} */
let zoneMarkers = [];

/** @type {Array<{id: string, marker: Object}>} */
let facilityMarkers = [];

/**
 * Clears a Google Maps marker collection.
 * @param {Array<{marker?: {setMap?: Function}}>} markerSet - Marker collection to clear
 */
function clearMarkers(markerSet) {
  markerSet.forEach(item => {
    if (item.marker) item.marker.setMap(null);
  });
  markerSet.length = 0;
}

/**
 * Removes the active heatmap layer if one exists.
 */
function clearHeatmap() {
  if (!heatmapLayer) return;
  heatmapLayer.setMap(null);
  heatmapLayer = null;
}

/**
 * Humanizes a machine-readable slug or phase label.
 * @param {string} value - Raw slug
 * @returns {string} Human-readable string
 */
function humanizeValue(value = '') {
  return String(value)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Resolves a crowd zone by id.
 * @param {string} zoneId - Zone identifier
 * @returns {Object|null} Zone object when found
 */
function getZoneById(zoneId) {
  return AppState.crowds.find(zone => zone.id === zoneId) || null;
}

/**
 * Returns the active phase label for UI display.
 * @returns {string} Human-friendly phase label
 */
function getPhaseLabel() {
  if (!AppState.phase) return 'Live';
  return AppState.config?.phaseLabels?.[AppState.phase] || humanizeValue(AppState.phase);
}

/**
 * Updates shared venue status copy used across tabs.
 */
function renderVenueStatus() {
  const phaseLabel = getPhaseLabel();
  const venueName = AppState.config?.venue?.name || 'the venue';

  const liveLabel = document.getElementById('live-status-label');
  if (liveLabel) liveLabel.textContent = phaseLabel;

  const metaPill = document.getElementById('stadium-meta-pill');
  if (metaPill) metaPill.textContent = phaseLabel;

  const orbitLabel = document.getElementById('hero-orbit-label');
  if (orbitLabel) {
    orbitLabel.textContent = AppState.config?.currentVenueTime
      ? `${phaseLabel} at ${AppState.config.currentVenueTime}`
      : `${phaseLabel} at ${venueName}`;
  }

  const chatStatus = document.getElementById('chat-status-text');
  if (chatStatus && AppState.config?.assistantLabel) {
    chatStatus.textContent = `${AppState.config.assistantLabel} · Ask anything about the venue`;
  }

  const queuesSubtitle = document.getElementById('queues-subtitle');
  if (queuesSubtitle) {
    queuesSubtitle.textContent = `${phaseLabel} queue pressure across ${venueName}`;
  }

  const scheduleSubtitle = document.getElementById('schedule-subtitle');
  if (scheduleSubtitle) {
    scheduleSubtitle.textContent = `Today's event timeline at ${venueName}`;
  }

  const emergencyBtn = document.getElementById('btn-emergency');
  if (emergencyBtn && AppState.config?.emergency?.number) {
    emergencyBtn.textContent = `🚨 Emergency Contact — Dial ${AppState.config.emergency.number}`;
  }

  updateMapSubtitle();
  updateVenueClock();
}

/**
 * Updates the map subtitle to match the currently selected layer.
 */
function updateMapSubtitle() {
  const subtitle = document.getElementById('map-subtitle');
  if (!subtitle) return;

  const labels = {
    heatmap: 'Live crowd density heatmap',
    food: 'Food and beverage queue locations',
    restroom: 'Restroom queue locations',
    exits: 'Exit pressure and egress routes'
  };

  subtitle.textContent = labels[AppState.mapLayer] || labels.heatmap;
}

/**
 * Updates the queue refresh timestamp label.
 * @param {number} timestamp - Snapshot timestamp
 */
function updateQueueRefreshTime(timestamp) {
  const label = document.querySelector('#btn-refresh-queues span');
  if (!label || !timestamp) return;
  label.textContent = `Last updated: ${formatTime(timestamp)}`;
}

/**
 * Renders a short dashboard insight from the latest snapshot.
 */
function renderInsight() {
  const insight = document.getElementById('insight-text');
  if (!insight || !AppState.queues.length || !AppState.crowds.length) return;

  const shortest = [...AppState.queues].sort((a, b) => a.waitMinutes - b.waitMinutes)[0];
  const calmest = [...AppState.crowds].sort((a, b) => a.density - b.density)[0];

  insight.textContent = shortest && calmest
    ? `${shortest.name} is moving fastest at ${shortest.waitMinutes} minutes, while ${calmest.name} is the calmest route at ${calmest.density}% density.`
    : 'Live venue intelligence is syncing now.';
}

/**
 * Loads the Google Maps JavaScript API with timeout and auth failure handling.
 * @param {string} apiKey - Google Maps API key
 * @returns {Promise<void>} Resolves when Maps is ready
 */
async function loadGoogleMapsApi(apiKey) {
  if (window.google?.maps?.visualization) return;

  const src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=visualization&callback=__gmapCallback`;

  const ready = new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Google Maps took too long to initialize.'));
    }, GOOGLE_MAPS_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      delete window.__gmapCallback;
      if (window.gm_authFailure === handleAuthFailure) {
        delete window.gm_authFailure;
      }
    };

    const handleAuthFailure = () => {
      cleanup();
      reject(new Error('Google Maps authorization failed. Check the key and allowed referrers.'));
    };

    window.__gmapCallback = () => {
      cleanup();
      resolve();
    };
    window.gm_authFailure = handleAuthFailure;
  });

  await Promise.all([ready, loadScript(src, GOOGLE_MAPS_SCRIPT_ID)]);

  if (!window.google?.maps?.visualization) {
    throw new Error('Google Maps loaded without the visualization library.');
  }
}

/**
 * Initializes the Google Maps instance with heatmap layers and markers.
 * Only called when the Map tab is first viewed or when switching stadiums.
 */
async function initMap() {
  const mapContainer = document.getElementById('venue-map');
  const fallback = document.getElementById('map-fallback');

  if (!mapContainer || !AppState.config?.mapsApiKey) {
    // Show fallback message if no Maps key
    if (fallback && !AppState.config?.mapsApiKey) {
      fallback.style.display = 'flex';
      fallback.innerHTML = `
        <div class="map-fallback-icon" aria-hidden="true">🗺️</div>
        <div class="map-fallback-title">Map Unavailable</div>
        <div class="map-fallback-desc">Google Maps API key is not configured. The crowd density data is still available in the zone legend below.</div>
      `;
    }
    // Still render zone legend even without map
    renderZoneLegend();
    return false;
  }

  try {
    // Load Google Maps script (cached if already loaded)
    await loadGoogleMapsApi(AppState.config.mapsApiKey);

    // Hide fallback, show map
    if (fallback) fallback.style.display = 'none';

    map = new google.maps.Map(mapContainer, {
      center: { lat: AppState.config.venue.lat, lng: AppState.config.venue.lng },
      zoom: 17,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'simplified' }] }
      ]
    });

    applyMapLayer(AppState.mapLayer, { announceChange: false });
    AppState.mapLoaded = true;
    announce('Venue map loaded with crowd density heatmap');
    return true;
  } catch (err) {
    console.error('Maps failed to initialize:', err);
    if (fallback) {
      fallback.style.display = 'flex';
      fallback.innerHTML = `
        <div class="map-fallback-icon" aria-hidden="true">⚠️</div>
        <div class="map-fallback-title">Map Could Not Load</div>
        <div class="map-fallback-desc">${sanitize(err.message || 'There was an issue loading Google Maps. Zone data is shown below.')}</div>
      `;
    }
    renderZoneLegend();
    announce('Map could not be loaded');
    return false;
  }
}

/**
 * Renders standard Google Maps markers for each crowd zone.
 * Uses standard markers for maximum compatibility — no mapId required.
 */
function renderMapMarkers() {
  clearMarkers(zoneMarkers);

  if (!map || !AppState.crowds.length) return;

  AppState.crowds.forEach(z => {
    const color = z.status === 'low' ? '#1e8e3e' : z.status === 'moderate' ? '#f9ab00' : '#d93025';

    const marker = new google.maps.Marker({
      map,
      position: { lat: z.lat, lng: z.lng },
      title: `${z.name}: ${z.density}% density`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: 0.9,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 10
      }
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="font-family:Roboto,sans-serif;padding:4px"><strong>${sanitize(z.name)}</strong><br>${z.density}% density · ${z.status}</div>`
    });

    marker.addListener('click', () => {
      infoWindow.open(map, marker);
      announce(`${z.name}: ${z.density}% crowd density, status ${z.status}`);
    });

    zoneMarkers.push({ id: z.id, marker });
  });
}

/**
 * Highlights a specific zone on the map by panning and zooming to it.
 * @param {string} zoneId - Zone identifier to highlight
 */
function highlightZoneOnMap(zoneId) {
  if (AppState.mapLayer !== 'heatmap') {
    setActiveMapLayer('heatmap', { announceChange: false });
  }

  const match = zoneMarkers.find(m => m.id === zoneId);
  if (match && map) {
    map.panTo(match.marker.getPosition());
    map.setZoom(18);
    // Trigger a bounce animation
    match.marker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => { match.marker.setAnimation(null); }, 2000);
    announce(`Highlighted zone: ${zoneId}`);
  }
}

/**
 * Renders a heatmap layer on the Google Map using crowd density data.
 */
function renderHeatmap() {
  if (!map) return;

  clearHeatmap();

  const heatData = AppState.crowds.map(z => ({
    location: new google.maps.LatLng(z.lat, z.lng),
    weight: z.density / 100
  }));

  heatmapLayer = new google.maps.visualization.HeatmapLayer({
    data: heatData,
    radius: 60,
    opacity: 0.6,
    gradient: [
      'rgba(0,0,0,0)',
      'rgba(30, 142, 62, 0.4)',
      'rgba(249, 171, 0, 0.6)',
      'rgba(217, 48, 37, 0.8)',
      'rgba(217, 48, 37, 1)'
    ]
  });
  heatmapLayer.setMap(map);
  renderZoneLegend();
}

/**
 * Renders the zone legend chips below the map.
 */
function renderZoneLegend() {
  const container = document.getElementById('zone-legend');
  if (!container) return;

  if (AppState.mapLayer === 'heatmap') {
    container.innerHTML = AppState.crowds.map(z => `
      <div class="zone-chip" aria-label="${sanitize(z.name)}: ${z.density}% density">
        <span class="zone-dot ${z.status}" aria-hidden="true"></span>
        <span class="zone-name">${sanitize(z.name)}</span>
        <span class="zone-pct">${z.density}%</span>
      </div>
    `).join('');
    return;
  }

  const queues = getQueuesForLayer(AppState.mapLayer);
  if (!queues.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <div class="state-title">No Locations Available</div>
        <div class="state-message">This layer does not have live map points right now.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = queues.map(queue => {
    const zone = getZoneById(queue.zone);
    const zoneLabel = zone?.name || humanizeValue(queue.zone);
    return `
      <div class="zone-chip service-chip" aria-label="${sanitize(queue.name)} at ${sanitize(zoneLabel)} with a ${queue.waitMinutes} minute wait">
        <div class="service-chip-top">
          <span class="service-icon" aria-hidden="true">${queue.icon}</span>
          <span class="zone-name">${sanitize(queue.name)}</span>
          <span class="zone-pct">${queue.waitMinutes}m</span>
        </div>
        <div class="service-meta">${sanitize(zoneLabel)}</div>
      </div>
    `;
  }).join('');
}

/**
 * Initializes Map Layer controls (Heatmap, Food, etc)
 */
function initMapFilters() {
  document.querySelectorAll('.map-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      setActiveMapLayer(chip.dataset.layer, { announceChange: true });
    });
  });
}

/**
 * Returns the queue set that should be shown for a map layer.
 * @param {string} layer - Active layer identifier
 * @returns {Array<Object>} Queue items for the layer
 */
function getQueuesForLayer(layer) {
  switch (layer) {
    case 'food':
      return AppState.queues.filter(queue => queue.type === 'food' || queue.type === 'beverage');
    case 'restroom':
      return AppState.queues.filter(queue => queue.type === 'restroom');
    case 'exits':
      return AppState.queues.filter(queue => queue.type === 'exit');
    default:
      return [];
  }
}

/**
 * Updates map chip visual state.
 * @param {string} layer - Active layer identifier
 */
function syncMapFilterState(layer) {
  document.querySelectorAll('.map-chip').forEach(chip => {
    const isActive = chip.dataset.layer === layer;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });
}

/**
 * Renders service markers for non-heatmap layers.
 * @param {string} layer - Active layer identifier
 */
function renderFacilityMarkers(layer) {
  clearMarkers(facilityMarkers);
  if (!map) return;

  const queues = getQueuesForLayer(layer);
  const colors = {
    food: '#f9ab00',
    beverage: '#1a73e8',
    restroom: '#137333',
    exit: '#d93025'
  };
  const counters = new Map();

  queues.forEach(queue => {
    const zone = getZoneById(queue.zone);
    if (!zone) return;

    const seen = counters.get(zone.id) || 0;
    counters.set(zone.id, seen + 1);

    const angle = (Math.PI / 3) * seen;
    const offset = 0.00018;
    const position = {
      lat: zone.lat + (Math.sin(angle) * offset),
      lng: zone.lng + (Math.cos(angle) * offset)
    };

    const marker = new google.maps.Marker({
      map,
      position,
      title: `${queue.name}: ${queue.waitMinutes} minute wait`,
      label: {
        text: queue.icon,
        fontSize: '14px'
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: colors[queue.type] || '#5f6368',
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 12
      }
    });

    const zoneLabel = zone.name || humanizeValue(queue.zone);
    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="font-family:Roboto,sans-serif;padding:4px"><strong>${sanitize(queue.name)}</strong><br>${sanitize(zoneLabel)} · ${queue.waitMinutes} min wait</div>`
    });

    marker.addListener('click', () => {
      infoWindow.open(map, marker);
      announce(`${queue.name} near ${zoneLabel} has a ${queue.waitMinutes} minute wait`);
    });

    facilityMarkers.push({ id: queue.id, marker });
  });
}

/**
 * Applies the selected map layer to the current map.
 * @param {string} layer - Active layer identifier
 * @param {{announceChange?: boolean}} [options={}] - Layer options
 */
function applyMapLayer(layer, options = {}) {
  const { announceChange = false } = options;
  AppState.mapLayer = layer;
  syncMapFilterState(layer);
  updateMapSubtitle();

  if (!map) {
    renderZoneLegend();
    return;
  }

  clearMarkers(zoneMarkers);
  clearMarkers(facilityMarkers);
  clearHeatmap();

  if (layer === 'heatmap') {
    renderMapMarkers();
    renderHeatmap();
  } else {
    renderFacilityMarkers(layer);
    renderZoneLegend();
  }

  if (announceChange) {
    announce(`Map filter changed to ${layer}`);
  }
}

/**
 * Sets the active map layer and updates the UI state.
 * @param {string} layer - Requested layer
 * @param {{announceChange?: boolean}} [options={}] - Layer options
 */
function setActiveMapLayer(layer, options = {}) {
  const nextLayer = layer || 'heatmap';
  if (map && AppState.mapLoaded) {
    applyMapLayer(nextLayer, options);
    return;
  }

  AppState.mapLayer = nextLayer;
  syncMapFilterState(nextLayer);
  updateMapSubtitle();
  renderZoneLegend();

  if (options.announceChange) {
    announce(`Map filter changed to ${nextLayer}`);
  }
}

/**
 * Ensures the map is initialized before tool-driven interactions run.
 * @returns {Promise<boolean>} True when the map is ready
 */
async function ensureMapReady() {
  if (map && AppState.mapLoaded) return true;
  return initMap();
}

/* =============================================================
   6. AI CHAT & TOOLING [ADVANCED]
   ============================================================= */

/**
 * Sends a chat message to the AI backend and renders the response.
 * @param {string} message - User's chat message
 */
async function sendChatMessage(message) {
  if (!message.trim() || AppState.chatPending) return;

  const chatMessages = document.getElementById('chat-messages');
  const typing = document.getElementById('typing-indicator');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  // Render user bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.setAttribute('role', 'article');
  userBubble.setAttribute('aria-label', 'You said');
  userBubble.innerHTML = `${sanitize(message)}<span class="timestamp">${formatTime(Date.now())}</span>`;
  chatMessages.appendChild(userBubble);

  input.value = '';
  sendBtn.disabled = true;
  AppState.chatPending = true;
  typing.classList.add('visible');
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });

    typing.classList.remove('visible');

    // Handle AI tool calls (UI automation)
    if (data.tool_call) {
      await handleToolCall(data.tool_call);
    }

    const aiBubble = document.createElement('div');
    aiBubble.className = 'chat-bubble ai';
    aiBubble.setAttribute('role', 'article');
    aiBubble.setAttribute('aria-label', 'AI responded');
    aiBubble.innerHTML = `${sanitize(data.reply)}<span class="timestamp">${formatTime(Date.now())}</span>`;
    chatMessages.appendChild(aiBubble);

    announce('AI responded');
  } catch (err) {
    typing.classList.remove('visible');
    const errBubble = document.createElement('div');
    errBubble.className = 'chat-bubble ai';
    errBubble.setAttribute('role', 'alert');
    errBubble.innerHTML = `Sorry, I couldn't process that request. Please try again.<span class="timestamp">${formatTime(Date.now())}</span>`;
    chatMessages.appendChild(errBubble);
    console.error('Chat failed:', err);
  } finally {
    AppState.chatPending = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

/**
 * Handles AI tool calls that control the UI dynamically.
 * @param {Object} call - Tool call object from the API response
 * @param {string} call.action - Tool action name
 * @param {Object} call.params - Tool parameters
 */
async function handleToolCall(call) {
  if (!call) return;
  console.log('AI Triggered Tool:', call);

  switch (call.action) {
    case 'highlight_zone':
      navigateTo('map');
      await ensureMapReady();
      highlightZoneOnMap(call.params?.zone_id);
      break;
    case 'show_queues':
      navigateTo('queues');
      setQueueFilter(call.params?.category || 'all', { announceChange: false });
      break;
    case 'get_accessibility':
      navigateTo('schedule');
      if (!document.getElementById('a11y-panel')?.classList.contains('visible')) {
        setTimeout(() => toggleA11yPanel(), 150);
      }
      break;
    case 'emergency_nav':
      navigateTo('map');
      await ensureMapReady();
      setActiveMapLayer('exits', { announceChange: false });
      announce('Showing exit flow guidance on the map');
      break;
    default:
      console.warn('Unknown tool call:', call.action);
  }
}

/**
 * Initializes the chat input with send button toggling and enter key support.
 */
function initChatInput() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  if (!input || !sendBtn) return;

  // Enable/disable send button based on input content
  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim();
  });

  // Send on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
      e.preventDefault();
      sendChatMessage(input.value);
    }
  });

  // Send on button click
  sendBtn.addEventListener('click', () => {
    if (input.value.trim()) {
      sendChatMessage(input.value);
    }
  });
}

/* =============================================================
   7. INITIALIZATION [EFFICIENT]
   ============================================================= */

/**
 * Main application initialization. Sets up all event listeners,
 * loads data, and registers the service worker.
 */
async function init() {
  initNav();
  initChatInput();
  initQueueFilters();
  initMapFilters();
  initPreferenceControls();
  initQuickActions();
  initMoreCards();
  initEmergencyButton();
  initHeaderActions();

  await loadStadiumCatalog();
  await loadConfig();
  await loadDashboard();

  // Register Service Worker for PWA offline support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW registered:', reg.scope);
      }).catch(err => {
        console.log('SW registration failed:', err);
      });
    });
  }

  // Pre-fetch Map if active
  if (AppState.currentView === 'map') initMap();

  // Start auto-refresh timer
  startAutoRefresh();

  console.log('StadiumPulse Pro Initialized 🏟️');
}

document.addEventListener('DOMContentLoaded', init);

/* =============================================================
   8. HELPER FUNCTIONS
   ============================================================= */

/**
 * Loads the selected stadium slug from localStorage.
 * @returns {string} Stadium slug or empty string
 */
function loadSelectedStadiumFromStorage() {
  try {
    return localStorage.getItem(STADIUM_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Saves the selected stadium slug to localStorage.
 * @param {string} slug - Stadium slug to persist
 */
function saveSelectedStadium(slug) {
  try {
    localStorage.setItem(STADIUM_STORAGE_KEY, slug);
  } catch {
    // Storage unavailable
  }
}

/**
 * Dynamically loads an external script, with caching.
 * @param {string} src - Script source URL
 * @returns {Promise<void>} Resolves when the script is loaded
 */
function loadScript(src, scriptId = '') {
  if (ScriptPromises.has(src)) return ScriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    if (scriptId) {
      const existing = document.getElementById(scriptId);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }

        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        return;
      }
    }

    const s = document.createElement('script');
    if (scriptId) s.id = scriptId;
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = 'true';
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  }).catch((err) => {
    ScriptPromises.delete(src);
    throw err;
  });
  ScriptPromises.set(src, promise);
  return promise;
}

/**
 * Updates the venue clock display with the current time.
 */
function updateVenueClock() {
  const clock = document.getElementById('hero-clock');
  if (clock) clock.textContent = formatTime(Date.now());

  const phasePill = document.getElementById('hero-phase-pill');
  if (phasePill && AppState.phase) {
    phasePill.textContent = getPhaseLabel().toUpperCase();
  }
}

/**
 * Renders the stadium metadata panel (name, city, tagline).
 */
function renderStadiumMeta() {
  if (!AppState.config?.venue) return;
  const v = AppState.config.venue;

  const subtitle = document.getElementById('dashboard-subtitle');
  if (subtitle) subtitle.textContent = `${v.name} · ${v.city}`;

  const metaName = document.getElementById('stadium-meta-name');
  if (metaName) metaName.textContent = v.name;

  const metaCopy = document.getElementById('stadium-meta-copy');
  if (metaCopy) {
    metaCopy.textContent = `${v.city}, ${v.country} · ${v.sport} · Capacity: ${v.capacity?.toLocaleString()}${v.tagline ? ` · ${v.tagline}` : ''}`;
  }
}

/**
 * Renders the AI chat welcome message with the venue name.
 */
function renderChatWelcome() {
  const welcome = document.getElementById('chat-welcome-message');
  if (!welcome || !AppState.config?.venue) return;
  welcome.innerHTML = `Welcome to <strong>${sanitize(AppState.config.venue.name)}</strong>! I can help with directions, queue updates, accessibility, and exit planning. What do you need?<span class="timestamp">Just now</span>`;
}

/**
 * Renders suggested question chips in the chat view.
 */
function renderSuggestedQuestions() {
  const container = document.getElementById('suggested-chips');
  if (!container || !AppState.config?.suggestedQuestions) return;
  container.innerHTML = AppState.config.suggestedQuestions.map(item => `
    <button class="suggest-chip" data-question="${sanitize(item.question)}">${sanitize(item.label)}</button>
  `).join('');
  container.querySelectorAll('.suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => sendChatMessage(chip.dataset.question));
  });
}

/**
 * Renders the accessibility panel with assist buttons and service cards.
 */
function renderAccessibilityPanel() {
  const assistGrid = document.getElementById('assist-grid');
  const cardsContainer = document.getElementById('a11y-cards');
  if (!assistGrid || !cardsContainer || !AppState.config) return;

  assistGrid.innerHTML = (AppState.config.assistPrompts || []).map(item => `
    <button class="assist-btn" type="button" data-question="${sanitize(item.question)}">${sanitize(item.label)}</button>
  `).join('');

  cardsContainer.innerHTML = (AppState.config.accessibility || []).map(item => `
    <div class="card a11y-card">
      <span class="a11y-icon" aria-hidden="true">${sanitize(item.icon)}</span>
      <div>
        <div class="a11y-title">${sanitize(item.title)}</div>
        <div class="a11y-desc">${sanitize(item.desc)}</div>
      </div>
    </div>
  `).join('');
  initAccessibilityAssist();
}

/**
 * Attaches click handlers to accessibility assist buttons.
 */
function initAccessibilityAssist() {
  document.querySelectorAll('.assist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('chat');
      setTimeout(() => sendChatMessage(btn.dataset.question), 300);
    });
  });
}

/**
 * Toggles the accessibility detail panel visibility.
 */
function toggleA11yPanel() {
  const panel = document.getElementById('a11y-panel');
  if (!panel) return;
  const isVisible = panel.classList.toggle('visible');
  if (isVisible) {
    smartScrollIntoView(panel);
    announce('Accessibility services panel opened');
  } else {
    announce('Accessibility services panel closed');
  }
}

/**
 * Refreshes crowd data by reloading the dashboard.
 */
function refreshCrowdData() {
  loadDashboard().then(() => {
    if (map && AppState.mapLoaded) {
      applyMapLayer(AppState.mapLayer, { announceChange: false });
    }
  });
}

/**
 * Loads and renders queue data.
 */
function loadQueues() {
  renderQueues();
  // Only reload if stale (not on every tab switch)
  if (!AppState.lastUpdated.queues || Date.now() - AppState.lastUpdated.queues > 10000) {
    loadDashboard().then(() => {
      renderQueues();
      AppState.lastUpdated.queues = Date.now();
    });
  }
}

/**
 * Fetches and renders the event schedule timeline.
 */
async function loadSchedule() {
  try {
    const data = await apiFetch('/api/schedule');
    AppState.schedule = data.events;
    renderTimeline();
  } catch (err) {
    console.error('Schedule load failed:', err);
  }
}

/**
 * Renders the event timeline in the schedule view.
 */
function renderTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;
  container.innerHTML = AppState.schedule.map(event => `
    <div class="timeline-item" role="listitem">
      <div class="timeline-dot"></div>
      <div class="timeline-time">${formatTime(event.time)}</div>
      <div class="timeline-title">${sanitize(event.title)}</div>
      <div class="timeline-desc">${sanitize(event.desc)}</div>
    </div>
  `).join('');
}

/**
 * Renders queue cards with the current filter applied.
 */
function renderQueues() {
  const container = document.getElementById('queue-list');
  if (!container) return;
  const filtered = AppState.queueFilter === 'all'
    ? AppState.queues
    : AppState.queues.filter(q => q.type === AppState.queueFilter);

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="state-title">No Queues</div><div class="state-message">No queues match the selected filter.</div></div>`;
    return;
  }

  container.innerHTML = filtered.map(q => `
    <div class="card queue-card ${q.status}" role="listitem" aria-label="${sanitize(q.name)}: ${q.waitMinutes} minute wait">
      <div class="queue-icon" aria-hidden="true">${q.icon}</div>
      <div class="queue-info">
        <div class="queue-name">${sanitize(q.name)}</div>
        <div class="queue-subtext">${sanitize(getZoneById(q.zone)?.name || humanizeValue(q.zone))}</div>
      </div>
      <div class="queue-meta">
        <div class="queue-wait">${q.waitMinutes}m</div>
        <div class="queue-trend ${q.trend}">${q.trend === 'rising' ? '▲' : q.trend === 'falling' ? '▼' : '●'} ${q.trend}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Initializes queue filter chip click handlers with proper aria-pressed state.
 */
function initQueueFilters() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      setQueueFilter(chip.dataset.filter);
    });
  });

  // Refresh button
  const refreshBtn = document.getElementById('btn-refresh-queues');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboard().then(() => renderQueues());
      announce('Queue data refreshed');
    });
  }
}

/**
 * Applies a queue filter and synchronizes chip state.
 * @param {string} filter - Queue type filter
 * @param {{announceChange?: boolean}} [options={}] - Filter options
 */
function setQueueFilter(filter, options = {}) {
  const { announceChange = true } = options;
  AppState.queueFilter = filter || 'all';

  document.querySelectorAll('.filter-chip').forEach(chip => {
    const isActive = chip.dataset.filter === AppState.queueFilter;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });

  renderQueues();

  if (announceChange) {
    announce(`Filtered queues by ${AppState.queueFilter}`);
  }
}

/**
 * Initializes Quick Action buttons to trigger AI chat queries.
 */
function initQuickActions() {
  const actions = {
    'qa-restroom': 'Where is the nearest restroom with the shortest queue?',
    'qa-food': 'Which food stall has the shortest wait time right now?',
    'qa-directions': 'I need directions to my seat. Can you help me navigate?',
    'qa-emergency': 'I need emergency help. Where is the nearest medical station?'
  };

  Object.entries(actions).forEach(([id, question]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        navigateTo('chat');
        setTimeout(() => sendChatMessage(question), 300);
      });
    }
  });
}

/**
 * Initializes "More" section cards with keyboard and click support.
 */
function initMoreCards() {
  const moreCards = {
    'more-accessibility': () => toggleA11yPanel(),
    'more-first-aid': () => {
      navigateTo('chat');
      setTimeout(() => sendChatMessage('Where is the nearest first aid or medical station?'), 300);
    },
    'more-lost-found': () => {
      navigateTo('chat');
      setTimeout(() => sendChatMessage('I lost an item. Where is the lost and found?'), 300);
    },
    'more-transport': () => {
      navigateTo('chat');
      setTimeout(() => sendChatMessage('What are the transport options to leave the stadium?'), 300);
    }
  };

  Object.entries(moreCards).forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    }
  });
}

/**
 * Initializes the emergency contact button in the More view.
 */
function initEmergencyButton() {
  const btn = document.getElementById('btn-emergency');
  if (!btn) return;

  btn.addEventListener('click', () => {
    navigateTo('chat');
    setTimeout(() => {
      sendChatMessage('I need emergency help. Where is the nearest medical station and nearest exit?');
    }, 300);
  });
}

/**
 * Initializes header action buttons (alerts, accessibility).
 */
function initHeaderActions() {
  const alertsBtn = document.getElementById('btn-alerts');
  if (alertsBtn) {
    alertsBtn.addEventListener('click', () => {
      navigateTo('dashboard');
      setTimeout(() => {
        const alertsSection = document.getElementById('alerts-container');
        if (alertsSection) smartScrollIntoView(alertsSection);
      }, 200);
    });
  }

  const a11yBtn = document.getElementById('btn-a11y');
  if (a11yBtn) {
    a11yBtn.addEventListener('click', () => {
      navigateTo('schedule');
      setTimeout(() => toggleA11yPanel(), 300);
    });
  }

  const refreshAlertsBtn = document.getElementById('btn-refresh-alerts');
  if (refreshAlertsBtn) {
    refreshAlertsBtn.addEventListener('click', () => {
      loadDashboard();
      announce('Alerts refreshed');
    });
  }
}

/**
 * Initializes experience preference toggle controls with proper
 * aria-pressed state and visual status indicators.
 */
function initPreferenceControls() {
  const prefs = ['large-text', 'high-contrast', 'calm-motion'];
  prefs.forEach(p => {
    const btn = document.getElementById(`pref-${p}`);
    if (btn) {
      btn.addEventListener('click', () => {
        const key = p.replace(/-([a-z])/g, g => g[1].toUpperCase());
        AppState.preferences[key] = !AppState.preferences[key];
        applyPreferences();

        // Update aria-pressed and status text
        btn.setAttribute('aria-pressed', String(AppState.preferences[key]));
        const statusEl = document.getElementById(`pref-${p}-status`);
        if (statusEl) statusEl.textContent = AppState.preferences[key] ? 'On' : 'Off';

        announce(`${p.replace(/-/g, ' ')} ${AppState.preferences[key] ? 'enabled' : 'disabled'}`);

        try {
          localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(AppState.preferences));
        } catch {
          // Storage unavailable
        }
      });
    }
  });
  loadPreferences();
  applyPreferences();
}

/**
 * Loads saved preferences from localStorage.
 */
function loadPreferences() {
  try {
    const saved = localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (saved && saved !== 'undefined' && saved !== 'null') {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'object') {
        AppState.preferences = { ...AppState.preferences, ...parsed };
      }
    }
  } catch {
    // Invalid or unavailable storage
  }
}

/**
 * Applies preference state to the document body and updates UI indicators.
 */
function applyPreferences() {
  document.body.classList.toggle('mode-large-text', AppState.preferences.largeText);
  document.body.classList.toggle('mode-high-contrast', AppState.preferences.highContrast);
  document.body.classList.toggle('mode-calm-motion', AppState.preferences.calmMotion);

  // Sync aria-pressed and status indicators on load
  const mappings = {
    'large-text': 'largeText',
    'high-contrast': 'highContrast',
    'calm-motion': 'calmMotion'
  };

  Object.entries(mappings).forEach(([slug, key]) => {
    const btn = document.getElementById(`pref-${slug}`);
    if (btn) btn.setAttribute('aria-pressed', String(AppState.preferences[key]));
    const status = document.getElementById(`pref-${slug}-status`);
    if (status) status.textContent = AppState.preferences[key] ? 'On' : 'Off';
  });
}

/**
 * Starts the dashboard auto-refresh timer.
 */
function startAutoRefresh() {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = setInterval(() => {
    if (AppState.currentView === 'dashboard') {
      loadDashboard();
    }
    updateVenueClock();
  }, REFRESH_INTERVAL);
}
