import { useEffect, useRef, useState } from "react";

const ROUTE_LABELS = {
  "local.build":   { label: "local.build",   cls: "badge-local"  },
  "codex.review":  { label: "codex.review",  cls: "badge-codex"  },
  "remote.worker": { label: "remote.worker", cls: "badge-remote" },
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <button className={`btn-copy${copied ? " copied" : ""}`} onClick={handle}>
      {copied ? "✓ Copied" : "Copy prompt"}
    </button>
  );
}

function ExecuteButton({ onExecute }) {
  return (
    <button className="btn-execute" onClick={onExecute}>
      ▶ Execute
    </button>
  );
}

function Message({ msg, onExecute }) {
  if (msg.role === "exec-start") {
    return (
      <div className="msg msg-exec-start">
        <div className="msg-body" style={{ opacity: 0.7, fontStyle: "italic" }}>{msg.text}</div>
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-header">
          <span className="msg-badge badge-user">You</span>
        </div>
        <div className="msg-body">{msg.text}</div>
      </div>
    );
  }

  if (msg.role === "error") {
    return (
      <div className="msg msg-error">
        <div className="msg-header">
          <span className="msg-badge badge-error">Error</span>
          {msg.route && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              route: {msg.route}
            </span>
          )}
        </div>
        <div className="msg-body">{msg.text}</div>
      </div>
    );
  }

  // role === "result"
  const routeMeta = ROUTE_LABELS[msg.route] ?? { label: msg.route, cls: "badge-user" };
  // Show copy+execute only for prompt-mode results (not after execution)
  const showActions = (msg.route === "local.build" || msg.route === "codex.review") && !msg.executed;

  return (
    <div className="msg msg-result">
      <div className="msg-header">
        <span className={`msg-badge ${routeMeta.cls}`}>{routeMeta.label}</span>
        {msg.reason && <span style={{ fontSize: 11, color: "var(--muted)" }}>{msg.reason}</span>}
        {msg.executed && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>✓ executed</span>}
      </div>

      {msg.target && (
        <div className="msg-target">
          Target: <span>{msg.target}</span>
        </div>
      )}

      {msg.taskId && (
        <div className="msg-target">
          Task: <span>#{msg.taskId}</span>
          {msg.resultPath && <span style={{ marginLeft: 8, opacity: 0.7 }}>{msg.resultPath}</span>}
        </div>
      )}

      <div className="msg-body">{msg.text}</div>

      {showActions && (
        <div className="msg-actions">
          <CopyButton text={msg.text} />
          {onExecute && (
            <ExecuteButton onExecute={() => onExecute(msg.originalPrompt, msg.route)} />
          )}
        </div>
      )}
    </div>
  );
}

export default function ConversationPanel({ messages, loading, onExecute }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="conversation">
      {messages.length === 0 && !loading && (
        <div className="conv-empty">
          <div className="conv-empty-icon">🦦</div>
          <p>Type a prompt below to get started.</p>
        </div>
      )}

      {messages.map(msg => (
        <Message key={msg.id} msg={msg} onExecute={onExecute} />
      ))}

      {loading && (
        <div className="msg msg-loading">
          <div className="msg-body">
            <div className="spinner" />
            Running…
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
