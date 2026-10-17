import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import {
  VAutocomplete,
  VApp,
  VBtn,
  VCard,
  VChip,
  VDialog,
  VIcon,
  VSkeletonLoader,
  VAlert,
  VTextField,
  VTextarea,
  VSelect,
  VListItem,
  VPagination,
  VCheckbox,
  VTabs,
  VTab,
} from 'vuetify/components';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';
import { zhHant } from 'vuetify/locale';
import 'vuetify/styles';
import './styles.css';
import App from './App.vue';
import { VUETIFY_THEMES, applyDocumentTheme, readTheme } from './theme.js';

const initialTheme = readTheme();
applyDocumentTheme(initialTheme);

const vuetify = createVuetify({
  components: {
    VAutocomplete,
    VApp,
    VBtn,
    VCard,
    VChip,
    VDialog,
    VIcon,
    VSkeletonLoader,
    VAlert,
    VTextField,
    VTextarea,
    VSelect,
    VListItem,
    VPagination,
    VCheckbox,
    VTabs,
    VTab,
  },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  locale: { locale: 'zhHant', messages: { zhHant } },
  theme: {
    defaultTheme: VUETIFY_THEMES[initialTheme],
    themes: {
      guild: {
        dark: false,
        colors: {
          background: '#f7f9fc',
          surface: '#ffffff',
          primary: '#1d4ed8',
          'on-background': '#0f172a',
          'on-surface': '#0f172a',
        },
      },
      guildDark: {
        dark: true,
        colors: {
          background: '#151e2e',
          surface: '#1c2639',
          // Light blue reads on dark surfaces both as text and as a filled button.
          primary: '#60a5fa',
          'on-primary': '#0f172a',
          error: '#f87171',
          success: '#34d399',
          warning: '#fbbf24',
          info: '#60a5fa',
          'on-background': '#e2e8f0',
          'on-surface': '#e2e8f0',
        },
      },
    },
  },
  defaults: {
    VBtn: { rounded: 'lg', elevation: 0, height: 44 },
    VCard: { rounded: 'xl', elevation: 0 },
    VChip: { variant: 'tonal', size: 'small' },
  },
});

createApp(App).use(vuetify).mount('#app');
