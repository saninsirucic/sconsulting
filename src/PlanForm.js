import React, { useEffect, useState } from "react";
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
} from "@chakra-ui/react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function PlanForm() {
  const backendURL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [executors, setExecutors] = useState([]);

  const [clientId, setClientId] = useState("");
  const [executorId, setExecutorId] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [recurrence, setRecurrence] = useState(1);
  const [endDate, setEndDate] = useState("");
  const [price, setPrice] = useState("");

  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);

  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");

  const [deleteClientId, setDeleteClientId] = useState("");
  const [deleteStartDate, setDeleteStartDate] = useState("");
  const [deleteEndDate, setDeleteEndDate] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    fetch(`${backendURL}/api/plans`)
      .then((res) => {
        if (!res.ok) throw new Error(`Plans API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Plans data:", data);
        if (Array.isArray(data)) setPlans(data);
        else {
          console.error("Plans API nije vratio niz:", data);
          setPlans([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri dohvatu planova:", err);
        setPlans([]);
      });

    fetch(`${backendURL}/api/clients`)
      .then((res) => {
        if (!res.ok) throw new Error(`Clients API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Clients data:", data);
        if (Array.isArray(data)) setClients(data);
        else {
          console.warn("Neočekivan format podataka za clients:", data);
          setClients([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri dohvatu klijenata:", err);
        setClients([]);
      });

    fetch(`${backendURL}/api/executors`)
      .then((res) => {
        if (!res.ok) throw new Error(`Executors API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Executors data:", data);
        if (Array.isArray(data)) setExecutors(data);
        else {
          console.warn("Neočekivan format podataka za executors:", data);
          setExecutors([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri dohvatu izvođača:", err);
        setExecutors([]);
      });
  };

  const clearForm = () => {
    setClientId("");
    setExecutorId("");
    setService("");
    setDate("");
    setRecurrence(1);
    setEndDate("");
    setPrice("");
    setEditId(null);
  };

  const savePlan = () => {
    if (!clientId) return alert("Molimo izaberite klijenta.");
    if (!executorId) return alert("Molimo izaberite izvođača.");
    if (!service.trim()) return alert("Molimo unesite uslugu.");
    if (!date) return alert("Molimo unesite datum početka.");
    if (!endDate) return alert("Molimo unesite datum završetka.");

    const recurrenceNumber = Number(recurrence);
    if (isNaN(recurrenceNumber) || recurrenceNumber < 1)
      return alert("Broj ponavljanja mora biti pozitivan broj.");

    const priceNumber = price === "" ? 0 : Number(price);
    if (isNaN(priceNumber) || priceNumber < 0)
      return alert("Cijena mora biti pozitivan broj ili 0.");

    const start = new Date(date);
    const end = new Date(endDate);
    if (end < start) return alert("Datum završetka ne može biti prije datuma početka.");

    const createPlanPayload = (d) => ({
      clientId,
      executorId,
      service,
      date: d,
      recurrence: recurrenceNumber,
      price: priceNumber,
    });

    if (recurrenceNumber === 1) {
      fetch(`${backendURL}/api/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPlanPayload(date)),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Greška pri dodavanju plana");
          return res.json();
        })
        .then((plan) => {
          setPlans((prev) => [...prev, plan]);
          clearForm();
          loadData();
        })
        .catch((err) => {
          console.error(err);
          alert("Greška pri dodavanju plana.");
        });
      return;
    }

    const interval = (end.getTime() - start.getTime()) / (recurrenceNumber - 1);
    let plansToAdd = [];
    for (let i = 0; i < recurrenceNumber; i++) {
      const planDate = new Date(start.getTime() + interval * i)
        .toISOString()
        .split("T")[0];
      plansToAdd.push(createPlanPayload(planDate));
    }

    Promise.all(
      plansToAdd.map((plan) =>
        fetch(`${backendURL}/api/plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan),
        }).then((res) => {
          if (!res.ok) throw new Error("Greška pri dodavanju plana");
          return res.json();
        })
      )
    )
      .then((addedPlans) => {
        setPlans((prev) => [...prev, ...addedPlans]);
        clearForm();
        loadData();
      })
      .catch((err) => {
        console.error(err);
        alert("Greška pri dodavanju planova.");
      });
  };

  const deletePlan = (id) => {
    fetch(`${backendURL}/api/plans/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("Greška pri brisanju plana");
        return res.json();
      })
      .then(() => {
        setPlans(plans.filter((p) => p.id !== id));
      })
      .catch((err) => {
        console.error(err);
        alert("Greška pri brisanju plana.");
      });
  };

  const startEdit = (plan) => {
    setEditId(plan.id);
    setClientId(plan.clientId || "");
    setExecutorId(plan.executorId || "");
    setService(plan.service || "");
    setDate(plan.date || "");
    setRecurrence(plan.recurrence || 1);
    setEndDate("");
    setPrice(plan.price !== undefined && plan.price !== null ? plan.price : "");
  };

  const safePlans = Array.isArray(plans) ? plans : [];
  const safeClients = Array.isArray(clients) ? clients : [];
  const safeExecutors = Array.isArray(executors) ? executors : [];

  const filteredPlans = safePlans.filter(
    (p) =>
      (p.service && p.service.toLowerCase().includes(search.toLowerCase())) ||
      (safeClients.find((c) => c.id === p.clientId)?.name
        .toLowerCase()
        .includes(search.toLowerCase())) ||
      (safeExecutors.find((e) => e.id === p.executorId)?.name
        .toLowerCase()
        .includes(search.toLowerCase())) ||
      (p.date && p.date.includes(search))
  );

  const generatePDF = () => {
    if (!reportStartDate || !reportEndDate) {
      alert("Molimo odaberite oba datuma za izvještaj.");
      return;
    }
    const start = new Date(reportStartDate);
    const end = new Date(reportEndDate);

    const filtered = safePlans.filter((p) => {
      const pDate = new Date(p.date);
      return pDate >= start && pDate <= end;
    });

    const doc = new jsPDF();

    doc.setFont("helvetica", "normal");
    doc.text("Izvještaj planova", 14, 15);

    const tableColumn = ["Usluga", "Klijent", "Izvođač", "Datum", "Iznos"];

    autoTable(doc, {
      startY: 20,
      head: [tableColumn],
      body: filtered.map((p) => {
        const clientName = safeClients.find((c) => c.id === p.clientId)?.name || "Nepoznato";
        const executorName = safeExecutors.find((e) => e.id === p.executorId)?.name || "Nepoznato";
        return [
          p.service,
          clientName,
          executorName,
          p.date,
          p.price !== undefined && p.price !== null ? p.price.toFixed(2) : "-",
        ];
      }),
    });

    doc.save(`Izvjestaj_planova_${reportStartDate}_do_${reportEndDate}.pdf`);
  };

  const deletePlansByClientAndPeriod = async () => {
    if (!deleteClientId || !deleteStartDate || !deleteEndDate) {
      alert("Molimo popunite sve podatke za brisanje planova.");
      return;
    }
    if (!window.confirm("Da li ste sigurni da želite obrisati planove za izabrani period?")) return;

    try {
      const res = await fetch(`${backendURL}/api/plans/delete-by-client-and-period`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: deleteClientId,
          startDate: deleteStartDate,
          endDate: deleteEndDate,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Obrisano planova: ${data.deletedCount}`);
        loadData();
        setDeleteClientId("");
        setDeleteStartDate("");
        setDeleteEndDate("");
      } else {
        alert("Greška pri brisanju planova");
      }
    } catch (error) {
      alert("Greška pri brisanju planova");
      console.error(error);
    }
  };

  return (
    <Box>
      <Heading size="lg" mb={6}>
        Planovi
      </Heading>

      <Flex wrap="wrap" gap={3} mb={6} alignItems="center">
        <Select
          placeholder="Odaberi klijenta"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          maxW="200px"
        >
          {safeClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          placeholder="Odaberi izvođača"
          value={executorId}
          onChange={(e) => setExecutorId(e.target.value)}
          maxW="200px"
        >
          {safeExecutors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Usluga"
          value={service}
          onChange={(e) => setService(e.target.value)}
          maxW="200px"
        />
        <Input
          type="date"
          placeholder="Datum početka"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          maxW="160px"
        />
        <Input
          type="date"
          placeholder="Datum završetka"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Broj ponavljanja"
          type="number"
          min={1}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          maxW="160px"
        />
        <Input
          placeholder="Cijena"
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          maxW="160px"
        />
        <Button colorScheme="orange" onClick={savePlan} minW="160px">
          {editId ? "Sačuvaj izmjene" : "Dodaj plan"}
        </Button>
        {editId && (
          <Button colorScheme="gray" onClick={clearForm} minW="120px">
            Otkaži
          </Button>
        )}
      </Flex>

      <Box mt={6} mb={2} fontWeight="bold">
        Ukupno: {filteredPlans.reduce((sum, p) => sum + (Number(p.price) || 0), 0).toFixed(2)} KM
      </Box>

      <Box mt={6} mb={6}>
        <Heading size="md" mb={2}>
          Izvještaj planova PDF
        </Heading>
        <Flex gap={3} alignItems="center">
          <Input
            type="date"
            value={reportStartDate}
            onChange={(e) => setReportStartDate(e.target.value)}
            maxW="160px"
            placeholder="Datum od"
          />
          <Input
            type="date"
            value={reportEndDate}
            onChange={(e) => setReportEndDate(e.target.value)}
            maxW="160px"
            placeholder="Datum do"
          />
          <Button colorScheme="red" onClick={generatePDF} minW="160px">
            Generiši PDF
          </Button>
        </Flex>
      </Box>

      <Box mt={6} mb={6}>
        <Heading size="md" mb={2}>
          Brisanje planova po klijentu i periodu
        </Heading>
        <Flex gap={3} alignItems="center" wrap="wrap">
          <Select
            placeholder="Odaberi klijenta"
            value={deleteClientId}
            onChange={(e) => setDeleteClientId(e.target.value)}
            maxW="200px"
          >
            {safeClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={deleteStartDate}
            onChange={(e) => setDeleteStartDate(e.target.value)}
            maxW="160px"
            placeholder="Datum od"
          />
          <Input
            type="date"
            value={deleteEndDate}
            onChange={(e) => setDeleteEndDate(e.target.value)}
            maxW="160px"
            placeholder="Datum do"
          />
          <Button colorScheme="red" onClick={deletePlansByClientAndPeriod} minW="200px">
            Obriši planove
          </Button>
        </Flex>
      </Box>

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
            <Th>Usluga</Th>
            <Th>Klijent</Th>
            <Th>Izvođač</Th>
            <Th>Datum</Th>
            <Th>Iznos</Th>
            <Th>Akcije</Th>
          </Tr>
        </Thead>
        <Tbody>
          {filteredPlans.length === 0 ? (
            <Tr>
              <Td colSpan={6} textAlign="center">
                Nema unesenih planova.
              </Td>
            </Tr>
          ) : (
            filteredPlans.map((p) => (
              <Tr key={p.id}>
                <Td>{p.service}</Td>
                <Td>{safeClients.find((c) => c.id === p.clientId)?.name || "Nepoznato"}</Td>
                <Td>{safeExecutors.find((e) => e.id === p.executorId)?.name || "Nepoznato"}</Td>
                <Td>{p.date}</Td>
                <Td>{typeof p.price === "number" ? p.price.toFixed(2) : "-"}</Td>
                <Td>
                  <Button size="sm" colorScheme="yellow" mr={2} onClick={() => startEdit(p)}>
                    Uredi
                  </Button>
                  <Button size="sm" colorScheme="red" onClick={() => deletePlan(p.id)}>
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

export default PlanForm;
