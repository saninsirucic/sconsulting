import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel,
  Heading, HStack, Input, Link, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalFooter, ModalHeader, ModalOverlay, Select, SimpleGrid, Spinner, Text,
  Textarea, VStack, useToast,
} from '@chakra-ui/react';
import { FaSearch, FaExternalLinkAlt, FaEnvelope, FaPause, FaPlay } from 'react-icons/fa';
import { researchApi } from './researchApi';

export const STATUS_LABELS = {
  NEW: 'Novi', READY: 'Za kontakt', CONTACTED: 'Kontaktiran', INTERESTED: 'Zainteresovan',
  REJECTED: 'Nije relevantan', DO_NOT_CONTACT: 'Ne kontaktirati',
};
const OPENING_LABELS = { OPENED: 'Potvrđeno otvaranje', ANNOUNCED: 'Najavljeno otvaranje', UNCONFIRMED: 'Otvaranje treba provjeriti' };
const CATEGORY_LABELS = {
  RESTORAN: 'Restoran', HOTEL: 'Hotel', FAST_FOOD: 'Fast food', PEKARA: 'Pekara',
  SLASTICARNA: 'Slastičarna', CATERING: 'Catering', CAFFE_HRANA: 'Caffe s hranom',
  TRGOVINA_HRANOM: 'Trgovina hranom', PROIZVODNJA_HRANE: 'Proizvodnja hrane', OSTALO_HRANA: 'Hrana i ugostiteljstvo',
};
const RUN_LABELS = { RUNNING: 'U toku', COMPLETED: 'Završeno', FAILED: 'Neuspjelo', INTERRUPTED: 'Prekinuto' };
const dateTime = value => value ? new Intl.DateTimeFormat('bs-BA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Sarajevo' }).format(new Date(value)) : '—';
function sourceUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function SourceLink({ url, children }) {
  const href = sourceUrl(url);
  return href ? <Link href={href} isExternal color="blue.700" fontSize="sm" overflowWrap="anywhere">{children} <FaExternalLinkAlt style={{ display: 'inline', marginLeft: 3, fontSize: 10 }} /></Link> : null;
}

function LeadCard({ lead, busy, onStatus, onEdit }) {
  const mayContact = lead.status !== 'DO_NOT_CONTACT' && lead.status !== 'REJECTED';
  return (
    <Box p={{ base: 4, md: 5 }} bg="white" border="1px solid" borderColor="gray.200" borderRadius="xl">
      <Flex justify="space-between" align="start" gap={3} wrap="wrap">
        <Box><Heading size="md">{lead.name}</Heading><Text color="gray.600" fontSize="sm" mt={1}>{CATEGORY_LABELS[lead.category]} · {lead.municipality}</Text></Box>
        <Badge colorScheme={lead.opening_status === 'OPENED' ? 'green' : lead.opening_status === 'ANNOUNCED' ? 'blue' : 'yellow'} whiteSpace="normal">{OPENING_LABELS[lead.opening_status]}</Badge>
      </Flex>
      <VStack align="stretch" spacing={2} mt={4} fontSize="sm">
        {lead.address && <Text>{lead.address}</Text>}
        {lead.opening_date && <Text>Otvaranje: <strong>{lead.opening_date}</strong></Text>}
        {lead.opening_evidence && <Text color="gray.700">{lead.opening_evidence}</Text>}
        {lead.opening_source_url && <SourceLink url={lead.opening_source_url}>Izvor informacije o otvaranju</SourceLink>}
        <Box bg="gray.50" p={3} borderRadius="lg" mt={1}>
          <Text fontWeight="semibold" overflowWrap="anywhere">{lead.email || 'E-mail nije pronađen'}</Text>
          {lead.email_source_url && <SourceLink url={lead.email_source_url}>Izvor e-mail adrese</SourceLink>}
          <Text mt={2}>{lead.phone || 'Telefon nije pronađen'}</Text>
          {lead.phone_source_url && <SourceLink url={lead.phone_source_url}>Izvor telefona</SourceLink>}
          {lead.website && <Box mt={2}><SourceLink url={lead.website}>Web stranica objekta</SourceLink></Box>}
        </Box>
        {lead.crm_account_id && <Badge alignSelf="start" colorScheme="purple">Već postoji u FS App bazi — provjeri raniji kontakt</Badge>}
        {lead.contacted_at && <Text color="gray.600">Kontaktiran: {dateTime(lead.contacted_at)}</Text>}
        {lead.notes && <Text whiteSpace="pre-wrap" overflowWrap="anywhere">{lead.notes}</Text>}
        <FormControl mt={1}>
          <FormLabel fontSize="sm" htmlFor={`status-${lead.id}`}>Status za {lead.name}</FormLabel>
          <Select id={`status-${lead.id}`} size="sm" borderRadius="md" value={lead.status} isDisabled={busy} onChange={event => onStatus(lead, event.target.value)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FormControl>
        <Flex gap={2} wrap="wrap" mt={2}>
          {lead.email && mayContact && <Button as="a" size="sm" colorScheme="orange" variant="outline" leftIcon={<FaEnvelope />} href={`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent('HACCP – saradnja')}`}>Napiši e-mail</Button>}
          <Button size="sm" variant="ghost" onClick={() => onEdit(lead)}>Napomena</Button>
        </Flex>
        <Box as="details" mt={2}>
          <Text as="summary" cursor="pointer" color="gray.600">Izvori ({lead.sources?.length || 0}) · Pronađeno {dateTime(lead.first_seen_at)}</Text>
          <VStack align="start" spacing={2} mt={2}>
            {(lead.sources || []).map(source => <SourceLink key={source.url} url={source.url}>{source.title || source.url}</SourceLink>)}
            {lead.contact_evidence && <Text fontSize="xs" color="gray.600" overflowWrap="anywhere">Zabilježeni kontakt: {lead.contact_evidence}</Text>}
            <Text fontSize="xs" color="gray.500">Zadnji nalaz: {dateTime(lead.last_seen_at)}</Text>
          </VStack>
        </Box>
      </VStack>
    </Box>
  );
}

export default function HaccpResearch({ user }) {
  const toast = useToast();
  const director = user?.role === 'direktor';
  const [state, setState] = useState(null);
  const [result, setResult] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ search: '', status: '', opening_status: '', has_email: false, page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notes, setNotes] = useState('');
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [nextState, nextLeads] = await Promise.all([researchApi.state(), researchApi.leads(filters)]);
        if (active) { setState(nextState); setResult(nextLeads); setError(''); }
      } catch (err) { if (active) setError(err.message); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [filters, refreshKey]);

  useEffect(() => {
    if (!state?.running && !state?.settings.enabled) return undefined;
    const timer = setInterval(refresh, state.running ? 5000 : 60000);
    return () => clearInterval(timer);
  }, [state?.running, state?.settings.enabled, refresh]);

  const perform = async (action, success) => {
    setBusy(true);
    try {
      await action();
      toast({ title: success, status: 'success', duration: 4000, isClosable: true });
      refresh();
      return true;
    } catch (err) { toast({ title: err.message, status: 'error', duration: 7000, isClosable: true }); return false; }
    finally { setBusy(false); }
  };
  const setFilter = (key, value) => setFilters(old => ({ ...old, [key]: value, page: key === 'page' ? value : 1 }));
  const run = () => perform(async () => { await researchApi.run(); setState(old => ({ ...old, running: true })); }, 'Pretraga je pokrenuta. Rezultati će se pojaviti ovdje.');
  const changeEnabled = () => perform(() => researchApi.settings({ enabled: !state.settings.enabled }), state.settings.enabled ? 'Raspored je pauziran. Pretraga koja je u toku može završiti.' : 'Automatsko istraživanje je uključeno.');
  const lastRun = state?.runs?.[0];
  const total = Object.values(state?.counts || {}).reduce((sum, count) => sum + count, 0);

  return (
    <Box>
      <Flex justify="space-between" gap={4} wrap="wrap" align="start" mb={5}>
        <Box maxW="720px">
          <HStack mb={2}><Badge colorScheme="orange">HACCP</Badge><Badge colorScheme={state?.settings.enabled ? 'green' : 'gray'}>{state?.settings.enabled ? 'Raspored aktivan' : 'Raspored pauziran'}</Badge></HStack>
          <Heading size="lg">Novi objekti, nove prilike</Heading>
          <Text color="gray.600" mt={2}>Restorani, hoteli, fast foodovi i drugi objekti s hranom u Kantonu Sarajevo. Javni poslovni kontakti i izvori za tvoju HACCP ponudu.</Text>
        </Box>
        <HStack flexWrap="wrap">
          <Button size="sm" onClick={refresh} isDisabled={busy}>Osvježi</Button>
          {director && <Button colorScheme="orange" leftIcon={<FaSearch />} isDisabled={!state?.provider.configured || state?.running || busy} onClick={run}>{state?.running ? 'Pretraga u toku' : 'Istraži sada'}</Button>}
        </HStack>
      </Flex>
      {error && <Alert status="error" mb={4} borderRadius="lg"><AlertIcon />{error}</Alert>}
      {state && !state.provider.configured && <Alert status="warning" mb={4} borderRadius="lg"><AlertIcon />{state.provider.message}</Alert>}
      {state?.running && <Alert status="info" mb={4} borderRadius="lg"><AlertIcon />Agent istražuje javne izvore. Možeš napustiti ovu karticu; rezultat se čuva na serveru.</Alert>}

      <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={3} mb={5}>
        {[[total, 'Ukupno objekata'], [state?.counts.NEW || 0, 'Novi za pregled'], [state?.counts.READY || 0, 'Za kontakt'], [(state?.counts.CONTACTED || 0) + (state?.counts.INTERESTED || 0), 'Kontaktirani / zainteresovani']].map(([value, label]) => (
          <Box key={label} bg="white" p={4} borderRadius="xl" border="1px solid" borderColor="gray.200"><Text color="gray.600" fontSize="sm">{label}</Text><Text fontWeight="bold" fontSize="2xl">{value}</Text></Box>
        ))}
      </SimpleGrid>

      {state && <Box bg="orange.50" p={4} borderRadius="xl" mb={5}>
        <Flex justify="space-between" gap={4} wrap="wrap" align="center">
          <Box><Text fontWeight="semibold">Provjera svakih {state.settings.interval_hours} h · otvaranja u posljednjih {state.settings.lookback_days} dana</Text>
            <Text fontSize="sm" mt={1}>Sljedeća provjera: {state.settings.enabled ? dateTime(state.settings.next_run_at) : 'pauzirana'} · do {state.settings.max_results} rezultata po provjeri</Text>
            <Text fontSize="xs" mt={1} color="gray.600">Vrijeme: Sarajevo. Pretraga koristi plaćeni AI servis; broj rezultata zavisi od javno dostupnih izvora. Ručna provjera je dostupna jednom na sat.</Text>
          </Box>
          {director && <HStack><Button size="sm" variant="outline" onClick={() => setSettings({ ...state.settings })}>Postavke</Button><Button size="sm" leftIcon={state.settings.enabled ? <FaPause /> : <FaPlay />} isDisabled={busy || (!state.provider.configured && !state.settings.enabled)} onClick={changeEnabled}>{state.settings.enabled ? 'Pauziraj' : 'Uključi raspored'}</Button></HStack>}
        </Flex>
      </Box>}

      {!!state?.source_plan?.length && <Box as="details" mb={5} p={4} bg="white" border="1px solid" borderColor="gray.200" borderRadius="xl">
        <Text as="summary" cursor="pointer" fontWeight="semibold">Gdje agent traži · web, društvene mreže i poslovni profili</Text>
        <SimpleGrid columns={{ base: 1, lg: 3 }} gap={4} mt={4}>
          {state.source_plan.map(group => {
            const coverage = lastRun?.usage?.coverage?.find(item => item.id === group.id);
            return <Box key={group.id}>
              <Text fontWeight="semibold">{group.label}</Text>
              <Text fontSize="sm" color="gray.600" mt={1}>{group.channels.join(', ')}</Text>
              {coverage && <Box mt={2}><Badge colorScheme={coverage.status === 'COMPLETED' ? 'green' : 'yellow'}>{coverage.status === 'COMPLETED' ? 'Pretraga izvršena' : 'Pretraga nedostupna'}</Badge>
                <Text fontSize="xs" mt={1} overflowWrap="anywhere">Izvori iz zadnje provjere: {coverage.domains?.length ? `${coverage.domains.slice(0, 12).join(', ')}${coverage.domains.length > 12 ? ` i još ${coverage.domains.length - 12}` : ''}` : 'nema dostupnih izvora'}</Text></Box>}
            </Box>;
          })}
        </SimpleGrid>
        <Text fontSize="sm" color="gray.600" mt={3}>Ovo su ciljani izvori. Agent pretražuje javno dostupne i indeksirane stranice; ne vidi privatne profile, zatvorene grupe ni objave koje traže prijavu. Izvršena pretraga ne znači da su sve objave ili sve platforme bile dostupne. Google Maps se provjerava putem javnih web rezultata.</Text>
      </Box>}

      {lastRun && <Box mb={5} fontSize="sm"><Text>Zadnja provjera: {dateTime(lastRun.started_at)} · <strong>{RUN_LABELS[lastRun.status]}</strong>{lastRun.status === 'COMPLETED' && ` · ${lastRun.new_count} novih, ${lastRun.updated_count} dopunjenih, ${lastRun.skipped_count} izostavljenih`}</Text>{lastRun.error && <Text color="red.700" mt={1}>{lastRun.error}</Text>}{lastRun.notes && <Text color="gray.600" mt={1}>{lastRun.notes}</Text>}</Box>}

      <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap={3} mb={4}>
        <FormControl><FormLabel fontSize="sm">Pretraga objekata</FormLabel><Input bg="white" placeholder="Naziv, općina ili e-mail" value={filters.search} onChange={e => setFilter('search', e.target.value)} /></FormControl>
        <FormControl><FormLabel fontSize="sm" htmlFor="research-status">Status</FormLabel><Select id="research-status" bg="white" value={filters.status} onChange={e => setFilter('status', e.target.value)}><option value="">Svi statusi</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl>
        <FormControl><FormLabel fontSize="sm" htmlFor="research-opening">Otvaranje</FormLabel><Select id="research-opening" bg="white" value={filters.opening_status} onChange={e => setFilter('opening_status', e.target.value)}><option value="">Sve potvrde</option>{Object.entries(OPENING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl>
        <Checkbox alignSelf="end" mb={3} isChecked={filters.has_email} onChange={e => setFilter('has_email', e.target.checked)}>Samo s e-mail adresom</Checkbox>
      </SimpleGrid>
      <Text fontSize="sm" color="gray.600" mb={4}>Provjeri izvor prije kontakta. „Napiši e-mail“ otvara tvoj program za poštu; nakon slanja označi „Kontaktiran“.</Text>
      {loading && <HStack mb={3}><Spinner size="sm" /><Text fontSize="sm">Učitavanje rezultata...</Text></HStack>}
      {!loading && !error && result.items.length === 0 && <Box p={8} textAlign="center" border="1px dashed" borderColor="gray.300" borderRadius="xl"><Heading size="md">{total ? 'Nema objekata za odabrane filtere' : 'Prvi rezultati će se pojaviti ovdje'}</Heading><Text color="gray.600" mt={2}>{total ? 'Promijeni filtere da pregledaš ostale objekte.' : 'Pokreni istraživanje ili uključi raspored nakon povezivanja servisa za pretragu.'}</Text></Box>}
      <SimpleGrid columns={{ base: 1, xl: 2 }} gap={4}>{result.items.map(lead => <LeadCard key={lead.id} lead={lead} busy={busy} onStatus={(item, status) => perform(() => researchApi.updateLead(item.id, { status }), 'Status je sačuvan.')} onEdit={item => { setEditing(item); setNotes(item.notes || ''); }} />)}</SimpleGrid>
      {result.total > 0 && <Flex mt={5} align="center" justify="space-between" gap={3}><Text fontSize="sm">{result.total} objekata · stranica {filters.page} / {result.pages}</Text><HStack><Button size="sm" isDisabled={filters.page <= 1 || loading} onClick={() => setFilter('page', filters.page - 1)}>Prethodna</Button><Button size="sm" isDisabled={filters.page >= result.pages || loading} onClick={() => setFilter('page', filters.page + 1)}>Sljedeća</Button></HStack></Flex>}

      {!!state?.runs?.length && <Box as="details" mt={6} p={4} bg="white" borderRadius="lg"><Text as="summary" cursor="pointer" fontWeight="semibold">Historija posljednjih provjera</Text><VStack align="stretch" mt={3} spacing={3}>{state.runs.map(item => <Box key={item.id} borderTop="1px solid" borderColor="gray.100" pt={2}><Text fontSize="sm">{dateTime(item.started_at)} · {RUN_LABELS[item.status]} · {item.new_count} novih</Text>{item.error && <Text fontSize="sm" color="red.700">{item.error}</Text>}</Box>)}</VStack></Box>}

      <Modal isOpen={Boolean(settings)} onClose={() => setSettings(null)}><ModalOverlay /><ModalContent mx={4}><ModalHeader>Postavke istraživanja</ModalHeader><ModalCloseButton /><ModalBody><VStack spacing={4}>
        <FormControl><FormLabel htmlFor="research-interval">Učestalost</FormLabel><Select id="research-interval" value={settings?.interval_hours || 24} onChange={e => setSettings(old => ({ ...old, interval_hours: Number(e.target.value) }))}><option value={24}>Svaki dan</option><option value={48}>Svaka dva dana</option><option value={72}>Svaka tri dana</option><option value={168}>Jednom sedmično</option></Select></FormControl>
        <FormControl><FormLabel htmlFor="research-lookback">Period otvaranja (dani)</FormLabel><Input id="research-lookback" type="number" min={7} max={180} value={settings?.lookback_days ?? 90} onChange={e => setSettings(old => ({ ...old, lookback_days: Number(e.target.value) }))} /></FormControl>
        <FormControl><FormLabel htmlFor="research-limit">Najviše rezultata po provjeri</FormLabel><Input id="research-limit" type="number" min={1} max={25} value={settings?.max_results ?? 20} onChange={e => setSettings(old => ({ ...old, max_results: Number(e.target.value) }))} /></FormControl>
        <Text fontSize="sm" color="gray.600">Obuhvat: Kanton Sarajevo. Javne objave, službene stranice i dostupni poslovni profili. Nepoznat datum otvaranja ostaje označen za provjeru.</Text>
      </VStack></ModalBody><ModalFooter><Button variant="ghost" mr={2} onClick={() => setSettings(null)}>Odustani</Button><Button colorScheme="orange" isLoading={busy} onClick={async () => { if (await perform(() => researchApi.settings({ interval_hours: settings.interval_hours, lookback_days: settings.lookback_days, max_results: settings.max_results }), 'Postavke su sačuvane.')) setSettings(null); }}>Sačuvaj</Button></ModalFooter></ModalContent></Modal>

      <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)}><ModalOverlay /><ModalContent mx={4}><ModalHeader>Napomena · {editing?.name}</ModalHeader><ModalCloseButton /><ModalBody><Textarea aria-label="Napomena za objekt" maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} minH="160px" /></ModalBody><ModalFooter><Button colorScheme="orange" isLoading={busy} onClick={async () => { if (await perform(() => researchApi.updateLead(editing.id, { notes }), 'Napomena je sačuvana.')) setEditing(null); }}>Sačuvaj napomenu</Button></ModalFooter></ModalContent></Modal>
    </Box>
  );
}
