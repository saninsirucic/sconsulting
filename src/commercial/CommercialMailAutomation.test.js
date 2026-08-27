import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommercialMailAutomation, { normalizeMailAutomationState } from './CommercialMailAutomation';
import { commercialApi } from './api';

jest.mock('./api', () => ({
  commercialApi: {
    getMailAutomation: jest.fn(),
    updateMailAutomation: jest.fn(),
    prepareMailAutomation: jest.fn(),
    decideMailAutomationCandidates: jest.fn(),
    updateMailAutomationCandidateRecipients: jest.fn(),
    sendSelectedMailAutomation: jest.fn(),
    scheduleSelectedMailAutomation: jest.fn(),
  },
}));

const campaignState = {
  sender_email: 'sales@s-consulting.ba',
  enabled: false,
  paused: true,
  auto_send: false,
  daily_limit: 30,
  send_window_start: '09:00',
  send_window_end: '15:00',
  send_interval_minutes: 5,
  workdays: [1, 2, 3, 4, 5],
  report_enabled: true,
  report_time: '16:00',
  report_recipient: 'info@s-consulting.ba',
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
      { account_id: 'account-1', name: 'Komitent A', email: 'a@example.ba', cc_emails: ['nabavka@example.ba'], status: 'PENDING' },
      { account_id: 'account-2', name: 'Komitent B', email: 'b@example.ba', status: 'APPROVED' },
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
  commercialApi.decideMailAutomationCandidates.mockResolvedValue(campaignState);
  commercialApi.updateMailAutomationCandidateRecipients.mockResolvedValue(campaignState);
  commercialApi.sendSelectedMailAutomation.mockResolvedValue({ sent_count: 1, failed_count: 0 });
  commercialApi.scheduleSelectedMailAutomation.mockResolvedValue({
    ...campaignState,
    schedule: { scheduled_count: 1, already_scheduled_count: 0, rejected_count: 0 },
  });
});

test('normalizira novi i prethodni oblik odgovora te uklanja već poslane kandidate', () => {
  const state = normalizeMailAutomationState({
    settings: {
      subject: 'Naslov',
      body_text: 'Tekst',
      daily_limit: 50,
      enabled: true,
      auto_send: true,
      paused: false,
      start_time: '10:15',
      end_time: '14:45',
      interval_minutes: 20,
      workdays_json: '[0,1,2,3,4,5,6]',
      daily_report_enabled: true,
      daily_report_time: '15:00',
      report_email: 'izvjestaj@example.ba',
    },
    counts: { SENT: 4, FAILED: 1 },
    queue: [
      { id: 'queue-1', company_name: 'Aktivan', recipient_email: 'aktivan@example.ba', status: 'APPROVED' },
      { id: 'queue-2', company_name: 'Poslan', recipient_email: 'poslan@example.ba', status: 'SENT' },
      { id: 'queue-3', company_name: 'Nije odobren', recipient_email: 'ne@example.ba', status: 'NOT_APPROVED' },
    ],
  });

  expect(state.daily_limit).toBe(30);
  expect(state.automation).toEqual(expect.objectContaining({
    enabled: true,
    daily_limit: 30,
    send_window_start: '10:15',
    send_window_end: '14:45',
    send_interval_minutes: 20,
    workdays: [0, 1, 2, 3, 4, 5, 6],
    report_enabled: true,
    report_time: '15:00',
    report_recipient: 'izvjestaj@example.ba',
  }));
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
  expect(screen.getByRole('region', { name: 'Automatsko slanje' })).toHaveAttribute('data-mobile-layout', 'stacked');
  expect(screen.getByRole('checkbox', { name: 'Uključi automatsko slanje' })).not.toBeChecked();
  expect(screen.getByLabelText('Komitenata dnevno')).toHaveValue(30);
  expect(screen.getByLabelText('Početak slanja')).toHaveValue('09:00');
  expect(screen.getByLabelText('Kraj slanja')).toHaveValue('15:00');
  expect(screen.getByLabelText('Razmak poruka (min)')).toHaveAttribute('min', '5');
  expect(screen.getByRole('checkbox', { name: 'Samo radnim danima' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Dnevni izvještaj' })).toBeChecked();
  expect(screen.getByLabelText('Vrijeme izvještaja')).toHaveValue('16:00');
  expect(screen.getByLabelText('Primalac izvještaja')).toHaveValue('info@s-consulting.ba');
  expect(screen.getByTestId('automatic-signature-preview')).toBeInTheDocument();
  expect(screen.getByText('Ermina Siručić')).toBeInTheDocument();
  expect(screen.getByText('Direktor | S-Consulting Group')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'S-Consulting Group' })).toHaveAttribute('src', 'https://www.s-consulting.ba/logo-wordmark.png');
  expect(screen.getByText(/Potpis se automatski dodaje jednom/)).toBeInTheDocument();
  expect(screen.getByText('ponuda.pdf')).toBeInTheDocument();
  expect(screen.getAllByText('Komitent A').length).toBeGreaterThan(0);
  expect(screen.getAllByText('a@example.ba').length).toBeGreaterThan(0);
  expect(screen.getAllByText('CC: nabavka@example.ba').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: /Uredi primaoce za/ }).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('button', { name: 'Zakaži odobrene (0)' })).toBeDisabled();
  expect(screen.getAllByText('ČEKA ODLUKU').length).toBeGreaterThan(0);
  expect(screen.getAllByText('ODOBRENO').length).toBeGreaterThan(0);
  expect(screen.getByText(/Mail se ne šalje klikom na „Odobri“/)).toBeInTheDocument();
});

test('HACCP javni sektor ima posebnu kopiju za klasičnu implementaciju i održavanje', async () => {
  renderCampaign({
    brandCode: 'HACCP_PUBLIC',
    brandName: 'HACCP javni sektor',
    campaignDescription: 'Posebna ponuda klasične implementacije i održavanja HACCP-a za javne ustanove i javna preduzeća u BiH.',
    formTitle: 'Forma HACCP ponude za javni sektor',
    subjectPlaceholder: 'Naslov HACCP ponude za javni sektor',
  });

  expect(await screen.findByText(/Posebna ponuda klasične implementacije i održavanja HACCP-a/)).toBeInTheDocument();
  expect(screen.queryByText(/Digitalni HACCP/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Otvori kampanju' }));
  expect(await screen.findByText('Forma HACCP ponude za javni sektor')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Naslov HACCP ponude za javni sektor')).toBeInTheDocument();
  expect(commercialApi.getMailAutomation).toHaveBeenCalledWith('HACCP_PUBLIC');
});

test('sprema kompletne parametre automatskog slanja bez diranja ručnog workflowa', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.click(screen.getByRole('checkbox', { name: 'Uključi automatsko slanje' }));
  fireEvent.change(screen.getByLabelText('Komitenata dnevno'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Početak slanja'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByLabelText('Kraj slanja'), { target: { value: '14:00' } });
  fireEvent.change(screen.getByLabelText('Razmak poruka (min)'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Samo radnim danima' }));
  fireEvent.change(screen.getByLabelText('Vrijeme izvještaja'), { target: { value: '15:00' } });
  fireEvent.change(screen.getByLabelText('Primalac izvještaja'), { target: { value: 'info@s-consulting.ba' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj automatsko slanje' }));

  await waitFor(() => expect(commercialApi.updateMailAutomation).toHaveBeenCalledWith('VISIOCAST', {
    enabled: true,
    auto_send: true,
    daily_limit: 12,
    send_window_start: '10:00',
    send_window_end: '14:00',
    send_interval_minutes: 20,
    workdays: [0, 1, 2, 3, 4, 5, 6],
    report_enabled: true,
    report_time: '15:00',
    report_recipient: 'info@s-consulting.ba',
  }));
  expect(commercialApi.prepareMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('ne sprema neispravan period ili razmak kraći od pet minuta', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.change(screen.getByLabelText('Početak slanja'), { target: { value: '15:00' } });
  fireEvent.change(screen.getByLabelText('Kraj slanja'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj automatsko slanje' }));
  expect(await screen.findByText('Vrijeme početka mora biti prije vremena završetka slanja.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Početak slanja'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Kraj slanja'), { target: { value: '15:00' } });
  fireEvent.change(screen.getByLabelText('Razmak poruka (min)'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj automatsko slanje' }));
  expect(await screen.findByText('Razmak poruka mora biti između 5 i 60 minuta.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Razmak poruka (min)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Vrijeme izvještaja'), { target: { value: '14:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj automatsko slanje' }));
  expect(await screen.findByText('Vrijeme izvještaja mora biti nakon završetka slanja.')).toBeInTheDocument();
  expect(commercialApi.updateMailAutomation).not.toHaveBeenCalled();
});

test('upozorava kada dnevni broj poruka ne može stati u odabrani vremenski prozor', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.change(screen.getByLabelText('Komitenata dnevno'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Početak slanja'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Kraj slanja'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByLabelText('Razmak poruka (min)'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj automatsko slanje' }));

  expect(await screen.findByText('Odabrani broj komitenata i razmak poruka ne mogu stati u zadani period slanja.')).toBeInTheDocument();
  expect(commercialApi.updateMailAutomation).not.toHaveBeenCalled();
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

test('uređuje CC primaoce uz read-only Za, validaciju i bez slanja maila', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Uredi primaoce za Komitent B' })[0]);

  expect(screen.getByRole('dialog', { name: 'Uredi primaoce maila' })).toBeInTheDocument();
  expect(screen.getByLabelText('Glavni primalac')).toHaveValue('b@example.ba');
  expect(screen.getByLabelText('Glavni primalac')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('CC adrese')).toHaveValue('');
  expect(screen.getByText(/svi CC primaoci mogu vidjeti ostale adrese/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('CC adrese'), { target: { value: 'pogresna-adresa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));
  expect(await screen.findByText('Neispravna CC adresa: pogresna-adresa')).toBeInTheDocument();
  expect(commercialApi.updateMailAutomationCandidateRecipients).not.toHaveBeenCalled();

  const tooMany = Array.from({ length: 11 }, (_, index) => `cc${index + 1}@firma.ba`).join(', ');
  fireEvent.change(screen.getByLabelText('CC adrese'), { target: { value: tooMany } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));
  expect(await screen.findByText('Možete unijeti najviše 10 CC adresa.')).toBeInTheDocument();
  expect(commercialApi.updateMailAutomationCandidateRecipients).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('CC adrese'), { target: { value: 'nabavka@firma.ba, direktor@firma.ba\nNABAVKA@FIRMA.BA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }));
  await waitFor(() => expect(commercialApi.updateMailAutomationCandidateRecipients).toHaveBeenCalledWith(
    'VISIOCAST',
    'account-2',
    ['nabavka@firma.ba', 'direktor@firma.ba']
  ));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(await screen.findByText('Zbog promjene CC-a prijedlog treba ponovo odobriti.')).toBeInTheDocument();
});

test('pojedinačno odobrenje samo mijenja odluku i ne šalje mail', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.click(screen.getAllByRole('button', { name: 'Odobri Komitent A' })[0]);

  await waitFor(() => expect(commercialApi.decideMailAutomationCandidates).toHaveBeenCalledWith(
    'VISIOCAST',
    ['account-1'],
    'APPROVED'
  ));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('neuspjelo slanje mora se ponovo odobriti prije novog pokušaja', async () => {
  const failedState = {
    ...campaignState,
    today: {
      ...campaignState.today,
      candidates: [{ account_id: 'account-failed', name: 'Komitent Greška', email: 'greska@example.ba', status: 'FAILED' }],
    },
  };
  commercialApi.getMailAutomation.mockResolvedValue(failedState);
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent Greška' })[0]);
  expect(screen.getAllByText('PONOVO ODOBRI').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Zakaži odobrene (0)' })).toBeDisabled();
  expect(screen.getAllByRole('button', { name: 'Odobri Komitent Greška' })[0]).toBeEnabled();
});

test('grupno odobrava i ne odobrava označene bez automatskog slanja', async () => {
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent A' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Odobri označene (1)' }));
  await waitFor(() => expect(commercialApi.decideMailAutomationCandidates).toHaveBeenLastCalledWith(
    'VISIOCAST',
    ['account-1'],
    'APPROVED'
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Ne odobri označene (1)' }));
  await waitFor(() => expect(commercialApi.decideMailAutomationCandidates).toHaveBeenLastCalledWith(
    'VISIOCAST',
    ['account-1'],
    'REJECTED'
  ));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
});

test('zakazuje samo označene i odobrene račune nakon potvrde te osvježava CRM', async () => {
  const onChanged = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderCampaign({ onChanged });
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));

  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent A' })[0]);
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent B' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Zakaži odobrene (1)' }));

  await waitFor(() => expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledWith('VISIOCAST', ['account-2']));
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('sales@s-consulting.ba'));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(commercialApi.getMailAutomation).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
});

test('odustajanje u potvrdi ne zakazuje nijedan mail', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  renderCampaign();
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Odaberi Komitent B' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Zakaži odobrene (1)' }));

  expect(commercialApi.scheduleSelectedMailAutomation).not.toHaveBeenCalled();
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('više kandidata zakazuje jednim pozivom i prikazuje zbirni rezultat', async () => {
  const onChanged = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const allApprovedState = {
    ...campaignState,
    today: {
      ...campaignState.today,
      candidates: campaignState.today.candidates.map((candidate) => ({ ...candidate, status: 'APPROVED' })),
    },
  };
  commercialApi.getMailAutomation.mockResolvedValue(allApprovedState);
  commercialApi.scheduleSelectedMailAutomation.mockResolvedValue({
    ...allApprovedState,
    schedule: { scheduled_count: 2, already_scheduled_count: 0, rejected_count: 0 },
  });
  renderCampaign({ onChanged });
  fireEvent.click(await screen.findByRole('button', { name: 'Otvori kampanju' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Označi sve kandidate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zakaži odobrene (2)' }));

  await waitFor(() => expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledTimes(1));
  expect(commercialApi.scheduleSelectedMailAutomation).toHaveBeenCalledWith('VISIOCAST', ['account-1', 'account-2']);
  expect(commercialApi.sendSelectedMailAutomation).not.toHaveBeenCalled();
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Zakazano 2, preskočeno 0/)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
});
