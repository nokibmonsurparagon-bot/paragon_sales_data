import { createTheme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

/** Light + dark (follows the OS preference). Restrained enterprise palette. */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1d4ed8' },
        secondary: { main: '#7c3aed' },
        background: { default: '#f5f7fb', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#7aa2ff' },
        secondary: { main: '#b79cff' },
        background: { default: '#0f1320', paper: '#171c2c' },
      },
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif',
    h4: { fontWeight: 650, fontSize: '1.6rem' },
    h5: { fontWeight: 650 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small', fullWidth: true } },
    MuiDataGrid: {
      defaultProps: { density: 'compact', disableRowSelectionOnClick: true },
      styleOverrides: { root: { border: 'none' } },
    },
  },
});
