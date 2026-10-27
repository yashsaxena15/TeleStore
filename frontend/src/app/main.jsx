import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/styles/index.css';
import logger from '@/lib/logger';
import authService from '@/features/auth/authService';
import { registerServiceWorker } from './registerServiceWorker';
// Initialize logger
logger.info('Starting TeleStore frontend application');
// Check if we're running in Tauri
const isTauri = authService.isTauri();
logger.info('Running in Tauri environment', isTauri);
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
    <App />
  </React.StrictMode>);
// Keep the website for offline use (built site in a browser only)
registerServiceWorker();
