import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecordMailModal from './RecordMailModal';
import { outlookApi } from '../outlook/api';

jest.mock('../outlook/api', () => ({
  composePayload: jest.requireActual('../outlook/api').composePayload,
  outlookApi: { getStatus: jest.fn(), send: jest.fn() },
}));

const record = { id: 'client-1', company_name: 'Primjer d.o.o.', email: 'info@primjer.ba', cc_emails: ['uprava@primjer.ba'] };
const ready = { configured: true, writeEnabled: true, mailbox: 'prodaja@s-consulting.ba' };
const onClose = jest.fn();
const onSent = jest.fn();
const open = (client = record) => render(<ChakraProvider><RecordMailModal record={client} onClose={onClose} onSent={onSent} /></ChakraProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  outlookApi.getStatus.mockResolvedValue(ready);
  outlookApi.send.mockResolvedValue({ success: true });
});

test('opens an editable client draft and only sends after submitting the completed form', async () => {
  open();
  expect(await screen.findByLabelText('Primaoci')).toHaveValue(record.email);
  expect(screen.getByLabelText('Cc')).toHaveValue('uprava@primjer.ba');
  expect(screen.getByText('Mail za: Primjer d.o.o.')).toBeInTheDocument();
  expect(screen.getByText('Šalje se sa prodaja@s-consulting.ba')).toBeInTheDocument();
  expect(screen.getByLabelText('Naslov')).toHaveValue('');
  expect(outlookApi.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Naslov'), { target: { value: 'Dogovor o prezentaciji' } });
  fireEvent.change(screen.getByLabelText('Tekst poruke'), { target: { value: 'Poštovani, potvrđujemo dogovoreni termin.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji', exact: true }));
  await waitFor(() => expect(outlookApi.send).toHaveBeenCalledWith(expect.objectContaining({ to: [record.email], cc: ['uprava@primjer.ba'], subject: 'Dogovor o prezentaciji', body: 'Poštovani, potvrđujemo dogovoreni termin.' })));
  expect(onSent).toHaveBeenCalledWith('Poruka je poslana.');
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('allows a missing email to be entered without inventing a recipient or sending on cancel', async () => {
  open({ id: 'no-email', company_name: 'Bez maila' });
  expect(await screen.findByLabelText('Primaoci')).toHaveValue('');
  expect(screen.getByText(/Komitent nema upisanu e-mail adresu/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Primaoci'), { target: { value: 'nova@primjer.ba' } });
  fireEvent.click(screen.getByRole('button', { name: 'Odustani' }));
  expect(screen.getByText('Imate nesačuvane izmjene.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Odbaci izmjene' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(outlookApi.send).not.toHaveBeenCalled();
});

test('preserves the client draft when sending fails', async () => {
  outlookApi.send.mockRejectedValue(new Error('Privremena greška slanja.'));
  open();
  await screen.findByLabelText('Primaoci');
  fireEvent.change(screen.getByLabelText('Tekst poruke'), { target: { value: 'Sačuvani tekst.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji', exact: true }));
  expect(await screen.findByText('Privremena greška slanja.')).toBeInTheDocument();
  expect(screen.getByLabelText('Tekst poruke')).toHaveValue('Sačuvani tekst.');
  expect(screen.getByLabelText('Primaoci')).toHaveValue(record.email);
  expect(onClose).not.toHaveBeenCalled();
});

test('keeps sending unavailable until mailbox access is enabled and supports retry', async () => {
  outlookApi.getStatus.mockResolvedValueOnce({ ...ready, writeEnabled: false });
  open();
  expect(await screen.findByText('Slanje maila nije omogućeno za vaš račun.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Tekst poruke')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
  expect(await screen.findByLabelText('Primaoci')).toHaveValue(record.email);
  expect(outlookApi.send).not.toHaveBeenCalled();
});
