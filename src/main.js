import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import {
  VApp,
  VBtn,
  VCard,
  VChip,
  VDialog,
  VIcon,
  VSkeletonLoader,
  VAlert,
  VTextField,
  VSelect,
  VListItem,
  VPagination,
} from 'vuetify/components';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';
import { zhHant } from 'vuetify/locale';
import 'vuetify/styles';
import './styles.css';
import App from './App.vue';

const vuetify = createVuetify({
  components: {
    VApp,
    VBtn,
    VCard,
    VChip,
    VDialog,
    VIcon,
    VSkeletonLoader,
    VAlert,
    VTextField,
    VSelect,
    VListItem,
    VPagination,
  },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  locale: { locale: 'zhHant', messages: { zhHant } },
  theme: {
    defaultTheme: 'guild',
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
    },
  },
  defaults: {
    VBtn: { rounded: 'lg', elevation: 0, height: 44 },
    VCard: { rounded: 'xl', elevation: 0 },
    VChip: { variant: 'tonal', size: 'small' },
  },
});

createApp(App).use(vuetify).mount('#app');
