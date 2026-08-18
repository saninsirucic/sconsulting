import { ChakraProvider } from '@chakra-ui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { outlookApi } from './outlook/api';

jest.mock('./CommercialModule', () => () => <div>Komercijalni CRM ekran</div>);
jest.mock('./OutlookModule', () => () => <div>Shared Outlook ekran</div>);
jest.mock('./outlook/api', () => ({ outlookApi: { getAccount: jest.fn() } }));

function renderApp() {
  return render(<ChakraProvider><App /></ChakraProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  outlookApi.getAccount.mockReturnValue(new Promise(() => {}));
});

test('prikazuje sigurnu prijavu prije internog dashboarda', () => {
  renderApp();
  expect(screen.getByText('Prijava')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prijavi se' })).toBeInTheDocument();
});

test('komercijalista ide direktno u CRM i ne vidi direktorove module', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'commercial-token',
    user: { username: 'prodaja', displayName: 'Komercijalista', role: 'komercijala' },
  }));

  renderApp();
  expect(screen.getByText('Komercijalni CRM ekran')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Klijenti' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Fakture' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Outlook' })).toBeInTheDocument();
  expect(screen.getByText('Komercijalista')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('komercijalista može otvoriti shared Outlook bez poziva direktorovih API-ja', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'commercial-token',
    user: { username: 'prodaja', displayName: 'Komercijalista', role: 'komercijala' },
  }));

  renderApp();
  fireEvent.click(screen.getByRole('button', { name: 'Outlook' }));
  expect(screen.getByText('Shared Outlook ekran')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Klijenti' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('direktor Sanin vidi Komercijalu kao prvu poslovnu cjelinu', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'director-token',
    user: { id: 'env-sanin', username: 'sanin', role: 'direktor', mustChangePassword: false },
  }));
  renderApp();
  const buttons = screen.getAllByRole('button');
  const homeIndex = buttons.findIndex((button) => button.textContent.includes('Početna'));
  const commercialIndex = buttons.findIndex((button) => button.textContent.includes('Komercijala'));
  expect(commercialIndex).toBeGreaterThan(homeIndex);
  expect(screen.getAllByRole('button', { name: 'Komercijala', hidden: true }).length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByRole('button', { name: 'Outlook', hidden: true }).length).toBeGreaterThanOrEqual(2);
});

test('prikazuje broj nepročitanih mailova na Outlook prečici', async () => {
  outlookApi.getAccount.mockResolvedValue({ inbox: { unreadCount: 4 } });
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'commercial-token',
    user: { username: 'prodaja', displayName: 'Komercijalista', role: 'komercijala' },
  }));

  renderApp();

  expect((await screen.findAllByLabelText('4 nepročitanih mailova')).length).toBeGreaterThan(0);
});

test('obavještava o novom mailu dok je otvorena Komercijala', async () => {
  outlookApi.getAccount
    .mockResolvedValueOnce({ inbox: { unreadCount: 1 } })
    .mockResolvedValue({ inbox: { unreadCount: 2 } });
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'commercial-token',
    user: { username: 'prodaja', displayName: 'Komercijalista', role: 'komercijala' },
  }));

  renderApp();
  await screen.findAllByLabelText('1 nepročitanih mailova');
  expect(outlookApi.getAccount).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event('focus')); });

  expect(await screen.findByText('Stigao je novi mail')).toBeInTheDocument();
  expect((await screen.findAllByLabelText('2 nepročitanih mailova')).length).toBeGreaterThan(0);
});

test('obavezna promjena lozinke blokira ostatak aplikacije', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'temporary-token',
    user: { username: 'prodaja', role: 'komercijala', mustChangePassword: true },
  }));

  renderApp();
  expect(screen.getByText('Postavite novu lozinku')).toBeInTheDocument();
  expect(screen.queryByText('Komercijalni CRM ekran')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Trenutna lozinka/)).toBeInTheDocument();
});

test('promjena privremene lozinke otključava commercial profil', async () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'temporary-token',
    user: { username: 'prodaja', role: 'komercijala', mustChangePassword: true },
  }));
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ token: 'new-token', user: { username: 'prodaja', role: 'komercijala', mustChangePassword: false } }),
  });

  renderApp();
  fireEvent.change(screen.getByLabelText(/Trenutna lozinka/), { target: { value: 'Privremena1!' } });
  fireEvent.change(screen.getByLabelText(/^Nova lozinka/), { target: { value: 'NovaSigurna1!' } });
  fireEvent.change(screen.getByLabelText(/Potvrdite novu lozinku/), { target: { value: 'NovaSigurna1!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj novu lozinku' }));

  await waitFor(() => expect(screen.getByText('Komercijalni CRM ekran')).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/change-password'), expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(sessionStorage.getItem('sconsulting-session')).token).toBe('new-token');
});
