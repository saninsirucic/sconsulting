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

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BACKEND_URL } from "./config";

function Sanitarne() {
  const [sanitarne, setSanitarne] = useState([]);
  const [clients, setClients] = useState([]);

  // Form fields for adding/editing
  const [clientId, setClientId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [dateIssued, setDateIssued] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [editId, setEditId] = useState(null);

  // Filter datumi
  const [startExpiryDate, setStartExpiryDate] = useState("");
  const [endExpiryDate, setEndExpiryDate] = useState("");

  // Ucitaj klijente samo jednom sa provjerom da je niz
  useEffect(() => {
    fetch(BACKEND_URL + "/api/clients")
      .then((res) => {
        if (!res.ok) throw new Error(`Clients API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setClients(data);
        } else if (Array.isArray(data.clients)) {
          setClients(data.clients);
        } else {
          setClients([]);
        }
      })
      .catch((err) => console.error("Greška pri dohvatu klijenata:", err));
  }, []);

  // Fetch sanitarki sa backend filterima
  useEffect(() => {
    const queryParams = new URLSearchParams();
    if (startExpiryDate) queryParams.append("startExpiryDate", startExpiryDate);
    if (endExpiryDate) queryParams.append("endExpiryDate", endExpiryDate);

    fetch(`${BACKEND_URL}/api/sanitarne?${queryParams.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Sanitarne API error! status: ${res.status}`);
        return res.json();
      })
      .then(setSanitarne)
      .catch((err) => console.error("Greška pri dohvatu sanitarnih:", err));
  }, [startExpiryDate, endExpiryDate]);

  const clearForm = () => {
    setClientId("");
    setEmployeeName("");
    setDateIssued("");
    setExpiryDate("");
  };

  const saveSanitarna = () => {
    if (!clientId || !employeeName || !dateIssued || !expiryDate) return;

    const sanitarnaData = {
      clientId,
      employeeName,
      dateIssued,
      expiryDate,
    };

    if (editId) {
      fetch(`${BACKEND_URL}/api/sanitarne/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitarnaData),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Greška pri ažuriranju sanitarne");
          refetchSanitarne();
          setEditId(null);
          clearForm();
        })
        .catch((err) => alert(err.message));
    } else {
      fetch(`${BACKEND_URL}/api/sanitarne`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitarnaData),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Greška pri unosu sanitarne");
          return res.json();
        })
        .then(() => {
          refetchSanitarne();
          clearForm();
        })
        .catch((err) => alert(err.message));
    }
  };

  const deleteSanitarna = (id) => {
    fetch(`${BACKEND_URL}/api/sanitarne/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri brisanju sanitarne");
        refetchSanitarne();
      })
      .catch((err) => alert(err.message));
  };

  const startEdit = (sanitarna) => {
    setEditId(sanitarna.id);
    setClientId(sanitarna.clientId || "");
    setEmployeeName(sanitarna.employeeName || "");
    setDateIssued(sanitarna.dateIssued || "");
    setExpiryDate(sanitarna.expiryDate || "");
  };

  const refetchSanitarne = () => {
    const queryParams = new URLSearchParams();
    if (startExpiryDate) queryParams.append("startExpiryDate", startExpiryDate);
    if (endExpiryDate) queryParams.append("endExpiryDate", endExpiryDate);

    fetch(`${BACKEND_URL}/api/sanitarne?${queryParams.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Sanitarne API error! status: ${res.status}`);
        return res.json();
      })
      .then(setSanitarne)
      .catch((err) => console.error("Greška pri dohvatu sanitarnih:", err));
  };

  const generatePdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Izvještaj sanitarnih knjižica", 14, 15);

    const tableColumn = ["Klijent", "Zaposlenik", "Datum izdavanja", "Datum isteka"];
    const tableRows = [];

    sanitarne.forEach((knjizica) => {
      const clientName = clients.find((c) => c.id === knjizica.clientId)?.name || "";
      const row = [
        clientName,
        knjizica.employeeName,
        knjizica.dateIssued,
        knjizica.expiryDate,
      ];
      tableRows.push(row);
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      styles: { fontSize: 10 },
    });

    const filename = `Izvjestaj_sanitarnih_${startExpiryDate || "start"}_do_${endExpiryDate || "end"}.pdf`;
    doc.save(filename);
  };

  return (
    <Box>
      <Heading size="lg" mb={6}>
        Sanitarne knjižice
      </Heading>

      <Flex wrap="wrap" gap={3} mb={6}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Odaberi klijenta</option>
          {Array.isArray(clients) && clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          placeholder="Ime zaposlenika"
          value={employeeName}
          onChange={(e) => setEmployeeName(e.target.value)}
          maxW="200px"
        />
        <Input
          type="date"
          placeholder="Datum izdavanja"
          value={dateIssued}
          onChange={(e) => setDateIssued(e.target.value)}
          maxW="200px"
        />
        <Input
          type="date"
          placeholder="Datum isteka"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          maxW="200px"
        />

        <Button colorScheme="orange" onClick={saveSanitarna} minW="160px">
          {editId ? "Sačuvaj izmjene" : "Dodaj sanitarnu"}
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

      {/* Filter po datumu isteka */}
      <Flex gap={3} mb={6} alignItems="center">
        <Input
          type="date"
          placeholder="Od datuma isteka"
          value={startExpiryDate}
          onChange={(e) => setStartExpiryDate(e.target.value)}
          maxW="200px"
        />
        <Input
          type="date"
          placeholder="Do datuma isteka"
          value={endExpiryDate}
          onChange={(e) => setEndExpiryDate(e.target.value)}
          maxW="200px"
        />
        <Button colorScheme="teal" onClick={generatePdf} minW="160px">
          Preuzmi PDF izvještaj
        </Button>
      </Flex>

      <Table variant="striped" colorScheme="orange" size="sm">
        <Thead>
          <Tr>
            <Th>Klijent</Th>
            <Th>Zaposlenik</Th>
            <Th>Datum izdavanja</Th>
            <Th>Datum isteka</Th>
            <Th>Akcije</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sanitarne.length === 0 ? (
            <Tr>
              <Td colSpan={5} textAlign="center">
                Nema unesenih sanitarnjih knjižica.
              </Td>
            </Tr>
          ) : (
            sanitarne.map((s) => (
              <Tr key={s.id}>
                <Td>{clients.find((c) => c.id === s.clientId)?.name}</Td>
                <Td>{s.employeeName}</Td>
                <Td>{s.dateIssued}</Td>
                <Td>{s.expiryDate}</Td>
                <Td>
                  <Button size="sm" colorScheme="yellow" mr={2} onClick={() => startEdit(s)}>
                    Uredi
                  </Button>
                  <Button size="sm" colorScheme="red" onClick={() => deleteSanitarna(s.id)}>
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

export default Sanitarne;
