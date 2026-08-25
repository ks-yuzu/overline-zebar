import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../main/public',
  plugins: [
    react(),
    {
      name: 'postbuild',
      closeBundle() {
        if (process.env.CI) {
          console.log('Skipping zebar.exe task because this is a CI build');
          return;
        }

        const exePath = process.env.ZEBAR_EXE_PATH || 'zebar.exe';

        try {
          execSync(`taskkill /IM ${exePath} /F`, { stdio: 'inherit' });
        } catch (error) {
          console.log(error instanceof Error ? error.message : error);
        }

        execSync(`start ${exePath}`, { stdio: 'inherit' });
      },
    },
  ],
  base: './',
});
