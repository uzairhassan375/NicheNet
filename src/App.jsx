import { useEffect, useState } from "react";
import { isConfigured, rpc } from "./api.js";

const TOKEN_KEY = "nichenet-admin-token";

const NAV = [
  { id: "create", label: "Create user" },
  { id: "users", label: "Users" },
  { id: "activity", label: "Activity" },
];

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

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState("users");
  const [draft, setDraft] = useState(blankDraft);
  const [nextPassword, setNextPassword] = useState("");
  const [logs, setLogs] = useState([]);
  const [logQuery, setLogQuery] = useState("");
  const [logUser, setLogUser] = useState("");

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

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUsers([]);
  }

  function openLogs(user) {
    setLogUser(user?.id || "");
    setLogQuery("");
    setTab("activity");
    setError("");
    setNotice("");
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
      <main className="page">
        <h1>Admin</h1>
        <p className="lede">Sign in to create extension users and set the limits each person can search with.</p>
        <form className="card" onSubmit={onLogin}>
          {!isConfigured() ? <p className="error">The Supabase anon key is missing from admin/.env.</p> : null}
          <label>
            Admin password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button type="submit">Sign in</button>
          </div>
        </form>
        <p className="policy-link"><a href="/privacy">Privacy policy</a></p>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Admin</strong>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "active" : ""}
              onClick={() => { setTab(item.id); setError(""); setNotice(""); }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <form className="side-password" onSubmit={changePassword}>
          <label>
            Admin password
            <input type="password" minLength={8} required placeholder="New password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
          </label>
          <button type="submit">Change</button>
        </form>
        <button className="ghost signout" type="button" onClick={signOut}>Sign out</button>
      </aside>

      <main className="content">
        {error ? <p className="error">{error}</p> : null}
        {notice ? <p className="ok">{notice}</p> : null}
        {tab === "create" ? (
          <CreateUser draft={draft} setDraft={setDraft} onSubmit={createUser} />
        ) : null}
        {tab === "users" ? (
          <UserList users={users} onSaveQuota={saveQuota} onLogs={openLogs} onToggle={toggleActive} onReset={resetToday} onDelete={removeUser} />
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
      </main>
    </div>
  );
}

function CreateUser({ draft, setDraft, onSubmit }) {
  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>Create user</h1>
      <p className="lede">This account can sign in to the extension. Searches per day is how many product searches they can start. The count resets at midnight UTC.</p>
      <div className="grid">
        <label className="span-2">
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="span-2">
          Email
          <input type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
        </label>
        <label className="span-2">
          Password
          <input type="text" required minLength={8} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
        </label>
        <label>
          Searches per day
          <input type="number" min="0" required value={draft.searches_per_day} onChange={(event) => setDraft({ ...draft, searches_per_day: event.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
          Active
        </label>
      </div>
      <div className="actions">
        <button type="submit">Create user</button>
      </div>
    </form>
  );
}

function UserList({ users, onSaveQuota, onLogs, onToggle, onReset, onDelete }) {
  return (
    <section className="card">
      <h1>Users</h1>
      <p className="lede">Each person has a daily product-search limit. The bar shows how many they have used today and how many are left. Counts reset at midnight UTC.</p>
      <div className="user-list">
        {users.length === 0 ? (
          <p>No users yet. Create one from the sidebar.</p>
        ) : (
          users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              onSaveQuota={onSaveQuota}
              onLogs={onLogs}
              onToggle={onToggle}
              onReset={onReset}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}

function UserCard({ user, onSaveQuota, onLogs, onToggle, onReset, onDelete }) {
  const [searches, setSearches] = useState(String(user.searches_per_day));
  useEffect(() => {
    setSearches(String(user.searches_per_day));
  }, [user.searches_per_day, user.id]);
  const { limit, used, remaining, percent } = quota(user);
  const blocked = used >= limit || !user.active;

  return (
    <article className="user-card">
      <div className="user-head">
        <div>
          <strong>{user.name || "—"}</strong>
          <div className="summary">{user.email}</div>
        </div>
        <div>
          {blocked ? <span className="badge">Blocked</span> : <span className="badge ok-badge">Allowed</span>}
          {!user.active ? <span className="badge">Paused</span> : null}
        </div>
      </div>
      <div className="quota">
        <div className="quota-label">
          <span>{used} used</span>
          <span>{remaining} remaining</span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={`${used} of ${limit} searches used, ${remaining} remaining`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="summary">{used} of {limit} product searches used today</div>
      </div>
      <form
        className="quota-edit"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveQuota(user, searches);
        }}
      >
        <label>
          Searches per day
          <input type="number" min="0" required value={searches} onChange={(event) => setSearches(event.target.value)} />
        </label>
        <button type="submit">Save limit</button>
      </form>
      <div className="actions">
        <button type="button" onClick={() => onLogs(user)}>View logs</button>
        <button type="button" className={user.active ? "ghost" : ""} onClick={() => onToggle(user)}>
          {user.active ? "Deactivate" : "Activate"}
        </button>
        <button type="button" className="ghost" onClick={() => onReset(user)}>Reset today</button>
        <button type="button" className="danger" onClick={() => onDelete(user)}>Delete</button>
      </div>
    </article>
  );
}

function Activity({ users, logs, query, userId, onQuery, onUser, onSearch }) {
  return (
    <section className="card">
      <h1>Activity</h1>
      <p className="lede">Every sign-in, search, and extension log is kept here, one person at a time or all of them together.</p>
      <form className="search-bar" onSubmit={onSearch}>
        <label>
          Search logs
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Name, email, or what they did" />
        </label>
        <label>
          User
          <select
            value={userId}
            onChange={(event) => onUser(event.target.value)}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name || user.email}</option>
            ))}
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>What</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4}>No activity yet.</td>
              </tr>
            ) : (
              logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.created_at)}</td>
                  <td>{entry.name || entry.email || "—"}<div className="summary">{entry.email}</div></td>
                  <td>{entry.action}</td>
                  <td className="summary">{entry.detail || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}
