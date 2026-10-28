import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertIcon, Button, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Spinner, Text } from '@chakra-ui/react';
import { ComposeModal, normalizeStatus } from '../OutlookModule';
import { outlookApi } from '../outlook/api';
import { normalizeCcEmails } from './MailRecipientsEditor';
import { recordValue } from './schema';

export default function RecordMailModal({ record, onClose, onSent }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const company = recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || 'Bez naziva';
  const initialDraft = useMemo(() => ({
    to: recordValue(record, 'email', 'raw_mail', 'rawMail', 'mail') || '',
    cc: normalizeCcEmails(record.cc_emails || record.ccEmails).join('; '),
  }), [record]);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError('');
    outlookApi.getStatus().then((payload) => {
      if (active) setStatus(normalizeStatus(payload));
    }).catch((requestError) => {
      if (active) setError(requestError.message || 'Mail formu trenutno nije moguće otvoriti.');
    });
    return () => { active = false; };
  }, [attempt]);

  if (status?.configured && status?.writeEnabled) {
    return <ComposeModal isOpen onClose={onClose} mode="compose" status={status} initialDraft={initialDraft} contextLabel={`Mail za: ${company}`} onSent={onSent} />;
  }

  const unavailable = error || (status && (status.message || (status.configured ? 'Slanje maila nije omogućeno za vaš račun.' : 'Mail račun još nije povezan.')));
  return (
    <Modal isOpen onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Mail za: {company}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {unavailable ? <Alert status="warning"><AlertIcon /><AlertDescription>{unavailable}</AlertDescription></Alert> : <><Spinner /><Text mt={2}>Otvaranje mail forme...</Text></>}
        </ModalBody>
        <ModalFooter gap={3}>
          <Button onClick={onClose} variant="ghost">Zatvori</Button>
          {unavailable && <Button onClick={() => setAttempt((value) => value + 1)} colorScheme="blue">Pokušaj ponovo</Button>}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
