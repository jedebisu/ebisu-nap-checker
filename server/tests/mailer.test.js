// The outbox fallback is what makes the whole flow work before the owner has
// SMTP values: every email the app "sends" must be readable as a file.
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('sendMail outbox fallback (no SMTP configured)', () => {
  let outbox;

  beforeEach(() => {
    outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'napcheck-outbox-'));
    process.env.MAIL_OUTBOX_DIR = outbox;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    jest.resetModules(); // mailer reads env at call time, but stay explicit
  });

  afterEach(() => {
    delete process.env.MAIL_OUTBOX_DIR;
    fs.rmSync(outbox, { recursive: true, force: true });
  });

  test('writes a file containing To, Subject and the body', async () => {
    const { sendMail } = require('../src/services/mailer');
    const res = await sendMail({
      to: 'user@example.com',
      subject: 'Your OTP',
      text: 'Code: 123456',
    });

    expect(res.delivered).toBe('outbox');
    const files = fs.readdirSync(outbox);
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
    expect(content).toContain('To: user@example.com');
    expect(content).toContain('Subject: Your OTP');
    expect(content).toContain('Code: 123456');
  });

  test('two messages never overwrite each other', async () => {
    const { sendMail } = require('../src/services/mailer');
    await sendMail({ to: 'a@example.com', subject: 's1', text: 'one' });
    await sendMail({ to: 'b@example.com', subject: 's2', text: 'two' });

    expect(fs.readdirSync(outbox)).toHaveLength(2);
    const contents = fs.readdirSync(outbox).map((f) =>
      fs.readFileSync(path.join(outbox, f), 'utf8')
    );
    expect(contents.filter((c) => c.includes('one'))).toHaveLength(1);
    expect(contents.filter((c) => c.includes('two'))).toHaveLength(1);
  });
});
