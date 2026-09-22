/**
 * config.js — Configurazione Salesforce Embedded Messaging (Headless)
 *
 * Compila questi valori con i dati del tuo deployment Salesforce.
 * Puoi trovarli in: Setup → Embedded Service Deployments → [il tuo deployment] → View
 */

window.SF_CONFIG = {

  // Base URL dell'API Embedded Messaging (es. https://yourorg.my.salesforce-scrt.com)
  API_BASE_URL: "https://YOUR_ORG.my.salesforce-scrt.com",

  // Organization ID (18 caratteri)
  ORG_ID: "YOUR_ORG_ID",

  // Deployment Developer Name (dal setup del canale Embedded Service)
  DEPLOYMENT_NAME: "YOUR_DEPLOYMENT_NAME",

  // Label visualizzata nell'header dell'agente
  AGENT_DISPLAY_NAME: "Assistente Virtuale",

  // Lingua default (opzionale, usata nei pre-chat fields)
  DEFAULT_LANGUAGE: "it",

  // Intervallo di reconnect automatico in ms (0 = disabilitato)
  RECONNECT_INTERVAL_MS: 5000,

  // Timeout request in ms
  REQUEST_TIMEOUT_MS: 15000,

};
