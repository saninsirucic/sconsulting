import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Image,
  Input,
  Link,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react';
import {
  FaArrowLeft,
  FaDownload,
  FaEnvelope,
  FaEnvelopeOpen,
  FaFile,
  FaPaperclip,
  FaPaperPlane,
  FaRedo,
} from 'react-icons/fa';
import { composePayload, outlookApi } from './outlook/api';
import RichTextEditor from './outlook/RichTextEditor';
import { FolderNavigation, MessageList, MailHeader, MailToolbar, printMessage } from './outlook/Workspace';
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_LOGO_URL, emailSignatureForMailbox } from './outlook/signature';
import {
  addressesToText,
  attachmentFileKey,
  FOLDER_DEFINITIONS,
  formatBytes,
  formatMailDate,
  normalizeFolder,
  normalizeFolderKey,
  normalizeMessage,
  OUTLOOK_MAILBOX,
  replySubject,
  sanitizeMailHtml,
} from './outlook/schema';

const outlookBlue = '#2563eb';
const orange = '#f68b1f';
const defaultAttachmentLimit = 5;
const defaultAttachmentBytes = 2500000;
const defaultTotalAttachmentBytes = 5000000;
const statusRetryDelays = process.env.NODE_ENV === 'test' ? [0, 0, 0] : [0, 1000, 3000];


function listFrom(payload, preferredKey) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[preferredKey])) return payload[preferredKey];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function numericLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizeStatus(payload = {}) {
  const configured = Boolean(payload.configured ?? payload.isConfigured ?? payload.is_configured ?? payload.ready);
  const writeEnabled = Boolean(payload.writeEnabled ?? payload.write_enabled ?? payload.canWrite ?? payload.can_write);
  const rawStatus = String(payload.status || (configured ? 'ready' : 'setup_required')).toLowerCase();
  return {
    ...payload,
    configured,
    writeEnabled,
    status: rawStatus,
    mailbox: payload.mailbox || payload.email || payload.address || OUTLOOK_MAILBOX,
    message: payload.message || payload.setupMessage || payload.setup_message || '',
    maxAttachments: numericLimit(payload.limits?.maxAttachments ?? payload.limits?.max_attachments ?? payload.maxAttachments, defaultAttachmentLimit),
    maxAttachmentBytes: numericLimit(payload.limits?.maxAttachmentBytes ?? payload.limits?.max_attachment_bytes ?? payload.maxAttachmentBytes, defaultAttachmentBytes),
    maxTotalAttachmentBytes: numericLimit(payload.limits?.maxTotalAttachmentBytes ?? payload.limits?.max_total_attachment_bytes ?? payload.maxTotalAttachmentBytes, defaultTotalAttachmentBytes),
  };
}

async function getStatusWithRetry() {
  let lastError;
  for (const delay of statusRetryDelays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await outlookApi.getStatus();
    } catch (requestError) {
      lastError = requestError;
      if ([401, 403].includes(Number(requestError?.status))) throw requestError;
    }
  }
  throw lastError || new Error('Outlook status nije dostupan.');
}

function buildFolderList(payload) {
  const remote = listFrom(payload, 'folders').map(normalizeFolder);
  const byKey = new Map(remote.map((folder) => [folder.key, folder]));
  return FOLDER_DEFINITIONS.map((definition) => ({
    ...definition,
    ...(byKey.get(definition.key) || {}),
    label: definition.label,
  }));
}

function displayName(address) {
  return address?.name || address?.address || 'Nepoznat pošiljalac';
}

function getFilename(response, fallback) {
  const disposition = response.headers?.get?.('content-disposition') || '';
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  try {
    return decodeURIComponent(utfMatch?.[1] || plainMatch?.[1] || fallback);
  } catch (error) {
    return fallback;
  }
}

function base64ToBlob(contentBytes, contentType) {
  const binary = window.atob(String(contentBytes || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}

function SetupRequired({ status, user }) {
  return (
    <Flex minH="470px" align="center" justify="center" p={{ base: 4, md: 10 }}>
      <Box maxW="680px" w="full" border="1px solid" borderColor="orange.200" bg="orange.50" borderRadius="2xl" p={{ base: 6, md: 9 }}>
        <Flex boxSize="56px" borderRadius="full" bg="white" color={orange} align="center" justify="center" boxShadow="sm" mb={5}>
          <Icon as={FaEnvelope} boxSize={6} />
        </Flex>
        <Heading size="md">Outlook mailbox još nije podešen</Heading>
        <Text mt={3} color="gray.700">
          Shared mailbox <Text as="span" fontWeight="bold">{status.mailbox}</Text> je rezervisan za ovaj modul, ali administratorska Microsoft 365 konfiguracija još nije završena.
        </Text>
        {status.message && <Text mt={3} color="gray.600">{status.message}</Text>}
        <Alert status="info" mt={6} borderRadius="xl" bg="white">
          <AlertIcon />
          <Box>
            <AlertTitle>Potrebna je administratorska postavka</AlertTitle>
            <AlertDescription>
              Direktor ili sistem administrator treba aktivirati Microsoft Graph pristup na serveru. Korisnici se ne povezuju pojedinačno i lozinka mailboxa se ne unosi u aplikaciju.
            </AlertDescription>
          </Box>
        </Alert>
        {user?.role !== 'direktor' && <Text mt={4} fontSize="sm" color="gray.500">Obratite se direktoru kada administratorska postavka bude spremna.</Text>}
      </Box>
    </Flex>
  );
}

function TemporarilyUnavailable({ message, onRetry, retrying }) {
  return (
    <Flex minH="470px" align="center" justify="center" p={{ base: 4, md: 10 }}>
      <Box maxW="680px" w="full" border="1px solid" borderColor="blue.200" bg="blue.50" borderRadius="2xl" p={{ base: 6, md: 9 }}>
        <Flex boxSize="56px" borderRadius="full" bg="white" color={outlookBlue} align="center" justify="center" boxShadow="sm" mb={5}>
          <Icon as={FaRedo} boxSize={5} />
        </Flex>
        <Heading size="md">Outlook se ponovo povezuje</Heading>
        <Text mt={3} color="gray.700">
          Mailbox <Text as="span" fontWeight="bold">{OUTLOOK_MAILBOX}</Text> je podešen. Server je trenutno u kratkom restartu ili veza kasni; Microsoft dozvole nisu izgubljene.
        </Text>
        {message && <Text mt={3} fontSize="sm" color="gray.600">{message}</Text>}
        <Alert status="info" mt={5} bg="white" borderRadius="xl">
          <AlertIcon />
          <AlertDescription>Aplikacija će automatski ponavljati provjeru. Nije potrebna nova administratorska postavka.</AlertDescription>
        </Alert>
        <Button mt={5} colorScheme="blue" leftIcon={<FaRedo />} onClick={onRetry} isLoading={retrying}>Pokušaj ponovo sada</Button>
      </Box>
    </Flex>
  );
}

function AttachmentCard({ attachment, onDownload, loading }) {
  return (
    <Flex border="1px solid" borderColor="gray.200" borderRadius="xl" px={3} py={2.5} gap={3} align="center" minW={{ base: 'full', sm: '245px' }} bg="white">
      <Flex boxSize="38px" flexShrink={0} borderRadius="lg" bg="blue.50" color={outlookBlue} align="center" justify="center"><Icon as={FaFile} /></Flex>
      <Box minW={0} flex="1">
        <Text fontWeight="semibold" fontSize="sm" noOfLines={1}>{attachment.name}</Text>
        <Text fontSize="xs" color="gray.500">{formatBytes(attachment.size)}</Text>
      </Box>
       <Tooltip label="Preuzmi prilog"><IconButton aria-label={`Preuzmi ${attachment.name}`} minW="44px" minH="44px" variant="ghost" icon={<FaDownload />} isLoading={loading} onClick={() => onDownload(attachment)} /></Tooltip>
    </Flex>
  );
}

function ReadingPane({ message, loading, attachmentLoadingId, onDownload }) {
  const renderedHtml = useMemo(() => sanitizeMailHtml(message?.bodyHtml), [message?.bodyHtml]);
  if (loading) return <Flex minH="420px" align="center" justify="center" gap={3}><Spinner color={outlookBlue} /><Text color="gray.500">Otvaranje poruke...</Text></Flex>;
  if (!message) {
    return (
      <VStack minH="420px" align="center" justify="center" color="gray.400" textAlign="center" p={8}>
        <Flex boxSize="72px" bg="gray.50" borderRadius="full" align="center" justify="center"><Icon as={FaEnvelopeOpen} boxSize={7} /></Flex>
        <Heading size="sm" color="gray.600">Odaberite poruku</Heading>
        <Text fontSize="sm">Sadržaj odabrane poruke prikazat će se ovdje.</Text>
      </VStack>
    );
  }
  const toText = addressesToText(message.to);
  const ccText = addressesToText(message.cc);
  return (
    <Box className="mail-reading-content" p={{ base: 4, md: 6 }} maxH={{ base: 'none', lg: '750px' }} overflowY="auto">
      <Heading size="md" lineHeight="1.35" mb={5} overflowWrap="anywhere">{message.subject}</Heading>
      <Flex gap={3} align="flex-start">
        <Avatar name={displayName(message.from)} bg="blue.100" color={outlookBlue} />
        <Box minW={0} flex="1">
          <Flex gap={2} align="baseline" flexWrap="wrap">
            <Text fontWeight="bold">{displayName(message.from)}</Text>
            {message.from?.name && <Text fontSize="sm" color="gray.500" overflowWrap="anywhere">&lt;{message.from.address}&gt;</Text>}
            <Text ml={{ md: 'auto' }} fontSize="sm" color="gray.500">{formatMailDate(message.receivedAt)}</Text>
          </Flex>
          {toText && <Text fontSize="sm" color="gray.600" mt={1} overflowWrap="anywhere"><Text as="span" fontWeight="semibold">Za:</Text> {toText}</Text>}
          {ccText && <Text fontSize="sm" color="gray.600" overflowWrap="anywhere"><Text as="span" fontWeight="semibold">Cc:</Text> {ccText}</Text>}
        </Box>
      </Flex>
      <Divider my={5} />

      {renderedHtml ? (
        <Box
          className="outlook-message-body"
          fontFamily="Arial, sans-serif"
          fontSize="15px"
          lineHeight="1.65"
          color="gray.800"
          overflowX="auto"
          sx={{
            '& img': { maxWidth: '100%', height: 'auto' },
            '& table': { maxWidth: '100%' },
            '& a': { color: outlookBlue, textDecoration: 'underline' },
            '& blockquote': { borderLeft: '3px solid #cbd5e1', paddingLeft: '14px', color: '#475569', marginLeft: 0 },
          }}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <Text whiteSpace="pre-wrap" fontSize="15px" lineHeight="1.7">{message.bodyText || message.preview || 'Poruka nema tekstualni sadržaj.'}</Text>
      )}

      {message.attachments.length > 0 && (
        <Box mt={7}>
          <Text fontWeight="bold" mb={3}><Icon as={FaPaperclip} mr={2} />Prilozi ({message.attachments.length})</Text>
          <Wrap spacing={3}>
            {message.attachments.filter((attachment) => !attachment.isInline).map((attachment) => (
              <WrapItem key={attachment.id || attachment.name}>
                <AttachmentCard attachment={attachment} onDownload={onDownload} loading={attachmentLoadingId === attachment.id} />
              </WrapItem>
            ))}
          </Wrap>
        </Box>
      )}
    </Box>
  );
}

const createEmptyCompose = () => ({
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  bodyType: 'text',
  signature: { ...DEFAULT_EMAIL_SIGNATURE },
});

function SignatureLine({ label, field, value, onChange, fontWeight, type = 'text', placeholder }) {
  return (
    <Flex align="center" gap={2} minW={0}>
      {label && <Text flexShrink={0} fontSize="sm" fontWeight="bold">{label}:</Text>}
      <Input
        aria-label={`Potpis - ${field}`}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(field, event.target.value)}
        variant="unstyled"
        minH="36px"
        px={2}
        fontSize="sm"
        fontWeight={fontWeight}
        borderRadius="md"
        _hover={{ bg: 'white' }}
        _focusVisible={{ bg: 'white', boxShadow: `0 0 0 1px ${outlookBlue}` }}
      />
    </Flex>
  );
}

function EditableSignature({ signature, onChange, onReset, showMobile = true }) {
  return (
    <Box data-testid="editable-email-signature" bg="blue.50" borderTop="1px solid" borderColor="blue.100" px={{ base: 3, sm: 5 }} py={4}>
      <Flex align={{ base: 'start', sm: 'center' }} justify="space-between" gap={3} mb={3} direction={{ base: 'column', sm: 'row' }}>
        <Box>
          <Text fontWeight="bold" color="blue.900">Potpis — možeš urediti svaki red</Text>
          <Text fontSize="xs" color="blue.700">Klikni na podatak u potpisu i upiši izmjenu samo za ovu poruku.</Text>
        </Box>
        <Button minH="40px" size="sm" variant="outline" colorScheme="blue" bg="white" onClick={onReset}>Vrati početni potpis</Button>
      </Flex>

      <Box bg="white" border="1px solid" borderColor="blue.100" borderRadius="lg" p={{ base: 3, sm: 4 }} maxW="720px" boxShadow="sm">
        <SignatureLine field="greeting" value={signature.greeting} onChange={onChange} placeholder="Pozdrav" />
        <Link href="https://www.s-consulting.ba/" isExternal display="inline-block" mt={3}>
          <Image src={EMAIL_SIGNATURE_LOGO_URL} alt="S-Consulting Group" w={{ base: '250px', sm: '320px' }} maxW="100%" h="auto" />
        </Link>
        <Divider maxW="520px" my={3} borderColor="#f97316" borderWidth="1px" />
        <SignatureLine field="name" value={signature.name} onChange={onChange} fontWeight="bold" placeholder="Ime i prezime" />
        <SignatureLine field="title" value={signature.title} onChange={onChange} placeholder="Funkcija | kompanija" />
        {showMobile && <SignatureLine label="M" field="mobile" value={signature.mobile} onChange={onChange} placeholder="Mobilni telefon" />}
        <SignatureLine label="T" field="phone" value={signature.phone} onChange={onChange} placeholder="Telefon" />
        <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={{ base: 0, lg: 4 }}>
          <SignatureLine label="E" field="email" type="email" value={signature.email} onChange={onChange} placeholder="E-mail" />
          <SignatureLine label="W" field="website" value={signature.website} onChange={onChange} placeholder="Web stranica" />
        </Grid>
        <SignatureLine label="A" field="address" value={signature.address} onChange={onChange} placeholder="Adresa" />
      </Box>
    </Box>
  );
}

export function ComposeModal({ isOpen, onClose, mode, message, status, onSent, initialDraft, contextLabel }) {
  const [form, setForm] = useState(createEmptyCompose);
  const [showCopies, setShowCopies] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const replyAll = mode === 'reply-all';
    const forward = mode === 'forward';
    const compose = mode === 'compose';
    const draft = mode === 'draft';
    setForm({
      to: draft ? addressesToText(message?.to) : compose ? initialDraft?.to || '' : forward ? '' : message?.from?.address || '',
      cc: draft ? addressesToText(message?.cc) : compose ? initialDraft?.cc || '' : replyAll ? addressesToText(message?.cc) : '',
      bcc: draft ? addressesToText(message?.bcc) : '',
      subject: draft ? message?.subject || '' : compose ? initialDraft?.subject || '' : message ? replySubject(message.subject, forward) : '',
      body: draft ? message?.bodyHtml || message?.bodyText || '' : compose ? initialDraft?.body || '' : '',
      bodyType: draft && message?.bodyHtml ? 'html' : 'text',
      signature: draft ? undefined : { ...emailSignatureForMailbox(status.mailbox) },
    });
    setShowCopies(replyAll || draft || Boolean(compose && initialDraft?.cc));
    setDirty(false); setBodyDirty(false); setDiscardPrompt(false);
    setFiles([]);
    setError('');
  }, [isOpen, message, mode, status.mailbox, initialDraft]);

  const addFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    const next = [...files];
    const existing = new Set(files.map(attachmentFileKey));
    for (const file of incoming) {
      if (existing.has(attachmentFileKey(file))) continue;
      if (file.size > status.maxAttachmentBytes) {
        setError(`${file.name} je veći od dozvoljenih ${formatBytes(status.maxAttachmentBytes)}.`);
        continue;
      }
      if (next.length >= status.maxAttachments) {
        setError(`Dozvoljeno je najviše ${status.maxAttachments} priloga.`);
        break;
      }
      next.push(file);
      existing.add(attachmentFileKey(file));
    }
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > status.maxTotalAttachmentBytes) {
      setError(`Ukupna veličina priloga ne smije preći ${formatBytes(status.maxTotalAttachmentBytes)}.`);
      return;
    }
    setFiles(next); setDirty(true);
    event.target.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    if (sending) return;
    setError('');
    if ((mode === 'compose' || mode === 'draft' || mode === 'forward') && !form.to.trim()) return setError('Unesite najmanje jednog primaoca.');
    if (!form.body.trim() || (form.bodyType === 'html' && !new DOMParser().parseFromString(form.body, 'text/html').body.textContent.trim())) return setError('Unesite tekst poruke.');
    setSending(true);
    try {
      const payload = await composePayload(form, files);
      if (mode === 'draft') {
        if (!bodyDirty) { delete payload.body; delete payload.bodyType; }
        await outlookApi.saveDraft(payload, message.id);
        await outlookApi.sendDraft(message.id);
      }
      else if (mode === 'reply') await outlookApi.reply(message.id, { body: payload.body, bodyType: payload.bodyType, signature: payload.signature, attachments: payload.attachments, cc: payload.cc, bcc: payload.bcc });
      else if (mode === 'reply-all') await outlookApi.replyAll(message.id, { body: payload.body, bodyType: payload.bodyType, signature: payload.signature, attachments: payload.attachments, bcc: payload.bcc });
      else if (mode === 'forward') await outlookApi.forward(message.id, {
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        body: payload.body,
        bodyType: payload.bodyType,
        signature: payload.signature,
        attachments: payload.attachments,
      });
      else await outlookApi.send(payload);
      onSent(mode === 'compose' || mode === 'draft' ? 'Poruka je poslana.' : mode === 'forward' ? 'Poruka je proslijeđena.' : 'Odgovor je poslan.');
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'Slanje poruke nije uspjelo.');
    } finally {
      setSending(false);
    }
  };

  const save = async () => {
    if (sending) return;
    setSending(true); setError('');
    try {
      const payload = await composePayload(form, files);
      if (mode === 'draft' && !bodyDirty) { delete payload.body; delete payload.bodyType; }
      await outlookApi.saveDraft(payload, mode === 'draft' ? message.id : undefined);
      onSent('Nacrt je sačuvan u Outlooku.'); onClose();
    } catch (requestError) { setError(requestError.message || 'Nacrt nije sačuvan.'); }
    finally { setSending(false); }
  };
  const requestClose = () => { if (dirty) setDiscardPrompt(true); else onClose(); };

  const title = mode === 'draft' ? 'Uredi nacrt' : mode === 'reply' ? 'Odgovor' : mode === 'reply-all' ? 'Odgovor svima' : mode === 'forward' ? 'Proslijedi poruku' : 'Nova poruka';
  const updateSignature = (field, value) => setForm((current) => ({
    ...current,
    signature: { ...current.signature, [field]: value },
  }));
  return (
    <Modal isOpen={isOpen} onClose={sending ? undefined : requestClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent as="form" onChange={() => setDirty(true)} onInput={() => setDirty(true)} onSubmit={submit} borderRadius={{ base: 0, md: '2xl' }} overflow="hidden" my={{ base: 0, md: 6 }} mx={{ base: 0, md: 4 }} w={{ base: '100vw', md: 'calc(100vw - 64px)' }} maxW={{ base: '100vw', md: '1100px' }} minH={{ base: '100dvh', md: 'auto' }} maxH={{ base: '100dvh', md: 'calc(100vh - 3rem)' }}>
        <ModalHeader bg="#f8fafc" borderBottom="1px solid" borderColor="gray.200">
          <Flex align="center" gap={3}><Flex boxSize="38px" bg="blue.50" color={outlookBlue} align="center" justify="center" borderRadius="lg"><FaEnvelope /></Flex><Box><Text>{title}</Text><Text fontSize="xs" fontWeight="normal" color="gray.500">Šalje se sa {status.mailbox}</Text></Box></Flex>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody py={{ base: 4, md: 5 }} px={{ base: 3, sm: 6 }}>
          <VStack spacing={4} align="stretch">
            {contextLabel && <Box bg="blue.50" borderRadius="lg" px={3} py={2}><Text fontWeight="semibold" overflowWrap="anywhere">{contextLabel}</Text>{!initialDraft?.to && <Text fontSize="sm" color="gray.600">Komitent nema upisanu e-mail adresu. Unesite primaoca za ovu poruku.</Text>}</Box>}
            <FormControl isRequired={mode === 'compose' || mode === 'draft' || mode === 'forward'}>
              <Flex align="center"><FormLabel mb={1}>Za</FormLabel><Button ml="auto" minH="44px" size="sm" variant="ghost" color={outlookBlue} onClick={() => setShowCopies((value) => !value)}>Cc / Bcc</Button></Flex>
              <Input aria-label="Primaoci" placeholder="ime@firma.ba; druga@firma.ba" value={form.to} onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))} isReadOnly={mode === 'reply' || mode === 'reply-all'} />
            </FormControl>
            {showCopies && (
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
                <FormControl><FormLabel>Cc</FormLabel><Input aria-label="Cc" value={form.cc} onChange={(event) => setForm((current) => ({ ...current, cc: event.target.value }))} isReadOnly={mode === 'reply-all'} /></FormControl>
                <FormControl><FormLabel>Bcc</FormLabel><Input aria-label="Bcc" value={form.bcc} onChange={(event) => setForm((current) => ({ ...current, bcc: event.target.value }))} /></FormControl>
              </Grid>
            )}
            <FormControl><FormLabel>Naslov</FormLabel><Input aria-label="Naslov" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} isReadOnly={mode !== 'compose' && mode !== 'draft'} /></FormControl>
            <FormControl isRequired>
              <Flex align="center" justify="space-between"><FormLabel>Poruka</FormLabel>{form.bodyType !== 'html' && <Button size="sm" variant="ghost" colorScheme="blue" onClick={() => {
                const node = document.createElement('div'); node.textContent = form.body; setBodyDirty(true); setDirty(true);
                setForm((current) => ({ ...current, body: node.innerHTML.replace(/\n/g, '<br>'), bodyType: 'html' }));
              }}>Oblikovanje teksta</Button>}</Flex>
              <Box border="1px solid" borderColor="gray.200" borderRadius="xl" overflow="hidden" bg="white" _focusWithin={{ borderColor: outlookBlue, boxShadow: `0 0 0 1px ${outlookBlue}` }}>
                {form.bodyType === 'html' ? <RichTextEditor value={form.body} onChange={(body) => { setForm((current) => ({ ...current, body })); setDirty(true); setBodyDirty(true); }} /> : <Textarea aria-label="Tekst poruke" minH={{ base: '200px', md: '260px' }} resize="vertical" placeholder="Napišite poruku..." value={form.body} onChange={(event) => { setForm((current) => ({ ...current, body: event.target.value })); setBodyDirty(true); }} border="0" borderRadius="0" p={{ base: 3, sm: 5 }} _focusVisible={{ boxShadow: 'none' }} />}
                {form.signature && <EditableSignature
                  signature={form.signature}
                  showMobile={Boolean(emailSignatureForMailbox(status.mailbox).mobile)}
                  onChange={updateSignature}
                  onReset={() => setForm((current) => ({ ...current, signature: { ...emailSignatureForMailbox(status.mailbox) } }))}
                />}
              </Box>
              <Text fontSize="xs" color="gray.500" mt={2}>{mode === 'draft' ? 'Potpis je dio sačuvanog sadržaja poruke.' : 'Prikazani podaci se šalju kao potpis ove poruke. Logo se dodaje automatski i potpis se neće duplirati.'}</Text>
            </FormControl>
            <Box>
              {mode === 'draft' && <Text fontSize="sm" mb={2} color="gray.600">Postojeći prilozi ostaju sačuvani: {message?.attachments?.map((attachment) => attachment.name).join(', ') || 'bez priloga'}. Za nove priloge ovom nacrtu koristite Outlook.</Text>}
              <input ref={fileRef} hidden type="file" multiple onChange={addFiles} />
              <Button isDisabled={mode === 'draft'} minH="44px" variant="outline" leftIcon={<FaPaperclip />} onClick={() => fileRef.current?.click()}>Dodaj prilog</Button>
              <Text as="span" ml={3} fontSize="xs" color="gray.500">do {status.maxAttachments} priloga, pojedinačno do {formatBytes(status.maxAttachmentBytes)}</Text>
              {files.length > 0 && <Wrap mt={3}>{files.map((file) => <WrapItem key={attachmentFileKey(file)}><Badge p={2} borderRadius="lg" colorScheme="blue">{file.name} · {formatBytes(file.size)} <Button aria-label={`Ukloni ${file.name}`} ml={2} size="xs" variant="ghost" onClick={() => setFiles((items) => items.filter((item) => attachmentFileKey(item) !== attachmentFileKey(file)))}>×</Button></Badge></WrapItem>)}</Wrap>}
            </Box>
            {discardPrompt && <Alert status="warning"><AlertIcon /><Box><Text>Imate nesačuvane izmjene.</Text><HStack mt={2}><Button size="sm" onClick={() => setDiscardPrompt(false)}>Nastavi uređivanje</Button><Button size="sm" onClick={onClose}>Odbaci izmjene</Button></HStack></Box></Alert>}
            {error && <Alert status="error" borderRadius="lg"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
          </VStack>
        </ModalBody>
        <ModalFooter borderTop="1px solid" borderColor="gray.100" gap={3} px={{ base: 3, sm: 6 }} pb={{ base: 'max(12px, env(safe-area-inset-bottom))', md: 4 }}>
          <Button minH="44px" flex={{ base: 1, sm: 'none' }} variant="ghost" onClick={requestClose} isDisabled={sending}>Odustani</Button>
          {(mode === 'compose' || mode === 'draft') && <Button minH="44px" variant="outline" onClick={save} isDisabled={sending}>Sačuvaj nacrt</Button>}
          <Button minH="44px" flex={{ base: 1, sm: 'none' }} type="submit" bg={outlookBlue} color="white" _hover={{ bg: 'blue.700' }} leftIcon={<FaPaperPlane />} isLoading={sending}>Pošalji</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default function OutlookModule({ user }) {
  const [status, setStatus] = useState(null);
  const [folders, setFolders] = useState(() => buildFolderList([]));
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [nextCursor, setNextCursor] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('desc');
  const [checkedIds, setCheckedIds] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 600);
  const [preferences, setPreferences] = useState(() => {
    try { return { compact: false, reading: true, ...JSON.parse(localStorage.getItem('outlook-view') || '{}') }; }
    catch { return { compact: false, reading: true }; }
  });
  const [detailVersion, setDetailVersion] = useState(0);
  const [composeMessage, setComposeMessage] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [attachmentLoadingId, setAttachmentLoadingId] = useState('');
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [mobileReadingOpen, setMobileReadingOpen] = useState(false);
  const [error, setError] = useState('');
  const [composeMode, setComposeMode] = useState('compose');
  const { isOpen: composeOpen, onOpen: openCompose, onClose: closeCompose } = useDisclosure();
  const toast = useToast();
  const requestSequence = useRef(0);
  const skipAutoRead = useRef(false);

  const configured = status?.configured;
  const writeEnabled = status?.writeEnabled;
  const activeFolderDefinition = folders.find((folder) => folder.key === activeFolder) || folders[0];

  const loadFolders = useCallback(async () => {
    const payload = await outlookApi.getFolders();
    setFolders(buildFolderList(payload));
  }, []);

  const loadMessages = useCallback(async ({ silent = false, cursor = '', append = false } = {}) => {
    if (!configured) return;
    const sequence = ++requestSequence.current;
    if (!append) setNextCursor('');
    if (!silent) setLoadingMessages(true);
    setError('');
    try {
      const payload = await outlookApi.getMessages({
        folder: activeFolder,
        search: search.trim(),
        unreadOnly: filter === 'unread' || undefined,
        flaggedOnly: filter === 'flagged' || undefined,
        attachmentsOnly: filter === 'attachments' || undefined,
        sort,
        limit: 50,
        cursor: cursor || undefined,
      });
      if (sequence !== requestSequence.current) return;
      const nextMessages = listFrom(payload, 'messages').map(normalizeMessage).filter((message) => message.id);
      setMessages((current) => append
        ? [...current, ...nextMessages.filter((message) => !current.some((entry) => entry.id === message.id))]
        : nextMessages);
      if (!append) setCheckedIds((current) => current.filter((id) => nextMessages.some((message) => message.id === id)));
      setNextCursor(String(payload?.nextCursor ?? payload?.next_cursor ?? payload?.pagination?.nextCursor ?? payload?.pagination?.next_cursor ?? ''));
      setSelectedId((current) => {
        if (append) return current || nextMessages[0]?.id || '';
        return nextMessages.some((message) => message.id === current) ? current : nextMessages[0]?.id || '';
      });
    } catch (requestError) {
      if (sequence === requestSequence.current) setError(requestError.message || 'Poruke nije moguće učitati.');
    } finally {
      if (sequence === requestSequence.current && !silent) setLoadingMessages(false);
    }
  }, [activeFolder, configured, search, filter, sort]);

  const initialize = useCallback(async ({ showLoader = true } = {}) => {
    if (showLoader) setLoadingStatus(true);
    setStatusUnavailable(false);
    setError('');
    try {
      const payload = normalizeStatus(await getStatusWithRetry());
      setStatus(payload);
      if (payload.configured) {
        const [accountResult] = await Promise.allSettled([outlookApi.getAccount(), loadFolders()]);
        if (accountResult.status === 'fulfilled') {
          const account = accountResult.value;
          if (account) {
            setStatus((current) => ({
              ...current,
              mailbox: account.mailbox || current.mailbox,
              displayName: account.displayName || account.display_name || current.displayName,
            }));
            if (account.inbox) {
              setFolders((items) => items.map((folder) => folder.key === 'inbox' ? {
                ...folder,
                totalCount: Number(account.inbox.totalCount ?? account.inbox.total_count) || folder.totalCount,
                unreadCount: Number(account.inbox.unreadCount ?? account.inbox.unread_count) || 0,
              } : folder));
            }
          }
        }
      }
    } catch (requestError) {
      setError(requestError.message || 'Outlook status nije dostupan.');
      setStatusUnavailable(true);
    } finally {
      if (showLoader) setLoadingStatus(false);
    }
  }, [loadFolders]);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    if (!statusUnavailable) return undefined;
    const timer = setTimeout(() => initialize({ showLoader: false }), 10000);
    return () => clearTimeout(timer);
  }, [initialize, statusUnavailable]);

  useEffect(() => {
    if (!configured) return undefined;
    const timer = setTimeout(() => loadMessages(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [configured, loadMessages, search]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setSelectedMessage(null);
      return undefined;
    }
    setLoadingDetail(true);
    setSelectedMessage(null);
    outlookApi.getMessage(selectedId)
      .then((payload) => {
        if (cancelled) return;
        const detail = normalizeMessage(payload?.message || payload?.item || payload);
        setSelectedMessage(detail);
        if (!detail.isRead && !detail.isDraft && status?.writeEnabled && preferences.reading && !skipAutoRead.current) {
          outlookApi.markRead(detail.id, true).then(() => {
            if (cancelled) return;
            setSelectedMessage((current) => current ? { ...current, isRead: true } : current);
            setMessages((items) => items.map((item) => item.id === detail.id ? { ...item, isRead: true } : item));
            setFolders((items) => items.map((folder) => folder.key === activeFolder ? { ...folder, unreadCount: Math.max(0, folder.unreadCount - 1) } : folder));
          }).catch(() => null);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.message || 'Poruku nije moguće otvoriti.');
        }
      })
      .finally(() => { if (!cancelled) { setLoadingDetail(false); skipAutoRead.current = false; } });
    return () => { cancelled = true; };
  }, [activeFolder, selectedId, status?.writeEnabled, detailVersion, preferences.reading]);

  const refresh = async () => {
    await Promise.allSettled([loadFolders(), loadMessages()]);
  };

  useEffect(() => {
    if (!configured || composeOpen || actionLoading || checkedIds.length || loadingMessages) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadMessages({ silent: true });
        loadFolders().catch(() => null);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [configured, composeOpen, actionLoading, checkedIds.length, loadingMessages, loadMessages, loadFolders]);

  const openComposeFor = (mode) => {
    setComposeMode(mode);
    setComposeMessage(mode === 'compose' ? null : selectedMessage);
    openCompose();
  };

  const changePreference = (key, value) => {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try { localStorage.setItem('outlook-view', JSON.stringify(next)); } catch { /* View remains usable without storage. */ }
  };

  const changeFolder = (folder) => {
    ++requestSequence.current;
    setActiveFolder(normalizeFolderKey(folder));
    setMessages([]); setNextCursor(''); setSelectedId(''); setSelectedMessage(null);
    setCheckedIds([]); setMobileReadingOpen(false); setFilter('all');
  };

  const runAction = async (action, value, specificMessage) => {
    const targets = specificMessage ? [specificMessage] : checkedIds.length
      ? messages.filter((message) => checkedIds.includes(message.id)) : selectedMessage ? [selectedMessage] : [];
    if (!targets.length || !writeEnabled || actionLoading) return;
    setActionLoading(true); setError('');
    const failed = []; const succeeded = [];
    for (const message of targets) {
      try {
        let patch;
        if (action === 'read' || action === 'unread') {
          patch = { isRead: action === 'read' };
          await outlookApi.markRead(message.id, patch.isRead);
        } else if (action === 'delete') await outlookApi.deleteMessage(message.id);
        else if (action === 'archive' || action === 'move') await outlookApi.moveMessage(message.id, action === 'archive' ? 'archive' : value);
        else {
          patch = action === 'category' ? { categories: value ? [...new Set([...(message.categories || []), value])] : [] }
            : action === 'importance' ? { importance: value }
              : { flagStatus: ({ flag: 'flagged', unflag: 'notFlagged', complete: 'complete' })[action] };
          await outlookApi.updateMessage(message.id, patch);
        }
        succeeded.push(message.id);
        if (patch) {
          setMessages((items) => items.map((item) => item.id === message.id ? { ...item, ...patch } : item));
          setSelectedMessage((item) => item?.id === message.id ? { ...item, ...patch } : item);
        }
      } catch (requestError) { failed.push({ id: message.id, error: requestError.message }); }
    }
    setCheckedIds(failed.map((item) => item.id));
    if (['delete', 'archive', 'move'].includes(action)) {
      setMessages((items) => items.filter((item) => !succeeded.includes(item.id)));
      if (succeeded.includes(selectedId)) { setSelectedId(''); setSelectedMessage(null); setMobileReadingOpen(false); }
      await loadMessages();
    } else if (filter !== 'all') {
      skipAutoRead.current = true;
      await loadMessages();
    }
    await loadFolders().catch(() => null);
    if (failed.length) setError(`${failed.length} od ${targets.length} poruka nije izmijenjeno. ${failed[0].error || 'Pokušajte ponovo.'}`);
    else toast({ title: targets.length > 1 ? `Ažurirano poruka: ${targets.length}` : 'Poruka je ažurirana.', status: 'success', duration: 2000 });
    setActionLoading(false);
  };

  const downloadAttachment = async (attachment) => {
    if (!selectedMessage) return;
    setAttachmentLoadingId(attachment.id);
    setError('');
    try {
      const response = await outlookApi.getAttachment(selectedMessage.id, attachment.id);
      if (!response.ok) throw new Error('Prilog nije moguće preuzeti.');
      let blob;
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        const payload = await response.json();
        blob = base64ToBlob(payload.contentBytes || payload.content_bytes, payload.contentType || payload.content_type || attachment.contentType);
      } else {
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getFilename(response, attachment.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || 'Prilog nije moguće preuzeti.');
    } finally {
      setAttachmentLoadingId('');
    }
  };

  if (loadingStatus || (!status && !statusUnavailable)) return <Flex minH="500px" align="center" justify="center" gap={3}><Spinner color={orange} size="lg" /><Text color="gray.600">Provjera shared mailboxa...</Text></Flex>;
  if (!status && statusUnavailable) return <TemporarilyUnavailable message={error} onRetry={() => initialize()} retrying={loadingStatus} />;

  return (
    <Box className="outlook-workspace">
      <MailHeader status={status} search={search} onSearch={(value) => { ++requestSequence.current; setSearch(value); setSort('desc'); setNextCursor(''); setCheckedIds([]); }} preferences={preferences} onPreference={changePreference} sidebarOpen={sidebarOpen} onSidebar={() => setSidebarOpen((value) => !value)} />
      {!configured ? <SetupRequired status={status} user={user} /> : <>
        <MailToolbar writeEnabled={writeEnabled} message={loadingDetail ? null : selectedMessage} selectedCount={checkedIds.length} busy={actionLoading} folders={folders} onCompose={openComposeFor} onAction={runAction} onRefresh={async () => { skipAutoRead.current = true; await refresh(); setDetailVersion((value) => value + 1); }} onPrint={() => printMessage(selectedMessage)} />
        {!writeEnabled && <Alert status="warning"><AlertIcon /><Box><AlertTitle>Mailbox je u režimu samo za čitanje</AlertTitle><AlertDescription>Slanje i izmjene su privremeno onemogućeni na serveru.</AlertDescription></Box></Alert>}
        {error && <Alert status="error"><AlertIcon /><AlertDescription flex="1">{error}</AlertDescription><Button size="sm" onClick={refresh}>Pokušaj ponovo</Button></Alert>}
        <div className={`mail-layout ${!sidebarOpen ? 'no-sidebar' : ''} ${!preferences.reading ? 'no-reading' : ''} ${mobileReadingOpen ? 'mobile-reading' : ''}`}>
          {sidebarOpen && <FolderNavigation folders={folders} activeFolder={activeFolder} onChange={changeFolder} status={status} />}
          <MessageList messages={messages} selectedId={selectedId} loading={loadingMessages} onSelect={(message) => { setSelectedId(message.id); setMobileReadingOpen(true); if (!preferences.reading) changePreference('reading', true); }} folderLabel={activeFolderDefinition.label} nextCursor={nextCursor} onLoadMore={() => loadMessages({ cursor: nextCursor, append: true })}
            checkedIds={checkedIds} onCheck={(id) => setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onCheckAll={() => setCheckedIds(checkedIds.length === messages.length ? [] : messages.map((message) => message.id))}
            filter={filter} onFilter={(value) => { ++requestSequence.current; setNextCursor(''); setFilter(value); setCheckedIds([]); }} sort={sort} onSort={() => { if (!search) { ++requestSequence.current; setSort(sort === 'desc' ? 'asc' : 'desc'); setNextCursor(''); } }} sortDisabled={!!search}
            onFlag={(message) => runAction(message.flagStatus === 'flagged' ? 'unflag' : 'flag', undefined, message)} writeEnabled={writeEnabled} busy={actionLoading} compact={preferences.compact} />
          {preferences.reading && <div className="mail-reader">
            <button type="button" className="mail-mobile-back" onClick={() => setMobileReadingOpen(false)}><FaArrowLeft /> Nazad na poruke</button>
            {selectedMessage?.isDraft && <div className="mail-draft-banner"><span>Ova poruka još nije poslana.</span><button type="button" disabled={!writeEnabled || loadingDetail} onClick={() => openComposeFor('draft')}>Uredi nacrt</button></div>}
            <ReadingPane message={selectedMessage} loading={loadingDetail} attachmentLoadingId={attachmentLoadingId} onDownload={downloadAttachment} />
          </div>}
        </div>
      </>}
      {status && <ComposeModal isOpen={composeOpen} onClose={closeCompose} mode={composeMode} message={composeMessage} status={status} onSent={(title) => { toast({ title, status: 'success', duration: 3000 }); refresh(); setDetailVersion((value) => value + 1); }} />}
    </Box>
  );
}
