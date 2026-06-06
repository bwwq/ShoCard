#!/usr/bin/env bash
set -Eeuo pipefail

APP_PORT="${APP_PORT:-8080}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
export APP_PORT

usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh              Build and start the app
  ./deploy.sh deploy       Build and start the app
  ./deploy.sh restart      Rebuild and restart the app
  ./deploy.sh stop         Stop the app
  ./deploy.sh logs         Show app logs
  ./deploy.sh status       Show container status

Environment:
  APP_PORT=8080            Host port mapped to container port 4173
  IMAGE_NAME=...           Docker image name
  CONTAINER_NAME=...       Docker container name

Examples:
  APP_PORT=80 ./deploy.sh
  APP_PORT=8088 ./deploy.sh restart
EOF
}

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] error: %s\n' "$*" >&2
  exit 1
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || die "sudo is required when not running as root"
  sudo "$@"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  log "Docker is not installed. Installing Docker packages..."

  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get update
    run_as_root apt-get install -y docker.io
    run_as_root apt-get install -y docker-compose-plugin || run_as_root apt-get install -y docker-compose
  elif command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y docker
    run_as_root dnf install -y docker-compose-plugin || run_as_root dnf install -y docker-compose
  elif command -v yum >/dev/null 2>&1; then
    run_as_root yum install -y docker
    run_as_root yum install -y docker-compose-plugin || run_as_root yum install -y docker-compose
  else
    die "unsupported Linux distro. Install Docker manually, then rerun this script"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable --now docker || true
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
    return
  fi

  run_as_root docker "$@"
}

compose_cmd() {
  if docker_cmd compose version >/dev/null 2>&1; then
    docker_cmd compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    if docker-compose version >/dev/null 2>&1; then
      docker-compose -f "$COMPOSE_FILE" "$@"
    else
      run_as_root docker-compose -f "$COMPOSE_FILE" "$@"
    fi
    return
  fi

  die "Docker Compose is not available"
}

prepare_env() {
  [ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found. Run this script from the project root"

  if [ ! -f "$ENV_FILE" ]; then
    if [ -f .env.example ]; then
      cp .env.example "$ENV_FILE"
    else
      : >"$ENV_FILE"
    fi
    log "created $ENV_FILE"
  fi

  if ! grep -q '^APP_PORT=' "$ENV_FILE"; then
    printf 'APP_PORT=%s\n' "$APP_PORT" >>"$ENV_FILE"
  fi
}

deploy() {
  install_docker
  prepare_env
  log "building and starting container..."
  APP_PORT="$APP_PORT" compose_cmd up -d --build
  log "done"
  log "open http://SERVER_IP:$APP_PORT"
}

case "${1:-deploy}" in
  deploy)
    deploy
    ;;
  restart)
    install_docker
    prepare_env
    APP_PORT="$APP_PORT" compose_cmd up -d --build --force-recreate
    ;;
  stop)
    install_docker
    prepare_env
    compose_cmd down
    ;;
  logs)
    install_docker
    prepare_env
    compose_cmd logs -f
    ;;
  status)
    install_docker
    prepare_env
    compose_cmd ps
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage
    die "unknown command: $1"
    ;;
esac
