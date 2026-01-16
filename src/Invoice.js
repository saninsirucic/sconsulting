import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Text,
} from "@chakra-ui/react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import RobotoRegular from "./fonts/roboto-regular.base64";
import { BACKEND_URL } from "./config";

// Funkcija za formatiranje datuma u dd/mm/yyyy sa dodatnom provjerom
function formatDate(dateStr) {
  if (!dateStr) return "-";

  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "-";

  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

// Helpers: godina iz datuma i iz broja fakture "NN/YY"
function getYearSuffixFromDate(dateString) {
  const d = new Date(dateString);
  const y = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  return String(y).slice(-2);
}

function parseInvoiceNumberParts(numberStr) {
  // Accepts:
  // - "223/25" -> { seq: 223, yearSuffix: "25" }
  // - "223"    -> { seq: 223, yearSuffix: null }
  const raw = String(numberStr ?? "").trim();
  if (!raw) return { seq: null, yearSuffix: null };

  if (raw.includes("/")) {
    const [seqPart, yearPart] = raw.split("/");
    const seq = parseInt(seqPart, 10);
    const yearSuffix = (yearPart || "").trim();
    return {
      seq: Number.isFinite(seq) ? seq : null,
      yearSuffix: /^\d{2}$/.test(yearSuffix) ? yearSuffix : null,
    };
  }

  const seq = parseInt(raw, 10);
  return { seq: Number.isFinite(seq) ? seq : null, yearSuffix: null };
}

function formatInvoiceNumber(seqNumber, dateString) {
  const yearSuffix = getYearSuffixFromDate(dateString);
  return `${seqNumber}/${yearSuffix}`;
}

function Invoice() {
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);

  // Redni broj (samo numerički dio), resetuje se po godini
  const [number, setNumber] = useState(1);

  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const description = "Usluge savjetovanja";
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [unit] = useState("paušal");
  const [amountInWords, setAmountInWords] = useState("");

  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [showPaidOnly, setShowPaidOnly] = useState(false);
  const [filterClientId, setFilterClientId] = useState("");

  // Trenutna godina (za prikaz liste dole): sakrij prošle godine
  const currentYearSuffix = useMemo(
    () => String(new Date().getFullYear()).slice(-2),
    []
  );

  // Godina iz izabranog datuma fakture (ovo odlučuje /YY i reset broja)
  const selectedYearSuffix = useMemo(() => getYearSuffixFromDate(date), [date]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/invoices`)
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri dohvatu faktura");
        return res.json();
      })
      .then((data) => {
        setInvoices(data);
      })
      .catch((err) => console.error(err.message));

    fetch(`${BACKEND_URL}/api/clients`)
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri dohvatu klijenata");
        return res.json();
      })
      .then(setClients)
      .catch((err) => console.error(err.message));
  }, []);

  // Recalculate next invoice number whenever invoices or selected date year changes
  useEffect(() => {
    if (!Array.isArray(invoices)) return;

    // uzmi max samo za godinu iz odabranog datuma fakture (npr. "26")
    const maxSeqForYear = invoices.reduce((max, inv) => {
      const { seq, yearSuffix } = parseInvoiceNumberParts(inv?.number);
      const invYear = yearSuffix || getYearSuffixFromDate(inv?.date || date);

      if (invYear !== selectedYearSuffix) return max;
      if (typeof seq === "number" && seq > max) return seq;
      return max;
    }, 0);

    // Ako nema nijedne fakture za tu godinu => kreći od 01
    setNumber(maxSeqForYear > 0 ? maxSeqForYear + 1 : 1);
  }, [invoices, selectedYearSuffix, date]);

  useEffect(() => {
    const selected = clients.find((c) => c.id === clientId);
    setAmountInWords(selected?.amountInWords || "");
  }, [clientId, clients]);

  const selectedClient = clients.find((c) => c.id === clientId) || {};

  const totalNoVat = Number(quantity) * Number(price || 0);
  const vat = +(totalNoVat * 0.17).toFixed(2);
  const total = +(totalNoVat + vat).toFixed(2);

  const saveInvoice = () => {
    if (!clientId || price === "") {
      alert("Popunite sva polja!");
      return;
    }

    // Formatiraj broj fakture s godinom (npr. "01/26", "223/26")
    const formattedNumber = formatInvoiceNumber(number, date);

    const faktura = {
      number: formattedNumber,
      clientId,
      date,
      description,
      quantity,
      price: Number(price),
      unit,
      contractNumber: selectedClient.contractNumber,
      paymentTerm: selectedClient.paymentTerm,
      totalNoVat,
      vat,
      total,
      amountInWords,
      paymentDate: null, // šalje NULL umjesto ""
      paymentOrderNumber: null, // šalje NULL umjesto ""
    };

    fetch(`${BACKEND_URL}/api/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(faktura),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri čuvanju fakture");
        return res.json();
      })
      .then((newInvoice) => {
        setInvoices((prev) => [...prev, newInvoice]);
        // number će se svakako ponovo izračunati u useEffect-u,
        // ali ostavimo i ovo radi UX-a
        setNumber((prev) => prev + 1);
        setQuantity(1);
        setPrice("");
        setAmountInWords("");
        alert(`Faktura broj ${newInvoice.number} je sačuvana.`);
      })
      .catch((err) => alert(err.message));
  };

  const exportToPDF = (invoice) => {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const M = 14;

    // — UGRADI CUSTOM FONT —
    doc.addFileToVFS("Roboto-Regular.ttf", RobotoRegular);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.setFont("Roboto", "normal");
    doc.setFontSize(10);

    // — HEADER —
    doc.text('O.D. "S Consulting"  - vl. Siručić Sanin', M, 20);
    doc.text("Tvornička 3.", M, 26);
    doc.text("71000 Sarajevo", M, 32);
    doc.text("ID: 4303589960006", M, 38);
    doc.text("PDV: 303589960006", M, 44);
    doc.text("+387/33 848-871", M, 50);
    doc.text("info@s-consulting.ba", M, 56);
    doc.setLineWidth(0.5);
    doc.line(M, 65, W - M, 65);

    // — KLIJENT —
    const c = clients.find((c) => c.id === invoice.clientId) || {};
    doc.setFontSize(12);
    doc.text(`Klijent: ${c.name || ""}`, M, 72);
    doc.text(`Adresa: ${c.address || ""}`, M, 79);
    doc.text(`Poštanski broj: ${c.postalCode || ""}`, M, 86);
    doc.text(`ID broj: ${c.companyId || ""}`, M, 93);
    doc.text(`PDV broj: ${c.pib || ""}`, M, 100);

    // — NASLOV & DATUM —
    const Y = 120;
    doc.setFontSize(26);
    doc.text(`Faktura broj: ${invoice.number}`, M, Y);
    doc.setFontSize(12);
    doc.text(`Datum izdavanja: ${formatDate(invoice.date)}`, W - M, Y, {
      align: "right",
    });

    // — TABELA —
    autoTable(doc, {
      startY: 130,
      margin: { left: M, right: M },
      head: [
        [
          "Redni broj",
          "Opis usluge",
          "Kolicina",
          "Cijena",
          "Jedinica mjere",
          "Iznos bez PDV",
          "PDV (17%)",
          "Ukupan iznos sa PDV-om",
        ],
      ],
      body: [
        [
          1,
          invoice.description,
          invoice.quantity,
          invoice.price.toFixed(2),
          invoice.unit,
          invoice.totalNoVat.toFixed(2),
          invoice.vat.toFixed(2),
          invoice.total.toFixed(2),
        ],
      ],
      styles: { font: "Roboto", fontSize: 8 },
      headStyles: {
        font: "Roboto",
        fontStyle: "bold",
        fontSize: 9,
        fillColor: [41, 128, 185],
      },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 50, halign: "left" },
        2: { cellWidth: 15, halign: "center" },
        3: { cellWidth: 20, halign: "center" },
        4: { cellWidth: 15, halign: "center" },
        5: { cellWidth: 23, halign: "right" },
        6: { cellWidth: 20, halign: "right" },
        7: { cellWidth: 25, halign: "right" },
      },
    });

    // — UKUPNI IZNOSI —
    const afterY = doc.lastAutoTable.finalY + 10;
    const RX = W - M;
    doc.setFontSize(12);
    doc.text(`Iznos bez PDV-a: ${invoice.totalNoVat.toFixed(2)} KM`, RX, afterY, {
      align: "right",
    });
    doc.text(`PDV (17%): ${invoice.vat.toFixed(2)} KM`, RX, afterY + 6, {
      align: "right",
    });
    doc.text(`Ukupan iznos sa PDV-om: ${invoice.total.toFixed(2)} KM`, RX, afterY + 12, {
      align: "right",
    });
    doc.text(`Slovima: ${invoice.amountInWords}`, RX, afterY + 18, { align: "right" });

    // — DNO & POTPIS —
    doc.setFontSize(10);

    // ovdje vadimo samo broj prije "/" i parsiramo ga u integer
    const rawNum = String(invoice.number).split("/")[0];
    const numVal = parseInt(rawNum, 10) || 0;
    const fiscalNum = 490 + numVal;

    doc.text(`Broj fiskalnog računa: ${fiscalNum}`, M, afterY + 30);
    doc.text(`Broj ugovora: ${invoice.contractNumber}`, M, afterY + 36);
    doc.text(`Rok plaćanja (dana): ${invoice.paymentTerm}`, M, afterY + 42);
    doc.text("Transakcijski račun broj: 1941410306700108 kod ProCredit banke", M, afterY + 48);

<<<<<<< HEAD
    const line = "_______________________________";
    const lw = doc.getTextWidth(line);
    const lx = W - M - lw;
    const ly = afterY + 78;
    doc.text("VLASNIK", lx + (lw - doc.getTextWidth("VLASNIK")) / 2, ly);
    doc.text(line, lx, ly + 18);
=======
  // ovdje vadimo samo broj prije "/" i parsiramo ga u integer
  const rawNum = String(invoice.number).split("/")[0];
  const numVal = parseInt(rawNum, 10) || 0;
  const fiscalNum = 496 + numVal;  // 496 = 719 - 223
>>>>>>> ec9592fe6cc6da95adbe46d61be7f207f71deac1

    // — SPREMI PDF —
    // invoice.number je već u formatu "NN/YY" (npr. 01/26) → samo zamijeni "/" u "-"
    const safeNum = String(invoice.number).replace(/\//g, "-");
    doc.save(`Faktura_${safeNum}.pdf`);
  };

  const deleteInvoice = (id) => {
    if (!window.confirm("Da li ste sigurni da želite obrisati ovu fakturu?")) return;
    fetch(`${BACKEND_URL}/api/invoices/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri brisanju");
        setInvoices(invoices.filter((inv) => inv.id !== id));
      })
      .catch((err) => alert(err.message));
  };

  function updateInvoiceField(id, field, value) {
    let updatedValue = value;

    // Ako se briše datum ili broj izvoda, šalji null umjesto ""
    if ((field === "paymentDate" || field === "paymentOrderNumber") && (value === "" || value === null)) {
      updatedValue = null;
    }

    fetch(`${BACKEND_URL}/api/invoices/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: updatedValue }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri ažuriranju fakture");
        // Nakon uspješnog updatea ponovo dohvat faktura
        return fetch(`${BACKEND_URL}/api/invoices`);
      })
      .then((res) => res.json())
      .then((data) => setInvoices(data)) // Update state sa novim podacima
      .catch(() => alert("Greška pri ažuriranju fakture"));
  }

  // Lista faktura: filtriraj sve iz prošlih godina (da se ne pojavljuju dole)
  const currentYearInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const invYear = getYearSuffixFromInvoice(inv);
      return invYear === currentYearSuffix;
    });
  }, [invoices, currentYearSuffix]);

  const filteredInvoices = currentYearInvoices.filter((inv) => {
    if (showUnpaidOnly && inv.paymentDate) return false;
    if (showPaidOnly && !inv.paymentDate) return false;
    if (filterClientId && inv.clientId !== filterClientId) return false;
    return true;
  });

  return (
    <Box p={5}>
      <Heading mb={6}>Nova faktura</Heading>

      <Flex mb={4} gap={4} alignItems="center">
        <Select
          placeholder="Filtriraj po klijentu"
          value={filterClientId}
          onChange={(e) => setFilterClientId(e.target.value)}
          maxW="200px"
          size="sm"
        >
          <option value="">Svi klijenti</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <Flex alignItems="center" gap={2}>
          <input
            type="checkbox"
            id="unpaidOnly"
            checked={showUnpaidOnly}
            onChange={() => {
              setShowUnpaidOnly((prev) => !prev);
              if (!showUnpaidOnly) setShowPaidOnly(false);
            }}
          />
          <label htmlFor="unpaidOnly">Prikaži samo neplaćene</label>
        </Flex>

        <Flex alignItems="center" gap={2} ml={4}>
          <input
            type="checkbox"
            id="paidOnly"
            checked={showPaidOnly}
            onChange={() => {
              setShowPaidOnly((prev) => !prev);
              if (!showPaidOnly) setShowUnpaidOnly(false);
            }}
          />
          <label htmlFor="paidOnly">Prikaži samo plaćene</label>
        </Flex>

        <Button
          colorScheme="blue"
          onClick={() => {
            if (!filterClientId && !showUnpaidOnly && !showPaidOnly) {
              alert("Molimo odaberite bar jedan filter: klijent ili plaćene/neplaćene fakture.");
              return;
            }
            if (filteredInvoices.length === 0) {
              alert("Nema faktura koje zadovoljavaju kriterije.");
              return;
            }
            const doc = new jsPDF();

            doc.setFontSize(16);
            doc.text("Izvještaj faktura", 14, 20);

            const bodyData = filteredInvoices.map((inv, idx) => {
              const clientName = clients.find((c) => c.id === inv.clientId)?.name || "Nepoznat";
              const formattedDate = formatDate(inv.date);

              return [
                idx + 1,
                inv.number,
                clientName,
                formattedDate,
                typeof inv.total === "number" ? inv.total.toFixed(2) : "-",
              ];
            });

            autoTable(doc, {
              head: [["Br.", "Broj fakture", "Klijent", "Datum", "Ukupno KM"]],
              body: bodyData,
              startY: 30,
              styles: { fontSize: 10 },
              headStyles: { fillColor: [41, 128, 185] },
              alternateRowStyles: { fillColor: [240, 240, 240] },
            });

            const totalSum = filteredInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

            const finalY = doc.lastAutoTable?.finalY || 40;
            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.text(`Ukupno: ${totalSum.toFixed(2)} KM`, doc.internal.pageSize.getWidth() - 14, finalY + 10, {
              align: "right",
            });

            doc.save(`Izvjestaj_faktura_${new Date().toISOString().slice(0, 10)}.pdf`);
          }}
          minW="200px"
        >
          Generiši PDF (Filtrirano)
        </Button>
      </Flex>

      <Flex wrap="wrap" gap={2} mb={6} alignItems="center" justifyContent="flex-start">
        <Input value={number} isReadOnly placeholder="Broj fakture" maxW="100px" size="sm" />
        <Select
          placeholder="Odaberi klijenta"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          maxW="200px"
          size="sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} maxW="160px" size="sm" />
        <Input value={description} readOnly maxW="220px" size="sm" textAlign="center" />
        <Input type="number" value={quantity} min={1} onChange={(e) => setQuantity(Number(e.target.value))} maxW="80px" size="sm" />
        <Input
          type="number"
          value={price}
          min={0}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Cijena"
          maxW="100px"
          size="sm"
        />
        <Input value={unit} readOnly maxW="80px" size="sm" />
        <Input value={selectedClient.contractNumber || ""} readOnly placeholder="Broj ugovora" maxW="120px" size="sm" />
        <Input value={selectedClient.paymentTerm || ""} readOnly placeholder="Rok plaćanja (dana)" maxW="120px" size="sm" />
        <Input value={amountInWords} onChange={(e) => setAmountInWords(e.target.value)} placeholder="Slovima" maxW="200px" size="sm" />
        <Button colorScheme="green" onClick={saveInvoice} fontWeight="bold" size="sm">
          Snimi fakturu
        </Button>
        <Button
          colorScheme="red"
          onClick={() => {
            if (!invoices.length) return alert("Nema sačuvanih faktura za izvoz.");
            exportToPDF(invoices[invoices.length - 1]);
          }}
          fontWeight="bold"
          size="sm"
        >
          Izvezi PDF zadnje fakture
        </Button>
      </Flex>

      <Flex justify="space-between" mb={4} fontWeight="bold" maxW="450px" mr="auto">
        <Text>Iznos bez PDV: {typeof totalNoVat === "number" ? totalNoVat.toFixed(2) : "-"} KM</Text>
        <Text>PDV 17%: {typeof vat === "number" ? vat.toFixed(2) : "-"} KM</Text>
        <Text>Ukupno: {typeof total === "number" ? total.toFixed(2) : "-"} KM</Text>
      </Flex>

      <Heading size="md" mb={4}>
        Lista faktura
      </Heading>

      <Table variant="striped" colorScheme="orange" size="sm" borderRadius="md" overflow="hidden">
        <Thead bg="transparent" color="inherit">
          <Tr>
            <Th>Broj fakture</Th>
            <Th>Klijent</Th>
            <Th>Datum izdavanja</Th>
            <Th>Ukupno (KM)</Th>
            <Th>Datum plaćanja</Th>
            <Th>Broj izvoda</Th>
            <Th>Akcije</Th>
          </Tr>
        </Thead>
        <Tbody bg="orange.50">
          {filteredInvoices.length === 0 ? (
            <Tr>
              <Td colSpan={7} textAlign="center">
                Nema unesenih faktura.
              </Td>
            </Tr>
          ) : (
            filteredInvoices.map((inv) => {
              const clientName = clients.find((c) => c.id === inv.clientId)?.name || "Nepoznat";
              return (
                <Tr key={inv.id} _even={{ bg: "orange.100" }}>
                  <Td>{inv.number}</Td>
                  <Td>{clientName}</Td>
                  <Td>{inv.date && !isNaN(new Date(inv.date).getTime()) ? formatDate(inv.date) : "-"}</Td>
                  <Td>{typeof inv.total === "number" ? inv.total.toFixed(2) : "-"}</Td>
                  <Td>
                    <Input
                      type="date"
                      value={inv.paymentDate ? inv.paymentDate.slice(0, 10) : ""}
                      onChange={(e) =>
                        updateInvoiceField(inv.id, "paymentDate", e.target.value === "" ? null : e.target.value)
                      }
                      width="140px"
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Input
                      type="text"
                      value={inv.paymentOrderNumber || ""}
                      onChange={(e) => updateInvoiceField(inv.id, "paymentOrderNumber", e.target.value)}
                      placeholder="Broj izvoda"
                      width="140px"
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <Button size="sm" colorScheme="red" onClick={() => exportToPDF(inv)} mr={2}>
                      PDF
                    </Button>
                    <Button size="sm" colorScheme="yellow" onClick={() => alert("Opcija uređivanja u pripremi")} mr={2}>
                      Uredi
                    </Button>
                    <Button size="sm" colorScheme="red" onClick={() => deleteInvoice(inv.id)}>
                      Obriši
                    </Button>
                  </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>
    </Box>
  );
}

export default Invoice;

// Helper for filtering invoices by year, without breaking existing data
function getYearSuffixFromInvoice(inv) {
  const n = String(inv?.number || "");
  if (n.includes("/")) {
    const suf = n.split("/")[1];
    if (suf && /^\d{2}$/.test(suf)) return suf;
  }
  if (inv?.date) return getYearSuffixFromDate(inv.date);
  return String(new Date().getFullYear()).slice(-2);
}
