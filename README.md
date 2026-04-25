# Bobek Panel

Local web control panel for Bobek — replaces the Command Prompt/TUI as the primary interface.

## Stack

| Layer    | Tech              | Port  |
|----------|-------------------|-------|
| Backend  | Node 24 + Express | 3001  |
| Frontend | React 18 + Vite   | 5173  |

## Quick start

```
start.cmd
```

Opens both servers in separate terminals. Then open **http://localhost:5173**.

## Manual start

```cmd
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## What it does

| Panel       | Purpose                                          |
|-------------|--------------------------------------------------|
| Projects    | Lists folders under `C:\AIProjects` — sets context for prompts |
| Conversation | Send prompts, see route + generated text         |
| Tasks       | Live view of Bobek's task DB (polls every 3 s)   |

## Routes

| Route           | Behaviour                                                    |
|-----------------|--------------------------------------------------------------|
| `local.build`   | Returns generated prompt text + Copy button                  |
| `codex.review`  | Returns review prompt text + Copy button                     |
| `remote.worker` | Shells out to Bobek CLI, streams stdout back                 |

## API

```
GET  /api/projects          → string[]
GET  /api/tasks             → Task[]
GET  /api/tasks/:id         → Task
GET  /api/route?prompt=...  → { route, reason }
POST /api/do                → { route, target?, prompt?, output?, error? }
  body: { prompt: string, project?: string }
```

## Requirements

- Node 24+ (uses `node:sqlite` DatabaseSync)
- Bobek Folder must be at `C:\AIProjects\Bobek Folder`
