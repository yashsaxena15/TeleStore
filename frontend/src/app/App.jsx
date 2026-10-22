import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import Index from "@/app/pages/Index";
import { DockProvider } from "@/components/layout/dock/DockContext";
import logger from "@/lib/logger";
// Import the new backend connection hook
import { useBackendConnection } from "@/hooks/useViteConnection";
// Import the error provider
import { ErrorProvider } from "@/contexts/ErrorHandlerContext";
import { MediaPlayerProvider } from "@/features/player/MediaPlayerContext";
import { initTheme } from "@/lib/theme";
// Sign-in and the 404 page are only needed when shown
const Login = lazy(() => import("@/features/auth/Login"));
const NotFound = lazy(() => import("@/app/pages/NotFound"));
const queryClient = new QueryClient();
// Debug component to log current route
const RouteDebugger = () => {
    const location = useLocation();
    logger.info("Current route", location.pathname);
    return null;
};
const AppRoutes = () => {
    logger.info("Rendering AppRoutes component");
    return (<>
      <RouteDebugger />
      <Routes>
        <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>}/>
        <Route path="/settings" element={<Index />}/>
        <Route path="/profile" element={<Index />}/>
        <Route path="/downloads" element={<Index />}/>
        <Route path="/transfers" element={<Index />}/>
        <Route path="/storage" element={<Index />}/>
        <Route path="/users" element={<Index />}/>
        <Route path="/" element={<Index />}/>
        {/* Handle dynamic paths for file explorer */}
        <Route path="/:path/*" element={<Index />}/>
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<Suspense fallback={null}><NotFound /></Suspense>}/>
      </Routes>
    </>);
};
const App = () => {
    logger.info("Initializing App component");
    // Use the backend connection hook to monitor connection status
    useBackendConnection();
    useEffect(() => {
        // Initialize theme preference (dark / light / system) with listener cleanup
        return initTheme();
    }, []);
    return (<QueryClientProvider client={queryClient}>
      <ErrorProvider>
        <DockProvider>
        <MediaPlayerProvider>
          <BrowserRouter>
            <div className="flex h-[100dvh] bg-background select-none overflow-hidden">
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <AppRoutes />
                <Toaster />
              </div>
            </div>
          </BrowserRouter>
        </MediaPlayerProvider>
        </DockProvider>
      </ErrorProvider>
    </QueryClientProvider>);
};
export default App;
