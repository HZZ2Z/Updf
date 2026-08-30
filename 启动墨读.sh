#!/usr/bin/env bash

set -uo pipefail

modu_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$modu_root" || exit 1

modu_runtime_supported() {
  local node_path="$1"
  local version major
  version="$("$node_path" --version 2>/dev/null)" || return 1
  version="${version#v}"
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 20 ))
}

modu_activate_runtime_dir() {
  local runtime_dir="$1"
  [[ -x "$runtime_dir/node" && -x "$runtime_dir/npm" ]] || return 1
  modu_runtime_supported "$runtime_dir/node" || return 1
  export PATH="$runtime_dir:$PATH"
}

modu_find_runtime() {
  local node_path npm_path runtime_dir

  node_path="$(command -v node 2>/dev/null || true)"
  npm_path="$(command -v npm 2>/dev/null || true)"
  if [[ -n "$node_path" && -n "$npm_path" ]] && modu_runtime_supported "$node_path"; then
    return 0
  fi

  local -a runtime_dirs=()
  if [[ -n "${HOME:-}" ]]; then
    shopt -s nullglob
    runtime_dirs+=(
      "$HOME"/node-v*-linux-*/bin
      "$HOME"/.nvm/versions/node/*/bin
      "$HOME"/.volta/bin
      "$HOME"/.asdf/shims
      "$HOME"/.local/share/mise/shims
      "$HOME"/.local/bin
    )
    shopt -u nullglob
  fi

  while IFS= read -r runtime_dir; do
    [[ -n "$runtime_dir" ]] || continue
    if modu_activate_runtime_dir "$runtime_dir"; then
      return 0
    fi
  done < <(printf '%s\n' "${runtime_dirs[@]}" | sort -Vr)

  return 1
}

if ! modu_find_runtime; then
  echo "启动失败：没有找到 Node.js 20 或更高版本。"
  echo "启动器已检查系统 PATH、用户目录、NVM、Volta、asdf 和 mise。"
  read -r -p "按回车键关闭…" || true
  exit 1
fi

if [[ "${1:-}" == "--diagnose" ]]; then
  echo "启动器诊断通过"
  echo "Node.js: $(command -v node)"
  echo "npm: $(command -v npm)"
  echo "Node.js 版本: $(node --version)"
  echo "npm 版本: $(npm --version)"
  exit 0
fi

node scripts/start-modu.mjs
modu_status=$?

if [[ $modu_status -ne 0 && $modu_status -ne 130 ]]; then
  echo
  read -r -p "启动未完成，按回车键关闭此窗口…" || true
fi

exit "$modu_status"
