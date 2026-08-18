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
