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
    deleteRecord: jest.fn(),
    getDailyList: jest.fn(),
    createDailyList: jest.fn(),
    updateDailyAssignment: jest.fn(),
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
  commercialApi.deleteRecord.mockResolvedValue({ success: true });
  commercialApi.getDailyList.mockResolvedValue({ items: [] });
  commercialApi.createDailyList.mockResolvedValue({ items: [] });
});

test('prikazuje Visiocast Excel kolone i odvojene prazne SAN Pest / FS App cjeline', async () => {
  renderModule();
  expect(await screen.findByText('Primjer d.o.o.')).toBeInTheDocument();
  expect(screen.getByText('Nazvati u petak')).toBeInTheDocument();
  expect(screen.getByText('88.562,00 KM')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'SAN Pest' }));
  expect(await screen.findByText('Tabela još nije dostavljena')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /FS App/ }));
  expect(await screen.findByText('Digitalni HACCP')).toBeInTheDocument();
});

test('kreira Visiocast komitenta kroz modal', async () => {
  renderModule();
  await screen.findByText('Primjer d.o.o.');
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
  expect(await screen.findByText('Primjer d.o.o.')).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'SAN Pest' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /FS App/ })).not.toBeInTheDocument();
});

test('automatski priprema Današnjih 30 kada je dnevna lista prazna', async () => {
  renderModule();
  await waitFor(() => expect(commercialApi.createDailyList).toHaveBeenCalledWith('VISIOCAST'));
  expect(screen.getByText(/Lista se automatski priprema svaki dan/)).toBeInTheDocument();
});

test('uređuje Visiocast zapis', async () => {
  renderModule();
  await screen.findByText('Primjer d.o.o.');

  fireEvent.click(screen.getByRole('button', { name: 'Uredi komitenta' }));
  fireEvent.change(screen.getByLabelText(/Naziv komitenta/), { target: { value: 'Izmijenjeni kupac' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));
  await waitFor(() => expect(commercialApi.updateRecord).toHaveBeenCalledWith('record-1', expect.objectContaining({ company_name: 'Izmijenjeni kupac' })));
});

test('soft-delete arhivira Visiocast zapis', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderModule();
  await screen.findByText('Primjer d.o.o.');
  fireEvent.click(screen.getByRole('button', { name: 'Arhiviraj komitenta' }));
  await waitFor(() => expect(commercialApi.deleteRecord).toHaveBeenCalledWith('record-1'));
  window.confirm.mockRestore();
});
