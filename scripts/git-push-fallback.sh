#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<EOF
Usage:
  scripts/git-push-fallback.sh [options] [-- <git-push-args...>]

Options:
  -r, --remote <name>     Git remote name (default: origin)
  -b, --branch <name>     Branch to push when no extra git-push args given (default: current branch)
      --force-fallback    Skip first HTTPS push and switch push URL to ssh.github.com:443 directly
  -h, --help              Show help

Examples:
  scripts/git-push-fallback.sh
  scripts/git-push-fallback.sh -r origin -b main
  scripts/git-push-fallback.sh -- --tags
  scripts/git-push-fallback.sh --force-fallback
EOF
}

ensure_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "[push-fallback] Not inside a git repository" >&2
    exit 2
  }
}


ensure_ssh_known_host() {
  local ssh_dir="$HOME/.ssh"
  local known_hosts="$ssh_dir/known_hosts"
  mkdir -p "$ssh_dir"
  chmod 700 "$ssh_dir"
  touch "$known_hosts"
  chmod 600 "$known_hosts"

  if ! ssh-keygen -F "[ssh.github.com]:443" -f "$known_hosts" >/dev/null 2>&1; then
    if command -v ssh-keyscan >/dev/null 2>&1; then
      ssh-keyscan -p 443 ssh.github.com >> "$known_hosts" 2>/dev/null || true
    fi
  fi
}

normalize_github_ssh443_url() {
  local url="$1"
  local path=""

  if [[ "$url" =~ ^https?://github\.com/(.+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  elif [[ "$url" =~ ^git@github\.com:(.+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  elif [[ "$url" =~ ^ssh://git@github\.com/(.+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  elif [[ "$url" =~ ^ssh://git@ssh\.github\.com:443/(.+)$ ]]; then
    path="${BASH_REMATCH[1]}"
  else
    return 1
  fi

  path="${path#/}"
  path="${path%.git}"
  [[ -n "$path" ]] || return 1

  printf "ssh://git@ssh.github.com:443/%s.git\n" "$path"
}

remote="origin"
branch="$(git rev-parse --abbrev-ref HEAD)"
force_fallback=0
extra_args=()

while (($#)); do
  case "$1" in
    -r|--remote)
      remote="${2:-}"
      shift 2
      ;;
    -b|--branch)
      branch="${2:-}"
      shift 2
      ;;
    --force-fallback)
      force_fallback=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    --)
      shift
      extra_args+=("$@")
      break
      ;;
    *)
      extra_args+=("$1")
      shift
      ;;
  esac
done

ensure_git_repo

current_push_url="$(git remote get-url --push "$remote" 2>/dev/null || true)"
if [[ -z "$current_push_url" ]]; then
  echo "[push-fallback] Remote $remote not found" >&2
  exit 2
fi

push_refspec=("$branch")
if ((${#extra_args[@]} > 0)); then
  push_refspec=("${extra_args[@]}")
fi

run_push() {
  git push "$remote" "${push_refspec[@]}"
}

switch_push_url_to_ssh443() {
  local source_url="$1"
  local ssh_url
  ssh_url="$(normalize_github_ssh443_url "$source_url")" || {
    echo "[push-fallback] Cannot convert remote URL to ssh:443 format: $source_url" >&2
    return 1
  }

  if [[ "$source_url" == "$ssh_url" ]]; then
    echo "[push-fallback] Push URL already using ssh.github.com:443"
    return 0
  fi

  ensure_ssh_known_host
  git remote set-url --push "$remote" "$ssh_url"
  echo "[push-fallback] Switched push URL:"
  echo "  from: $source_url"
  echo "    to: $ssh_url"
}

if (( force_fallback == 0 )); then
  if run_push; then
    echo "[push-fallback] Push succeeded via current push URL"
    exit 0
  fi

  echo "[push-fallback] HTTPS push failed, switching push URL to ssh.github.com:443 and retrying..."
else
  echo "[push-fallback] force-fallback enabled, switching push URL before first push"
fi

switch_push_url_to_ssh443 "$current_push_url"
if run_push; then
  echo "[push-fallback] Push succeeded via ssh.github.com:443"
  exit 0
fi

echo "[push-fallback] SSH fallback push failed; restoring original push URL"
git remote set-url --push "$remote" "$current_push_url" || true

echo "[push-fallback] Restored push URL to: $current_push_url"
echo "[push-fallback] Hint: run 'ssh -T -p 443 git@ssh.github.com' and ensure SSH key is authorized in GitHub"
exit 1
