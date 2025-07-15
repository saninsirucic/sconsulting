import React, { useState, useEffect } from "react";
import { Box, Text, Checkbox, Flex, Button, Spacer } from "@chakra-ui/react";
import dayjs from "dayjs";

function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]); // lista klijenata
  const [checkedItems, setCheckedItems] = useState({});

  // Učitavanje planova
  useEffect(() => {
    fetch("http://localhost:3001/api/plans")
      .then(res => res.json())
      .then(data => setPlans(data))
      .catch(err => console.error(err));
  }, [currentMonth]);

  // Učitavanje klijenata
  useEffect(() => {
    fetch("http://localhost:3001/api/clients")
      .then(res => res.json())
      .then(data => setClients(data))
      .catch(err => console.error(err));
  }, []);

  // Filter planova za trenutni mjesec
  const plansThisMonth = plans.filter(plan =>
    dayjs(plan.date).isSame(currentMonth, "month")
  );

  const daysInMonth = currentMonth.daysInMonth();
  const firstDayOfMonth = currentMonth.startOf("month").day();

  const changeMonth = (direction) => {
    setCurrentMonth(currentMonth.add(direction, "month"));
  };

  const toggleCheck = (id) => {
    setCheckedItems(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
    // Ovdje možeš poslati update na backend da sačuvaš status
  };

  // Funkcija za dohvat imena klijenta po clientId
  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
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
          const plansForDay = plansThisMonth.filter(plan => plan.date === dateStr);

          return (
            <Box
              key={dateStr}
              p={2}
              border="1px solid #ccc"
              borderRadius="md"
              minHeight="60px"
            >
              <Text fontWeight="bold" mb={2}>{day}</Text>
              {plansForDay.length === 0 ? (
                <Text fontSize="sm" color="gray.500">Nema planova</Text>
              ) : (
                plansForDay.map(plan => (
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
