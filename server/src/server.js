// Entry point: builds the app (src/app.js) and listens. Nothing lives here
// that tests need — all routes belong in app.js or route modules.
const app = require('./app');

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`EBISU NAP Checker server running on port ${PORT}`);
});
