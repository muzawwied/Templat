// DEMO BUILD CONFIG — membangun pratinjau statis console untuk /demo/ai-router/.
// Aliasing Clerk ke stub dan menyuntikkan demo-mock.js sebelum aplikasi berjalan.
// File ini TIDAK bagian dari source template; jangan di-commit ke repo.
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/demo/ai-router/',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-demo-mock',
      transformIndexHtml(html) {
        return html.replace(
          '<head>',
          '<head>\n    <script src="./demo-mock.js"></script>'
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
      '@clerk/react/internal': path.resolve(import.meta.dirname, 'demo-mocks/clerk-internal.ts'),
      '@clerk/react': path.resolve(import.meta.dirname, 'demo-mocks/clerk.tsx'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
});
