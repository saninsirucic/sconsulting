import { extendTheme } from "@chakra-ui/react";
import { BACKEND_URL } from "./config";

const theme = extendTheme({
  fonts: {
    heading: "'Roboto', sans-serif",
    body: "'Roboto', sans-serif",
  },
});

export default theme;
