import { useEffect, useMemo, useRef, useState } from "react";
import { isConfigured, rpc } from "./api.js";

const TOKEN_KEY = "nichenet-admin-token";

const NAV = [
  { id: "users", label: "Users", icon: "users" },
  { id: "queries", label: "Queries", icon: "chat" },
  { id: "create", label: "Create user", icon: "userPlus" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "settings", label: "Settings", icon: "lock" },
];

const PAGES = {
  users: {
    title: "Users",
    lede: "Each person has a daily product-search limit. Counts reset at midnight UTC.",
  },
  queries: {
    title: "Queries",
    lede: "Messages sent from the chat button in the extension. Your replies show up in that person's chat.",
  },
  create: {
    title: "Create user",
    lede: "This account can sign in to the extension. The search count resets at midnight UTC.",
  },
  activity: {
    title: "Activity",
    lede: "Every sign-in, search, and extension log, for one person or all of them together.",
  },
  settings: {
    title: "Settings",
    lede: "Change the password used to sign in to this admin site.",
  },
};

function blankDraft() {
  return { email: "", name: "", password: "", active: true, searches_per_day: "5" };
}

function quota(user) {
  const limit = Number(user.searches_per_day) || 0;
  const used = Number(user.used_today) || 0;
  const remaining = Math.max(limit - used, 0);
  const percent = limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return { limit, used, remaining, percent };
}

function userStatus(user) {
  const { limit, used } = quota(user);
  if (!user.active) return { tone: "muted", label: "Paused" };
  if (used >= limit) return { tone: "bad", label: "Limit reached" };
  return { tone: "good", label: "Active" };
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState("users");
  const [draft, setDraft] = useState(blankDraft);
  const [nextPassword, setNextPassword] = useState("");
  const [logs, setLogs] = useState([]);
  const [logQuery, setLogQuery] = useState("");
  const [logUser, setLogUser] = useState("");
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [reply, setReply] = useState("");
  const lastMessageId = useRef(0);

  async function loadUsers(current = token) {
    const result = await rpc("admin_list_users", { p_token: current });
    if (!result.ok) {
      if (result.code === "unauthorized") signOut();
      setError(result.error || "Could not load users.");
      return [];
    }
    const next = result.users || [];
    setUsers(next);
    return next;
  }

  useEffect(() => {
    if (token) loadUsers(token);
  }, [token]);

  useEffect(() => {
    if (token && tab === "activity") loadLogs(token, logQuery, logUser);
  }, [token, tab, logUser]);

  // Queries: the list refreshes in the background so the sidebar shows new messages.
  useEffect(() => {
    if (!token) return undefined;
    loadThreads(token, tab === "queries");
    const timer = setInterval(() => loadThreads(token, false), tab === "queries" ? 8000 : 30000);
    return () => clearInterval(timer);
  }, [token, tab]);

  useEffect(() => {
    lastMessageId.current = threadMessages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
  }, [threadMessages]);

  useEffect(() => {
    if (!token || tab !== "queries" || !activeThread) return undefined;
    const timer = setInterval(() => loadThreadMessages(activeThread, lastMessageId.current), 5000);
    return () => clearInterval(timer);
  }, [token, tab, activeThread]);

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUsers([]);
  }

  function goTo(next) {
    setTab(next);
    setError("");
    setNotice("");
  }

  function openLogs(user) {
    setLogUser(user?.id || "");
    setLogQuery("");
    goTo("activity");
  }

  async function loadLogs(current = token, query = logQuery, userId = logUser) {
    const result = await rpc("admin_list_activity", {
      p_token: current,
      p_query: query,
      p_user_id: userId || null,
    });
    if (!result.ok) {
      if (result.code === "unauthorized") signOut();
      setError(result.error || "Could not load activity.");
      return;
    }
    setLogs(result.logs || []);
  }

  async function loadThreads(current = token, showErrors = true) {
    const result = await rpc("admin_list_threads", { p_token: current });
    if (!result.ok) {
      if (result.code === "unauthorized") signOut();
      if (showErrors) setError(result.error || "Could not load queries. Run the support chat SQL in Supabase first.");
      return;
    }
    setThreads(result.threads || []);
  }

  async function loadThreadMessages(threadId, after = 0) {
    const result = await rpc("admin_thread_messages", { p_token: token, p_thread_id: threadId, p_after: after });
    if (!result.ok) {
      if (result.code === "unauthorized") signOut();
      if (result.code === "not_found") setActiveThread(null);
      setError(result.error || "Could not load that conversation.");
      return;
    }
    const incoming = result.messages || [];
    setThreadMessages((current) => {
      if (after === 0) return incoming;
      const known = new Set(current.map((message) => message.id));
      const fresh = incoming.filter((message) => !known.has(message.id));
      return fresh.length ? current.concat(fresh) : current;
    });
  }

  async function openThread(threadId) {
    setError("");
    setActiveThread(threadId);
    setThreadMessages([]);
    setReply("");
    await loadThreadMessages(threadId, 0);
    await loadThreads(token, false);
  }

  async function sendReply(event) {
    event.preventDefault();
    const body = reply.trim();
    if (!body || !activeThread) return;
    setError("");
    const result = await rpc("admin_reply", { p_token: token, p_thread_id: activeThread, p_body: body });
    if (!result.ok) {
      if (result.code === "unauthorized") signOut();
      setError(result.error || "Could not send that reply.");
      return;
    }
    setReply("");
    setThreadMessages((current) => (current.some((message) => message.id === result.message.id) ? current : current.concat(result.message)));
    await loadThreads(token, false);
  }

  async function deleteThread(thread) {
    if (!window.confirm(`Delete the whole conversation with ${thread.name || thread.email}?`)) return;
    setError("");
    const result = await rpc("admin_delete_thread", { p_token: token, p_thread_id: thread.id });
    if (!result.ok) {
      setError(result.error || "Could not delete that conversation.");
      return;
    }
    setActiveThread(null);
    setThreadMessages([]);
    setNotice(`Deleted the conversation with ${thread.name || thread.email}.`);
    await loadThreads(token, false);
  }

  async function onLogin(event) {
    event.preventDefault();
    setError("");
    const result = await rpc("admin_login", { p_password: password });
    if (!result.ok) {
      setError(result.error || "Sign-in failed.");
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, result.token);
    setToken(result.token);
    setPassword("");
    setTab("users");
  }

  async function createUser(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const result = await rpc("admin_save_user", {
      p_token: token,
      p_id: null,
      p_email: draft.email,
      p_password: draft.password,
      p_name: draft.name,
      p_active: draft.active,
      p_searches_per_day: Number(draft.searches_per_day),
    });
    if (!result.ok) {
      setError(result.error || "Could not create that user.");
      return;
    }
    setDraft(blankDraft());
    setNotice("User created. Their daily search limit is on the Users page.");
    await loadUsers();
  }

  async function saveQuota(user, searchesPerDay) {
    setError("");
    setNotice("");
    const result = await rpc("admin_save_user", {
      p_token: token,
      p_id: user.id,
      p_email: user.email,
      p_password: "",
      p_name: user.name || "",
      p_active: user.active,
      p_searches_per_day: Number(searchesPerDay),
      p_max_pages: user.max_pages,
      p_max_results: user.max_results,
      p_price_min: user.price_min,
      p_price_max: user.price_max,
      p_min_rating: user.min_rating,
      p_min_reviews: user.min_reviews,
      p_target_reviews: user.target_reviews,
      p_ships_from: user.ships_from,
      p_deliver_zip: user.deliver_zip,
    });
    if (!result.ok) {
      setError(result.error || "Could not save that limit.");
      return;
    }
    setNotice(`Saved the daily search limit for ${user.email}.`);
    await loadUsers();
  }

  async function toggleActive(user) {
    setError("");
    setNotice("");
    const active = !user.active;
    const result = await rpc("admin_save_user", {
      p_token: token,
      p_id: user.id,
      p_email: user.email,
      p_password: "",
      p_name: user.name || "",
      p_active: active,
      p_searches_per_day: Number(user.searches_per_day),
      p_max_pages: user.max_pages,
      p_max_results: user.max_results,
      p_price_min: user.price_min,
      p_price_max: user.price_max,
      p_min_rating: user.min_rating,
      p_min_reviews: user.min_reviews,
      p_target_reviews: user.target_reviews,
      p_ships_from: user.ships_from,
      p_deliver_zip: user.deliver_zip,
    });
    if (!result.ok) {
      setError(result.error || "Could not update that account.");
      return;
    }
    setNotice(active ? `${user.email} can search again.` : `${user.email} is deactivated and cannot search.`);
    await loadUsers();
  }

  async function resetToday(user) {
    setError("");
    const result = await rpc("admin_reset_usage", { p_token: token, p_user_id: user.id });
    if (!result.ok) {
      setError(result.error || "Could not reset today's count.");
      return;
    }
    setNotice(`Reset today's searches for ${user.email}.`);
    await loadUsers();
  }

  async function removeUser(user) {
    if (!window.confirm(`Delete ${user.email}?`)) return;
    setError("");
    const result = await rpc("admin_delete_user", { p_token: token, p_user_id: user.id });
    if (!result.ok) {
      setError(result.error || "Could not delete that user.");
      return;
    }
    if (logUser === user.id) setLogUser("");
    setNotice(`Deleted ${user.email}.`);
    await loadUsers();
  }

  async function changePassword(event) {
    event.preventDefault();
    setError("");
    const result = await rpc("admin_change_password", { p_token: token, p_password: nextPassword });
    if (!result.ok) {
      setError(result.error || "Could not change the admin password.");
      return;
    }
    setNextPassword("");
    setNotice("Admin password changed.");
  }

  if (!token) {
    return (
      <main className="auth">
        <aside className="auth-brand">
          <span className="orb orb-a" aria-hidden="true" />
          <span className="orb orb-b" aria-hidden="true" />
          <div className="auth-brand-top">
            <BrandMark size={36} />
            <strong>NicheNet</strong>
            <span className="auth-tag">Admin</span>
          </div>
          <div className="auth-pitch">
            <span className="eyebrow"><span className="live-dot" aria-hidden="true" />Admin console</span>
            <h2>Run your NicheNet team <span className="hl">from one place</span>.</h2>
            <p>Create accounts, set daily search limits, follow activity, and answer questions sent from the extension.</p>
            <ul className="auth-chips">
              <li><Icon name="users" />Users &amp; limits</li>
              <li><Icon name="activity" />Live activity</li>
              <li><Icon name="chat" />Support queries</li>
              <li><Icon name="lock" />Protected access</li>
            </ul>
          </div>
          <div className="auth-collage" aria-hidden="true">
            <div className="collage-card main">
              <p className="preview-head">Users · used today</p>
              {[
                ["A", "Ali", 2, 100],
                ["F", "Faiqa", 74, 100],
                ["S", "Sara", 5, 5],
              ].map(([initial, name, used, limit]) => (
                <div className="preview-user" key={name}>
                  <span className="avatar sm">{initial}</span>
                  <span className="preview-name">{name}</span>
                  <span className={`preview-bar${used >= limit ? " full" : used / limit >= 0.7 ? " high" : ""}`}>
                    <i style={{ width: `${Math.round((used / limit) * 100)}%` }} />
                  </span>
                  <span className="preview-count">{used} / {limit}</span>
                </div>
              ))}
            </div>
            <div className="collage-card stat">
              <span className="stat-label">Searches today</span>
              <strong>33</strong>
              <span className="spark"><i /><i /><i /><i /><i /><i /><i /></span>
            </div>
            <div className="collage-card file">
              <span className="file-icon chat"><Icon name="chat" /></span>
              <span className="file-text"><strong>New query from Zara</strong><small>I forgot my password, can you help?</small></span>
            </div>
          </div>
          <p className="auth-brand-foot">NicheNet · Amazon product finder</p>
        </aside>

        <div className="auth-main">
          <form className="auth-card" onSubmit={onLogin}>
            <span className="auth-logo"><BrandMark size={48} /></span>
            <div>
              <h1>Admin sign in</h1>
              <p className="auth-lead">Enter the admin password to manage users, limits, and queries.</p>
            </div>
            {!isConfigured() ? <Alert tone="error">The Supabase anon key is missing from admin/.env.</Alert> : null}
            <div className="field">
              <label htmlFor="admin-password">Admin password</label>
              <div className="input-icon">
                <Icon name="lock" />
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter the admin password"
                  required
                />
                <button
                  type="button"
                  className="btn ghost sm icon-only peek"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} />
                </button>
              </div>
            </div>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <button type="submit" className="btn primary lg block signin-btn">
              <span>Sign in</span>
              <Icon name="arrowRight" />
            </button>
            <p className="auth-secure"><Icon name="shield" />Secure sign-in over an encrypted connection.</p>
            <p className="auth-foot"><a href="/privacy">Privacy policy</a></p>
          </form>
        </div>
      </main>
    );
  }

  const page = PAGES[tab];
  const unreadQueries = threads.reduce((total, thread) => total + (Number(thread.admin_unread) || 0), 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark size={32} />
          <div>
            <strong>NicheNet</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav aria-label="Admin pages">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${tab === item.id ? " active" : ""}`}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => goTo(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "users" && users.length ? <span className="nav-count">{users.length}</span> : null}
              {item.id === "queries" && unreadQueries ? (
                <span className="nav-count alert" aria-label={`${unreadQueries} unread`}>{unreadQueries > 99 ? "99+" : unreadQueries}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="admin-chip">
            <span className="avatar" aria-hidden="true">A</span>
            <div>
              <strong>Administrator</strong>
              <span>Signed in</span>
            </div>
          </div>
          <button className="btn ghost icon-only" type="button" onClick={signOut} title="Sign out" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="page-head">
          <div>
            <h1>{page.title}</h1>
            <p className="lede">{page.lede}</p>
          </div>
          {tab === "users" ? (
            <button type="button" className="btn primary" onClick={() => goTo("create")}>
              <Icon name="plus" />
              <span>Create user</span>
            </button>
          ) : null}
        </header>

        {error ? <Alert tone="error" onClose={() => setError("")}>{error}</Alert> : null}
        {notice ? <Alert tone="success" onClose={() => setNotice("")}>{notice}</Alert> : null}

        {tab === "queries" ? (
          <Queries
            threads={threads}
            activeId={activeThread}
            messages={threadMessages}
            reply={reply}
            onReply={setReply}
            onOpen={openThread}
            onSend={sendReply}
            onDelete={deleteThread}
            onBack={() => setActiveThread(null)}
          />
        ) : null}
        {tab === "create" ? <CreateUser draft={draft} setDraft={setDraft} onSubmit={createUser} /> : null}
        {tab === "users" ? (
          <UserList
            users={users}
            onCreate={() => goTo("create")}
            onSaveQuota={saveQuota}
            onLogs={openLogs}
            onToggle={toggleActive}
            onReset={resetToday}
            onDelete={removeUser}
          />
        ) : null}
        {tab === "activity" ? (
          <Activity
            users={users}
            logs={logs}
            query={logQuery}
            userId={logUser}
            onQuery={setLogQuery}
            onUser={setLogUser}
            onSearch={(event) => {
              event.preventDefault();
              loadLogs();
            }}
          />
        ) : null}
        {tab === "settings" ? (
          <Settings password={nextPassword} onPassword={setNextPassword} onSubmit={changePassword} onSignOut={signOut} />
        ) : null}
      </main>
    </div>
  );
}

function CreateUser({ draft, setDraft, onSubmit }) {
  return (
    <div className="split">
      <form className="card form-card" onSubmit={onSubmit}>
        <div className="card-head">
          <h2>Account details</h2>
          <p>The person signs in to the extension with this email and password.</p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-name">Name</label>
            <input id="new-name" placeholder="e.g. Ali Khan" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="new-email">Email</label>
            <input id="new-email" type="email" required placeholder="name@example.com" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="new-password">Password</label>
            <input id="new-password" type="text" required minLength={8} placeholder="At least 8 characters" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            <span className="field-note">Share it with the person. They cannot change it themselves.</span>
          </div>
          <div className="field">
            <label htmlFor="new-limit">Searches per day</label>
            <input id="new-limit" type="number" min="0" required value={draft.searches_per_day} onChange={(event) => setDraft({ ...draft, searches_per_day: event.target.value })} />
            <span className="field-note">How many product searches they can start each day.</span>
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
          <span className="track" aria-hidden="true" />
          <span className="switch-text">
            <strong>Active</strong>
            <small>Active accounts can sign in and search right away.</small>
          </span>
        </label>
        <div className="card-foot">
          <button type="submit" className="btn primary">
            <Icon name="userPlus" />
            <span>Create user</span>
          </button>
        </div>
      </form>
      <aside className="card tips">
        <h2>How limits work</h2>
        <ul>
          <li><Icon name="check" /><span>Each search started in the extension uses one from the daily limit.</span></li>
          <li><Icon name="check" /><span>Counts reset at midnight UTC, or when you click <strong>Reset today</strong>.</span></li>
          <li><Icon name="check" /><span>You can change the limit or pause the account any time on the Users page.</span></li>
        </ul>
      </aside>
    </div>
  );
}

function UserList({ users, onCreate, onSaveQuota, onLogs, onToggle, onReset, onDelete }) {
  const active = users.filter((user) => user.active).length;
  const limited = users.filter((user) => user.active && quota(user).used >= quota(user).limit).length;
  const searches = users.reduce((total, user) => total + (Number(user.used_today) || 0), 0);

  return (
    <>
      <div className="stats">
        <Stat label="Total users" value={users.length} />
        <Stat label="Active" value={active} />
        <Stat label="Searches today" value={searches.toLocaleString()} />
        <Stat label="At daily limit" value={limited} tone={limited ? "bad" : ""} />
      </div>
      <section className="card table-card">
        {users.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Icon name="users" /></span>
            <p className="empty-title">No users yet</p>
            <p>Create the first account so someone can sign in to the extension.</p>
            <button type="button" className="btn primary" onClick={onCreate}>
              <Icon name="plus" />
              <span>Create user</span>
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Used today</th>
                  <th>Daily limit</th>
                  <th className="right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onSaveQuota={onSaveQuota}
                    onLogs={onLogs}
                    onToggle={onToggle}
                    onReset={onReset}
                    onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function UserRow({ user, onSaveQuota, onLogs, onToggle, onReset, onDelete }) {
  const [searches, setSearches] = useState(String(user.searches_per_day));
  useEffect(() => {
    setSearches(String(user.searches_per_day));
  }, [user.searches_per_day, user.id]);
  const { limit, used, remaining, percent } = quota(user);
  const status = userStatus(user);
  const level = percent >= 100 ? "full" : percent >= 80 ? "high" : "";
  const changed = searches !== String(user.searches_per_day);
  const who = user.name || user.email;

  return (
    <tr>
      <td data-label="User">
        <div className="user-cell">
          <span className="avatar" aria-hidden="true">{(who || "?").trim().charAt(0).toUpperCase()}</span>
          <div>
            <strong>{user.name || "—"}</strong>
            <span>{user.email}</span>
          </div>
        </div>
      </td>
      <td data-label="Status">
        <span className={`badge ${status.tone}`}><span className="dot" />{status.label}</span>
      </td>
      <td data-label="Used today">
        <div className="usage">
          <div className="usage-top">
            <span><strong>{used.toLocaleString()}</strong> / {limit.toLocaleString()}</span>
            <span>{remaining.toLocaleString()} left</span>
          </div>
          <div
            className={`meter ${level}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={used}
            aria-label={`${used} of ${limit} searches used, ${remaining} remaining`}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      </td>
      <td data-label="Daily limit">
        <form
          className="limit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveQuota(user, searches);
          }}
        >
          <input
            type="number"
            min="0"
            required
            aria-label={`Searches per day for ${user.email}`}
            value={searches}
            onChange={(event) => setSearches(event.target.value)}
          />
          <button type="submit" className="btn primary sm" disabled={!changed}>Save</button>
        </form>
      </td>
      <td data-label="Actions" className="right">
        <div className="row-actions">
          <button type="button" className="btn ghost sm" onClick={() => onLogs(user)} title="View logs">
            <Icon name="list" />
            <span className="label">Logs</span>
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onReset(user)} title="Reset today's count">
            <Icon name="reset" />
            <span className="label">Reset today</span>
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onToggle(user)} title={user.active ? "Deactivate" : "Activate"}>
            <Icon name={user.active ? "pause" : "play"} />
            <span className="label">{user.active ? "Deactivate" : "Activate"}</span>
          </button>
          <button
            type="button"
            className="btn ghost sm icon-only danger-hover"
            onClick={() => onDelete(user)}
            title="Delete user"
            aria-label={`Delete ${user.email}`}
          >
            <Icon name="trash" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function actionTone(action) {
  const value = String(action || "").toLowerCase();
  if (value === "error" || value.includes("limit")) return "bad";
  if (value === "warn") return "warn";
  if (value.includes("search started")) return "good";
  if (value.includes("signed")) return "info";
  return "muted";
}

function Activity({ users, logs, query, userId, onQuery, onUser, onSearch }) {
  return (
    <section className="card table-card">
      <form className="toolbar" onSubmit={onSearch}>
        <div className="search-input">
          <Icon name="search" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search name, email, or what they did"
            aria-label="Search logs"
          />
        </div>
        <select value={userId} onChange={(event) => onUser(event.target.value)} aria-label="User">
          <option value="">All users</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.name || user.email}</option>
          ))}
        </select>
        <button type="submit" className="btn primary">Search</button>
      </form>
      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-row">No activity yet.</td>
              </tr>
            ) : (
              logs.map((entry) => {
                const when = formatWhen(entry.created_at);
                return (
                  <tr key={entry.id}>
                    <td data-label="When">
                      <div className="when">
                        <span>{when.date}</span>
                        <span className="muted">{when.time}</span>
                      </div>
                    </td>
                    <td data-label="User">
                      <div className="user-cell compact">
                        <span className="avatar sm" aria-hidden="true">{(entry.name || entry.email || "?").trim().charAt(0).toUpperCase()}</span>
                        <div>
                          <strong>{entry.name || entry.email || "—"}</strong>
                          <span>{entry.email}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Event">
                      <span className={`badge ${actionTone(entry.action)}`}>{entry.action}</span>
                    </td>
                    <td data-label="Detail" className="detail">{entry.detail || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {logs.length ? <p className="table-foot">Showing {logs.length.toLocaleString()} {logs.length === 1 ? "entry" : "entries"}, newest first.</p> : null}
    </section>
  );
}

function shortWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(date.toDateString())) / 86400000);
  if (days === 0) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(date.toDateString())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Queries({ threads, activeId, messages, reply, onReply, onOpen, onSend, onDelete, onBack }) {
  const [filter, setFilter] = useState("");
  const listEnd = useRef(null);
  const active = threads.find((thread) => thread.id === activeId) || null;
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => `${thread.name} ${thread.email}`.toLowerCase().includes(query));
  }, [threads, filter]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeId]);

  let lastDay = "";
  return (
    <div className={`queries${active ? " has-active" : ""}`}>
      <aside className="card thread-list">
        <div className="thread-search search-input">
          <Icon name="search" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by name or email" aria-label="Search conversations" />
        </div>
        <div className="threads">
          {shown.length === 0 ? (
            <p className="threads-empty">{threads.length ? "No conversation matches that search." : "No questions yet. Messages from the extension's chat button show up here."}</p>
          ) : (
            shown.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread${thread.id === activeId ? " active" : ""}${thread.admin_unread ? " unread" : ""}`}
                onClick={() => onOpen(thread.id)}
              >
                <span className="avatar" aria-hidden="true">{(thread.name || thread.email || "?").trim().charAt(0).toUpperCase()}</span>
                <span className="thread-main">
                  <span className="thread-top">
                    <strong>{thread.name || thread.email}</strong>
                    <time dateTime={thread.last_message_at}>{shortWhen(thread.last_message_at)}</time>
                  </span>
                  <span className="thread-bottom">
                    <span className="preview">
                      {thread.last_sender === "admin" ? "You: " : ""}
                      {thread.last_body || "No messages yet"}
                    </span>
                    {thread.admin_unread ? <span className="unread-count">{thread.admin_unread}</span> : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="card conversation">
        {active ? (
          <>
            <header className="conv-head">
              <button type="button" className="btn ghost icon-only back" onClick={onBack} aria-label="Back to conversations">
                <Icon name="back" />
              </button>
              <span className="avatar" aria-hidden="true">{(active.name || active.email || "?").trim().charAt(0).toUpperCase()}</span>
              <div className="conv-who">
                <strong>{active.name || active.email}</strong>
                <span>{active.email}</span>
              </div>
              <span className={`badge ${active.is_guest ? "warn" : "info"}`}>{active.is_guest ? "Not signed in" : "Account"}</span>
              <button
                type="button"
                className="btn ghost sm icon-only danger-hover"
                onClick={() => onDelete(active)}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                <Icon name="trash" />
              </button>
            </header>
            <div className="conv-messages">
              {messages.map((message) => {
                const day = dayLabel(message.created_at);
                const divider = day && day !== lastDay ? day : "";
                lastDay = day || lastDay;
                return (
                  <div key={message.id} className="conv-row">
                    {divider ? <p className="conv-day">{divider}</p> : null}
                    <div className={`bubble ${message.sender === "admin" ? "mine" : "theirs"}`}>
                      <p>{message.body}</p>
                      <time dateTime={message.created_at}>
                        {message.sender === "admin" ? "You · " : ""}
                        {new Date(message.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </time>
                    </div>
                  </div>
                );
              })}
              <span ref={listEnd} />
            </div>
            <form className="conv-compose" onSubmit={onSend}>
              <textarea
                value={reply}
                onChange={(event) => onReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder={`Reply to ${active.name || active.email}… (Enter to send, Shift+Enter for a new line)`}
                aria-label="Reply"
              />
              <button type="submit" className="btn primary" disabled={!reply.trim()}>
                <Icon name="send" />
                <span>Send</span>
              </button>
            </form>
          </>
        ) : (
          <div className="empty conv-empty">
            <span className="empty-icon"><Icon name="chat" /></span>
            <p className="empty-title">Select a conversation</p>
            <p>Pick someone on the left to read their messages and reply.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Settings({ password, onPassword, onSubmit, onSignOut }) {
  return (
    <div className="settings">
      <form className="card form-card" onSubmit={onSubmit}>
        <div className="card-head">
          <h2>Admin password</h2>
          <p>Use at least 8 characters. Anyone with this password can manage every account.</p>
        </div>
        <div className="field">
          <label htmlFor="next-password">New password</label>
          <input
            id="next-password"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
          />
        </div>
        <div className="card-foot">
          <button type="submit" className="btn primary">Change password</button>
        </div>
      </form>
      <section className="card form-card">
        <div className="card-head">
          <h2>Session</h2>
          <p>Sign out of the admin site on this browser.</p>
        </div>
        <div className="card-foot">
          <button type="button" className="btn secondary" onClick={onSignOut}>
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Alert({ tone, children, onClose }) {
  return (
    <div className={`alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "error" ? "alert" : "checkCircle"} />
      <p>{children}</p>
      {onClose ? (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}

function BrandMark({ size = 32 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f766e" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="m19 19 5.5 5.5" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

const ICONS = {
  eye: (
    <>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m2 2 20 20" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  send: (
    <>
      <path d="M3.7 3.3a.5.5 0 0 1 .7-.6l16.8 8.4a1 1 0 0 1 0 1.8L4.4 21.3a.5.5 0 0 1-.7-.6L6 12Z" />
      <path d="M6 12h8" />
    </>
  ),
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  userPlus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <path d="M21 12H9" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  list: (
    <>
      <path d="M3 12h18" />
      <path d="M3 6h18" />
      <path d="M3 18h12" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  pause: (
    <>
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </>
  ),
  play: <polygon points="6 3 20 12 6 21 6 3" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
};

function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
  };
}
