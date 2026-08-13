import { writeStoredSession } from '../api';
import { outlookApi } from './api';

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
