import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => sessionStorage.clear());

test('prikazuje sigurnu prijavu prije internog dashboarda', () => {
  render(<App />);
  expect(screen.getByText('Prijava')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prijavi se' })).toBeInTheDocument();
});
