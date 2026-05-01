import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Makes the built app work on BOTH:
  // 1) https://username.github.io/repo-name/
  // 2) https://outreach.puregrid.es/
  base: './'
});
