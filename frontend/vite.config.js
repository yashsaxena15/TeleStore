import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // CRITICAL FIX: Change from "/" to "./" for Tauri
  // This ensures all asset paths are relative
  base: process.env.TAURI_PLATFORM ? "./" : "/",
  
  // Clear screen for Tauri
  clearScreen: false,
  
  server: {
    host: "::",
    port: 8080,
    // Watch configuration for Tauri
    watch: {
      ignored: ['**/src-tauri/**']
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/files': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/folders': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/system': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/user': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/dl': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
      '/watch': {
        target: 'http://localhost:8148',
        changeOrigin: true,
        secure: false,
      },
    },
    middlewareMode: false,
  },
  
  plugins: [
    react(), 
    mode === "development" && componentTagger()
  ].filter(Boolean),
  
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  
  // Production builds drop routine console output (it also exposed URLs and request details)
  esbuild: mode === "production" && !process.env.TAURI_DEBUG ? { pure: ["console.log", "console.debug", "console.info"] } : undefined,

  // Environment variable prefix for Tauri
  envPrefix: ['VITE_', 'TAURI_'],
  
  // Build configuration for Tauri
  build: {
    // Tauri uses Chromium on Windows
    target: ['es2021', 'chrome100', 'safari13'],
    
    // Don't minify in debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    
    // Generate sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    
    // Output directory
    outDir: 'dist',
    
    // Ensure assets are properly included
    assetsDir: 'assets',
    
    // Clear output directory before build
    emptyOutDir: true,
    
    rollupOptions: {
      output: {
        // React rarely changes, so keep it in its own long-cached chunk
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  
  // Unit tests only; the Playwright browser tests in e2e/ run separately
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },

  // Configure for Tauri preview
  preview: {
    port: 8080,
    strictPort: false,
    middlewareMode: false,
  },
}));