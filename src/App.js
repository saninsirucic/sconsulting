import React, { useState, useEffect } from "react";
import {
  Box,
  Flex,
  Image,
  Button,
  Text,
  Spacer,
  SimpleGrid,
  Center,
  VStack,
  Icon,
  Input,
  Checkbox,
} from "@chakra-ui/react";
import {
  FaUsers,
  FaTools,
  FaClipboardList,
  FaFileInvoiceDollar,
  FaBookOpen,
  FaFileAlt,
  FaHome,
  FaCalendarAlt,
} from "react-icons/fa";
import dayjs from "dayjs";

import Clients from "./Clients";
import Executors from "./Executors";
import PlanForm from "./PlanForm";
import Invoice from "./Invoice";
import KUF from "./KUF";
import Sanitarne from "./Sanitarne";
import logo from "./logo.png";
import { BACKEND_URL } from "./config";

const menuItems = [
  { key: "home", label: "Početna", icon: FaHome },
  { key: "clients", label: "Klijenti", icon: FaUsers },
  { key: "executors", label: "Izvođači", icon: FaTools },
  { key: "plans", label: "Planovi", icon: FaClipboardList },
  { key: "invoices", label: "Fakture", icon: FaFileInvoiceDollar },
  { key: "kuf", label: "KUF", icon: FaFileAlt },
  { key: "sanitarne", label: "Sanitarne knjižice", icon: FaBookOpen },
  { key: "calendar", label: "Kalendar", icon: FaCalendarAlt },
];

const mainColor = "#f68b1f";
const greenColor = "#1dba5b";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    // Ako želiš login preko backenda, zamijeni ovaj dio s fetchom na BACKEND_URL/api/auth/login
    if (username === "admin" && password === "1234") {
      onLogin(username);
    } else {
      setError("Pogrešno korisničko ime ili lozinka.");
    }
  };

  return (
    <Box maxW="sm" mx="auto" mt="100px" p={8} bg="white" borderRadius="md" boxShadow="md">
      <VStack spacing={4}>
        <Text fontSize="2xl" fontWeight="bold">Prijava</Text>
        <Input
          placeholder="Korisničko ime"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          placeholder="Lozinka"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Text color="red.500">{error}</Text>}
        <Button colorScheme="orange" width="full" onClick={handleSubmit}>
          Prijavi se
        </Button>
      </VStack>
    </Box>
  );
}

function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [plans, setPlans] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/plans`)
      .then(res => res.json())
      .then(data => setPlans(data))
      .catch(err => {
        console.error(err);
      });
  }, [currentMonth]);

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
  };

  return (
    <Box>
      <Flex mb={4} alignItems="center">
        <Button onClick={() => changeMonth(-1)}>Prethodni mjesec</Button>
        <Spacer />
        <Text fontWeight="bold" fontSize="xl">{currentMonth.format("MMMM YYYY")}</Text>
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
                    <Text fontSize="sm">{plan.clientName} - {plan.service}</Text>
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

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("home");
  const [clients, setClients] = useState([]);

  useEffect(() => {
    if (user) {
      fetch(`${BACKEND_URL}/api/clients`)
        .then((res) => res.json())
        .then((data) => setClients(data))
        .catch((err) => console.error("Greška prilikom učitavanja klijenata:", err));
    }
  }, [user]);

  const handleLogout = () => {
    setUser(null);
    setPage("home");
  };

  if (!user) {
    return <Login onLogin={(username) => setUser(username)} />;
  }

  const HomePage = () => (
    <Box textAlign="center" py={6} maxW="900px" mx="auto">
      <SimpleGrid columns={[1, 2, 3]} spacing={6} px={4}>
        {menuItems
          .filter((item) => item.key !== "home")
          .map(({ key, label, icon }) => (
            <Box
              key={key}
              as="button"
              onClick={() => setPage(key)}
              bg="#fff"
              boxShadow="md"
              borderRadius="lg"
              p={6}
              _hover={{ boxShadow: "xl", bg: greenColor, color: "white" }}
              transition="all 0.3s ease"
              cursor="pointer"
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              height="120px"
              width="160px"
            >
              <Center
                bg={mainColor}
                color="white"
                borderRadius="full"
                boxSize="50px"
                mb={3}
                _hover={{ bg: "white", color: mainColor }}
                transition="all 0.3s ease"
              >
                <Icon as={icon} boxSize="28px" />
              </Center>
              <Text fontWeight="semibold" fontSize="md">{label}</Text>
            </Box>
          ))}
      </SimpleGrid>
    </Box>
  );

  return (
    <Box fontFamily="'Roboto', Arial, sans-serif" bg="#f5f7fa" minH="100vh">
      {/* TOP BAR */}
      <Flex
        align="center"
        bg={mainColor}
        color="#fff"
        h="70px"
        px="34px"
        boxShadow="0 2px 10px rgba(246,139,31,0.09)"
      >
        <Image
          src={logo}
          alt="S Consulting"
          h="52px"
          mr="22px"
          bg="#fff"
          borderRadius="13px"
          p="5px"
          cursor="pointer"
          onClick={() => setPage("home")}
        />
        <Text
          fontWeight="700"
          fontSize="20px"
          letterSpacing="1.5px"
          color="#fff"
          textShadow="0 1px 8px #f68b1f77"
          cursor="pointer"
          onClick={() => setPage("home")}
          whiteSpace="nowrap"
        >
          Dobrodošli u S Consulting • Interni sistem
        </Text>
        <Spacer />
        <Flex
          gap="12px"
          alignItems="center"
          flexWrap="nowrap"
          overflowX="auto"
          sx={{
            "&::-webkit-scrollbar": { display: "none" },
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {page !== "home" &&
            menuItems
              .filter((item) => item.key !== "home")
              .map((item) => (
                <Button
                  key={item.key}
                  onClick={() => setPage(item.key)}
                  bg={page === item.key ? greenColor : "rgba(255,255,255,0.09)"}
                  color="#fff"
                  fontWeight="bold"
                  fontSize={{ base: "12px", sm: "14px", md: "16px", lg: "18px" }}
                  borderRadius="9px"
                  px={{ base: "12px", sm: "16px", md: "20px", lg: "26px" }}
                  borderBottom={page === item.key ? "4px solid #fff" : "none"}
                  boxShadow={page === item.key ? "0 3px 16px #1dba5b22" : "none"}
                  whiteSpace="nowrap"
                  _hover={{ bg: greenColor }}
                >
                  {item.label}
                </Button>
              ))}
          <Button
            bg="#fff"
            color={mainColor}
            fontWeight="bold"
            fontSize={{ base: "12px", sm: "14px", md: "16px", lg: "16px" }}
            borderRadius="9px"
            ml="30px"
            px={{ base: "12px", sm: "16px", md: "20px", lg: "22px" }}
            onClick={handleLogout}
            borderBottom="3px solid #fff"
            boxShadow="0 2px 14px #fff4"
            _hover={{ bg: "#ffe5cc" }}
          >
            Odjavi se
          </Button>
        </Flex>
      </Flex>

      {/* SADRŽAJ */}
      <Box
        maxW="1100px"
        mx="auto"
        mt="40px"
        bg="#fff"
        borderRadius="20px"
        p="40px"
        boxShadow="0 2px 18px 0px #f68b1f19, 0 1.5px 2px #1dba5b13"
        minH="400px"
      >
        {page === "home" && <HomePage />}
        {page === "clients" && <Clients />}
        {page === "executors" && <Executors />}
        {page === "plans" && <PlanForm />}
        {page === "invoices" && <Invoice />}
        {page === "kuf" && <KUF clients={clients} />}
        {page === "sanitarne" && <Sanitarne />}
        {page === "calendar" && <Calendar />}
      </Box>
    </Box>
  );
}

export default App;
