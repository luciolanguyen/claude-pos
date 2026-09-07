import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  plugins: [react()],
  build: {
    outDir: path.resolve(dir, '../dist'),
    emptyOutDir: true,
    // Tách thư viện nặng ra file riêng để máy cũ trong tiệm tải nhanh hơn
    // và không phải tải lại toàn bộ khi cập nhật phần mềm.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: true,          // cho các máy khác trong tiệm truy cập khi chạy dev
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:5175', changeOrigin: true },
    },
  },
});
