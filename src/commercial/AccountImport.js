import React, { useState } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, Flex, Heading,
  Input, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr,
} from '@chakra-ui/react';
import { commercialApi } from './api';

function errorText(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join('; ');
  if (typeof value === 'object') return value.message || value.error || JSON.stringify(value);
  return String(value);
}

export default function AccountImport({ brandCode, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const selectFile = (event) => {
    const selected = event.target.files?.[0];
    setPreview(null);
    setToken('');
    setResult(null);
    setError('');
    if (selected && !/\.xlsx$/i.test(selected.name)) {
      setFile(null);
      setError('Odaberite Excel datoteku u .xlsx formatu.');
      return;
    }
    setFile(selected || null);
  };

  const inspect = async () => {
    setBusy('preview');
    setError('');
    setPreview(null);
    setToken('');
    setResult(null);
    try {
      const response = await commercialApi.previewAccountImport(brandCode, file);
      if (!response?.preview || !response?.import_token) throw new Error('Pregled uvoza nije potpun. Pokušajte ponovo.');
      setPreview(response.preview);
      setToken(response.import_token);
    } catch (requestError) {
      setError(requestError.message || 'Datoteku nije moguće pregledati.');
    } finally {
      setBusy('');
    }
  };

  const commit = async () => {
    setBusy('commit');
    setError('');
    try {
      const response = await commercialApi.commitAccountImport(brandCode, token);
      setResult(response);
      setToken('');
      setPreview(null);
      onImported?.();
    } catch (requestError) {
      setError(requestError.message || 'Uvoz nije uspio.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Box p={4} border="1px solid" borderColor="blue.200" borderRadius="xl" bg="blue.50">
      <Heading size="sm">Uvoz baze javnih ustanova</Heading>
      <Text mt={2} fontSize="sm">Odaberite Excel (.xlsx), pregledajte redove pa potvrdite uvoz u ovu bazu. Uvoz ne šalje mailove.</Text>
      <Text mt={1} fontSize="sm">Kolone: Naziv ustanove (obavezno), E-mail, Telefon, Grad, Adresa, Kontakt osoba. Najviše 5.000 ustanova i 5 MB po datoteci.</Text>
      <Flex mt={3} gap={3} direction={{ base: 'column', md: 'row' }} align={{ md: 'center' }}>
        <Input aria-label="Excel baza javnih ustanova" type="file" accept=".xlsx" bg="white" p={1} isDisabled={Boolean(busy)} onChange={selectFile} />
        <Button colorScheme="blue" flexShrink={0} isDisabled={!file || Boolean(busy)} isLoading={busy === 'preview'} onClick={inspect}>Pregledaj uvoz</Button>
      </Flex>
      {error && <Alert status="error" mt={3}><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
      {result && <Alert status="success" mt={3}><AlertIcon /><AlertDescription>Uvezeno: {result.imported || 0}. Preskočeno: {result.skipped || 0}.{result.errors?.length > 0 && ` Greške: ${errorText(result.errors)}`}</AlertDescription></Alert>}
      {preview && (
        <Box mt={4}>
          <Flex gap={2} flexWrap="wrap" mb={3}>
            <Badge>Ukupno: {preview.total_rows || 0}</Badge>
            <Badge colorScheme="green">Ispravno: {preview.valid_rows || 0}</Badge>
            <Badge colorScheme="red">Neispravno: {preview.invalid_rows || 0}</Badge>
            <Badge colorScheme="orange">Duplikati: {preview.duplicate_rows || 0}</Badge>
          </Flex>
          <TableContainer maxH="360px" overflowY="auto" bg="white" borderRadius="md">
            <Table size="sm" aria-label="Pregled uvoza javnih ustanova">
              <Thead><Tr>{['Red', 'Naziv ustanove', 'Email', 'Telefon', 'Grad', 'Adresa', 'Kontakt osoba', 'Provjera'].map((label) => <Th key={label}>{label}</Th>)}</Tr></Thead>
              <Tbody>{(preview.rows || []).map((row, index) => <Tr key={`${row.row_number}-${index}`}>
                <Td>{row.row_number}</Td><Td>{row.name}</Td><Td>{row.email}</Td><Td>{row.phone}</Td><Td>{row.city}</Td><Td>{row.address}</Td><Td>{row.contact_person}</Td>
                <Td whiteSpace="normal" minW="160px">{errorText(row.error || row.errors) || (row.duplicate ? 'Duplikat — preskače se' : 'Spremno za uvoz')}</Td>
              </Tr>)}</Tbody>
            </Table>
          </TableContainer>
          <Text mt={3} fontSize="sm">Potvrdom dodajete ispravne nove redove u bazu Javne ustanove. Neispravni i dupli redovi se preskaču.</Text>
          <Button mt={3} colorScheme="green" isDisabled={!token || !Number(preview.valid_rows) || Boolean(busy)} isLoading={busy === 'commit'} onClick={commit}>Potvrdi uvoz u Javne ustanove</Button>
        </Box>
      )}
    </Box>
  );
}
