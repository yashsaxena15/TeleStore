// Tauri-based logger that calls Rust commands directly
import { invoke } from '@tauri-apps/api/core';
// Check if we're running in Tauri
const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;
// Format message with timestamp
const formatMessage = (level, message) => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
};
export const tauriLogger = {
    debug: async (message) => {
        const formattedMessage = formatMessage('DEBUG', message);
        if (isTauri) {
            try {
                await invoke('log_debug', { message: formattedMessage });
            }
            catch (error) {
                console.debug(`[Fallback] ${formattedMessage}`);
            }
        }
        else {
            console.debug(`[Web] ${formattedMessage}`);
        }
    },
    info: async (message) => {
        const formattedMessage = formatMessage('INFO', message);
        if (isTauri) {
            try {
                await invoke('log_info', { message: formattedMessage });
            }
            catch (error) {
                console.info(`[Fallback] ${formattedMessage}`);
            }
        }
        else {
            console.info(`[Web] ${formattedMessage}`);
        }
    },
    warn: async (message) => {
        const formattedMessage = formatMessage('WARN', message);
        if (isTauri) {
            try {
                await invoke('log_warn', { message: formattedMessage });
            }
            catch (error) {
                console.warn(`[Fallback] ${formattedMessage}`);
            }
        }
        else {
            console.warn(`[Web] ${formattedMessage}`);
        }
    },
    error: async (message) => {
        const formattedMessage = formatMessage('ERROR', message);
        if (isTauri) {
            try {
                await invoke('log_error', { message: formattedMessage });
            }
            catch (error) {
                console.error(`[Fallback] ${formattedMessage}`);
            }
        }
        else {
            console.error(`[Web] ${formattedMessage}`);
        }
    }
};
export default tauriLogger;
