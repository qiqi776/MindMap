#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="${ROOT_DIR}/tmp/dev"
BACKEND_PID_FILE="${TMP_DIR}/backend.pid"
FRONTEND_PID_FILE="${TMP_DIR}/frontend.pid"
BACKEND_LOG_FILE="${TMP_DIR}/backend.log"
FRONTEND_LOG_FILE="${TMP_DIR}/frontend.log"
BACKEND_URL="http://127.0.0.1:8080/api/v1/graph/11111111-1111-1111-1111-111111111111?depth=1"
FRONTEND_URL="http://127.0.0.1:4173/"

mkdir -p "${TMP_DIR}"

is_running() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  kill -0 "${pid}" >/dev/null 2>&1
}

read_pid() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  cat "${pid_file}"
}

is_healthy() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt=0

  until is_healthy "$url"; do
    attempt=$((attempt + 1))
    if (( attempt >= 40 )); then
      echo "${label} did not become healthy in time" >&2
      return 1
    fi
    sleep 0.5
  done
}

start_backend() {
  local existing_pid=""
  if is_healthy "${BACKEND_URL}"; then
    echo "backend already healthy: ${BACKEND_URL}"
    return 0
  fi

  if existing_pid="$(read_pid "${BACKEND_PID_FILE}" 2>/dev/null)" && ! is_running "${existing_pid}"; then
    rm -f "${BACKEND_PID_FILE}"
  fi

  (
    cd "${ROOT_DIR}"
    nohup env GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOTMPDIR=/tmp go run cmd/server/main.go >"${BACKEND_LOG_FILE}" 2>&1 &
    echo $! >"${BACKEND_PID_FILE}"
  )

  wait_for_http "${BACKEND_URL}" "backend"
  echo "backend started: ${BACKEND_URL}"
}

start_frontend() {
  local existing_pid=""
  if is_healthy "${FRONTEND_URL}"; then
    echo "frontend already healthy: ${FRONTEND_URL}"
    return 0
  fi

  if existing_pid="$(read_pid "${FRONTEND_PID_FILE}" 2>/dev/null)" && ! is_running "${existing_pid}"; then
    rm -f "${FRONTEND_PID_FILE}"
  fi

  (
    cd "${ROOT_DIR}/frontend"
    nohup npm run dev -- --host 127.0.0.1 --port 4173 --strictPort >"${FRONTEND_LOG_FILE}" 2>&1 &
    echo $! >"${FRONTEND_PID_FILE}"
  )

  wait_for_http "${FRONTEND_URL}" "frontend"
  echo "frontend started: ${FRONTEND_URL}"
}

stop_process() {
  local pid_file="$1"
  local label="$2"
  local pid=""

  if ! pid="$(read_pid "${pid_file}" 2>/dev/null)"; then
    echo "${label} not managed by script"
    return 0
  fi

  if ! is_running "${pid}"; then
    rm -f "${pid_file}"
    echo "${label} not running"
    return 0
  fi

  kill "${pid}" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! is_running "${pid}"; then
      rm -f "${pid_file}"
      echo "${label} stopped"
      return 0
    fi
    sleep 0.25
  done

  kill -9 "${pid}" >/dev/null 2>&1 || true
  rm -f "${pid_file}"
  echo "${label} stopped"
}

show_status() {
  local backend_pid=""
  local frontend_pid=""

  if is_healthy "${BACKEND_URL}"; then
    if backend_pid="$(read_pid "${BACKEND_PID_FILE}" 2>/dev/null)" && is_running "${backend_pid}"; then
      echo "backend: running (pid ${backend_pid})"
    else
      echo "backend: running (external)"
    fi
  else
    echo "backend: stopped"
  fi

  if is_healthy "${FRONTEND_URL}"; then
    if frontend_pid="$(read_pid "${FRONTEND_PID_FILE}" 2>/dev/null)" && is_running "${frontend_pid}"; then
      echo "frontend: running (pid ${frontend_pid})"
    else
      echo "frontend: running (external)"
    fi
  else
    echo "frontend: stopped"
  fi
}

show_logs() {
  echo "=== backend log ==="
  [[ -f "${BACKEND_LOG_FILE}" ]] && tail -n 40 "${BACKEND_LOG_FILE}" || echo "no backend log"
  echo
  echo "=== frontend log ==="
  [[ -f "${FRONTEND_LOG_FILE}" ]] && tail -n 40 "${FRONTEND_LOG_FILE}" || echo "no frontend log"
}

command="${1:-up}"
case "${command}" in
  up)
    start_backend
    start_frontend
    ;;
  down)
    stop_process "${FRONTEND_PID_FILE}" "frontend"
    stop_process "${BACKEND_PID_FILE}" "backend"
    ;;
  restart)
    stop_process "${FRONTEND_PID_FILE}" "frontend"
    stop_process "${BACKEND_PID_FILE}" "backend"
    start_backend
    start_frontend
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "usage: $0 [up|down|restart|status|logs]" >&2
    exit 1
    ;;
esac
