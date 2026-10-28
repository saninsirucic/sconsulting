import React, { useEffect, useState } from 'react';
import { Badge, Box, Button, Checkbox, FormControl, FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, SimpleGrid, Text, Textarea, VStack, Alert, AlertIcon } from '@chakra-ui/react';
import { FaClock, FaEdit } from 'react-icons/fa';
import { commercialApi } from './api';
import { CRM_STATUSES, PRIORITIES, displayStatus, recordValue } from './schema';

export const CONTACT_VIEWS = [
  { value: '', label: 'Svi komitenti', scheme: 'gray', count: 'total' },
  { value: 'overdue', label: 'Propušteni rokovi', scheme: 'red' },
  { value: 'today', label: 'Pozivi danas', scheme: 'orange' },
  { value: 'upcoming', label: 'Narednih 7 dana', scheme: 'blue' },
  { value: 'unscheduled', label: 'Bez termina', scheme: 'gray' },
];

function businessDay(value) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function displayDate(value) {
  const [year, month, day] = businessDay(value).split('-');
  return `${day}.${month}.${year}.`;
}

export function contactTiming(record, now = new Date()) {
  if (['WON', 'REJECTED'].includes(record.status)) return { label: 'Zatvoren kontakt', scheme: 'gray' };
  const value = recordValue(record, 'next_contact_at', 'nextContactAt');
  if (!value) return { label: 'Bez termina', scheme: 'gray' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: 'Provjerite termin', scheme: 'red' };
  const day = businessDay(date);
  const today = businessDay(now);
  if (day < today) return { label: 'Propušten rok', scheme: 'red' };
  if (day === today) return { label: date < now ? 'Danas · termin prošao' : 'Danas', scheme: 'orange' };
  return { label: 'Zakazano', scheme: 'blue' };
}

export function RecordComments({ record }) {
  const comment = recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar');
  const notes = recordValue(record, 'notes');
  const [expanded, setExpanded] = useState(false);
  const long = String(comment).length + String(notes).length > 320 || `${comment}\n${notes}`.split('\n').length > 6;
  return (
    <Box minW={0}>
      {comment && <Box><Text fontSize="xs" fontWeight="bold" color="gray.500">KOMENTAR</Text><Text mt={1} fontSize="sm" color="gray.800" whiteSpace="pre-wrap" overflowWrap="anywhere" noOfLines={!expanded && long ? 4 : undefined}>{comment}</Text></Box>}
      {notes && notes !== comment && <Box mt={comment ? 3 : 0}><Text fontSize="xs" fontWeight="bold" color="gray.500">CRM NAPOMENE</Text><Text mt={1} fontSize="sm" whiteSpace="pre-wrap" overflowWrap="anywhere" noOfLines={!expanded && long ? 4 : undefined}>{notes}</Text></Box>}
      {!comment && !notes && <Text fontSize="sm" color="gray.500">Još nema komentara.</Text>}
      {long && <Button size="xs" variant="link" colorScheme="blue" mt={2} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Sažmi komentar' : 'Pročitaj cijeli komentar'}</Button>}
    </Box>
  );
}

export function ContactSchedule({ record, onEdit }) {
  const timing = contactTiming(record);
  const value = recordValue(record, 'next_contact_at', 'nextContactAt');
  const date = value ? new Date(value) : null;
  const valid = date && !Number.isNaN(date.getTime());
  return (
    <VStack align="start" spacing={2}>
      <Badge colorScheme={timing.scheme} whiteSpace="normal">{timing.label}</Badge>
      {valid && <Box><Text fontWeight="bold" fontSize="sm">{displayDate(date)}</Text><HStack spacing={1} color={`${timing.scheme}.700`}><FaClock size={12} /><Text fontSize="lg" fontWeight="bold">{date.toLocaleTimeString('bs-BA', { timeZone: 'Europe/Sarajevo', hour: '2-digit', minute: '2-digit' })}</Text></HStack></Box>}
      {onEdit && <Button size="sm" variant="outline" bg="white" leftIcon={<FaEdit />} whiteSpace="normal" height="auto" minH="36px" py={1} onClick={() => onEdit(record)}>Komentar / termin</Button>}
    </VStack>
  );
}

export function FollowUpModal({ record, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [contacted, setContacted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const value = recordValue(record, 'next_contact_at', 'nextContactAt');
    const date = value ? new Date(value) : null;
    setForm({
      comment: recordValue(record, 'comment', 'raw_comment', 'rawComment', 'komentar'),
      notes: record?.notes || '', status: record?.status || 'NEW', priority: record?.priority || 'MEDIUM',
      next_contact_at: date && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
    });
    setContacted(false);
    setError('');
  }, [record]);
  const field = (key) => ({ value: form[key] || '', onChange: (event) => setForm(current => ({ ...current, [key]: event.target.value })) });
  const save = async () => {
    if (form.next_contact_at && Number.isNaN(new Date(form.next_contact_at).getTime())) return setError('Unesite ispravan datum i vrijeme.');
    setSaving(true);
    setError('');
    try {
      await commercialApi.updateRecord(record.id, {
        ...form,
        next_contact_at: form.next_contact_at ? new Date(form.next_contact_at).toISOString() : null,
        ...(contacted ? { last_contact_at: new Date().toISOString() } : {}),
      });
      onSaved();
      onClose();
    } catch (requestError) { setError(requestError.message || 'Izmjene nisu sačuvane.'); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen={Boolean(record)} onClose={saving ? () => {} : onClose} size="xl" scrollBehavior="inside" closeOnOverlayClick={false}>
      <ModalOverlay /><ModalContent mx={3}>
        <ModalHeader pr={12}>Komentar i sljedeći poziv<Text fontSize="sm" fontWeight="normal" mt={1}>{record?.company_name}</Text></ModalHeader>
        <ModalCloseButton isDisabled={saving} />
        <ModalBody><VStack align="stretch" spacing={4}>
          <FormControl><FormLabel htmlFor="followup-date">Sljedeći poziv — datum i vrijeme</FormLabel><Input id="followup-date" type="datetime-local" {...field('next_contact_at')} /><Text mt={1} fontSize="xs" color="gray.500">Unesite vrijeme na svom uređaju. Pregled rokova je po vremenu Sarajeva. Prazno polje uklanja termin.</Text></FormControl>
          <FormControl><FormLabel htmlFor="followup-comment">Komentar</FormLabel><Textarea id="followup-comment" rows={4} {...field('comment')} /></FormControl>
          <FormControl><FormLabel htmlFor="followup-notes">CRM napomene / dogovor za sljedeći poziv</FormLabel><Textarea id="followup-notes" rows={4} {...field('notes')} /></FormControl>
          <SimpleGrid columns={2} spacing={3}>
            <FormControl><FormLabel htmlFor="followup-status">CRM status</FormLabel><Select id="followup-status" {...field('status')}>{CRM_STATUSES.map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select></FormControl>
            <FormControl><FormLabel htmlFor="followup-priority">Prioritet</FormLabel><Select id="followup-priority" {...field('priority')}>{PRIORITIES.map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</Select></FormControl>
          </SimpleGrid>
          <Checkbox isChecked={contacted} onChange={event => setContacted(event.target.checked)}>Evidentiraj da je kontakt upravo obavljen</Checkbox>
          {error && <Alert status="error"><AlertIcon />{error}</Alert>}
        </VStack></ModalBody>
        <ModalFooter gap={3}><Button variant="ghost" isDisabled={saving} onClick={onClose}>Odustani</Button><Button colorScheme="orange" isLoading={saving} onClick={save}>Sačuvaj komentar i termin</Button></ModalFooter>
      </ModalContent>
    </Modal>
  );
}
