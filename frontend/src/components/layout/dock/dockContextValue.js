import { createContext } from "react";

// Shared by DockProvider (DockContext.jsx) and the hooks in useDock.js
export const DockContext = createContext(null);
