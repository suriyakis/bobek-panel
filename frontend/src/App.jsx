import { useState, useEffect } from "react";
import ProjectSelector from "./components/ProjectSelector.jsx";
import ConversationPanel from "./components/ConversationPanel.jsx";
import PromptInput from "./components/PromptInput.jsx";
import TaskPanel from "./components/TaskPanel.jsx";

export default function App() {
  const [projects, setProjects]               = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [messages, setMessages]               = useState([]);
  const [tasks, setTasks]                     = useState([]);
  const [loading, setLoading]                 = useState(false);

  // Load project list once
  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.json())
      .then(data => {
        // Guard against non-array response (e.g. backend error object)
        if (!Array.isArray(data)) return;
        setProjects(data);
        if (data.length > 0) setSelectedProject(data[0]);
      })
      .catch(console.error);
  }, []);

  // Poll tasks every 3 s
  useEffect(() => {
    const poll = () =>
      fetch("/api/tasks")
        .then(r => r.json())
        // Guard against non-array response before passing to TaskPanel
        .then(data => Array.isArray(data) && setTasks(data))
        .catch(console.error);
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // mode: "prompt" (default) | "execute"
  // forceRoute: when set, backend skips resolveRoute and uses this route as-is.
  //   Always pass forceRoute when re-submitting an existing card (Execute button)
  //   so the route never changes due to action-verb re-classification.
  const sendPrompt = async (text, mode = "prompt", forceRoute = null) => {
    if (!text.trim() || loading) return;

    // Only add a user message bubble for fresh prompts, not re-executions
    if (mode === "prompt") {
      const userMsg = { id: Date.now(), role: "user", text };
      setMessages(prev => [...prev, userMsg]);
    } else {
      // For execute, add a small "▶ Executing…" marker so the user knows it started
      setMessages(prev => [
        ...prev,
        { id: Date.now(), role: "exec-start", text: `▶ Executing: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}` }
      ]);
    }
    setLoading(true);

    try {
      const res = await fetch("/api/do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          project: selectedProject,
          mode,
          ...(forceRoute ? { forceRoute } : {})
        })
      });

      // Always parse as JSON; backend guarantees valid JSON on all paths
      let envelope;
      try {
        envelope = await res.json();
      } catch {
        // Extremely unlikely — backend returned non-JSON (e.g. process crash)
        setMessages(prev => [
          ...prev,
          {
            id:   Date.now() + 1,
            role: "error",
            text: `Server returned non-JSON (HTTP ${res.status})`
          }
        ]);
        setLoading(false);
        return;
      }

      // Stable envelope: { ok, route, reason, data } or { ok: false, error }
      if (envelope.ok === false || !res.ok) {
        setMessages(prev => [
          ...prev,
          {
            id:    Date.now() + 1,
            role:  "error",
            route: envelope.route ?? null,
            text:  envelope.error ?? `HTTP ${res.status}`
          }
        ]);
      } else {
        const inner = envelope.data ?? {};
        // inner.reply  → local.build execute: agent reply text (preferred)
        // Priority: agent summary (execute result) > prompt text (prompt mode)
        //           > task dispatch > raw CLI output
        const displayText =
          inner.summary ??
          inner.prompt ??
          (inner.task_id
            ? `Task #${inner.task_id} dispatched${inner.result_path ? ` → ${inner.result_path}` : ""}`
            : null) ??
          (typeof inner.raw === "string" ? inner.raw : inner.raw ? JSON.stringify(inner.raw, null, 2) : null) ??
          "No output";

        setMessages(prev => [
          ...prev,
          {
            id:             Date.now() + 1,
            role:           "result",
            route:          envelope.route,
            reason:         envelope.reason,
            target:         inner.target ?? null,
            taskId:         inner.task_id ?? null,
            resultPath:     inner.result_path ?? null,
            changedFiles:   inner.changedFiles ?? [],
            durationMs:     inner.durationMs ?? null,
            runStatus:      inner.runStatus ?? null,
            text:           displayText,
            originalPrompt: text,
            executed:       mode === "execute"
          }
        ]);
      }

      // Immediate task refresh after action — guard against non-array response
      fetch("/api/tasks")
        .then(r => r.json())
        .then(data => Array.isArray(data) && setTasks(data))
        .catch(() => {});
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { id: Date.now() + 1, role: "error", text: err.message ?? "Unknown error" }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">🦦</span>
        <span className="app-title">Bobek Panel</span>
        <span className="app-subtitle">Local Control Interface</span>
      </header>

      <main className="app-main">
        <ProjectSelector
          projects={projects}
          selected={selectedProject}
          onSelect={setSelectedProject}
        />

        <div className="center-column">
          <ConversationPanel
            messages={messages}
            loading={loading}
            onExecute={(originalPrompt, route) => sendPrompt(originalPrompt, "execute", route)}
          />
          <PromptInput onSend={sendPrompt} disabled={loading} />
        </div>

        <TaskPanel tasks={tasks} />
      </main>
    </div>
  );
}
