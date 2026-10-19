import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Index from "./pages/Index";
import { NavigationSidebar } from "@/components/NavigationSidebar";
import { TransfersWidget } from "@/components/TransfersWidget";
import logger from "@/lib/logger";
// Import the new backend connection hook
import { useBackendConnection } from "@/hooks/useViteConnection";
import authService from "@/lib/authService";
// Import the error provider
import { ErrorProvider } from "@/contexts/ErrorHandlerContext";
import { MediaPlayerProvider } from "@/contexts/MediaPlayerContext";
import { initTheme } from "@/lib/theme";
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
        <Route path="/login" element={<Login />}/>
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
        <Route path="*" element={<NotFound />}/>
      </Routes>
    </>);
};
const App = () => {
    logger.info("Initializing App component");
    // Use the backend connection hook to monitor connection status
    useBackendConnection();
    // Check authentication status
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const isAuthenticated = await authService.isAuthenticated();
                logger.info("Authentication status:", isAuthenticated);
            }
            catch (error) {
                logger.error("Failed to check authentication status:", error);
            }
        };
        checkAuth();
    }, []);
    useEffect(() => {
        // Initialize theme preference (dark / light / system) with listener cleanup
        return initTheme();
    }, []);
    return (<QueryClientProvider client={queryClient}>
      <ErrorProvider>
        <MediaPlayerProvider>
          <BrowserRouter>
            <div className="flex h-screen bg-background select-none overflow-hidden">
              <NavigationSidebar />
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <AppRoutes />
                <Toaster />
                <TransfersWidget />
              </div>
            </div>
          </BrowserRouter>
        </MediaPlayerProvider>
      </ErrorProvider>
    </QueryClientProvider>);
};
export default App;
