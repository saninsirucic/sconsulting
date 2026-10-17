import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HaccpResearch from './HaccpResearch';
import { researchApi } from './researchApi';

jest.mock('./researchApi', () => ({ researchApi: { state: jest.fn(), leads: jest.fn(), settings: jest.fn(), run: jest.fn(), updateLead: jest.fn() } }));
const state = { provider: { configured: true }, running: false, settings: { enabled: false, interval_hours: 24, lookback_days: 90, max_results: 20 }, counts: { NEW: 1 }, runs: [] };
const lead = { id: 'one', name: 'Test restoran', category: 'RESTORAN', municipality: 'Centar', status: 'NEW', opening_status: 'UNCONFIRMED', email: 'info@restaurant.ba', email_source_url: 'https://restaurant.ba/kontakt', sources: [{ url: 'https://restaurant.ba/kontakt', title: 'Kontakt' }], first_seen_at: '2026-10-17T08:00:00Z', last_seen_at: '2026-10-17T08:00:00Z' };
const renderPanel = (role = 'direktor') => render(<ChakraProvider><HaccpResearch user={{ role }} /></ChakraProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  researchApi.state.mockResolvedValue(state);
  researchApi.leads.mockResolvedValue({ items: [lead], total: 1, pages: 1 });
  researchApi.updateLead.mockResolvedValue(lead);
  researchApi.run.mockResolvedValue({ id: 'run', status: 'RUNNING' });
  researchApi.settings.mockResolvedValue(state);
});

test('shows uncertain opening and clickable contact evidence; manual compose does not mark sent', async () => {
  renderPanel();
  expect(await screen.findByText('Test restoran')).toBeInTheDocument();
  expect(screen.getAllByText('Otvaranje treba provjeriti').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: /Izvor e-mail adrese/ })).toHaveAttribute('href', 'https://restaurant.ba/kontakt');
  expect(screen.getByRole('link', { name: /Napiši e-mail/ })).toHaveAttribute('href', expect.stringContaining('mailto:info%40restaurant.ba'));
  expect(researchApi.updateLead).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Status za Test restoran'), { target: { value: 'CONTACTED' } });
  await waitFor(() => expect(researchApi.updateLead).toHaveBeenCalledWith('one', { status: 'CONTACTED' }));
});

test('missing configuration disables paid actions, while commercial users cannot configure or run', async () => {
  researchApi.state.mockResolvedValue({ ...state, provider: { configured: false, message: 'Nedostaje konfiguracija pretrage.' } });
  const panel = renderPanel();
  await screen.findByText('Test restoran');
  expect(screen.getByText('Nedostaje konfiguracija pretrage.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Istraži sada' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Uključi raspored' })).toBeDisabled();
  panel.unmount();
  renderPanel('komercijala');
  await screen.findByText('Test restoran');
  expect(screen.queryByRole('button', { name: 'Istraži sada' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Postavke' })).not.toBeInTheDocument();
});

test('do-not-contact removes compose and filters request only matching leads', async () => {
  researchApi.leads.mockResolvedValue({ items: [{ ...lead, status: 'DO_NOT_CONTACT' }], total: 1, pages: 1 });
  renderPanel();
  await screen.findByText('Test restoran');
  expect(screen.queryByRole('link', { name: /Napiši e-mail/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Samo s e-mail adresom'));
  await waitFor(() => expect(researchApi.leads).toHaveBeenLastCalledWith(expect.objectContaining({ has_email: true, page: 1 })));
});

test('starts a background run and edits notes without sending email', async () => {
  renderPanel();
  await screen.findByText('Test restoran');
  fireEvent.click(screen.getByRole('button', { name: 'Istraži sada' }));
  await waitFor(() => expect(researchApi.run).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Napomena' }));
  fireEvent.change(screen.getByLabelText('Napomena za objekt'), { target: { value: 'Nazvati u ponedjeljak.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj napomenu' }));
  await waitFor(() => expect(researchApi.updateLead).toHaveBeenCalledWith('one', { notes: 'Nazvati u ponedjeljak.' }));
});

test('distinguishes planned platforms from unavailable searches and actual source domains', async () => {
  researchApi.state.mockResolvedValue({ ...state,
    source_plan: [{ id: 'web', label: 'Portali i web', channels: ['Klix'] }, { id: 'social', label: 'Društvene mreže', channels: ['Facebook', 'Instagram', 'TikTok'] }],
    runs: [{ id: 'last', status: 'COMPLETED', new_count: 0, updated_count: 0, skipped_count: 0, usage: { coverage: [
      { id: 'web', status: 'COMPLETED', domains: ['klix.ba'] }, { id: 'social', status: 'UNAVAILABLE', domains: [] },
    ] } }],
  });
  renderPanel();
  fireEvent.click(await screen.findByText(/Gdje agent traži/));
  expect(screen.getByText('Facebook, Instagram, TikTok')).toBeInTheDocument();
  expect(screen.getByText('Pretraga nedostupna')).toBeInTheDocument();
  expect(screen.getByText('Izvori iz zadnje provjere: klix.ba')).toBeInTheDocument();
  expect(screen.getByText(/ne vidi privatne profile/)).toBeInTheDocument();
});
