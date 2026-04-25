export default function ProjectSelector({ projects, selected, onSelect }) {
  return (
    <aside className="sidebar sidebar-left">
      <div className="sidebar-header">Projects</div>
      <div className="sidebar-scroll">
        {projects.map(p => (
          <button
            key={p}
            className={`project-item${p === selected ? " active" : ""}`}
            onClick={() => onSelect(p)}
            title={p}
          >
            {p}
          </button>
        ))}
        {projects.length === 0 && (
          <div style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 12 }}>
            Loading…
          </div>
        )}
      </div>
    </aside>
  );
}
