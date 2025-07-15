import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Spacer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@chakra-ui/react";

function Executors() {
  const [executors, setExecutors] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);

  useEffect(() => {
    fetch("/api/executors").then(res => res.json()).then(setExecutors);
  }, []);

  const clearForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
  };

  const saveExecutor = () => {
    if (!name || !email || !phone || !address) return;

    const executorData = {
      name,
      email,
      phone,
      address,
    };

    if (editId) {
      fetch(`/api/executors/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(executorData),
      }).then(() => {
        setExecutors(
          executors.map((e) => (e.id === editId ? { ...e, ...executorData } : e))
        );
        setEditId(null);
        clearForm();
      });
    } else {
      fetch("/api/executors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(executorData),
      })
        .then((res) => res.json())
        .then((executor) => {
          setExecutors([...executors, executor]);
          clearForm();
        });
    }
  };

  const deleteExecutor = (id) => {
    fetch(`/api/executors/${id}`, { method: "DELETE" }).then(() =>
      setExecutors(executors.filter((e) => e.id !== id))
    );
  };

  const startEdit = (executor) => {
    setEditId(executor.id);
    setName(executor.name || "");
    setEmail(executor.email || "");
    setPhone(executor.phone || "");
    setAddress(executor.address || "");
  };

  const filteredExecutors = executors.filter(
    (e) =>
      (e.name && e.name.toLowerCase().includes(search.toLowerCase())) ||
      (e.email && e.email.toLowerCase().includes(search.toLowerCase())) ||
      (e.phone && e.phone.includes(search)) ||
      (e.address && e.address.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Box>
      <Heading size="lg" mb={6}>
        Izvođači
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

        <Button colorScheme="orange" onClick={saveExecutor} minW="160px">
          {editId ? "Sačuvaj izmjene" : "Dodaj izvođača"}
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

      <Table variant="striped" colorScheme="orange" size="sm">
        <Thead>
          <Tr>
            <Th>Ime</Th>
            <Th>Email</Th>
            <Th>Telefon</Th>
            <Th>Adresa</Th>
            <Th>Akcije</Th>
          </Tr>
        </Thead>
        <Tbody>
          {filteredExecutors.length === 0 ? (
            <Tr>
              <Td colSpan={5} textAlign="center">
                Nema unesenih izvođača.
              </Td>
            </Tr>
          ) : (
            filteredExecutors.map((e) => (
              <Tr key={e.id}>
                <Td>{e.name}</Td>
                <Td>{e.email}</Td>
                <Td>{e.phone}</Td>
                <Td>{e.address}</Td>
                <Td>
                  <Button
                    size="sm"
                    colorScheme="yellow"
                    mr={2}
                    onClick={() => startEdit(e)}
                  >
                    Uredi
                  </Button>
                  <Button
                    size="sm"
                    colorScheme="red"
                    onClick={() => deleteExecutor(e.id)}
                  >
                    Obriši
                  </Button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </Box>
  );
}

export default Executors;
