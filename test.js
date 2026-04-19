/**
 * StadiumPulse — Comprehensive API Test Suite.
 * Validates all API endpoints, security headers, input validation,
 * multi-stadium support, caching behavior, and error handling.
 *
 * Run: node test.js
 * @module test
 */

'use strict';

const { startServer } = require('./server');

let BASE = process.env.TEST_URL || '';
let passed = 0;
let failed = 0;
let server = null;

/**
 * Runs a single test case.
 * @param {string} name - Test description
 * @param {Function} fn - Async test function
 */
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

/**
 * Asserts a condition is truthy.
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

/**
 * Fetches JSON from a given API path.
 * @param {string} path - API endpoint path
 * @param {Object} [options={}] - Fetch options
 * @returns {Promise<{status: number, data: Object, headers: Headers}>}
 */
async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

/**
 * Starts a local server for testing if no TEST_URL is provided.
 */
async function startLocalServerIfNeeded() {
  if (BASE) return;

  server = startServer(0, { quiet: true });
  if (server.listening) {
    const { port } = server.address();
    BASE = `http://127.0.0.1:${port}`;
    return;
  }

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}`;
}

/**
 * Closes the local test server gracefully.
 */
async function closeLocalServer() {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

/* ================================================================
   TEST SUITE
   ================================================================ */

async function runTests() {
  await startLocalServerIfNeeded();

  console.log('\n🏟️  StadiumPulse Test Suite\n');
  console.log(`  Target: ${BASE}\n`);

  /* ----------------------------------------------------------
     1. HEALTH CHECK
     ---------------------------------------------------------- */
  await test('GET /api/health returns ok status', async () => {
    const { status, data } = await fetchJSON('/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', 'Status should be ok');
    assert(data.service === 'StadiumPulse', 'Service name mismatch');
    assert(typeof data.geminiModel === 'string', 'Gemini model should be exposed for diagnostics');
    assert(data.venueTimeZone === 'Asia/Kolkata', 'Venue timezone should match Ahmedabad');
    assert(typeof data.timestamp === 'number', 'Timestamp should be a number');
  });

  await test('GET /api/health includes stadium metadata', async () => {
    const { data } = await fetchJSON('/api/health');
    assert(typeof data.stadiumCount === 'number', 'Stadium count should be a number');
    assert(data.stadiumCount > 0, 'Should have at least 1 stadium');
    assert(typeof data.defaultStadium === 'string', 'Default stadium should be a string');
    assert(typeof data.gemini === 'boolean', 'Gemini status should be boolean');
    assert(typeof data.maps === 'boolean', 'Maps status should be boolean');
  });

  /* ----------------------------------------------------------
     2. STADIUMS CATALOG
     ---------------------------------------------------------- */
  await test('GET /api/stadiums returns stadium catalog', async () => {
    const { status, data } = await fetchJSON('/api/stadiums');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.stadiums), 'Stadiums should be an array');
    assert(data.stadiums.length >= 2, 'Should have at least 2 stadiums');
    assert(typeof data.defaultStadium === 'string', 'Should include defaultStadium');

    const stadium = data.stadiums[0];
    assert(typeof stadium.slug === 'string', 'Stadium should have slug');
    assert(typeof stadium.name === 'string', 'Stadium should have name');
    assert(typeof stadium.lat === 'number', 'Stadium should have lat');
    assert(typeof stadium.lng === 'number', 'Stadium should have lng');
    assert(typeof stadium.capacity === 'number', 'Stadium should have capacity');
  });

  /* ----------------------------------------------------------
     3. CONFIGURATION
     ---------------------------------------------------------- */
  await test('GET /api/config returns venue info', async () => {
    const { status, data } = await fetchJSON('/api/config');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.venue, 'Should contain venue object');
    assert(typeof data.venue.name === 'string', 'Venue should have a name');
    assert(typeof data.venue.lat === 'number', 'Lat should be a number');
    assert(typeof data.venue.lng === 'number', 'Lng should be a number');
    assert(typeof data.venue.timeZone === 'string', 'Venue should have timeZone');
    assert(typeof data.currentVenueTime === 'string', 'Venue clock should be included');
    assert(typeof data.phase === 'string', 'Phase should be a string');
  });

  await test('GET /api/config includes accessibility and emergency data', async () => {
    const { data } = await fetchJSON('/api/config');
    assert(Array.isArray(data.accessibility), 'Accessibility should be an array');
    assert(data.accessibility.length > 0, 'Should have at least 1 accessibility item');
    assert(data.emergency, 'Should include emergency data');
    assert(typeof data.emergency.number === 'string', 'Emergency should have a phone number');
    assert(Array.isArray(data.emergency.medicalPoints), 'Emergency should have medical points');
    assert(typeof data.assistantMode === 'string', 'Should include assistant mode');
  });

  await test('GET /api/config supports stadium parameter', async () => {
    const stadiums = await fetchJSON('/api/stadiums');
    const altStadium = stadiums.data.stadiums.find(s => s.slug !== stadiums.data.defaultStadium);
    if (altStadium) {
      const { status, data } = await fetchJSON(`/api/config?stadium=${altStadium.slug}`);
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.venue.slug === altStadium.slug, 'Should return data for the requested stadium');
    }
  });

  /* ----------------------------------------------------------
     4. QUEUES
     ---------------------------------------------------------- */
  await test('GET /api/queues returns queue array', async () => {
    const { status, data } = await fetchJSON('/api/queues');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.queues), 'Queues should be an array');
    assert(data.queues.length > 0, 'Should have at least 1 queue');
    const q = data.queues[0];
    assert(typeof q.id === 'string', 'Queue should have id');
    assert(typeof q.name === 'string', 'Queue should have name');
    assert(typeof q.waitMinutes === 'number', 'Queue should have waitMinutes');
    assert(['low', 'medium', 'high'].includes(q.status), 'Queue status invalid');
    assert(typeof q.trend === 'string', 'Queue should have trend');
    assert(typeof q.capacityPercent === 'number', 'Queue should have capacityPercent');
  });

  /* ----------------------------------------------------------
     5. CROWDS
     ---------------------------------------------------------- */
  await test('GET /api/crowds returns zone array', async () => {
    const { status, data } = await fetchJSON('/api/crowds');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.zones), 'Zones should be an array');
    assert(data.zones.length > 0, 'Should have at least 1 zone');
    const z = data.zones[0];
    assert(typeof z.density === 'number', 'Zone should have density');
    assert(z.density >= 0 && z.density <= 100, 'Density should be 0-100');
    assert(typeof z.name === 'string', 'Zone should have name');
    assert(typeof z.lat === 'number', 'Zone should have lat');
    assert(typeof z.lng === 'number', 'Zone should have lng');
  });

  /* ----------------------------------------------------------
     6. SCHEDULE
     ---------------------------------------------------------- */
  await test('GET /api/schedule returns events', async () => {
    const { status, data } = await fetchJSON('/api/schedule');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.events), 'Events should be an array');
    assert(data.events.length >= 5, 'Should have at least 5 events');
    assert(typeof data.events[0].title === 'string', 'Event should have title');
    assert(typeof data.events[0].time === 'string', 'Event should have time');
    assert(typeof data.events[0].desc === 'string', 'Event should have desc');
  });

  /* ----------------------------------------------------------
     7. ALERTS
     ---------------------------------------------------------- */
  await test('GET /api/alerts returns alerts array', async () => {
    const { status, data } = await fetchJSON('/api/alerts');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.alerts), 'Alerts should be an array');
    assert(data.alerts.length > 0, 'Should have at least 1 alert (always includes welcome)');
    assert(typeof data.alerts[0].type === 'string', 'Alert should have type');
    assert(typeof data.alerts[0].title === 'string', 'Alert should have title');
  });

  /* ----------------------------------------------------------
     8. SNAPSHOT CONSISTENCY
     ---------------------------------------------------------- */
  await test('Live data endpoints share one snapshot timestamp', async () => {
    const [queues, crowds, alerts] = await Promise.all([
      fetchJSON('/api/queues'),
      fetchJSON('/api/crowds'),
      fetchJSON('/api/alerts')
    ]);

    assert(queues.data.updatedAt === crowds.data.updatedAt, 'Queues and crowds should share one snapshot');
    assert(crowds.data.updatedAt === alerts.data.updatedAt, 'Crowds and alerts should share one snapshot');
  });

  /* ----------------------------------------------------------
     9. CHAT INPUT VALIDATION
     ---------------------------------------------------------- */
  await test('POST /api/chat rejects empty body', async () => {
    const { status, data } = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(data.error, 'Should return error message');
  });

  await test('POST /api/chat rejects non-string message', async () => {
    const { status } = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 123 })
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/chat rejects whitespace-only message', async () => {
    const { status } = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '   ' })
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/chat accepts valid message', async () => {
    const { status, data } = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello' })
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof data.reply === 'string', 'Should return a reply string');
    assert(data.reply.length > 0, 'Reply should not be empty');
    assert(typeof data.source === 'string', 'Reply should include source');
    assert(typeof data.mode === 'string', 'Reply should include mode');
  });

  /* ----------------------------------------------------------
     10. MULTI-STADIUM SUPPORT
     ---------------------------------------------------------- */
  await test('API endpoints accept stadium query parameter', async () => {
    const stadiums = await fetchJSON('/api/stadiums');
    const slug = stadiums.data.stadiums[0].slug;

    const [config, queues, crowds] = await Promise.all([
      fetchJSON(`/api/config?stadium=${slug}`),
      fetchJSON(`/api/queues?stadium=${slug}`),
      fetchJSON(`/api/crowds?stadium=${slug}`)
    ]);

    assert(config.status === 200, 'Config should return 200 with stadium param');
    assert(queues.data.stadium === slug, 'Queues should be for requested stadium');
    assert(crowds.data.stadium === slug, 'Crowds should be for requested stadium');
  });

  await test('Invalid stadium slug returns 404', async () => {
    const { status, data } = await fetchJSON('/api/config?stadium=nonexistent-stadium');
    assert(status === 404, `Expected 404, got ${status}`);
    assert(data.error, 'Should return error message');
    assert(Array.isArray(data.stadiums), 'Should include available stadiums list');
  });

  /* ----------------------------------------------------------
     11. STATIC FILE SERVING
     ---------------------------------------------------------- */
  await test('GET / serves index.html', async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('StadiumPulse'), 'Should contain app name');
    assert(text.includes('<!DOCTYPE html>'), 'Should be valid HTML');
  });

  await test('GET /app.js serves client-side JavaScript', async () => {
    const res = await fetch(`${BASE}/app.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const contentType = res.headers.get('content-type');
    assert(contentType.includes('javascript'), 'Should serve JavaScript content type');
  });

  await test('GET /manifest.json serves PWA manifest', async () => {
    const res = await fetch(`${BASE}/manifest.json`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.name === 'string', 'Manifest should have name');
    assert(typeof data.start_url === 'string', 'Manifest should have start_url');
    assert(data.display === 'standalone', 'Manifest display should be standalone');
  });

  await test('App shell assets disable aggressive caching', async () => {
    const assets = ['/', '/app.js', '/index.css', '/manifest.json', '/sw.js'];

    for (const asset of assets) {
      const res = await fetch(`${BASE}${asset}`);
      const cacheControl = res.headers.get('cache-control') || '';
      assert(cacheControl.includes('no-cache'), `${asset} should require cache revalidation`);
    }
  });

  /* ----------------------------------------------------------
     12. SECURITY HEADERS
     ---------------------------------------------------------- */
  await test('Response includes security headers', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(res.headers.has('x-content-type-options'), 'Missing X-Content-Type-Options');
    assert(res.headers.has('x-frame-options'), 'Missing X-Frame-Options');
    assert(
      !(res.headers.get('content-security-policy') || '').includes('upgrade-insecure-requests'),
      'Local CSP should not force HTTPS upgrades'
    );
  });

  await test('CORS headers are present', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(
      res.headers.has('access-control-allow-origin'),
      'Should include CORS Allow-Origin header'
    );
  });

  await test('Content-Type is application/json for API responses', async () => {
    const res = await fetch(`${BASE}/api/health`);
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('application/json'), 'API should return application/json');
  });

  await test('Rate limit headers are present on API calls', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(
      res.headers.has('ratelimit-limit') || res.headers.has('x-ratelimit-limit'),
      'Should include rate limit headers'
    );
  });

  /* ----------------------------------------------------------
     SUMMARY
     ---------------------------------------------------------- */
  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  await closeLocalServer();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  closeLocalServer()
    .catch(closeErr => {
      console.error('Failed to close local test server:', closeErr);
    })
    .finally(() => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
});
