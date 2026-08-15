import React, { useCallback, useEffect, useState } from 'react';
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
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Switch,
  Text,
  Textarea,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { FaEnvelope, FaPause, FaPaperPlane, FaRedo } from 'react-icons/fa';
import { commercialApi } from './api';

const EMPTY_SETTINGS = {
  enabled: false,
  paused: true,
  auto_send: true,
  daily_limit: 30,
  workdays: [1, 2, 3, 4, 5],
  send_window_start: '09:00',
  send_window_end: '15:00',
  send_interval_minutes: 10,
  follow_up_days: 7,
  subject: '',
  body_text: '',
};

const STATUS_LABELS = {
  PENDING: 'Čeka aktivaciju',
  APPROVED: 'Spremno',
  SENDING: 'Šalje se',
  SENT: 'Poslano',
  FAILED: 'Neuspjelo',
  SKIPPED: 'Preskočeno',
};

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('bs-BA');
}

export default function CommercialMailAutomation({ brandCode, brandName, user, onChanged }) {
  const toast = useToast();
  const canManage = user?.role === 'direktor';
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await commercialApi.getMailAutomation(brandCode);
      setState(result);
      setForm({ ...EMPTY_SETTINGS, ...(result?.settings || {}) });
    } catch (requestError) {
      setError(requestError.message || 'Automatska komercijala trenutno nije dostupna.');
    } finally {
      setLoading(false);
    }
  }, [brandCode]);

  useEffect(() => { load(); }, [load]);

  const run = async (name, action, successMessage) => {
    setBusy(name);
    setError('');
    try {
      const result = await action();
      if (result?.settings) setForm({ ...EMPTY_SETTINGS, ...result.settings });
      setState(result?.queue ? result : await commercialApi.getMailAutomation(brandCode));
      toast({ title: successMessage, status: 'success', position: 'top-right' });
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message || 'Akcija nije uspjela.');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (form.enabled && !state?.settings?.enabled) {
      const confirmed = window.confirm(
        `Aktivirati automatsko slanje za ${brandName}? Sistem će u radnom terminu slati do ${form.daily_limit} stvarnih mailova dnevno sa sales@s-consulting.ba.`
      );
      if (!confirmed) return;
    }
    await run('save', () => commercialApi.updateMailAutomation(brandCode, form),
      form.enabled ? 'Automatska komercijala je sačuvana i aktivna.' : 'Postavke su sačuvane; slanje je isključeno.');
  };

  const prepare = () => run('prepare', () => commercialApi.prepareMailAutomation(brandCode),
    'Današnja lista poznatih CRM kontakata je pripremljena.');

  const pause = () => run('pause', () => commercialApi.pauseMailAutomation(brandCode),
    'Automatsko slanje je odmah pauzirano.');

  const sendNext = async () => {
    if (!window.confirm('Poslati jedan STVARNI mail prvom kontaktu koji je spreman?')) return;
    await run('send', () => commercialApi.sendNextMailAutomation(brandCode), 'Jedan mail je poslan i evidentiran u CRM-u.');
  };

  const counts = state?.counts || {};
  const queue = state?.queue || [];
  const active = Boolean(state?.settings?.enabled && !state?.settings?.paused);

  return (
    <Box border="1px solid" borderColor={active ? 'green.300' : 'blue.200'} bg={active ? 'green.50' : 'blue.50'} borderRadius="2xl" overflow="hidden">
      <Flex px={{ base: 4, md: 5 }} py={4} align={{ base: 'start', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
        <HStack align="start" spacing={3}>
          <Flex flexShrink={0} boxSize="44px" borderRadius="xl" bg="white" color={active ? 'green.500' : 'blue.500'} align="center" justify="center"><FaEnvelope /></Flex>
          <Box>
            <HStack flexWrap="wrap"><Heading size="sm">Automatska komercijala · do 30 dnevno</Heading><Badge colorScheme={active ? 'green' : state?.settings?.enabled ? 'orange' : 'gray'}>{active ? 'AKTIVNA' : state?.settings?.enabled ? 'PAUZIRANA' : 'ISKLJUČENA'}</Badge></HStack>
            <Text fontSize="sm" color="gray.600" mt={1}>Samo poznate adrese iz {brandName} CRM baze. Bez eJN i bez web-istraživanja.</Text>
          </Box>
        </HStack>
        <HStack w={{ base: 'full', md: 'auto' }}>
          {active && canManage && <Button minH="44px" leftIcon={<FaPause />} colorScheme="red" variant="outline" isLoading={busy === 'pause'} onClick={pause}>Hitni stop</Button>}
          <Button flex={{ base: 1, md: 'initial' }} minH="44px" variant="outline" bg="white" onClick={() => setOpen((value) => !value)}>{open ? 'Sakrij' : 'Otvori kontrolu'}</Button>
        </HStack>
      </Flex>

      <Collapse in={open} animateOpacity>
        <Box bg="white" borderTop="1px solid" borderColor="gray.200" p={{ base: 4, md: 5 }}>
          {loading ? <Flex py={8} justify="center" gap={3}><Spinner /><Text>Učitavanje automatike...</Text></Flex> : (
            <VStack align="stretch" spacing={5}>
              {error && <Alert status="error" borderRadius="lg"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}

              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
                {[
                  ['Današnja lista', queue.length],
                  ['Spremno', counts.APPROVED || 0],
                  ['Poslano', counts.SENT || 0],
                  ['Neuspjelo', counts.FAILED || 0],
                ].map(([label, value]) => <Box key={label} p={3} border="1px solid" borderColor="gray.200" borderRadius="xl"><Text fontSize="xs" color="gray.500">{label}</Text><Text fontSize="2xl" fontWeight="bold">{value}</Text></Box>)}
              </SimpleGrid>

              {canManage && (
                <>
                  <Divider />
                  <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing={4}>
                    <FormControl display="flex" alignItems="center" justifyContent="space-between" border="1px solid" borderColor="gray.200" borderRadius="lg" px={3} minH="44px">
                      <FormLabel mb={0}>Aktiviraj dnevno slanje</FormLabel>
                      <Switch colorScheme="green" isChecked={Boolean(form.enabled)} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked, paused: event.target.checked ? false : true }))} />
                    </FormControl>
                    <FormControl><FormLabel>Broj dnevno</FormLabel><Input type="number" min={1} max={30} value={form.daily_limit} onChange={(event) => setForm((current) => ({ ...current, daily_limit: event.target.value }))} /></FormControl>
                    <FormControl><FormLabel>Početak</FormLabel><Input type="time" value={form.send_window_start} onChange={(event) => setForm((current) => ({ ...current, send_window_start: event.target.value }))} /></FormControl>
                    <FormControl><FormLabel>Kraj</FormLabel><Input type="time" value={form.send_window_end} onChange={(event) => setForm((current) => ({ ...current, send_window_end: event.target.value }))} /></FormControl>
                    <FormControl><FormLabel>Razmak slanja</FormLabel><Select value={form.send_interval_minutes} onChange={(event) => setForm((current) => ({ ...current, send_interval_minutes: event.target.value }))}><option value="10">10 minuta</option><option value="20">20 minuta</option><option value="30">30 minuta</option><option value="60">60 minuta</option></Select></FormControl>
                    <FormControl><FormLabel>Follow-up nakon dana</FormLabel><Input type="number" min={1} max={90} value={form.follow_up_days} onChange={(event) => setForm((current) => ({ ...current, follow_up_days: event.target.value }))} /></FormControl>
                  </SimpleGrid>

                  <FormControl><FormLabel>Naslov poruke</FormLabel><Input value={form.subject || ''} placeholder="Unesite naslov maila" onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} /></FormControl>
                  <FormControl><FormLabel>Sadržaj poruke</FormLabel><Textarea minH="260px" value={form.body_text || ''} placeholder="Unesite sadržaj maila. Dostupno: {{KOMITENT}}, {{LOKACIJA}}, {{KONTAKT_OSOBA}}" onChange={(event) => setForm((current) => ({ ...current, body_text: event.target.value }))} /><Text mt={1} fontSize="xs" color="gray.500">S-Consulting potpis s logom automatski se dodaje jednom pri slanju.</Text></FormControl>

                  <Flex gap={3} flexWrap="wrap">
                    <Button minH="44px" colorScheme="green" isLoading={busy === 'save'} onClick={save}>Sačuvaj i primijeni</Button>
                    <Button minH="44px" leftIcon={<FaRedo />} variant="outline" isLoading={busy === 'prepare'} onClick={prepare}>Pripremi današnju listu</Button>
                    <Button minH="44px" leftIcon={<FaPaperPlane />} variant="outline" colorScheme="blue" isLoading={busy === 'send'} isDisabled={!active || !(counts.APPROVED > 0)} onClick={sendNext}>Pošalji sljedeći sada</Button>
                  </Flex>
                </>
              )}

              <Divider />
              <Box>
                <Heading size="xs" mb={3}>Današnji red slanja</Heading>
                {queue.length === 0 ? <Text color="gray.500">Lista još nije pripremljena ili nema dostupnih poznatih mail adresa.</Text> : (
                  <VStack align="stretch" spacing={2} maxH="420px" overflowY="auto">
                    {queue.map((item) => (
                      <Flex key={item.id} p={3} border="1px solid" borderColor="gray.200" borderRadius="lg" justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
                        <Box minW={0}><Text fontWeight="semibold" overflowWrap="anywhere">{item.sequence_number}. {item.company_name}</Text><Text fontSize="sm" color="gray.600" overflowWrap="anywhere">{item.recipient_email}</Text>{item.last_error && <Text fontSize="xs" color="red.600" mt={1}>{item.last_error}</Text>}</Box>
                        <Box flexShrink={0} textAlign={{ md: 'right' }}><Badge colorScheme={item.status === 'SENT' ? 'green' : item.status === 'FAILED' ? 'red' : item.status === 'APPROVED' ? 'blue' : 'gray'}>{STATUS_LABELS[item.status] || item.status}</Badge><Text fontSize="xs" color="gray.500" mt={1}>{item.sent_at ? formatTimestamp(item.sent_at) : 'Nije poslano'}</Text></Box>
                      </Flex>
                    ))}
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
