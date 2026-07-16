import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
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
  StatHelpText,
  StatLabel,
  StatNumber,
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
  Wrap,
  WrapItem
} from '@chakra-ui/react';
import {
  FaAddressBook,
  FaBan,
  FaChartLine,
  FaCheckCircle,
  FaEnvelope,
  FaExclamationTriangle,
  FaFileImport,
  FaPaperPlane,
  FaPlus,
  FaRobot,
  FaSave,
  FaSearch,
  FaUsers
} from 'react-icons/fa';
import { aiMailRequest } from './aiMail/api';

const orange = '#f68b1f';
const green = '#1dba5b';

const EMPTY_STATS = {
  totalContacts: 0,
  activeCampaigns: 0,
  drafts: 0,
  pendingApproval: 0,
  sentToday: 0,
  totalSent: 0,
  failed: 0,
  replies: 0,
  interested: 0,
  pendingFollowups: 0,
  suppressionRequests: 0
};

const STAT_CARDS = [
  ['totalContacts', 'Ukupno kontakata', FaUsers],
  ['activeCampaigns', 'Aktivne kampanje', FaPaperPlane],
  ['drafts', 'Mailovi u pripremi', FaRobot],
  ['pendingApproval', 'Čekaju odobrenje', FaCheckCircle],
  ['sentToday', 'Poslano danas', FaEnvelope],
  ['totalSent', 'Ukupno poslano', FaChartLine],
  ['failed', 'Neuspjela slanja', FaExclamationTriangle],
  ['replies', 'Primljeni odgovori', FaEnvelope],
  ['interested', 'Zainteresovani klijenti', FaUsers],
  ['pendingFollowups', 'Follow-up na čekanju', FaPaperPlane],
  ['suppressionRequests', 'Prekid komunikacije', FaBan]
];

const MODULE_SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', icon: FaChartLine, phase: 1 },
  { key: 'contacts', label: 'Kontakti', icon: FaAddressBook, phase: 1 },
  { key: 'import', label: 'Uvoz iz Excela', icon: FaFileImport, phase: 1 },
  { key: 'campaigns', label: 'Kampanje', icon: FaPaperPlane, phase: 2 },
  { key: 'drafts', label: 'AI nacrti', icon: FaRobot, phase: 2 },
  { key: 'replies', label: 'Odgovori', icon: FaEnvelope, phase: 4 },
  { key: 'reports', label: 'Izvještaji', icon: FaChartLine, phase: 4 },
  { key: 'suppression', label: 'Lista zabrane', icon: FaBan, phase: 4 }
];

function LoadingState({ label = 'Učitavanje...' }) {
  return (
    <Flex minH="180px" align="center" justify="center" gap={3} color="gray.600">
      <Spinner color={orange} />
      <Text>{label}</Text>
    </Flex>
  );
}

function EmptyState({ title, text, icon = FaEnvelope }) {
  return (
    <VStack py={12} spacing={3} color="gray.500" textAlign="center">
      <Icon as={icon} boxSize={10} color="orange.300" />
      <Text fontWeight="bold" color="gray.700">{title}</Text>
      <Text maxW="520px">{text}</Text>
    </VStack>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <Alert status="error" borderRadius="lg">
      <AlertIcon />
      <AlertDescription flex="1">{message}</AlertDescription>
      {onRetry && <Button size="sm" variant="outline" colorScheme="red" onClick={onRetry}>Pokušaj ponovo</Button>}
    </Alert>
  );
}

function DashboardPanel({ token, refreshKey }) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await aiMailRequest('/dashboard', { token }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadDashboard(); }, [loadDashboard, refreshKey]);

  if (loading) return <LoadingState label="Učitavanje AI mail statistika..." />;
  if (error) return <ErrorState message={error} onRetry={loadDashboard} />;

  return (
    <VStack align="stretch" spacing={6}>
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={4}>
        {STAT_CARDS.map(([key, label, icon]) => (
          <Stat key={key} p={4} bg="white" border="1px solid" borderColor="orange.100" borderRadius="xl" boxShadow="sm">
            <Flex justify="space-between" align="start">
              <Box>
                <StatLabel color="gray.600" minH="42px">{label}</StatLabel>
                <StatNumber color={key === 'failed' ? 'red.500' : 'gray.800'}>{stats[key] || 0}</StatNumber>
              </Box>
              <Flex bg="orange.50" color={orange} boxSize="38px" borderRadius="full" align="center" justify="center">
                <Icon as={icon} />
              </Flex>
            </Flex>
          </Stat>
        ))}
      </SimpleGrid>
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={5}>
        <Box p={5} border="1px solid" borderColor="gray.200" borderRadius="xl">
          <Heading size="sm" mb={2}>Poslano i odgovori po danima</Heading>
          <EmptyState title="Još nema aktivnosti" text="Grafikon će se prikazati nakon prvih testnih kampanja." icon={FaChartLine} />
        </Box>
        <Box p={5} border="1px solid" borderColor="gray.200" borderRadius="xl">
          <Heading size="sm" mb={2}>Siguran testni režim</Heading>
          <Alert status="success" borderRadius="lg" mt={4}>
            <AlertIcon />
            <Box>
              <Text fontWeight="bold">Stvarno slanje nije aktivno</Text>
              <Text fontSize="sm">Faza 1 nema mail provider niti queue putanju, pa nijedan mail ne može biti poslan.</Text>
            </Box>
          </Alert>
        </Box>
      </SimpleGrid>
    </VStack>
  );
}

const CONTACT_FORM_FIELDS = [
  ['company_name', 'Naziv firme', true],
  ['contact_person', 'Kontakt osoba'],
  ['email', 'E-mail', true],
  ['additional_email', 'Dodatni e-mail'],
  ['phone', 'Telefon'],
  ['website', 'Web stranica'],
  ['country', 'Država'],
  ['city', 'Grad'],
  ['postal_code', 'Poštanski broj'],
  ['address', 'Adresa'],
  ['industry', 'Djelatnost'],
  ['source', 'Izvor'],
  ['priority', 'Prioritet'],
  ['status', 'Status']
];

function ContactModal({ isOpen, onClose, contact, token, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setForm(contact || { sending_allowed: true }); setError(''); }, [contact, isOpen]);
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await aiMailRequest(contact ? `/contacts/${contact.id}` : '/contacts', {
        token,
        method: contact ? 'PUT' : 'POST',
        body: form
      });
      onSaved(saved);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{contact ? 'Uredi kontakt' : 'Novi kontakt'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            {CONTACT_FORM_FIELDS.map(([key, label, required]) => (
              <FormControl key={key} isRequired={required}>
                <FormLabel>{label}</FormLabel>
                <Input value={form[key] || ''} onChange={(event) => setField(key, event.target.value)} />
              </FormControl>
            ))}
            <FormControl gridColumn={{ md: 'span 2' }}>
              <FormLabel>Ranija komunikacija</FormLabel>
              <Textarea rows={4} value={form.previous_communication || ''} onChange={(event) => setField('previous_communication', event.target.value)} />
            </FormControl>
            <FormControl gridColumn={{ md: 'span 2' }}>
              <FormLabel>Napomena</FormLabel>
              <Textarea rows={3} value={form.notes || ''} onChange={(event) => setField('notes', event.target.value)} />
            </FormControl>
          </SimpleGrid>
          {error && <Box mt={4}><ErrorState message={error} /></Box>}
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="ghost" onClick={onClose}>Odustani</Button>
          <Button leftIcon={<FaSave />} bg={green} color="white" _hover={{ bg: 'green.600' }} isLoading={saving} onClick={save}>Sačuvaj</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ContactsPanel({ token, refreshKey, onChanged }) {
  const toast = useToast();
  const modal = useDisclosure();
  const [editing, setEditing] = useState(null);
  const [data, setData] = useState({ items: [], pagination: {}, filters: {} });
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page, perPage: 25, sortBy: 'company_name' });
    if (search.trim()) params.set('search', search.trim());
    if (country) params.set('country', country);
    if (priority) params.set('priority', priority);
    if (status) params.set('status', status);
    try {
      const result = await aiMailRequest(`/contacts?${params}`, { token });
      setData(result);
      setSelected([]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [country, page, priority, search, status, token]);

  useEffect(() => { loadContacts(); }, [loadContacts, refreshKey]);

  const openNew = () => { setEditing(null); modal.onOpen(); };
  const openEdit = (contact) => { setEditing(contact); modal.onOpen(); };
  const afterSaved = () => {
    toast({ title: 'Kontakt je sačuvan.', status: 'success', position: 'top-right' });
    loadContacts();
    onChanged();
  };

  const suppress = async (contact) => {
    if (!window.confirm(`Zaustaviti svu buduću komunikaciju za ${contact.email}?`)) return;
    try {
      await aiMailRequest(`/contacts/${contact.id}/suppress`, {
        token,
        method: 'POST',
        body: { reason: 'Ručno zaustavljena komunikacija' }
      });
      toast({ title: 'Kontakt je stavljen na listu zabrane.', status: 'success', position: 'top-right' });
      loadContacts();
      onChanged();
    } catch (requestError) {
      toast({ title: requestError.message, status: 'error', position: 'top-right' });
    }
  };

  const bulkAction = async (action) => {
    const label = action === 'ARCHIVE' ? 'arhivirati' : 'staviti na listu zabrane';
    if (!window.confirm(`Želite li ${label} ${selected.length} odabranih kontakata?`)) return;
    try {
      const result = await aiMailRequest('/contacts/bulk-action', {
        token,
        method: 'POST',
        body: { ids: selected, action }
      });
      toast({ title: `Obrađeno kontakata: ${result.affected}.`, status: 'success', position: 'top-right' });
      loadContacts();
      onChanged();
    } catch (requestError) {
      toast({ title: requestError.message, status: 'error', position: 'top-right' });
    }
  };

  return (
    <VStack align="stretch" spacing={4}>
      <Flex gap={3} direction={{ base: 'column', lg: 'row' }}>
        <HStack flex="1">
          <Icon as={FaSearch} color="gray.400" />
          <Input placeholder="Pretraži firmu, osobu ili e-mail" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </HStack>
        <Select maxW={{ lg: '190px' }} placeholder="Sve države" value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }}>
          {(data.filters.countries || []).map((value) => <option key={value}>{value}</option>)}
        </Select>
        <Select maxW={{ lg: '190px' }} placeholder="Svi prioriteti" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
          {(data.filters.priorities || []).map((value) => <option key={value}>{value}</option>)}
        </Select>
        <Select maxW={{ lg: '210px' }} placeholder="Svi statusi" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {(data.filters.statuses || []).map((value) => <option key={value}>{value}</option>)}
        </Select>
        <Button leftIcon={<FaPlus />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} onClick={openNew}>Novi kontakt</Button>
      </Flex>
      {selected.length > 0 && (
        <Alert status="info" borderRadius="lg">
          <AlertIcon />
          <Text flex="1">Odabrano kontakata: {selected.length}</Text>
          <HStack>
            <Button size="sm" variant="outline" onClick={() => bulkAction('ARCHIVE')}>Arhiviraj</Button>
            <Button size="sm" colorScheme="red" variant="outline" onClick={() => bulkAction('SUPPRESS')}>Zabrani slanje</Button>
          </HStack>
        </Alert>
      )}
      {error && <ErrorState message={error} onRetry={loadContacts} />}
      {loading ? <LoadingState label="Učitavanje kontakata..." /> : data.items.length === 0 ? (
        <EmptyState title="Nema kontakata" text="Uvezite Excel bazu ili ručno dodajte prvi kontakt." icon={FaAddressBook} />
      ) : (
        <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="xl">
          <Table size="sm">
            <Thead bg="orange.50">
              <Tr>
                <Th><Checkbox isChecked={selected.length === data.items.length} onChange={(e) => setSelected(e.target.checked ? data.items.map((item) => item.id) : [])} /></Th>
                <Th>Firma</Th><Th>E-mail</Th><Th>Država / grad</Th><Th>Prioritet</Th><Th>Status</Th><Th>Slanje</Th><Th>Akcije</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((contact) => (
                <Tr key={contact.id} _hover={{ bg: 'gray.50' }}>
                  <Td><Checkbox isChecked={selected.includes(contact.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} /></Td>
                  <Td><Text fontWeight="semibold">{contact.company_name}</Text><Text fontSize="xs" color="gray.500">{contact.contact_person || '—'}</Text></Td>
                  <Td>{contact.email}</Td>
                  <Td>{[contact.country, contact.city].filter(Boolean).join(' / ') || '—'}</Td>
                  <Td><Badge colorScheme={String(contact.priority || '').toLowerCase().includes('visok') ? 'red' : 'orange'}>{contact.priority || '—'}</Badge></Td>
                  <Td>{contact.status || '—'}</Td>
                  <Td><Badge colorScheme={contact.sending_allowed ? 'green' : 'red'}>{contact.sending_allowed ? 'Dozvoljeno' : 'Zabranjeno'}</Badge></Td>
                  <Td><HStack><Button size="xs" variant="outline" onClick={() => openEdit(contact)}>Uredi</Button><Button size="xs" colorScheme="red" variant="ghost" isDisabled={!contact.sending_allowed} onClick={() => suppress(contact)}>Zabrani</Button></HStack></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
      <Flex justify="space-between" align="center">
        <Text fontSize="sm" color="gray.600">Ukupno: {data.pagination.total || 0}</Text>
        <HStack>
          <Button size="sm" variant="outline" isDisabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Prethodna</Button>
          <Text fontSize="sm">{page} / {Math.max(1, data.pagination.pages || 1)}</Text>
          <Button size="sm" variant="outline" isDisabled={page >= (data.pagination.pages || 1)} onClick={() => setPage((value) => value + 1)}>Sljedeća</Button>
        </HStack>
      </Flex>
      <ContactModal isOpen={modal.isOpen} onClose={modal.onClose} contact={editing} token={token} onSaved={afterSaved} />
    </VStack>
  );
}

function ImportPanel({ token, onImported }) {
  const toast = useToast();
  const inputRef = useRef();
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState({});
  const [duplicateStrategy, setDuplicateStrategy] = useState('skip');
  const [mappingName, setMappingName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const sheet = useMemo(() => analysis?.sheets.find((item) => item.name === sheetName), [analysis, sheetName]);

  const selectSheet = useCallback((name, source = analysis) => {
    const selected = source?.sheets.find((item) => item.name === name);
    setSheetName(name);
    setMapping(selected?.suggestedMapping || {});
    setMappingName(`${name} mapiranje`);
    setReport(null);
  }, [analysis]);

  const analyze = async () => {
    if (!file) return setError('Odaberite Excel fajl.');
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await aiMailRequest('/import/analyze', { token, method: 'POST', body });
      setAnalysis(result);
      const defaultSheet = result.sheets.find((item) => !item.auxiliary) || result.sheets[0];
      if (defaultSheet) {
        setSheetName(defaultSheet.name);
        setMapping(defaultSheet.suggestedMapping || {});
        setMappingName(`${defaultSheet.name} mapiranje`);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const runImport = async () => {
    if (!sheet || mapping.company_name === undefined || mapping.email === undefined) {
      return setError('Mapirajte najmanje naziv firme i e-mail.');
    }
    setLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('sheetName', sheet.name);
      body.append('headerRow', String(sheet.detectedHeaderRow));
      body.append('mapping', JSON.stringify(mapping));
      body.append('duplicateStrategy', duplicateStrategy);
      body.append('mappingName', mappingName);
      const result = await aiMailRequest('/import', { token, method: 'POST', body });
      setReport(result);
      toast({ title: 'Uvoz je završen.', status: 'success', position: 'top-right' });
      onImported();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <VStack align="stretch" spacing={6}>
      <Box p={5} bg="orange.50" borderRadius="xl" border="1px solid" borderColor="orange.100">
        <Heading size="sm" mb={2}>1. Odaberite Excel bazu</Heading>
        <Flex gap={3} direction={{ base: 'column', md: 'row' }} align={{ md: 'center' }}>
          <Input ref={inputRef} type="file" accept=".xlsx" bg="white" onChange={(event) => { setFile(event.target.files[0] || null); setAnalysis(null); setReport(null); }} />
          <Button leftIcon={<FaFileImport />} bg={orange} color="white" _hover={{ bg: 'orange.500' }} minW="180px" isLoading={loading && !analysis} onClick={analyze}>Analiziraj fajl</Button>
        </Flex>
        <Text mt={2} fontSize="sm" color="gray.600">Maksimalno 10 MB, samo .xlsx. Fajl se obrađuje na backendu i ne šalje se iz browsera trećoj strani.</Text>
      </Box>

      {error && <ErrorState message={error} />}
      {loading && analysis && <LoadingState label="Uvoz kontakata je u toku..." />}

      {analysis && !loading && (
        <>
          <Box>
            <Heading size="sm" mb={3}>2. Sheet i pregled podataka</Heading>
            <Select value={sheetName} onChange={(event) => selectSheet(event.target.value)} maxW="460px">
              {analysis.sheets.map((item) => (
                <option key={item.name} value={item.name}>{item.name} — {item.rowCount} redova{item.auxiliary ? ' (pomoćni)' : ''}</option>
              ))}
            </Select>
            {sheet?.auxiliary && (
              <Alert status="warning" mt={3} borderRadius="lg"><AlertIcon /><Text>Ovaj sheet je prepoznat kao pomoćni ili zbirni. Uvozite ga samo nakon ručne provjere.</Text></Alert>
            )}
            <Text mt={2} fontSize="sm" color="gray.600">Detektovano zaglavlje: red {sheet?.detectedHeaderRow}; kolona: {sheet?.columnCount}</Text>
          </Box>

          <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="xl">
            <Table size="sm">
              <Thead bg="gray.50"><Tr><Th>Red</Th>{sheet?.headers.map((header) => <Th key={header.index} minW="160px">{header.column}: {header.label}</Th>)}</Tr></Thead>
              <Tbody>{sheet?.preview.map((row) => <Tr key={row.rowNumber}><Td>{row.rowNumber}</Td>{sheet.headers.map((header) => <Td key={header.index} maxW="300px" whiteSpace="normal">{String(row.values[header.column] ?? '')}</Td>)}</Tr>)}</Tbody>
            </Table>
          </Box>

          <Box>
            <Heading size="sm" mb={3}>3. Mapiranje kolona</Heading>
            <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
              {analysis.fields.map((field) => (
                <FormControl key={field.key} isRequired={field.required}>
                  <FormLabel fontSize="sm">{field.label}</FormLabel>
                  <Select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => {
                    const next = { ...current };
                    if (event.target.value === '') delete next[field.key];
                    else next[field.key] = Number(event.target.value);
                    return next;
                  })}>
                    <option value="">— Ne uvozi —</option>
                    {sheet?.headers.map((header) => <option key={header.index} value={header.index}>{header.column}: {header.label}</option>)}
                  </Select>
                </FormControl>
              ))}
            </SimpleGrid>
          </Box>

          <Grid templateColumns={{ base: '1fr', lg: 'repeat(3, 1fr)' }} gap={4}>
            <GridItem><FormControl><FormLabel>Postupanje s duplikatima</FormLabel><Select value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value)}><option value="skip">Preskoči duplikate</option><option value="update">Ažuriraj postojeće</option><option value="create">Kreiraj novi ako je samo naziv isti</option></Select></FormControl></GridItem>
            <GridItem><FormControl><FormLabel>Naziv mapiranja</FormLabel><Input value={mappingName} onChange={(e) => setMappingName(e.target.value)} /></FormControl></GridItem>
            <GridItem display="flex" alignItems="end"><Button w="full" leftIcon={<FaFileImport />} bg={green} color="white" _hover={{ bg: 'green.600' }} onClick={runImport}>Pokreni kontrolisani uvoz</Button></GridItem>
          </Grid>
        </>
      )}

      {report && (
        <Box p={5} border="1px solid" borderColor="green.200" bg="green.50" borderRadius="xl">
          <Heading size="sm" mb={4}>Izvještaj uvoza</Heading>
          <SimpleGrid columns={{ base: 2, md: 5 }} spacing={4}>
            {[['Uvezeno', report.imported], ['Ažurirano', report.updated], ['Preskočeno', report.skipped], ['Neispravno', report.invalid], ['Duplikati', report.duplicates]].map(([label, value]) => <Stat key={label}><StatLabel>{label}</StatLabel><StatNumber>{value}</StatNumber><StatHelpText>od {report.total}</StatHelpText></Stat>)}
          </SimpleGrid>
          {report.errors?.length > 0 && <Alert status="warning" mt={4} borderRadius="lg"><AlertIcon /><Text>Prikazano prvih {report.errors.length} grešaka. Detalji su sačuvani u evidenciji uvoza.</Text></Alert>}
        </Box>
      )}
    </VStack>
  );
}

function FuturePanel({ section }) {
  return <EmptyState title={`${section.label} — Faza ${section.phase}`} text="Podatkovna struktura je pripremljena, a funkcionalni UI dolazi u narednoj kontrolisanoj fazi." icon={section.icon} />;
}

function AiMailModule({ token }) {
  const [sectionKey, setSectionKey] = useState('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const section = MODULE_SECTIONS.find((item) => item.key === sectionKey) || MODULE_SECTIONS[0];
  const refresh = () => setRefreshKey((value) => value + 1);

  return (
    <Box>
      <Flex justify="space-between" align={{ base: 'start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={3} mb={5}>
        <Box>
          <HStack><Icon as={FaRobot} color={orange} boxSize={6} /><Heading size="lg">AI mailovi</Heading><Badge colorScheme="orange">Faza 1</Badge></HStack>
          <Text color="gray.600" mt={1}>Kontakti, siguran Excel uvoz i pregled prodajnih aktivnosti</Text>
        </Box>
        <Badge colorScheme="green" px={3} py={2} borderRadius="full">Testni režim • slanje isključeno</Badge>
      </Flex>
      <Wrap spacing={2} mb={5}>
        {MODULE_SECTIONS.map((item) => (
          <WrapItem key={item.key}>
            <Button size="sm" leftIcon={<Icon as={item.icon} />} variant={sectionKey === item.key ? 'solid' : 'outline'} bg={sectionKey === item.key ? orange : 'white'} color={sectionKey === item.key ? 'white' : 'gray.700'} borderColor="orange.200" _hover={{ bg: sectionKey === item.key ? 'orange.500' : 'orange.50' }} onClick={() => setSectionKey(item.key)}>
              {item.label}{item.phase > 1 && <Badge ml={2} colorScheme="gray">F{item.phase}</Badge>}
            </Button>
          </WrapItem>
        ))}
      </Wrap>
      <Divider mb={6} />
      {sectionKey === 'dashboard' && <DashboardPanel token={token} refreshKey={refreshKey} />}
      {sectionKey === 'contacts' && <ContactsPanel token={token} refreshKey={refreshKey} onChanged={refresh} />}
      {sectionKey === 'import' && <ImportPanel token={token} onImported={refresh} />}
      {!['dashboard', 'contacts', 'import'].includes(sectionKey) && <FuturePanel section={section} />}
    </Box>
  );
}

export default AiMailModule;
