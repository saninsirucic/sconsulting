import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Icon,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Spinner,
  Stat,
  StatLabel,
  StatNumber,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  useDisclosure,
  useToast,
  VStack,
} from '@chakra-ui/react';
import {
  FaBuilding,
  FaCalendarCheck,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaEdit,
  FaEnvelope,
  FaExchangeAlt,
  FaFilePdf,
  FaPaperPlane,
  FaPlus,
  FaRedo,
  FaSearch,
  FaTrash,
  FaUsers,
} from 'react-icons/fa';
import { commercialApi } from './commercial/api';
import CommercialMailAutomation from './commercial/CommercialMailAutomation';
import { downloadLetterReportPdf } from './commercial/letterReportPdf';
import MailRecipientsEditor, { normalizeCcEmails } from './commercial/MailRecipientsEditor';
import {
  BRAND_DEFINITIONS,
  CRM_STATUSES,
  EDIT_FIELDS,
  PRIORITIES,
  displayStatus,
  normalizeBrandCode,
  recordValue,
} from './commercial/schema';

const orange = '#f68b1f';
const green = '#1dba5b';
const EMAIL_IN_TEXT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function singleEmailInText(value) {
  const emails = [...new Set((String(value || '').match(EMAIL_IN_TEXT_PATTERN) || [])
    .map((email) => email.toLowerCase()))];
  return emails.length === 1 ? emails[0] : '';
}

function ErrorAlert({ message, onRetry }) {
  return (
    <Alert status="error" borderRadius="xl" alignItems={{ base: 'flex-start', sm: 'center' }} flexWrap="wrap" gap={2}>
      <AlertIcon />
      <AlertDescription flex="1" minW={{ base: 'calc(100% - 38px)', sm: 0 }}>{message}</AlertDescription>
      {onRetry && <Button w={{ base: 'full', sm: 'auto' }} minH="40px" size="sm" variant="outline" colorScheme="red" onClick={onRetry}>Pokušaj ponovo</Button>}
    </Alert>
  );
}

function Loading({ label = 'Učitavanje...' }) {
  return <Flex minH="180px" align="center" justify="center" gap={3} color="gray.600"><Spinner color={orange} /><Text>{label}</Text></Flex>;
}

function EmptyState({ title, text }) {
  return (
    <VStack py={12} spacing={3} textAlign="center" color="gray.500">
      <Flex boxSize="54px" borderRadius="full" align="center" justify="center" bg="orange.50" color={orange}><Icon as={FaBuilding} boxSize={6} /></Flex>
      <Heading size="sm" color="gray.700">{title}</Heading>
      <Text maxW="600px">{text}</Text>
    </VStack>
  );
}

function normalizeRecordForForm(record) {
  if (!record) return { status: 'NEW', priority: 'MEDIUM' };
  const nextContact = recordValue(record, 'next_contact_at', 'nextContactAt');
  const nextContactDate = nextContact ? new Date(nextContact) : null;
  const localNextContact = nextContactDate && !Number.isNaN(nextContactDate.getTime())
    ? new Date(nextContactDate.getTime() - nextContactDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : (nextContact ? String(nextContact).slice(0, 16) : '');
  return {
    ...record,
    company_name: recordValue(record, 'company_name', 'companyName', 'name', 'komitent'),
    email: recordValue(record, 'email'),
    status: recordValue(record, 'status', 'crm_status') || 'NEW',
    next_contact_at: localNextContact,
    raw_mail: recordValue(record, 'raw_mail', 'rawMail', 'mail'),
    raw_contact: recordValue(record, 'raw_contact', 'rawContact', 'contact', 'kontakt'),
    comment: recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar'),
  };
}

function RecordModal({ isOpen, onClose, record, brandCode, onSaved }) {
  const [form, setForm] = useState(() => normalizeRecordForForm(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const visibleFields = useMemo(() => {
    if (normalizeBrandCode(brandCode) !== 'VISIOCAST') return EDIT_FIELDS;
    return EDIT_FIELDS.filter((field) => !['unit_amount', 'total_amount', 'profit_amount'].includes(field.key));
  }, [brandCode]);

  useEffect(() => {
    setForm(normalizeRecordForForm(record));
    setError('');
  }, [isOpen, record]);

  const save = async () => {
    if (!String(form.company_name || '').trim()) return setError('Naziv komitenta je obavezan.');
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      const originalRawMail = String(recordValue(record, 'raw_mail', 'rawMail', 'mail') || '').trim();
      const currentRawMail = String(payload.raw_mail || '').trim();
      const originalEmail = String(recordValue(record, 'email') || '').trim().toLowerCase();
      const currentEmail = String(payload.email || '').trim().toLowerCase();
      const rawMailEmail = singleEmailInText(currentRawMail);
      if (rawMailEmail && (!currentEmail || (currentRawMail !== originalRawMail && currentEmail === originalEmail))) {
        payload.email = rawMailEmail;
      }
      payload.next_contact_at = payload.next_contact_at
        ? new Date(payload.next_contact_at).toISOString()
        : null;
      const saved = record?.id
        ? await commercialApi.updateRecord(record.id, payload)
        : await commercialApi.createRecord(brandCode, payload);
      onSaved(saved);
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'Zapis nije sačuvan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent
        m={{ base: 0, md: 8 }}
        minH={{ base: '100dvh', md: 'auto' }}
        maxH={{ base: '100dvh', md: 'calc(100vh - 4rem)' }}
        borderRadius={{ base: 0, md: 'md' }}
      >
        <ModalHeader px={{ base: 4, md: 6 }}>{record ? 'Uredi komitenta' : 'Novi komitent'}</ModalHeader>
        <ModalCloseButton minW="44px" minH="44px" />
        <ModalBody px={{ base: 4, md: 6 }}>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            {visibleFields.map((field) => (
              <FormControl key={field.key} isRequired={field.required} gridColumn={{ md: field.wide ? 'span 2' : 'auto' }}>
                <FormLabel fontSize="sm">{field.label}</FormLabel>
                {field.type === 'textarea' ? (
                  <Textarea minH={{ base: '88px', md: '80px' }} rows={field.rows || 3} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                ) : field.type === 'status' ? (
                  <Select minH={{ base: '44px', md: '40px' }} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                    {CRM_STATUSES.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}
                  </Select>
                ) : field.type === 'priority' ? (
                  <Select minH={{ base: '44px', md: '40px' }} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                    {PRIORITIES.map((priority) => <option key={priority} value={priority}>{displayStatus(priority)}</option>)}
                  </Select>
                ) : (
                  <Input minH={{ base: '44px', md: '40px' }} type={field.type || 'text'} step={field.step} isReadOnly={field.readOnly} bg={field.readOnly ? 'gray.50' : 'white'} value={form[field.key] ?? ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                )}
              </FormControl>
            ))}
          </SimpleGrid>
          {error && <Box mt={4}><ErrorAlert message={error} /></Box>}
        </ModalBody>
        <ModalFooter gap={3} px={{ base: 4, md: 6 }} pb={{ base: 'max(16px, env(safe-area-inset-bottom))', md: 4 }}>
          <Button flex={{ base: 1, md: 'initial' }} minH="44px" variant="ghost" onClick={onClose}>Odustani</Button>
          <Button flex={{ base: 1, md: 'initial' }} minH="44px" bg={green} color="white" _hover={{ bg: 'green.600' }} isLoading={saving} onClick={save}>Sačuvaj</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function TransferRecordModal({ isOpen, onClose, record, currentBrand, brands, onTransferred }) {
  const targets = useMemo(
    () => brands.filter((brand) => normalizeBrandCode(brand.code || brand.slug) !== normalizeBrandCode(currentBrand.code || currentBrand.slug)),
    [brands, currentBrand]
  );
  const [targetCode, setTargetCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Komitent';
  const selectedTarget = targets.find((brand) => normalizeBrandCode(brand.code || brand.slug) === normalizeBrandCode(targetCode));

  useEffect(() => {
    setTargetCode(targets[0]?.code || targets[0]?.slug || '');
    setError('');
  }, [isOpen, record, targets]);

  const transfer = async () => {
    if (!record?.id || !targetCode) return setError('Odaberite ciljnu bazu.');
    setSaving(true);
    setError('');
    try {
      const result = await commercialApi.transferRecord(record.id, targetCode);
      onTransferred(result, selectedTarget);
      onClose();
    } catch (requestError) {
      setError(requestError.message || 'Komitent nije prebačen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
      <ModalOverlay />
      <ModalContent m={{ base: 4, md: 8 }}>
        <ModalHeader>Prebaci komitenta</ModalHeader>
        <ModalCloseButton minW="44px" minH="44px" />
        <ModalBody>
          <Text fontWeight="semibold" overflowWrap="anywhere">{company}</Text>
          <Text mt={1} fontSize="sm" color="gray.600">Iz baze <strong>{currentBrand.name}</strong> u:</Text>
          <FormControl mt={5} isRequired>
            <FormLabel>Ciljna baza</FormLabel>
            <Select aria-label="Ciljna baza" minH="44px" value={targetCode} onChange={(event) => setTargetCode(event.target.value)}>
              {targets.map((brand) => <option key={brand.code || brand.slug} value={brand.code || brand.slug}>{brand.name}</option>)}
            </Select>
          </FormControl>
          <Box mt={4} p={3} borderRadius="lg" bg="orange.50" color="orange.800" fontSize="sm">
            Svi kontakti, status, prioritet i napomene ostaju sačuvani. Nedovršeni zadatak iz „Današnjih 30“ u staroj bazi bit će uklonjen.
          </Box>
          {error && <Box mt={4}><ErrorAlert message={error} /></Box>}
        </ModalBody>
        <ModalFooter gap={3}>
          <Button minH="44px" variant="ghost" onClick={onClose}>Odustani</Button>
          <Button minH="44px" colorScheme="orange" leftIcon={<FaExchangeAlt />} isLoading={saving} isDisabled={!targetCode} onClick={transfer}>
            Prebaci u {selectedTarget?.name || 'odabranu bazu'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function dailyAssignmentRecord(assignment) {
  return assignment.record || assignment.account || assignment.commercial_record || assignment;
}

function dailyAssignmentStatus(assignment) {
  return String(assignment.assignment_status || assignment.status || 'PENDING').toUpperCase();
}

function isDailyMailApproved(assignment) {
  return dailyAssignmentStatus(assignment) === 'APPROVED';
}

function isLegacyDailyCompleted(assignment) {
  return dailyAssignmentStatus(assignment) === 'COMPLETED';
}

function dailyAssignmentEmail(assignment) {
  const record = dailyAssignmentRecord(assignment);
  const email = String(recordValue(record, 'email', 'raw_mail', 'mail') || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) ? email : '';
}

function dailyMailQueueStatus(assignment) {
  return String(assignment.mail_queue_status || assignment.mail_status || assignment.campaign_status || '').toUpperCase();
}

function dailyAssignmentCcEmails(assignment) {
  const record = dailyAssignmentRecord(assignment);
  return normalizeCcEmails(assignment.cc_emails || assignment.ccEmails || record.cc_emails || record.ccEmails);
}

function dailyAssignmentAccountId(assignment) {
  const record = dailyAssignmentRecord(assignment);
  return record.id || assignment.account_id || assignment.accountId || assignment.crm_account_id;
}

function dailyAssignmentId(assignment) {
  return String(assignment.id || assignment.assignment_id || '').trim();
}

function isDailyBulkApprovable(assignment) {
  const status = dailyAssignmentStatus(assignment);
  const queueStatus = dailyMailQueueStatus(assignment);
  return Boolean(dailyAssignmentId(assignment))
    && Boolean(dailyAssignmentEmail(assignment))
    && !['APPROVED', 'COMPLETED', 'OBRADJEN', 'DONE', 'SKIPPED', 'SENT', 'SENDING'].includes(status)
    && !['SCHEDULED', 'SENT', 'SENDING', 'SKIPPED'].includes(queueStatus);
}

function hasSendableDailyMail(assignment) {
  const queueStatus = dailyMailQueueStatus(assignment);
  return Boolean(dailyAssignmentEmail(assignment))
    && !['SCHEDULED', 'SENT', 'SENDING', 'SKIPPED', 'NOT_APPROVED'].includes(queueStatus);
}

function dailyApprovalLabel(status) {
  if (status === 'APPROVED') return 'ODOBRENO';
  if (status === 'COMPLETED') return 'RANIJE OBRAĐENO';
  if (status === 'OBRADJEN') return 'OBRAĐENO';
  if (status === 'DONE') return 'ZAVRŠENO';
  if (status === 'SKIPPED') return 'PRESKOČENO';
  return 'ČEKA ODLUKU';
}

function dailyMailQueueLabel(status) {
  if (status === 'SENT') return 'MAIL POSLAN';
  if (status === 'SCHEDULED') return 'ZAKAZANO • SVAKIH 5 MIN';
  if (status === 'SENDING') return 'SLANJE U TOKU';
  if (status === 'FAILED') return 'SLANJE NIJE USPJELO';
  if (status === 'APPROVED') return 'SPREMNO ZA SLANJE';
  return '';
}

function DailyAssignmentRow({ assignment, brandCode, onUpdated, onRecipientsSaved, isSelected, onSelectionChange }) {
  const record = dailyAssignmentRecord(assignment);
  const assignmentId = assignment.id || assignment.assignment_id;
  const [notes, setNotes] = useState(assignment.notes || assignment.assignment_notes || '');
  const [working, setWorking] = useState('');
  const toast = useToast();
  const status = dailyAssignmentStatus(assignment);
  const approved = isDailyMailApproved(assignment);
  const legacyCompleted = isLegacyDailyCompleted(assignment);
  const selectable = isDailyBulkApprovable(assignment);
  const companyName = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';

  const update = async (nextStatus) => {
    setWorking(nextStatus);
    try {
      await commercialApi.updateDailyAssignment(assignmentId, { status: nextStatus, notes });
      toast({ title: nextStatus === 'APPROVED' ? 'Komitent je odobren za mail.' : 'Komitent je preskočen.', status: 'success', position: 'top-right' });
      onUpdated();
    } catch (error) {
      toast({ title: error.message, status: 'error', position: 'top-right' });
    } finally {
      setWorking('');
    }
  };

  return (
    <Tr bg={isSelected ? 'orange.50' : approved ? 'green.50' : legacyCompleted ? 'blue.50' : status === 'SKIPPED' ? 'gray.50' : 'white'}>
      <Td w="48px" pr={0}>
        <Checkbox
          aria-label={`Označi ${companyName} za odobrenje`}
          colorScheme="orange"
          isChecked={Boolean(isSelected)}
          isDisabled={!selectable}
          onChange={(event) => onSelectionChange(event.target.checked)}
        />
      </Td>
      <Td><Text fontWeight="semibold">{companyName}</Text><Text fontSize="xs" color="gray.500">{recordValue(record, 'city', 'address')}</Text></Td>
      <Td>
        <Text overflowWrap="anywhere">{recordValue(record, 'email', 'raw_mail', 'mail') || '—'}</Text>
        {dailyAssignmentCcEmails(assignment).length > 0 && <Text mt={1} fontSize="xs" color="blue.600" overflowWrap="anywhere">CC: {dailyAssignmentCcEmails(assignment).join(', ')}</Text>}
      </Td>
      <Td>
        <Badge colorScheme={approved ? 'green' : legacyCompleted ? 'blue' : status === 'SKIPPED' ? 'gray' : 'orange'}>{dailyApprovalLabel(status)}</Badge>
        {dailyMailQueueLabel(dailyMailQueueStatus(assignment)) && <Badge display="block" mt={1} w="fit-content" colorScheme={dailyMailQueueStatus(assignment) === 'FAILED' ? 'red' : 'blue'}>{dailyMailQueueLabel(dailyMailQueueStatus(assignment))}</Badge>}
      </Td>
      <Td minW="230px"><Input size="sm" aria-label="Napomena za dnevni kontakt" placeholder="Napomena" value={notes} onChange={(event) => setNotes(event.target.value)} /></Td>
      <Td>
        <VStack align="stretch" spacing={1}>
          <HStack>
            <Button size="sm" minH="40px" leftIcon={<FaCheck />} colorScheme="green" isDisabled={approved} isLoading={working === 'APPROVED'} onClick={() => update('APPROVED')}>{approved ? 'Odobreno' : 'Odobri za mail'}</Button>
            <Button size="sm" minH="40px" variant="outline" isDisabled={status === 'SKIPPED'} isLoading={working === 'SKIPPED'} onClick={() => update('SKIPPED')}>Preskoči</Button>
          </HStack>
          <MailRecipientsEditor
            brandCode={brandCode}
            accountId={dailyAssignmentAccountId(assignment)}
            toEmail={dailyAssignmentEmail(assignment)}
            ccEmails={dailyAssignmentCcEmails(assignment)}
            onSaved={onRecipientsSaved}
            triggerProps={{ 'aria-label': `Uredi primaoce za ${recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'komitenta'}`, size: 'sm', alignSelf: 'flex-start', px: 1 }}
          />
        </VStack>
      </Td>
    </Tr>
  );
}

function DailyAssignmentCard({ assignment, brandCode, onUpdated, onRecipientsSaved, isSelected, onSelectionChange }) {
  const record = dailyAssignmentRecord(assignment);
  const assignmentId = assignment.id || assignment.assignment_id;
  const [notes, setNotes] = useState(assignment.notes || assignment.assignment_notes || '');
  const [working, setWorking] = useState('');
  const toast = useToast();
  const status = dailyAssignmentStatus(assignment);
  const approved = isDailyMailApproved(assignment);
  const legacyCompleted = isLegacyDailyCompleted(assignment);
  const selectable = isDailyBulkApprovable(assignment);
  const companyName = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';
  const update = async (nextStatus) => {
    setWorking(nextStatus);
    try {
      await commercialApi.updateDailyAssignment(assignmentId, { status: nextStatus, notes });
      toast({ title: nextStatus === 'APPROVED' ? 'Komitent je odobren za mail.' : 'Komitent je preskočen.', status: 'success', position: 'top-right' });
      onUpdated();
    } catch (error) {
      toast({ title: error.message, status: 'error', position: 'top-right' });
    } finally {
      setWorking('');
    }
  };
  return (
    <Box border="2px solid" borderColor={isSelected ? 'orange.400' : approved ? 'green.200' : legacyCompleted ? 'blue.200' : 'orange.100'} bg={isSelected ? 'orange.50' : approved ? 'green.50' : legacyCompleted ? 'blue.50' : 'white'} borderRadius="xl" p={4}>
      <Flex justify="space-between" gap={3} align="start">
        <HStack align="start" spacing={3} minW={0}>
          <Checkbox
            mt={1}
            size="lg"
            aria-label={`Označi ${companyName} za odobrenje`}
            colorScheme="orange"
            isChecked={Boolean(isSelected)}
            isDisabled={!selectable}
            onChange={(event) => onSelectionChange(event.target.checked)}
          />
          <Box minW={0}><Text fontWeight="bold">{companyName}</Text><Text fontSize="xs" color="gray.500">{recordValue(record, 'city', 'address')}</Text>{selectable && <Text mt={1} fontSize="xs" color={isSelected ? 'orange.700' : 'gray.500'}>{isSelected ? 'Označeno za odobrenje' : 'Dodirnite kućicu za odabir'}</Text>}</Box>
        </HStack>
        <Badge flexShrink={0} colorScheme={approved ? 'green' : legacyCompleted ? 'blue' : status === 'SKIPPED' ? 'gray' : 'orange'}>{dailyApprovalLabel(status)}</Badge>
      </Flex>
      {dailyMailQueueLabel(dailyMailQueueStatus(assignment)) && <Badge mt={2} w="fit-content" colorScheme={dailyMailQueueStatus(assignment) === 'FAILED' ? 'red' : 'blue'}>{dailyMailQueueLabel(dailyMailQueueStatus(assignment))}</Badge>}
      <Text mt={2} fontSize="sm" overflowWrap="anywhere">{recordValue(record, 'email', 'raw_mail', 'mail') || 'Nema kontakta'}</Text>
      {dailyAssignmentCcEmails(assignment).length > 0 && <Text mt={1} fontSize="xs" color="blue.600" overflowWrap="anywhere">CC: {dailyAssignmentCcEmails(assignment).join(', ')}</Text>}
      <MailRecipientsEditor
        brandCode={brandCode}
        accountId={dailyAssignmentAccountId(assignment)}
        toEmail={dailyAssignmentEmail(assignment)}
        ccEmails={dailyAssignmentCcEmails(assignment)}
        onSaved={onRecipientsSaved}
        triggerProps={{ 'aria-label': `Uredi primaoce za ${recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'komitenta'}`, w: 'full', minH: '44px', mt: 2 }}
      />
      <Input mt={3} size="sm" aria-label="Napomena za dnevni kontakt" placeholder="Napomena" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <SimpleGrid columns={2} spacing={2} mt={3}>
        <Button minH="44px" size="sm" leftIcon={<FaCheck />} colorScheme="green" isDisabled={approved} isLoading={working === 'APPROVED'} onClick={() => update('APPROVED')}>{approved ? 'Odobreno' : 'Odobri za mail'}</Button>
        <Button minH="40px" size="sm" variant="outline" isDisabled={status === 'SKIPPED'} isLoading={working === 'SKIPPED'} onClick={() => update('SKIPPED')}>Preskoči</Button>
      </SimpleGrid>
    </Box>
  );
}

function DailyPanel({ brandCode, isOpen, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sendingMode, setSendingMode] = useState('');
  const [mailSummary, setMailSummary] = useState(null);
  const [sentAssignmentIds, setSentAssignmentIds] = useState(() => new Set());
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState(() => new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    try {
      let result = await commercialApi.getDailyList(brandCode);
      const currentItems = Array.isArray(result) ? result : result?.items || result?.assignments || [];
      if (currentItems.length === 0) {
        setCreating(true);
        result = await commercialApi.createDailyList(brandCode);
        onChanged();
      }
      setData(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCreating(false);
      setLoading(false);
    }
  }, [brandCode, isOpen, onChanged]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSentAssignmentIds(new Set());
    setSelectedAssignmentIds(new Set());
    setMailSummary(null);
  }, [brandCode]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      setData(await commercialApi.createDailyList(brandCode));
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCreating(false);
    }
  };

  const items = Array.isArray(data) ? data : data?.items || data?.assignments || [];
  const selectableAssignments = items.filter(isDailyBulkApprovable);
  const selectableAssignmentIds = selectableAssignments.map(dailyAssignmentId);
  const selectableAssignmentIdSet = new Set(selectableAssignmentIds);
  const selectedCount = selectedAssignmentIds.size;
  const allSelectableSelected = selectableAssignmentIds.length > 0 && selectableAssignmentIds.every((id) => selectedAssignmentIds.has(id));

  useEffect(() => {
    setSelectedAssignmentIds((current) => {
      const next = new Set([...current].filter((id) => selectableAssignmentIdSet.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  // The selected set is intentionally reconciled only when refreshed list data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const setAssignmentSelected = (assignmentId, checked) => {
    setSelectedAssignmentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(assignmentId);
      else next.delete(assignmentId);
      return next;
    });
  };

  const approveSelected = async () => {
    const assignmentIds = selectableAssignmentIds.filter((id) => selectedAssignmentIds.has(id));
    if (!assignmentIds.length) return;
    setBulkApproving(true);
    setError('');
    try {
      const result = await commercialApi.approveDailyAssignments(brandCode, assignmentIds);
      const updated = Number(result?.updated ?? assignmentIds.length);
      const unchanged = Number(result?.unchanged ?? 0);
      const rejected = Number(result?.rejected ?? Math.max(0, assignmentIds.length - updated - unchanged));
      setSelectedAssignmentIds(new Set());
      toast({
        title: `Odobreno: ${Math.max(0, updated + unchanged)} od ${assignmentIds.length}.`,
        description: rejected > 0 ? `Preskočeno: ${rejected} — podaci ili status su se u međuvremenu promijenili.` : 'Mailovi još nisu poslani. Za slanje koristite zasebno zeleno dugme.',
        status: rejected > 0 ? 'warning' : 'success',
        position: 'top-right',
      });
      await load();
      onChanged();
    } catch (requestError) {
      setError(requestError.message || 'Označene komitente trenutno nije moguće odobriti.');
    } finally {
      setBulkApproving(false);
    }
  };

  const approved = items.filter(isDailyMailApproved);
  const legacyCompleted = items.filter(isLegacyDailyCompleted);
  const approvedCount = approved.length;
  const approvedWithoutEmail = approved.filter((item) => !dailyAssignmentEmail(item)).length;
  const readyAssignments = items.filter((item) => (
    isDailyMailApproved(item)
    && hasSendableDailyMail(item)
    && !sentAssignmentIds.has(String(item.id || item.assignment_id))
  ));
  const legacyReadyAssignments = items.filter((item) => (
    isLegacyDailyCompleted(item)
    && hasSendableDailyMail(item)
    && !sentAssignmentIds.has(String(item.id || item.assignment_id))
  ));
  const legacyWithoutEmail = legacyCompleted.filter((item) => !dailyAssignmentEmail(item)).length;

  const sendApproved = async (assignments, { includeLegacyCompleted = false } = {}) => {
    const assignmentIds = assignments.map((item) => String(item.id || item.assignment_id));
    if (!assignmentIds.length) return;
    const brandName = data?.brand?.name || brandCode;
    const confirmed = window.confirm(includeLegacyCompleted
      ? `Ovih ${assignmentIds.length} ${assignmentIds.length === 1 ? 'stari zeleni red' : 'starih zelenih redova'} bit će odobreno i zakazano. Server šalje jednu poruku svakih 5 minuta, a browser ne mora ostati otvoren. Nastaviti za ${brandName}?`
      : `Zakazati ${assignmentIds.length} ${assignmentIds.length === 1 ? 'odobreni mail' : 'odobrenih mailova'} za ${brandName}? Server šalje jednu poruku svakih 5 minuta i samo komitentima sa statusom ODOBRENO.`
    );
    if (!confirmed) return;

    setSendingMode(includeLegacyCompleted ? 'legacy' : 'approved');
    setMailSummary(null);
    setError('');
    try {
      const importResult = includeLegacyCompleted
        ? await commercialApi.importDailyApprovedMailAutomation(brandCode, assignmentIds, { includeLegacyCompleted: true })
        : await commercialApi.importDailyApprovedMailAutomation(brandCode, assignmentIds);
      const importMeta = importResult?.import || importResult?.data?.import || {};
      const accountIds = [...new Set(
        (importMeta.eligible_account_ids || importMeta.account_ids || []).map((id) => String(id || '').trim()).filter(Boolean)
      )];
      const importedAssignmentIds = (importMeta.eligible_assignment_ids || importMeta.assignment_ids || []).map(String);
      const skippedFromServer = Number(importMeta.skipped_count);
      const skipped = Number.isFinite(skippedFromServer)
        ? skippedFromServer
        : Math.max(0, assignmentIds.length - accountIds.length);

      if (!accountIds.length) {
        setMailSummary({ scheduled: 0, rejected: 0, skipped: Math.max(skipped, assignmentIds.length) });
        toast({
          title: 'Nema novih odobrenih mailova za zakazivanje.',
          description: 'Neodobreni, već poslani i komitenti bez ispravne email adrese su preskočeni.',
          status: 'info',
          position: 'top-right',
        });
        await load();
        return;
      }

      const scheduleResult = await commercialApi.scheduleSelectedMailAutomation(brandCode, accountIds);
      const schedule = scheduleResult?.schedule || {};
      const scheduled = Number(schedule.scheduled_count || 0) + Number(schedule.already_scheduled_count || 0);
      const rejected = Number(schedule.rejected_count || 0);
      setSentAssignmentIds((current) => new Set([
        ...current,
        ...(importedAssignmentIds.length ? importedAssignmentIds : assignmentIds)
      ]));
      setMailSummary({ scheduled, rejected, skipped });
      toast({
        title: `Zakazano: ${scheduled}.`,
        description: rejected || skipped
          ? `Preskočeno: ${rejected + skipped}. Ostale poruke server šalje svakih 5 minuta.`
          : 'Server šalje jednu poruku svakih 5 minuta. Browser možete zatvoriti.',
        status: rejected || skipped ? 'warning' : 'success',
        duration: 6000,
        position: 'top-right',
      });
      await load();
      onChanged();
    } catch (requestError) {
      setError(requestError.message || 'Odobrene mailove trenutno nije moguće zakazati.');
    } finally {
      setSendingMode('');
    }
  };

  return (
    <Collapse in={isOpen} animateOpacity>
      <Box mt={4} border="1px solid" borderColor="orange.200" bg="orange.50" borderRadius="xl" p={{ base: 4, md: 5 }}>
        <Flex justify="space-between" align={{ base: 'start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3} mb={4}>
          <Box>
            <HStack><Icon as={FaCalendarCheck} color={orange} /><Heading size="sm">Današnjih 30 komitenata</Heading></HStack>
            <Text fontSize="sm" color="gray.600" mt={1}>Lista se automatski priprema svaki dan, pamti odabir i sutra predlaže druge komitente.</Text>
          </Box>
          <Flex gap={2} direction={{ base: 'column', sm: 'row' }} flexWrap="wrap" w={{ base: 'full', md: 'auto' }}>
            {items.length > 0 && <Badge alignSelf={{ base: 'flex-start', sm: 'center' }} colorScheme="green" px={3} py={1}>{approvedCount} / {items.length} odobreno</Badge>}
            <Button
              minH="44px"
              w={{ base: 'full', sm: 'auto' }}
              leftIcon={<FaPaperPlane />}
              colorScheme="green"
              isDisabled={readyAssignments.length === 0 || Boolean(sendingMode)}
              isLoading={sendingMode === 'approved'}
              loadingText="Zakazujem"
              onClick={() => sendApproved(readyAssignments)}
            >
              Zakaži odobrene ({readyAssignments.length})
            </Button>
            <Button minH="44px" w={{ base: 'full', sm: 'auto' }} size="sm" leftIcon={items.length ? <FaRedo /> : <FaPlus />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} isLoading={creating} onClick={create}>{items.length ? 'Dopuni listu' : 'Pripremi današnju listu'}</Button>
          </Flex>
        </Flex>
        {items.length > 0 && (
          <Box mb={4} p={3} border="1px solid" borderColor="green.200" bg="green.50" borderRadius="lg">
            <Text fontSize="sm" color="green.800">
              Glavno dugme zakazuje isključivo komitente sa statusom <strong>ODOBRENO</strong>. Server zatim šalje jednu poruku svakih 5 minuta. Status „Ranije obrađeno“ se ovdje ne smatra odobrenjem za mail.
            </Text>
            {approvedWithoutEmail > 0 && <Text mt={1} fontSize="xs" color="orange.700">Odobreno bez ispravne glavne email adrese: {approvedWithoutEmail} — automatski se preskače.</Text>}
          </Box>
        )}
        {items.length > 0 && (
          <Flex mb={4} p={{ base: 3, md: 4 }} border="1px solid" borderColor="orange.200" bg="white" borderRadius="xl" align={{ base: 'stretch', md: 'center' }} justify="space-between" direction={{ base: 'column', md: 'row' }} gap={3}>
            <HStack spacing={3} flexWrap="wrap">
              <Checkbox
                minH="40px"
                colorScheme="orange"
                isChecked={allSelectableSelected}
                isIndeterminate={selectedCount > 0 && !allSelectableSelected}
                isDisabled={selectableAssignmentIds.length === 0 || bulkApproving}
                onChange={(event) => setSelectedAssignmentIds(event.target.checked ? new Set(selectableAssignmentIds) : new Set())}
              >
                Označi sve dostupne ({selectableAssignmentIds.length})
              </Checkbox>
              <Badge colorScheme={selectedCount ? 'orange' : 'gray'} px={3} py={1}>Označeno: {selectedCount}</Badge>
            </HStack>
            <Flex gap={2} direction={{ base: 'column', sm: 'row' }} w={{ base: 'full', md: 'auto' }}>
              <Button minH="44px" w={{ base: 'full', sm: 'auto' }} variant="ghost" isDisabled={selectedCount === 0 || bulkApproving} onClick={() => setSelectedAssignmentIds(new Set())}>Poništi odabir</Button>
              <Button minH="44px" w={{ base: 'full', sm: 'auto' }} leftIcon={<FaCheck />} colorScheme="orange" isDisabled={selectedCount === 0 || bulkApproving} isLoading={bulkApproving} loadingText="Odobravam" onClick={approveSelected}>Odobri označene ({selectedCount})</Button>
            </Flex>
          </Flex>
        )}
        {legacyCompleted.length > 0 && (
          <Box mb={4} p={3} border="1px solid" borderColor="blue.200" bg="blue.50" borderRadius="lg">
            <Flex align={{ base: 'stretch', md: 'center' }} justify="space-between" direction={{ base: 'column', md: 'row' }} gap={3}>
              <Box>
                <Text fontWeight="semibold" color="blue.800">Ranije označeni redovi iz stare verzije: {legacyCompleted.length}</Text>
                <Text mt={1} fontSize="sm" color="blue.700">Ovi redovi nisu automatski odobreni. Možete ih jednokratno i izričito potvrditi za zakazivanje.</Text>
                {legacyWithoutEmail > 0 && <Text mt={1} fontSize="xs" color="orange.700">Bez ispravne glavne email adrese: {legacyWithoutEmail} — neće biti poslano.</Text>}
              </Box>
              <Button
                minH="44px"
                flexShrink={0}
                leftIcon={<FaPaperPlane />}
                colorScheme="blue"
                variant="outline"
                isDisabled={legacyReadyAssignments.length === 0 || Boolean(sendingMode)}
                isLoading={sendingMode === 'legacy'}
                loadingText="Zakazujem"
                onClick={() => sendApproved(legacyReadyAssignments, { includeLegacyCompleted: true })}
              >
                Potvrdi i zakaži ranije označene ({legacyReadyAssignments.length})
              </Button>
            </Flex>
          </Box>
        )}
        {mailSummary && (
          <Alert status={mailSummary.rejected || mailSummary.skipped ? 'warning' : 'success'} borderRadius="lg" mb={4}>
            <AlertIcon />
            <AlertDescription>
              Zakazano {mailSummary.scheduled}, preskočeno {(mailSummary.rejected || 0) + (mailSummary.skipped || 0)}. Server šalje jednu poruku svakih 5 minuta.
            </AlertDescription>
          </Alert>
        )}
        {error && <ErrorAlert message={error} onRetry={load} />}
        {loading ? <Loading label="Učitavanje dnevne liste..." /> : items.length === 0 ? (
          <EmptyState title="Nema dostupnih komitenata za danas" text="Sistem je automatski pokušao pripremiti listu. Dodajte nove komitente ili provjerite da li su svi već raspoređeni." />
        ) : (
          <>
            <VStack display={{ base: 'flex', md: 'none' }} align="stretch" spacing={3}>
              {items.map((assignment) => {
                const assignmentId = dailyAssignmentId(assignment);
                return <DailyAssignmentCard key={assignmentId} assignment={assignment} brandCode={brandCode} isSelected={selectedAssignmentIds.has(assignmentId)} onSelectionChange={(checked) => setAssignmentSelected(assignmentId, checked)} onUpdated={() => { load(); onChanged(); }} onRecipientsSaved={() => load()} />;
              })}
            </VStack>
            <Box display={{ base: 'none', md: 'block' }} overflowX="auto" bg="white" borderRadius="lg" border="1px solid" borderColor="orange.100">
              <Table size="sm" minW="1020px"><Thead bg="orange.100"><Tr><Th aria-label="Odabir" w="48px" pr={0} /><Th>Komitent</Th><Th>Primaoci</Th><Th>Status</Th><Th>Napomena</Th><Th>Akcije</Th></Tr></Thead><Tbody>{items.map((assignment) => {
                const assignmentId = dailyAssignmentId(assignment);
                return <DailyAssignmentRow key={assignmentId} assignment={assignment} brandCode={brandCode} isSelected={selectedAssignmentIds.has(assignmentId)} onSelectionChange={(checked) => setAssignmentSelected(assignmentId, checked)} onUpdated={() => { load(); onChanged(); }} onRecipientsSaved={() => load()} />;
              })}</Tbody></Table>
            </Box>
          </>
        )}
      </Box>
    </Collapse>
  );
}

function DashboardCards({ dashboard }) {
  const totals = dashboard?.totals || dashboard || {};
  const today = dashboard?.today || {};
  const cards = [
    ['Ukupno zapisa', totals.count ?? totals.total ?? totals.totalRecords ?? totals.total_records ?? 0, FaUsers, 'orange'],
    ['Današnjih 30', today.total ?? today.assigned ?? totals.todayAssigned ?? 0, FaCalendarCheck, 'blue'],
  ];

  return (
    <SimpleGrid columns={{ base: 2 }} spacing={{ base: 2, md: 4 }}>
      {cards.map(([label, value, icon, scheme]) => (
        <Stat key={label} minW={0} border="1px solid" borderColor={`${scheme}.100`} bg="white" borderRadius="xl" p={{ base: 3, md: 4 }} boxShadow="sm">
          <Flex justify="space-between" gap={2}><Box minW={0}><StatLabel color="gray.600" fontSize={{ base: 'xs', md: 'sm' }}>{label}</StatLabel><StatNumber fontSize={{ base: 'lg', md: '2xl' }} overflowWrap="anywhere">{value}</StatNumber></Box><Flex display={{ base: 'none', sm: 'flex' }} flexShrink={0} boxSize="38px" borderRadius="full" align="center" justify="center" bg={`${scheme}.50`} color={`${scheme}.500`}><Icon as={icon} /></Flex></Flex>
        </Stat>
      ))}
    </SimpleGrid>
  );
}

function statusColorScheme(status) {
  if (['INTERESTED', 'WON'].includes(status)) return 'green';
  if (status === 'REJECTED') return 'red';
  if (['CALL_REQUIRED', 'CONTACTED', 'EMAIL_SENT', 'MEETING_SCHEDULED', 'OFFER_SENT', 'FOLLOW_UP'].includes(status)) return 'yellow';
  return 'gray';
}

export function statusVisual(status) {
  if (['INTERESTED', 'WON'].includes(status)) {
    return { bg: 'green.50', hoverBg: 'green.100', borderColor: 'green.200' };
  }
  if (status === 'REJECTED') {
    return { bg: 'red.50', hoverBg: 'red.100', borderColor: 'red.200' };
  }
  if (['CALL_REQUIRED', 'CONTACTED', 'EMAIL_SENT', 'MEETING_SCHEDULED', 'OFFER_SENT', 'FOLLOW_UP'].includes(status)) {
    return { bg: 'yellow.50', hoverBg: 'yellow.100', borderColor: 'yellow.200' };
  }
  return { bg: 'white', hoverBg: 'gray.50', borderColor: 'gray.200' };
}

function priorityColorScheme(priority) {
  if (priority === 'HIGH') return 'red';
  if (priority === 'LOW') return 'gray';
  return 'yellow';
}

function formattedContactDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('bs-BA');
}

function formattedLetterDate(value) {
  if (!value) return 'Datum nije evidentiran';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return formattedContactDate(value);
  return `${match[3]}.${match[2]}.${match[1]}.${match[4] ? ` ${match[4]}:${match[5]}` : ''}`;
}

function defaultLetterHistoryFrom() {
  return `${new Date().getFullYear()}-07-01`;
}

function structuredRecordEmail(record) {
  const email = String(recordValue(record, 'email') || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) ? email : '';
}

function recordLetterBlockedReason(record) {
  if (!structuredRecordEmail(record)) return 'Komitent nema ispravnu glavnu email adresu.';
  const status = String(recordValue(record, 'status', 'crm_status') || '').toUpperCase();
  if (status === 'EMAIL_SENT') return 'Dopis je već evidentiran kao poslan.';
  if (status === 'REJECTED') return 'Odbijenom komitentu nije moguće poslati dopis.';
  if (status === 'WON') return 'Ugovorenom komitentu nije moguće poslati početni dopis.';
  return '';
}

function RecordDetailsGrid({ record }) {
  const details = [
    ['Glavni email za slanje', recordValue(record, 'email')],
    ['Izvorni mail podaci', recordValue(record, 'raw_mail', 'rawMail', 'mail')],
    ['Kontakt', recordValue(record, 'raw_contact', 'rawContact', 'contact', 'kontakt', 'contact_person', 'phone')],
    ['Komentar', recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar')],
    ['CRM napomene', recordValue(record, 'notes')],
  ];

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
      {details.map(([label, value]) => (
        <Box key={label} minW={0}>
          <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">{label}</Text>
          <Text mt={1} fontSize="sm" whiteSpace="pre-wrap" overflowWrap="anywhere">{value || '—'}</Text>
        </Box>
      ))}
    </SimpleGrid>
  );
}

function RecordCard({ record, onEdit, onTransfer, onRemove, onSendLetter, isSendingLetter, showLetterSentAt }) {
  const details = useDisclosure();
  const recordStatus = recordValue(record, 'status', 'crm_status') || 'NEW';
  const recordPriority = recordValue(record, 'priority') || 'MEDIUM';
  const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';
  const nextContact = recordValue(record, 'next_contact_at', 'nextContactAt');
  const email = recordValue(record, 'email', 'raw_mail', 'rawMail', 'mail');
  const comment = recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar');
  const letterSentAt = recordValue(record, 'letter_sent_at', 'letterSentAt');
  const letterBlockedReason = recordLetterBlockedReason(record);
  const visual = statusVisual(recordStatus);

  return (
    <Box border="1px solid" borderColor={visual.borderColor} borderRadius="xl" bg={visual.bg} p={3} boxShadow="sm">
      <Flex justify="space-between" align="start" gap={3}>
        <Box minW={0}>
          <Text fontWeight="bold" fontSize="md" overflowWrap="anywhere">{company}</Text>
          <Text fontSize="xs" color="gray.500">N/R {recordValue(record, 'source_row_number', 'nr') || '—'}</Text>
        </Box>
        <VStack align="end" spacing={1} flexShrink={0}>
          <Badge colorScheme={statusColorScheme(recordStatus)}>{displayStatus(recordStatus)}</Badge>
          <Badge colorScheme={priorityColorScheme(recordPriority)}>{displayStatus(recordPriority)}</Badge>
        </VStack>
      </Flex>

      <HStack mt={3} spacing={2} color="gray.600" fontSize="xs" flexWrap="wrap">
        <Text>{recordValue(record, 'record_type') || 'Bez vrste'}</Text>
        <Text>•</Text>
        <Text>{recordValue(record, 'location') || 'Bez lokacije'}</Text>
        <Text>•</Text>
        <Text>{recordValue(record, 'branch_count') || '—'} poslovnica</Text>
      </HStack>

      {email && <Text mt={3} fontSize="sm" color="gray.700" noOfLines={1}>{email}</Text>}
      {comment && <Text mt={1} fontSize="sm" color="gray.500" noOfLines={1}>{comment}</Text>}

      {showLetterSentAt ? (
        <Text mt={2} fontSize="xs" fontWeight="bold" color="blue.700">Dopis poslan: {formattedLetterDate(letterSentAt)}</Text>
      ) : nextContact && (
        <Text mt={2} fontSize="xs" fontWeight="semibold" color="orange.700">Sljedeći kontakt: {formattedContactDate(nextContact)}</Text>
      )}

      <Button
        aria-label={`Pošalji dopis za ${company}`}
        title={letterBlockedReason || 'Odmah pošalji sačuvani dopis i evidentiraj vrijeme u CRM-u'}
        w="full"
        minH="44px"
        mt={3}
        size="sm"
        leftIcon={<FaPaperPlane />}
        colorScheme="green"
        isDisabled={Boolean(letterBlockedReason)}
        isLoading={isSendingLetter}
        loadingText="Šaljem dopis"
        onClick={() => onSendLetter(record)}
      >
        Pošalji dopis odmah
      </Button>

      <Button w="full" minH="40px" mt={2} size="sm" variant="ghost" colorScheme="orange" rightIcon={details.isOpen ? <FaChevronUp /> : <FaChevronDown />} onClick={details.onToggle}>
        {details.isOpen ? 'Sakrij detalje' : 'Detalji komitenta'}
      </Button>
      <Collapse in={details.isOpen} animateOpacity>
        <Box mt={2} pt={4} borderTop="1px solid" borderColor="gray.100"><RecordDetailsGrid record={record} /></Box>
      </Collapse>

      <SimpleGrid columns={3} spacing={2} mt={4}>
        <Button aria-label="Uredi komitenta" minH="40px" size="sm" leftIcon={<FaEdit />} variant="outline" onClick={() => onEdit(record)}>Uredi</Button>
        <Button aria-label="Prebaci komitenta" minH="40px" size="sm" leftIcon={<FaExchangeAlt />} colorScheme="orange" variant="ghost" onClick={() => onTransfer(record)}>Prebaci</Button>
        <Button aria-label="Arhiviraj komitenta" minH="40px" size="sm" leftIcon={<FaTrash />} colorScheme="red" variant="ghost" onClick={() => onRemove(record)}>Arhiviraj</Button>
      </SimpleGrid>
    </Box>
  );
}

function CompactRecordRow({ record, onEdit, onTransfer, onRemove, onSendLetter, isSendingLetter, showLetterSentAt }) {
  const details = useDisclosure();
  const recordStatus = recordValue(record, 'status', 'crm_status') || 'NEW';
  const recordPriority = recordValue(record, 'priority') || 'MEDIUM';
  const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';
  const email = recordValue(record, 'email', 'raw_mail', 'rawMail', 'mail');
  const contact = recordValue(record, 'raw_contact', 'rawContact', 'contact', 'kontakt', 'contact_person', 'phone');
  const nextContact = recordValue(record, 'next_contact_at', 'nextContactAt');
  const comment = recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar');
  const letterSentAt = recordValue(record, 'letter_sent_at', 'letterSentAt');
  const letterBlockedReason = recordLetterBlockedReason(record);
  const visual = statusVisual(recordStatus);

  return (
    <React.Fragment>
      <Tr _hover={{ bg: visual.hoverBg }} bg={details.isOpen ? visual.hoverBg : visual.bg}>
        <Td py={3}>
          <Text fontWeight="semibold" noOfLines={2}>{company}</Text>
          <Text mt={1} fontSize="xs" color="gray.500">N/R {recordValue(record, 'source_row_number', 'nr') || '—'}</Text>
        </Td>
        <Td py={3}>
          <Text fontSize="sm" noOfLines={1}>{recordValue(record, 'record_type') || '—'}</Text>
          <Text mt={1} fontSize="xs" color="gray.500" noOfLines={1}>{recordValue(record, 'location') || 'Bez lokacije'} · {recordValue(record, 'branch_count') || '—'} posl.</Text>
        </Td>
        <Td py={3} minW={0}>
          <Text fontSize="sm" noOfLines={1}>{email || '—'}</Text>
          <Text mt={1} fontSize="xs" color="gray.500" noOfLines={1}>{contact || comment || 'Bez dodatnog kontakta'}</Text>
        </Td>
        <Td py={3}>
          <VStack align="start" spacing={1}>
            <Badge colorScheme={statusColorScheme(recordStatus)}>{displayStatus(recordStatus)}</Badge>
            <Badge colorScheme={priorityColorScheme(recordPriority)}>{displayStatus(recordPriority)}</Badge>
          </VStack>
        </Td>
        <Td py={3}>
          <Text fontSize="sm" noOfLines={2}>{showLetterSentAt ? formattedLetterDate(letterSentAt) : formattedContactDate(nextContact)}</Text>
        </Td>
        <Td py={3}>
          <HStack spacing={1} justify="flex-end">
            <IconButton aria-label={details.isOpen ? 'Sakrij detalje komitenta' : 'Prikaži detalje komitenta'} title={details.isOpen ? 'Sakrij detalje' : 'Detalji'} size="sm" variant="ghost" colorScheme="orange" icon={details.isOpen ? <FaChevronUp /> : <FaChevronDown />} onClick={details.onToggle} />
            <IconButton
              aria-label={`Pošalji dopis za ${company}`}
              title={letterBlockedReason || 'Odmah pošalji sačuvani dopis i upiši vrijeme u CRM'}
              size="sm"
              variant="ghost"
              colorScheme="green"
              icon={<FaPaperPlane />}
              isDisabled={Boolean(letterBlockedReason)}
              isLoading={isSendingLetter}
              onClick={() => onSendLetter(record)}
            />
            <IconButton aria-label="Uredi komitenta" title="Uredi" size="sm" variant="ghost" icon={<FaEdit />} onClick={() => onEdit(record)} />
            <IconButton aria-label="Prebaci komitenta" title="Prebaci u drugu bazu" size="sm" variant="ghost" colorScheme="orange" icon={<FaExchangeAlt />} onClick={() => onTransfer(record)} />
            <IconButton aria-label="Arhiviraj komitenta" title="Arhiviraj" size="sm" variant="ghost" colorScheme="red" icon={<FaTrash />} onClick={() => onRemove(record)} />
          </HStack>
        </Td>
      </Tr>
      {details.isOpen && (
        <Tr bg={visual.hoverBg}>
          <Td colSpan={6} pt={0} pb={5} px={5}>
            <Box borderTop="1px solid" borderColor={visual.borderColor} pt={4}><RecordDetailsGrid record={record} /></Box>
          </Td>
        </Tr>
      )}
    </React.Fragment>
  );
}

function pageNumbers(currentPage, totalPages) {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

function BrandPanel({ brand, brands, user, globalRefreshKey, onGlobalChanged }) {
  const toast = useToast();
  const modal = useDisclosure();
  const transferModal = useDisclosure();
  const [editing, setEditing] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [data, setData] = useState({ items: [], pagination: {}, filters: {} });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [dimensionFilter, setDimensionFilter] = useState('');
  const [lettersOnly, setLettersOnly] = useState(false);
  const [sentFrom, setSentFrom] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sortOption, setSortOption] = useState('company_name:asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dailyOpen, setDailyOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sendingLetterId, setSendingLetterId] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const brandCode = brand.code || brand.slug;

  const recordParams = useCallback(({ targetPage = page, targetPerPage = perPage } = {}) => {
    const [sortBy, sortDirection] = sortOption.split(':');
    const params = { page: targetPage, perPage: targetPerPage, search, status, priority, sortBy, sortDirection };
    if (lettersOnly) params.lettersOnly = true;
    if (sentFrom) params.sentFrom = sentFrom;
    if (sentTo) params.sentTo = sentTo;
    const normalizedBrandCode = normalizeBrandCode(brandCode);
    if (normalizedBrandCode === 'VISIOCAST' && dimensionFilter) params.location = dimensionFilter;
    if (normalizedBrandCode === 'SAN_PEST' && dimensionFilter) params.country = dimensionFilter;
    if (normalizedBrandCode === 'FS_APP' && dimensionFilter) params.record_type = dimensionFilter;
    return params;
  }, [brandCode, dimensionFilter, lettersOnly, page, perPage, priority, search, sentFrom, sentTo, sortOption, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardResult, recordResult] = await Promise.all([
        commercialApi.getDashboard(brandCode),
        commercialApi.getRecords(brandCode, recordParams()),
      ]);
      setDashboard(dashboardResult);
      setData(Array.isArray(recordResult) ? { items: recordResult, pagination: {} } : { items: [], pagination: {}, filters: {}, ...recordResult });
    } catch (requestError) {
      setError(requestError.message || 'Komercijalna baza trenutno nije dostupna.');
    } finally {
      setLoading(false);
    }
  }, [brandCode, recordParams]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [globalRefreshKey, load, refreshKey, search]);

  const changed = useCallback(() => setRefreshKey((value) => value + 1), []);
  const toggleLetterHistory = () => {
    const nextValue = !lettersOnly;
    setLettersOnly(nextValue);
    if (nextValue) {
      setSentFrom(defaultLetterHistoryFrom());
      setSentTo('');
      setSortOption('letter_sent_at:desc');
    } else {
      setSentFrom('');
      setSentTo('');
      if (sortOption.startsWith('letter_sent_at:')) setSortOption('company_name:asc');
    }
    setPage(1);
  };
  const openNew = () => { setEditing(null); modal.onOpen(); };
  const openEdit = (record) => { setEditing(record); modal.onOpen(); };
  const openTransfer = (record) => { setTransferring(record); transferModal.onOpen(); };
  const remove = async (record) => {
    const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'ovaj zapis';
    if (!window.confirm(`Arhivirati ${company}? Zapis neće biti trajno izbrisan.`)) return;
    try {
      await commercialApi.deleteRecord(record.id);
      toast({ title: 'Komitent je arhiviran.', status: 'success', position: 'top-right' });
      changed();
    } catch (requestError) {
      toast({ title: requestError.message, status: 'error', position: 'top-right' });
    }
  };

  const sendLetter = async (record) => {
    const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Komitent';
    const email = structuredRecordEmail(record);
    const blockedReason = recordLetterBlockedReason(record);
    if (blockedReason) {
      toast({ title: blockedReason, status: 'warning', position: 'top-right' });
      return;
    }
    const confirmed = window.confirm(
      `Odmah poslati sačuvani dopis za ${brand.name} komitentu ${company} na ${email}?\n\nNakon uspješnog slanja CRM automatski upisuje datum i vrijeme.`
    );
    if (!confirmed) return;
    setSendingLetterId(record.id);
    try {
      await commercialApi.sendRecordLetter(record.id);
      toast({
        title: `Dopis je poslan za ${company}.`,
        description: `Poslano na ${email}. CRM komentar sa datumom i vremenom je upisan automatski.`,
        status: 'success',
        position: 'top-right',
      });
      changed();
    } catch (requestError) {
      toast({
        title: requestError.message || 'Dopis trenutno nije moguće poslati.',
        status: 'error',
        position: 'top-right',
      });
    } finally {
      setSendingLetterId('');
    }
  };

  const downloadPdfReport = async () => {
    setExportingPdf(true);
    try {
      const firstResult = await commercialApi.getRecords(brandCode, recordParams({ targetPage: 1, targetPerPage: 100 }));
      const firstItems = Array.isArray(firstResult) ? firstResult : (firstResult?.items || firstResult?.records || []);
      const reportPages = Array.isArray(firstResult) ? 1 : Number(firstResult?.pagination?.pages || firstResult?.pagination?.totalPages || 1);
      const remainingResults = reportPages > 1
        ? await Promise.all(Array.from({ length: reportPages - 1 }, (_, index) => (
          commercialApi.getRecords(brandCode, recordParams({ targetPage: index + 2, targetPerPage: 100 }))
        )))
        : [];
      const reportItems = remainingResults.reduce((all, result) => all.concat(
        Array.isArray(result) ? result : (result?.items || result?.records || [])
      ), [...firstItems]);
      if (!reportItems.length) {
        toast({ title: 'Nema poslanih dopisa za izabrani period.', status: 'warning', position: 'top-right' });
        return;
      }
      downloadLetterReportPdf({
        brandCode: normalizeBrandCode(brandCode),
        brandName: brand.name,
        records: reportItems,
        sentFrom,
        sentTo,
      });
      toast({
        title: 'PDF izvještaj je preuzet.',
        description: `${reportItems.length} ${reportItems.length === 1 ? 'dopis' : 'dopisa'} za ${brand.name}.`,
        status: 'success',
        position: 'top-right',
      });
    } catch (requestError) {
      toast({ title: requestError.message || 'PDF izvještaj trenutno nije moguće pripremiti.', status: 'error', position: 'top-right' });
    } finally {
      setExportingPdf(false);
    }
  };

  const items = data.items || data.records || [];
  const pages = data.pagination?.pages || data.pagination?.totalPages || 1;
  const total = data.pagination?.total ?? items.length;
  const availableStatuses = data.filters?.statuses || CRM_STATUSES;
  const availablePriorities = data.filters?.priorities || PRIORITIES;
  const dimensionConfig = normalizeBrandCode(brandCode) === 'VISIOCAST'
    ? { ariaLabel: 'Filter po gradu', placeholder: 'Svi gradovi', options: data.filters?.locations || [] }
    : normalizeBrandCode(brandCode) === 'SAN_PEST'
      ? { ariaLabel: 'Filter po državi', placeholder: 'Sve države', options: data.filters?.countries || [] }
      : { ariaLabel: 'Filter po vrsti', placeholder: 'Sve vrste', options: data.filters?.recordTypes || [] };
  const rangeStart = total > 0 ? ((page - 1) * perPage) + 1 : 0;
  const rangeEnd = Math.min(page * perPage, total);
  const visiblePages = pageNumbers(page, Math.max(1, pages));

  return (
    <VStack align="stretch" spacing={5}>
      <DashboardCards dashboard={dashboard} />

      <CommercialMailAutomation
        brandCode={brandCode}
        brandName={brand.name}
        user={user}
        onChanged={changed}
      />

      <Flex border="1px solid" borderColor={dailyOpen ? 'orange.300' : 'gray.200'} bg={dailyOpen ? 'orange.50' : 'gray.50'} borderRadius="xl" px={4} py={3} align="center" justify="space-between" gap={4}>
        <Box><Text fontWeight="bold">Današnjih 30</Text><Text fontSize="sm" color="gray.600">Dnevni fokus komercijaliste, odvojen za {brand.name}.</Text></Box>
        <Switch aria-label="Prikaži Današnjih 30" colorScheme="orange" size="lg" isChecked={dailyOpen} onChange={(event) => setDailyOpen(event.target.checked)} />
      </Flex>
      <DailyPanel brandCode={brandCode} isOpen={dailyOpen} onChanged={changed} />

      <Box
        border="1px solid"
        borderColor={lettersOnly ? 'blue.300' : 'gray.200'}
        bg={lettersOnly ? 'blue.50' : 'gray.50'}
        borderRadius="xl"
        p={{ base: 3, md: 4 }}
      >
        <Flex align={{ base: 'stretch', lg: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', lg: 'row' }}>
          <Box>
            <HStack spacing={2}><Icon as={FaEnvelope} color={lettersOnly ? 'blue.600' : 'gray.500'} /><Text fontWeight="bold">Evidencija poslanih dopisa</Text></HStack>
            <Text mt={1} fontSize="sm" color="gray.600">Jedan klik prikazuje samo komitente kojima je dopis poslan i stvarni datum slanja.</Text>
          </Box>
          <Button
            aria-label={lettersOnly ? 'Prikaži sve komitente' : 'Prikaži poslane dopise od 1. jula'}
            aria-pressed={lettersOnly}
            minH="44px"
            flexShrink={0}
            leftIcon={<FaEnvelope />}
            colorScheme={lettersOnly ? 'blue' : 'orange'}
            variant={lettersOnly ? 'solid' : 'outline'}
            onClick={toggleLetterHistory}
          >
            {lettersOnly ? 'Prikaži sve komitente' : 'Dopisi od 01.07.'}
          </Button>
        </Flex>

        {lettersOnly && (
          <Flex mt={4} gap={3} align={{ base: 'stretch', md: 'end' }} direction={{ base: 'column', md: 'row' }}>
            <FormControl maxW={{ md: '210px' }}>
              <FormLabel mb={1} fontSize="sm">Poslano od datuma</FormLabel>
              <Input aria-label="Dopis poslan od datuma" type="date" bg="white" value={sentFrom} onChange={(event) => { setSentFrom(event.target.value); setPage(1); }} />
            </FormControl>
            <FormControl maxW={{ md: '210px' }}>
              <FormLabel mb={1} fontSize="sm">Poslano do datuma</FormLabel>
              <Input aria-label="Dopis poslan do datuma" type="date" bg="white" value={sentTo} onChange={(event) => { setSentTo(event.target.value); setPage(1); }} />
            </FormControl>
            <Button minH="40px" variant="ghost" colorScheme="blue" onClick={() => { setSentFrom(''); setSentTo(''); setPage(1); }}>Očisti datume</Button>
            <Button
              aria-label="Preuzmi PDF izvještaj za izabrani period"
              minH="40px"
              leftIcon={<FaFilePdf />}
              colorScheme="red"
              isLoading={exportingPdf}
              loadingText="Priprema PDF..."
              onClick={downloadPdfReport}
            >
              PDF izvještaj
            </Button>
          </Flex>
        )}

        <Flex mt={4} gap={2} align="center" flexWrap="wrap">
          <Text mr={1} fontSize="xs" fontWeight="semibold" color="gray.600">Boje redova:</Text>
          <Badge colorScheme="yellow">U toku / dopis / sastanak</Badge>
          <Badge colorScheme="red">Odbijeno</Badge>
          <Badge colorScheme="green">Zainteresovan / prihvaćeno</Badge>
          <Text fontSize="xs" color="gray.500">Boja se mijenja kada u „Uredi“ promijenite CRM status.</Text>
        </Flex>
      </Box>

      <Divider />
      <Flex gap={3} direction={{ base: 'column', xl: 'row' }}>
        <HStack flex="1" border="1px solid" borderColor="gray.200" borderRadius="md" px={3}>
          <Icon as={FaSearch} color="gray.400" />
          <Input border="0" boxShadow="none !important" placeholder="Pretraži komitenta, mail, kontakt ili komentar" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </HStack>
        <Select maxW={{ xl: '210px' }} placeholder="Svi statusi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{availableStatuses.map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select>
        <Select maxW={{ xl: '180px' }} placeholder="Svi prioriteti" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}>{availablePriorities.map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select>
        <Select aria-label={dimensionConfig.ariaLabel} maxW={{ xl: '210px' }} placeholder={dimensionConfig.placeholder} value={dimensionFilter} onChange={(event) => { setDimensionFilter(event.target.value); setPage(1); }}>
          {dimensionConfig.options.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Button w={{ base: 'full', xl: 'auto' }} minH="44px" leftIcon={<FaPlus />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} onClick={openNew}>Novi komitent</Button>
      </Flex>

      <Flex px={{ base: 0, md: 1 }} gap={3} align={{ base: 'stretch', md: 'center' }} justify="space-between" direction={{ base: 'column', md: 'row' }}>
        <Text fontSize="sm" color="gray.600">Prikazano <strong>{rangeStart}–{rangeEnd}</strong> od <strong>{total}</strong> {lettersOnly ? 'dopisa' : 'zapisa'}</Text>
        <HStack spacing={3}>
          <Select aria-label="Sortiranje komitenata" size="sm" minH="40px" maxW="230px" value={sortOption} onChange={(event) => { setSortOption(event.target.value); setPage(1); }}>
            {lettersOnly && <option value="letter_sent_at:desc">Datum slanja - najnoviji</option>}
            {lettersOnly && <option value="letter_sent_at:asc">Datum slanja - najstariji</option>}
            <option value="company_name:asc">Naziv A–Ž</option>
            <option value="company_name:desc">Naziv Ž–A</option>
            <option value="source_row_number:asc">Redni broj</option>
            <option value="location:asc">Lokacija A–Ž</option>
            <option value="next_contact_at:asc">Sljedeći kontakt</option>
            <option value="updated_at:desc">Zadnje izmjene</option>
          </Select>
          <HStack spacing={2} flexShrink={0}>
            <Text display={{ base: 'none', sm: 'block' }} fontSize="sm" color="gray.600">Po stranici</Text>
            <Select aria-label="Broj zapisa po stranici" size="sm" minH="40px" w="78px" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Select>
          </HStack>
        </HStack>
      </Flex>

      {error && <ErrorAlert message={error} onRetry={load} />}
      {loading ? <Loading label={`Učitavanje ${brand.name} baze...`} /> : items.length === 0 ? (
        <EmptyState title="Nema pronađenih komitenata" text={lettersOnly ? 'Promijenite raspon datuma ili očistite dodatne filtere.' : 'Promijenite filtere ili dodajte prvi komercijalni zapis.'} />
      ) : (
        <>
          <VStack display={{ base: 'flex', xl: 'none' }} align="stretch" spacing={3}>
            {items.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onEdit={openEdit}
                onTransfer={openTransfer}
                onRemove={remove}
                onSendLetter={sendLetter}
                isSendingLetter={sendingLetterId === record.id}
                showLetterSentAt={lettersOnly}
              />
            ))}
          </VStack>
          <Box display={{ base: 'none', xl: 'block' }} border="1px solid" borderColor="gray.200" borderRadius="xl" overflow="hidden" boxShadow="sm">
            <Table size="sm" sx={{ tableLayout: 'fixed' }}>
            <Thead bg="orange.50"><Tr><Th w="21%">Komitent</Th><Th w="15%">Profil</Th><Th w="24%">Kontakt</Th><Th w="14%">Status</Th><Th w="13%">{lettersOnly ? 'Dopis poslan' : 'Sljedeći kontakt'}</Th><Th w="13%" textAlign="right">Akcije</Th></Tr></Thead>
            <Tbody>{items.map((record) => (
              <CompactRecordRow
                key={record.id}
                record={record}
                onEdit={openEdit}
                onTransfer={openTransfer}
                onRemove={remove}
                onSendLetter={sendLetter}
                isSendingLetter={sendingLetterId === record.id}
                showLetterSentAt={lettersOnly}
              />
            ))}</Tbody>
            </Table>
          </Box>
        </>
      )}

      <Flex justify="space-between" align="center" direction={{ base: 'column', md: 'row' }} gap={3}>
        <Text fontSize="sm" color="gray.600">Stranica {page} od {Math.max(1, pages)} · {total} {lettersOnly ? 'dopisa' : 'zapisa'}</Text>
        <HStack display={{ base: 'flex', md: 'none' }} w="full" justify="center">
          <Button flex="1" minH="40px" size="sm" variant="outline" isDisabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Prethodna</Button>
          <Text flexShrink={0} fontSize="sm">{page} / {Math.max(1, pages)}</Text>
          <Button flex="1" minH="40px" size="sm" variant="outline" isDisabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Sljedeća</Button>
        </HStack>
        <HStack display={{ base: 'none', md: 'flex' }} spacing={1}>
          <Button minH="40px" size="sm" variant="ghost" isDisabled={page <= 1} onClick={() => setPage(1)}>Prva</Button>
          <Button minH="40px" size="sm" variant="outline" isDisabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Prethodna</Button>
          {visiblePages.map((pageNumber) => <Button key={pageNumber} minW="40px" minH="40px" size="sm" colorScheme={pageNumber === page ? 'orange' : 'gray'} variant={pageNumber === page ? 'solid' : 'ghost'} onClick={() => setPage(pageNumber)}>{pageNumber}</Button>)}
          <Button minH="40px" size="sm" variant="outline" isDisabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Sljedeća</Button>
          <Button minH="40px" size="sm" variant="ghost" isDisabled={page >= pages} onClick={() => setPage(pages)}>Zadnja</Button>
        </HStack>
      </Flex>

      <RecordModal isOpen={modal.isOpen} onClose={modal.onClose} record={editing} brandCode={brandCode} onSaved={() => { toast({ title: 'Komitent je sačuvan.', status: 'success', position: 'top-right' }); changed(); }} />
      <TransferRecordModal
        isOpen={transferModal.isOpen}
        onClose={transferModal.onClose}
        record={transferring}
        currentBrand={brand}
        brands={brands}
        onTransferred={(result, targetBrand) => {
          toast({ title: `Komitent je prebačen u ${result?.to_brand?.name || targetBrand?.name || 'odabranu bazu'}.`, status: 'success', position: 'top-right' });
          setTransferring(null);
          onGlobalChanged();
        }}
      />
    </VStack>
  );
}

function WaitingBrand({ brand }) {
  return (
    <Box py={{ base: 8, md: 14 }} px={4} border="1px dashed" borderColor="orange.300" bg="orange.50" borderRadius="2xl" textAlign="center">
      <Flex mx="auto" mb={4} boxSize="64px" borderRadius="full" bg="white" color={orange} align="center" justify="center" boxShadow="sm"><Icon as={FaBuilding} boxSize={7} /></Flex>
      <Heading size="md">{brand.name}</Heading>
      <Text color="gray.600" mt={2}>{brand.subtitle}</Text>
      <Badge mt={4} colorScheme="orange" px={3} py={1}>Tabela još nije dostavljena</Badge>
      <Text maxW="620px" mx="auto" mt={4} color="gray.600">Ova cjelina je već odvojena i spremna. Kada stigne Excel tabela, dobit će vlastite podatke, „Današnjih 30“ listu i CRM tok bez miješanja sa Visiocast bazom.</Text>
    </Box>
  );
}

function mergeBrands(remoteItems, useStaticFallback = false) {
  const definitions = useStaticFallback
    ? BRAND_DEFINITIONS
    : BRAND_DEFINITIONS.filter((definition) => remoteItems.some(
      (item) => normalizeBrandCode(item.code || item.slug) === definition.code
    ));
  return definitions.map((definition) => {
    const remote = remoteItems.find((item) => normalizeBrandCode(item.code || item.slug) === definition.code);
    const remoteCount = Number(remote?.record_count ?? remote?.count ?? remote?.total ?? 0);
    return { ...definition, ...(remote || {}), code: definition.code, ready: definition.code === 'VISIOCAST' || remoteCount > 0 };
  });
}

export default function CommercialModule({ user }) {
  const [remoteBrands, setRemoteBrands] = useState([]);
  const [brandError, setBrandError] = useState('');
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [useStaticFallback, setUseStaticFallback] = useState(false);
  const [globalRefreshKey, setGlobalRefreshKey] = useState(0);
  const brands = useMemo(() => mergeBrands(remoteBrands, useStaticFallback), [remoteBrands, useStaticFallback]);

  useEffect(() => {
    commercialApi.getBrands()
      .then((result) => {
        setRemoteBrands(Array.isArray(result) ? result : result?.items || []);
        setUseStaticFallback(false);
      })
      .catch((error) => {
        setBrandError(error.message);
        setUseStaticFallback(true);
      })
      .finally(() => setBrandsLoading(false));
  }, []);

  return (
    <Box>
      <Flex justify="space-between" align={{ base: 'start', lg: 'center' }} direction={{ base: 'column', lg: 'row' }} gap={3} mb={5}>
        <Box>
          <HStack><Icon as={FaBuilding} color={orange} boxSize={6} /><Heading size="lg">Komercijalni CRM</Heading></HStack>
          <Text color="gray.600" mt={1}>Tri potpuno odvojene prodajne baze, dnevni fokus i evidencija kontakata.</Text>
        </Box>
        <HStack><Badge colorScheme="green" px={3} py={2} borderRadius="full">Aktivan profil</Badge><Text fontSize="sm" color="gray.600">{user?.displayName || user?.display_name || user?.username}</Text></HStack>
      </Flex>

      {brandError && <Box mb={4}><Alert status="warning" borderRadius="lg"><AlertIcon /><AlertDescription>Spisak brendova nije učitan; prikazana je lokalna struktura. {brandError}</AlertDescription></Alert></Box>}

      {brandsLoading ? <Loading label="Učitavanje dostupnih komercijalnih baza..." /> : brands.length === 0 ? (
        <EmptyState title="Nema dodijeljenih komercijalnih baza" text="Vašem profilu trenutno nije dodijeljen pristup nijednoj komercijalnoj bazi. Obratite se direktoru." />
      ) : (
        <Tabs colorScheme="orange" variant="enclosed" isLazy>
          <TabList overflowX="auto" overflowY="hidden" sx={{ '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
            {brands.map((brand) => <Tab key={brand.code} flexShrink={0} minH="44px" fontWeight="bold">{brand.name}{brand.code === 'FS_APP' && <Text as="span" display={{ base: 'none', sm: 'inline' }} ml={1} fontSize="xs" fontWeight="normal">(Digitalni HACCP)</Text>}</Tab>)}
          </TabList>
          <TabPanels>
            {brands.map((brand) => <TabPanel key={brand.code} px={{ base: 0, md: 1 }} py={5}>{brand.ready ? <BrandPanel brand={brand} brands={brands} user={user} globalRefreshKey={globalRefreshKey} onGlobalChanged={() => setGlobalRefreshKey((value) => value + 1)} /> : <WaitingBrand brand={brand} />}</TabPanel>)}
          </TabPanels>
        </Tabs>
      )}
    </Box>
  );
}
