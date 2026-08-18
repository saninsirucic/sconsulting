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
  Checkbox,
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
  InputGroup,
  InputLeftElement,
  Link,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Stack,
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
  FaArchive,
  FaArrowLeft,
  FaDownload,
  FaEnvelope,
  FaEnvelopeOpen,
  FaExclamationTriangle,
  FaFile,
  FaForward,
  FaInbox,
  FaPaperclip,
  FaPaperPlane,
  FaPen,
  FaRedo,
  FaReply,
  FaReplyAll,
  FaSearch,
  FaTrash,
} from 'react-icons/fa';
import { composePayload, outlookApi } from './outlook/api';
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_LOGO_URL } from './outlook/signature';
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
const green = '#1dba5b';
const defaultAttachmentLimit = 5;
const defaultAttachmentBytes = 2500000;
const defaultTotalAttachmentBytes = 5000000;
const statusRetryDelays = process.env.NODE_ENV === 'test' ? [0, 0, 0] : [0, 1000, 3000];

const folderIcons = {
  inbox: FaInbox,
  sentitems: FaPaperPlane,
  drafts: FaPen,
  archive: FaArchive,
  junkemail: FaExclamationTriangle,
  deleteditems: FaTrash,
};

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

function normalizeStatus(payload = {}) {
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

function FolderNavigation({ folders, activeFolder, onChange }) {
  return (
    <Box borderRight={{ base: 'none', xl: '1px solid' }} borderBottom={{ base: '1px solid', xl: 'none' }} borderColor="gray.200" bg="#f8fafc" p={{ base: 3, xl: 4 }}>
      <Stack direction={{ base: 'row', xl: 'column' }} spacing={2} overflowX="auto" pb={{ base: 1, xl: 0 }} sx={{ '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
        {folders.map((folder) => {
          const active = folder.key === activeFolder;
          return (
            <Button
              key={folder.key}
              aria-label={folder.label}
              variant="ghost"
              justifyContent="flex-start"
              flexShrink={0}
              leftIcon={<Icon as={folderIcons[folder.key] || FaEnvelope} />}
              bg={active ? 'blue.50' : 'transparent'}
              color={active ? outlookBlue : 'gray.700'}
              borderLeft={{ base: 'none', xl: active ? `3px solid ${outlookBlue}` : '3px solid transparent' }}
              borderBottom={{ base: active ? `3px solid ${outlookBlue}` : '3px solid transparent', xl: 'none' }}
              borderRadius={{ base: 'lg', xl: 'md' }}
              onClick={() => onChange(folder.key)}
              _hover={{ bg: active ? 'blue.50' : 'gray.100' }}
            >
              <Flex w="full" align="center" gap={3}>
                <Text>{folder.label}</Text>
                <Badge ml="auto" colorScheme={folder.unreadCount ? 'blue' : 'gray'} variant={folder.unreadCount ? 'solid' : 'subtle'} borderRadius="full">
                  {folder.unreadCount || folder.totalCount || 0}
                </Badge>
              </Flex>
            </Button>
          );
        })}
      </Stack>
    </Box>
  );
}

function MessageList({ messages, selectedId, loading, onSelect, folderLabel, nextCursor, onLoadMore }) {
  if (loading && !messages.length) {
    return <Flex h="360px" align="center" justify="center" gap={3} color="gray.500"><Spinner color={outlookBlue} /><Text>Učitavanje poruka...</Text></Flex>;
  }
  if (!messages.length) {
    return (
      <VStack py={16} px={5} color="gray.500" textAlign="center">
        <Flex boxSize="54px" borderRadius="full" bg="gray.100" align="center" justify="center"><Icon as={FaEnvelopeOpen} boxSize={5} /></Flex>
        <Text fontWeight="bold" color="gray.700">Nema poruka</Text>
        <Text fontSize="sm">U folderu {folderLabel} nema poruka koje odgovaraju filteru.</Text>
      </VStack>
    );
  }
  return (
    <VStack spacing={0} align="stretch" maxH={{ base: '460px', lg: '690px' }} overflowY="auto">
      {messages.map((message) => {
        const active = selectedId === message.id;
        return (
          <Box
            as="button"
            type="button"
            key={message.id}
            onClick={() => onSelect(message)}
            textAlign="left"
            w="full"
            px={4}
            py={3.5}
            bg={active ? 'blue.50' : 'white'}
            borderLeft={active ? `4px solid ${outlookBlue}` : '4px solid transparent'}
            borderBottom="1px solid"
            borderColor="gray.100"
            _hover={{ bg: active ? 'blue.50' : 'gray.50' }}
          >
            <Flex gap={3} align="flex-start">
              <Avatar size="sm" name={displayName(message.from)} bg={message.isRead ? 'gray.200' : 'blue.100'} color={message.isRead ? 'gray.600' : outlookBlue} />
              <Box minW={0} flex="1">
                <Flex gap={2} align="center">
                  <Text noOfLines={1} fontSize="sm" fontWeight={message.isRead ? 'medium' : 'bold'} color="gray.800">{displayName(message.from)}</Text>
                  <Text ml="auto" flexShrink={0} fontSize="xs" color="gray.500">{formatMailDate(message.receivedAt, true)}</Text>
                </Flex>
                <Flex align="center" gap={2} mt={0.5}>
                  {!message.isRead && <Box aria-label="Nepročitano" boxSize="7px" bg={outlookBlue} borderRadius="full" flexShrink={0} />}
                  <Text noOfLines={1} fontSize="sm" fontWeight={message.isRead ? 'normal' : 'semibold'} color="gray.700">{message.subject}</Text>
                  {message.hasAttachments && <Icon as={FaPaperclip} color="gray.500" boxSize={3} flexShrink={0} />}
                </Flex>
                <Text noOfLines={2} fontSize="xs" mt={1} color="gray.500" lineHeight="1.45">{message.preview || 'Bez pregleda sadržaja.'}</Text>
              </Box>
            </Flex>
          </Box>
        );
      })}
      {nextCursor && (
        <Box p={4} textAlign="center">
          <Button size="sm" variant="outline" colorScheme="blue" isLoading={loading} onClick={onLoadMore}>Učitaj još</Button>
        </Box>
      )}
    </VStack>
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

function ReadingPane({ message, loading, writeEnabled, actionLoading, attachmentLoadingId, onComposeAction, onToggleRead, onArchive, onDelete, onDownload }) {
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
    <Box p={{ base: 4, md: 6 }} maxH={{ base: 'none', lg: '750px' }} overflowY="auto">
      <Flex gap={3} direction={{ base: 'column', md: 'row' }} align={{ base: 'stretch', md: 'center' }} mb={5}>
        <HStack spacing={2} flexWrap="wrap">
          <Button minH="44px" leftIcon={<FaReply />} onClick={() => onComposeAction('reply')} isDisabled={!writeEnabled}>Odgovori</Button>
          <Button minH="44px" leftIcon={<FaReplyAll />} onClick={() => onComposeAction('reply-all')} isDisabled={!writeEnabled}>Odgovori svima</Button>
          <Button minH="44px" leftIcon={<FaForward />} onClick={() => onComposeAction('forward')} isDisabled={!writeEnabled}>Proslijedi</Button>
        </HStack>
        <HStack ml={{ md: 'auto' }} spacing={1}>
          <Tooltip label={message.isRead ? 'Označi kao nepročitano' : 'Označi kao pročitano'}><IconButton aria-label={message.isRead ? 'Označi kao nepročitano' : 'Označi kao pročitano'} minW="44px" minH="44px" variant="ghost" icon={message.isRead ? <FaEnvelope /> : <FaEnvelopeOpen />} onClick={onToggleRead} isDisabled={!writeEnabled || actionLoading} /></Tooltip>
          <Tooltip label="Arhiviraj"><IconButton aria-label="Arhiviraj poruku" minW="44px" minH="44px" variant="ghost" icon={<FaArchive />} onClick={onArchive} isDisabled={!writeEnabled || actionLoading} /></Tooltip>
          <Tooltip label="Premjesti u Obrisano"><IconButton aria-label="Obriši poruku" minW="44px" minH="44px" colorScheme="red" variant="ghost" icon={<FaTrash />} onClick={onDelete} isDisabled={!writeEnabled || actionLoading} /></Tooltip>
        </HStack>
      </Flex>

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

function EditableSignature({ signature, onChange, onReset }) {
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
        <SignatureLine label="M" field="mobile" value={signature.mobile} onChange={onChange} placeholder="Mobilni telefon" />
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

function ComposeModal({ isOpen, onClose, mode, message, status, onSent }) {
  const [form, setForm] = useState(createEmptyCompose);
  const [showCopies, setShowCopies] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const replyAll = mode === 'reply-all';
    const forward = mode === 'forward';
    setForm({
      to: forward ? '' : message?.from?.address || '',
      cc: replyAll ? addressesToText(message?.cc) : '',
      bcc: '',
      subject: message ? replySubject(message.subject, forward) : '',
      body: '',
      signature: { ...DEFAULT_EMAIL_SIGNATURE },
    });
    setShowCopies(replyAll);
    setFiles([]);
    setError('');
  }, [isOpen, message, mode]);

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
    setFiles(next);
    event.target.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if ((mode === 'compose' || mode === 'forward') && !form.to.trim()) return setError('Unesite najmanje jednog primaoca.');
    if (!form.body.trim()) return setError('Unesite tekst poruke.');
    setSending(true);
    try {
      const payload = await composePayload(form, files);
      if (mode === 'reply') await outlookApi.reply(message.id, { body: payload.body, bodyType: payload.bodyType, signature: payload.signature, attachments: payload.attachments });
      else if (mode === 'reply-all') await outlookApi.replyAll(message.id, { body: payload.body, bodyType: payload.bodyType, signature: payload.signature, attachments: payload.attachments });
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
      onSent(mode === 'compose' ? 'Poruka je poslana.' : mode === 'forward' ? 'Poruka je proslijeđena.' : 'Odgovor je poslan.');
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'Slanje poruke nije uspjelo.');
    } finally {
      setSending(false);
    }
  };

  const title = mode === 'reply' ? 'Odgovor' : mode === 'reply-all' ? 'Odgovor svima' : mode === 'forward' ? 'Proslijedi poruku' : 'Nova poruka';
  const updateSignature = (field, value) => setForm((current) => ({
    ...current,
    signature: { ...current.signature, [field]: value },
  }));
  return (
    <Modal isOpen={isOpen} onClose={sending ? undefined : onClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent as="form" onSubmit={submit} borderRadius={{ base: 0, md: '2xl' }} overflow="hidden" my={{ base: 0, md: 6 }} mx={{ base: 0, md: 4 }} w={{ base: '100vw', md: 'calc(100vw - 64px)' }} maxW={{ base: '100vw', md: '1100px' }} minH={{ base: '100dvh', md: 'auto' }} maxH={{ base: '100dvh', md: 'calc(100vh - 3rem)' }}>
        <ModalHeader bg="#f8fafc" borderBottom="1px solid" borderColor="gray.200">
          <Flex align="center" gap={3}><Flex boxSize="38px" bg="blue.50" color={outlookBlue} align="center" justify="center" borderRadius="lg"><FaEnvelope /></Flex><Box><Text>{title}</Text><Text fontSize="xs" fontWeight="normal" color="gray.500">Šalje se sa {status.mailbox}</Text></Box></Flex>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody py={{ base: 4, md: 5 }} px={{ base: 3, sm: 6 }}>
          <VStack spacing={4} align="stretch">
            <FormControl isRequired={mode === 'compose' || mode === 'forward'}>
              <Flex align="center"><FormLabel mb={1}>Za</FormLabel><Button ml="auto" minH="44px" size="sm" variant="ghost" color={outlookBlue} onClick={() => setShowCopies((value) => !value)}>Cc / Bcc</Button></Flex>
              <Input aria-label="Primaoci" placeholder="ime@firma.ba; druga@firma.ba" value={form.to} onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))} isReadOnly={mode === 'reply' || mode === 'reply-all'} />
            </FormControl>
            {showCopies && (
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
                <FormControl><FormLabel>Cc</FormLabel><Input aria-label="Cc" value={form.cc} onChange={(event) => setForm((current) => ({ ...current, cc: event.target.value }))} isReadOnly={mode === 'reply-all'} /></FormControl>
                <FormControl><FormLabel>Bcc</FormLabel><Input aria-label="Bcc" value={form.bcc} onChange={(event) => setForm((current) => ({ ...current, bcc: event.target.value }))} /></FormControl>
              </Grid>
            )}
            <FormControl><FormLabel>Naslov</FormLabel><Input aria-label="Naslov" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} isReadOnly={mode !== 'compose'} /></FormControl>
            <FormControl isRequired>
              <FormLabel>Poruka</FormLabel>
              <Box border="1px solid" borderColor="gray.200" borderRadius="xl" overflow="hidden" bg="white" _focusWithin={{ borderColor: outlookBlue, boxShadow: `0 0 0 1px ${outlookBlue}` }}>
                <Textarea aria-label="Tekst poruke" minH={{ base: '200px', md: '260px' }} resize="vertical" placeholder="Napišite poruku..." value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} border="0" borderRadius="0" p={{ base: 3, sm: 5 }} _focusVisible={{ boxShadow: 'none' }} />
                <EditableSignature
                  signature={form.signature}
                  onChange={updateSignature}
                  onReset={() => setForm((current) => ({ ...current, signature: { ...DEFAULT_EMAIL_SIGNATURE } }))}
                />
              </Box>
              <Text fontSize="xs" color="gray.500" mt={2}>Prikazani podaci se šalju kao potpis ove poruke. Logo se dodaje automatski i potpis se neće duplirati.</Text>
            </FormControl>
            <Box>
              <input ref={fileRef} hidden type="file" multiple onChange={addFiles} />
              <Button minH="44px" variant="outline" leftIcon={<FaPaperclip />} onClick={() => fileRef.current?.click()}>Dodaj prilog</Button>
              <Text as="span" ml={3} fontSize="xs" color="gray.500">do {status.maxAttachments} priloga, pojedinačno do {formatBytes(status.maxAttachmentBytes)}</Text>
              {files.length > 0 && <Wrap mt={3}>{files.map((file) => <WrapItem key={attachmentFileKey(file)}><Badge p={2} borderRadius="lg" colorScheme="blue">{file.name} · {formatBytes(file.size)} <Button aria-label={`Ukloni ${file.name}`} ml={2} size="xs" variant="ghost" onClick={() => setFiles((items) => items.filter((item) => attachmentFileKey(item) !== attachmentFileKey(file)))}>×</Button></Badge></WrapItem>)}</Wrap>}
            </Box>
            {error && <Alert status="error" borderRadius="lg"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
          </VStack>
        </ModalBody>
        <ModalFooter borderTop="1px solid" borderColor="gray.100" gap={3} px={{ base: 3, sm: 6 }} pb={{ base: 'max(12px, env(safe-area-inset-bottom))', md: 4 }}>
          <Button minH="44px" flex={{ base: 1, sm: 'none' }} variant="ghost" onClick={onClose} isDisabled={sending}>Odustani</Button>
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
  const [unreadOnly, setUnreadOnly] = useState(false);
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
        unreadOnly: unreadOnly || undefined,
        limit: 50,
        cursor: cursor || undefined,
      });
      if (sequence !== requestSequence.current) return;
      const nextMessages = listFrom(payload, 'messages').map(normalizeMessage).filter((message) => message.id);
      setMessages((current) => append
        ? [...current, ...nextMessages.filter((message) => !current.some((entry) => entry.id === message.id))]
        : nextMessages);
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
  }, [activeFolder, configured, search, unreadOnly]);

  const initialize = useCallback(async ({ showLoader = true } = {}) => {
    if (showLoader) setLoadingStatus(true);
    setStatusUnavailable(false);
    setError('');
    try {
      const payload = normalizeStatus(await getStatusWithRetry());
      setStatus(payload);
      if (payload.configured) {
        try {
          const [account] = await Promise.all([outlookApi.getAccount(), loadFolders()]);
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
        } catch (folderError) {
          setError(folderError.message || 'Outlook nalog i folderi nisu potpuno dostupni.');
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
    outlookApi.getMessage(selectedId)
      .then((payload) => {
        if (cancelled) return;
        const detail = normalizeMessage(payload?.message || payload?.item || payload);
        setSelectedMessage(detail);
        if (!detail.isRead && status?.writeEnabled) {
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
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [activeFolder, selectedId, status?.writeEnabled]);

  const refresh = async () => {
    await Promise.allSettled([loadFolders(), loadMessages()]);
  };

  const openComposeFor = (mode) => {
    setComposeMode(mode);
    openCompose();
  };

  const runMessageAction = async (action, successMessage) => {
    if (!selectedMessage) return;
    setActionLoading(true);
    setError('');
    try {
      await action(selectedMessage);
      toast({ title: successMessage, status: 'success', duration: 2500, isClosable: true });
      await Promise.allSettled([loadFolders(), loadMessages()]);
      setMobileReadingOpen(false);
    } catch (requestError) {
      setError(requestError.message || 'Akcija nije uspjela.');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleRead = () => runMessageAction(async (message) => {
    await outlookApi.markRead(message.id, !message.isRead);
    setSelectedMessage((current) => current ? { ...current, isRead: !current.isRead } : current);
    setMessages((items) => items.map((item) => item.id === message.id ? { ...item, isRead: !item.isRead } : item));
  }, selectedMessage?.isRead ? 'Poruka je označena kao nepročitana.' : 'Poruka je označena kao pročitana.');

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
    <Box mx={{ base: -2, md: -5 }} my={{ base: -2, md: -5 }}>
      <Flex p={{ base: 4, md: 5 }} gap={4} align={{ base: 'stretch', md: 'center' }} direction={{ base: 'column', md: 'row' }} borderBottom="1px solid" borderColor="gray.200">
        <Box>
          <HStack spacing={3}>
            <Flex boxSize="44px" borderRadius="xl" bg="blue.50" color={outlookBlue} align="center" justify="center"><Icon as={FaEnvelope} boxSize={5} /></Flex>
            <Box>
              <Heading size="md">Outlook Mail</Heading>
              <Text fontSize="sm" color="gray.500">Shared prodajni mailbox</Text>
            </Box>
          </HStack>
        </Box>
        <HStack ml={{ md: 'auto' }} spacing={3} flexWrap="wrap" w={{ base: 'full', md: 'auto' }}>
          <Box border="1px solid" borderColor="gray.200" borderRadius="xl" px={3.5} py={2} bg="gray.50" w={{ base: 'full', sm: 'auto' }} minW={0}>
            <Text fontSize="xs" color="gray.500">{status.displayName || 'Nalog'}</Text>
            <HStack spacing={2}><Box boxSize="7px" flexShrink={0} borderRadius="full" bg={configured ? green : orange} /><Text fontSize="sm" fontWeight="bold" overflowWrap="anywhere">{status.mailbox}</Text></HStack>
          </Box>
          <Badge colorScheme={statusUnavailable ? 'blue' : configured ? 'green' : 'orange'} borderRadius="full" px={3} py={1}>{statusUnavailable ? 'Ponovno povezivanje' : configured ? 'Aktivan' : 'Podešavanje potrebno'}</Badge>
          <Tooltip label={!writeEnabled ? 'Slanje je trenutno onemogućeno na serveru.' : ''} isDisabled={writeEnabled}>
            <Button bg={outlookBlue} color="white" _hover={{ bg: 'blue.700' }} leftIcon={<FaPen />} isDisabled={!configured || !writeEnabled} onClick={() => openComposeFor('compose')}>Nova poruka</Button>
          </Tooltip>
        </HStack>
      </Flex>

      {!configured ? <SetupRequired status={status} user={user} /> : (
        <>
          {!writeEnabled && (
            <Alert status="warning" borderRadius="none">
              <AlertIcon />
              <Box><AlertTitle>Mailbox je u režimu samo za čitanje</AlertTitle><AlertDescription>Poruke možete pregledati i preuzimati priloge, ali slanje i izmjene su privremeno onemogućeni na serveru.</AlertDescription></Box>
            </Alert>
          )}
          {error && <Alert status={statusUnavailable ? 'info' : 'error'} borderRadius="none"><AlertIcon /><AlertDescription flex="1">{error}</AlertDescription><Button size="sm" variant="outline" colorScheme={statusUnavailable ? 'blue' : 'red'} onClick={statusUnavailable ? () => initialize({ showLoader: false }) : refresh}>Pokušaj ponovo</Button></Alert>}

          <Grid templateColumns={{ base: '1fr', xl: '220px minmax(0, 1fr)' }} borderBottom="1px solid" borderColor="gray.200">
            <FolderNavigation folders={folders} activeFolder={activeFolder} onChange={(folder) => { setActiveFolder(normalizeFolderKey(folder)); setMessages([]); setNextCursor(''); setSelectedId(''); setSelectedMessage(null); setMobileReadingOpen(false); }} />
            <Box>
              <Flex p={3} gap={3} align={{ base: 'stretch', md: 'center' }} direction={{ base: 'column', md: 'row' }} borderBottom="1px solid" borderColor="gray.200" bg="white">
                <InputGroup maxW={{ md: '560px' }}>
                  <InputLeftElement pointerEvents="none"><FaSearch color="#718096" /></InputLeftElement>
                  <Input aria-label="Pretraga poruka" placeholder="Pretraži pošiljaoca, naslov ili sadržaj..." value={search} onChange={(event) => { setNextCursor(''); setSearch(event.target.value); }} bg="gray.50" />
                </InputGroup>
                <HStack ml={{ md: 'auto' }} spacing={3}>
                  <Checkbox isChecked={unreadOnly} onChange={(event) => { setNextCursor(''); setUnreadOnly(event.target.checked); }} colorScheme="blue">Samo nepročitano</Checkbox>
                  <Tooltip label="Osvježi"><IconButton aria-label="Osvježi poruke" minW="44px" minH="44px" icon={<FaRedo />} variant="outline" isLoading={loadingMessages} onClick={refresh} /></Tooltip>
                </HStack>
              </Flex>

              <Grid templateColumns={{ base: 'minmax(0, 1fr)', lg: '380px minmax(0, 1fr)' }} minH={{ lg: '690px' }}>
                <Box display={{ base: mobileReadingOpen ? 'none' : 'block', lg: 'block' }} borderRight={{ lg: '1px solid' }} borderBottom={{ base: '1px solid', lg: 'none' }} borderColor="gray.200" minW={0}>
                  <Flex px={4} py={3} align="center" bg="#f8fafc" borderBottom="1px solid" borderColor="gray.200">
                    <Box><Text fontWeight="bold">{activeFolderDefinition.label}</Text><Text fontSize="xs" color="gray.500">{messages.length} poruka u prikazu</Text></Box>
                    {loadingMessages && <Spinner ml="auto" size="sm" color={outlookBlue} />}
                  </Flex>
                  <MessageList
                    messages={messages}
                    selectedId={selectedId}
                    loading={loadingMessages}
                    onSelect={(message) => { setSelectedMessage(message); setSelectedId(message.id); setMobileReadingOpen(true); }}
                    folderLabel={activeFolderDefinition.label}
                    nextCursor={nextCursor}
                    onLoadMore={() => loadMessages({ cursor: nextCursor, append: true })}
                  />
                </Box>
                <Box display={{ base: mobileReadingOpen ? 'block' : 'none', lg: 'block' }} minW={0}>
                  <Button display={{ base: 'inline-flex', lg: 'none' }} m={3} minH="44px" variant="ghost" leftIcon={<FaArrowLeft />} onClick={() => setMobileReadingOpen(false)}>Nazad na poruke</Button>
                  <ReadingPane
                    message={selectedMessage}
                    loading={loadingDetail}
                    writeEnabled={writeEnabled}
                    actionLoading={actionLoading}
                    attachmentLoadingId={attachmentLoadingId}
                    onComposeAction={openComposeFor}
                    onToggleRead={toggleRead}
                    onArchive={() => runMessageAction((message) => outlookApi.moveMessage(message.id, 'archive'), 'Poruka je arhivirana.')}
                    onDelete={() => runMessageAction((message) => outlookApi.deleteMessage(message.id), 'Poruka je premještena u Obrisano.')}
                    onDownload={downloadAttachment}
                  />
                </Box>
              </Grid>
            </Box>
          </Grid>
        </>
      )}

      {status && (
        <ComposeModal
          isOpen={composeOpen}
          onClose={closeCompose}
          mode={composeMode}
          message={selectedMessage}
          status={status}
          onSent={(title) => {
            toast({ title, status: 'success', duration: 3000, isClosable: true });
            refresh();
          }}
        />
      )}
    </Box>
  );
}
