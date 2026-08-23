import { commercialApi } from './api';

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '{}',
  });
});

test('importuje samo potvrđene dnevne assignment ID-jeve uz sigurnosni confirm', async () => {
  await commercialApi.importDailyApprovedMailAutomation('VISIOCAST', ['assignment-1', 'assignment-2']);

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/brands/VISIOCAST/mail-automation/import-daily-approved');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({
    assignment_ids: ['assignment-1', 'assignment-2'],
    confirm: true,
  });
});

test('legacy COMPLETED redove uključuje samo uz eksplicitnu opciju', async () => {
  await commercialApi.importDailyApprovedMailAutomation(
    'VISIOCAST',
    ['legacy-assignment'],
    { includeLegacyCompleted: true }
  );

  const [, options] = fetch.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({
    assignment_ids: ['legacy-assignment'],
    confirm: true,
    include_legacy_completed: true,
  });
});

test('sprema strogo polje CC adresa na kandidatu', async () => {
  await commercialApi.updateMailAutomationCandidateRecipients(
    'SAN_PEST',
    'account/1',
    ['nabavka@example.ba', 'direktor@example.ba']
  );

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/brands/SAN_PEST/mail-automation/candidates/account%2F1/recipients');
  expect(options.method).toBe('PATCH');
  expect(JSON.parse(options.body)).toEqual({
    cc_emails: ['nabavka@example.ba', 'direktor@example.ba'],
  });
});

test('grupno odobrava samo izričito označene dnevne assignment ID-jeve', async () => {
  await commercialApi.approveDailyAssignments('FS_APP', ['assignment-2', 'assignment-7']);

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/brands/FS_APP/daily-assignments/approval');
  expect(options.method).toBe('PATCH');
  expect(JSON.parse(options.body)).toEqual({
    assignment_ids: ['assignment-2', 'assignment-7'],
    decision: 'APPROVED',
  });
});

test('zakazuje odobrene mailove jednim sigurnosno potvrđenim pozivom', async () => {
  await commercialApi.scheduleSelectedMailAutomation('FS_APP', ['account-2', 'account-7']);

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/brands/FS_APP/mail-automation/schedule-selected');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({
    account_ids: ['account-2', 'account-7'],
    confirm: true,
  });
});

test('odmah šalje sačuvani dopis iz CRM reda uz sigurnosnu potvrdu', async () => {
  await commercialApi.sendRecordLetter('account/aba');

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/records/account%2Faba/send-letter');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ confirm: true });
});

test('trajno sprema kvačicu Admin rekao zvati na komitentu', async () => {
  await commercialApi.setAdminCallRequested('account/aba', true);

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/records/account%2Faba/admin-call-request');
  expect(options.method).toBe('PATCH');
  expect(JSON.parse(options.body)).toEqual({ requested: true });
});

test('učitava zajednički kalendar poziva za raspon i program', async () => {
  await commercialApi.getCallCalendar({ from: '2026-08-01', to: '2026-09-06', brand: 'SAN_PEST' });

  const [url, options] = fetch.mock.calls[0];
  expect(url).toContain('/api/commercial/calendar?');
  expect(url).toContain('from=2026-08-01');
  expect(url).toContain('to=2026-09-06');
  expect(url).toContain('brand=SAN_PEST');
  expect(options.method).toBe('GET');
});
