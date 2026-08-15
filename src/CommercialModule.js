import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Icon,
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
  FaEdit,
  FaPlus,
  FaRedo,
  FaSearch,
  FaTrash,
  FaUsers,
} from 'react-icons/fa';
import { commercialApi } from './commercial/api';
import CommercialMailAutomation from './commercial/CommercialMailAutomation';
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
            {EDIT_FIELDS.map((field) => (
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

function DailyAssignmentRow({ assignment, onUpdated }) {
  const record = assignment.record || assignment.account || assignment.commercial_record || assignment;
  const assignmentId = assignment.id || assignment.assignment_id;
  const [notes, setNotes] = useState(assignment.notes || assignment.assignment_notes || '');
  const [working, setWorking] = useState('');
  const toast = useToast();
  const status = assignment.assignment_status || assignment.status || 'PENDING';

  const update = async (nextStatus) => {
    setWorking(nextStatus);
    try {
      await commercialApi.updateDailyAssignment(assignmentId, { status: nextStatus, notes });
      toast({ title: nextStatus === 'COMPLETED' ? 'Komitent je označen kao obrađen.' : 'Komitent je preskočen.', status: 'success', position: 'top-right' });
      onUpdated();
    } catch (error) {
      toast({ title: error.message, status: 'error', position: 'top-right' });
    } finally {
      setWorking('');
    }
  };

  return (
    <Tr bg={status === 'COMPLETED' ? 'green.50' : status === 'SKIPPED' ? 'gray.50' : 'white'}>
      <Td><Text fontWeight="semibold">{recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva'}</Text><Text fontSize="xs" color="gray.500">{recordValue(record, 'city', 'address')}</Text></Td>
      <Td>{recordValue(record, 'email', 'raw_mail', 'mail') || '—'}</Td>
      <Td><Badge colorScheme={status === 'COMPLETED' ? 'green' : status === 'SKIPPED' ? 'gray' : 'orange'}>{displayStatus(status)}</Badge></Td>
      <Td minW="230px"><Input size="sm" aria-label="Napomena za dnevni kontakt" placeholder="Napomena" value={notes} onChange={(event) => setNotes(event.target.value)} /></Td>
      <Td>
        <HStack>
          <Button size="xs" leftIcon={<FaCheck />} colorScheme="green" isDisabled={status === 'COMPLETED'} isLoading={working === 'COMPLETED'} onClick={() => update('COMPLETED')}>Obrađeno</Button>
          <Button size="xs" variant="outline" isDisabled={status === 'SKIPPED'} isLoading={working === 'SKIPPED'} onClick={() => update('SKIPPED')}>Preskoči</Button>
        </HStack>
      </Td>
    </Tr>
  );
}

function DailyAssignmentCard({ assignment, onUpdated }) {
  const record = assignment.record || assignment.account || assignment.commercial_record || assignment;
  const assignmentId = assignment.id || assignment.assignment_id;
  const [notes, setNotes] = useState(assignment.notes || assignment.assignment_notes || '');
  const [working, setWorking] = useState('');
  const toast = useToast();
  const status = assignment.assignment_status || assignment.status || 'PENDING';
  const update = async (nextStatus) => {
    setWorking(nextStatus);
    try {
      await commercialApi.updateDailyAssignment(assignmentId, { status: nextStatus, notes });
      toast({ title: nextStatus === 'COMPLETED' ? 'Komitent je označen kao obrađen.' : 'Komitent je preskočen.', status: 'success', position: 'top-right' });
      onUpdated();
    } catch (error) {
      toast({ title: error.message, status: 'error', position: 'top-right' });
    } finally {
      setWorking('');
    }
  };
  return (
    <Box border="1px solid" borderColor={status === 'COMPLETED' ? 'green.200' : 'orange.100'} bg={status === 'COMPLETED' ? 'green.50' : 'white'} borderRadius="xl" p={4}>
      <Flex justify="space-between" gap={3} align="start">
        <Box minW={0}><Text fontWeight="bold">{recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva'}</Text><Text fontSize="xs" color="gray.500">{recordValue(record, 'city', 'address')}</Text></Box>
        <Badge flexShrink={0} colorScheme={status === 'COMPLETED' ? 'green' : status === 'SKIPPED' ? 'gray' : 'orange'}>{displayStatus(status)}</Badge>
      </Flex>
      <Text mt={2} fontSize="sm" overflowWrap="anywhere">{recordValue(record, 'email', 'raw_mail', 'mail') || 'Nema kontakta'}</Text>
      <Input mt={3} size="sm" aria-label="Napomena za dnevni kontakt" placeholder="Napomena" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <SimpleGrid columns={2} spacing={2} mt={3}>
        <Button minH="40px" size="sm" leftIcon={<FaCheck />} colorScheme="green" isDisabled={status === 'COMPLETED'} isLoading={working === 'COMPLETED'} onClick={() => update('COMPLETED')}>Obrađeno</Button>
        <Button minH="40px" size="sm" variant="outline" isDisabled={status === 'SKIPPED'} isLoading={working === 'SKIPPED'} onClick={() => update('SKIPPED')}>Preskoči</Button>
      </SimpleGrid>
    </Box>
  );
}

function DailyPanel({ brandCode, isOpen, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
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
  const completed = items.filter((item) => ['COMPLETED', 'OBRADJEN', 'DONE'].includes(item.assignment_status || item.status)).length;

  return (
    <Collapse in={isOpen} animateOpacity>
      <Box mt={4} border="1px solid" borderColor="orange.200" bg="orange.50" borderRadius="xl" p={{ base: 4, md: 5 }}>
        <Flex justify="space-between" align={{ base: 'start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3} mb={4}>
          <Box>
            <HStack><Icon as={FaCalendarCheck} color={orange} /><Heading size="sm">Današnjih 30 komitenata</Heading></HStack>
            <Text fontSize="sm" color="gray.600" mt={1}>Lista se automatski priprema svaki dan, pamti odabir i sutra predlaže druge komitente.</Text>
          </Box>
          <HStack flexWrap="wrap">
            {items.length > 0 && <Badge colorScheme="green" px={3} py={1}>{completed} / {items.length} obrađeno</Badge>}
            <Button size="sm" leftIcon={items.length ? <FaRedo /> : <FaPlus />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} isLoading={creating} onClick={create}>{items.length ? 'Dopuni listu' : 'Pripremi današnju listu'}</Button>
          </HStack>
        </Flex>
        {error && <ErrorAlert message={error} onRetry={load} />}
        {loading ? <Loading label="Učitavanje dnevne liste..." /> : items.length === 0 ? (
          <EmptyState title="Nema dostupnih komitenata za danas" text="Sistem je automatski pokušao pripremiti listu. Dodajte nove komitente ili provjerite da li su svi već raspoređeni." />
        ) : (
          <>
            <VStack display={{ base: 'flex', md: 'none' }} align="stretch" spacing={3}>
              {items.map((assignment) => <DailyAssignmentCard key={assignment.id || assignment.assignment_id} assignment={assignment} onUpdated={() => { load(); onChanged(); }} />)}
            </VStack>
            <Box display={{ base: 'none', md: 'block' }} overflowX="auto" bg="white" borderRadius="lg" border="1px solid" borderColor="orange.100">
              <Table size="sm" minW="850px"><Thead bg="orange.100"><Tr><Th>Komitent</Th><Th>Kontakt</Th><Th>Status</Th><Th>Napomena</Th><Th>Akcije</Th></Tr></Thead><Tbody>{items.map((assignment) => <DailyAssignmentRow key={assignment.id || assignment.assignment_id} assignment={assignment} onUpdated={() => { load(); onChanged(); }} />)}</Tbody></Table>
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

function RecordCard({ record, onEdit, onRemove }) {
  const details = useDisclosure();
  const recordStatus = recordValue(record, 'status', 'crm_status') || 'NEW';
  const recordPriority = recordValue(record, 'priority') || 'MEDIUM';
  const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';
  const nextContact = recordValue(record, 'next_contact_at', 'nextContactAt');
  const contactDetails = [
    ['Mail', recordValue(record, 'raw_mail', 'rawMail', 'mail', 'email')],
    ['Kontakt', recordValue(record, 'raw_contact', 'rawContact', 'contact', 'kontakt', 'contact_person', 'phone')],
    ['Komentar', recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar')],
    ['CRM napomene', recordValue(record, 'notes')],
  ].filter(([, value]) => value);

  return (
    <Box border="1px solid" borderColor="gray.200" borderRadius="xl" bg="white" p={4} boxShadow="sm">
      <Flex justify="space-between" align="start" gap={3}>
        <Box minW={0}>
          <Text fontWeight="bold" fontSize="md" overflowWrap="anywhere">{company}</Text>
          <Text fontSize="xs" color="gray.500">N/R {recordValue(record, 'source_row_number', 'nr') || '—'}</Text>
        </Box>
        <VStack align="end" spacing={1} flexShrink={0}>
          <Badge colorScheme={recordStatus === 'WON' ? 'green' : recordStatus === 'REJECTED' ? 'red' : 'orange'}>{displayStatus(recordStatus)}</Badge>
          <Badge colorScheme={recordPriority === 'HIGH' ? 'red' : recordPriority === 'LOW' ? 'gray' : 'yellow'}>{displayStatus(recordPriority)}</Badge>
        </VStack>
      </Flex>

      <SimpleGrid columns={2} spacingX={4} spacingY={3} mt={4}>
        <Box><Text fontSize="xs" color="gray.500">Vrsta</Text><Text fontSize="sm">{recordValue(record, 'record_type') || '—'}</Text></Box>
        <Box><Text fontSize="xs" color="gray.500">Lokacija</Text><Text fontSize="sm" overflowWrap="anywhere">{recordValue(record, 'location') || '—'}</Text></Box>
        <Box><Text fontSize="xs" color="gray.500">Poslovnice</Text><Text fontSize="sm">{recordValue(record, 'branch_count') || '—'}</Text></Box>
      </SimpleGrid>

      {nextContact && (
        <Box mt={3} p={3} borderRadius="lg" bg="orange.50">
          <Text fontSize="xs" color="gray.500">Sljedeći kontakt</Text>
          <Text fontSize="sm" fontWeight="semibold">{new Date(nextContact).toLocaleString('bs-BA')}</Text>
        </Box>
      )}

      {contactDetails.length > 0 && (
        <>
          <Button w="full" minH="44px" mt={4} size="sm" variant="ghost" colorScheme="orange" onClick={details.onToggle}>
            {details.isOpen ? 'Sakrij kontakt i napomene' : 'Prikaži kontakt i napomene'}
          </Button>
          <Collapse in={details.isOpen} animateOpacity>
            <VStack align="stretch" spacing={3} mt={2} pt={4} borderTop="1px solid" borderColor="gray.100">
              {contactDetails.map(([label, value]) => (
                <Box key={label}>
                  <Text fontSize="xs" color="gray.500">{label}</Text>
                  <Text fontSize="sm" whiteSpace="pre-wrap" overflowWrap="anywhere">{value}</Text>
                </Box>
              ))}
            </VStack>
          </Collapse>
        </>
      )}

      <SimpleGrid columns={2} spacing={2} mt={4}>
        <Button aria-label="Uredi komitenta" minH="44px" leftIcon={<FaEdit />} variant="outline" onClick={() => onEdit(record)}>Uredi</Button>
        <Button aria-label="Arhiviraj komitenta" minH="44px" leftIcon={<FaTrash />} colorScheme="red" variant="ghost" onClick={() => onRemove(record)}>Arhiviraj</Button>
      </SimpleGrid>
    </Box>
  );
}

function BrandPanel({ brand, user }) {
  const toast = useToast();
  const modal = useDisclosure();
  const [editing, setEditing] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [data, setData] = useState({ items: [], pagination: {}, filters: {} });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dailyOpen, setDailyOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const brandCode = brand.code || brand.slug;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, perPage: 25, search, status, priority, sortBy: 'company_name' };
      const [dashboardResult, recordResult] = await Promise.all([
        commercialApi.getDashboard(brandCode),
        commercialApi.getRecords(brandCode, params),
      ]);
      setDashboard(dashboardResult);
      setData(Array.isArray(recordResult) ? { items: recordResult, pagination: {} } : { items: [], pagination: {}, filters: {}, ...recordResult });
    } catch (requestError) {
      setError(requestError.message || 'Komercijalna baza trenutno nije dostupna.');
    } finally {
      setLoading(false);
    }
  }, [brandCode, page, priority, search, status]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey, search]);

  const changed = useCallback(() => setRefreshKey((value) => value + 1), []);
  const openNew = () => { setEditing(null); modal.onOpen(); };
  const openEdit = (record) => { setEditing(record); modal.onOpen(); };
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

  const items = data.items || data.records || [];
  const pages = data.pagination?.pages || data.pagination?.totalPages || 1;
  const total = data.pagination?.total ?? items.length;
  const availableStatuses = data.filters?.statuses || CRM_STATUSES;
  const availablePriorities = data.filters?.priorities || PRIORITIES;

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

      <Divider />
      <Flex gap={3} direction={{ base: 'column', xl: 'row' }}>
        <HStack flex="1" border="1px solid" borderColor="gray.200" borderRadius="md" px={3}>
          <Icon as={FaSearch} color="gray.400" />
          <Input border="0" boxShadow="none !important" placeholder="Pretraži komitenta, mail, kontakt ili komentar" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </HStack>
        <Select maxW={{ xl: '210px' }} placeholder="Svi statusi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{availableStatuses.map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select>
        <Select maxW={{ xl: '180px' }} placeholder="Svi prioriteti" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}>{availablePriorities.map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select>
        <Button w={{ base: 'full', xl: 'auto' }} minH="44px" leftIcon={<FaPlus />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} onClick={openNew}>Novi komitent</Button>
      </Flex>

      {error && <ErrorAlert message={error} onRetry={load} />}
      {loading ? <Loading label={`Učitavanje ${brand.name} baze...`} /> : items.length === 0 ? (
        <EmptyState title="Nema pronađenih komitenata" text="Promijenite filtere ili dodajte prvi komercijalni zapis." />
      ) : (
        <>
          <VStack display={{ base: 'flex', xl: 'none' }} align="stretch" spacing={3}>
            {items.map((record) => <RecordCard key={record.id} record={record} onEdit={openEdit} onRemove={remove} />)}
          </VStack>
          <Box display={{ base: 'none', xl: 'block' }} overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="xl">
            <Table size="sm" minW="1600px">
            <Thead bg="orange.50"><Tr><Th>N/R</Th><Th>Komitent</Th><Th>Vrsta</Th><Th isNumeric>Broj poslovnica</Th><Th>Mail</Th><Th>Kontakt</Th><Th>Komentar</Th><Th>Lokacija</Th><Th>Status</Th><Th>Prioritet</Th><Th>Sljedeći kontakt</Th><Th>CRM napomene</Th><Th>Akcije</Th></Tr></Thead>
            <Tbody>{items.map((record) => {
              const recordStatus = recordValue(record, 'status', 'crm_status') || 'NEW';
              const recordPriority = recordValue(record, 'priority') || 'MEDIUM';
              return (
                <Tr key={record.id} _hover={{ bg: 'gray.50' }}>
                  <Td>{recordValue(record, 'source_row_number', 'nr') || '—'}</Td>
                  <Td maxW="230px" whiteSpace="normal"><Text fontWeight="semibold">{recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva'}</Text></Td>
                  <Td>{recordValue(record, 'record_type') || '—'}</Td>
                  <Td isNumeric>{recordValue(record, 'branch_count') || '—'}</Td>
                  <Td maxW="320px" whiteSpace="pre-wrap" wordBreak="break-word">{recordValue(record, 'raw_mail', 'rawMail', 'mail', 'email') || '—'}</Td>
                  <Td maxW="300px" whiteSpace="pre-wrap" wordBreak="break-word">{recordValue(record, 'raw_contact', 'rawContact', 'contact', 'kontakt', 'contact_person', 'phone') || '—'}</Td>
                  <Td maxW="360px" whiteSpace="pre-wrap" wordBreak="break-word">{recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar') || '—'}</Td>
                  <Td maxW="220px" whiteSpace="normal">{recordValue(record, 'location') || '—'}</Td>
                  <Td><Badge colorScheme={recordStatus === 'WON' ? 'green' : recordStatus === 'REJECTED' ? 'red' : 'orange'}>{displayStatus(recordStatus)}</Badge></Td>
                  <Td><Badge colorScheme={recordPriority === 'HIGH' ? 'red' : recordPriority === 'LOW' ? 'gray' : 'yellow'}>{displayStatus(recordPriority)}</Badge></Td>
                  <Td>{recordValue(record, 'next_contact_at', 'nextContactAt') ? new Date(recordValue(record, 'next_contact_at', 'nextContactAt')).toLocaleString('bs-BA') : '—'}</Td>
                  <Td maxW="320px" whiteSpace="pre-wrap">{recordValue(record, 'notes') || '—'}</Td>
                  <Td><HStack><Button aria-label="Uredi komitenta" size="xs" leftIcon={<FaEdit />} variant="outline" onClick={() => openEdit(record)}>Uredi</Button><Button aria-label="Arhiviraj komitenta" size="xs" leftIcon={<FaTrash />} colorScheme="red" variant="ghost" onClick={() => remove(record)}>Arhiviraj</Button></HStack></Td>
                </Tr>
              );
            })}</Tbody>
            </Table>
          </Box>
        </>
      )}

      <Flex justify="space-between" align="center" direction={{ base: 'column', sm: 'row' }} gap={3}>
        <Text fontSize="sm" color="gray.600">Ukupno zapisa: {total}</Text>
        <HStack w={{ base: 'full', sm: 'auto' }} justify="center"><Button flex={{ base: 1, sm: 'initial' }} minH="40px" size="sm" variant="outline" isDisabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Prethodna</Button><Text flexShrink={0} fontSize="sm">{page} / {Math.max(1, pages)}</Text><Button flex={{ base: 1, sm: 'initial' }} minH="40px" size="sm" variant="outline" isDisabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Sljedeća</Button></HStack>
      </Flex>

      <RecordModal isOpen={modal.isOpen} onClose={modal.onClose} record={editing} brandCode={brandCode} onSaved={() => { toast({ title: 'Komitent je sačuvan.', status: 'success', position: 'top-right' }); changed(); }} />
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
            {brands.map((brand) => <TabPanel key={brand.code} px={{ base: 0, md: 1 }} py={5}>{brand.ready ? <BrandPanel brand={brand} user={user} /> : <WaitingBrand brand={brand} />}</TabPanel>)}
          </TabPanels>
        </Tabs>
      )}
    </Box>
  );
}
