import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { consumeLaunchCapability, consumePairing } from "./api";
import "./styles/tokens.css";
import "./styles/app.css";

const ready = consumePairing().then(() => consumeLaunchCapability());
const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true } } });

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root was not found.");

void ready.then(() => createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
));
