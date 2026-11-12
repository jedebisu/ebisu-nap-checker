// The Express app is built here and exported WITHOUT listening, so automated
// tests can exercise it via supertest without opening a real port.
// src/server.js is the only place that listens.
const express = require('express');

const app = express();

// Parse JSON bodies for every API route (register, login, OTP...).
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Central error handler: keeps stack traces out of API responses.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
