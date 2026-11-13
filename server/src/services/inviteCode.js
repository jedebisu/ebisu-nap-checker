const crypto = require('crypto');

/**
 * Generate an invitation code in the GMAPS-XXXXXXXX format
 * (8 random hex characters).
 */
function generateInviteCode() {
  return `GMAPS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = { generateInviteCode };
