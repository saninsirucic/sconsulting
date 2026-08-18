import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommercialMailAutomation, { normalizeMailAutomationState } from './CommercialMailAutomation';
import { commercialApi } from './api';

jest.mock('./api', () => ({
  commercialApi: {
    getMailAutomation: jest.fn(),
    updateMailAutomation: jest.fn(),
    prepareMailAutomation: jest.fn(),
    sendSelectedMailAutomation: jest.fn(),
  },
}));

const campaignState = {
  sender_email: 'sales@s-consulting.ba',
  daily_limit: 30,
  template: {
    subject: 'Ponuda za {{KOMITENT}}',
    body: 'Poštovani, ovo je ponuda za {{KOMITENT}}.',
    attachment_name: 'ponuda.pdf',
    attachment_size: 2048,
  },
  today: {
    date: '2026-08-17',
    sent_count: 2,
    failed_count: 0,
    candidates: [
      { account_id: 'account-1', name: 'Komitent A', email: 'a@example.ba', status: 'PENDING' },
      { account_id: 'account-2', name: 'Komitent B', email: 'b@example.ba', status: 'FAILED', last_error: 'Privremena greška' },
    ],
  },
};

function renderCampaign(overrides = {}) {
  return render(
    <ChakraProvider>
      <CommercialMailAutomation
        brandCode="VISIOCAST"
        brandName="Visiocast"
        user={{ username: 'prodaja', role: 'komercijala' }}
        {...overrides}
      />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  commercialApi.getMailAutomation.mockResolvedValue(campaignState);
  commercialApi.updateMailAutomation.mockResolvedValue(campaignState);
  commercialApi.prepareMailAutomation.mockResolvedValue(campaignState);
  commercialApi.sendSelectedMailAutomation.mockResolvedValue({ sent_count: 1, failed_count: 0 });
});

test('normalizira novi i prethodni oblik odgovora te uklanja već poslane kandidate', () => {
  const state = normalizeMailAutomationState({
    settings: { subject: 'Naslov', body_text: 'Tekst', daily_limit: 50 },
    counts: { SENT: 4, FAILED: 1 },
    queue: [
      { id: 'queue-1', company_name: 'Aktivan', recipient_email: 'aktivan@example.ba', status: 'APPROVED' },
      { id: 'queue-2', company_name: 'Poslan', recipient_email: 'poslan@example.ba', status: 'SENT' },
    ],
  });

  expect(state.daily_limit).toBe(30);
  expect(state.template).toEqual(expect.objectContaining({ subject: 'Naslov', body: 'Tekst' }));
  expect(state.today.sent_count).toBe(4);
  expect(state.today.candidates).toHaveLength(1);
  expect(state.today.candidates[0]).toEqual(expect.objectContaining({ id: 'queue-1', name: 'Aktivan' }));
});

test('komercijalista vidi zasebnu sačuvanu formu, pošiljaoca i responzivnu listu kandidata', async () => {
  renderCampaign();
  await waitFor(() => expect(commercialApi.getMailAutomation).toHaveBeenCalledWith('VISIOCAST'));
  fireEvent.click(screen.getByRole('button', { name: 'Otvori kampanju' }));

  expect(await screen.findByDisplayValue('sales@s-consulting.ba')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Ponuda za {{KOMITENT}}')).toBeInTheDocument();
  expect(screen.getByTestId('automatic-signature-preview')).toBeInTheDocument();
  expect(screen.getByText('Ermina Siručić')).toBeInTheDocument();
  expect(screen.getByText('Direktor | S-Consulting Group')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'S-Consulting Group' })).toHaveAttribute('src', 'https://www.s-consulting.ba/logo-wordmark.png');
  expect(screen.getByText(/Potpis se automatski dodaje jednom/)).toBeInTheDocument();
  expect(screen.getByText('ponuda.pdf')).toBeInTheDocument();
  expect(screen.getAllByText('Komitent A').length).toBeGreaterThan(0);
  expect(screen.getAllByText('a@example.ba').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Pošalji označene (0)' })).toBeDisabled();
});

test('sprema naslov, sadržaj i trajno uklanjanje postojećeg priloga', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.change(screen.getByLabelText(/Subject \/ naslov maila/), { target: { value: 'Novi naslov' } });
  fireEvent.change(screen.getByLabelText(/Forma \/ sadržaj maila/), { target: { value: 'Novi sadržaj' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ukloni prilog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj formu i prilog' }));

  await waitFor(() => expect(commercialApi.updateMailAutomation).toHaveBeenCalledWith('VISIOCAST', {
    subject: 'Novi naslov',
    body: 'Novi sadržaj',
    daily_limit: 30,
    remove_attachment: true,
  }));
});

test('odbija prilog veći od Microsoft Graph limita od 2,5 MB', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  const oversizedFile = new File([new Uint8Array(2_500_001)], 'prevelik.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(/Attachment \/ prilog maila/), { target: { files: [oversizedFile] } });

  expect(await screen.findByText('Prilog može imati najviše 2,5 MB.')).toBeInTheDocument();
  expect(commercialApi.updateMailAutomation).not.toHaveBeenCalled();
});

test('šalje samo označene račune nakon potvrde i zatim osvježava CRM', async () => {
  const onChanged = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderCampaign({ onChanged });
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  const checkboxes = screen.getAllByRole('checkbox', { name: 'Odaberi Komitent A' });
  fireEvent.click(checkboxes[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji označene (1)' }));

  await waitFor(() => expect(commercialApi.sendSelectedMailAutomation).toHaveBeenCalledWith('VISIOCAST', ['account-1']));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('sales@s-consulting.ba'));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(commercialApi.getMailAutomation).toHaveBeenCalledTimes(2);
  confirmSpy.mockRestore();
});

test('odustajanje u potvrdi ne šalje nijedan mail', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent A' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji označene (1)' }));

  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('više kandidata šalje pojedinačno, nastavlja poslije greške i prikazuje zbirni rezultat', async () => {
  const onChanged = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  commercialApi.sendSelectedMailAutomation
    .mockRejectedValueOnce(new Error('Privremena greška'))
    .mockResolvedValueOnce({ sent_count: 1, failed_count: 0 });
  renderCampaign({ onChanged });
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Označi sve kandidate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji označene (2)' }));

  await waitFor(() => expect(commercialApi.sendSelectedMailAutomation).toHaveBeenCalledTimes(2));
  expect(commercialApi.sendSelectedMailAutomation).toHaveBeenNthCalledWith(1, 'VISIOCAST', ['account-1']);
  expect(commercialApi.sendSelectedMailAutomation).toHaveBeenNthCalledWith(2, 'VISIOCAST', ['account-2']);
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Slanje završeno: poslano 1, neuspjelo 1/)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
});
