import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  useToast,
  VStack
} from '@chakra-ui/react';
import { FaCheckCircle, FaHistory, FaPaperPlane, FaRobot, FaSave, FaSyncAlt } from 'react-icons/fa';
import { aiMailRequest } from './api';

const orange = '#f68b1f';
const green = '#1dba5b';

const EMPTY_CAMPAIGN = {
  name: '',
  description: '',
  product_service: '',
  goal: '',
  language: 'bs',
  market_country: 'Bosna i Hercegovina',
  offer_information: '',
  tone: 'Profesionalan, jasan i nenametljiv',
  subject_guidance: '',
  call_to_action: 'Predložiti kratak uvodni razgovor',
  signature: 'S Consulting prodajni tim',
  allowed_facts: '',
  forbidden_claims: 'Ne izmišljati cijene, popuste, reference, certifikate ili garantovane rezultate.'
};

const STATUS_LABELS = {
  DRAFT: 'U pripremi',
  PENDING_APPROVAL: 'Čeka odobrenje',
  APPROVED: 'Odobreno — nije zakazano'
};

function statusColor(status) {
  if (status === 'APPROVED') return 'green';
  if (status === 'PENDING_APPROVAL') return 'orange';
  return 'gray';
}

function RequestError({ message }) {
  if (!message) return null;
  return <Alert status="error" borderRadius="lg"><AlertIcon /><Text>{message}</Text></Alert>;
}

function PanelLoader({ label }) {
  return <Flex minH="180px" align="center" justify="center" gap={3}><Spinner color={orange} /><Text color="gray.600">{label}</Text></Flex>;
}

export function CampaignsPanel({ token, refreshKey, onChanged, onOpenDrafts }) {
  const toast = useToast();
  const [metadata, setMetadata] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState(EMPTY_CAMPAIGN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [metaResult, campaignResult, contactResult] = await Promise.all([
        aiMailRequest('/metadata', { token }),
        aiMailRequest('/campaigns', { token }),
        aiMailRequest('/contacts?perPage=100&sortBy=company_name&sendingAllowed=true', { token })
      ]);
      setMetadata(metaResult);
      setCampaigns(campaignResult);
      setContacts(contactResult.items || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filteredContacts = useMemo(() => {
    const needle = contactSearch.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => [contact.company_name, contact.contact_person, contact.email]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [contactSearch, contacts]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const create = async () => {
    if (!form.name.trim() || !form.product_service.trim() || !form.goal.trim()) {
      return setError('Naziv, usluga/proizvod i cilj kampanje su obavezni.');
    }
    if (!selected.length) return setError('Odaberite najmanje jednog primaoca.');
    setSaving(true);
    setError('');
    try {
      const result = await aiMailRequest('/campaigns', {
        token,
        method: 'POST',
        body: { ...form, contact_ids: selected }
      });
      toast({
        title: 'Kampanja je sačuvana kao nacrt.',
        description: `Aktivni primaoci: ${result.recipientReport.eligible}; isključeni: ${result.recipientReport.excluded}.`,
        status: 'success',
        position: 'top-right'
      });
      setForm(EMPTY_CAMPAIGN);
      setSelected([]);
      await load();
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const generate = async (campaign) => {
    const count = campaign.recipients?.ACTIVE || 0;
    if (!window.confirm(`Pokrenuti OpenAI generisanje za ${count} aktivnih primalaca? Kreirat će se samo nacrti; nijedan e-mail neće biti poslan.`)) return;
    setGeneratingId(campaign.id);
    setError('');
    try {
      const report = await aiMailRequest(`/campaigns/${campaign.id}/generate-drafts`, {
        token,
        method: 'POST',
        body: { confirmed: true }
      });
      toast({
        title: 'Generisanje nacrta je završeno.',
        description: `Novi: ${report.generated}; preskočeni: ${report.skipped}; greške: ${report.failed}.`,
        status: report.failed ? 'warning' : 'success',
        position: 'top-right'
      });
      await load();
      onChanged();
      onOpenDrafts(campaign.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setGeneratingId('');
    }
  };

  if (loading) return <PanelLoader label="Učitavanje kampanja i primalaca..." />;

  return (
    <VStack align="stretch" spacing={6}>
      <Alert status="info" borderRadius="xl">
        <AlertIcon />
        <Box>
          <Text fontWeight="bold">Faza 2 kreira samo nacrte</Text>
          <Text fontSize="sm">Generisanje koristi OpenAI tek nakon vaše potvrde. Odobren nacrt ostaje izvan queue-a i ne može biti poslan iz ove faze.</Text>
        </Box>
      </Alert>
      {!metadata?.mail?.openAiConfigured && (
        <Alert status="warning" borderRadius="xl">
          <AlertIcon />
          <Text>Za generisanje treba backend konfiguracija OPENAI_API_KEY i OPENAI_MODEL. Kampanje i primaoce možete pripremiti i bez ključa.</Text>
        </Alert>
      )}
      <RequestError message={error} />

      <Box border="1px solid" borderColor="orange.100" borderRadius="xl" p={5} bg="orange.50">
        <Heading size="md" mb={4}>Nova kampanja</Heading>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <FormControl isRequired><FormLabel>Naziv kampanje</FormLabel><Input bg="white" value={form.name} onChange={(e) => setField('name', e.target.value)} /></FormControl>
          <FormControl isRequired><FormLabel>Usluga ili proizvod</FormLabel><Input bg="white" value={form.product_service} onChange={(e) => setField('product_service', e.target.value)} /></FormControl>
          <FormControl isRequired><FormLabel>Cilj poruke</FormLabel><Input bg="white" value={form.goal} onChange={(e) => setField('goal', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Tržište</FormLabel><Input bg="white" value={form.market_country} onChange={(e) => setField('market_country', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Jezik</FormLabel><Select bg="white" value={form.language} onChange={(e) => setField('language', e.target.value)}><option value="bs">Bosanski</option><option value="en">Engleski</option><option value="de">Njemački</option></Select></FormControl>
          <FormControl><FormLabel>Ton</FormLabel><Input bg="white" value={form.tone} onChange={(e) => setField('tone', e.target.value)} /></FormControl>
          <FormControl gridColumn={{ md: 'span 2' }}><FormLabel>Opis / kontekst kampanje</FormLabel><Textarea bg="white" rows={2} value={form.description} onChange={(e) => setField('description', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Informacije o ponudi</FormLabel><Textarea bg="white" rows={3} value={form.offer_information} onChange={(e) => setField('offer_information', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Poziv na akciju</FormLabel><Textarea bg="white" rows={3} value={form.call_to_action} onChange={(e) => setField('call_to_action', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Dozvoljene činjenice</FormLabel><Textarea bg="white" rows={4} value={form.allowed_facts} onChange={(e) => setField('allowed_facts', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Zabranjene tvrdnje</FormLabel><Textarea bg="white" rows={4} value={form.forbidden_claims} onChange={(e) => setField('forbidden_claims', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Smjernica za predmet</FormLabel><Input bg="white" value={form.subject_guidance} onChange={(e) => setField('subject_guidance', e.target.value)} /></FormControl>
          <FormControl><FormLabel>Potpis</FormLabel><Input bg="white" value={form.signature} onChange={(e) => setField('signature', e.target.value)} /></FormControl>
        </SimpleGrid>

        <Box mt={5} bg="white" p={4} borderRadius="lg" border="1px solid" borderColor="gray.200">
          <Flex gap={3} align={{ base: 'stretch', md: 'center' }} direction={{ base: 'column', md: 'row' }} mb={3}>
            <Box flex="1"><Text fontWeight="bold">Primaoci</Text><Text fontSize="sm" color="gray.600">Prikazani su samo aktivni kontakti kojima je slanje trenutno dozvoljeno.</Text></Box>
            <Input maxW={{ md: '340px' }} placeholder="Pretraži kontakte" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
            <Button variant="outline" onClick={() => setSelected(filteredContacts.map((contact) => contact.id))}>Odaberi prikazane</Button>
            <Button variant="ghost" onClick={() => setSelected([])}>Poništi</Button>
          </Flex>
          <Box maxH="280px" overflowY="auto" border="1px solid" borderColor="gray.100" borderRadius="md">
            <Table size="sm">
              <Thead position="sticky" top={0} bg="gray.50" zIndex={1}><Tr><Th></Th><Th>Firma</Th><Th>E-mail</Th><Th>Lokacija</Th></Tr></Thead>
              <Tbody>
                {filteredContacts.map((contact) => (
                  <Tr key={contact.id}>
                    <Td><Checkbox isChecked={selected.includes(contact.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...new Set([...current, contact.id])] : current.filter((id) => id !== contact.id))} /></Td>
                    <Td>{contact.company_name}</Td><Td>{contact.email}</Td><Td>{[contact.country, contact.city].filter(Boolean).join(' / ') || '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
          <Flex mt={4} justify="space-between" align="center"><Text fontWeight="semibold">Odabrano: {selected.length}</Text><Button leftIcon={<FaSave />} bg={green} color="white" _hover={{ bg: 'green.600' }} isLoading={saving} onClick={create}>Sačuvaj kampanju</Button></Flex>
        </Box>
      </Box>

      <Box>
        <Heading size="md" mb={4}>Kampanje u pripremi</Heading>
        {campaigns.length === 0 ? <Text color="gray.500">Još nema kreiranih kampanja.</Text> : (
          <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="xl">
            <Table size="sm">
              <Thead bg="gray.50"><Tr><Th>Kampanja</Th><Th>Primaoci</Th><Th>Nacrti</Th><Th>Status</Th><Th>Akcije</Th></Tr></Thead>
              <Tbody>
                {campaigns.map((campaign) => (
                  <Tr key={campaign.id}>
                    <Td><Text fontWeight="semibold">{campaign.name}</Text><Text fontSize="xs" color="gray.500">{campaign.product_service || '—'}</Text></Td>
                    <Td><Badge colorScheme="green">{campaign.recipients?.ACTIVE || 0} aktivnih</Badge>{Boolean(campaign.recipients?.EXCLUDED) && <Badge ml={2} colorScheme="red">{campaign.recipients.EXCLUDED} isključenih</Badge>}</Td>
                    <Td>{Object.values(campaign.messages || {}).reduce((sum, value) => sum + Number(value || 0), 0)}</Td>
                    <Td><Badge>{campaign.status}</Badge></Td>
                    <Td>
                      <HStack>
                        <Button size="xs" leftIcon={<FaRobot />} colorScheme="orange" isDisabled={!metadata?.mail?.openAiConfigured || !(campaign.recipients?.ACTIVE > 0)} isLoading={generatingId === campaign.id} onClick={() => generate(campaign)}>Generiši nacrte</Button>
                        <Button size="xs" variant="outline" onClick={() => onOpenDrafts(campaign.id)}>Pregled nacrta</Button>
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>
    </VStack>
  );
}

export function DraftsPanel({ token, user, campaignId, refreshKey, onChanged }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({});
  const [campaignFilter, setCampaignFilter] = useState(campaignId || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (campaignId) setCampaignFilter(campaignId); }, [campaignId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (campaignFilter) params.set('campaignId', campaignFilter);
      if (statusFilter) params.set('status', statusFilter);
      const [campaignResult, draftResult] = await Promise.all([
        aiMailRequest('/campaigns', { token }),
        aiMailRequest(`/drafts${params.toString() ? `?${params}` : ''}`, { token })
      ]);
      setCampaigns(campaignResult);
      setDrafts(draftResult);
      setSelectedId((current) => draftResult.some((draft) => draft.id === current) ? current : (draftResult[0]?.id || ''));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [campaignFilter, statusFilter, token]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    setError('');
    try {
      const result = await aiMailRequest(`/drafts/${selectedId}`, { token });
      setDetail(result);
      setForm({
        subject: result.subject || '',
        body_text: result.body_text || '',
        body_html: result.body_html || '',
        personalization_summary: result.personalization_summary || '',
        warnings: result.warnings || []
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId, token]);

  useEffect(() => { loadList(); }, [loadList, refreshKey]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const save = async () => {
    setWorking('save');
    setError('');
    try {
      const result = await aiMailRequest(`/drafts/${detail.id}`, { token, method: 'PUT', body: form });
      setDetail(result);
      toast({ title: 'Nacrt i nova verzija su sačuvani.', status: 'success', position: 'top-right' });
      await loadList();
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking('');
    }
  };

  const transition = async (action, body = {}) => {
    setWorking(action);
    setError('');
    try {
      const result = await aiMailRequest(`/drafts/${detail.id}/${action}`, { token, method: 'POST', body });
      setDetail(result);
      setForm((current) => ({ ...current, subject: result.subject, body_text: result.body_text, body_html: result.body_html || '' }));
      const titles = { submit: 'Nacrt čeka odobrenje direktora.', approve: 'Nacrt je odobren, ali nije zakazan niti poslan.', return: 'Nacrt je vraćen na doradu.' };
      toast({ title: titles[action], status: 'success', position: 'top-right' });
      await loadList();
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking('');
    }
  };

  if (loading) return <PanelLoader label="Učitavanje AI nacrta..." />;

  return (
    <VStack align="stretch" spacing={5}>
      <Alert status="success" borderRadius="xl"><AlertIcon /><Box><Text fontWeight="bold">Slanje je tehnički nedostupno</Text><Text fontSize="sm">Ovaj ekran može urediti, verzionisati i odobriti nacrt. Ne postoji akcija za slanje ili zakazivanje.</Text></Box></Alert>
      <RequestError message={error} />
      <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
        <Select placeholder="Sve kampanje" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}><option value="">Sve kampanje</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select>
        <Select placeholder="Svi statusi" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">Svi statusi</option><option value="DRAFT">U pripremi</option><option value="PENDING_APPROVAL">Čeka odobrenje</option><option value="APPROVED">Odobreno</option></Select>
        <Button leftIcon={<FaSyncAlt />} variant="outline" onClick={loadList}>Osvježi</Button>
      </Flex>

      {drafts.length === 0 ? <Box py={12} textAlign="center"><FaRobot style={{ margin: '0 auto 12px', color: orange }} size={36} /><Text fontWeight="bold">Nema AI nacrta za odabrani filter.</Text><Text color="gray.500">Prvo kreirajte kampanju i pokrenite kontrolisano generisanje.</Text></Box> : (
        <Grid templateColumns={{ base: '1fr', xl: '360px 1fr' }} gap={5} alignItems="start">
          <GridItem border="1px solid" borderColor="gray.200" borderRadius="xl" overflow="hidden">
            <VStack align="stretch" spacing={0} maxH="720px" overflowY="auto">
              {drafts.map((draft) => (
                <Box key={draft.id} p={4} cursor="pointer" bg={selectedId === draft.id ? 'orange.50' : 'white'} borderBottom="1px solid" borderColor="gray.100" onClick={() => setSelectedId(draft.id)}>
                  <Flex justify="space-between" gap={2}><Text fontWeight="bold" noOfLines={1}>{draft.company_name}</Text><Badge colorScheme={statusColor(draft.status)}>{STATUS_LABELS[draft.status] || draft.status}</Badge></Flex>
                  <Text fontSize="sm" mt={1} noOfLines={2}>{draft.subject || 'Bez predmeta'}</Text>
                  <Text fontSize="xs" mt={2} color="gray.500">{draft.campaign_name}</Text>
                </Box>
              ))}
            </VStack>
          </GridItem>

          <GridItem>
            {detailLoading || !detail ? <PanelLoader label="Učitavanje nacrta..." /> : (
              <VStack align="stretch" spacing={4}>
                <Flex justify="space-between" align={{ base: 'start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap={2}>
                  <Box><Heading size="md">{detail.company_name}</Heading><Text color="gray.600">{detail.to_email} • {detail.campaign_name}</Text></Box>
                  <Badge colorScheme={statusColor(detail.status)} px={3} py={2}>{STATUS_LABELS[detail.status] || detail.status}</Badge>
                </Flex>
                {detail.warnings?.length > 0 && <Alert status="warning" borderRadius="lg"><AlertIcon /><Box><Text fontWeight="bold">AI upozorenja</Text>{detail.warnings.map((warning, index) => <Text key={`${warning}-${index}`} fontSize="sm">• {warning}</Text>)}</Box></Alert>}
                <FormControl isRequired><FormLabel>Predmet</FormLabel><Input value={form.subject || ''} onChange={(e) => setField('subject', e.target.value)} /></FormControl>
                <FormControl isRequired><FormLabel>Tekst poruke</FormLabel><Textarea rows={12} value={form.body_text || ''} onChange={(e) => setField('body_text', e.target.value)} /></FormControl>
                <FormControl><FormLabel>HTML verzija</FormLabel><Textarea fontFamily="mono" fontSize="sm" rows={7} value={form.body_html || ''} onChange={(e) => setField('body_html', e.target.value)} /></FormControl>
                <FormControl><FormLabel>Sažetak personalizacije</FormLabel><Textarea rows={3} value={form.personalization_summary || ''} onChange={(e) => setField('personalization_summary', e.target.value)} /></FormControl>

                <Flex gap={3} wrap="wrap">
                  {['DRAFT', 'PENDING_APPROVAL'].includes(detail.status) && <Button leftIcon={<FaSave />} bg={green} color="white" _hover={{ bg: 'green.600' }} isLoading={working === 'save'} onClick={save}>Sačuvaj novu verziju</Button>}
                  {detail.status === 'DRAFT' && <Button leftIcon={<FaPaperPlane />} colorScheme="orange" isLoading={working === 'submit'} onClick={() => transition('submit')}>Pošalji na odobrenje</Button>}
                  {detail.status === 'PENDING_APPROVAL' && user?.role === 'direktor' && <Button leftIcon={<FaCheckCircle />} colorScheme="green" isLoading={working === 'approve'} onClick={() => window.confirm('Odobriti ovaj nacrt? Ostat će izvan queue-a i neće biti poslan.') && transition('approve')}>Odobri nacrt</Button>}
                  {['PENDING_APPROVAL', 'APPROVED'].includes(detail.status) && <Button variant="outline" isLoading={working === 'return'} onClick={() => transition('return', { reason: 'Vraćeno na ručnu doradu' })}>Vrati na doradu</Button>}
                </Flex>

                <Box border="1px solid" borderColor="gray.200" borderRadius="xl" p={4}>
                  <HStack mb={3}><FaHistory color={orange} /><Heading size="sm">Historija verzija</Heading></HStack>
                  {(detail.versions || []).map((version) => (
                    <Flex key={version.id} py={2} borderTop="1px solid" borderColor="gray.100" justify="space-between" gap={3}>
                      <Box><Text fontWeight="semibold">Verzija {version.version_number} • {version.source === 'AI' ? 'AI' : 'ručna izmjena'}</Text><Text fontSize="xs" color="gray.500">{version.change_note || 'Bez napomene'}</Text></Box>
                      <Text fontSize="xs" color="gray.500">{version.ai_model || '—'}</Text>
                    </Flex>
                  ))}
                </Box>
              </VStack>
            )}
          </GridItem>
        </Grid>
      )}
    </VStack>
  );
}
