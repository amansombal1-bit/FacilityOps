import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
let csrf = "";
async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-CSRF-Token": csrf,
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
const date = (s) =>
  s
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(s)) + " IST"
    : "—";
const label = (s) =>
  ({ InProgress: "In progress", AwaitingApproval: "Awaiting FM approval" })[
    s
  ] || s;
const taskId = (t) => "FO-" + String(t.number).padStart(5, "0");
const closed = (t) => ["Completed", "Cancelled"].includes(t.status);
function Badge({ value }) {
  return <span className={"badge " + value}>{label(value)}</span>;
}
function Field({ label: caption, children, ...props }) {
  return (
    <label className="field">
      <span>{caption}</span>
      {children || <input {...props} />}
    </label>
  );
}
function App() {
  const [me, setMe] = useState(),
    [mode, setMode] = useState(""),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [selected, setSelected] = useState(
      new URLSearchParams(location.search).get("task"),
    ),
    [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false);
  const load = async () => {
    try {
      const d = await api("/me");
      csrf = d.csrf;
      setMe(d.user);
      setMode(d.mode);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const act = async (fn, message) => {
    setError("");
    try {
      const r = await fn();
      if (message) setToast(message);
      setRevision((x) => x + 1);
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  if (loading) return <div className="loading">Opening your workspace…</div>;
  if (!me) return <Login onLogin={load} />;
  const nav = [
    "Overview",
    "My tasks",
    "All tasks",
    "Floor view",
    ...(me.role === "FM" ? ["Approval queue"] : []),
    "Overdue monitor",
    "Reports",
    ...(me.role === "FM" ? ["Team", "Automation", "Audit log"] : []),
  ];
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          ▦{" "}
          <span>
            Facility<span className="brand-light">Ops</span>
            <small>OPERATIONS WORKSPACE</small>
          </span>
        </a>
        <div className="workspace">
          AW{" "}
          <span>
            Alwar workspace<small>Facility management</small>
          </span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n, i) => (
            <button
              className={page === n ? "active" : ""}
              key={n}
              onClick={() => {
                setPage(n);
                setSelected(null);
                setCreating(false);
              }}
            >
              <span aria-hidden="true">
                {["◫", "✓", "▤", "▦", "◎", "◷", "▥", "♙", "⚙", "≡"][i]}
              </span>
              {n}
            </button>
          ))}
        </nav>
        <div className="profile">
          <strong>{me.name}</strong>
          <small>
            {me.role === "FM" ? "FM · Super admin" : "FOT · Floor in-charge"}
          </small>
          <button
            onClick={() =>
              act(async () => {
                await api("/auth/logout", "POST");
                setMe(null);
              }, "")
            }
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">
              WORKSPACE / {selected ? "TASK DETAILS" : page.toUpperCase()}
            </span>
            <h1>{selected ? "Task workspace" : page}</h1>
          </div>
          <div className="head-actions">
            <button
              className="mobile-signout"
              onClick={() =>
                act(async () => {
                  await api("/auth/logout", "POST");
                  setMe(null);
                })
              }
            >
              Sign out
            </button>
            <span className="today">
              {new Intl.DateTimeFormat("en-IN", {
                dateStyle: "medium",
                timeZone: "Asia/Kolkata",
              }).format(new Date())}
            </span>
            {me.role === "FM" && (
              <button
                className="primary"
                onClick={() => {
                  setCreating(true);
                  setSelected(null);
                }}
              >
                + Create task
              </button>
            )}
          </div>
        </header>
        {mode === "local" && (
          <div className="notice">
            Development mode · Email and Drive are local test adapters. No real
            messages are sent.
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {toast && (
          <div role="status" className="success">
            {toast}
          </div>
        )}
        {creating ? (
          <TaskForm me={me} act={act} onDone={() => setCreating(false)} />
        ) : selected ? (
          <TaskDetail
            id={selected}
            me={me}
            act={act}
            revision={revision}
            back={() => setSelected(null)}
          />
        ) : page === "Team" ? (
          <Team act={act} revision={revision} />
        ) : page === "Automation" ? (
          <Automation act={act} />
        ) : page === "Audit log" ? (
          <Audit />
        ) : page === "Reports" ? (
          <Reports act={act} me={me} />
        ) : (
          <TaskWorkspace
            page={page}
            me={me}
            revision={revision}
            open={setSelected}
            act={act}
          />
        )}
      </main>
    </div>
  );
}
function Login({ onLogin }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <section className="login-story">
        <div className="brand">▦ FacilityOps</div>
        <span className="eyebrow">A BETTER WAY TO RUN YOUR FACILITY</span>
        <h1>
          Every floor.
          <br />
          Every task.
          <br />
          <em>Accounted for.</em>
        </h1>
        <p>
          One workspace for your team, evidence, and approvals. Keep the small
          things from becoming big problems.
        </p>
        <div className="login-stats">
          <div>
            01<small>Assign with clarity</small>
          </div>
          <div>
            02<small>Resolve with evidence</small>
          </div>
          <div>
            03<small>Approve with confidence</small>
          </div>
        </div>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">YOUR OPERATIONS, IN ONE PLACE</span>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your approved work email.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/auth/login", "POST", { email, password });
                await onLogin();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Work email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field label="Password" type="password" autoComplete="current-password"
              required value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary full">
              {busy ? "Signing in…" : "Sign in →"}
            </button>
          </form>
          <p className="secure-note">
            ◈ Private workspace · Access is managed by your FM.
            <br />
            Need access? Contact your facility manager.
          </p>
        </div>
      </section>
    </div>
  );
}
function useData(path, revision = 0) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    api(path)
      .then((x) => {
        if (alive) setData(x);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return [data, error];
}
function TaskWorkspace({ page, me, revision, open, act }) {
  const [filter, setFilter] = useState({}),
    [pg, setPg] = useState(1);
  useEffect(() => {
    setFilter({});
    setPg(1);
  }, [page]);
  const q = new URLSearchParams({
    ...filter,
    page: pg,
    ...(page === "My tasks" ? { assignedToId: me.id } : {}),
    ...(page === "Approval queue" ? { status: "AwaitingApproval" } : {}),
    ...(page === "Overdue monitor" ? { overdue: "true" } : {}),
  }).toString();
  const [data, error] = useData("/tasks?" + q, revision),
    [stats] = useData("/reports", revision),
    [people] = useData("/people", revision);
  const update = (k, v) => {
    setFilter({ ...filter, [k]: v });
    setPg(1);
  };
  return (
    <>
      {page === "Overview" && (
        <>
          <div className="welcome">
            <div>
              <span className="eyebrow">THE DAILY PICTURE</span>
              <h2>Keep your facility moving.</h2>
              <p>Clear priorities. Verified work. Nothing left behind.</p>
            </div>
            <div className="welcome-icon">▦</div>
          </div>
          <div className="metrics">
            {[
              ["Pending tasks", stats?.pending, "Across all floors"],
              ["Needs approval", stats?.approval, "Ready for FM review"],
              ["Overdue", stats?.overdue, "Needs your attention"],
              ["Closed this week", stats?.completedInPeriod, "Verified by FM"],
            ].map(([s, n, h]) => (
              <div className="metric" key={s}>
                <span>{s}</span>
                <strong>{n ?? "—"}</strong>
                <small>{h}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {page === "Floor view" && (
        <div className="floor-grid">
          {stats?.floors.map((f) => (
            <button
              className="card"
              key={f.floor}
              onClick={() => update("floor", f.floor)}
            >
              <h3>Floor {f.floor}</h3>
              <strong>{f.pending} pending</strong>
              <p>{f.total} total tasks</p>
            </button>
          ))}
        </div>
      )}
      <section className="card register">
        <div className="section-title">
          <div>
            <h2>{page === "Overview" ? "Task register" : page}</h2>
            <p className="muted">
              {data?.total ?? "…"} tasks · All times shown in IST
            </p>
          </div>
          {me.role === "FM" && (
            <a className="button" href={"/api/tasks.csv?" + q}>
              ↓ Export CSV
            </a>
          )}
        </div>
        <div className="filters">
          <Field label="Floor">
            <input
              placeholder="All floors"
              value={filter.floor || ""}
              onChange={(e) => update("floor", e.target.value)}
            />
          </Field>
          <Field label="Category">
            <input
              placeholder="All categories"
              value={filter.category || ""}
              onChange={(e) => update("category", e.target.value)}
            />
          </Field>
          <Field label="Owner">
            <select
              value={filter.assignedToId || ""}
              onChange={(e) => update("assignedToId", e.target.value)}
            >
              <option value="">Everyone</option>
              {people?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={filter.priority || ""}
              onChange={(e) => update("priority", e.target.value)}
            >
              <option value="">All priorities</option>
              {["Normal", "Urgent", "Critical"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={filter.status || ""}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "Open",
                "InProgress",
                "AwaitingApproval",
                "Completed",
                "Cancelled",
              ].map((p) => (
                <option value={p} key={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Created from"
            type="date"
            onChange={(e) =>
              update(
                "from",
                e.target.value
                  ? new Date(e.target.value + "T00:00:00+05:30").toISOString()
                  : "",
              )
            }
          />
          <Field
            label="Created through"
            type="date"
            onChange={(e) =>
              update(
                "to",
                e.target.value
                  ? new Date(e.target.value + "T23:59:59+05:30").toISOString()
                  : "",
              )
            }
          />
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task / location</th>
                <th>Assigned to</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Deadline</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <small className="task-number">{taskId(t)}</small>
                    <button className="task-link" onClick={() => open(t.id)}>
                      {t.title}
                    </button>
                    <small className="muted">
                      Floor {t.floor}
                      {t.room ? " · Room " + t.room : ""} · {t.category}
                    </small>
                  </td>
                  <td>
                    <span className="avatar">
                      {t.assignedTo.name.slice(0, 1)}
                    </span>
                    {t.assignedTo.name}
                  </td>
                  <td>
                    <Badge value={t.priority} />
                  </td>
                  <td>
                    <Badge value={t.status} />
                  </td>
                  <td
                    className={
                      !closed(t) && new Date(t.deadline) < new Date()
                        ? "overdue"
                        : ""
                    }
                  >
                    {date(t.deadline)}
                  </td>
                  <td>
                    <button
                      aria-label={"View " + t.title}
                      onClick={() => open(t.id)}
                    >
                      ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data ? (
          <div className="empty">Loading tasks…</div>
        ) : !data.items.length ? (
          <div className="empty">
            <span>✓</span>
            <h3>No tasks in this view</h3>
            <p>Create a task or change your filters.</p>
          </div>
        ) : null}
        <div className="pagination">
          <button disabled={pg === 1} onClick={() => setPg(pg - 1)}>
            ← Previous
          </button>
          <span>Page {pg}</span>
          <button
            disabled={!data || pg * 50 >= data.total}
            onClick={() => setPg(pg + 1)}
          >
            Next →
          </button>
        </div>
      </section>
    </>
  );
}
function TaskForm({ me, act, onDone, task }) {
  const [people] = useData("/people");
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState(
    task
      ? {
          title: task.title,
          description: task.description,
          category: task.category,
          floor: task.floor,
          room: task.room,
          assignedToId: task.assignedToId,
          priority: task.priority,
          deadline: new Date(new Date(task.deadline).getTime() + 19800000)
            .toISOString()
            .slice(0, 16),
          beforeRequired: task.beforeRequired,
          gpsRequired: task.gpsRequired,
          cameraRequired: task.cameraRequired,
        }
      : {
          title: "",
          description: "",
          category: "Housekeeping",
          floor: "1",
          room: "",
          assignedToId: "",
          priority: "Normal",
          deadline: "",
          beforeRequired: false,
          gpsRequired: false,
          cameraRequired: true,
        },
  );
  const field = (k, v) => setD({ ...d, [k]: v });
  return (
    <section className="card form-card">
      <h2>{task ? "Edit task" : "Create a task"}</h2>
      <p className="muted">
        A clear brief makes good work easier. Evidence requirements are enforced
        by the server.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await act(
            () =>
              api(
                task ? "/tasks/" + task.id : "/tasks",
                task ? "PATCH" : "POST",
                {
                  ...d,
                  deadline: new Date(d.deadline + ":00+05:30").toISOString(),
                  ...(task ? { version: task.version } : {}),
                },
              ),
            "Task saved",
          );
          setBusy(false);
          if (r) onDone();
        }}
      >
        <Field
          label="Task title"
          required
          minLength={3}
          value={d.title}
          onChange={(e) => field("title", e.target.value)}
        />
        <Field label="Description">
          <textarea
            required
            rows={3}
            value={d.description}
            onChange={(e) => field("description", e.target.value)}
          />
        </Field>
        <div className="form-grid">
          {["category", "floor", "room"].map((k) => (
            <Field
              key={k}
              label={k[0].toUpperCase() + k.slice(1)}
              required={k !== "room"}
              value={d[k]}
              onChange={(e) => field(k, e.target.value)}
            />
          ))}
          <Field label="Assign task to">
            <select
              required
              value={d.assignedToId}
              onChange={(e) => field("assignedToId", e.target.value)}
            >
              <option value="">Choose a team member</option>
              {me?.role === "FM" && <option value={me.id}>Myself ({me.name})</option>}
              {people
                ?.filter((p) => p.role === "FOT")
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={d.priority}
              onChange={(e) => field("priority", e.target.value)}
            >
              {["Normal", "Urgent", "Critical"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Deadline (Asia/Kolkata)"
            type="datetime-local"
            required
            value={d.deadline}
            onChange={(e) => field("deadline", e.target.value)}
          />
        </div>
        <div className="policy-box">
          <h3>Evidence policy</h3>
          <p>✓ Completion photo always required</p>
          {[
            ["beforeRequired", "Before photo required (before work starts)"],
            ["gpsRequired", "GPS location required"],
            ["cameraRequired", "Fresh in-app camera capture required"],
          ].map(([k, l]) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                checked={d[k]}
                onChange={(e) => field(k, e.target.checked)}
              />
              {l}
            </label>
          ))}
          {task && (
            <small>
              Changing owner or evidence policy starts a new evidence cycle.
            </small>
          )}
        </div>
        <div className="row">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save task"}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
function TaskDetail({ id, me, act, revision, back }) {
  const [t, error] = useData("/tasks/" + id, revision),
    [edit, setEdit] = useState(false),
    [reason, setReason] = useState(""),
    [action, setAction] = useState(""),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false);
  if (error) return <p className="error">{error}</p>;
  if (!t) return <p>Loading task…</p>;
  if (edit)
    return <TaskForm me={me} task={t} act={act} onDone={() => setEdit(false)} />;
  const own = t.assignedToId === me.id;
  const change = async (name, data = {}) => {
    setBusy(true);
    await act(() => api(`/tasks/${id}/${name}`, "POST", data), "Task updated");
    setBusy(false);
  };
  return (
    <>
      <button className="back" onClick={back}>
        ← Back to register
      </button>
      <section className="card">
        <div className="section-title">
          <div>
            <span className="task-number">
              {taskId(t)} · Cycle {t.cycle}
            </span>
            <h2>{t.title}</h2>
          </div>
          <Badge value={t.status} />
        </div>
        <p>{t.description}</p>
        <div className="detail-grid">
          <div>
            <small>LOCATION</small>
            <p>
              Floor {t.floor} · {t.room || "Common area"}
            </p>
          </div>
          <div>
            <small>ASSIGNED TO</small>
            <p>{t.assignedTo.name}</p>
          </div>
          <div>
            <small>DEADLINE</small>
            <p>{date(t.deadline)}</p>
          </div>
          <div>
            <small>PRIORITY</small>
            <p>
              <Badge value={t.priority} />
            </p>
          </div>
        </div>
        <p className="muted">
          {t.beforeRequired ? "Before + completion photo" : "Completion photo"}{" "}
          · {t.gpsRequired ? "GPS required" : "GPS optional"} ·{" "}
          {t.cameraRequired ? "Camera capture required" : "Gallery allowed"}
        </p>
        {t.rejectionReason && (
          <div className="notice">
            <strong>Rework requested:</strong> {t.rejectionReason}
          </div>
        )}
        {me.role === "FM" && ["Open", "InProgress"].includes(t.status) && (
          <button onClick={() => setEdit(true)}>Edit / reassign task</button>
        )}
        {own && t.status === "Open" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => change("start")}
          >
            Start work →
          </button>
        )}
      </section>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Evidence & corrective action</h2>
            <p className="muted">
              Capture time and server receipt are recorded separately.
            </p>
          </div>
          <button onClick={() => act(async () => true)}>
            Refresh upload status
          </button>
        </div>
        <div className="evidence-grid">
          {t.evidence.map((e) => (
            <article key={e.id} className="evidence">
              <div>
                <Badge value={e.state} />
                <strong>
                  {e.kind === "before" ? "Before" : "Completion"} · Cycle{" "}
                  {e.cycle}
                </strong>
              </div>
              {e.state === "Ready" &&
              (me.role === "FM" || e.userId === me.id) ? (
                <a
                  href={"/api/evidence/" + e.id + "/photo"}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={"/api/evidence/" + e.id + "/photo"}
                    alt={`${e.kind} evidence for ${t.title}`}
                  />
                </a>
              ) : (
                <p>{e.error || "Photo restricted or uploading"}</p>
              )}
              <small>
                Captured: {date(e.captureAt)}
                <br />
                Received: {date(e.receivedAt)}
                <br />
                {e.latitude != null
                  ? `GPS: ${e.latitude}, ${e.longitude} ±${Math.round(e.accuracy)} m`
                  : "No GPS recorded"}
              </small>
              {e.state === "Failed" &&
                (me.role === "FM" || e.userId === me.id) && (
                  <button
                    onClick={() =>
                      act(
                        () => api("/evidence/" + e.id + "/retry", "POST"),
                        "Retry queued",
                      )
                    }
                  >
                    Retry upload
                  </button>
                )}
            </article>
          ))}
        </div>
        {!t.evidence.length && <p className="muted">No evidence yet.</p>}
        {own && ["Open", "InProgress"].includes(t.status) && (
          <>
            <Capture
              task={t}
              kind={t.status === "Open" ? "before" : "after"}
              act={act}
            />
            {t.status === "InProgress" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  change("submit", {
                    correctiveAction: action,
                    resolutionNotes: notes,
                  });
                }}
              >
                <Field label="Corrective action taken (required)">
                  <textarea
                    required
                    minLength={10}
                    rows={3}
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    placeholder="Describe what you fixed and how you verified it."
                  />
                </Field>
                <Field label="Resolution notes">
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  Submit for FM approval →
                </button>
              </form>
            )}
          </>
        )}
        {t.correctiveAction && (
          <div className="policy-box">
            <h3>Corrective action</h3>
            <p>{t.correctiveAction}</p>
            <p>{t.resolutionNotes}</p>
          </div>
        )}
      </section>
      {me.role === "FM" && !closed(t) && (
        <section className="card">
          <h2>FM review</h2>
          <p>
            Verify the current-cycle photos, corrective action and location
            before approval.
          </p>
          <Field label="Rejection / cancellation reason">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </Field>
          <div className="row">
            {t.status === "AwaitingApproval" && (
              <>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => change("approve", { version: t.version })}
                >
                  Approve & close
                </button>
                <button
                  disabled={busy || reason.trim().length < 5}
                  onClick={() =>
                    change("reject", { version: t.version, reason })
                  }
                >
                  Request rework
                </button>
              </>
            )}
            <button
              className="danger"
              disabled={busy || reason.trim().length < 5}
              onClick={() => change("cancel", { version: t.version, reason })}
            >
              Cancel task
            </button>
          </div>
        </section>
      )}
      <section className="card">
        <h2>Task history</h2>
        <div className="timeline">
          {t.history.map((h) => (
            <div key={h.id}>
              <strong>{h.action.replaceAll("_", " ")}</strong>
              <small>{date(h.createdAt)}</small>
              {h.details.reason && <p>{h.details.reason}</p>}
              {h.details.correctiveAction && (
                <p>{h.details.correctiveAction}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function Capture({ task, kind, act }) {
  const video = useRef(),
    stream = useRef(),
    pendingUpload = useRef(null),
    [active, setActive] = useState(false),
    [challenge, setChallenge] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  const start = async () => {
    setMessage("");
    await act(async () => {
      const c = await api(`/tasks/${task.id}/capture`, "POST");
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stream.current = s;
      setChallenge(c.id);
      setActive(true);
      setTimeout(() => {
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      }, 50);
    });
  };
  const upload = async (blob, source) => {
    const capturedAt = new Date().toISOString();
    pendingUpload.current = null;
    setBusy(true);
    setMessage("Acquiring location / preparing upload…");
    const result = await act(async () => {
      let gps = null;
      if (task.gpsRequired) {
        if (!navigator.geolocation)
          throw new Error("GPS unavailable on this device");
        gps = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () =>
              reject(
                new Error(
                  "Location permission denied or GPS unavailable. Enable location and try again.",
                ),
              ),
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
          ),
        );
      }
      const fd = new FormData();
      fd.append("photo", blob, "capture.jpg");
      Object.entries({
        kind,
        idempotencyKey: crypto.randomUUID(),
        captureAt: capturedAt,
        source,
        ...(source === "camera" ? { captureId: challenge } : {}),
        ...(gps
          ? {
              latitude: gps.coords.latitude,
              longitude: gps.coords.longitude,
              accuracy: gps.coords.accuracy,
              gpsAt: new Date(gps.timestamp).toISOString(),
            }
          : {}),
      }).forEach(([k, v]) => fd.append(k, v));
      pendingUpload.current = fd;
      return api(`/tasks/${task.id}/evidence`, "POST", fd);
    }, "Photo accepted; Drive upload is queued");
    if (result) pendingUpload.current = null;
    setMessage(
      result
        ? "Photo received. Refresh upload status before submitting."
        : "Upload failed. Retry the same upload below, or capture again if the challenge expired.",
    );
    setBusy(false);
    stream.current?.getTracks().forEach((t) => t.stop());
    setActive(false);
  };
  return (
    <div className="capture">
      <h3>{kind === "before" ? "Before-work photo" : "Completion photo"}</h3>
      <p>
        Fresh capture is checked through a short-lived server challenge. Browser
        GPS and camera claims are not tamper-proof.
      </p>
      {active ? (
        <>
          <video ref={video} muted playsInline />
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const v = video.current;
              if (!v.videoWidth) return;
              const c = document.createElement("canvas");
              c.width = v.videoWidth;
              c.height = v.videoHeight;
              c.getContext("2d").drawImage(v, 0, 0);
              c.toBlob((b) => upload(b, "camera"), "image/jpeg", 0.9);
            }}
          >
            ● Capture & upload
          </button>
        </>
      ) : (
        <button disabled={busy} onClick={start}>
          ▣ Open camera
        </button>
      )}
      {!task.cameraRequired && (
        <Field
          label="Or choose a photo (policy allows gallery)"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) =>
            e.target.files[0] && upload(e.target.files[0], "gallery")
          }
        />
      )}
      {pendingUpload.current && !busy && (
        <button
          onClick={async () => {
            setBusy(true);
            const r = await act(
              () =>
                api(
                  `/tasks/${task.id}/evidence`,
                  "POST",
                  pendingUpload.current,
                ),
              "Upload received",
            );
            if (r) {
              pendingUpload.current = null;
              setMessage(
                "Photo received. Refresh upload status before submitting.",
              );
            }
            setBusy(false);
          }}
        >
          Retry same upload
        </button>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
function Team({ act, revision }) {
  const [users, error] = useData("/users", revision),
    [d, setD] = useState({ name: "", email: "", role: "FOT", password: "" }),
    [resetId, setResetId] = useState(""),
    [resetPassword, setResetPassword] = useState("");
  return (
    <section className="card">
      <h2>Team & access</h2>
      <p className="muted">
        Only active, approved accounts can sign in. Reassign pending work before
        deactivating an owner.
      </p>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            () => api("/users", "POST", d),
            "Team member added",
          );
          if (r) setD({ name: "", email: "", role: "FOT", password: "" });
        }}
      >
        <Field
          label="Full name"
          required
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
        <Field
          label="Work email"
          type="email"
          required
          value={d.email}
          onChange={(e) => setD({ ...d, email: e.target.value })}
        />
        <Field label="Initial password" type="password" minLength={12} maxLength={256}
          required autoComplete="new-password" value={d.password}
          onChange={(e) => setD({ ...d, password: e.target.value })} />
        <Field label="Role">
          <select
            value={d.role}
            onChange={(e) => setD({ ...d, role: e.target.value })}
          >
            <option>FOT</option>
            <option>FM</option>
          </select>
        </Field>
        <button className="primary">Add user</button>
      </form>
      {error && <p className="error">{error}</p>}
      {resetId && (
        <form className="inline-form" onSubmit={async e => {
          e.preventDefault();
          const result = await act(() => api("/users/" + resetId + "/password", "POST", { password: resetPassword }), "Password changed; sessions revoked");
          if (result) { setResetId(""); setResetPassword(""); }
        }}>
          <Field label="New password (minimum 12 characters)" type="password"
            autoComplete="new-password" minLength={12} maxLength={256} required
            value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
          <button className="primary">Save password</button>
          <button type="button" onClick={() => setResetId("")}>Cancel</button>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    aria-label={"Role for " + u.name}
                    value={u.role}
                    onChange={(e) =>
                      act(
                        () =>
                          api("/users/" + u.id, "PATCH", {
                            role: e.target.value,
                          }),
                        "Role updated; existing sessions revoked",
                      )
                    }
                  >
                    <option>FM</option>
                    <option>FOT</option>
                  </select>
                </td>
                <td>
                  <button type="button" onClick={() => { setResetId(u.id); setResetPassword(""); }}>
                    Set password
                  </button>{" "}
                  <button
                    onClick={() =>
                      act(
                        () =>
                          api("/users/" + u.id, "PATCH", { active: !u.active }),
                        "Access updated",
                      )
                    }
                  >
                    {u.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Automation({ act }) {
  const [settings, error] = useData("/settings"),
    [d, setD] = useState(null),
    [jobs] = useData("/jobs");
  useEffect(() => {
    if (settings) setD(settings);
  }, [settings]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <p>Loading settings…</p>;
  return (
    <>
      <section className="card form-card">
        <h2>Automation rules</h2>
        <p>
          Normal: every 24 hours. Urgent / Critical: every 3 hours. Awaiting
          approval reminders go to FM. Assignment and workflow notifications
          bypass quiet hours.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const { id, driveRootId, ...data } = d;
            act(
              () => api("/settings", "PATCH", data),
              "Automation settings saved",
            );
          }}
        >
          <div className="form-grid">
            {[
              ["escalationHours", "Escalate after overdue hours"],
              ["dailySummaryHour", "Daily summary hour (IST)"],
              ["quietStart", "Quiet hours start (IST, optional)"],
              ["quietEnd", "Quiet hours end (IST, optional)"],
              ["evidenceRetentionDays", "Retention review threshold (days)"],
            ].map(([k, l]) => (
              <Field
                key={k}
                label={l}
                type="number"
                value={d[k] ?? ""}
                min={k.includes("Hour") || k.startsWith("quiet") ? 0 : 1}
                onChange={(e) =>
                  setD({
                    ...d,
                    [k]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            ))}
          </div>
          <button className="primary">Save rules</button>
        </form>
        <p className="muted">
          Retention is a review threshold; no evidence is automatically deleted.
        </p>
        <h3>Google Drive</h3>
        <p>
          {d.driveRootId
            ? "Private evidence root configured: " + d.driveRootId
            : "No evidence root configured yet."}
        </p>
        {!d.driveRootId && (
          <button
            onClick={async () => {
              const r = await act(
                () => api("/integrations/drive-root", "POST"),
                "Private root created",
              );
              if (r) setD({ ...d, ...r });
            }}
          >
            Create private evidence folder
          </button>
        )}
      </section>
      <section className="card">
        <h2>Background job health</h2>
        <p className="muted">
          Accepted means the provider accepted a message; it does not confirm
          inbox delivery. Uncertain sends require operator reconciliation.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Type</th>
                <th>State</th>
                <th>Attempts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.id.slice(0, 8)}</td>
                  <td>{j.type}</td>
                  <td>{j.state}</td>
                  <td>{j.attempts}</td>
                  <td>{date(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(1),
    [logs, error] = useData("/audit?page=" + page);
  return (
    <section className="card">
      <h2>Audit trail</h2>
      {error && <p className="error">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((l) => (
              <tr key={l.id}>
                <td>{date(l.createdAt)}</td>
                <td>{l.action}</td>
                <td>{l.actorId?.slice(0, 8) || "System"}</td>
                <td>
                  <details>
                    <summary>View</summary>
                    <pre>{JSON.stringify(l.details, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <button disabled={logs?.length < 100} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </section>
  );
}
function Reports({ act, me }) {
  const [days, setDays] = useState(7),
    [r] = useData("/reports?days=" + days),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Operational report</h2>
            <p className="muted">Live backlog with period-based throughput.</p>
          </div>
          <select
            aria-label="Report period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Daily</option>
            <option value={7}>Weekly</option>
            <option value={30}>Monthly</option>
          </select>
        </div>
        <div className="metrics">
          {[
            ["Created in period", r?.createdInPeriod],
            ["FM approved in period", r?.completedInPeriod],
            ["Pending now", r?.pending],
            ["Overdue now", r?.overdue],
          ].map(([l, n]) => (
            <div className="metric" key={l}>
              <span>{l}</span>
              <strong>{n ?? "—"}</strong>
            </div>
          ))}
        </div>
        <h3>Repeated issue patterns</h3>
        <p className="muted">
          Grouped task counts indicate patterns for review, not confirmed root
          causes.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Floor</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Occurrences</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {r?.recurring.map((x, i) => (
                <tr key={i}>
                  <td>{x.floor}</td>
                  <td>{x.category}</td>
                  <td>{x.owner}</td>
                  <td>{x.count}</td>
                  <td>{x.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {me.role === "FM" && (
        <section className="card">
          <h2>Follow-up assistant</h2>
          <p>
            FM only. Generates a draft from current task records. Never sends,
            approves, or closes work.
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const x = await act(() => api("/ai/follow-up", "POST"));
              if (x) setDraft(x);
              setBusy(false);
            }}
          >
            {busy ? "Preparing…" : "Generate follow-up draft"}
          </button>
          {draft && (
            <div className="policy-box">
              <Badge value={draft.mode} />
              <p className="draft">{draft.text}</p>
              <details>
                <summary>Verify source task data</summary>
                <pre>{JSON.stringify(draft.facts, null, 2)}</pre>
              </details>
            </div>
          )}
        </section>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
