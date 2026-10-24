import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountImport from './AccountImport';
import { commercialApi } from './api';

jest.mock('./api', () => ({ commercialApi: { previewAccountImport: jest.fn(), commitAccountImport: jest.fn() } }));

const preview = {
  import_token: 'one-user-one-brand-token',
  preview: { total_rows: 3, valid_rows: 1, invalid_rows: 1, duplicate_rows: 1, rows: [
    { row_number: 2, name: 'Općina Primjer', email: 'info@primjer.ba', city: 'Sarajevo' },
    { row_number: 3, name: 'Biblioteka', email: 'pogresno', error: 'Neispravan email' },
    { row_number: 4, name: 'Škola', email: 'skola@primjer.ba', duplicate: true },
  ] },
};

beforeEach(() => {
  jest.clearAllMocks();
  commercialApi.previewAccountImport.mockResolvedValue(preview);
  commercialApi.commitAccountImport.mockResolvedValue({ imported: 1, skipped: 2, errors: [] });
});

test('pregled prikazuje greške i duplikate; uvoz čeka izričitu potvrdu i koristi samo token', async () => {
  const onImported = jest.fn();
  render(<ChakraProvider><AccountImport brandCode="JAVNE_USTANOVE" onImported={onImported} /></ChakraProvider>);
  const file = new File(['xlsx'], 'ustanove.xlsx');
  fireEvent.change(screen.getByLabelText('Excel baza javnih ustanova'), { target: { files: [file] } });
  expect(commercialApi.previewAccountImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Pregledaj uvoz' }));
  expect(await screen.findByText('Općina Primjer')).toBeInTheDocument();
  expect(screen.getByText('Neispravan email')).toBeInTheDocument();
  expect(screen.getByText('Duplikat — preskače se')).toBeInTheDocument();
  expect(commercialApi.previewAccountImport).toHaveBeenCalledWith('JAVNE_USTANOVE', file);
  expect(commercialApi.commitAccountImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Potvrdi uvoz u Javne ustanove' }));
  await waitFor(() => expect(commercialApi.commitAccountImport).toHaveBeenCalledWith('JAVNE_USTANOVE', preview.import_token));
  expect(await screen.findByText('Uvezeno: 1. Preskočeno: 2.')).toBeInTheDocument();
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Potvrdi uvoz u Javne ustanove' })).not.toBeInTheDocument();
});

test('promjena datoteke poništava stari pregled i odbija format koji nije xlsx', async () => {
  render(<ChakraProvider><AccountImport brandCode="JAVNE_USTANOVE" /></ChakraProvider>);
  const input = screen.getByLabelText('Excel baza javnih ustanova');
  fireEvent.change(input, { target: { files: [new File(['xlsx'], 'a.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Pregledaj uvoz' }));
  await screen.findByText('Općina Primjer');
  fireEvent.change(input, { target: { files: [new File(['csv'], 'a.csv')] } });
  expect(screen.queryByRole('button', { name: 'Potvrdi uvoz u Javne ustanove' })).not.toBeInTheDocument();
  expect(screen.getByText('Odaberite Excel datoteku u .xlsx formatu.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pregledaj uvoz' })).toBeDisabled();
  expect(commercialApi.commitAccountImport).not.toHaveBeenCalled();
});

test('nema potvrde uvoza kada pregled nema ispravnih redova', async () => {
  commercialApi.previewAccountImport.mockResolvedValue({ ...preview, preview: { ...preview.preview, valid_rows: 0 } });
  render(<ChakraProvider><AccountImport brandCode="JAVNE_USTANOVE" /></ChakraProvider>);
  fireEvent.change(screen.getByLabelText('Excel baza javnih ustanova'), { target: { files: [new File(['xlsx'], 'a.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Pregledaj uvoz' }));
  expect(await screen.findByRole('button', { name: 'Potvrdi uvoz u Javne ustanove' })).toBeDisabled();
});
