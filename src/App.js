import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
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
  FormControl,
  FormLabel,
  HStack,
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
  FaEnvelopeOpenText,
  FaBriefcase,
} from "react-icons/fa";
import dayjs from "dayjs";

import Clients from "./Clients";
import Executors from "./Executors";
import PlanForm from "./PlanForm";
import Invoice from "./Invoice";
import KUF from "./KUF";
import Sanitarne from "./Sanitarne";
import AiMailModule from "./AiMailModule";
import CommercialModule from "./CommercialModule";
import OutlookModule from "./OutlookModule";
import logo from "./logo.png";
import {
  apiFetch,
  apiRequest,
  AUTH_UNAUTHORIZED_EVENT,
  readStoredSession,
  writeStoredSession,
} from "./api";

const menuItems = [
  { key: "home", label: "Početna", icon: FaHome, roles: ["direktor"] },
  { key: "clients", label: "Klijenti", icon: FaUsers, roles: ["direktor"] },
  { key: "executors", label: "Izvođači", icon: FaTools, roles: ["direktor"] },
  { key: "plans", label: "Planovi", icon: FaClipboardList, roles: ["direktor"] },
  { key: "invoices", label: "Fakture", icon: FaFileInvoiceDollar, roles: ["direktor"] },
  { key: "kuf", label: "KUF", icon: FaFileAlt, roles: ["direktor"] },
  { key: "sanitarne", label: "Sanitarne knjižice", icon: FaBookOpen, roles: ["direktor"] },
  { key: "calendar", label: "Kalendar", icon: FaCalendarAlt, roles: ["direktor"] },
  { key: "ai-mailovi", label: "AI mailovi", icon: FaEnvelopeOpenText, roles: ["direktor"] },
  { key: "commercial", label: "Komercijala", icon: FaBriefcase, roles: ["direktor", "komercijala"] },
  { key: "outlook", label: "Outlook", icon: FaEnvelopeOpenText, roles: ["direktor", "komercijala"] },
];

const mainColor = "#f68b1f";
const greenColor = "#1dba5b";

function defaultPageForUser(user) {
  return user?.role === "komercijala" ? "commercial" : "home";
}

function allowedMenuForUser(user) {
  return menuItems.filter((item) => item.roles.includes(user?.role));
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest("/api/auth/login", {
        public: true,
        method: "POST",
        body: { username, password },
      });
      if (!result?.token) {
        throw new Error(result.error || "Pogrešno korisničko ime ili lozinka.");
      }
      onLogin({ user: result.user, token: result.token });
    } catch (requestError) {
      setError(requestError.message || "Prijava trenutno nije dostupna.");
    } finally {
      setLoading(false);
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
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        {error && <Text color="red.500">{error}</Text>}
        <Button colorScheme="orange" width="full" isLoading={loading} onClick={handleSubmit}>
          Prijavi se
        </Button>
      </VStack>
    </Box>
  );
}

function ChangePassword({ session, onChanged, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 10 || !/[A-Za-zČĆŽŠĐčćžšđ]/.test(newPassword) || !/\d/.test(newPassword)) {
      return setError("Nova lozinka mora imati najmanje 10 znakova te sadržavati slovo i broj.");
    }
    if (newPassword !== confirmation) return setError("Potvrda nove lozinke se ne podudara.");

    setLoading(true);
    try {
      const result = await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      onChanged({
        token: result?.token || session.token,
        user: {
          ...session.user,
          ...(result?.user || {}),
          mustChangePassword: false,
        },
      });
    } catch (requestError) {
      setError(requestError.message || "Lozinka nije promijenjena.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box minH="100vh" bg="#f5f7fa" py={{ base: 8, md: 20 }} px={4}>
      <Box as="form" onSubmit={submit} maxW="md" mx="auto" p={{ base: 6, md: 8 }} bg="white" borderRadius="2xl" boxShadow="lg">
        <Image src={logo} alt="S Consulting" h="64px" mx="auto" mb={5} />
        <Text fontSize="2xl" fontWeight="bold" textAlign="center">Postavite novu lozinku</Text>
        <Text color="gray.600" textAlign="center" mt={2} mb={6}>
          {session.user?.displayName || session.user?.display_name || session.user?.username}, zbog sigurnosti prvo promijenite privremenu lozinku.
        </Text>
        <VStack spacing={4} align="stretch">
          <FormControl isRequired>
            <FormLabel>Trenutna lozinka</FormLabel>
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </FormControl>
          <FormControl isRequired>
            <FormLabel>Nova lozinka</FormLabel>
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </FormControl>
          <FormControl isRequired>
            <FormLabel>Potvrdite novu lozinku</FormLabel>
            <Input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </FormControl>
          {error && <Alert status="error" borderRadius="lg"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="submit" bg={greenColor} color="white" _hover={{ bg: "green.600" }} isLoading={loading}>Sačuvaj novu lozinku</Button>
          <Button variant="ghost" color={mainColor} onClick={onLogout}>Odjavi se</Button>
        </VStack>
      </Box>
    </Box>
  );
}

function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [plans, setPlans] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  useEffect(() => {
    apiFetch("/api/plans")
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
  const [session, setSession] = useState(() => readStoredSession());
  const user = session?.user;
  const [page, setPage] = useState(() => defaultPageForUser(readStoredSession()?.user));
  const [clients, setClients] = useState([]);
  const allowedMenuItems = useMemo(() => allowedMenuForUser(user), [user]);

  useEffect(() => {
    if (user?.role === "direktor" && !user.mustChangePassword) {
      apiFetch("/api/clients")
        .then((res) => res.json())
        .then((data) => setClients(data))
        .catch((err) => console.error("Greška prilikom učitavanja klijenata:", err));
    } else {
      setClients([]);
    }
  }, [user]);

  const handleLogout = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
    setPage("home");
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleLogout);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleLogout);
  }, [handleLogout]);

  useEffect(() => {
    if (!user) return;
    const allowedKeys = new Set(allowedMenuItems.map((item) => item.key));
    if (!allowedKeys.has(page)) setPage(defaultPageForUser(user));
  }, [allowedMenuItems, page, user]);

  if (!user) {
    return <Login onLogin={(nextSession) => {
      writeStoredSession(nextSession);
      setSession(nextSession);
      setPage(defaultPageForUser(nextSession.user));
    }} />;
  }

  if (user.mustChangePassword) {
    return <ChangePassword session={session} onLogout={handleLogout} onChanged={(nextSession) => {
      writeStoredSession(nextSession);
      setSession(nextSession);
      setPage(defaultPageForUser(nextSession.user));
    }} />;
  }

  const HomePage = () => (
    <Box textAlign="center" py={6} maxW="900px" mx="auto">
      <SimpleGrid columns={[1, 2, 3]} spacing={6} px={4}>
        {allowedMenuItems
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
        align={{ base: "stretch", "2xl": "center" }}
        direction={{ base: "column", "2xl": "row" }}
        bg={mainColor}
        color="#fff"
        minH="70px"
        px={{ base: "12px", md: "34px" }}
        py={{ base: "12px", "2xl": 0 }}
        gap={{ base: "10px", "2xl": 0 }}
        boxShadow="0 2px 10px rgba(246,139,31,0.09)"
      >
        <Flex align="center" minW={0}>
          <Image
            src={logo}
            alt="S Consulting"
            h={{ base: "44px", md: "52px" }}
            mr={{ base: "12px", md: "22px" }}
            bg="#fff"
            borderRadius="13px"
            p="5px"
            cursor="pointer"
            flexShrink={0}
            onClick={() => setPage(defaultPageForUser(user))}
          />
          <Text
            fontWeight="700"
            fontSize={{ base: "16px", md: "20px" }}
            letterSpacing={{ base: "0.6px", md: "1.5px" }}
            color="#fff"
            textShadow="0 1px 8px #f68b1f77"
            cursor="pointer"
            onClick={() => setPage(defaultPageForUser(user))}
            whiteSpace={{ base: "normal", sm: "nowrap" }}
          >
            Dobrodošli u S Consulting • Interni sistem
          </Text>
        </Flex>
        <Spacer display={{ base: "none", "2xl": "block" }} />
        <Flex
          gap="12px"
          alignItems="center"
          flexWrap="nowrap"
          overflowX="auto"
          w={{ base: "100%", "2xl": "auto" }}
          pb={{ base: "2px", "2xl": 0 }}
          sx={{
            "&::-webkit-scrollbar": { display: "none" },
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {page !== "home" &&
            allowedMenuItems
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
                  flexShrink={0}
                  _hover={{ bg: greenColor }}
                >
                  {item.label}
                </Button>
              ))}
          <HStack flexShrink={0} spacing={2} px={{ base: 1, md: 2 }}>
            <Box textAlign="right" display={{ base: "none", md: "block" }}>
              <Text fontWeight="bold" fontSize="sm" lineHeight="short">
                {user.displayName || user.display_name || user.username}
              </Text>
              <Badge colorScheme={user.role === "direktor" ? "purple" : "green"} fontSize="10px">
                {user.role}
              </Badge>
            </Box>
          </HStack>
          <Button
            bg="#fff"
            color={mainColor}
            fontWeight="bold"
            fontSize={{ base: "12px", sm: "14px", md: "16px", lg: "16px" }}
            borderRadius="9px"
            ml={{ base: 0, "2xl": "30px" }}
            px={{ base: "12px", sm: "16px", md: "20px", lg: "22px" }}
            flexShrink={0}
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
        maxW={["ai-mailovi", "commercial", "outlook"].includes(page) ? "1600px" : "1100px"}
        mx="auto"
        mt={{ base: "18px", md: "40px" }}
        bg="#fff"
        borderRadius="20px"
        p={{ base: "16px", md: "40px" }}
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
        {page === "ai-mailovi" && <AiMailModule token={session.token} user={session.user} />}
        {page === "commercial" && <CommercialModule user={session.user} />}
        {page === "outlook" && <OutlookModule user={session.user} />}
      </Box>
    </Box>
  );
}

export default App;
