import { BrowserRouter, HashRouter } from 'react-router-dom';
import logger from '@/lib/logger';
// Detect if running in Tauri
export const isTauri = () => {
    const result = typeof window !== 'undefined' && '__TAURI__' in window;
    logger.info("Tauri detection", { isTauri: result });
    return result;
};
export const AdaptiveRouter = ({ children }) => {
    const isTauriEnv = isTauri();
    logger.info("Using router", { router: isTauriEnv ? "HashRouter" : "BrowserRouter" });
    const Router = isTauriEnv ? HashRouter : BrowserRouter;
    return <Router>{children}</Router>;
};
