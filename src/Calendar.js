import React, { useState, useEffect } from "react";
import { Box, Text, Checkbox, Flex, Button, Spacer } from "@chakra-ui/react";
import dayjs from "dayjs";

const BACKEND_URL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  // Učitavanje planova sa provjerom i logiranjem
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/plans`)
      .then((res) => {
        if (!res.ok) throw new Error(`Plans API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Dobijeni plans:", data);
        if (Array.isArray(data)) {
          setPlans(data);
        } else if (data && Array.isArray(data.plans)) {
          setPlans(data.plans);
        } else {
          console.warn("Neočekivan format podataka za plans:", data);
          setPlans([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri dohvatu planova:", err);
        setPlans([]);
      });
  }, [currentMonth]);

  // Učitavanje klijenata sa provjerom i logiranjem
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/clients`)
      .then((res) => {
        if (!res.ok) throw new Error(`Clients API error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("Dobijeni clients:", data);
        if (Array.isArray(data)) {
          setClients(data);
        } else if (data && Array.isArray(data.clients)) {
          setClients(data.clients);
        } else {
          console.warn("Neočekivan format podataka za clients:", data);
          setClients([]);
        }
      })
      .catch((err) => {
        console.error("Greška pri dohvatu klijenata:", err);
        setClients([]);
      });
  }, []);

  // Sigurne liste za plans i clients
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeClients = Array.isArray(clients) ? clients : [];

  // Filter planova za trenutni mjesec
  const plansThisMonth = safePlans.filter((plan) =>
    dayjs(plan.date).isSame(currentMonth, "month")
  );

  const daysInMonth = currentMonth.daysInMonth();
  const firstDayOfMonth = currentMonth.startOf("month").day();

  const changeMonth = (direction) => {
    setCurrentMonth(currentMonth.add(direction, "month"));
  };

  const toggleCheck = (id) => {
    setCheckedItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
    // Ako želiš, ovdje možeš slati update na backend za status
  };

  const getClientName = (clientId) => {
    const client = safeClients.find((c) => c.id === clientId);
    return client ? client.name : "Nepoznat klijent";
  };

  return (
    <Box>
      <Flex mb={4} alignItems="center">
        <Button onClick={() => changeMonth(-1)}>Prethodni mjesec</Button>
        <Spacer />
        <Text fontWeight="bold" fontSize="xl">
          {currentMonth.format("MMMM YYYY")}
        </Text>
        <Spacer />
        <Button onClick={() => changeMonth(1)}>Sljedeći mjesec</Button>
      </Flex>

      <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" gap={3}>
        {[...Array(firstDayOfMonth)].map((_, i) => (
          <Box key={"empty" + i} h="60px" />
        ))}

        {[...Array(daysInMonth)].map((_, i) => {
          const day = i + 1;
          const dateStr = currentMonth.date(day).format("YYYY-MM-DD");

          const plansForDay = plansThisMonth.filter((plan) =>
            dayjs(plan.date).isSame(dateStr, "day")
          );

          return (
            <Box
              key={dateStr}
              p={2}
              border="1px solid #ccc"
              borderRadius="md"
              minHeight="60px"
            >
              <Text fontWeight="bold" mb={2}>
                {day}
              </Text>
              {plansForDay.length === 0 ? (
                <Text fontSize="sm" color="gray.500">
                  Nema planova
                </Text>
              ) : (
                plansForDay.map((plan) => (
                  <Flex key={plan.id} alignItems="center" mb={1}>
                    <Checkbox
                      isChecked={checkedItems[plan.id] || false}
                      onChange={() => toggleCheck(plan.id)}
                      mr={2}
                    />
                    <Text fontSize="sm">{getClientName(plan.clientId)}</Text>
                  </Flex>
                ))
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default Calendar;
