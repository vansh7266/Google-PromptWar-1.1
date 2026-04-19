# 🏟️ StadiumPulse — AI-Powered Stadium Experience Assistant

> A smart, real-time stadium companion that uses **Google Gemini AI** and **Google Maps** to optimize the physical event experience for attendees at large-scale sporting venues.

---

## 🎯 Chosen Vertical

**Physical Event Experience at Large-Scale Sporting Venues**

StadiumPulse tackles the core challenges faced by 100,000+ attendees at major cricket stadiums:
- **Crowd congestion** and navigation difficulties
- **Long wait times** at food stalls, restrooms, and exits
- **Lack of real-time coordination** and venue awareness

---

## 💡 Approach & Logic

### Smart Dynamic Assistant
StadiumPulse acts as a **context-aware AI assistant** that understands the live venue state and provides personalized guidance:

1. **Contextual AI Chat (Gemini)** — The AI receives live queue wait times and crowd density data in every prompt, enabling responses like *"North Snack Bar has a 3-minute wait vs. Main Food Court at 15 minutes — head to North Pavilion!"*

2. **Advanced Tool Calling** — Gemini can trigger UI actions (highlight zones on map, show queue filters, open accessibility panel) via function declarations, creating an intelligent assistant that controls the interface.

3. **Time-Aware Simulation** — The system models realistic game-phase patterns (pre-match, innings, break, exit), adjusting crowd and queue data dynamically based on time of day.

4. **Multi-Signal Decision Making** — Quick action buttons trigger AI queries that combine multiple data points (queue status + crowd density + venue layout) for optimal recommendations.

### Architecture

```
┌─────────────────────────────────────────┐
│       index.html (Frontend UI)          │
│  Dashboard │ Map │ Queues │ AI │ More   │
│  Google Maps JS API + Google Fonts      │
│  app.js (Modular Client Logic)          │
│  sw.js (Service Worker / PWA)           │
└──────────────┬──────────────────────────┘
               │ REST API (fetch)
┌──────────────▼──────────────────────────┐
│          server.js (Express.js)         │
│  /api/chat  → Gemini AI (tool calling)  │
│  /api/queues → Simulated queue engine   │
│  /api/crowds → Crowd density engine     │
│  /api/alerts → Dynamic alert system     │
│  /api/config → Venue configuration      │
│  Security: Helmet, Rate Limit, CORS     │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│       Google Cloud Run (Docker)         │
│  Multi-stage build, non-root user       │
└─────────────────────────────────────────┘
```

---

## ✨ How the Solution Works

### Features

| Feature | Description |
|---------|-------------|
| **AI Concierge** | Natural language assistant powered by Gemini with function calling — asks about food, restrooms, directions, emergencies |
| **AI Tool Calling** | Gemini can trigger UI actions: highlight zones on map, filter queues, open accessibility panel |
| **Live Crowd Heatmap** | Google Maps with visualization heatmap layer showing real-time crowd density per zone |
| **Queue Tracker** | Wait time estimates for 10+ venue points with capacity bars, trends, and category filters |
| **Event Timeline** | Match schedule with live/completed/upcoming status indicators |
| **Quick Actions** | One-tap buttons for nearest restroom, shortest food queue, directions, emergency |
| **Accessibility Hub** | Wheelchair routes, hearing assistance, visual aids, accessible seating info |
| **Experience Controls** | Built-in large text, high contrast, and calm motion toggles saved on-device |
| **Alert System** | Context-aware alerts for crowd buildup, innings breaks, staggered exits |
| **Multi-Stadium** | 4 stadiums supported out of the box with easy stadium switching |
| **PWA Support** | Installable as a standalone app with offline caching via service worker |

### Google Services Integration

| Service | Integration |
|---------|-------------|
| **Gemini 2.5 Flash-Lite** | AI chat with live venue context + advanced function calling/tool use for UI automation (override via `GEMINI_MODEL`) |
| **Google Maps JS API** | Interactive map with heatmap visualization layer, Advanced Markers, and zone overlays |
| **Google Fonts** | Google Sans + Roboto typography stack for a clean Material Design feel |
| **Google Cloud Run** | Containerized deployment with health checks, non-root user, multi-stage Docker build |

---

## 🛡️ Technical Highlights

### Security
- **Helmet.js** — CSP, X-Frame-Options, X-Content-Type-Options, HSTS, and more
- **Rate Limiting** — 30 req/min general, 10 req/min for AI chat
- **Input Sanitization** — HTML entity escaping on all user input (client + server)
- **API Key Protection** — Gemini key stays server-side, never exposed to client
- **Input Validation** — Stadium slug format validation (regex)
- **Non-root Docker** — Container runs as unprivileged user
- **CSP Policy** — Content Security Policy with strict source directives

### Accessibility (WCAG 2.1 AA)
- Skip-to-content navigation link
- Proper ARIA roles (`tabpanel`, `tablist`, `log`, `status`, `alert`, `toolbar`)
- `aria-pressed` state management on all toggle buttons
- `aria-selected` state management on navigation tabs
- Keyboard navigation with arrow keys between tabs
- `role="button"` elements support Enter/Space key activation
- Screen reader live announcements (`aria-live="polite"`) for all dynamic content
- `prefers-reduced-motion` media query support
- `forced-colors` (Windows High Contrast mode) support
- `focus-visible` outlines on all interactive elements
- Large text, high contrast, and calm motion toggle preferences
- Semantic HTML5 elements (`<header>`, `<main>`, `<nav>`, `<section>`)

### Efficiency
- Modular architecture — `index.html` (UI) + `app.js` (logic) + `sw.js` (PWA)
- Debounced event handlers and smart data caching
- Lazy map loading (only when Map tab is opened)
- 30-second auto-refresh interval (avoids aggressive polling)
- Snapshot-cached simulation keeps dashboard, alerts, chat, and queues in sync
- Venue-local time handling (per-stadium timezone via `Intl.DateTimeFormat`)
- Multi-stage Docker build for minimal image size (~50MB)
- Stale-while-revalidate service worker caching for API responses

### Testing
- 24 automated endpoint tests covering:
  - Health check with metadata validation
  - Multi-stadium endpoint support
  - Stadium parameter validation (valid/invalid slugs)
  - 404 handling for unknown stadiums
  - Chat input validation (empty, non-string, whitespace)
  - Snapshot consistency across live-data endpoints
  - Security header verification (CSP, X-Frame, CORS)
  - Rate limit header presence
  - Content-Type validation
  - PWA manifest serving
  - Static file serving
- Run: `npm test` (the suite starts and stops its own local server)

---

## 🚀 Setup & Run

### Prerequisites
- Node.js ≥ 20
- Google Gemini API key ([Get one](https://aistudio.google.com/apikey))
- Google Maps API key ([Get one](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com))

### Local Development

```bash
# Install dependencies
npm install

# Create .env file
echo "GEMINI_API_KEY=your_gemini_key_here" > .env
echo "MAPS_API_KEY=your_maps_key_here" >> .env
echo "GEMINI_MODEL=gemini-2.5-flash-lite" >> .env   # optional override

# Start server
npm start

# Open http://localhost:8080
```

### Run Tests

```bash
npm test
```

### Deploy to Google Cloud Run

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Build and deploy
gcloud run deploy stadiumpulse \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=your_key,MAPS_API_KEY=your_key,GEMINI_MODEL=gemini-2.5-flash-lite"
```

---

## 📝 Assumptions

1. **Simulated Data** — Queue wait times and crowd density are simulated with realistic time-based patterns (no physical IoT sensors). In production, this would connect to venue sensor APIs.
2. **Multi-Venue Model** — 4 stadiums are supported: Narendra Modi Stadium (India), Melbourne Cricket Ground (Australia), Wembley Stadium (UK), and Madison Square Garden (USA). The approach is generalizable to any venue.
3. **Game Schedule** — A sample T20 cricket match schedule is used. The system adapts behavior based on game phase (entry → match → break → exit), and all match-time logic is anchored to each stadium's local timezone.
4. **Modular Frontend** — HTML (structure/style) and JS (logic) are separated into `index.html` and `app.js` for clean code organization.

---

## 📁 Repository Structure

```
├── index.html        # Frontend UI (HTML + CSS)
├── app.js            # Client-side application logic
├── server.js         # Express backend with Gemini AI
├── sw.js             # Service Worker for PWA offline support
├── manifest.json     # PWA manifest configuration
├── package.json      # Node.js configuration & dependencies
├── test.js           # Automated API test suite (24 tests)
├── data/
│   └── stadiums/     # Stadium data files (JSON)
│       ├── narendra-modi-stadium.json
│       ├── melbourne-cricket-ground.json
│       ├── wembley-stadium.json
│       └── madison-square-garden.json
├── Dockerfile        # Multi-stage Cloud Run deployment
├── .dockerignore     # Docker build exclusions
├── .gitignore        # Git exclusions
└── README.md         # This file
```

---

## 📜 License

MIT
