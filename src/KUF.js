import React, { useState, useEffect } from "react";
import {
  Box,
  Heading,
  Flex,
  Input,
  Select,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
} from "@chakra-ui/react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { EditIcon, DeleteIcon, CheckIcon, CloseIcon } from "@chakra-ui/icons";

const BACKEND_URL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

function KUF() {
  const [kufs, setKufs] = useState([]);
  const [form, setForm] = useState({
    brojKuf: "",
    datumKuf: "",
    datumPrijema: new Date().toISOString().slice(0, 10),
    imeKomitenta: "",
    iznos: "",
    izvodBroj: "",
    placeno: false,
  });

  const [komitenti, setKomitenti] = useState([]);
  const [newKomitent, setNewKomitent] = useState({
    ime: "",
    adresa: "",
    idBroj: "",
    izvodBroj: "",
  });

  const [showPaidOnly, setShowPaidOnly] = useState(false);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);

  // Za editovanje stavke u tabeli
  const [editIndex, setEditIndex] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    fetch(BACKEND_URL + "/api/kufs")
      .then((res) => {
        if (!res.ok) throw new Error(`Kufs API error! status: ${res.status}`);
        return res.json();
      })
      .then(setKufs)
      .catch((err) => console.error("Greška pri dohvatu kufs:", err));

    // Komitenti su lokalni, nema fetch s backend-a
  }, []);

  function handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "iznos") {
      const num = parseFloat(val);
      val = !isNaN(num) ? num.toFixed(2) : "";
    }

    setForm((prev) => ({
      ...prev,
      [name]: val,
    }));
  }

  function dodajKomitenta() {
    if (!newKomitent.ime || !newKomitent.adresa || !newKomitent.idBroj) {
      alert("Popunite sva polja za novog komitenta.");
      return;
    }
    setKomitenti((prev) => [...prev, { ...newKomitent }]);
    setNewKomitent({ ime: "", adresa: "", idBroj: "", izvodBroj: "" });
  }

  function handleKomitentTableChange(index, field, value) {
    setKomitenti((prev) =>
      prev.map((k, i) => (i === index ? { ...k, [field]: value } : k))
    );
  }

  function obrisiKomitenta(index) {
    setKomitenti((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveKuf() {
    if (!form.brojKuf || !form.datumKuf || !form.imeKomitenta || !form.iznos) {
      alert(
        "Molimo popunite obavezna polja: Broj KUF, Datum KUF, Ime komitenta, Iznos."
      );
      return;
    }

    try {
      const res = await fetch(BACKEND_URL + "/api/kufs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Greška pri unosu KUF-a");
      const noviKuf = await res.json();

      setKufs((prev) => [...prev, noviKuf]);
      setForm({
        brojKuf: "",
        datumKuf: "",
        datumPrijema: new Date().toISOString().slice(0, 10),
        imeKomitenta: "",
        iznos: "",
        izvodBroj: "",
        placeno: false,
      });
    } catch (err) {
      alert(err.message);
    }
  }

  async function updateKuf(id, updatedFields) {
    try {
      const res = await fetch(BACKEND_URL + `/api/kufs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });
      if (!res.ok) throw new Error("Greška pri ažuriranju KUF-a");

      setKufs((prev) =>
        prev.map((kuf) => (kuf.id === id ? { ...kuf, ...updatedFields } : kuf))
      );
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteKuf(id) {
    try {
      const res = await fetch(BACKEND_URL + `/api/kufs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Greška pri brisanju KUF-a");

      setKufs((prev) => prev.filter((kuf) => kuf.id !== id));
    } catch (err) {
      alert(err.message);
    }
  }

  function startEdit(index) {
    setEditIndex(index);
    setEditData(kufs[index]);
  }

  function cancelEdit() {
    setEditIndex(null);
    setEditData({});
  }

  function handleEditChange(e) {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "iznos") {
      const num = parseFloat(val);
      val = !isNaN(num) ? num.toFixed(2) : "";
    }

    setEditData((prev) => ({
      ...prev,
      [name]: val,
    }));
  }

  async function saveEdit() {
    try {
      await updateKuf(editData.id, editData);
      setEditIndex(null);
      setEditData({});
    } catch {
      // error handling u updateKuf funkciji
    }
  }

  function togglePlaceno(index) {
    if (editIndex === index) {
      setEditData((prev) => ({ ...prev, placeno: !prev.placeno }));
    } else {
      const kuf = kufs[index];
      updateKuf(kuf.id, { ...kuf, placeno: !kuf.placeno });
    }
  }

  function handleKufIzvodChange(index, value) {
    if (editIndex === index) {
      setEditData((prev) => ({ ...prev, izvodBroj: value }));
    } else {
      const kuf = kufs[index];
      updateKuf(kuf.id, { ...kuf, izvodBroj: value });
    }
  }

  const filteredKufs = kufs.filter((kuf) => {
    if (showPaidOnly) return kuf.placeno === true;
    if (showUnpaidOnly) return kuf.placeno === false;
    return true;
  });

  function generatePDF() {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Izvještaj KUF", 14, 22);

    const tableColumn = [
      "Broj KUF",
      "Datum KUF",
      "Datum prijema",
      "Ime komitenta",
      "Izvod broj",
      "Iznos",
      "Plaćeno",
    ];

    const tableRows = filteredKufs.map((kuf) => [
      kuf.brojKuf,
      kuf.datumKuf,
      kuf.datumPrijema,
      kuf.imeKomitenta,
      kuf.izvodBroj || "",
      kuf.iznos,
      kuf.placeno ? "Da" : "Ne",
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 30,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [41, 128, 185], fontStyle: "bold" },
    });

    doc.save(`Izvjestaj_KUF_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <Box p={5}>
      <Heading mb={6}>Unos i pregled KUF</Heading>

      {/* Forma za unos KUF */}
      <Flex gap={3} wrap="wrap" mb={6} alignItems="center">
        <Input
          name="brojKuf"
          placeholder="Broj KUF"
          value={form.brojKuf}
          onChange={handleInputChange}
          maxW="150px"
          size="sm"
          disabled={editIndex !== null}
        />
        <Input
          name="datumKuf"
          type="date"
          placeholder="Datum KUF"
          value={form.datumKuf}
          onChange={handleInputChange}
          maxW="150px"
          size="sm"
          disabled={editIndex !== null}
        />
        <Input
          name="datumPrijema"
          type="date"
          placeholder="Datum prijema"
          value={form.datumPrijema}
          onChange={handleInputChange}
          maxW="150px"
          size="sm"
          isReadOnly
          disabled={editIndex !== null}
        />
        <Select
          name="imeKomitenta"
          placeholder="Ime komitenta"
          value={form.imeKomitenta}
          onChange={handleInputChange}
          maxW="200px"
          size="sm"
          disabled={editIndex !== null}
        >
          {komitenti.map((k, index) => (
            <option key={index} value={k.ime}>
              {k.ime}
            </option>
          ))}
        </Select>
        <Input
          name="iznos"
          type="number"
          placeholder="Iznos KUF"
          value={form.iznos}
          onChange={handleInputChange}
          maxW="150px"
          size="sm"
          min="0"
          disabled={editIndex !== null}
        />
        <Input
          name="izvodBroj"
          placeholder="Izvod broj"
          value={form.izvodBroj}
          onChange={handleInputChange}
          maxW="150px"
          size="sm"
          disabled={editIndex !== null}
        />
        {editIndex === null && (
          <Button colorScheme="green" onClick={saveKuf} size="sm">
            Dodaj KUF
          </Button>
        )}
        {editIndex !== null && (
          <>
            <Button colorScheme="green" onClick={saveEdit} size="sm">
              Sačuvaj izmjene
            </Button>
            <Button colorScheme="gray" onClick={cancelEdit} size="sm">
              Otkaži
            </Button>
          </>
        )}
      </Flex>

      {/* Filter i dugmad */}
      <Flex gap={4} alignItems="center" mb={4}>
        <Flex alignItems="center" gap={2}>
          <input
            type="checkbox"
            id="paidOnly"
            checked={showPaidOnly}
            onChange={() => {
              setShowPaidOnly((p) => !p);
              if (!showPaidOnly) setShowUnpaidOnly(false);
            }}
          />
          <label htmlFor="paidOnly">Prikaži samo plaćene</label>
        </Flex>
        <Flex alignItems="center" gap={2}>
          <input
            type="checkbox"
            id="unpaidOnly"
            checked={showUnpaidOnly}
            onChange={() => {
              setShowUnpaidOnly((p) => !p);
              if (!showUnpaidOnly) setShowPaidOnly(false);
            }}
          />
          <label htmlFor="unpaidOnly">Prikaži samo neplaćene</label>
        </Flex>
        <Button colorScheme="blue" onClick={generatePDF} minW="200px">
          Generiši PDF
        </Button>
      </Flex>

      {/* Tabela KUF-ova */}
      <Table
        variant="striped"
        colorScheme="orange"
        size="sm"
        borderRadius="md"
        overflow="hidden"
      >
        <Thead bg="transparent" color="inherit">
          <Tr>
            <Th>Broj KUF</Th>
            <Th>Datum KUF</Th>
            <Th>Datum prijema</Th>
            <Th>Ime komitenta</Th>
            <Th>Izvod broj</Th>
            <Th>Iznos</Th>
            <Th>Plaćeno</Th>
            <Th>Akcije</Th>
          </Tr>
        </Thead>
        <Tbody bg="orange.50">
          {filteredKufs.length === 0 ? (
            <Tr>
              <Td colSpan={8} textAlign="center">
                Nema unesenih KUF-ova.
              </Td>
            </Tr>
          ) : (
            filteredKufs.map((kuf, index) => (
              <Tr key={kuf.id || kuf.brojKuf + index} _even={{ bg: "orange.100" }}>
                <Td>
                  {editIndex === index ? (
                    <Input
                      name="brojKuf"
                      size="sm"
                      value={editData.brojKuf}
                      onChange={handleEditChange}
                    />
                  ) : (
                    kuf.brojKuf
                  )}
                </Td>
                <Td>
                  {editIndex === index ? (
                    <Input
                      name="datumKuf"
                      type="date"
                      size="sm"
                      value={editData.datumKuf}
                      onChange={handleEditChange}
                    />
                  ) : (
                    kuf.datumKuf
                  )}
                </Td>
                <Td>{kuf.datumPrijema}</Td>
                <Td>
                  {editIndex === index ? (
                    <Select
                      name="imeKomitenta"
                      size="sm"
                      value={editData.imeKomitenta}
                      onChange={handleEditChange}
                    >
                      {komitenti.map((k, i) => (
                        <option key={i} value={k.ime}>
                          {k.ime}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    kuf.imeKomitenta
                  )}
                </Td>
                <Td>
                  {editIndex === index ? (
                    <Input
                      name="izvodBroj"
                      size="sm"
                      value={editData.izvodBroj}
                      onChange={handleEditChange}
                    />
                  ) : (
                    kuf.izvodBroj
                  )}
                </Td>
                <Td>
                  {editIndex === index ? (
                    <Input
                      name="iznos"
                      type="number"
                      size="sm"
                      value={editData.iznos}
                      onChange={handleEditChange}
                    />
                  ) : (
                    kuf.iznos
                  )}
                </Td>
                <Td>
                  {editIndex === index ? (
                    <input
                      name="placeno"
                      type="checkbox"
                      checked={editData.placeno}
                      onChange={handleEditChange}
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={kuf.placeno}
                      onChange={() => togglePlaceno(index)}
                    />
                  )}
                </Td>
                <Td>
                  {editIndex === index ? (
                    <>
                      <IconButton
                        aria-label="Spremi"
                        icon={<CheckIcon />}
                        size="sm"
                        colorScheme="green"
                        mr={2}
                        onClick={saveEdit}
                      />
                      <IconButton
                        aria-label="Otkaži"
                        icon={<CloseIcon />}
                        size="sm"
                        colorScheme="gray"
                        onClick={cancelEdit}
                      />
                    </>
                  ) : (
                    <>
                      <IconButton
                        aria-label="Uredi"
                        icon={<EditIcon />}
                        size="sm"
                        colorScheme="yellow"
                        mr={2}
                        onClick={() => startEdit(index)}
                      />
                      <IconButton
                        aria-label="Obriši"
                        icon={<DeleteIcon />}
                        size="sm"
                        colorScheme="red"
                        onClick={() => deleteKuf(kuf.id)}
                      />
                    </>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Komitenti na dnu */}
      <Box mt={10} border="1px solid #ccc" borderRadius="md" p={4}>
        <Heading size="md" mb={4}>
          Komitenti
        </Heading>
        {komitenti.length === 0 && <Box>Nema unesenih komitenata.</Box>}
        {komitenti.length > 0 && (
          <Table variant="simple" size="sm" mb={4}>
            <Thead>
              <Tr>
                <Th>Ime</Th>
                <Th>Adresa</Th>
                <Th>ID broj</Th>
                <Th>Izvod broj</Th>
                <Th>Akcije</Th>
              </Tr>
            </Thead>
            <Tbody>
              {komitenti.map((k, i) => (
                <Tr key={i}>
                  <Td>
                    <Input
                      value={k.ime}
                      onChange={(e) =>
                        handleKomitentTableChange(i, "ime", e.target.value)
                      }
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Input
                      value={k.adresa}
                      onChange={(e) =>
                        handleKomitentTableChange(i, "adresa", e.target.value)
                      }
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Input
                      value={k.idBroj}
                      onChange={(e) =>
                        handleKomitentTableChange(i, "idBroj", e.target.value)
                      }
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Input
                      value={k.izvodBroj || ""}
                      onChange={(e) =>
                        handleKomitentTableChange(i, "izvodBroj", e.target.value)
                      }
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Button
                      colorScheme="red"
                      size="sm"
                      onClick={() => obrisiKomitenta(i)}
                    >
                      Obriši
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        <Heading size="md" mb={4}>
          Dodaj novog komitenta
        </Heading>
        <Flex gap={3} wrap="wrap" alignItems="center">
          <Input
            name="ime"
            placeholder="Ime komitenta"
            value={newKomitent.ime}
            onChange={(e) => setNewKomitent((prev) => ({ ...prev, ime: e.target.value }))}
            maxW="200px"
            size="sm"
          />
          <Input
            name="adresa"
            placeholder="Adresa komitenta"
            value={newKomitent.adresa}
            onChange={(e) => setNewKomitent((prev) => ({ ...prev, adresa: e.target.value }))}
            maxW="300px"
            size="sm"
          />
          <Input
            name="idBroj"
            placeholder="ID broj komitenta"
            value={newKomitent.idBroj}
            onChange={(e) => setNewKomitent((prev) => ({ ...prev, idBroj: e.target.value }))}
            maxW="150px"
            size="sm"
          />
          <Button colorScheme="blue" onClick={dodajKomitenta} size="sm">
            Dodaj komitenta
          </Button>
        </Flex>
      </Box>
    </Box>
  );
}

export default KUF;
