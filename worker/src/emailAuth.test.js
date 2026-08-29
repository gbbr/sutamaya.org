import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codeEmail,
  generateCode,
  hashCode,
  isPlausibleEmail,
  normalizeEmail,
  sendEmail,
  timingSafeEqual,
} from './emailAuth.js';

const SECRET = 'test-secret-not-for-prod';

describe('normalizeEmail / isPlausibleEmail', () => {
  it('lowercases and trims, so one address cannot become two accounts', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com');
  });

  it.each([undefined, null, 42, {}])('treats %o as empty', (input) => {
    expect(normalizeEmail(input)).toBe('');
  });

  it.each(['reader@example.com', 'a.b+tag@sub.example.co.uk'])('accepts %s', (address) => {
    expect(isPlausibleEmail(address)).toBe(true);
  });

  it.each(['', 'reader', 'reader@', '@example.com', 'reader@localhost', 'a b@example.com'])(
    'rejects %o',
    (address) => {
      expect(isPlausibleEmail(address)).toBe(false);
    }
  );

  it('rejects an address past the maximum length', () => {
    expect(isPlausibleEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('generateCode', () => {
  it('is always six digits, leading zeros kept', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('does not return the same code every time', () => {
    const seen = new Set(Array.from({ length: 50 }, generateCode));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('hashCode', () => {
  it('is stable for the same code and address', async () => {
    expect(await hashCode('123456', 'a@example.com', SECRET)).toBe(await hashCode('123456', 'a@example.com', SECRET));
  });

  it('is bound to the address, so a hash cannot be replayed against another one', async () => {
    expect(await hashCode('123456', 'a@example.com', SECRET)).not.toBe(await hashCode('123456', 'b@example.com', SECRET));
  });

  it('depends on the secret, so a stolen table is useless on its own', async () => {
    expect(await hashCode('123456', 'a@example.com', SECRET)).not.toBe(await hashCode('123456', 'a@example.com', 'other'));
  });

  it('never stores the code itself', async () => {
    expect(await hashCode('123456', 'a@example.com', SECRET)).not.toContain('123456');
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings and nothing else', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abc123')).toBe(false);
    expect(timingSafeEqual(undefined, 'abc')).toBe(false);
  });
});

describe('codeEmail', () => {
  it('puts the code in the subject as well as both bodies', () => {
    const mail = codeEmail({ code: '098765' });
    expect(mail.subject).toContain('098765');
    expect(mail.text).toContain('098765');
    expect(mail.html).toContain('098765');
    expect(mail.text).toContain('10 minutes');
  });

  it('always carries a plain-text alternative alongside the HTML', () => {
    const mail = codeEmail({ code: '000001' });
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.html.length).toBeGreaterThan(0);
  });
});

describe('sendEmail', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('posts the message to Resend with the key and both body parts', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'msg-1' }));
    globalThis.fetch = fetchMock;

    await sendEmail({
      apiKey: 'key-1',
      from: 'sutamaya <no-reply@sutamaya.org>',
      to: 'reader@example.com',
      message: codeEmail({ code: '123456' }),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer key-1');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['reader@example.com']);
    expect(body.from).toBe('sutamaya <no-reply@sutamaya.org>');
    expect(body.text).toContain('123456');
    expect(body.html).toContain('123456');
  });

  it('throws when Resend refuses the message, so the route can report it', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad key', { status: 401 }));
    await expect(
      sendEmail({ apiKey: 'nope', from: 'a@b.com', to: 'c@d.com', message: codeEmail({ code: '000000' }) })
    ).rejects.toThrow(/401/);
  });
});
