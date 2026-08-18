import React, { useEffect, useId, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Button,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  Textarea,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { FaEdit, FaSave } from 'react-icons/fa';
import { commercialApi } from './api';

const MAX_CC_EMAILS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function normalizeCcEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\n;]/);
  return [...new Set(source.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
}

export function validateCcEmails(value) {
  const emails = normalizeCcEmails(value);
  if (emails.length > MAX_CC_EMAILS) return { emails, error: 'Možete unijeti najviše 10 CC adresa.' };
  const invalid = emails.filter((email) => !EMAIL_PATTERN.test(email));
  if (invalid.length) return { emails, error: `Neispravna CC adresa: ${invalid[0]}` };
  return { emails, error: '' };
}

export default function MailRecipientsEditor({
  brandCode,
  accountId,
  toEmail,
  ccEmails = [],
  onSaved,
  requiresReapproval = false,
  triggerProps = {},
}) {
  const modal = useDisclosure();
  const toast = useToast();
  const inputId = useId();
  const [ccValue, setCcValue] = useState(normalizeCcEmails(ccEmails).join(', '));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!modal.isOpen) setCcValue(normalizeCcEmails(ccEmails).join(', '));
  }, [ccEmails, modal.isOpen]);

  const open = () => {
    setCcValue(normalizeCcEmails(ccEmails).join(', '));
    setError('');
    modal.onOpen();
  };

  const save = async () => {
    const validated = validateCcEmails(ccValue);
    if (validated.error) {
      setError(validated.error);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await commercialApi.updateMailAutomationCandidateRecipients(
        brandCode,
        accountId,
        validated.emails
      );
      modal.onClose();
      onSaved?.(result, validated.emails);
      toast({
        title: 'Primaoci su sačuvani.',
        description: requiresReapproval
          ? 'Zbog promjene CC-a prijedlog treba ponovo odobriti.'
          : (validated.emails.length
            ? `Glavni primalac ostaje isti; dodano CC adresa: ${validated.emails.length}.`
            : 'Glavni primalac ostaje isti; CC lista je prazna.'),
        status: 'success',
        position: 'top-right',
      });
    } catch (requestError) {
      setError(requestError.message || 'Primaoce nije moguće sačuvati.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        minH="40px"
        leftIcon={<FaEdit />}
        variant="ghost"
        colorScheme="blue"
        isDisabled={!accountId}
        onClick={open}
        {...triggerProps}
      >
        Uredi primaoce
      </Button>

      <Modal isOpen={modal.isOpen} onClose={() => { if (!saving) modal.onClose(); }} isCentered size={{ base: 'full', sm: 'md' }}>
        <ModalOverlay />
        <ModalContent borderRadius={{ base: 0, sm: '2xl' }}>
          <ModalHeader>Uredi primaoce maila</ModalHeader>
          <ModalCloseButton minW="44px" minH="44px" isDisabled={saving} />
          <ModalBody>
            {error && (
              <Alert status="error" borderRadius="lg" mb={4}>
                <AlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FormControl>
              <FormLabel htmlFor={`${inputId}-to`}>Za</FormLabel>
              <Input id={`${inputId}-to`} aria-label="Glavni primalac" value={toEmail || 'Nema glavne email adrese'} isReadOnly bg="gray.50" />
              <Text mt={1} fontSize="xs" color="gray.500">Glavna adresa se ovdje ne mijenja.</Text>
            </FormControl>
            <FormControl mt={5}>
              <FormLabel htmlFor={`${inputId}-cc`}>CC</FormLabel>
              <Textarea
                id={`${inputId}-cc`}
                aria-label="CC adrese"
                minH="120px"
                value={ccValue}
                placeholder={'nabavka@firma.ba, direktor@firma.ba\nili po jedna adresa u redu'}
                onChange={(event) => setCcValue(event.target.value)}
              />
              <Text mt={1} fontSize="xs" color="gray.500">Najviše 10 adresa. Odvojite ih zarezom ili novim redom.</Text>
              <Text mt={2} fontSize="xs" color="orange.700">Napomena: svi CC primaoci mogu vidjeti ostale adrese navedene u CC polju.</Text>
            </FormControl>
          </ModalBody>
          <ModalFooter gap={3}>
            <Button minH="44px" variant="ghost" onClick={modal.onClose} isDisabled={saving}>Odustani</Button>
            <Button minH="44px" colorScheme="blue" leftIcon={<FaSave />} isLoading={saving} loadingText="Spremanje" onClick={save}>Sačuvaj</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
