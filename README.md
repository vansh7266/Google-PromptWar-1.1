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

2. **Time-Aware Simulation** — The system models realistic game-phase patterns (pre-match, innings, break, exit), adjusting crowd and queue data dynamically based on time of day.

3. **Multi-Signal Decision Making** — Quick action buttons trigger AI queries that combine multiple data points (queue status + crowd density + venue layout) for optimal recommendations.

### Architecture

```
┌─────────────────────────────────────────┐
│         index.html (Frontend)           │
│  Dashboard │ Map │ Queues │ AI │ More   │
│     Google Maps JS API + Google Fonts   │
└──────────────┬──────────────────────────┘
               │ REST API (fetch)
┌──────────────▼──────────────────────────┐
│          server.js (Express.js)         │
│  /api/chat  → Gemini AI (context-aware) │
│  /api/queues → Simulated queue engine   │
│  /api/crowds → Crowd density engine     │
│  /api/alerts → Dynamic alert system     │
│  Security: Helmet, Rate Limit, CORS     │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│       Google Cloud Run (Docker)         │
└─────────────────────────────────────────┘
```

---

## ✨ How the Solution Works

### Features

| Feature | Description |
|---------|-------------|
| **AI Concierge** | Natural language assistant powered by Gemini — asks about food, restrooms, directions, emergencies |
| **Live Crowd Heatmap** | Google Maps with visualization heatmap layer showing real-time crowd density per zone |
| **Queue Tracker** | Wait time estimates for 10 venue points with capacity bars, trends, and filters |
| **Event Timeline** | Match schedule with live/completed/upcoming status indicators |
| **Quick Actions** | One-tap buttons for nearest restroom, shortest food queue, directions, emergency |
| **Accessibility Hub** | Wheelchair routes, hearing assistance, visual aids, accessible seating info |
| **Experience Controls** | Built-in large text, high contrast, and calm motion toggles saved on-device |
| **Alert System** | Context-aware alerts for crowd buildup, innings breaks, staggered exits |

### Google Services Integration

| Service | Integration |
|---------|-------------|
| **Gemini 2.5 Flash-Lite** | Lightweight Gemini chat with live venue context injected into every prompt (override via `GEMINI_MODEL`) |
| **Google Maps JS API** | Interactive satellite map with heatmap visualization layer and zone markers |
| **Google Fonts** | Space Grotesk + Manrope typography stack for a more premium stadium-control-room feel |
| **Google Cloud Run** | Containerized deployment with health checks |

---

## 🛡️ Technical Highlights

### Security
- **Helmet.js** — CSP, X-Frame-Options, HSTS, and more
- **Rate Limiting** — 30 req/min general, 10 req/min for AI chat
- **Input Sanitization** — HTML entity escaping on all user input
- **API Key Protection** — Gemini key stays server-side, never exposed to client
- **Non-root Docker** — Container runs as unprivileged user

### Accessibility
- WCAG-compliant ARIA labels on all interactive elements
- Skip-to-content navigation link
- Keyboard navigation with arrow keys between tabs
- Screen reader live announcements for dynamic content
- `prefers-reduced-motion` media query support
- `forced-colors` (high contrast mode) support
- Focus-visible outlines

### Efficiency
- Single HTML file — zero client-side dependencies
- Debounced event handlers
- Lazy map loading (only when Map tab is opened)
- 30-second auto-refresh interval (not polling aggressively)
- Snapshot-cached simulation so dashboard, alerts, chat, and queues stay in sync
- Venue-local time handling for Ahmedabad match schedules and live phase logic
- Multi-stage Docker build for minimal image size

### Testing
- 12 automated endpoint tests covering all API routes
- Input validation tests for chat endpoint
- Snapshot consistency coverage across live-data endpoints
- Security header verification
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
2. **Venue Model** — Based on Narendra Modi Stadium, Ahmedabad (world's largest cricket stadium, 132,000 capacity). The approach is generalizable to any venue.
3. **Game Schedule** — A sample T20 cricket match schedule is used. The system adapts behavior based on game phase (entry → match → break → exit), and all match-time logic is anchored to Ahmedabad local time (`Asia/Kolkata`).
4. **Single File Frontend** — All HTML, CSS, and JS are in one `index.html` for simplicity and portability. No build tools or frameworks required.

---

## 📁 Repository Structure

```
├── index.html        # Complete frontend (HTML + CSS + JS)
├── server.js         # Express backend with Gemini AI
├── package.json      # Node.js configuration
├── test.js           # Automated API tests
├── Dockerfile        # Cloud Run deployment
├── .dockerignore     # Docker build exclusions
├── .gitignore        # Git exclusions
└── README.md         # This file
```

---

## 📜 License

MIT
