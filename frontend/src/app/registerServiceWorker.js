// Registers public/sw.js (the website kept for offline use). Built site only, not the desktop app.
import logger from '@/lib/logger';

export function registerServiceWorker() {
    if (!import.meta.env.PROD || typeof window === 'undefined' || window.__TAURI__ || !('serviceWorker' in navigator))
        return;
    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/sw.js');
            const registration = await navigator.serviceWorker.ready;
            // Load the Offline page's code now, so it is kept and opens without internet
            await import('@/features/offline/OfflinePage').catch(() => { });
            // Files this page loaded before the worker took over are kept too
            const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => new URL(u).pathname.startsWith('/assets/'));
            for (const script of document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]'))
                urls.push(script.src || script.href);
            registration.active?.postMessage({ type: 'keep-assets', urls });
        }
        catch (error) {
            logger.warn('Service worker not registered', error?.message);
        }
    });
}
