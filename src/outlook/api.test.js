import { writeStoredSession } from '../api';
import { composePayload, outlookApi } from './api';

beforeEach(() => {
  sessionStorage.clear();
  writeStoredSession({ token: 'outlook-jwt', user: { role: 'komercijala' } });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ items: [] }),
  });
});

test('Outlook API koristi centralni JWT i sigurno kodira opaque cursor', async () => {
  await outlookApi.getMessages({ folder: 'inbox', cursor: 'opaque+/cursor==', limit: 50 });

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/outlook/messages?');
  expect(url).toContain('cursor=opaque%2B%2Fcursor%3D%3D');
  expect(options.headers.get('Authorization')).toBe('Bearer outlook-jwt');
});

test('slanje ide kao JSON kroz dogovoreni shared-mailbox endpoint', async () => {
  await outlookApi.send({
    to: ['info@firma.ba'],
    cc: [],
    bcc: [],
    subject: 'Ponuda',
    body: 'Poštovani',
    bodyType: 'text',
    attachments: [],
  });

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/outlook/send');
  expect(options.method).toBe('POST');
  expect(options.headers.get('Content-Type')).toBe('application/json');
  expect(JSON.parse(options.body)).toEqual(expect.objectContaining({ to: ['info@firma.ba'], bodyType: 'text' }));
});

test('compose payload šalje uređeni potpis odvojeno od teksta poruke', async () => {
  const payload = await composePayload({
    to: 'info@firma.ba',
    cc: '',
    bcc: '',
    subject: 'Ponuda',
    body: 'Tekst poruke',
    signature: {
      greeting: 'Srdačan pozdrav,',
      name: 'Prodajni tim',
      title: 'Komercijala',
      mobile: '+387 61 111 222',
      phone: '',
      email: 'sales@s-consulting.ba',
      website: 'www.s-consulting.ba',
      address: 'Sarajevo',
    },
  });

  expect(payload.body).toBe('Tekst poruke');
  expect(payload.bodyType).toBe('text');
  expect(payload.signature).toEqual(expect.objectContaining({ name: 'Prodajni tim', email: 'sales@s-consulting.ba' }));
  expect(payload.body).not.toMatch(/Prodajni tim|sales@s-consulting\.ba/);
});
