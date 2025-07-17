import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@chakra-ui/react";

const BACKEND_URL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

function Clients() {
  const [clients, setClients] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [pib, setPib] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [amountInWords, setAmountInWords] = useState(""); // NOVO POLJE
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/clients`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Podaci sa backend /api/clients:", data);
        if (Array.isArray(data)) {
          setClients(data);
        } else {
          console.warn("Podaci nisu niz, postavljam clients na prazan niz");
          setClients([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri fetchu klijenata:", err);
        setClients([]);
      });
  }, []);

  const clearForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setPostalCode("");
    setCompanyId("");
    setPib("");
    setContractNumber("");
    setPaymentTerm("");
    setAmountInWords("");
  };

  const saveClient = () => {
    if (!name || !email || !phone || !address) return;

    const clientData = {
      name,
      email,
      phone,
      address,
      postalCode,
      companyId,
      pib,
      contractNumber,
      paymentTerm,
      amountInWords,
    };

    if (editId) {
      fetch(`${BACKEND_URL}/api/clients/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientData),
      }).then(() => {
        setClients(
          clients.map((c) => (c.id === editId ? { ...c, ...clientData } : c))
        );
        setEditId(null);
        clearForm();
      });
    } else {
      fetch(`${BACKEND_URL}/api/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientData),
      })
        .then((res) => res.json())
        .then((client) => {
          setClients([...clients, client]);
          clearForm();
        });
    }
  };

  const deleteClient = (id) => {
    fetch(`${BACKEND_URL}/api/clients/${id}`, { method: "DELETE" }).then(() =>
      setClients(clients.filter((c) => c.id !== id))
    );
  };

  const startEdit = (client) => {
    setEditId(client.id);
    setName(client.name || "");
    setEmail(client.email || "");
    setPhone(client.phone || "");
    setAddress(client.address || "");
    setPostalCode(client.postalCode || "");
    setCompanyId(client.companyId || "");
    setPib(client.pib || "");
    setContractNumber(client.contractNumber || "");
    setPaymentTerm(client.paymentTerm || "");
    setAmountInWords(client.amountInWords || "");
  };

  // Zaštita prije filter: clients mora biti niz
  const filteredClients = Array.isArray(clients)
    ? clients.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(search.toLowerCase())) ||
          (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
          (c.phone && c.phone.includes(search)) ||
          (c.address && c.address.toLowerCase().includes(search.toLowerCase())) ||
          (c.postalCode && c.postalCode.includes(search)) ||
          (c.companyId && c.companyId.includes(search)) ||
          (c.pib && c.pib.includes(search)) ||
          (c.contractNumber && c.contractNumber.includes(search)) ||
          (c.paymentTerm && c.paymentTerm.toString().includes(search))
      )
    : [];

  return (
    <Box>
      <Heading size="lg" mb={6}>
        Klijenti
      </Heading>

      <Flex wrap="wrap" gap={3} mb={6}>
        <Input
          placeholder="Ime"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxW="200px"
        />
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxW="200px"
        />
        <Input
          placeholder="Telefon"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Adresa"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxW="200px"
        />
        <Input
          placeholder="Poštanski broj"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          maxW="120px"
        />
        <Input
          placeholder="ID broj firme"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="PDV broj"
          value={pib}
          onChange={(e) => setPib(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Broj ugovora"
          value={contractNumber}
          onChange={(e) => setContractNumber(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Rok plaćanja (dani)"
          value={paymentTerm}
          onChange={(e) => setPaymentTerm(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Slovima"
          value={amountInWords}
          onChange={(e) => setAmountInWords(e.target.value)}
          maxW="300px"
        />

        <Button colorScheme="orange" onClick={saveClient} minW="160px">
          {editId ? "Sačuvaj izmjene" : "Dodaj klijenta"}
        </Button>
        {editId && (
          <Button
            colorScheme="gray"
            onClick={() => {
              setEditId(null);
              clearForm();
            }}
            minW="120px"
          >
            Otkaži
          </Button>
        )}
      </Flex>

      <Input
        placeholder="Pretraga..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        mb={4}
        maxW="400px"
      />

      <Box overflowX="auto">
        <Table variant="striped" colorScheme="orange" size="sm" minWidth="900px">
          <Thead>
            <Tr>
              <Th minW="200px" maxW="200px">Ime</Th>
              <Th minW="200px" maxW="200px">Email</Th>
              <Th>Telefon</Th>
              <Th>Adresa</Th>
              <Th>Poštanski broj</Th>
              <Th>ID broj</Th>
              <Th>PDV broj</Th>
              <Th>Broj ugovora</Th>
              <Th>Rok plaćanja</Th>
              <Th minW="150px" maxW="150px" whiteSpace="nowrap" py={4}>
                Akcije
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredClients.length === 0 ? (
              <Tr>
                <Td colSpan={10} textAlign="center">
                  Nema unesenih klijenata.
                </Td>
              </Tr>
            ) : (
              filteredClients.map((c) => (
                <Tr key={c.id}>
                  <Td minW="200px" maxW="200px" whiteSpace="normal" wordBreak="break-word">
                    {c.name}
                  </Td>
                  <Td minW="200px" maxW="200px" whiteSpace="normal" wordBreak="break-word">
                    {c.email}
                  </Td>
                  <Td>{c.phone}</Td>
                  <Td>{c.address}</Td>
                  <Td>{c.postalCode}</Td>
                  <Td>{c.companyId}</Td>
                  <Td>{c.pib}</Td>
                  <Td>{c.contractNumber}</Td>
                  <Td>{c.paymentTerm}</Td>
                  <Td minW="150px" maxW="150px" whiteSpace="nowrap" py={4}>
                    <Flex gap={2}>
                      <Button
                        size="sm"
                        colorScheme="yellow"
                        onClick={() => startEdit(c)}
                      >
                        Uredi
                      </Button>
                      <Button
                        size="sm"
                        colorScheme="red"
                        onClick={() => deleteClient(c.id)}
                      >
                        Obriši
                      </Button>
                    </Flex>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </Box>
    </Box>
  );
}

export default Clients;
