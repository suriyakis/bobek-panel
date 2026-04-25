import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const BOBEK_DIR  = path.resolve(__dirname, "../../Bobek Folder");
const PROJECTS_DIR = path.resolve(__dirname, "../..");
const PORT = 3001;

// ── Import Bobek db (DB path is __dirname-relative so safe from any cwd) ──────
const bobek = await import(pathToFileURL(path.join(BOBEK_DIR, "src/db/index.mjs")).href);
const { classifyRoute, listTasks, getTask, createTask } = bobek;

// ── Mirror resolveRoute from cli.mjs ──────────────────────────────────────────
const BUILD_ACTION_VERBS = [
  "implement", "build", "fix", "improve", "add", "edit",
  "change", "update", "create", "make", "write", "generate",
  "apply", "modify", "support", "enable", "integrate"
];

function resolveRoute(prompt) {
  const { route, reason } = classifyRoute(prompt);
  if (route === "codex.review") {
    const lower = prompt.toLowerCase();
    const hit = BUILD_ACTION_VERBS.find(v => new RegExp(`\\b${v}\\b`).test(lower));
    if (hit) return { route: "local.build", reason: `action verb "${hit}" overrides codex.review` };
  }
  return { route, reason };
}

// ── Response helpers ────────────────────────────────────────────────────────

/**
 * Parse the Bobek CLI's KEY: value stdout format into a plain object.
 * e.g.  "ACTION: remote.worker\nTASK_ID: 20\nRESULT_PATH: out\\task-20.json"
 * →     { action: "remote.worker", task_id: "20", result_path: "out\\task-20.json", raw: "..." }
 */
function parseCLIOutput(stdout) {
  const out = { raw: stdout };
  for (const line of stdout.trim().split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Stable success envelope */
function ok(route, reason, data = {}) {
  return { ok: true, route, reason, data };
}

/** Stable error envelope */
function fail(error, route = null, reason = null) {
  return { ok: false, route, reason, error: String(error) };
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// GET /api/projects — list folders under C:\AIProjects
app.get("/api/projects", (_req, res) => {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    res.json(dirs);
  } catch (e) {
    res.status(500).json(fail(e.message));
  }
});

// GET /api/tasks — live task list from Bobek DB
app.get("/api/tasks", (_req, res) => {
  try {
    res.json(listTasks());
  } catch (e) {
    res.status(500).json(fail(e.message));
  }
});

// GET /api/tasks/:id
app.get("/api/tasks/:id", (req, res) => {
  try {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json(fail("not found"));
    res.json(task);
  } catch (e) {
    res.status(500).json(fail(e.message));
  }
});

// GET /api/route?prompt=... — classify without executing
app.get("/api/route", (req, res) => {
  const prompt = req.query.prompt ?? "";
  if (!prompt) return res.status(400).json(fail("prompt required"));
  res.json(resolveRoute(prompt));
});

// POST /api/do — main action endpoint
//
// Body:  { prompt: string, project?: string, mode?: "prompt" | "execute" }
//   mode="prompt"  (default) → return prepared prompt text; caller pastes into agent
//   mode="execute" → for codex.review, actually spawn the CLI (same as remote.worker)
//
// All responses use the stable envelope:
//   success → { ok: true,  route, reason, data: { ... } }
//   failure → { ok: false, route, reason, error: string }
app.post("/api/do", async (req, res) => {
  const { prompt, project, mode = "prompt" } = req.body ?? {};
  if (!prompt) return res.status(400).json(fail("prompt required"));

  const { route, reason } = resolveRoute(prompt);

  // ── local.build: generate prompt for the user to paste into their agent ──────
  if (route === "local.build") {
    const atMatch = prompt.match(/\bat\s+(.+)$/i);
    let targetPath = null;
    if (atMatch) {
      const candidate = atMatch[1].trim().replace(/^["']|["']$/g, "");
      if (fs.existsSync(candidate)) targetPath = candidate;
    }
    if (!targetPath && project) {
      const p = path.join(PROJECTS_DIR, project);
      if (fs.existsSync(p)) targetPath = p;
    }
    const cdTarget = targetPath ?? BOBEK_DIR;

    const promptText = [
      `You are inside ${cdTarget}.`,
      `Apply this task directly:`,
      prompt,
      `Do not ask for file names if they can be found in the current project.`,
      `Reply only: DONE\n<how to test>`
    ].join("\n");

    return res.json(ok(route, reason, { target: cdTarget, prompt: promptText }));
  }

  // ── codex.review ─────────────────────────────────────────────────────────────
  //   mode="prompt"  → return prompt text for manual pasting (default)
  //   mode="execute" → spawn CLI immediately (enables future automation)
  if (route === "codex.review") {
    const promptText = [
      `You are inside ${BOBEK_DIR}.`,
      `This is a review and analysis task. Do not edit files unless explicitly asked.`,
      `Use your full reasoning. Apply it to the following:`,
      prompt,
      `Provide a structured analysis. Reply when done.`
    ].join("\n");

    if (mode !== "execute") {
      return res.json(ok(route, reason, { target: BOBEK_DIR, prompt: promptText }));
    }

    // execute mode: spawn CLI with review prompt (same path as remote.worker)
    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        ["src/cli.mjs", "do", promptText],
        { cwd: BOBEK_DIR, encoding: "utf8", timeout: 120_000 }
      );
      const parsed = parseCLIOutput(stdout);
      return res.json(ok(route, reason, { ...parsed, stderr: stderr || null }));
    } catch (err) {
      return res.status(500).json(fail(err.message, route, reason));
    }
  }

  // ── remote.worker: shell out to CLI, parse structured stdout ─────────────────
  if (route === "remote.worker") {
    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        ["src/cli.mjs", "do", prompt],
        { cwd: BOBEK_DIR, encoding: "utf8", timeout: 90_000 }
      );
      // Parse "ACTION: ...\nTASK_ID: ...\nRESULT_PATH: ..." into object
      const parsed = parseCLIOutput(stdout);
      return res.json(ok(route, reason, { ...parsed, stderr: stderr || null }));
    } catch (err) {
      return res.status(500).json(fail(err.message, route, reason));
    }
  }

  res.status(400).json(fail(`unknown route: ${route}`, route, null));
});

app.listen(PORT, () => {
  console.log(`\n  🦦 Bobek Panel backend  →  http://localhost:${PORT}\n`);
});
