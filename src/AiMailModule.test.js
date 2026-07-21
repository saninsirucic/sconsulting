import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import AiMailModule from './AiMailModule';
import { DraftsPanel } from './aiMail/PhaseTwoPanels';
import { aiMailRequest } from './aiMail/api';

jest.mock('./aiMail/api', () => ({ aiMailRequest: jest.fn() }));

function renderWithChakra(component) {
  return render(<ChakraProvider>{component}</ChakraProvider>);
}

beforeEach(() => {
  aiMailRequest.mockReset();
});

test('Faza 2 otvara pripremu kampanje i jasno prikazuje da je slanje isključeno', async () => {
  aiMailRequest.mockImplementation((path) => {
    if (path === '/dashboard') return Promise.resolve({});
    if (path === '/metadata') return Promise.resolve({ mail: { openAiConfigured: false, testMode: true } });
    if (path === '/campaigns') return Promise.resolve([]);
    if (path.startsWith('/contacts?')) return Promise.resolve({ items: [], pagination: {}, filters: {} });
    return Promise.reject(new Error(`Neočekivan testni poziv: ${path}`));
  });

  renderWithChakra(<AiMailModule token="test-token" user={{ id: 'director', role: 'direktor' }} />);
  expect(await screen.findByText('Stvarno slanje nije aktivno')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Kampanje/ }));

  expect(await screen.findByRole('heading', { name: 'Nova kampanja' })).toBeInTheDocument();
  expect(screen.getByText(/odobren nacrt ostaje izvan queue-a/i)).toBeInTheDocument();
  expect(screen.getByText(/OPENAI_API_KEY i OPENAI_MODEL/i)).toBeInTheDocument();
});

test('direktor može odobriti nacrt, ali UI nema akciju za slanje', async () => {
  const listDraft = {
    id: 'draft-1',
    campaign_id: 'campaign-1',
    contact_id: 'contact-1',
    company_name: 'Alfa d.o.o.',
    campaign_name: 'Test kampanja',
    to_email: 'info@alfa.ba',
    subject: 'Testni predmet',
    status: 'PENDING_APPROVAL'
  };
  aiMailRequest.mockImplementation((path) => {
    if (path === '/campaigns') return Promise.resolve([{ id: 'campaign-1', name: 'Test kampanja' }]);
    if (path.startsWith('/drafts?') || path === '/drafts') return Promise.resolve([listDraft]);
    if (path === '/drafts/draft-1') return Promise.resolve({
      ...listDraft,
      body_text: 'Tekst nacrta',
      body_html: '<p>Tekst nacrta</p>',
      personalization_summary: 'Naziv firme',
      warnings: [],
      versions: [{ id: 'version-1', version_number: 1, source: 'AI', ai_model: 'test-model' }]
    });
    return Promise.reject(new Error(`Neočekivan testni poziv: ${path}`));
  });

  renderWithChakra(<DraftsPanel token="test-token" user={{ id: 'director', role: 'direktor' }} campaignId="campaign-1" refreshKey={0} onChanged={() => {}} />);

  expect(await screen.findByRole('button', { name: 'Odobri nacrt' })).toBeInTheDocument();
  expect(screen.getByText('Slanje je tehnički nedostupno')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /pošalji e-mail/i })).not.toBeInTheDocument();
});
