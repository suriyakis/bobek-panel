function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function TaskItem({ task }) {
  const statusCls = `task-status status-${task.status}`;
  const when = formatDate(task.started_at ?? task.created_at);

  return (
    <div className="task-item">
      <div className="task-row">
        <span className="task-type">#{task.id} {task.type}</span>
        <span className={statusCls}>{task.status}</span>
      </div>
      <div className="task-meta">
        {task.target_host && <span>{task.target_host}</span>}
        {when && <span> · {when}</span>}
      </div>
      {task.error && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 2, wordBreak: "break-word" }}>
          {task.error}
        </div>
      )}
    </div>
  );
}

// tasks defaults to [] so the component never crashes on an undefined prop
export default function TaskPanel({ tasks = [] }) {
  // Most recent first
  const sorted = [...tasks].sort((a, b) => b.id - a.id);

  return (
    <aside className="sidebar sidebar-right">
      <div className="sidebar-header">
        Tasks {tasks.length > 0 && `(${tasks.length})`}
      </div>
      <div className="sidebar-scroll">
        {sorted.length === 0 && (
          <div className="task-empty">No tasks yet.</div>
        )}
        {sorted.map(t => (
          <TaskItem key={t.id} task={t} />
        ))}
      </div>
    </aside>
  );
}
