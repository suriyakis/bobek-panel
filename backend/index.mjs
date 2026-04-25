import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BOBEK_DIR   = path.resolve(__dirname, "../../Bobek Folder");
const PROJECTS_DIR = path.resolve(__dirname, "../..");
const PORT        = 3001;

// OpenClaw CLI (.cmd works without PS execution-policy issues)
const OC_CMD = path.join(process.env.APPDATA ?? "", "npm", "openclaw.cmd");

// -- Import Bobek db and shared router ----------------------------------------
const bobek  = await import(pathToFileURL(path.join(BOBEK_DIR, "src/db/index.mjs")).href);
const router = await import(pathToFileURL(path.join(BOBEK_DIR, "src/router.mjs")).href);
const { listTasks, getTask } = bobek;
const { resolveRoute }       = router;

// -- Helpers ------------------------------------------------------------------

function ok(route, reason, data = {})      { return { ok: true,  route, reason, data }; }
function fail(error, route = null, reason = null) { return { ok: false, route, reason, error: String(error) }; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCLIOutput(stdout) {
  const out = { raw: stdout };
  for (const line of stdout.trim().split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * Dispatch an isolated OpenClaw agent run via cron and wait for the result.
 *
 * Uses `openclaw cron add --session isolated` — the documented, supported way
 * to dispatch headless agent runs without touching gateway internals.
 *
 * @param {{ name:string, message:string, tools?:string, timeoutSeconds?:number }} opts
 * @returns {Promise<{summary:string, sessionKey:string, durationMs:number, status:string}>}
 */
async function runIsolatedAgent({ name, message, tools, lightContext = false, timeoutSeconds = 90 }) {
  // Schedule 5 s from now (OpenClaw requires ISO timestamp, not "+Ns")
  const at = new Date(Date.now() + 5_000).toISOString();

  const addArgs = [
    "cron", "add",
    "--name", name,
    "--message", message,
    "--at", at,
    "--session", "isolated",
    "--delete-after-run",
    "--no-deliver",
    "--timeout-seconds", String(timeoutSeconds),
    "--json",
  ];
  if (lightContext) addArgs.push("--light-context");
  if (tools) addArgs.push("--tools", tools);

  // Call cmd.exe directly (shell:false) so Node.js properly quotes each arg.
  // Using shell:true causes cmd.exe to word-split unquoted args.
  const CMD = process.env.ComSpec || "cmd.exe";
  const run = (args, t = 15_000) =>
    execFileAsync(CMD, ["/c", OC_CMD, ...args], { encoding: "utf8", timeout: t });

  const { stdout: addOut } = await run(addArgs);

  let job;
  try { job = JSON.parse(addOut); }
  catch { throw new Error(`cron add returned non-JSON: ${addOut.substring(0, 200)}`); }

  const jobId = job.id;
  if (!jobId) throw new Error("cron add returned no job id");

  // Poll cron runs until the agent finishes.
  // Allow the agent its full timeoutSeconds plus 60s slack for dispatch +
  // result write. Bail out early if `cron runs` itself fails 5 times in a row
  // — that means the gateway is unreachable, not just transient.
  const deadline = Date.now() + (timeoutSeconds + 60) * 1_000;
  let consecutiveFailures = 0;
  let lastPollError = null;
  while (Date.now() < deadline) {
    await sleep(3_000);
    try {
      const { stdout: runsOut } = await run(["cron", "runs", "--id", jobId], 10_000);
      const runs = JSON.parse(runsOut);
      const entry = runs.entries?.[0];
      if (entry?.action === "finished") return entry;
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      lastPollError = e;
      if (consecutiveFailures >= 5) {
        throw new Error(`cron runs failed 5x in a row: ${e.message}`);
      }
    }
  }
  const tail = lastPollError ? ` (last poll error: ${lastPollError.message})` : "";
  throw new Error(`Agent run timed out after ${timeoutSeconds + 60}s${tail}`);
}

/** Snapshot of changed git files in a directory (returns [] if not a git repo). */
async function gitChangedFiles(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git", ["diff", "--name-only", "HEAD"],
      { cwd, encoding: "utf8", timeout: 5_000 }
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch { return []; }
}

// -- Express ------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/projects", (_req, res) => {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    res.json(dirs);
  } catch (e) { res.status(500).json(fail(e.message)); }
});

app.get("/api/tasks", (_req, res) => {
  try { res.json(listTasks()); }
  catch (e) { res.status(500).json(fail(e.message)); }
});

app.get("/api/tasks/:id", (req, res) => {
  try {
    const task = getTask(Number(req.params.id));
    if (!task) return res.status(404).json(fail("not found"));
    res.json(task);
  } catch (e) { res.status(500).json(fail(e.message)); }
});

app.get("/api/route", (req, res) => {
  const prompt = req.query.prompt ?? "";
  if (!prompt) return res.status(400).json(fail("prompt required"));
  res.json(resolveRoute(prompt));
});

// -- POST /api/do -------------------------------------------------------------
//
// Body: { prompt, project?, mode?: "prompt"|"execute", forceRoute? }
//
// forceRoute  — bypass resolveRoute; used by Execute button so a card's route
//               never changes due to action-verb re-classification.
//
// Stable envelope:
//   success => { ok: true,  route, reason, data }
//   failure => { ok: false, route, reason, error }
//
// Route behaviour:
//
//   local.build  prompt  — return prepared prompt text for manual use
//   local.build  execute — dispatch real headless agent via OpenClaw cron;
//                          agent reads/edits files; returns summary + changedFiles
//
//   codex.review prompt  — return prepared prompt text for manual use
//   codex.review execute — dispatch read-only headless agent via OpenClaw cron;
//                          returns structured analysis summary
//
//   remote.worker (any)  — call Bobek CLI → SSH to Hetzner → real worker
//                          (unchanged; already Manus-style)

app.post("/api/do", async (req, res) => {
  const { prompt, project, mode = "prompt", forceRoute } = req.body ?? {};
  if (!prompt) return res.status(400).json(fail("prompt required"));

  const { route, reason } = forceRoute
    ? { route: forceRoute, reason: "client-forced route" }
    : resolveRoute(prompt);

  // ── local.build ────────────────────────────────────────────────────────────
  if (route === "local.build") {
    // Resolve target directory
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

    // Prepared prompt text (for prompt mode — human copy-paste or future use)
    const promptText = [
      `You are inside ${cdTarget}.`,
      `Apply this task directly:`,
      prompt,
      `Do not ask for file names if they can be found in the current project.`,
      `Reply only: DONE\n<how to test>`,
    ].join("\n");

    if (mode !== "execute") {
      return res.json(ok(route, reason, { target: cdTarget, prompt: promptText }));
    }

    // ── execute: real headless agent via OpenClaw cron ──────────────────────
    // Message is task-focused (not the copy-paste template). The agent uses
    // read/write/exec tools to actually apply the fix inside cdTarget.
    // Surface the most relevant files up-front. Score each file by how
    // many prompt keywords appear in its path; return the top 3.
    // This cuts read-tool overhead so the agent can finish within the timeout.
    let fileHint = "";
    try {
      const keywords = (prompt.toLowerCase().match(/\b\w{4,}\b/g) ?? []);
      const allFiles = fs.readdirSync(cdTarget, { recursive: true });
      const scored = allFiles
        .filter(f => typeof f === "string")
        .filter(f => !/node_modules|[\\/]\./.test(f))
        .filter(f => /\.(jsx?|tsx?|mjs|cjs|css)$/.test(f))
        .map(f => ({ f, s: keywords.filter(k => f.toLowerCase().includes(k)).length }))
        .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
        .slice(0, 3)
        .map(({ f }) => path.join(cdTarget, f));
      if (scored.length) fileHint = ` Most relevant files: ${scored.join(", ")}.`;
    } catch { /* not a filesystem target */ }

    const agentMessage = [
      `Working directory: ${cdTarget}.${fileHint}`,
      `Task: ${prompt}.`,
      `Use your read tool on the relevant files, apply the fix with your write tool.`,
      `Reply: DONE and one-line test instruction.`,
    ].join(" ");

    const filesBefore = await gitChangedFiles(cdTarget);

    try {
      // --light-context: faster startup; file paths are explicit in the message.
      // 240s: enough for the agent to finish work + emit the DONE reply.
      const entry = await runIsolatedAgent({
        name: `bobek-lb-${Date.now()}`,
        message: agentMessage,
        tools: "exec,read,write",
        lightContext: true,
        timeoutSeconds: 240,
      });

      const filesAfter   = await gitChangedFiles(cdTarget);
      const changedFiles = filesAfter.filter(f => !filesBefore.includes(f));

      // Classify the run:
      //   succeeded — agent emitted summary, OR wrote files (work done even if
      //               the reply was cut off).
      //   failed    — neither summary nor file changes (true timeout/error).
      const hasSummary = !!entry.summary;
      const hasWork    = changedFiles.length > 0;
      const runStatus  = (hasSummary || hasWork) ? "succeeded" : "failed";

      const summary = entry.summary
        ?? (hasWork
          ? `Agent wrote ${changedFiles.length} file(s) but did not reply within timeout. Inspect changes manually.`
          : `Agent error: ${entry.error ?? "no summary returned"}`);

      return res.json(ok(route, reason, {
        target:      cdTarget,
        runStatus,           // "succeeded" | "failed"
        summary,
        sessionKey:  entry.sessionKey,
        changedFiles,
        durationMs:  entry.durationMs,
      }));
    } catch (err) {
      // Dispatch / poll error — return a clean failed result card (no 500).
      return res.json(ok(route, reason, {
        target:      cdTarget,
        runStatus:   "failed",
        summary:     `Dispatch error: ${err.message}`,
        changedFiles: [],
      }));
    }
  }

  // ── codex.review ───────────────────────────────────────────────────────────
  if (route === "codex.review") {
    const promptText = [
      `You are inside ${BOBEK_DIR}.`,
      `This is a review and analysis task. Do not edit files unless explicitly asked.`,
      `Use your full reasoning. Apply it to the following:`,
      prompt,
      `Provide a structured analysis. Reply when done.`,
    ].join("\n");

    if (mode !== "execute") {
      return res.json(ok(route, reason, { target: BOBEK_DIR, prompt: promptText }));
    }

    // ── execute: read-only headless agent via OpenClaw cron ─────────────────
    const agentMessage = [
      `Working directory: ${BOBEK_DIR}.`,
      `Review task: ${prompt}.`,
      `Use your read tool to analyse the codebase. Do NOT write files.`,
      `Reply with a structured analysis.`,
    ].join(" ");

    try {
      const entry = await runIsolatedAgent({
        name: `bobek-cr-${Date.now()}`,
        message: agentMessage,
        tools: "read",
        lightContext: true,  // review needs less context; faster startup
        timeoutSeconds: 120,
      });

      // Derive runStatus from whether the agent produced a summary.
      // agentStatus (entry.status) is the raw cron status — kept for debugging.
      const runStatus = entry.summary ? "succeeded" : "failed";
      const summary   = entry.summary ?? `Agent error: ${entry.error ?? "no summary returned"}`;

      return res.json(ok(route, reason, {
        target:      BOBEK_DIR,
        runStatus,
        summary,
        sessionKey:  entry.sessionKey,
        durationMs:  entry.durationMs,
        agentStatus: entry.status,   // raw status; kept for diagnostics
      }));
    } catch (err) {
      // Dispatch / poll error — return a clean failed result card (no 500),
      // consistent with local.build error handling.
      return res.json(ok(route, reason, {
        target:      BOBEK_DIR,
        runStatus:   "failed",
        summary:     `Dispatch error: ${err.message}`,
      }));
    }
  }

  // ── remote.worker ──────────────────────────────────────────────────────────
  // Already Manus-style: calls Bobek CLI → SSH to Hetzner → real worker result.
  // Unchanged.
  if (route === "remote.worker") {
    try {
      const { stdout, stderr } = await execFileAsync(
        "node", ["src/cli.mjs", "do", prompt],
        { cwd: BOBEK_DIR, encoding: "utf8", timeout: 90_000 }
      );
      const parsed = parseCLIOutput(stdout);
      return res.json(ok(route, reason, { ...parsed, stderr: stderr || null }));
    } catch (err) {
      return res.status(500).json(fail(err.message, route, reason));
    }
  }

  res.status(400).json(fail(`unknown route: ${route}`, route, null));
});

app.listen(PORT, () => {
  console.log(`\n  Bobek Panel backend  -->  http://localhost:${PORT}\n`);
});
