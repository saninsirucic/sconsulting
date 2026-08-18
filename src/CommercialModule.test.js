import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommercialModule from './CommercialModule';
import { commercialApi } from './commercial/api';

jest.mock('./commercial/api', () => ({
  commercialApi: {
    getBrands: jest.fn(),
    getDashboard: jest.fn(),
    getRecords: jest.fn(),
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    transferRecord: jest.fn(),
    deleteRecord: jest.fn(),
    getDailyList: jest.fn(),
    createDailyList: jest.fn(),
    updateDailyAssignment: jest.fn(),
    getMailAutomation: jest.fn(),
    updateMailAutomation: jest.fn(),
    prepareMailAutomation: jest.fn(),
    importDailyApprovedMailAutomation: jest.fn(),
    decideMailAutomationCandidates: jest.fn(),
    updateMailAutomationCandidateRecipients: jest.fn(),
    sendSelectedMailAutomation: jest.fn(),
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
  commercialApi.deleteRecord.mockResolvedValue({ success: true });
  commercialApi.getDailyList.mockResolvedValue({ items: [] });
  commercialApi.createDailyList.mockResolvedValue({ items: [] });
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

test('kreira Visiocast komitenta kroz modal', async () => {
  renderModule();
  await screen.findAllByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('button', { name: 'Novi komitent' }));
  fireEvent.change(screen.getByLabelText(/Naziv komitenta/), { target: { value: 'Novi kupac' } });
  fireEvent.change(screen.getByLabelText('Sljedeći kontakt'), { target: { value: '2026-08-14T10:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));

  await waitFor(() => expect(commercialApi.createRecord).toHaveBeenCalledWith('VISIOCAST', expect.objectContaining({
    company_name: 'Novi kupac',
    status: 'NEW',
    next_contact_at: new Date('2026-08-14T10:30').toISOString(),
  })));
});

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

test('iz Današnjih 30 šalje samo već odobrene sa emailom nakon završne potvrde', async () => {
  const dailyItems = [
    { id: 'assignment-1', assignment_status: 'COMPLETED', account: { id: 'account-1', company_name: 'Ranije odobren', email: 'jedan@example.ba' } },
    { id: 'assignment-2', assignment_status: 'APPROVED', account: { id: 'account-2', company_name: 'Novo odobren', email: 'dva@example.ba' } },
    { id: 'assignment-3', assignment_status: 'PENDING', account: { id: 'account-3', company_name: 'Čeka odluku', email: 'tri@example.ba' } },
    { id: 'assignment-4', assignment_status: 'SKIPPED', account: { id: 'account-4', company_name: 'Preskočen', email: 'cetiri@example.ba' } },
    { id: 'assignment-5', assignment_status: 'COMPLETED', account: { id: 'account-5', company_name: 'Bez emaila', email: '' } },
    { id: 'assignment-6', assignment_status: 'COMPLETED', mail_queue_status: 'SENT', account: { id: 'account-6', company_name: 'Već poslan', email: 'poslan@example.ba' } },
  ];
  commercialApi.getDailyList.mockResolvedValue({ brand: { name: 'Visiocast' }, items: dailyItems });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({
    import: {
      eligible_account_ids: ['account-1', 'account-2'],
      assignment_ids: ['assignment-1', 'assignment-2'],
      skipped_count: 0,
    },
  });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  const sendButton = await screen.findByRole('button', { name: 'Pošalji odobrene (2)' });
  expect(screen.getByText(/Odobreno bez ispravne glavne email adrese: 1/)).toBeInTheDocument();
  fireEvent.click(sendButton);

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Poslati 2 odobrenih mailova'));
  await waitFor(() => expect(commercialApi.importDailyApprovedMailAutomation).toHaveBeenCalledWith(
    'VISIOCAST',
    ['assignment-1', 'assignment-2']
  ));
  await waitFor(() => expect(commercialApi.sendSelectedMailAutomation).toHaveBeenCalledTimes(2));
  expect(commercialApi.sendSelectedMailAutomation).toHaveBeenNthCalledWith(1, 'VISIOCAST', ['account-1']);
  expect(commercialApi.sendSelectedMailAutomation).toHaveBeenNthCalledWith(2, 'VISIOCAST', ['account-2']);
  expect(await screen.findByText('Slanje završeno: poslano 2, neuspjelo 0, preskočeno 0.')).toBeInTheDocument();
  confirmSpy.mockRestore();
});

test('odustajanje od slanja donje liste ne uvozi niti šalje mailove', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'COMPLETED', account: { id: 'account-1', company_name: 'Odobren', email: 'odobren@example.ba' } },
  ] });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pošalji odobrene (1)' }));

  expect(commercialApi.importDailyApprovedMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('ne poziva slanje kada backend nakon importa ne vrati nijedan podoban račun', async () => {
  commercialApi.getDailyList.mockResolvedValue({ items: [
    { id: 'assignment-1', assignment_status: 'COMPLETED', account: { id: 'account-1', company_name: 'Već poslan', email: 'poslan@example.ba' } },
  ] });
  commercialApi.importDailyApprovedMailAutomation.mockResolvedValue({
    import: { eligible_account_ids: [], eligible_assignment_ids: [], skipped_count: 1 },
  });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Prikaži Današnjih 30' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pošalji odobrene (1)' }));

  await waitFor(() => expect(commercialApi.importDailyApprovedMailAutomation).toHaveBeenCalled());
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(await screen.findByText('Slanje završeno: poslano 0, neuspjelo 0, preskočeno 1.')).toBeInTheDocument();
  confirmSpy.mockRestore();
});

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
