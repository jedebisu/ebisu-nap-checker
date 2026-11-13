// Stub email service for Task 6. Real wire-up deferred to Task 7.
// Tests import this module and replace implementations with jest.spyOn.
const sentEmails = [];

async function sendOtpEmail(to, otp) {
  sentEmails.push({ to, otp, type: 'otp' });
  return Promise.resolve();
}

async function sendTempPasswordEmail(to, tempPassword) {
  sentEmails.push({ to, tempPassword, type: 'temp-password' });
  return Promise.resolve();
}

function getSentEmails() {
  return sentEmails;
}

function clearSentEmails() {
  sentEmails.length = 0;
}

module.exports = {
  sendOtpEmail,
  sendTempPasswordEmail,
  getSentEmails,
  clearSentEmails,
};
