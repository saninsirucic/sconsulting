import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommercialModule, { statusVisual } from './CommercialModule';
import { commercialApi } from './commercial/api';
import { downloadCombinedLetterReportPdf, downloadLetterReportPdf } from './commercial/letterReportPdf';

jest.mock('./commercial/letterReportPdf', () => ({
  downloadCombinedLetterReportPdf: jest.fn(),
  downloadLetterReportPdf: jest.fn(),
}));

jest.mock('./commercial/api', () => ({
  commercialApi: {
    getBrands: jest.fn(),
    getDashboard: jest.fn(),
    getRecords: jest.fn(),
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    transferRecord: jest.fn(),
    sendRecordLetter: jest.fn(),
    setAdminCallRequested: jest.fn(),
    deleteRecord: jest.fn(),
    getDailyList: jest.fn(),
    createDailyList: jest.fn(),
    updateDailyAssignment: jest.fn(),
    approveDailyAssignments: jest.fn(),
    getMailAutomation: jest.fn(),
    updateMailAutomation: jest.fn(),
    prepareMailAutomation: jest.fn(),
    importDailyApprovedMailAutomation: jest.fn(),
    decideMailAutomationCandidates: jest.fn(),
    updateMailAutomationCandidateRecipients: jest.fn(),
    sendSelectedMailAutomation: jest.fn(),
    scheduleSelectedMailAutomation: jest.fn(),
    pauseMailAutomation: jest.fn(),
    sendNextMailAutomation: jest.fn(),
  },
}));

function renderModule() {
  return render(<ChakraProvider><CommercialModule user={{ username: 'prodaja', role: 'komercijala' }} /></ChakraProvider>);
}

const record = {
  id: 'record-1',
  source_row_number: 7,
  company_name: 'Primjer d.o.o.',
  record_type: 'POSLOVNICA',
  branch_count: 3,
  unit_amount: 100,
  total_amount: 300,
  profit_amount: 210,
  raw_mail: 'prodaja@primjer.ba',
  email: 'prodaja@primjer.ba',
  raw_contact: '+387 61 000 000',
  comment: 'Nazvati u petak',
  location: 'Sarajevo',
  status: 'NEW',
  priority: 'MEDIUM',
};

beforeEach(() => {
  jest.clearAllMocks();
  commercialApi.getBrands.mockResolvedValue({ items: [
    { code: 'VISIOCAST', name: 'Visiocast', record_count: 1 },
    { code: 'SAN_PEST', name: 'SAN Pest', record_count: 0 },
    { code: 'FS_APP', name: 'FS App', record_count: 0 },
  ] });
  commercialApi.getDashboard.mockResolvedValue({ totals: { total: 1, total_amount: 88562, profit_amount: 65800 }, today: { total: 0 } });
  commercialApi.getRecords.mockResolvedValue({ items: [record], pagination: { total: 1, pages: 1 }, filters: {} });
  commercialApi.createRecord.mockResolvedValue({ id: 'record-2' });
  commercialApi.updateRecord.mockResolvedValue({ ...record, company_name: 'Izmijenjeni kupac' });
  commercialApi.transferRecord.mockResolvedValue({
    account: record,
    from_brand: { code: 'SAN_PEST', name: 'SAN Pest' },
    to_brand: { code: 'VISIOCAST', name: 'Visiocast' },
  });
  commercialApi.sendRecordLetter.mockResolvedValue({
    success: true,
    sent: true,
    account_id: record.id,
    recipient: record.email,
    sent_at: '2026-08-18T17:51:00.000Z',
  });
  commercialApi.setAdminCallRequested.mockResolvedValue({ ...record, admin_call_requested: true, admin_call_requested_at: '2026-08-23T12:00:00.000Z' });
  commercialApi.deleteRecord.mockResolvedValue({ success: true });
  commercialApi.getDailyList.mockResolvedValue({ items: [] });
  commercialApi.createDailyList.mockResolvedValue({ items: [] });
  commercialApi.approveDailyAssignments.mockResolvedValue({ updated: 0, unchanged: 0, rejected: 0 });
  commercialApi.getMailAutomation.mockResolvedValue({
    settings: { enabled: false, paused: true, daily_limit: 30, subject: '', body_text: '' },
    counts: { PENDING: 0, APPROVED: 0, SENT: 0, FAILED: 0 },
    queue: [],
  });
  commercialApi.updateMailAutomation.mockResolvedValue({ enabled: false, paused: true });
  commercialApi.prepareMailAutomation.mockResolvedValue({ settings: { enabled: false, paused: true }, counts: {}, queue: [] });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({ import: { account_ids: [], assignment_ids: [], skipped_count: 0 } });
  commercialApi.decideMailAutomationCandidates.mockResolvedValue({ settings: { enabled: false, paused: true }, counts: {}, queue: [] });
  commercialApi.updateMailAutomationCandidateRecipients.mockResolvedValue({ settings: { enabled: false, paused: true }, counts: {}, queue: [] });
  commercialApi.sendSelectedMailAutomation.mockResolvedValue({ sent_count: 1, failed_count: 0 });
  commercialApi.scheduleSelectedMailAutomation.mockResolvedValue({
    schedule: { scheduled_count: 1, already_scheduled_count: 0, rejected_count: 0 },
  });
  commercialApi.pauseMailAutomation.mockResolvedValue({ settings: { enabled: true, paused: true }, counts: {}, queue: [] });
  commercialApi.sendNextMailAutomation.mockResolvedValue({ sent: true });
});

test('prikazuje operativne Visiocast kolone bez iznosa i odvojene SAN Pest / FS App cjeline', async () => {
  renderModule();
  expect((await screen.findAllByText('Primjer d.o.o.')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Nazvati u petak').length).toBeGreaterThan(0);
  expect(screen.queryByText('88.562,00 KM')).not.toBeInTheDocument();
  expect(screen.queryByText('65.800,00 KM')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Iznos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Ukupno' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Profit' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'SAN Pest' }));
  expect(await screen.findByText('Tabela još nije dostavljena')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /FS App/ }));
  expect(await screen.findByText('Digitalni HACCP')).toBeInTheDocument();
});

test('omogućava pregled velikih baza kroz kompaktne kolone, sortiranje i izbor broja zapisa', async () => {
  commercialApi.getRecords.mockResolvedValue({ items: [record], pagination: { total: 683, pages: 28 }, filters: {} });
  renderModule();

  expect(await screen.findByText(/Prikazano/)).toHaveTextContent('Prikazano 1–25 od 683 zapisa');
  expect(screen.getByRole('columnheader', { name: 'Komitent', hidden: true })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Profil', hidden: true })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Kontakt', hidden: true })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Komentar', hidden: true })).not.toBeInTheDocument();

  commercialApi.getRecords.mockClear();
  fireEvent.change(screen.getByLabelText('Broj zapisa po stranici'), { target: { value: '50' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    page: 1,
    perPage: 50,
    sortBy: 'company_name',
    sortDirection: 'asc',
  })));

  commercialApi.getRecords.mockClear();
  fireEvent.change(screen.getByLabelText('Sortiranje komitenata'), { target: { value: 'updated_at:desc' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    perPage: 50,
    sortBy: 'updated_at',
    sortDirection: 'desc',
  })));
});

test('jednim klikom prikazuje dopise od početka jula i filtrira datum slanja', async () => {
  const sentRecord = {
    ...record,
    status: 'EMAIL_SENT',
    letter_sent_at: '2026-08-20T15:30:00',
  };
  commercialApi.getRecords.mockImplementation(async (brandCode, params) => ({
    items: params?.lettersOnly ? [sentRecord] : [record],
    pagination: { total: 1, pages: 1 },
    filters: {},
  }));
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');

  fireEvent.click(screen.getByRole('button', { name: 'Prikaži poslane dopise od 1. jula' }));
  const expectedFrom = `${new Date().getFullYear()}-07-01`;
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    lettersOnly: true,
    sentFrom: expectedFrom,
    sortBy: 'letter_sent_at',
    sortDirection: 'desc',
  })));

  expect(await screen.findByRole('columnheader', { name: 'Dopis poslan', hidden: true })).toBeInTheDocument();
  expect(screen.getAllByText('20.08.2026. 15:30').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Dopis poslan od datuma'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('Dopis poslan do datuma'), { target: { value: '2026-08-31' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    lettersOnly: true,
    sentFrom: '2026-08-01',
    sentTo: '2026-08-31',
  })));
});

test('admin označava komitenta za poziv i posebni filter ostaje odvojen po programu', async () => {
  const markedRecord = {
    ...record,
    admin_call_requested: true,
    admin_call_requested_at: '2026-08-23T12:00:00.000Z',
  };
  commercialApi.getRecords.mockImplementation(async (brandCode, params) => ({
    items: params?.adminCallRequested ? [markedRecord] : [record],
    pagination: { total: 1, pages: 1 },
    filters: {},
  }));
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');

  const checkboxes = screen.getAllByRole('checkbox', { name: 'Admin rekao zvati - Primjer d.o.o.' });
  fireEvent.click(checkboxes[0]);
  await waitFor(() => expect(commercialApi.setAdminCallRequested).toHaveBeenCalledWith('record-1', true));

  fireEvent.click(screen.getByRole('button', { name: 'Prikaži komitente označene Admin rekao zvati' }));
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    adminCallRequested: true,
    sortBy: 'admin_call_requested_at',
    sortDirection: 'desc',
  })));
  expect((await screen.findAllByText(/označenih za poziv/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText('ADMIN REKAO ZVATI').length).toBeGreaterThan(0);
});

test('PDF izvještaj preuzima sve stranice za izabrani program i period', async () => {
  const firstSentRecord = { ...record, status: 'EMAIL_SENT', letter_sent_at: '2026-08-20T15:30:00' };
  const secondSentRecord = { ...record, id: 'record-2', company_name: 'Drugi komitent', status: 'INTERESTED', letter_sent_at: '2026-08-21T09:15:00' };
  commercialApi.getRecords.mockImplementation(async (brandCode, params) => {
    if (params?.perPage === 100 && params?.page === 1) {
      return { items: [firstSentRecord], pagination: { total: 2, pages: 2 }, filters: {} };
    }
    if (params?.perPage === 100 && params?.page === 2) {
      return { items: [secondSentRecord], pagination: { total: 2, pages: 2 }, filters: {} };
    }
    return {
      items: params?.lettersOnly ? [firstSentRecord] : [record],
      pagination: { total: 1, pages: 1 },
      filters: {},
    };
  });

  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('button', { name: 'Prikaži poslane dopise od 1. jula' }));
  fireEvent.change(await screen.findByLabelText('Dopis poslan od datuma'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('Dopis poslan do datuma'), { target: { value: '2026-08-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preuzmi PDF izvještaj za izabrani period' }));

  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    page: 1,
    perPage: 100,
    lettersOnly: true,
    sentFrom: '2026-08-01',
    sentTo: '2026-08-31',
  })));
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    page: 2,
    perPage: 100,
  })));
  await waitFor(() => expect(downloadLetterReportPdf).toHaveBeenCalledWith(expect.objectContaining({
    brandCode: 'VISIOCAST',
    brandName: 'Visiocast',
    sentFrom: '2026-08-01',
    sentTo: '2026-08-31',
    records: [firstSentRecord, secondSentRecord],
  })));
});

test('zbirni PDF preuzima dopise iz sva 3 programa za isti period', async () => {
  const sentByBrand = {
    VISIOCAST: { ...record, id: 'visi-1', company_name: 'Visiocast komitent', status: 'EMAIL_SENT', letter_sent_at: '2026-08-20T10:00:00' },
    SAN_PEST: { ...record, id: 'san-1', company_name: 'SAN Pest komitent', status: 'INTERESTED', letter_sent_at: '2026-08-21T11:00:00' },
    FS_APP: { ...record, id: 'fs-1', company_name: 'FS App komitent', status: 'MEETING_SCHEDULED', letter_sent_at: '2026-08-22T12:00:00' },
  };
  commercialApi.getRecords.mockImplementation(async (brandCode, params) => ({
    items: params?.perPage === 100 ? [sentByBrand[brandCode]] : [record],
    pagination: { total: 1, pages: 1 },
    filters: {},
  }));

  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('button', { name: 'Prikaži poslane dopise od 1. jula' }));
  fireEvent.change(await screen.findByLabelText('Dopis poslan od datuma'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('Dopis poslan do datuma'), { target: { value: '2026-08-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preuzmi zajednički PDF izvještaj za sva 3 programa' }));

  for (const brandCode of ['VISIOCAST', 'SAN_PEST', 'FS_APP']) {
    await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith(brandCode, expect.objectContaining({
      page: 1,
      perPage: 100,
      lettersOnly: true,
      sentFrom: '2026-08-01',
      sentTo: '2026-08-31',
      sortBy: 'letter_sent_at',
      sortDirection: 'desc',
    })));
  }
  await waitFor(() => expect(downloadCombinedLetterReportPdf).toHaveBeenCalledWith(expect.objectContaining({
    sentFrom: '2026-08-01',
    sentTo: '2026-08-31',
    programs: [
      expect.objectContaining({ brandCode: 'VISIOCAST', records: [sentByBrand.VISIOCAST] }),
      expect.objectContaining({ brandCode: 'SAN_PEST', records: [sentByBrand.SAN_PEST] }),
      expect.objectContaining({ brandCode: 'FS_APP', records: [sentByBrand.FS_APP] }),
    ],
  })));
});

test('statusne boje razlikuju tok, odbijeno i pozitivan ishod', () => {
  expect(statusVisual('EMAIL_SENT')).toEqual(expect.objectContaining({ bg: 'yellow.50' }));
  expect(statusVisual('MEETING_SCHEDULED')).toEqual(expect.objectContaining({ bg: 'yellow.50' }));
  expect(statusVisual('REJECTED')).toEqual(expect.objectContaining({ bg: 'red.50' }));
  expect(statusVisual('INTERESTED')).toEqual(expect.objectContaining({ bg: 'green.50' }));
  expect(statusVisual('WON')).toEqual(expect.objectContaining({ bg: 'green.50' }));
});

test('kreira Visiocast komitenta kroz modal', async () => {
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('button', { name: 'Novi komitent' }));
  expect(screen.queryByLabelText('Iznos')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Ukupno')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Profit')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Naziv komitenta/), { target: { value: 'Novi kupac' } });
  fireEvent.change(screen.getByLabelText('Sljedeći kontakt'), { target: { value: '2026-08-14T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));

  await waitFor(() => expect(commercialApi.createRecord).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    company_name: 'Novi kupac',
    status: 'NEW',
    next_contact_at: new Date('2026-08-14T10:30').toISOString(),
  })));
});

test('nudi poseban filter grada, države i vrste za svaku bazu', async () => {
  commercialApi.getBrands.mockResolvedValue({ items: [
    { code: 'VISIOCAST', name: 'Visiocast', record_count: 1 },
    { code: 'SAN_PEST', name: 'SAN Pest', record_count: 1 },
    { code: 'FS_APP', name: 'FS App', record_count: 1 },
  ] });
  commercialApi.getRecords.mockImplementation(async (brandCode) => ({
    items: [record],
    pagination: { total: 1, pages: 1 },
    filters: brandCode === 'VISIOCAST'
      ? { locations: ['Sarajevo', 'Travnik'] }
      : brandCode === 'SAN_PEST'
        ? { countries: ['Hrvatska', 'Srbija'] }
        : { recordTypes: ['Hotel', 'Restoran'] },
  }));
  renderModule();

  const cityFilter = await screen.findByRole('combobox', { name: 'Filter po gradu' });
  fireEvent.change(cityFilter, { target: { value: 'Travnik' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({ location: 'Travnik' })));

  fireEvent.click(screen.getByRole('tab', { name: 'SAN Pest' }));
  const countryFilter = await screen.findByRole('combobox', { name: 'Filter po državi' });
  await screen.findByRole('option', { name: 'Srbija' });
  fireEvent.change(countryFilter, { target: { value: 'Srbija' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('SAN_PEST', expect.objectContaining({ country: 'Srbija' })));

  fireEvent.click(screen.getByRole('tab', { name: /FS App/ }));
  const typeFilter = await screen.findByRole('combobox', { name: 'Filter po vrsti' });
  await screen.findByRole('option', { name: 'Restoran' });
  fireEvent.change(typeFilter, { target: { value: 'Restoran' } });
  await waitFor(() => expect(commercialApi.getRecords).toHaveBeenCalledWith('FS_APP', expect.objectContaining({ record_type: 'Restoran' })));
}, 15000);

test('prikazuje samo brendove koje je backend dodijelio korisniku', async () => {
  commercialApi.getBrands.mockResolvedValue({ items: [{ code: 'VISIOCAST', name: 'Visiocast', record_count: 1 }] });
  renderModule();
  expect((await screen.findAllByText('Primjer d.o.o.')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('tab', { name: 'SAN Pest' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /FS App/ })).not.toBeInTheDocument();
});

test('Današnjih 30 je početno skriveno i učitava se tek nakon otvaranja', async () => {
  renderModule();
  const toggle = await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' });
  expect(toggle).not.toBeChecked();
  expect(commercialApi.getDailyList).not.toHaveBeenCalled();
  expect(commercialApi.createDailyList).not.toHaveBeenCalled();

  fireEvent.click(toggle);
  await waitFor(() => expect(commercialApi.createDailyList).toHaveBeenCalledWith('VISIOCAST'));
  expect(screen.getByText(/Lista se automatski priprema svaki dan/)).toBeInTheDocument();
});

test('iz Današnjih 30 zakazuje samo već odobrene sa emailom nakon završne potvrde', async () => {
  const dailyItems = [
    { id: 'assignment-1', assignment_status: 'COMPLETED', account: { id: 'account-1', company_name: 'Ranije odobren', email: 'jedan@example.ba' } },
    { id: 'assignment-2', assignment_status: 'APPROVED', account: { id: 'account-2', company_name: 'Novo odobren', email: 'dva@example.ba' } },
    { id: 'assignment-7', assignment_status: 'APPROVED', account: { id: 'account-7', company_name: 'Odobren bez emaila', email: '' } },
  ];
  commercialApi.getDailyList.mockResolvedValue({ brand: { name: 'Visiocast' }, items: dailyItems });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({
    import: {
      eligible_account_ids: ['account-2'],
      assignment_ids: ['assignment-2'],
      skipped_count: 0,
    },
  });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  const sendButton = await screen.findByRole('button', { name: 'Zakaži odobrene (1)' });
  expect(screen.getByRole('button', { name: 'Potvrdi i zakaži ranije označene (1)' })).toBeInTheDocument();
  expect(screen.getByText(/Odobreno bez ispravne glavne email adrese: 1/)).toBeInTheDocument();
  expect(screen.getAllByText('RANIJE OBRAĐENO').length).toBeGreaterThan(0);
  fireEvent.click(sendButton);

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Zakazati 1 odobreni mail'));
  await waitFor(() => expect(commercialApi.importDailyApprovedMailAutomation).toHaveBeenCalledWith(
    'VISIOCAST',
    ['assignment-2']
  ));
  await waitFor(() => expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledTimes(1));
  expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledWith('VISIOCAST', ['account-2']);
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(await screen.findByText('Zakazano 1, preskočeno 0. Server šalje jednu poruku svakih 5 minuta.')).toBeInTheDocument();
  confirmSpy.mockRestore();
}, 10000);

test('odustajanje od zakazivanja donje liste ne uvozi niti šalje mailove', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'APPROVED', account: { id: 'account-1', company_name: 'Odobren', email: 'odobren@example.ba' } },
  ] });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Zakaži odobrene (1)' }));

  expect(commercialApi.importDailyApprovedMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.scheduleSelectedMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('ne zakazuje slanje kada backend nakon importa ne vrati nijedan podoban račun', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'APPROVED', account: { id: 'account-1', company_name: 'Već poslan', email: 'poslan@example.ba' } },
  ] });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({
    import: { eligible_account_ids: [], eligible_assignment_ids: [], skipped_count: 1 },
  });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Zakaži odobrene (1)' }));

  await waitFor(() => expect(commercialApi.importDailyApprovedMailAutomation).toHaveBeenCalled());
  expect(commercialApi.scheduleSelectedMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(await screen.findByText('Zakazano 0, preskočeno 1. Server šalje jednu poruku svakih 5 minuta.')).toBeInTheDocument();
  confirmSpy.mockRestore();
});

test('stare COMPLETED redove zakazuje samo kroz zasebnu eksplicitnu legacy potvrdu', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'legacy-assignment', assignment_status: 'COMPLETED', account: { id: 'legacy-account', company_name: 'Stari zeleni red', email: 'stari@example.ba' } },
    { id: 'processed-assignment', assignment_status: 'OBRADJEN', account: { id: 'processed-account', company_name: 'Obrađen red', email: 'obradjen@example.ba' } },
    { id: 'done-assignment', assignment_status: 'DONE', account: { id: 'done-account', company_name: 'Završen red', email: 'zavrsen@example.ba' } },
  ] });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({
    import: {
      eligible_account_ids: ['legacy-account'],
      eligible_assignment_ids: ['legacy-assignment'],
      skipped_count: 0,
    },
  });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  expect(await screen.findByRole('button', { name: 'Zakaži odobrene (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Potvrdi i zakaži ranije označene (1)' })).toBeEnabled();
  expect(screen.getAllByText('RANIJE OBRAĐENO').length).toBeGreaterThan(0);
  expect(screen.getAllByText('OBRAĐENO').length).toBeGreaterThan(0);
  expect(screen.getAllByText('ZAVRŠENO').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'Potvrdi i zakaži ranije označene (1)' }));

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Ovih 1 stari zeleni red'));
  await waitFor(() => expect(commercialApi.importDailyApprovedMailAutomation).toHaveBeenCalledWith(
    'VISIOCAST',
    ['legacy-assignment'],
    { includeLegacyCompleted: true }
  ));
  await waitFor(() => expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledWith('VISIOCAST', ['legacy-account']));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
}, 10000);

test('donja lista omogućava odobrenje za mail bez gornjeg ponovnog označavanja', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'PENDING', account: { id: 'account-1', company_name: 'Kandidat', email: 'kandidat@example.ba' } },
  ] });
  commercialApi.updateDailyAssignment.mockResolvedValue({ id: 'assignment-1', status: 'APPROVED' });
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click((await screen.findAllByRole('button', { name: 'Odobri za mail' }))[0]);

  await waitFor(() => expect(commercialApi.updateDailyAssignment).toHaveBeenCalledWith(
    'assignment-1',
    { status: 'APPROVED', notes: '' }
  ));
});

test('grupno odobrava samo ručno označeni podskup jednim API pozivom i zatim čisti odabir', async () => {
  const initialItems = [
    { id: 'assignment-1', assignment_status: 'PENDING', account: { id: 'account-1', company_name: 'Prvi kandidat', email: 'prvi@example.ba' } },
    { id: 'assignment-2', assignment_status: 'PENDING', account: { id: 'account-2', company_name: 'Drugi kandidat', email: 'drugi@example.ba' } },
    { id: 'assignment-3', assignment_status: 'PENDING', account: { id: 'account-3', company_name: 'Treći kandidat', email: 'treci@example.ba' } },
  ];
  commercialApi.getDailyList
    .mockResolvedValueOnce({ items: initialItems })
    .mockResolvedValue({ items: [
      { ...initialItems[0], assignment_status: 'APPROVED' },
      initialItems[1],
      { ...initialItems[2], assignment_status: 'APPROVED' },
    ] });
  commercialApi.approveDailyAssignments.mockResolvedValue({ updated: 2, unchanged: 0, rejected: 0 });
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Označi Prvi kandidat za odobrenje' }))[0]);
  fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Označi Treći kandidat za odobrenje' }))[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Odobri označene (2)' }));

  await waitFor(() => expect(commercialApi.approveDailyAssignments).toHaveBeenCalledTimes(1));
  expect(commercialApi.approveDailyAssignments).toHaveBeenCalledWith('VISIOCAST', ['assignment-1', 'assignment-3']);
  await waitFor(() => expect(commercialApi.getDailyList).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('button', { name: 'Odobri označene (0)' })).toBeDisabled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
}, 10000);

test('Označi sve dostupne bira samo neposlane kandidate s ispravnim emailom', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'eligible-pending', assignment_status: 'PENDING', account: { company_name: 'Dostupan jedan', email: 'jedan@example.ba' } },
    { id: 'eligible-new', assignment_status: 'NEW', account: { company_name: 'Dostupan dva', email: 'dva@example.ba' } },
    { id: 'invalid-email', assignment_status: 'PENDING', account: { company_name: 'Bez maila', email: 'pogresan-mail' } },
    { id: 'skipped', assignment_status: 'SKIPPED', account: { company_name: 'Preskočen', email: 'preskocen@example.ba' } },
    { id: 'approved', assignment_status: 'APPROVED', account: { company_name: 'Već odobren', email: 'odobren@example.ba' } },
    { id: 'legacy', assignment_status: 'COMPLETED', account: { company_name: 'Stari red', email: 'stari@example.ba' } },
    { id: 'sent', assignment_status: 'PENDING', mail_queue_status: 'SENT', account: { company_name: 'Poslan', email: 'poslan@example.ba' } },
    { id: 'sending', assignment_status: 'PENDING', mail_queue_status: 'SENDING', account: { company_name: 'Šalje se', email: 'salje@example.ba' } },
    { id: 'queue-skipped', assignment_status: 'PENDING', mail_queue_status: 'SKIPPED', account: { company_name: 'Red preskočen', email: 'red@example.ba' } },
  ] });
  commercialApi.approveDailyAssignments.mockResolvedValue({ updated: 2, unchanged: 0, rejected: 0 });
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Označi sve dostupne (2)' }));
  expect(screen.getByText('Označeno: 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Odobri označene (2)' }));

  await waitFor(() => expect(commercialApi.approveDailyAssignments).toHaveBeenCalledWith(
    'VISIOCAST',
    ['eligible-pending', 'eligible-new']
  ));
  expect(commercialApi.approveDailyAssignments).toHaveBeenCalledTimes(1);
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('Poništi odabir ne odobrava niti šalje mailove', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'PENDING', account: { company_name: 'Kandidat', email: 'kandidat@example.ba' } },
  ] });
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Označi sve dostupne (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Poništi odabir' }));

  expect(screen.getByRole('button', { name: 'Odobri označene (0)' })).toBeDisabled();
  expect(commercialApi.approveDailyAssignments).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('greška grupnog odobrenja zadržava odabir i ne pokreće slanje', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'PENDING', account: { company_name: 'Kandidat', email: 'kandidat@example.ba' } },
  ] });
  commercialApi.approveDailyAssignments.mockRejectedValue(new Error('Grupno odobrenje trenutno nije dostupno.'));
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Označi sve dostupne (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Odobri označene (1)' }));

  expect(await screen.findByText('Grupno odobrenje trenutno nije dostupno.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Odobri označene (1)' })).toBeEnabled();
  expect(commercialApi.getDailyList).toHaveBeenCalledTimes(1);
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('uređuje i prikazuje CC primaoce direktno u donjoj listi', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    {
      id: 'assignment-1',
      assignment_status: 'COMPLETED',
      account: {
        id: 'account-1',
        company_name: 'AMKO Sarajevo',
        email: 'nabavka@amko.ba',
        cc_emails: ['direktor@amko.ba'],
      },
    },
  ] });
  commercialApi.updateMailAutomationCandidateRecipients.mockResolvedValue({ recipients: { cc_emails: ['kvalitet@amko.ba'] } });
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  expect((await screen.findAllByText('CC: direktor@amko.ba')).length).toBeGreaterThan(0);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Uredi primaoce za AMKO Sarajevo' }))[0]);
  expect(screen.getByLabelText('Glavni primalac')).toHaveValue('nabavka@amko.ba');
  fireEvent.change(screen.getByLabelText('CC adrese'), { target: { value: 'kvalitet@amko.ba' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));

  await waitFor(() => expect(commercialApi.updateMailAutomationCandidateRecipients).toHaveBeenCalledWith(
    'VISIOCAST',
    'account-1',
    ['kvalitet@amko.ba']
  ));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('uređuje Visiocast zapis', async () => {
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');

  fireEvent.click(screen.getAllByRole('button', { name: 'Uredi komitenta' })[0]);
  fireEvent.change(screen.getByLabelText(/Naziv komitenta/), { target: { value: 'Izmijenjeni kupac' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));
  await waitFor(() => expect(commercialApi.updateRecord).toHaveBeenCalledWith('record-1', expect.objectContaining({ company_name: 'Izmijenjeni kupac' })));
});

test('promjena jedinog maila u izvornim podacima usklađuje glavni email za slanje', async () => {
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');

  fireEvent.click(screen.getAllByRole('button', { name: 'Uredi komitenta' })[0]);
  expect(screen.getByLabelText('Glavni email za slanje')).toHaveValue('prodaja@primjer.ba');
  fireEvent.change(screen.getByLabelText('Izvorni mail podaci (arhiva)'), {
    target: { value: 'novi.kontakt@primjer.ba' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));

  await waitFor(() => expect(commercialApi.updateRecord).toHaveBeenCalledWith('record-1', expect.objectContaining({
    email: 'novi.kontakt@primjer.ba',
    raw_mail: 'novi.kontakt@primjer.ba',
  })));
});

test('jednim dugmetom odmah šalje sačuvani dopis i osvježava CRM komentar', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');

  fireEvent.click(screen.getAllByRole('button', { name: 'Pošalji dopis za Primjer d.o.o.' })[0]);

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('na prodaja@primjer.ba'));
  await waitFor(() => expect(commercialApi.sendRecordLetter).toHaveBeenCalledWith('record-1'));
  await waitFor(() => expect(commercialApi.getRecords.mock.calls.length).toBeGreaterThan(1));
  confirmSpy.mockRestore();
});

test('prebacuje komitenta iz SAN Pesta u Visiocast uz potvrdu ciljne baze', async () => {
  commercialApi.getBrands.mockResolvedValue({ items: [
    { code: 'VISIOCAST', name: 'Visiocast', record_count: 1 },
    { code: 'SAN_PEST', name: 'SAN Pest', record_count: 1 },
    { code: 'FS_APP', name: 'FS App', record_count: 0 },
  ] });
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('tab', { name: 'SAN Pest' }));
  await screen.findAllByText('Primjer d.o.o.');

  fireEvent.click(screen.getAllByRole('button', { name: 'Prebaci komitenta' })[0]);
  expect(screen.getByRole('dialog', { name: 'Prebaci komitenta' })).toBeInTheDocument();
  expect(screen.getByLabelText('Ciljna baza')).toHaveValue('VISIOCAST');
  fireEvent.click(screen.getByRole('button', { name: 'Prebaci u Visiocast' }));

  await waitFor(() => expect(commercialApi.transferRecord).toHaveBeenCalledWith('record-1', 'VISIOCAST'));
});

test('soft-delete arhivira Visiocast zapis', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getAllByRole('button', { name: 'Arhiviraj komitenta' })[0]);
  await waitFor(() => expect(commercialApi.deleteRecord).toHaveBeenCalledWith('record-1'));
  window.confirm.mockRestore();
});
