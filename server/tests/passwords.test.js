// The password rules live here (not in the route) so the same rules guard
// both first-login reset and any future password change path.
const { validatePassword, generateTempPassword, hashPassword, verifyPassword } =
  require('../src/services/passwords');

describe('validatePassword', () => {
  test('accepts a compliant password', () => {
    expect(validatePassword('Ab1!xxxx')).toEqual({ valid: true });
  });

  test.each([
    ['ab1!xxxx', 'uppercase'], // no uppercase
    ['AB!xxxxx', 'number'], // no digit
    ['AB1xxxxx', 'special'], // no special character
    ['Ab1!xx', 'length'], // fewer than 8 chars
  ])('rejects %j and names the reason', (pw, reason) => {
    const res = validatePassword(pw);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(reason);
  });
});

describe('generateTempPassword', () => {
  test('is 14 chars and always contains every required class (50 runs)', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(14);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });
});

describe('hashPassword / verifyPassword', () => {
  test('roundtrip verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('Ab1!xxxx');
    expect(hash).not.toBe('Ab1!xxxx');
    expect(await verifyPassword('Ab1!xxxx', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
