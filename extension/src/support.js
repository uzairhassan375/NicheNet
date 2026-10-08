// support: the chat button at the bottom right of the finder page, before and after
// sign-in. Messages are saved in Supabase (support_send, support_list_messages,
// support_unread) and the admin answers them from the Queries page.
// Someone who is not signed in gives a name and email once; a random key kept in
// chrome.storage.local then identifies this device's conversation.

const GUEST = "supportGuest";
const WELCOME = "Hi! How can we help? Send us a message and we will reply here.";

function newGuestKey() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function dayLabel(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round((new Date(now.toDateString()) - new Date(date.toDateString())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function timeLabel(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function createSupportChat({ doc = document, rpc, storage, getAccount, pollOpenMs = 5000, pollClosedMs = 30000 }) {
  const byId = (id) => doc.getElementById(id);
  const fab = byId("chat-fab");
  const badge = byId("chat-badge");
  const panel = byId("chat-panel");
  const subtitle = byId("chat-sub");
  const intro = byId("chat-intro");
  const nameInput = byId("chat-name");
  const emailInput = byId("chat-email");
  const list = byId("chat-messages");
  const form = byId("chat-form");
  const input = byId("chat-input");
  const sendBtn = byId("chat-send");
  const errorEl = byId("chat-error");

  let guest = null;
  let messages = [];
  let lastId = 0;
  let open = false;
  let loading = false;
  let timer = 0;

  const token = () => getAccount()?.token || "";
  const canChat = () => Boolean(token() || guest?.key);
  const identity = () => ({ p_token: token(), p_guest_key: guest?.key || null });

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function setBadge(count) {
    badge.hidden = !(count > 0);
    badge.textContent = count > 9 ? "9+" : String(count);
    fab.setAttribute("aria-label", count > 0 ? `Chat with support, ${count} new` : "Chat with support");
  }

  function bubble(message, extra = "") {
    const item = doc.createElement("div");
    item.className = `chat-msg ${message.sender === "admin" ? "from-support" : "from-me"}${extra}`;
    const text = doc.createElement("p");
    text.textContent = message.body;
    item.append(text);
    if (message.created_at) {
      const time = doc.createElement("time");
      time.dateTime = message.created_at;
      time.textContent = message.pending ? "Sending…" : timeLabel(message.created_at);
      item.append(time);
    }
    return item;
  }

  function render() {
    list.replaceChildren(bubble({ sender: "admin", body: WELCOME }, " welcome"));
    let day = "";
    for (const message of messages) {
      const label = dayLabel(message.created_at);
      if (label && label !== day) {
        day = label;
        const divider = doc.createElement("p");
        divider.className = "chat-day";
        divider.textContent = label;
        list.append(divider);
      }
      list.append(bubble(message, message.pending ? " pending" : ""));
    }
    list.scrollTop = list.scrollHeight;
  }

  // Signed in or known guest: show the conversation. Otherwise ask for a name and email.
  function updateMode() {
    const ready = canChat();
    intro.hidden = ready;
    form.hidden = !ready;
    const account = getAccount();
    subtitle.textContent = account?.token
      ? `Signed in as ${account.name || account.email}`
      : guest?.key
        ? `Chatting as ${guest.name}`
        : "We usually reply within a day.";
  }

  function merge(incoming) {
    const known = new Set(messages.map((message) => message.id));
    messages = messages.concat(incoming.filter((message) => !known.has(message.id)));
    messages.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || Number(a.id) - Number(b.id));
    lastId = messages.reduce((max, message) => (message.pending ? max : Math.max(max, Number(message.id) || 0)), lastId);
  }

  async function fetchMessages() {
    if (!canChat() || loading) return;
    loading = true;
    try {
      const result = await rpc("support_list_messages", { ...identity(), p_after: lastId });
      if (!result.ok) {
        showError(result.error || "Could not load messages.");
        return;
      }
      const incoming = Array.isArray(result.messages) ? result.messages : [];
      if (incoming.length) {
        merge(incoming);
        render();
      }
      setBadge(0);
    } finally {
      loading = false;
    }
  }

  async function checkUnread() {
    if (!canChat() || open || doc.hidden) return;
    const result = await rpc("support_unread", identity());
    if (result.ok) setBadge(Number(result.unread) || 0);
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => (open ? fetchMessages() : checkUnread()), open ? pollOpenMs : pollClosedMs);
  }

  async function send(text) {
    const body = text.trim();
    if (!body) return;
    showError("");
    const pending = { id: `pending-${Date.now()}`, sender: "user", body, created_at: new Date().toISOString(), pending: true };
    messages.push(pending);
    render();
    input.value = "";
    autoGrow();
    sendBtn.disabled = true;
    const result = await rpc("support_send", {
      ...identity(),
      p_name: guest?.name || null,
      p_email: guest?.email || null,
      p_body: body,
    });
    sendBtn.disabled = false;
    messages = messages.filter((message) => message !== pending);
    if (!result.ok) {
      render();
      input.value = body;
      autoGrow();
      showError(result.error || "Could not send. Try again.");
      return;
    }
    merge([result.message]);
    render();
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  async function openPanel() {
    open = true;
    panel.hidden = false;
    fab.classList.add("open");
    fab.setAttribute("aria-expanded", "true");
    updateMode();
    render();
    schedule();
    if (canChat()) {
      input.focus();
      await fetchMessages();
    } else {
      nameInput.focus();
    }
  }

  function closePanel() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    fab.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    schedule();
    fab.focus();
  }

  fab.addEventListener("click", () => (open ? closePanel() : openPanel()));
  byId("chat-close").addEventListener("click", closePanel);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  intro.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name || !email.includes("@")) {
      showError("Enter your name and email.");
      return;
    }
    showError("");
    guest = { key: newGuestKey(), name, email };
    try {
      await storage.set({ [GUEST]: guest });
    } catch {
      // Still works for this visit; the chat just starts again next time.
    }
    updateMode();
    render();
    input.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener("input", autoGrow);

  return {
    async start() {
      try {
        const items = await storage.get(GUEST);
        guest = items?.[GUEST]?.key ? items[GUEST] : null;
      } catch {
        guest = null;
      }
      updateMode();
      schedule();
      await checkUnread();
    },
    // Sign-in or sign-out: start over with the right conversation.
    async refresh() {
      messages = [];
      lastId = 0;
      updateMode();
      render();
      if (open) await fetchMessages();
      else await checkUnread();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
