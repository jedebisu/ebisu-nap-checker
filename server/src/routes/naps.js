// Read-only proxy to the existing Render NAP API. Why a proxy instead of
// calling Render from the app: one place configures the upstream URL, every
// request is gated by our own login, and the app never embeds a public API.
const express = require('express');
const { requireAuth } = require('../services/tokens');

const router = express.Router();

router.use(requireAuth);

const UPSTREAM = () =>
  process.env.RENDER_API_URL || 'https://selfie-api-sqgh.onrender.com';

async function forward(req, res) {
  const query = new URLSearchParams(req.query).toString();
  const url = `${UPSTREAM()}/api/naps${req.path}${query ? `?${query}` : ''}`;

  const controller = new AbortController();
  // Render's free tier can take 30s+ to wake a sleeping instance; 10s was too
  // tight and surfaced as false NAP_SERVICE_UNAVAILABLE errors.
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'NAP_SERVICE_UNAVAILABLE' });
    }
    res.json(await upstream.json()).set('Cache-Control', 'no-store, no-cache, must-revalidate');
  } catch (err) {
    console.error('NAP proxy failed:', err.message);
    res.status(502).json({ error: 'NAP_SERVICE_UNAVAILABLE' }).set('Cache-Control', 'no-store, no-cache, must-revalidate');
  } finally {
    clearTimeout(timer);
  }
}

// stats/summary MUST be registered before /:napId, or it becomes a NAP id.
router.get('/stats/summary', forward);
router.get('/nearest', forward);
router.get('/search', forward);
router.get('/:napId', forward);

module.exports = router;
