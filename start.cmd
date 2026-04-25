@echo off
echo Starting Bobek Panel...

:: Install backend deps if needed
if not exist "backend\node_modules" (
  echo Installing backend dependencies...
  pushd "%~dp0backend"
  call npm install
  popd
)

:: Install frontend deps if needed
if not exist "frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "%~dp0frontend"
  call npm install
  popd
)

:: Start backend in background
start "Bobek Panel Backend" cmd /k "cd /d %~dp0backend && npm run dev"

:: Short delay then start frontend
timeout /t 2 /nobreak >nul
start "Bobek Panel Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend  -> http://localhost:3001
echo Frontend -> http://localhost:5173
echo.