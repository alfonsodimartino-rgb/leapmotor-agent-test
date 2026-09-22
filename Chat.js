/**
 * chat.js — Client Headless per Salesforce Embedded Messaging / Agentforce
 *
 * Flusso:
 *  1. createSession()   → POST /embeddedservice/v1/session
 *  2. connectSSE()      → GET  /embeddedservice/v1/session/:id/messages (Server-Sent Events)
 *  3. sendMessage()     → POST /embeddedservice/v1/session/:id/messages
 *  4. endSession()      → DELETE /embeddedservice/v1/session/:id
 */

(() => {
  "use strict";

  // ─── Config ────────────────────────────────────────────────────────────────
  const CFG = window.SF_CONFIG;
  if (!CFG) throw new Error("SF_CONFIG non trovato. Controlla config.js");

  const API = `${CFG.API_BASE_URL}/embeddedservice/v1`;

  // ─── Stato ─────────────────────────────────────────────────────────────────
  let sessionId      = null;
  let accessToken    = null;
  let eventSource    = null;
  let reconnectTimer = null;
  let isConnected    = false;

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const dom = {
    messages:        document.getElementById("chatMessages"),
    input:           document.getElementById("userInput"),
    btnSend:         document.getElementById("btnSend"),
    btnReset:        document.getElementById("btnReset"),
    statusDot:       document.getElementById("statusDot"),
    statusLabel:     document.getElementById("statusLabel"),
    typingIndicator: document.getElementById("typingIndicator"),
  };

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function timestamp() {
    return new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }

  function setStatus(state, label) {
    dom.statusDot.className   = `status-dot ${state}`;
    dom.statusLabel.textContent = label;
  }

  function setInputEnabled(enabled) {
    dom.input.disabled   = !enabled;
    dom.btnSend.disabled = !enabled;
    if (enabled) dom.input.focus();
  }

  function showTyping(visible) {
    dom.typingIndicator.classList.toggle("visible", visible);
  }

  function scrollToBottom() {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  /**
   * Aggiunge un messaggio nella chat.
   * @param {"agent"|"user"|"system"|"error"} role
   * @param {string} text
   */
  function appendMessage(role, text) {
    const wrapper = document.createElement("div");
    wrapper.className = `msg ${role}`;

    if (role === "user" || role === "agent") {
      const sender      = document.createElement("p");
      sender.className  = "msg-sender";
      sender.textContent = role === "user" ? "Tu" : CFG.AGENT_DISPLAY_NAME;

      const bubble      = document.createElement("div");
      bubble.className  = "msg-bubble";
      bubble.textContent = text;

      const time        = document.createElement("p");
      time.className    = "msg-time";
      time.textContent  = timestamp();

      wrapper.append(sender, bubble, time);
    } else {
      // system / error
      const bubble      = document.createElement("div");
      bubble.className  = "msg-bubble";
      bubble.textContent = text;
      wrapper.append(bubble);
    }

    dom.messages.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
  }

  // ─── Fetch helper con timeout ───────────────────────────────────────────────

  async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.REQUEST_TIMEOUT_MS);

    const headers = {
      "Content-Type": "application/json",
      ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
      ...options.headers,
    };

    try {
      const res = await fetch(`${API}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ─── 1. Crea sessione ───────────────────────────────────────────────────────

  async function createSession() {
    setStatus("", "Connessione in corso…");
    setInputEnabled(false);

    try {
      const body = {
        orgId:          CFG.ORG_ID,
        esDeveloperName: CFG.DEPLOYMENT_NAME,
        capabilitiesVersion: "1",
        platform:       "Web",
        context: {
          appName:    CFG.DEPLOYMENT_NAME,
          clientType: "web",
        },
      };

      const data = await apiFetch("/session", {
        method: "POST",
        body: JSON.stringify(body),
      });

      sessionId   = data.sessionId;
      accessToken = data.accessToken;

      connectSSE();

    } catch (err) {
      console.error("[SF Chat] createSession error:", err);
      setStatus("error", "Errore di connessione");
      appendMessage("error", "Impossibile avviare la sessione. Riprova tra qualche istante.");
      scheduleReconnect();
    }
  }

  // ─── 2. Server-Sent Events ─────────────────────────────────────────────────

  function connectSSE() {
    if (eventSource) {
      eventSource.close();
    }

    const url = `${API}/session/${sessionId}/messages/stream?Authorization=Bearer%20${encodeURIComponent(accessToken)}`;

    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      isConnected = true;
      setStatus("connected", "Connesso");
      setInputEnabled(true);
      appendMessage("system", "Sessione avviata. Come posso aiutarti?");
    };

    eventSource.onmessage = (event) => {
      handleIncomingEvent(event.data);
    };

    // Alcuni deployment usano eventi tipizzati
    eventSource.addEventListener("message", (event) => {
      handleIncomingEvent(event.data);
    });

    eventSource.addEventListener("agent_message", (event) => {
      handleIncomingEvent(event.data);
    });

    eventSource.onerror = (err) => {
      console.error("[SF Chat] SSE error:", err);
      isConnected = false;
      setStatus("error", "Connessione interrotta");
      showTyping(false);
      eventSource.close();
      scheduleReconnect();
    };
  }

  // ─── Gestione messaggi in arrivo ────────────────────────────────────────────

  function handleIncomingEvent(rawData) {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      return; // ping / heartbeat non JSON
    }

    showTyping(false);

    // Struttura standard risposta Agentforce / Messaging
    const type = data.type || data.messageType || "";

    if (type === "Message" || type === "agent_message" || data.text || data.content) {
      const text =
        data.text ||
        data.content ||
        data?.payload?.text ||
        data?.message?.text ||
        "";

      if (text.trim()) {
        appendMessage("agent", text.trim());
      }

    } else if (type === "TypingStartedIndicator" || type === "typing_start") {
      showTyping(true);

    } else if (type === "TypingStoppedIndicator" || type === "typing_stop") {
      showTyping(false);

    } else if (type === "SessionEnded" || type === "session_ended") {
      appendMessage("system", "La sessione è terminata.");
      setStatus("", "Disconnesso");
      setInputEnabled(false);
    }
  }

  // ─── 3. Invia messaggio ─────────────────────────────────────────────────────

  async function sendMessage() {
    const text = dom.input.value.trim();
    if (!text || !isConnected) return;

    dom.input.value = "";
    autoResize();
    appendMessage("user", text);
    showTyping(true);

    try {
      await apiFetch(`/session/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message: { text },
          messageType: "Message",
        }),
      });
    } catch (err) {
      console.error("[SF Chat] sendMessage error:", err);
      showTyping(false);
      appendMessage("error", "Messaggio non recapitato. Verifica la connessione.");
    }
  }

  // ─── 4. Termina sessione ────────────────────────────────────────────────────

  async function endSession() {
    if (!sessionId) return;

    try {
      await apiFetch(`/session/${sessionId}`, { method: "DELETE" });
    } catch {
      // ignore — la sessione scade lato server
    }

    sessionId   = null;
    accessToken = null;
    isConnected = false;

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  // ─── Reset conversazione ────────────────────────────────────────────────────

  async function resetConversation() {
    clearTimeout(reconnectTimer);
    await endSession();
    dom.messages.innerHTML = "";
    showTyping(false);
    setInputEnabled(false);
    setStatus("", "Connessione in corso…");
    await createSession();
  }

  // ─── Reconnect automatico ───────────────────────────────────────────────────

  function scheduleReconnect() {
    if (!CFG.RECONNECT_INTERVAL_MS) return;

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      appendMessage("system", "Tentativo di riconnessione…");
      if (sessionId) {
        connectSSE();
      } else {
        await createSession();
      }
    }, CFG.RECONNECT_INTERVAL_MS);
  }

  // ─── Auto-resize textarea ───────────────────────────────────────────────────

  function autoResize() {
    const el = dom.input;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  // ─── Event listeners ────────────────────────────────────────────────────────

  dom.input.addEventListener("input", autoResize);

  dom.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  dom.btnSend.addEventListener("click", sendMessage);

  dom.btnReset.addEventListener("click", () => {
    if (confirm("Vuoi avviare una nuova conversazione?")) {
      resetConversation();
    }
  });

  // Chiudi sessione prima di lasciare la pagina
  window.addEventListener("beforeunload", endSession);

  // ─── Init ───────────────────────────────────────────────────────────────────

  createSession();

})();
