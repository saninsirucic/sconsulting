import { extendTheme } from "@chakra-ui/react";

const theme = extendTheme({
  fonts: {
    heading: "'Roboto', sans-serif",
    body: "'Roboto', sans-serif",
  },
  styles: {
    global: {
      'html, body, #root': {
        minHeight: '100%',
        width: '100%',
        maxWidth: '100%',
        overflowX: 'hidden',
      },
      html: {
        WebkitTextSizeAdjust: '100%',
      },
      body: {
        background: '#f5f7fa',
      },
      '@media (max-width: 767px)': {
        'input, textarea, select': {
          fontSize: '16px !important',
        },
        button: {
          touchAction: 'manipulation',
        },
      },
    },
  },
});

export default theme;
