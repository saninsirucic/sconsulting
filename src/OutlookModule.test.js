import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OutlookModule from './OutlookModule';
import { outlookApi } from './outlook/api';

jest.mock('./outlook/api', () => ({
  composePayload: jest.requireActual('./outlook/api').composePayload,
  outlookApi: {
    getStatus: jest.fn(),
    getAccount: jest.fn(),
    getFolders: jest.fn(),
    getMessages: jest.fn(),
    getMessage: jest.fn(),
    markRead: jest.fn(),
    moveMessage: jest.fn(),
    deleteMessage: jest.fn(),
    send: jest.fn(),
    reply: jest.fn(),
    replyAll: jest.fn(),
    forward: jest.fn(),
    getAttachment: jest.fn(),
  },
}));

const message = {
  id: 'message-1',
  subject: 'Ponuda za HACCP',
  preview: 'Poštovani, molimo ponudu...',
  from: { name: 'Primjer d.o.o.', address: 'nabavka@primjer.ba' },
  to: [{ address: 'sales@s-consulting.ba' }],
  receivedAt: '2026-08-13T08:30:00.000Z',
  isRead: false,
  hasAttachments: true,
};

const detail = {
  ...message,
  safeHtml: '<p>Pozdrav iz <strong>Primjera</strong>.</p><script>window.bad = true</script><img src="x" onerror="window.bad = true">',
  attachments: [{ id: 'attachment-1', name: 'Upit.pdf', contentType: 'application/pdf', size: 1536 }],
};

function renderModule() {
  return render(<ChakraProvider><OutlookModule user={{ role: 'komercijala', username: 'prodaja' }} /></ChakraProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  outlookApi.getStatus.mockResolvedValue({
    configured: true,
    writeEnabled: true,
    mailbox: 'sales@s-consulting.ba',
    limits: { maxAttachments: 5, maxAttachmentBytes: 3145728, maxTotalAttachmentBytes: 10485760 },
  });
  outlookApi.getAccount.mockResolvedValue({ mailbox: 'sales@s-consulting.ba', displayName: 'S Consulting prodaja', inbox: { totalCount: 12, unreadCount: 3 } });
  outlookApi.getFolders.mockResolvedValue({ items: [
    { key: 'inbox', totalCount: 12, unreadCount: 3 },
    { key: 'sentitems', totalCount: 8, unreadCount: 0 },
  ] });
  outlookApi.getMessages.mockResolvedValue({ items: [message] });
  outlookApi.getMessage.mockResolvedValue(detail);
  outlookApi.markRead.mockResolvedValue({ success: true });
  outlookApi.moveMessage.mockResolvedValue({ success: true });
  outlookApi.deleteMessage.mockResolvedValue({ success: true });
  outlookApi.send.mockResolvedValue({ success: true });
  outlookApi.reply.mockResolvedValue({ success: true });
  outlookApi.replyAll.mockResolvedValue({ success: true });
  outlookApi.forward.mockResolvedValue({ success: true });
});

test('prikazuje shared mailbox, foldere, listu i sigurni reading pane', async () => {
  const { container } = renderModule();

  expect(await screen.findByText('Ponuda za HACCP')).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.outlook-message-body')).toHaveTextContent('Pozdrav iz Primjera.'));
  expect(screen.getAllByText(/sales@s-consulting\.ba/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Poslano' })).toBeInTheDocument();
  expect(screen.getByText('Upit.pdf')).toBeInTheDocument();
  expect(container.querySelector('.outlook-message-body script')).not.toBeInTheDocument();
  expect(container.querySelector('.outlook-message-body img')).not.toBeInTheDocument();
  await waitFor(() => expect(outlookApi.markRead).toHaveBeenCalledWith('message-1', true));
});

test('odgovara na poruku kroz shared mailbox', async () => {
  renderModule();
  await screen.findByRole('button', { name: 'Odgovori' });

  fireEvent.click(screen.getByRole('button', { name: 'Odgovori' }));
  expect(screen.getByLabelText('Primaoci')).toHaveValue('nabavka@primjer.ba');
  fireEvent.change(screen.getByLabelText('Tekst poruke'), { target: { value: 'Hvala, ponudu šaljemo danas.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji' }));

  await waitFor(() => expect(outlookApi.reply).toHaveBeenCalledWith('message-1', expect.objectContaining({
    body: 'Hvala, ponudu šaljemo danas.',
    attachments: [],
  })));
});

test('nova poruka šalje primaoce i sadržaj preko Outlook API-ja', async () => {
  renderModule();
  await screen.findByText('Ponuda za HACCP');
  fireEvent.click(screen.getByRole('button', { name: 'Nova poruka' }));
  const signature = screen.getByTestId('automatic-email-signature');
  expect(signature).toHaveTextContent('Ermina Siručić');
  expect(signature).toHaveTextContent('info@s-consulting.ba');
  expect(screen.getByRole('img', { name: 'S-Consulting Group' })).toHaveAttribute('src', 'https://www.s-consulting.ba/logo-wordmark.png');
  fireEvent.change(screen.getByLabelText('Primaoci'), { target: { value: 'info@firma.ba; uprava@firma.ba' } });
  fireEvent.change(screen.getByLabelText('Naslov'), { target: { value: 'S Consulting ponuda' } });
  fireEvent.change(screen.getByLabelText('Tekst poruke'), { target: { value: 'Poštovani, u prilogu je naša ponuda.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji' }));

  await waitFor(() => expect(outlookApi.send).toHaveBeenCalledWith(expect.objectContaining({
    to: ['info@firma.ba', 'uprava@firma.ba'],
    subject: 'S Consulting ponuda',
  })));
});

test('prosljeđivanje ne šalje read-only originalni subject izvan backend allowliste', async () => {
  renderModule();
  await screen.findByRole('button', { name: 'Proslijedi' });
  fireEvent.click(screen.getByRole('button', { name: 'Proslijedi' }));
  fireEvent.change(screen.getByLabelText('Primaoci'), { target: { value: 'kolega@firma.ba' } });
  fireEvent.change(screen.getByLabelText('Tekst poruke'), { target: { value: 'Prosljeđujem zaprimljeni upit.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pošalji' }));

  await waitFor(() => expect(outlookApi.forward).toHaveBeenCalledWith('message-1', {
    to: ['kolega@firma.ba'],
    cc: [],
    bcc: [],
    body: 'Prosljeđujem zaprimljeni upit.',
    bodyType: 'text',
    attachments: [],
  }));
});

test('prikazuje jasan administratorski setup kada mailbox nije konfigurisan', async () => {
  outlookApi.getStatus.mockResolvedValue({ configured: false, writeEnabled: false, mailbox: 'sales@s-consulting.ba' });
  renderModule();

  expect(await screen.findByText('Outlook mailbox još nije podešen')).toBeInTheDocument();
  expect(screen.getByText('Potrebna je administratorska postavka')).toBeInTheDocument();
  expect(outlookApi.getMessages).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Nova poruka' })).toBeDisabled();
});

test('kratki prekid status poziva automatski se oporavlja bez lažnog setup alarma', async () => {
  outlookApi.getStatus
    .mockRejectedValueOnce(new Error('Privremeni restart servera'))
    .mockResolvedValueOnce({ configured: true, writeEnabled: true, mailbox: 'sales@s-consulting.ba' });

  renderModule();

  expect(await screen.findByText('Ponuda za HACCP')).toBeInTheDocument();
  expect(outlookApi.getStatus).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Outlook mailbox još nije podešen')).not.toBeInTheDocument();
});

test('duži prekid prikazuje ponovno povezivanje i ručni retry, ne administratorski setup', async () => {
  outlookApi.getStatus.mockRejectedValue(new Error('Server se pokreće'));
  renderModule();

  expect(await screen.findByText('Outlook se ponovo povezuje')).toBeInTheDocument();
  expect(outlookApi.getStatus).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Outlook mailbox još nije podešen')).not.toBeInTheDocument();
  expect(screen.getByText(/Microsoft dozvole nisu izgubljene/)).toBeInTheDocument();

  outlookApi.getStatus.mockResolvedValue({ configured: true, writeEnabled: true, mailbox: 'sales@s-consulting.ba' });
  fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo sada' }));

  expect(await screen.findByText('Ponuda za HACCP')).toBeInTheDocument();
  expect(screen.queryByText('Outlook se ponovo povezuje')).not.toBeInTheDocument();
});

test('read-only mailbox blokira sve write akcije', async () => {
  outlookApi.getStatus.mockResolvedValue({ configured: true, writeEnabled: false, mailbox: 'sales@s-consulting.ba' });
  renderModule();

  expect(await screen.findByText('Mailbox je u režimu samo za čitanje')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Odgovori' });
  expect(screen.getByRole('button', { name: 'Nova poruka' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Odgovori' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Arhiviraj poruku' })).toBeDisabled();
  expect(outlookApi.markRead).not.toHaveBeenCalled();
});

test('prosljeđuje opaque cursor kada korisnik učita starije poruke', async () => {
  outlookApi.getMessages
    .mockResolvedValueOnce({ items: [message], nextCursor: 'opaque+/cursor==' })
    .mockResolvedValueOnce({ items: [{ ...message, id: 'message-2', subject: 'Starija poruka' }] });
  renderModule();

  fireEvent.click(await screen.findByRole('button', { name: 'Učitaj još' }));
  await waitFor(() => expect(outlookApi.getMessages).toHaveBeenLastCalledWith(expect.objectContaining({
    cursor: 'opaque+/cursor==',
  })));
  expect(await screen.findByText('Starija poruka')).toBeInTheDocument();
});
