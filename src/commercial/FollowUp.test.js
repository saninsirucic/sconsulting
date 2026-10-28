import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { contactTiming, FollowUpModal, RecordComments } from './FollowUp';
import { commercialApi } from './api';

jest.mock('./api', () => ({ commercialApi: { updateRecord: jest.fn() } }));

test('rokovi koriste sarajevski dan i razlikuju zatvorene, današnje i propuštene kontakte', () => {
  const now = new Date('2026-10-28T09:00:00Z');
  expect(contactTiming({ next_contact_at: '2026-10-27T22:59:00Z' }, now).label).toBe('Propušten rok');
  expect(contactTiming({ next_contact_at: '2026-10-27T23:00:00Z' }, now).label).toBe('Danas · termin prošao');
  expect(contactTiming({ next_contact_at: '2026-10-28T10:00:00Z' }, now).label).toBe('Danas');
  expect(contactTiming({ next_contact_at: '2026-10-28T23:00:00Z' }, now).label).toBe('Zakazano');
  expect(contactTiming({}, now).label).toBe('Bez termina');
  expect(contactTiming({ status: 'WON', next_contact_at: '2025-01-01' }, now).label).toBe('Zatvoren kontakt');
});

test('komentar i napomene su vidljivi bez otvaranja detalja', () => {
  render(<ChakraProvider><RecordComments record={{ comment: 'Pozvati direktora poslije podne.', notes: 'Dogovor: pripremiti ponudu za tri lokacije.' }} /></ChakraProvider>);
  expect(screen.getByText('Pozvati direktora poslije podne.')).toBeVisible();
  expect(screen.getByText('Dogovor: pripremiti ponudu za tri lokacije.')).toBeVisible();
});

test('kratka forma čuva komentar i termin bez prepisivanja podataka komitenta', async () => {
  commercialApi.updateRecord.mockResolvedValue({});
  const onSaved = jest.fn(), onClose = jest.fn();
  render(<ChakraProvider><FollowUpModal record={{ id: 'r1', company_name: 'Kupac', comment: 'Stara bilješka', notes: 'Dogovor', status: 'FOLLOW_UP', priority: 'HIGH' }} onSaved={onSaved} onClose={onClose} /></ChakraProvider>);
  fireEvent.change(screen.getByLabelText('Komentar'), { target: { value: 'Potvrđen termin razgovora.' } });
  fireEvent.change(screen.getByLabelText('Sljedeći poziv — datum i vrijeme'), { target: { value: '2026-10-29T11:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj komentar i termin' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(commercialApi.updateRecord).toHaveBeenLastCalledWith('r1', {
    comment: 'Potvrđen termin razgovora.', notes: 'Dogovor', status: 'FOLLOW_UP', priority: 'HIGH', next_contact_at: new Date('2026-10-29T11:30').toISOString(),
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('neuspjelo čuvanje zadržava uneseni komentar i otvorenu formu', async () => {
  commercialApi.updateRecord.mockRejectedValue(new Error('Veza nije dostupna.'));
  const onClose = jest.fn();
  render(<ChakraProvider><FollowUpModal record={{ id: 'r1', company_name: 'Kupac' }} onSaved={jest.fn()} onClose={onClose} /></ChakraProvider>);
  fireEvent.change(screen.getByLabelText('Komentar'), { target: { value: 'Sačuvati ovu bilješku' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj komentar i termin' }));
  await waitFor(() => expect(screen.getByText('Veza nije dostupna.')).toBeVisible());
  expect(screen.getByLabelText('Komentar')).toHaveValue('Sačuvati ovu bilješku');
  expect(onClose).not.toHaveBeenCalled();
});
