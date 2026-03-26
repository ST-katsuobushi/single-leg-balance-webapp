import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/single-leg-balance-webapp/',
  plugins: [react()],
});
