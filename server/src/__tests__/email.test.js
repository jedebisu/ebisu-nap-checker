// Email service tests.
// In the Jest environment the service falls back to an in-memory log, so the
// first group runs without a network or RESEND_API_KEY. The second group
// simulates a non-test environment with the `resend` module mocked out, so no
// real network calls are ever made.
const mockSend = jest.fn();
const mockResendCtor = jest.fn(() => ({ emails: { send: mockSend } }));

jest.mock('resend', () => ({
  Resend: mockResendCtor,
}));

const emailService = require('../services/email');

const SAVED_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  JEST_WORKER_ID: process.env.JEST_WORKER_ID,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function enterNonTestEnv() {
  process.env.NODE_ENV = 'development';
  process.env.JEST_WORKER_ID = '';
}

afterEach(() => {
  restoreEnv();
  mockSend.mockReset();
  mockResendCtor.mockClear();
  emailService.clearSentEmails();
});

describe('test-environment fallback (no network, no API key)', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    emailService.clearSentEmails();
  });

  it('sendOtpEmail resolves and logs to the sentEmails array', async () => {
    await expect(emailService.sendOtpEmail('user@example.com', '123456')).resolves.toBeUndefined();
    const sent = emailService.getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ to: 'user@example.com', otp: '123456', type: 'otp' });
  });

  it('sendTempPasswordEmail resolves and logs to the sentEmails array', async () => {
    await expect(emailService.sendTempPasswordEmail('user@example.com', 'tmp-pass-123')).resolves.toBeUndefined();
    const sent = emailService.getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ to: 'user@example.com', tempPassword: 'tmp-pass-123', type: 'temp-password' });
  });

  it('does not call Resend in test mode', async () => {
    await emailService.sendOtpEmail('user@example.com', '654321');
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockResendCtor).not.toHaveBeenCalled();
  });
});

describe('non-test environment with mocked resend module', () => {
  beforeEach(() => {
    enterNonTestEnv();
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });
  });

  it('sendOtpEmail sends via Resend with the expected from/subject/body', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    await emailService.sendOtpEmail('user@example.com', '123456');

    expect(mockResendCtor).toHaveBeenCalledTimes(1);
    expect(mockResendCtor).toHaveBeenCalledWith('re_test_key');
    expect(mockSend).toHaveBeenCalledTimes(1);

    const payload = mockSend.mock.calls[0][0];
    expect(payload.from).toBe('G-MAPS <noreply@ebisudps.com>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toBe('Your G-MAPS verification code');
    expect(payload.subject).toContain('G-MAPS');
    expect(payload.text).toContain('123456');
    expect(payload.text).toContain('5 minutes');
    expect(payload.html).toContain('123456');
    expect(payload.html).toContain('#00539B');
    expect(`${payload.text}\n${payload.html}`).not.toMatch(/ebisu/i);
  });

  it('sendTempPasswordEmail sends via Resend with the expected from/subject/body', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    await emailService.sendTempPasswordEmail('user@example.com', 'tmp-pass-123');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.from).toBe('G-MAPS <noreply@ebisudps.com>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toBe('Your G-MAPS temporary password');
    expect(payload.subject).toContain('G-MAPS');
    expect(payload.text).toContain('tmp-pass-123');
    expect(payload.html).toContain('tmp-pass-123');
    expect(payload.html).toContain('#00539B');
    expect(`${payload.text}\n${payload.html}`).not.toMatch(/ebisu/i);
  });

  it('honours EMAIL_FROM override', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'G-MAPS <staging@example.com>';
    await emailService.sendOtpEmail('user@example.com', '123456');
    expect(mockSend.mock.calls[0][0].from).toBe('G-MAPS <staging@example.com>');
  });

  it('throws a clear config error when RESEND_API_KEY is unset (OTP)', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(emailService.sendOtpEmail('user@example.com', '123456'))
      .rejects.toThrow(/RESEND_API_KEY is not set/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('throws a clear config error when RESEND_API_KEY is unset (temp password)', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(emailService.sendTempPasswordEmail('user@example.com', 'tmp-pass-123'))
      .rejects.toThrow(/RESEND_API_KEY is not set/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('throws when Resend reports an error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: null, error: { message: 'invalid key' } });
    await expect(emailService.sendOtpEmail('user@example.com', '123456'))
      .rejects.toThrow(/Failed to send email/);
  });

  it('errors on Resend API failure for temp-password', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: 'invalid key' } }));
    await expect(emailService.sendTempPasswordEmail('a@b.com', 'x'))
      .rejects.toThrow(/invalid key/);
  });
});
