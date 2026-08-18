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
  Switch,
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
import { FaCheck, FaEnvelope, FaPaperPlane, FaPaperclip, FaRedo, FaSave, FaTimes, FaTrash } from 'react-icons/fa';
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_LOGO_URL } from '../outlook/signature';
import { commercialApi } from './api';
import MailRecipientsEditor, { normalizeCcEmails } from './MailRecipientsEditor';

const SENDER_EMAIL = 'sales@s-consulting.ba';
const DAILY_LIMIT = 30;
const MAX_ATTACHMENT_BYTES = 2_500_000;
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_REPORT_RECIPIENT = 'info@s-consulting.ba';

const EMPTY_FORM = { subject: '', body: '' };
const EMPTY_AUTOMATION_FORM = {
  enabled: false,
  daily_limit: DAILY_LIMIT,
  send_window_start: '09:00',
  send_window_end: '15:00',
  send_interval_minutes: 5,
  workdays_only: true,
  report_enabled: true,
  report_time: '16:00',
  report_recipient: DEFAULT_REPORT_RECIPIENT,
};

const STATUS_LABELS = {
  PENDING: 'ČEKA ODLUKU',
  READY: 'ČEKA ODLUKU',
  APPROVED: 'ODOBRENO',
  SCHEDULED: 'ZAKAZANO • SVAKIH 5 MIN',
  SENDING: 'Slanje u toku',
  FAILED: 'PONOVO ODOBRI',
};

const HIDDEN_CANDIDATE_STATUSES = new Set(['SENT', 'SKIPPED', 'NOT_APPROVED', 'REJECTED']);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return Boolean(value);
}

function normalizeTime(value, fallback) {
  const normalized = String(value || '').trim().slice(0, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallback;
}

function normalizeWorkdays(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (error) {
      source = DEFAULT_WORKDAYS;
    }
  }
  if (!Array.isArray(source)) return DEFAULT_WORKDAYS;
  const days = [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length ? days : DEFAULT_WORKDAYS;
}

function timeToMinutes(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
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
    cc_emails: normalizeCcEmails(item?.cc_emails || item?.ccEmails || account.cc_emails),
  };
}

export function normalizeMailAutomationState(input) {
  const payload = input?.data || input || {};
  const settings = payload.settings || {};
  const automation = payload.automation || settings.automation || settings;
  const template = payload.template || settings.template || settings;
  const today = payload.today || {};
  const counts = payload.counts || today.counts || {};
  const sourceCandidates = today.candidates || payload.candidates || payload.queue || [];
  const candidates = (Array.isArray(sourceCandidates) ? sourceCandidates : [])
    .map(normalizeCandidate)
    .filter((item) => item && !HIDDEN_CANDIDATE_STATUSES.has(item.status))
    .slice(0, DAILY_LIMIT);

  return {
    sender_email: payload.sender_email || settings.sender_email || SENDER_EMAIL,
    daily_limit: Math.min(DAILY_LIMIT, Math.max(1, toNumber(payload.daily_limit ?? automation.daily_limit, DAILY_LIMIT))),
    automation: {
      enabled: toBoolean(
        payload.enabled ?? automation.enabled,
        false
      ) && toBoolean(payload.auto_send ?? automation.auto_send, true)
        && !toBoolean(payload.paused ?? automation.paused, false),
      daily_limit: Math.min(DAILY_LIMIT, Math.max(1, toNumber(payload.daily_limit ?? automation.daily_limit, DAILY_LIMIT))),
      send_window_start: normalizeTime(
        payload.send_window_start ?? automation.send_window_start ?? automation.start_time,
        EMPTY_AUTOMATION_FORM.send_window_start
      ),
      send_window_end: normalizeTime(
        payload.send_window_end ?? automation.send_window_end ?? automation.end_time,
        EMPTY_AUTOMATION_FORM.send_window_end
      ),
      send_interval_minutes: Math.min(60, Math.max(5, toNumber(
        payload.send_interval_minutes ?? automation.send_interval_minutes ?? automation.interval_minutes,
        EMPTY_AUTOMATION_FORM.send_interval_minutes
      ))),
      workdays: normalizeWorkdays(payload.workdays ?? automation.workdays ?? automation.workdays_json),
      report_enabled: toBoolean(
        payload.report_enabled ?? automation.report_enabled ?? automation.daily_report_enabled,
        EMPTY_AUTOMATION_FORM.report_enabled
      ),
      report_time: normalizeTime(
        payload.report_time ?? automation.report_time ?? automation.daily_report_time,
        EMPTY_AUTOMATION_FORM.report_time
      ),
      report_recipient: payload.report_recipient
        || automation.report_recipient
        || automation.report_email
        || DEFAULT_REPORT_RECIPIENT,
    },
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

function automationFormFromState(state) {
  const automation = state?.automation || {};
  const workdays = normalizeWorkdays(automation.workdays);
  return {
    enabled: Boolean(automation.enabled),
    daily_limit: automation.daily_limit || DAILY_LIMIT,
    send_window_start: automation.send_window_start || EMPTY_AUTOMATION_FORM.send_window_start,
    send_window_end: automation.send_window_end || EMPTY_AUTOMATION_FORM.send_window_end,
    send_interval_minutes: automation.send_interval_minutes || EMPTY_AUTOMATION_FORM.send_interval_minutes,
    workdays_only: !workdays.includes(0) && !workdays.includes(6),
    report_enabled: automation.report_enabled !== false,
    report_time: automation.report_time || EMPTY_AUTOMATION_FORM.report_time,
    report_recipient: automation.report_recipient || DEFAULT_REPORT_RECIPIENT,
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
  if (status === 'SCHEDULED') return 'blue';
  if (status === 'APPROVED') return 'green';
  return 'yellow';
}

function isCandidateApproved(candidate) {
  return candidate?.status === 'APPROVED';
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
  const [automationForm, setAutomationForm] = useState(EMPTY_AUTOMATION_FORM);
  const [draftAttachment, setDraftAttachment] = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sendSummary, setSendSummary] = useState(null);

  const applyState = useCallback((result, { syncForm = false, syncAutomation = syncForm } = {}) => {
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
    if (syncAutomation) setAutomationForm(automationFormFromState(normalized));
    return normalized;
  }, []);

  const load = useCallback(async ({ syncForm = true, syncAutomation = syncForm, showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const result = await commercialApi.getMailAutomation(brandCode);
      return applyState(result, { syncForm, syncAutomation });
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
    () => candidates.filter((candidate) => !['SENDING', 'SCHEDULED'].includes(candidate.status)),
    [candidates]
  );
  const selectedCount = selectableCandidates.filter((candidate) => selectedIds.has(candidate.id)).length;
  const selectedCandidateIds = selectableCandidates
    .filter((candidate) => selectedIds.has(candidate.id))
    .map((candidate) => candidate.account_id);
  const selectedPendingCandidateIds = selectableCandidates
    .filter((candidate) => selectedIds.has(candidate.id) && !isCandidateApproved(candidate))
    .map((candidate) => candidate.account_id);
  const pendingCount = candidates.filter((candidate) => (
    !isCandidateApproved(candidate) && !['SENDING', 'SCHEDULED'].includes(candidate.status)
  )).length;
  const approvedCount = candidates.filter(isCandidateApproved).length;
  const selectedApprovedCandidates = selectableCandidates.filter(
    (candidate) => selectedIds.has(candidate.id) && isCandidateApproved(candidate)
  );
  const selectedApprovedCount = selectedApprovedCandidates.length;
  const allSelected = selectableCandidates.length > 0 && selectedCount === selectableCandidates.length;
  const partlySelected = selectedCount > 0 && !allSelected;
  const isDeciding = busy.startsWith('decision:');
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

  const saveAutomation = async () => {
    const dailyLimit = Number(automationForm.daily_limit);
    const interval = Number(automationForm.send_interval_minutes);
    const startMinutes = timeToMinutes(automationForm.send_window_start);
    const endMinutes = timeToMinutes(automationForm.send_window_end);
    const reportMinutes = timeToMinutes(automationForm.report_time);
    const reportRecipient = automationForm.report_recipient.trim();

    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > DAILY_LIMIT) {
      setError('Broj komitenata dnevno mora biti između 1 i 30.');
      return;
    }
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      setError('Vrijeme početka mora biti prije vremena završetka slanja.');
      return;
    }
    if (!Number.isInteger(interval) || interval < 5 || interval > 60) {
      setError('Razmak poruka mora biti između 5 i 60 minuta.');
      return;
    }
    if (((dailyLimit - 1) * interval) > (endMinutes - startMinutes)) {
      setError('Odabrani broj komitenata i razmak poruka ne mogu stati u zadani period slanja.');
      return;
    }
    if (automationForm.report_enabled && (reportMinutes === null || reportMinutes < endMinutes)) {
      setError('Vrijeme izvještaja mora biti nakon završetka slanja.');
      return;
    }
    if (automationForm.report_enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(reportRecipient)) {
      setError('Unesite ispravnu email adresu primaoca izvještaja.');
      return;
    }

    setBusy('automation');
    setError('');
    try {
      const payload = {
        enabled: automationForm.enabled,
        auto_send: automationForm.enabled,
        daily_limit: dailyLimit,
        send_window_start: automationForm.send_window_start,
        send_window_end: automationForm.send_window_end,
        send_interval_minutes: interval,
        workdays: automationForm.workdays_only ? DEFAULT_WORKDAYS : ALL_DAYS,
        report_enabled: automationForm.report_enabled,
        report_time: automationForm.report_time,
        report_recipient: reportRecipient || DEFAULT_REPORT_RECIPIENT,
      };
      await commercialApi.updateMailAutomation(brandCode, payload);
      await load({ syncForm: false, syncAutomation: true, showSpinner: false });
      toast({
        title: automationForm.enabled ? `Automatsko slanje za ${brandName} je uključeno.` : `Automatsko slanje za ${brandName} je pauzirano.`,
        description: automationForm.enabled
          ? `Mailovi se šalju sa ${SENDER_EMAIL} prema sačuvanoj satnici.`
          : 'Nova automatska slanja su odmah zaustavljena.',
        status: 'success',
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Parametri automatskog slanja nisu sačuvani.');
    } finally {
      setBusy('');
    }
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

  const decideCandidates = async (accountIds, decision, source = 'batch') => {
    const ids = [...new Set(accountIds.map(String))]
      .filter((id) => selectableCandidates.some((candidate) => candidate.account_id === id));
    if (!canManage || !ids.length || !['APPROVED', 'REJECTED'].includes(decision)) return;

    setBusy(`decision:${decision}:${source}`);
    setError('');
    try {
      const result = await commercialApi.decideMailAutomationCandidates(brandCode, ids, decision);
      if (result) applyState(result);
      else await load({ syncForm: false, showSpinner: false });
      toast({
        title: decision === 'APPROVED'
          ? `${ids.length} ${ids.length === 1 ? 'kandidat je odobren' : 'kandidata je odobreno'}.`
          : `${ids.length} ${ids.length === 1 ? 'kandidat nije odobren' : 'kandidata nije odobreno'} za danas.`,
        description: decision === 'APPROVED'
          ? 'Spremno za raspored ili ručno slanje. Nijedan mail još nije poslan.'
          : 'Uklonjeno samo iz današnjeg reda. Komitenti ostaju u CRM bazi.',
        status: decision === 'APPROVED' ? 'success' : 'info',
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Odluku za označene kandidate nije moguće sačuvati.');
    } finally {
      setBusy('');
    }
  };

  const sendSelected = async () => {
    const selectedCandidates = selectedApprovedCandidates.slice(0, DAILY_LIMIT);
    if (!selectedCandidates.length) return;

    const confirmed = window.confirm(
      `Zakazati ${selectedCandidates.length} ${selectedCandidates.length === 1 ? 'odobreni mail' : 'odobrenih mailova'} za ${brandName} sa ${SENDER_EMAIL}? Server će poslati jednu poruku svakih 5 minuta; browser ne mora ostati otvoren.`
    );
    if (!confirmed) return;

    setBusy('send');
    setError('');
    setSendSummary(null);
    try {
      const result = await commercialApi.scheduleSelectedMailAutomation(
        brandCode,
        selectedCandidates.map((candidate) => candidate.account_id)
      );
      const schedule = result?.schedule || {};
      const scheduledCount = toNumber(schedule.scheduled_count);
      const alreadyScheduledCount = toNumber(schedule.already_scheduled_count);
      const rejectedCount = toNumber(schedule.rejected_count);

      setSelectedIds(new Set());
      if (result) applyState(result);
      else await load({ syncForm: false, showSpinner: false });
      onChanged?.();
      setSendSummary({ scheduled: scheduledCount + alreadyScheduledCount, rejected: rejectedCount });
      toast({
        title: `Zakazano: ${scheduledCount + alreadyScheduledCount}.`,
        description: rejectedCount
          ? `Preskočeno: ${rejectedCount}. Ostale poruke server šalje jednu po jednu svakih 5 minuta.`
          : 'Server šalje jednu poruku svakih 5 minuta. Browser možete zatvoriti.',
        status: rejectedCount ? 'warning' : 'success',
        duration: 6000,
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Označene mailove nije moguće zakazati.');
      await load({ syncForm: false, showSpinner: false });
      onChanged?.();
    } finally {
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
                <Alert status={sendSummary.rejected ? 'warning' : 'success'} borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription>
                    Zakazano {sendSummary.scheduled}, preskočeno {sendSummary.rejected}. Server šalje jednu poruku svakih 5 minuta.
                  </AlertDescription>
                </Alert>
              )}

              {canManage && (
                <Box
                  as="section"
                  aria-labelledby="automatic-send-heading"
                  data-testid="automatic-send-settings"
                  data-mobile-layout="stacked"
                  border="1px solid"
                  borderColor={automationForm.enabled ? 'green.300' : 'gray.300'}
                  bg={automationForm.enabled ? 'green.50' : 'gray.50'}
                  borderRadius="xl"
                  p={{ base: 4, md: 5 }}
                >
                  <Flex
                    align={{ base: 'stretch', md: 'center' }}
                    justify="space-between"
                    direction={{ base: 'column', md: 'row' }}
                    gap={4}
                    mb={5}
                  >
                    <Box>
                      <HStack flexWrap="wrap">
                        <Heading id="automatic-send-heading" size="sm">Automatsko slanje</Heading>
                        <Badge colorScheme={automationForm.enabled ? 'green' : 'gray'}>
                          {automationForm.enabled ? 'UKLJUČENO' : 'PAUZIRANO'}
                        </Badge>
                      </HStack>
                      <Text mt={1} fontSize="sm" color="gray.600">
                        Sve poruke se šalju sa <Text as="span" fontWeight="bold">{SENDER_EMAIL}</Text>.
                      </Text>
                    </Box>
                    <FormControl
                      display="flex"
                      alignItems="center"
                      justifyContent={{ base: 'space-between', md: 'flex-end' }}
                      minH="44px"
                      w={{ base: 'full', md: 'auto' }}
                    >
                      <FormLabel htmlFor="automatic-send-enabled" mb="0" mr={3} fontWeight="semibold">
                        Uključi automatsko slanje
                      </FormLabel>
                      <Switch
                        id="automatic-send-enabled"
                        aria-label="Uključi automatsko slanje"
                        colorScheme="green"
                        size="lg"
                        isChecked={automationForm.enabled}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, enabled: event.target.checked }))}
                      />
                    </FormControl>
                  </Flex>

                  <SimpleGrid data-testid="automation-schedule-grid" columns={{ base: 1, sm: 2, xl: 4 }} spacing={4}>
                    <FormControl isRequired>
                      <FormLabel htmlFor="automation-daily-limit">Komitenata dnevno</FormLabel>
                      <Input
                        id="automation-daily-limit"
                        aria-label="Komitenata dnevno"
                        minH="44px"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={DAILY_LIMIT}
                        value={automationForm.daily_limit}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, daily_limit: event.target.value }))}
                      />
                      <Text mt={1} fontSize="xs" color="gray.500">Od 1 do 30.</Text>
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel htmlFor="automation-window-start">Početak slanja</FormLabel>
                      <Input
                        id="automation-window-start"
                        aria-label="Početak slanja"
                        minH="44px"
                        type="time"
                        value={automationForm.send_window_start}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, send_window_start: event.target.value }))}
                      />
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel htmlFor="automation-window-end">Kraj slanja</FormLabel>
                      <Input
                        id="automation-window-end"
                        aria-label="Kraj slanja"
                        minH="44px"
                        type="time"
                        value={automationForm.send_window_end}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, send_window_end: event.target.value }))}
                      />
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel htmlFor="automation-send-interval">Razmak poruka (min)</FormLabel>
                      <Input
                        id="automation-send-interval"
                        aria-label="Razmak poruka (min)"
                        minH="44px"
                        type="number"
                        inputMode="numeric"
                        min={5}
                        max={60}
                        value={automationForm.send_interval_minutes}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, send_interval_minutes: event.target.value }))}
                      />
                      <Text mt={1} fontSize="xs" color="gray.500">Od 5 do 60 minuta.</Text>
                    </FormControl>
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4} mt={5}>
                    <Box border="1px solid" borderColor="gray.200" bg="white" borderRadius="lg" p={4}>
                      <FormControl display="flex" alignItems="center" justifyContent="space-between" minH="44px">
                        <FormLabel htmlFor="automation-workdays-only" mb="0" pr={3}>Samo radnim danima</FormLabel>
                        <Switch
                          id="automation-workdays-only"
                          aria-label="Samo radnim danima"
                          colorScheme="blue"
                          isChecked={automationForm.workdays_only}
                          onChange={(event) => setAutomationForm((current) => ({ ...current, workdays_only: event.target.checked }))}
                        />
                      </FormControl>
                      <Text mt={1} fontSize="xs" color="gray.500">
                        {automationForm.workdays_only ? 'Slanje od ponedjeljka do petka.' : 'Slanje svim danima u sedmici.'}
                      </Text>
                    </Box>

                    <Box border="1px solid" borderColor="gray.200" bg="white" borderRadius="lg" p={4}>
                      <FormControl display="flex" alignItems="center" justifyContent="space-between" minH="44px">
                        <FormLabel htmlFor="automation-report-enabled" mb="0" pr={3}>Dnevni izvještaj</FormLabel>
                        <Switch
                          id="automation-report-enabled"
                          aria-label="Dnevni izvještaj"
                          colorScheme="blue"
                          isChecked={automationForm.report_enabled}
                          onChange={(event) => setAutomationForm((current) => ({ ...current, report_enabled: event.target.checked }))}
                        />
                      </FormControl>
                      <Text mt={1} fontSize="xs" color="gray.500">Izvještaj se šalje nakon završetka dnevnog perioda.</Text>
                    </Box>
                  </SimpleGrid>

                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mt={4}>
                    <FormControl isRequired={automationForm.report_enabled} isDisabled={!automationForm.report_enabled}>
                      <FormLabel htmlFor="automation-report-time">Vrijeme izvještaja</FormLabel>
                      <Input
                        id="automation-report-time"
                        aria-label="Vrijeme izvještaja"
                        minH="44px"
                        type="time"
                        value={automationForm.report_time}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, report_time: event.target.value }))}
                      />
                    </FormControl>
                    <FormControl isRequired={automationForm.report_enabled} isDisabled={!automationForm.report_enabled}>
                      <FormLabel htmlFor="automation-report-recipient">Primalac izvještaja</FormLabel>
                      <Input
                        id="automation-report-recipient"
                        aria-label="Primalac izvještaja"
                        minH="44px"
                        type="email"
                        value={automationForm.report_recipient}
                        onChange={(event) => setAutomationForm((current) => ({ ...current, report_recipient: event.target.value }))}
                      />
                    </FormControl>
                  </SimpleGrid>

                  <Alert status={automationForm.enabled ? 'success' : 'info'} variant="left-accent" borderRadius="lg" mt={5}>
                    <AlertIcon />
                    <AlertDescription fontSize="sm">
                      {automationForm.enabled
                        ? 'Automatizacija koristi sačuvanu formu i šalje isključivo kandidate koje si označio kao ODOBRENO.'
                        : 'Kada sačuvaš pauzirano stanje, odmah se zaustavljaju sva nova automatska slanja. Ručno slanje ispod ostaje dostupno.'}
                    </AlertDescription>
                  </Alert>

                  <Button
                    mt={4}
                    minH="44px"
                    w={{ base: 'full', md: 'auto' }}
                    colorScheme={automationForm.enabled ? 'green' : 'gray'}
                    leftIcon={<FaSave />}
                    isLoading={busy === 'automation'}
                    loadingText="Spremanje"
                    onClick={saveAutomation}
                  >
                    Sačuvaj automatsko slanje
                  </Button>
                </Box>
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

              <Box as="section" aria-labelledby="candidate-review-heading">
                <Flex align={{ base: 'stretch', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
                  <Box>
                    <HStack flexWrap="wrap" spacing={2}>
                      <Heading id="candidate-review-heading" size="sm">Brzi pregled kandidata</Heading>
                      <Badge colorScheme="yellow" px={2} py={1} borderRadius="md">ČEKA ODLUKU {pendingCount}</Badge>
                      <Badge colorScheme="green" px={2} py={1} borderRadius="md">ODOBRENO {approvedCount}</Badge>
                    </HStack>
                    <Text fontSize="sm" color="gray.600" mt={1}>
                      Odobrenje samo priprema mail za raspored. Mail se ne šalje klikom na „Odobri“.
                    </Text>
                  </Box>
                  {canManage && (
                    <Flex gap={2} direction={{ base: 'column', sm: 'row' }}>
                      <Button minH="44px" leftIcon={<FaRedo />} variant="outline" isLoading={busy === 'prepare'} onClick={prepareCandidates}>Pripremi / dopuni do 30</Button>
                      <Button minH="44px" variant="ghost" isLoading={busy === 'refresh'} onClick={refreshCandidates}>Osvježi</Button>
                    </Flex>
                  )}
                </Flex>

                <Alert status="info" variant="left-accent" borderRadius="xl" mt={4}>
                  <AlertIcon />
                  <AlertDescription fontSize="sm">
                    Označi više kandidata pa ih odobri jednim klikom. „Ne odobri“ uklanja samo današnji prijedlog — komitent ostaje u CRM bazi i može se predložiti drugi dan.
                  </AlertDescription>
                </Alert>

                {candidates.length === 0 ? (
                  <Alert status="info" borderRadius="xl" mt={4}><AlertIcon /><AlertDescription>Nema pripremljenih kandidata. Klikni „Pripremi / dopuni do 30“ za današnju listu poznatih mail adresa.</AlertDescription></Alert>
                ) : (
                  <VStack align="stretch" spacing={4} mt={4}>
                    <Box
                      position={{ base: 'static', md: 'sticky' }}
                      top="80px"
                      zIndex={2}
                      p={{ base: 4, md: 3 }}
                      bg="white"
                      border="1px solid"
                      borderColor="blue.200"
                      boxShadow="sm"
                      borderRadius="xl"
                    >
                      <Flex align={{ base: 'stretch', lg: 'center' }} justify="space-between" direction={{ base: 'column', lg: 'row' }} gap={3}>
                        <Checkbox
                          aria-label="Označi sve kandidate"
                          minH="44px"
                          isChecked={allSelected}
                          isIndeterminate={partlySelected}
                          onChange={toggleAll}
                        >
                          <Text fontWeight="semibold">Označi sve ({selectableCandidates.length})</Text>
                        </Checkbox>
                        <Flex gap={2} direction={{ base: 'column', sm: 'row' }} flexWrap="wrap">
                          <Button
                            minH="46px"
                            leftIcon={<FaCheck />}
                            colorScheme="green"
                            isDisabled={!canManage || selectedPendingCandidateIds.length === 0 || isDeciding}
                            isLoading={busy === 'decision:APPROVED:batch'}
                            loadingText="Odobravanje"
                            onClick={() => decideCandidates(selectedPendingCandidateIds, 'APPROVED')}
                          >
                            Odobri označene ({selectedPendingCandidateIds.length})
                          </Button>
                          <Button
                            minH="46px"
                            leftIcon={<FaTimes />}
                            colorScheme="red"
                            variant="outline"
                            isDisabled={!canManage || selectedCandidateIds.length === 0 || isDeciding}
                            isLoading={busy === 'decision:REJECTED:batch'}
                            loadingText="Spremanje"
                            onClick={() => decideCandidates(selectedCandidateIds, 'REJECTED')}
                          >
                            Ne odobri označene ({selectedCount})
                          </Button>
                          <Button
                            minH="46px"
                            leftIcon={<FaPaperPlane />}
                            colorScheme="orange"
                            isDisabled={!canManage || selectedApprovedCount === 0 || !hasSavedTemplate || isDeciding}
                            isLoading={busy === 'send'}
                            loadingText="Zakazujem"
                            onClick={sendSelected}
                          >
                            Zakaži odobrene ({selectedApprovedCount})
                          </Button>
                        </Flex>
                      </Flex>
                    </Box>

                    {!hasSavedTemplate && <Alert status="warning" borderRadius="lg"><AlertIcon /><AlertDescription>Prvo sačuvaj naslov i sadržaj maila za {brandName}.</AlertDescription></Alert>}

                    <TableContainer display={{ base: 'none', md: 'block' }} border="1px solid" borderColor="gray.200" borderRadius="xl" overflowX="auto">
                      <Table size="sm">
                        <Thead bg="gray.50">
                          <Tr><Th w="54px">Izbor</Th><Th>Komitent i mail</Th><Th>Odluka</Th><Th minW="260px">Brza odluka</Th></Tr>
                        </Thead>
                        <Tbody>
                          {candidates.map((candidate) => {
                            const disabled = ['SENDING', 'SCHEDULED'].includes(candidate.status);
                            const approved = isCandidateApproved(candidate);
                            const selected = selectedIds.has(candidate.id);
                            return (
                              <Tr key={candidate.id} bg={selected ? 'orange.50' : approved ? 'green.50' : 'white'} _hover={{ bg: selected ? 'orange.100' : approved ? 'green.100' : 'gray.50' }}>
                                <Td>
                                  <Checkbox aria-label={`Odaberi ${candidate.name}`} size="lg" isChecked={selected} isDisabled={disabled || isDeciding} onChange={() => toggleCandidate(candidate.id)} />
                                </Td>
                                <Td maxW="420px" py={4}>
                                  <Text fontWeight="bold" whiteSpace="normal" overflowWrap="anywhere">{candidate.name}</Text>
                                  <Text mt={1} fontSize="sm" color="gray.600" whiteSpace="normal" overflowWrap="anywhere">{candidate.email || 'Nema mail adrese'}</Text>
                                  {candidate.cc_emails.length > 0 && <Text mt={1} fontSize="xs" color="blue.600" whiteSpace="normal" overflowWrap="anywhere">CC: {candidate.cc_emails.join(', ')}</Text>}
                                  {candidate.comment && <Text mt={1} fontSize="xs" color="gray.500" whiteSpace="normal" noOfLines={2}>{candidate.comment}</Text>}
                                </Td>
                                <Td py={4}>
                                  <Badge colorScheme={candidateStatusColor(candidate.status)} px={2} py={1} borderRadius="md">{STATUS_LABELS[candidate.status] || candidate.status}</Badge>
                                  {candidate.last_error && <Text mt={2} fontSize="xs" color="red.600" whiteSpace="normal">{candidate.last_error}</Text>}
                                </Td>
                                <Td py={3}>
                                  <VStack align="stretch" spacing={1}>
                                    <HStack spacing={2}>
                                      <Button
                                        aria-label={`Odobri ${candidate.name}`}
                                        minH="42px"
                                        minW="108px"
                                        leftIcon={<FaCheck />}
                                        colorScheme="green"
                                        variant={approved ? 'solid' : 'outline'}
                                        isDisabled={disabled || approved || isDeciding}
                                        isLoading={busy === `decision:APPROVED:${candidate.id}`}
                                        onClick={() => decideCandidates([candidate.account_id], 'APPROVED', candidate.id)}
                                      >
                                        {approved ? 'Odobreno' : 'Odobri'}
                                      </Button>
                                      <Button
                                        aria-label={`Ne odobri ${candidate.name}`}
                                        minH="42px"
                                        minW="112px"
                                        leftIcon={<FaTimes />}
                                        colorScheme="red"
                                        variant="outline"
                                        isDisabled={disabled || isDeciding}
                                        isLoading={busy === `decision:REJECTED:${candidate.id}`}
                                        onClick={() => decideCandidates([candidate.account_id], 'REJECTED', candidate.id)}
                                      >
                                        Ne odobri
                                      </Button>
                                    </HStack>
                                    <MailRecipientsEditor
                                      brandCode={brandCode}
                                      accountId={candidate.account_id}
                                      toEmail={candidate.email}
                                      ccEmails={candidate.cc_emails}
                                      requiresReapproval={candidate.status === 'APPROVED'}
                                      onSaved={(result) => result ? applyState(result) : load({ syncForm: false, showSpinner: false })}
                                      triggerProps={{ 'aria-label': `Uredi primaoce za ${candidate.name}`, size: 'sm', alignSelf: 'flex-start', px: 1 }}
                                    />
                                  </VStack>
                                </Td>
                              </Tr>
                            );
                          })}
                        </Tbody>
                      </Table>
                    </TableContainer>

                    <VStack display={{ base: 'flex', md: 'none' }} align="stretch" spacing={3}>
                      {candidates.map((candidate) => {
                        const disabled = ['SENDING', 'SCHEDULED'].includes(candidate.status);
                        const approved = isCandidateApproved(candidate);
                        const selected = selectedIds.has(candidate.id);
                        return (
                          <Box
                            key={candidate.id}
                            border="1px solid"
                            borderColor={selected ? 'orange.300' : approved ? 'green.300' : 'gray.200'}
                            borderRadius="2xl"
                            p={4}
                            bg={selected ? 'orange.50' : approved ? 'green.50' : 'white'}
                            boxShadow="sm"
                          >
                            <Flex align="flex-start" justify="space-between" gap={3}>
                              <Checkbox aria-label={`Odaberi ${candidate.name}`} size="lg" isChecked={selected} isDisabled={disabled || isDeciding} onChange={() => toggleCandidate(candidate.id)}>
                                <Text fontWeight="bold" pr={2} overflowWrap="anywhere">{candidate.name}</Text>
                              </Checkbox>
                              <Badge flexShrink={0} colorScheme={candidateStatusColor(candidate.status)} px={2} py={1} borderRadius="md">{STATUS_LABELS[candidate.status] || candidate.status}</Badge>
                            </Flex>
                            <Text mt={3} fontSize="sm" color="gray.700" overflowWrap="anywhere">{candidate.email || 'Nema mail adrese'}</Text>
                            {candidate.cc_emails.length > 0 && <Text mt={1} fontSize="xs" color="blue.600" overflowWrap="anywhere">CC: {candidate.cc_emails.join(', ')}</Text>}
                            {candidate.comment && <Text mt={2} fontSize="xs" color="gray.500">{candidate.comment}</Text>}
                            {candidate.last_error && <Text mt={2} fontSize="xs" color="red.600">{candidate.last_error}</Text>}
                            <SimpleGrid columns={2} spacing={2} mt={4}>
                              <Button
                                aria-label={`Odobri ${candidate.name}`}
                                minH="48px"
                                leftIcon={<FaCheck />}
                                colorScheme="green"
                                variant={approved ? 'solid' : 'outline'}
                                isDisabled={disabled || approved || isDeciding}
                                isLoading={busy === `decision:APPROVED:${candidate.id}`}
                                onClick={() => decideCandidates([candidate.account_id], 'APPROVED', candidate.id)}
                              >
                                {approved ? 'Odobreno' : 'Odobri'}
                              </Button>
                              <Button
                                aria-label={`Ne odobri ${candidate.name}`}
                                minH="48px"
                                leftIcon={<FaTimes />}
                                colorScheme="red"
                                variant="outline"
                                isDisabled={disabled || isDeciding}
                                isLoading={busy === `decision:REJECTED:${candidate.id}`}
                                onClick={() => decideCandidates([candidate.account_id], 'REJECTED', candidate.id)}
                              >
                                Ne odobri
                              </Button>
                            </SimpleGrid>
                            <MailRecipientsEditor
                              brandCode={brandCode}
                              accountId={candidate.account_id}
                              toEmail={candidate.email}
                              ccEmails={candidate.cc_emails}
                              requiresReapproval={candidate.status === 'APPROVED'}
                              onSaved={(result) => result ? applyState(result) : load({ syncForm: false, showSpinner: false })}
                              triggerProps={{ 'aria-label': `Uredi primaoce za ${candidate.name}`, w: 'full', minH: '44px', mt: 2 }}
                            />
                          </Box>
                        );
                      })}
                    </VStack>
                  </VStack>
                )}
              </Box>
            </VStack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
