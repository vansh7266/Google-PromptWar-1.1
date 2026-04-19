/**
 * StadiumPulse — AI-Powered Stadium Experience Assistant
 * Express.js backend with multi-stadium support, simulated live venue data,
 * and Gemini-powered plus local-fallback chat assistance.
 *
 * @module server
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/* ================================================================
   1. CONFIGURATION
   ================================================================ */

const PORT = parseInt(process.env.PORT, 10) || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_DISABLED = process.env.DISABLE_GEMINI === '1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const MAPS_API_KEY = process.env.MAPS_API_KEY || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SIMULATION_CACHE_TTL_MS = 15 * 1000;
const DEFAULT_STADIUM_SLUG = process.env.DEFAULT_STADIUM || 'narendra-modi-stadium';
const STADIUMS_DIR = path.join(__dirname, 'data', 'stadiums');
const NO_CACHE_ASSETS = new Set(['index.html', 'app.js', 'index.css', 'manifest.json', 'sw.js']);

const app = express();

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeStadium(raw, filePath) {
  const requiredKeys = [
    'slug',
    'name',
    'city',
    'country',
    'sport',
    'lat',
    'lng',
    'capacity',
    'timeZone',
    'phaseTimeline',
    'phaseLabels',
    'scheduleTemplate',
    'zones',
    'queues',
    'accessibility',
    'assistPrompts',
    'suggestedQuestions',
    'services',
    'emergency'
  ];

  for (const key of requiredKeys) {
    if (!(key in raw)) {
      throw new Error(`Missing "${key}" in ${filePath}`);
    }
  }

  return {
    ...raw,
    featured: !!raw.featured,
    phaseTimeline: raw.phaseTimeline.map(entry => ({
      before: entry.before,
      phase: entry.phase
    })),
    scheduleTemplate: raw.scheduleTemplate.map(entry => ({
      hour: Number(entry.hour),
      minute: Number(entry.minute),
      title: entry.title,
      desc: entry.desc,
      type: entry.type
    }))
  };
}

function loadStadiumCatalog() {
  const files = fs.readdirSync(STADIUMS_DIR)
    .filter(fileName => fileName.endsWith('.json'))
    .sort();

  if (!files.length) {
    throw new Error(`No stadium data files found in ${STADIUMS_DIR}`);
  }

  const stadiums = files.map(fileName => normalizeStadium(
    readJsonFile(path.join(STADIUMS_DIR, fileName)),
    fileName
  ));

  const bySlug = new Map();
  for (const stadium of stadiums) {
    if (bySlug.has(stadium.slug)) {
      throw new Error(`Duplicate stadium slug "${stadium.slug}" in ${STADIUMS_DIR}`);
    }
    bySlug.set(stadium.slug, stadium);
  }

  const defaultSlug = bySlug.has(DEFAULT_STADIUM_SLUG)
    ? DEFAULT_STADIUM_SLUG
    : stadiums.find(stadium => stadium.featured)?.slug || stadiums[0].slug;

  return { bySlug, stadiums, defaultSlug };
}

const { bySlug: STADIUMS_BY_SLUG, stadiums: STADIUM_CATALOG, defaultSlug: ACTIVE_DEFAULT_STADIUM } = loadStadiumCatalog();

function summarizeStadium(stadium) {
  return {
    slug: stadium.slug,
    name: stadium.name,
    city: stadium.city,
    country: stadium.country,
    sport: stadium.sport,
    tagline: stadium.tagline,
    lat: stadium.lat,
    lng: stadium.lng,
    capacity: stadium.capacity,
    timeZone: stadium.timeZone,
    featured: stadium.featured
  };
}

function resolveStadiumBySlug(slug = ACTIVE_DEFAULT_STADIUM) {
  return STADIUMS_BY_SLUG.get(slug);
}

function getRequestedStadiumSlug(req) {
  const raw = typeof req.query.stadium === 'string' ? req.query.stadium.trim() : '';
  // Validate slug format: only lowercase letters, numbers, and hyphens
  if (raw && !/^[a-z0-9-]+$/.test(raw)) {
    return ACTIVE_DEFAULT_STADIUM;
  }
  return raw || ACTIVE_DEFAULT_STADIUM;
}

function getStadiumFromRequest(req, res) {
  const slug = getRequestedStadiumSlug(req);
  const stadium = resolveStadiumBySlug(slug);

  if (stadium) return stadium;

  res.status(404).json({
    error: `Unknown stadium "${slug}"`,
    defaultStadium: ACTIVE_DEFAULT_STADIUM,
    stadiums: STADIUM_CATALOG.map(summarizeStadium)
  });
  return null;
}

/* ================================================================
   2. SECURITY MIDDLEWARE
   ================================================================ */

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com'
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://*.google.com',
        'https://*.googleapis.com',
        'https://img.icons8.com'
      ],
      connectSrc: [
        "'self'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://*.googleapis.com',
        'https://*.google.com',
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com'
      ],
      frameSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://*.google.com'],
      workerSrc: ["'self'", 'blob:'],
      // Local development runs on plain HTTP, so only force HTTPS upgrades in production.
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  },
  strictTransportSecurity: IS_PRODUCTION
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: '1kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', apiLimiter);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chat rate limit reached. Please wait a moment.' }
});

/* ================================================================
   3. STATIC FILE SERVING
   ================================================================ */

app.use(express.static(path.join(__dirname), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    const fileName = path.basename(filePath);
    if (NO_CACHE_ASSETS.has(fileName)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

/* ================================================================
   4. GEMINI AI SETUP
   ================================================================ */

let model = null;
let fallbackModel = null;

function buildSystemInstruction() {
  return `You are StadiumPulse AI, a smart assistant for live stadiums and arenas around the world.

You help attendees with navigation, food, queues, and safety.
You have access to TOOLS that can control the user's interface:
- Use 'highlight_zone' if the user asks for a specific zone, gate, or stand.
- Use 'show_queues' if the user asks about wait times for food, restrooms, etc.
- Use 'get_accessibility' if the user asks about wheelchair or mobility support.
- Use 'emergency_nav' for urgent medical or exit requests.

Rules:
- Be concise: 2-3 sentences max per response.
- Use tools whenever they help the user see what they are asking about.
- Always prioritize safety information.`;
}

const tools = [
  {
    functionDeclarations: [
      {
        name: "highlight_zone",
        description: "Highlights a specific zone, gate, or sector on the venue map.",
        parameters: {
          type: "OBJECT",
          properties: {
            zone_id: { type: "STRING", description: "The ID of the zone to highlight (e.g., 'north-pavilion')." }
          },
          required: ["zone_id"]
        }
      },
      {
        name: "show_queues",
        description: "Switches the UI to the Queues tracker for a specific category.",
        parameters: {
          type: "OBJECT",
          properties: {
            category: { type: "STRING", enum: ["food", "beverage", "restroom", "merchandise", "exit", "all"] }
          },
          required: ["category"]
        }
      },
      {
        name: "get_accessibility",
        description: "Shows the accessibility services and routes panel."
      },
      {
        name: "emergency_nav",
        description: "Highlights emergency exits and medical points on the map."
      }
    ]
  }
];

function createGenerativeModel(client, modelName) {
  return client.getGenerativeModel({
    model: modelName,
    systemInstruction: buildSystemInstruction(),
    tools
  });
}

if (GEMINI_API_KEY && !GEMINI_DISABLED) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = createGenerativeModel(genAI, GEMINI_MODEL);

  if (GEMINI_MODEL !== DEFAULT_GEMINI_MODEL) {
    fallbackModel = createGenerativeModel(genAI, DEFAULT_GEMINI_MODEL);
  }
}

function getAssistantMode() {
  if (model) {
    return {
      mode: 'gemini',
      label: `Powered by ${GEMINI_MODEL.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ')}`,
      configured: true
    };
  }

  return {
    mode: 'local',
    label: 'Smart local assistant with live venue data',
    configured: false
  };
}

/* ================================================================
   5. TIME, SCHEDULE, AND SIMULATION HELPERS
   ================================================================ */

function getVenueNowParts(stadium, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: stadium.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

function getVenueDateISO(stadium, date = new Date()) {
  const parts = getVenueNowParts(stadium, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getUtcOffsetForTimeZone(stadium, date = new Date()) {
  const zonePart = new Intl.DateTimeFormat('en-US', {
    timeZone: stadium.timeZone,
    timeZoneName: 'shortOffset'
  }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'GMT+0';

  const match = zonePart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return '+00:00';

  const [, sign, rawHour, rawMinute] = match;
  const hour = rawHour.padStart(2, '0');
  const minute = (rawMinute || '00').padStart(2, '0');
  return `${sign}${hour}:${minute}`;
}

function getVenueDateTimeISO(stadium, hour, minute, date = new Date()) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const offset = getUtcOffsetForTimeZone(stadium, date);
  return `${getVenueDateISO(stadium, date)}T${hh}:${mm}:00${offset}`;
}

function getVenueTimeLabel(stadium, date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: stadium.timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function formatPhaseLabel(phase, stadium) {
  return stadium.phaseLabels?.[phase] || phase
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function timeStringToValue(timeString) {
  const [hour, minute] = timeString.split(':').map(Number);
  return hour + minute / 60;
}

function getGamePhase(stadium) {
  const now = getVenueNowParts(stadium);
  const currentValue = Number(now.hour) + Number(now.minute) / 60;

  for (const milestone of stadium.phaseTimeline) {
    if (currentValue < timeStringToValue(milestone.before)) {
      return milestone.phase;
    }
  }

  return stadium.phaseTimeline[stadium.phaseTimeline.length - 1]?.phase || 'exit';
}

function getSchedule(stadium) {
  return stadium.scheduleTemplate.map(item => ({
    time: getVenueDateTimeISO(stadium, item.hour, item.minute),
    title: item.title,
    desc: item.desc,
    type: item.type
  }));
}

const QUEUE_MULTIPLIERS = {
  'pre-open': 0.08,
  entry: 0.55,
  'pre-event': 0.7,
  'first-session': 0.42,
  intermission: 1.8,
  'second-session': 0.52,
  'post-event': 0.72,
  exit: 1.28
};

const CROWD_MULTIPLIERS = {
  'pre-open': 0.04,
  entry: 0.34,
  'pre-event': 0.58,
  'first-session': 0.83,
  intermission: 0.72,
  'second-session': 0.88,
  'post-event': 0.62,
  exit: 0.46
};

function withNoise(base, noise) {
  return Math.max(0, base + (Math.random() - 0.5) * 2 * noise);
}

function generateQueueData(stadium, phase = getGamePhase(stadium)) {
  const multiplier = QUEUE_MULTIPLIERS[phase] || 0.5;

  return stadium.queues.map(queue => {
    const waitMin = Math.round(withNoise(queue.baseWait * multiplier, 3));
    const capacityPercent = Math.min(100, Math.round(withNoise(multiplier * 70, 15)));
    const trendStates = ['rising', 'falling', 'stable'];
    const trend = trendStates[Math.floor(Math.random() * trendStates.length)];

    return {
      id: queue.id,
      name: queue.name,
      zone: queue.zone,
      icon: queue.icon,
      type: queue.type,
      waitMinutes: waitMin,
      capacityPercent,
      trend,
      status: waitMin < 5 ? 'low' : waitMin < 12 ? 'medium' : 'high'
    };
  });
}

function generateCrowdData(stadium, phase = getGamePhase(stadium)) {
  const baseDensity = CROWD_MULTIPLIERS[phase] || 0.5;

  return stadium.zones.map(zone => {
    const density = Math.min(1, withNoise(baseDensity, 0.15));
    return {
      id: zone.id,
      name: zone.name,
      lat: zone.lat,
      lng: zone.lng,
      density: Math.round(density * 100),
      status: density < 0.4 ? 'low' : density < 0.7 ? 'moderate' : 'congested',
      population: Math.round(density * zone.capacity)
    };
  });
}

function generateAlerts({ stadium, phase, queues, crowds, generatedAt }) {
  const alerts = [
    {
      id: 'info-venue',
      type: 'info',
      title: `Welcome to ${stadium.name}`,
      message: `Current phase: ${formatPhaseLabel(phase, stadium)}. Venue time: ${getVenueTimeLabel(stadium, new Date(generatedAt))}.`,
      timestamp: generatedAt
    }
  ];

  if (phase === 'intermission') {
    const shortestFood = [...queues]
      .filter(queue => queue.type === 'food')
      .sort((a, b) => a.waitMinutes - b.waitMinutes)[0];

    alerts.push({
      id: 'warn-break',
      type: 'warning',
      title: 'Intermission Rush Active',
      message: shortestFood
        ? `${shortestFood.name} currently looks like the quickest food stop during the break.`
        : 'Food and restroom pressure is rising during the break window.',
      timestamp: generatedAt
    });
  }

  if (phase === 'exit') {
    alerts.push({
      id: 'warn-exit',
      type: 'warning',
      title: 'Exit Flow In Progress',
      message: stadium.emergency.exitMessage,
      timestamp: generatedAt
    });
  }

  const busiestZone = crowds.reduce((highest, zone) => (
    !highest || zone.density > highest.density ? zone : highest
  ), null);

  if (busiestZone && busiestZone.density >= 72) {
    alerts.push({
      id: `crowd-${busiestZone.id}`,
      type: 'caution',
      title: `Crowd Building at ${busiestZone.name}`,
      message: `Density is around ${busiestZone.density}%. Consider alternate routes while flow settles.`,
      timestamp: generatedAt
    });
  }

  const longestQueue = queues.reduce((highest, queue) => (
    !highest || queue.waitMinutes > highest.waitMinutes ? queue : highest
  ), null);

  if (longestQueue && longestQueue.waitMinutes >= 15) {
    alerts.push({
      id: `queue-${longestQueue.id}`,
      type: 'warning',
      title: `${longestQueue.name} Is Backed Up`,
      message: `Waits are around ${longestQueue.waitMinutes} minutes. Check the Queue tab for a faster nearby option.`,
      timestamp: generatedAt
    });
  }

  return alerts;
}

const SNAPSHOTS_BY_STADIUM = new Map();

function getLiveSnapshot(stadium) {
  const phase = getGamePhase(stadium);
  const now = Date.now();
  const current = SNAPSHOTS_BY_STADIUM.get(stadium.slug);

  if (
    current &&
    current.phase === phase &&
    now - current.generatedAt < SIMULATION_CACHE_TTL_MS
  ) {
    return current;
  }

  const queues = generateQueueData(stadium, phase);
  const crowds = generateCrowdData(stadium, phase);
  const snapshot = {
    generatedAt: now,
    phase,
    queues,
    crowds,
    alerts: generateAlerts({ stadium, phase, queues, crowds, generatedAt: now })
  };

  SNAPSHOTS_BY_STADIUM.set(stadium.slug, snapshot);
  return snapshot;
}

/* ================================================================
   6. LOCAL ASSISTANT FALLBACK
   ================================================================ */

function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function findShortestQueue(queues, type) {
  const filtered = type ? queues.filter(queue => queue.type === type) : queues;
  return [...filtered].sort((a, b) => a.waitMinutes - b.waitMinutes)[0] || null;
}

function findCalmestZone(crowds) {
  return [...crowds].sort((a, b) => a.density - b.density)[0] || null;
}

function findNextEvent(stadium) {
  const now = Date.now();
  return getSchedule(stadium).find(event => new Date(event.time).getTime() > now) || null;
}

function generateLocalAssistantReply(stadium, snapshot, question) {
  const q = question.toLowerCase();
  const restroom = findShortestQueue(snapshot.queues, 'restroom');
  const food = findShortestQueue(snapshot.queues, 'food');
  const beverage = findShortestQueue(snapshot.queues, 'beverage');
  const merch = findShortestQueue(snapshot.queues, 'merchandise');
  const exitQueue = findShortestQueue(snapshot.queues, 'exit');
  const calmZone = findCalmestZone(snapshot.crowds);
  const nextEvent = findNextEvent(stadium);

  if (/emergency|medical|first aid|help/.test(q)) {
    return `For urgent help at ${stadium.name}, call ${stadium.emergency.number} and head toward ${joinList(stadium.emergency.medicalPoints)}. ${stadium.emergency.exitMessage} 🚨`;
  }

  if (/accessible|wheelchair|mobility|hearing|visual|companion/.test(q)) {
    const firstTwo = stadium.accessibility.slice(0, 2).map(item => `${item.title}: ${item.desc}`);
    return `${firstTwo.join(' ')} Ask a steward or guest services if you need real-time assistance routing. ♿`;
  }

  if (/restroom|toilet|washroom/.test(q)) {
    if (restroom) {
      return `${restroom.name} is currently the quickest restroom option at about ${restroom.waitMinutes} minutes, near ${restroom.zone.replace(/-/g, ' ')}. ${calmZone ? `${calmZone.name} is also one of the calmest nearby areas.` : ''} 🚻`;
    }
  }

  if (/food|eat|snack|meal/.test(q)) {
    if (food) {
      return `${food.name} looks like the fastest food option right now at about ${food.waitMinutes} minutes. If you want drinks instead, ${beverage ? `${beverage.name} is moving in about ${beverage.waitMinutes} minutes.` : 'beverage queues are lighter than food right now.'} 🍔`;
    }
  }

  if (/drink|beverage|coffee|bar/.test(q)) {
    if (beverage) {
      return `${beverage.name} is the quickest beverage stop right now at about ${beverage.waitMinutes} minutes. ${food ? `${food.name} is currently the shortest food queue if you want both.` : ''} 🥤`;
    }
  }

  if (/merch|shop|store|souvenir/.test(q)) {
    if (merch) {
      return `${merch.name} is your main merchandise stop, with waits around ${merch.waitMinutes} minutes at the moment. Try going outside the main break window for the smoothest visit. 🛍️`;
    }
  }

  if (/exit|leave|transport|metro|train|tram|parking|rideshare/.test(q)) {
    return `${stadium.services.transportInfo} ${exitQueue ? `${exitQueue.name} is currently tracking at about ${exitQueue.waitMinutes} minutes.` : ''} ${calmZone ? `${calmZone.name} looks like the calmest zone before you move.` : ''} 🚪`;
  }

  if (/lost|found|property|item/.test(q)) {
    return `${stadium.services.lostFoundInfo} Start with guest services or the main information desk for the quickest handoff. 📦`;
  }

  if (/schedule|next|when|event|kickoff|tip-off|innings|half/.test(q)) {
    return nextEvent
      ? `Next up at ${stadium.name}: ${nextEvent.title} at ${getVenueTimeLabel(stadium, new Date(nextEvent.time))}. Right now the venue is in ${formatPhaseLabel(snapshot.phase, stadium)}. 📅`
      : `The event is currently in ${formatPhaseLabel(snapshot.phase, stadium)} at ${stadium.name}. Keep an eye on the schedule view for the remaining timeline. 📅`;
  }

  if (/where|route|direction|gate|section|seat/.test(q)) {
    return calmZone
      ? `${calmZone.name} is currently the calmest zone to route through, and ${food ? `${food.name}` : 'the nearest service point'} is moving well nearby. If you tell me your gate or stand, I can guide you more precisely. 🗺️`
      : `Tell me your gate, stand, or destination and I can help route you through ${stadium.name}. 🗺️`;
  }

  return `It is currently ${formatPhaseLabel(snapshot.phase, stadium)} at ${stadium.name}. ${food ? `${food.name} is the fastest food stop at about ${food.waitMinutes} minutes.` : ''} ${calmZone ? `${calmZone.name} is the calmest zone right now at around ${calmZone.density}% density.` : ''} Ask me about restrooms, food, accessibility, exits, or transport. 🏟️`;
}

/* ================================================================
   7. GEMINI + FALLBACK CHAT
   ================================================================ */

async function generateReplyWithModel(activeModel, prompt) {
  const result = await activeModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 220
    }
  });

  return result.response.text().trim();
}

function shouldRetryWithFallbackModel(err) {
  return /not found|not supported|404/i.test(err.message || '');
}

/* ================================================================
   8. API ROUTES
   ================================================================ */

app.get('/api/health', (_req, res) => {
  const defaultStadium = resolveStadiumBySlug(ACTIVE_DEFAULT_STADIUM);
  res.set('Vary', 'Accept-Encoding');
  res.json({
    status: 'ok',
    service: 'StadiumPulse',
    version: '2.0.0',
    gemini: !!model,
    geminiConfigured: !!GEMINI_API_KEY && !GEMINI_DISABLED,
    geminiModel: GEMINI_MODEL,
    maps: !!MAPS_API_KEY,
    defaultStadium: ACTIVE_DEFAULT_STADIUM,
    stadiumCount: STADIUM_CATALOG.length,
    venueTimeZone: defaultStadium ? defaultStadium.timeZone : 'UTC',
    timestamp: Date.now()
  });
});

app.get('/api/stadiums', (_req, res) => {
  res.json({
    defaultStadium: ACTIVE_DEFAULT_STADIUM,
    stadiums: STADIUM_CATALOG.map(summarizeStadium),
    updatedAt: Date.now()
  });
});

app.get('/api/config', (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  const assistant = getAssistantMode();

  res.json({
    mapsApiKey: MAPS_API_KEY,
    venue: summarizeStadium(stadium),
    phase: getGamePhase(stadium),
    phaseLabels: stadium.phaseLabels,
    currentVenueTime: getVenueTimeLabel(stadium),
    assistantMode: assistant.mode,
    assistantLabel: assistant.label,
    suggestedQuestions: stadium.suggestedQuestions,
    assistPrompts: stadium.assistPrompts,
    accessibility: stadium.accessibility,
    services: stadium.services,
    emergency: stadium.emergency
  });
});

app.get('/api/queues', (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  const snapshot = getLiveSnapshot(stadium);
  res.json({
    stadium: stadium.slug,
    phase: snapshot.phase,
    queues: snapshot.queues,
    updatedAt: snapshot.generatedAt
  });
});

app.get('/api/crowds', (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  const snapshot = getLiveSnapshot(stadium);
  res.json({
    stadium: stadium.slug,
    phase: snapshot.phase,
    zones: snapshot.crowds,
    updatedAt: snapshot.generatedAt
  });
});

app.get('/api/schedule', (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  res.json({
    stadium: stadium.slug,
    phase: getGamePhase(stadium),
    events: getSchedule(stadium),
    updatedAt: Date.now()
  });
});

app.get('/api/alerts', (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  const snapshot = getLiveSnapshot(stadium);
  res.json({
    stadium: stadium.slug,
    phase: snapshot.phase,
    alerts: snapshot.alerts,
    updatedAt: snapshot.generatedAt
  });
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const stadium = getStadiumFromRequest(req, res);
  if (!stadium) return;

  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const sanitized = message.trim().slice(0, 500);
  if (!sanitized) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  const snapshot = getLiveSnapshot(stadium);
  const { queues, crowds, phase } = snapshot;
  const queueSummary = queues
    .map(queue => `${queue.name}: ${queue.waitMinutes} min wait (${queue.status})`)
    .join('\n');
  const crowdSummary = crowds
    .map(zone => `${zone.name}: ${zone.density}% density (${zone.status})`)
    .join('\n');

  const contextPrompt = `
CURRENT VENUE STATUS:
Venue: ${stadium.name}, ${stadium.city}, ${stadium.country}
Venue local time: ${getVenueTimeLabel(stadium)} (${stadium.timeZone})
Sport/Event Type: ${stadium.sport}
Current phase: ${formatPhaseLabel(phase, stadium)}

Queue Wait Times:
${queueSummary}

Crowd Density:
${crowdSummary}

Accessibility Summary:
${stadium.accessibility.map(item => `${item.title}: ${item.desc}`).join('\n')}

Emergency Summary:
Emergency number: ${stadium.emergency.number}
Medical points: ${joinList(stadium.emergency.medicalPoints)}
Exit guidance: ${stadium.emergency.exitMessage}

ATTENDEE QUESTION: ${sanitized}`;

  if (!model) {
    return res.json({
      reply: generateLocalAssistantReply(stadium, snapshot, sanitized),
      source: 'local-fallback',
      mode: 'local',
      updatedAt: snapshot.generatedAt
    });
  }

  try {
    const modelUsed = GEMINI_MODEL;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: contextPrompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 250 }
    });

    const response = result.response;

    // Gemini responses contain EITHER text OR function calls, not both.
    // Calling .text() when a function call is present throws an error.
    let call = null;
    let text = '';

    try {
      const fnCalls = response.functionCalls();
      if (fnCalls && fnCalls.length > 0) {
        call = fnCalls[0];
      }
    } catch (_) {
      // No function calls in this response
    }

    try {
      text = response.text() || '';
    } catch (_) {
      // No text in this response (function-call-only)
    }

    // If Gemini returned only a function call with no text, generate a contextual reply
    if (!text && call) {
      text = generateLocalAssistantReply(stadium, snapshot, sanitized);
    }

    // Final fallback if somehow both are empty
    if (!text) {
      text = generateLocalAssistantReply(stadium, snapshot, sanitized);
    }

    res.json({
      reply: text,
      tool_call: call ? { action: call.name, params: call.args } : null,
      source: call && !text ? 'gemini-tool' : 'gemini',
      mode: 'gemini',
      model: modelUsed,
      updatedAt: snapshot.generatedAt
    });
  } catch (err) {
    console.error('Gemini API error:', err.message);
    res.json({
      reply: generateLocalAssistantReply(stadium, snapshot, sanitized),
      source: 'local-fallback',
      mode: 'local',
      note: 'Gemini was temporarily unavailable, so StadiumPulse used the built-in venue assistant instead.',
      updatedAt: snapshot.generatedAt
    });
  }
});

/* ================================================================
   9. FALLBACK & SERVER START
   ================================================================ */

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

function startServer(port = PORT, { quiet = false } = {}) {
  return app.listen(port, () => {
    if (quiet) return;

    console.log(`\n🏟️  StadiumPulse server running on port ${port}`);
    console.log(`   Assistant: ${model ? `✅ Gemini (${GEMINI_MODEL})` : '🧠 Local venue assistant mode'}`);
    console.log(`   Maps API:  ${MAPS_API_KEY ? '✅ Enabled' : '⚠️  Disabled (set MAPS_API_KEY)'}`);
    console.log(`   Default Stadium: ${ACTIVE_DEFAULT_STADIUM}`);
    console.log(`   Stadiums Loaded: ${STADIUM_CATALOG.length}\n`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  getGamePhase,
  getSchedule,
  summarizeStadium
};
