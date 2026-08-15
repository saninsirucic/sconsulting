import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

jest.mock('./CommercialModule', () => () => <div>Komercijalni CRM ekran</div>);
jest.mock('./OutlookModule', () => () => <div>Shared Outlook ekran</div>);

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

test('prikazuje sigurnu prijavu prije internog dashboarda', () => {
  render(<App />);
  expect(screen.getByText('Prijava')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prijavi se' })).toBeInTheDocument();
});

test('komercijalista ide direktno u CRM i ne vidi direktorove module', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'commercial-token',
    user: { username: 'prodaja', displayName: 'Komercijalista', role: 'komercijala' },
  }));

  render(<App />);
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

  render(<App />);
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
  render(<App />);
  const buttons = screen.getAllByRole('button');
  const homeIndex = buttons.findIndex((button) => button.textContent.includes('Početna'));
  const commercialIndex = buttons.findIndex((button) => button.textContent.includes('Komercijala'));
  expect(commercialIndex).toBeGreaterThan(homeIndex);
  expect(screen.getByRole('button', { name: 'Komercijala' })).toBeInTheDocument();
});

test('obavezna promjena lozinke blokira ostatak aplikacije', () => {
  sessionStorage.setItem('sconsulting-session', JSON.stringify({
    token: 'temporary-token',
    user: { username: 'prodaja', role: 'komercijala', mustChangePassword: true },
  }));

  render(<App />);
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

  render(<App />);
  fireEvent.change(screen.getByLabelText(/Trenutna lozinka/), { target: { value: 'Privremena1!' } });
  fireEvent.change(screen.getByLabelText(/^Nova lozinka/), { target: { value: 'NovaSigurna1!' } });
  fireEvent.change(screen.getByLabelText(/Potvrdite novu lozinku/), { target: { value: 'NovaSigurna1!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj novu lozinku' }));

  await waitFor(() => expect(screen.getByText('Komercijalni CRM ekran')).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/change-password'), expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(sessionStorage.getItem('sconsulting-session')).token).toBe('new-token');
});
