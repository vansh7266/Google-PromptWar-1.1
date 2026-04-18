/**
 * StadiumPulse — Basic endpoint tests.
 * Validates that all API endpoints return correct responses.
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

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  return { status: res.status, data: await res.json() };
}

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

async function closeLocalServer() {
  if (!server) return;
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

  // --- Health Check ---
  await test('GET /api/health returns ok status', async () => {
    const { status, data } = await fetchJSON('/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', 'Status should be ok');
    assert(data.service === 'StadiumPulse', 'Service name mismatch');
    assert(typeof data.geminiModel === 'string', 'Gemini model should be exposed for diagnostics');
    assert(data.venueTimeZone === 'Asia/Kolkata', 'Venue timezone should match Ahmedabad');
    assert(typeof data.timestamp === 'number', 'Timestamp should be a number');
  });

  // --- Config ---
  await test('GET /api/config returns venue info', async () => {
    const { status, data } = await fetchJSON('/api/config');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.venue, 'Should contain venue object');
    assert(data.venue.name === 'Narendra Modi Stadium', 'Venue name mismatch');
    assert(typeof data.venue.lat === 'number', 'Lat should be a number');
    assert(typeof data.venue.lng === 'number', 'Lng should be a number');
    assert(data.venue.timeZone === 'Asia/Kolkata', 'Venue timezone mismatch');
    assert(typeof data.currentVenueTime === 'string', 'Venue clock should be included');
    assert(typeof data.phase === 'string', 'Phase should be a string');
  });

  // --- Queues ---
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
  });

  // --- Crowds ---
  await test('GET /api/crowds returns zone array', async () => {
    const { status, data } = await fetchJSON('/api/crowds');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.zones), 'Zones should be an array');
    assert(data.zones.length > 0, 'Should have at least 1 zone');
    const z = data.zones[0];
    assert(typeof z.density === 'number', 'Zone should have density');
    assert(z.density >= 0 && z.density <= 100, 'Density should be 0-100');
  });

  // --- Schedule ---
  await test('GET /api/schedule returns events', async () => {
    const { status, data } = await fetchJSON('/api/schedule');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.events), 'Events should be an array');
    assert(data.events.length >= 5, 'Should have at least 5 events');
    assert(typeof data.events[0].title === 'string', 'Event should have title');
  });

  // --- Alerts ---
  await test('GET /api/alerts returns alerts array', async () => {
    const { status, data } = await fetchJSON('/api/alerts');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.alerts), 'Alerts should be an array');
  });

  await test('Live data endpoints share one snapshot timestamp', async () => {
    const [queues, crowds, alerts] = await Promise.all([
      fetchJSON('/api/queues'),
      fetchJSON('/api/crowds'),
      fetchJSON('/api/alerts')
    ]);

    assert(queues.data.updatedAt === crowds.data.updatedAt, 'Queues and crowds should share one snapshot');
    assert(crowds.data.updatedAt === alerts.data.updatedAt, 'Crowds and alerts should share one snapshot');
  });

  // --- Chat: Input Validation ---
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

  await test('POST /api/chat accepts valid message', async () => {
    const { status, data } = await fetchJSON('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello' })
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof data.reply === 'string', 'Should return a reply string');
    assert(data.reply.length > 0, 'Reply should not be empty');
  });

  // --- Static File Serving ---
  await test('GET / serves index.html', async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('StadiumPulse'), 'Should contain app name');
    assert(text.includes('<!DOCTYPE html>'), 'Should be valid HTML');
  });

  // --- Security Headers ---
  await test('Response includes security headers', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(res.headers.has('x-content-type-options'), 'Missing X-Content-Type-Options');
    assert(res.headers.has('x-frame-options'), 'Missing X-Frame-Options');
    assert(
      !(res.headers.get('content-security-policy') || '').includes('upgrade-insecure-requests'),
      'Local CSP should not force HTTPS upgrades'
    );
  });

  // --- Summary ---
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
