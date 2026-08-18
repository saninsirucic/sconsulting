import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Image,
  Input,
  SimpleGrid,
  Spinner,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { FaEnvelope, FaPaperPlane, FaPaperclip, FaRedo, FaSave, FaTrash } from 'react-icons/fa';
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_LOGO_URL } from '../outlook/signature';
import { commercialApi } from './api';

const SENDER_EMAIL = 'sales@s-consulting.ba';
const DAILY_LIMIT = 30;
const MAX_ATTACHMENT_BYTES = 2_500_000;

const EMPTY_FORM = { subject: '', body: '' };

const STATUS_LABELS = {
  PENDING: 'Spreman za izbor',
  READY: 'Spreman za izbor',
  APPROVED: 'Spreman za slanje',
  SENDING: 'Slanje u toku',
  FAILED: 'Neuspjelo — pokušaj ponovo',
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCandidate(item, index) {
  const account = item?.account || {};
  const accountId = item?.account_id || item?.accountId || item?.crm_account_id || account.id || item?.id;
  if (!accountId) return null;

  const status = String(item?.status || 'PENDING').toUpperCase();
  return {
    ...item,
    id: String(accountId),
    account_id: String(accountId),
    name: item?.name || item?.company_name || item?.account_name || account.company_name || `Komitent ${index + 1}`,
    email: item?.email || item?.recipient_email || item?.raw_mail || account.raw_mail || '',
    status,
    comment: item?.comment || account.comment || '',
    last_error: item?.last_error || item?.error || '',
  };
}

export function normalizeMailAutomationState(input) {
  const payload = input?.data || input || {};
  const settings = payload.settings || {};
  const template = payload.template || settings.template || settings;
  const today = payload.today || {};
  const counts = payload.counts || today.counts || {};
  const sourceCandidates = today.candidates || payload.candidates || payload.queue || [];
  const candidates = (Array.isArray(sourceCandidates) ? sourceCandidates : [])
    .map(normalizeCandidate)
    .filter((item) => item && item.status !== 'SENT')
    .slice(0, DAILY_LIMIT);

  return {
    sender_email: payload.sender_email || settings.sender_email || SENDER_EMAIL,
    daily_limit: Math.min(DAILY_LIMIT, Math.max(1, toNumber(payload.daily_limit ?? settings.daily_limit, DAILY_LIMIT))),
    template: {
      subject: template.subject || '',
      body: template.body ?? template.body_text ?? '',
      attachment_name: template.attachment_name || template.attachment?.name || '',
      attachment_size: toNumber(template.attachment_size ?? template.attachment?.size),
      attachment_type: template.attachment_type || template.attachment?.type || '',
      updated_at: template.updated_at || settings.updated_at || null,
    },
    today: {
      date: today.date || payload.date || '',
      candidates,
      sent_count: toNumber(today.sent_count ?? payload.sent_count ?? counts.SENT),
      failed_count: toNumber(today.failed_count ?? payload.failed_count ?? counts.FAILED),
    },
  };
}

function formatBytes(value) {
  const bytes = toNumber(value);
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = String(reader.result || '');
      resolve(encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded);
    };
    reader.onerror = () => reject(new Error('Prilog nije moguće pročitati.'));
    reader.readAsDataURL(file);
  });
}

function candidateStatusColor(status) {
  if (status === 'FAILED') return 'red';
  if (status === 'SENDING') return 'orange';
  if (status === 'APPROVED') return 'blue';
  return 'gray';
}

function AutomaticSignaturePreview() {
  const signature = DEFAULT_EMAIL_SIGNATURE;

  return (
    <Box
      data-testid="automatic-signature-preview"
      border="1px solid"
      borderColor="orange.200"
      bg="orange.50"
      borderRadius="xl"
      p={{ base: 4, md: 5 }}
    >
      <Flex
        align={{ base: 'flex-start', sm: 'center' }}
        justify="space-between"
        direction={{ base: 'column', sm: 'row' }}
        gap={2}
        mb={4}
      >
        <Box>
          <HStack flexWrap="wrap">
            <Heading size="xs">Automatski potpis</Heading>
            <Badge colorScheme="orange">PREGLED · NIJE ZA UREĐIVANJE</Badge>
          </HStack>
          <Text mt={1} fontSize="xs" color="gray.600">
            Potpis se automatski dodaje jednom na kraj svakog poslanog maila. Ne upisuj ga u sadržaj iznad.
          </Text>
        </Box>
      </Flex>

      <Box
        bg="white"
        border="1px solid"
        borderColor="gray.200"
        borderRadius="lg"
        p={{ base: 4, sm: 5 }}
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="sm"
        lineHeight="1.45"
        color="gray.800"
        overflow="hidden"
      >
        <Text mb={4}>{signature.greeting}</Text>
        <Image
          src={EMAIL_SIGNATURE_LOGO_URL}
          alt="S-Consulting Group"
          w={{ base: '250px', sm: '320px' }}
          maxW="100%"
          h="auto"
        />
        <Box w="420px" maxW="100%" borderTop="2px solid" borderColor="orange.400" my={3} />
        <Text mb={1} fontWeight="bold">{signature.name}</Text>
        <Text mb={2}>{signature.title}</Text>
        <Text mb={1} overflowWrap="anywhere"><Text as="span" fontWeight="bold">M:</Text> {signature.mobile}</Text>
        <Text mb={1} overflowWrap="anywhere"><Text as="span" fontWeight="bold">T:</Text> {signature.phone}</Text>
        <Text mb={1} overflowWrap="anywhere">
          <Text as="span" fontWeight="bold">E:</Text> {signature.email}
          <Text as="span" display={{ base: 'block', sm: 'inline' }}> <Text as="span" display={{ base: 'none', sm: 'inline' }}>| </Text><Text as="span" fontWeight="bold">W:</Text> {signature.website}</Text>
        </Text>
        <Text overflowWrap="anywhere"><Text as="span" fontWeight="bold">A:</Text> {signature.address}</Text>
      </Box>
    </Box>
  );
}

export default function CommercialMailAutomation({ brandCode, brandName, user, onChanged }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const role = String(user?.role || '').toLowerCase();
  const canManage = role === 'direktor' || role === 'komercijala';
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => normalizeMailAutomationState(null));
  const [form, setForm] = useState(EMPTY_FORM);
  const [draftAttachment, setDraftAttachment] = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sendProgress, setSendProgress] = useState(null);
  const [sendSummary, setSendSummary] = useState(null);

  const applyState = useCallback((result, { syncForm = false } = {}) => {
    const normalized = normalizeMailAutomationState(result);
    setState(normalized);
    const availableIds = new Set(normalized.today.candidates.map((candidate) => candidate.id));
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
    if (syncForm) {
      setForm({ subject: normalized.template.subject, body: normalized.template.body });
      setDraftAttachment(null);
      setRemoveAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    return normalized;
  }, []);

  const load = useCallback(async ({ syncForm = true, showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const result = await commercialApi.getMailAutomation(brandCode);
      return applyState(result, { syncForm });
    } catch (requestError) {
      setError(requestError.message || 'Mail kampanja trenutno nije dostupna.');
      return null;
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [applyState, brandCode]);

  useEffect(() => {
    setSelectedIds(new Set());
    load();
  }, [load]);

  const candidates = state.today.candidates;
  const selectableCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status !== 'SENDING'),
    [candidates]
  );
  const selectedCount = selectableCandidates.filter((candidate) => selectedIds.has(candidate.id)).length;
  const allSelected = selectableCandidates.length > 0 && selectedCount === selectableCandidates.length;
  const partlySelected = selectedCount > 0 && !allSelected;
  const hasSavedTemplate = Boolean(state.template.subject && state.template.body);
  const shownAttachment = draftAttachment || (!removeAttachment && state.template.attachment_name ? {
    name: state.template.attachment_name,
    size: state.template.attachment_size,
  } : null);

  const toggleCandidate = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableCandidates.map((candidate) => candidate.id)));
  };

  const chooseAttachment = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      event.target.value = '';
      setError('Prilog može imati najviše 2,5 MB.');
      return;
    }

    setBusy('file');
    try {
      const dataBase64 = await readFileAsBase64(file);
      setDraftAttachment({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data_base64: dataBase64,
      });
      setRemoveAttachment(false);
    } catch (fileError) {
      event.target.value = '';
      setError(fileError.message || 'Prilog nije moguće pročitati.');
    } finally {
      setBusy('');
    }
  };

  const clearAttachment = () => {
    setDraftAttachment(null);
    setRemoveAttachment(Boolean(state.template.attachment_name));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveTemplate = async () => {
    if (!form.subject.trim() || !form.body.trim()) {
      setError('Unesite naslov i sadržaj maila prije spremanja.');
      return;
    }

    setBusy('save');
    setError('');
    try {
      const payload = {
        subject: form.subject.trim(),
        body: form.body,
        daily_limit: DAILY_LIMIT,
      };
      if (draftAttachment) payload.attachment = draftAttachment;
      else if (removeAttachment) payload.remove_attachment = true;

      await commercialApi.updateMailAutomation(brandCode, payload);
      await load({ syncForm: true, showSpinner: false });
      toast({
        title: `Forma maila za ${brandName} je sačuvana.`,
        description: 'Koristit će se dok je ponovo ne izmijenite.',
        status: 'success',
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Forma maila nije sačuvana.');
    } finally {
      setBusy('');
    }
  };

  const prepareCandidates = async () => {
    setBusy('prepare');
    setError('');
    try {
      const result = await commercialApi.prepareMailAutomation(brandCode);
      if (result) applyState(result);
      await load({ syncForm: false, showSpinner: false });
      setSelectedIds(new Set());
      toast({
        title: `Lista za ${brandName} je pripremljena.`,
        description: 'Prikazani su samo komitenti s poznatom mail adresom koji još nisu dobili ovu kampanju.',
        status: 'success',
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Današnju listu nije moguće pripremiti.');
    } finally {
      setBusy('');
    }
  };

  const refreshCandidates = async () => {
    setBusy('refresh');
    await load({ syncForm: false, showSpinner: false });
    setBusy('');
  };

  const sendSelected = async () => {
    const selectedCandidates = selectableCandidates
      .filter((candidate) => selectedIds.has(candidate.id))
      .slice(0, DAILY_LIMIT);
    if (!selectedCandidates.length) return;

    const confirmed = window.confirm(
      `Poslati ${selectedCandidates.length} ${selectedCandidates.length === 1 ? 'stvarni mail' : 'stvarna maila'} za ${brandName} sa ${SENDER_EMAIL}? Nakon uspješnog slanja u komentar komitenta bit će upisan datum, a komitent se više neće nuditi za ovu kampanju.`
    );
    if (!confirmed) return;

    setBusy('send');
    setError('');
    setSendSummary(null);
    setSendProgress({ current: 0, total: selectedCandidates.length });
    try {
      let sentCount = 0;
      let failedCount = 0;

      for (let index = 0; index < selectedCandidates.length; index += 1) {
        const candidate = selectedCandidates[index];
        setSendProgress({ current: index + 1, total: selectedCandidates.length });
        try {
          const result = await commercialApi.sendSelectedMailAutomation(brandCode, [candidate.account_id]);
          const resultItems = Array.isArray(result?.results) ? result.results : [];
          const reportedFailure = toNumber(
            result?.failed_count ?? result?.summary?.failed,
            resultItems.filter((item) => String(item.status).toUpperCase() === 'FAILED').length
          );
          const explicitlyFailed = result?.success === false
            || String(result?.status || '').toUpperCase() === 'FAILED'
            || reportedFailure > 0;
          if (explicitlyFailed) failedCount += 1;
          else sentCount += 1;
        } catch (requestError) {
          failedCount += 1;
        }
      }

      setSelectedIds(new Set());
      await load({ syncForm: false, showSpinner: false });
      onChanged?.();
      setSendSummary({ sent: sentCount, failed: failedCount });
      toast({
        title: failedCount ? `Poslano ${sentCount}, neuspjelo ${failedCount}.` : `Uspješno poslano: ${sentCount}.`,
        description: failedCount
          ? 'Neuspjele adrese ostale su na listi za ponovni pokušaj.'
          : 'Komentari u CRM tabeli su automatski ažurirani.',
        status: failedCount ? 'warning' : 'success',
        duration: 6000,
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Označene mailove nije moguće poslati.');
      await load({ syncForm: false, showSpinner: false });
      onChanged?.();
    } finally {
      setSendProgress(null);
      setBusy('');
    }
  };

  return (
    <Box border="1px solid" borderColor="blue.200" bg="blue.50" borderRadius="2xl" overflow="hidden">
      <Flex px={{ base: 4, md: 5 }} py={4} align={{ base: 'stretch', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
        <HStack align="start" spacing={3} minW={0}>
          <Flex flexShrink={0} boxSize="44px" borderRadius="xl" bg="white" color="blue.500" align="center" justify="center"><FaEnvelope /></Flex>
          <Box minW={0}>
            <HStack flexWrap="wrap">
              <Heading size="sm">Mail kampanja · ručni izbor do 30</Heading>
              <Badge colorScheme={hasSavedTemplate ? 'green' : 'orange'}>{hasSavedTemplate ? 'FORMA SAČUVANA' : 'POTREBNO PODESITI'}</Badge>
            </HStack>
            <Text fontSize="sm" color="gray.600" mt={1}>Posebna kampanja za {brandName}. Samo poznate CRM adrese; ništa se ne šalje bez tvog izbora i potvrde.</Text>
          </Box>
        </HStack>
        <Button minH="44px" w={{ base: 'full', md: 'auto' }} variant="outline" bg="white" onClick={() => setOpen((value) => !value)}>{open ? 'Sakrij' : 'Otvori kampanju'}</Button>
      </Flex>

      <Collapse in={open} animateOpacity>
        <Box bg="white" borderTop="1px solid" borderColor="gray.200" p={{ base: 4, md: 5 }}>
          {loading ? (
            <Flex py={8} justify="center" gap={3}><Spinner /><Text>Učitavanje kampanje...</Text></Flex>
          ) : (
            <VStack align="stretch" spacing={5}>
              {error && <Alert status="error" borderRadius="lg"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
              {sendSummary && (
                <Alert status={sendSummary.failed ? 'warning' : 'success'} borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription>
                    Slanje završeno: poslano {sendSummary.sent}, neuspjelo {sendSummary.failed}.
                    {sendSummary.failed ? ' Neuspjeli komitenti ostaju dostupni za ponovni pokušaj.' : ' CRM komentari su ažurirani.'}
                  </AlertDescription>
                </Alert>
              )}

              <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={3}>
                {[
                  ['Današnja lista', candidates.length],
                  ['Označeno', selectedCount],
                  ['Danas poslano', state.today.sent_count],
                  ['Neuspjelo', state.today.failed_count],
                ].map(([label, value]) => (
                  <Box key={label} p={3} border="1px solid" borderColor="gray.200" borderRadius="xl" minW={0}>
                    <Text fontSize="xs" color="gray.500">{label}</Text>
                    <Text fontSize={{ base: 'xl', md: '2xl' }} fontWeight="bold">{value}</Text>
                  </Box>
                ))}
              </SimpleGrid>

              {canManage && (
                <Box border="1px solid" borderColor="gray.200" borderRadius="xl" p={{ base: 4, md: 5 }}>
                  <Flex align={{ base: 'start', md: 'center' }} justify="space-between" gap={2} direction={{ base: 'column', md: 'row' }} mb={4}>
                    <Box>
                      <Heading size="sm">Forma maila za {brandName}</Heading>
                      <Text fontSize="sm" color="gray.600" mt={1}>Sačuvaj jednom; forma i prilog ostaju odvojeni od drugih programa.</Text>
                    </Box>
                    {state.template.updated_at && <Text fontSize="xs" color="gray.500">Forma je ranije sačuvana</Text>}
                  </Flex>

                  <VStack align="stretch" spacing={4}>
                    <FormControl>
                      <FormLabel>Pošiljalac</FormLabel>
                      <Input value={SENDER_EMAIL} isReadOnly bg="gray.50" fontWeight="semibold" />
                      <Text mt={1} fontSize="xs" color="gray.500">Adresa je fiksna i ne može se promijeniti u ovoj formi.</Text>
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel>Subject / naslov maila</FormLabel>
                      <Input value={form.subject} placeholder={`Naslov ${brandName} maila`} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel>Forma / sadržaj maila</FormLabel>
                      <Textarea minH={{ base: '220px', md: '280px' }} resize="vertical" value={form.body} placeholder="Unesite sadržaj maila. Možete koristiti {{KOMITENT}} za naziv primaoca." onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
                      <Text mt={1} fontSize="xs" color="gray.500">Oznaka {'{{KOMITENT}}'} automatski se zamjenjuje nazivom komitenta.</Text>
                    </FormControl>
                    <AutomaticSignaturePreview />
                    <FormControl>
                      <FormLabel>Attachment / prilog maila</FormLabel>
                      <Input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg" p={1.5} minH="44px" onChange={chooseAttachment} isDisabled={busy === 'file'} />
                      <Text mt={1} fontSize="xs" color="gray.500">Jedan prilog, najviše 2,5 MB. Novi prilog zamjenjuje prethodni nakon spremanja.</Text>
                    </FormControl>

                    {shownAttachment && (
                      <Flex bg="blue.50" border="1px solid" borderColor="blue.200" borderRadius="lg" p={3} gap={3} align="center" justify="space-between">
                        <HStack minW={0}>
                          <Box color="blue.500" flexShrink={0}><FaPaperclip /></Box>
                          <Box minW={0}><Text fontWeight="semibold" fontSize="sm" overflowWrap="anywhere">{shownAttachment.name}</Text><Text fontSize="xs" color="gray.600">{formatBytes(shownAttachment.size) || 'Sačuvani prilog'}</Text></Box>
                        </HStack>
                        <Button aria-label="Ukloni prilog" size="sm" minW="40px" colorScheme="red" variant="ghost" onClick={clearAttachment}><FaTrash /></Button>
                      </Flex>
                    )}

                    <Button alignSelf={{ base: 'stretch', md: 'flex-start' }} minH="44px" leftIcon={<FaSave />} colorScheme="green" isLoading={busy === 'save'} loadingText="Spremanje" onClick={saveTemplate}>Sačuvaj formu i prilog</Button>
                  </VStack>
                </Box>
              )}

              <Divider />

              <Flex align={{ base: 'stretch', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
                <Box>
                  <Heading size="sm">Kandidati za današnje slanje ({candidates.length}/{state.daily_limit})</Heading>
                  <Text fontSize="sm" color="gray.600" mt={1}>Poslani komitenti se više ne prikazuju u ovoj kampanji.</Text>
                </Box>
                {canManage && (
                  <Flex gap={2} direction={{ base: 'column', sm: 'row' }}>
                    <Button minH="44px" leftIcon={<FaRedo />} variant="outline" isLoading={busy === 'prepare'} onClick={prepareCandidates}>Pripremi / dopuni do 30</Button>
                    <Button minH="44px" variant="ghost" isLoading={busy === 'refresh'} onClick={refreshCandidates}>Osvježi</Button>
                  </Flex>
                )}
              </Flex>

              {candidates.length === 0 ? (
                <Alert status="info" borderRadius="xl"><AlertIcon /><AlertDescription>Nema pripremljenih kandidata. Klikni „Pripremi / dopuni do 30“ za današnju listu poznatih mail adresa.</AlertDescription></Alert>
              ) : (
                <>
                  <Flex p={3} bg="gray.50" border="1px solid" borderColor="gray.200" borderRadius="lg" align={{ base: 'stretch', md: 'center' }} justify="space-between" direction={{ base: 'column', md: 'row' }} gap={3}>
                    <Checkbox aria-label="Označi sve kandidate" isChecked={allSelected} isIndeterminate={partlySelected} onChange={toggleAll}>Označi sve dostupne ({selectableCandidates.length})</Checkbox>
                    <Button minH="44px" leftIcon={<FaPaperPlane />} colorScheme="orange" isDisabled={!canManage || selectedCount === 0 || !hasSavedTemplate} isLoading={busy === 'send'} loadingText={sendProgress ? `Šaljem ${sendProgress.current}/${sendProgress.total}...` : 'Slanje u toku'} onClick={sendSelected}>Pošalji označene ({selectedCount})</Button>
                  </Flex>

                  {!hasSavedTemplate && <Alert status="warning" borderRadius="lg"><AlertIcon /><AlertDescription>Prvo sačuvaj naslov i sadržaj maila za {brandName}.</AlertDescription></Alert>}

                  <TableContainer display={{ base: 'none', md: 'block' }} border="1px solid" borderColor="gray.200" borderRadius="xl">
                    <Table size="sm">
                      <Thead bg="orange.50"><Tr><Th w="48px">Izbor</Th><Th>Komitent</Th><Th>Mail adresa</Th><Th>Status</Th></Tr></Thead>
                      <Tbody>
                        {candidates.map((candidate) => {
                          const disabled = candidate.status === 'SENDING';
                          return (
                            <Tr key={candidate.id}>
                              <Td><Checkbox aria-label={`Odaberi ${candidate.name}`} isChecked={selectedIds.has(candidate.id)} isDisabled={disabled} onChange={() => toggleCandidate(candidate.id)} /></Td>
                              <Td maxW="320px"><Text fontWeight="semibold" whiteSpace="normal" overflowWrap="anywhere">{candidate.name}</Text>{candidate.comment && <Text fontSize="xs" color="gray.500" whiteSpace="normal" noOfLines={2}>{candidate.comment}</Text>}</Td>
                              <Td><Text whiteSpace="normal" overflowWrap="anywhere">{candidate.email || '—'}</Text></Td>
                              <Td><Badge colorScheme={candidateStatusColor(candidate.status)}>{STATUS_LABELS[candidate.status] || candidate.status}</Badge>{candidate.last_error && <Text mt={1} fontSize="xs" color="red.600" whiteSpace="normal">{candidate.last_error}</Text>}</Td>
                            </Tr>
                          );
                        })}
                      </Tbody>
                    </Table>
                  </TableContainer>

                  <VStack display={{ base: 'flex', md: 'none' }} align="stretch" spacing={3}>
                    {candidates.map((candidate) => {
                      const disabled = candidate.status === 'SENDING';
                      return (
                        <Box key={candidate.id} border="1px solid" borderColor={selectedIds.has(candidate.id) ? 'orange.300' : 'gray.200'} borderRadius="xl" p={4} bg={selectedIds.has(candidate.id) ? 'orange.50' : 'white'}>
                          <Checkbox aria-label={`Odaberi ${candidate.name}`} w="full" alignItems="start" isChecked={selectedIds.has(candidate.id)} isDisabled={disabled} onChange={() => toggleCandidate(candidate.id)}><Text fontWeight="bold" pr={2} overflowWrap="anywhere">{candidate.name}</Text></Checkbox>
                          <Text mt={2} ml={6} fontSize="sm" color="gray.700" overflowWrap="anywhere">{candidate.email || 'Nema mail adrese'}</Text>
                          <Flex mt={3} ml={6} align="start" gap={2} direction="column"><Badge colorScheme={candidateStatusColor(candidate.status)}>{STATUS_LABELS[candidate.status] || candidate.status}</Badge>{candidate.comment && <Text fontSize="xs" color="gray.500">{candidate.comment}</Text>}{candidate.last_error && <Text fontSize="xs" color="red.600">{candidate.last_error}</Text>}</Flex>
                        </Box>
                      );
                    })}
                  </VStack>
                </>
              )}
            </VStack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
