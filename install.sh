#!/bin/bash
set -e

echo "Installing fixit..."

INSTALL_DIR="${FIXIT_HOME:-$HOME/.local/share/fixit}"
BIN_DIR="${FIXIT_BIN:-$HOME/.local/bin}"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Clone or download
if command -v git &>/dev/null; then
  git clone https://github.com/puffachu/fixit.git "$INSTALL_DIR" 2>/dev/null || {
    echo "Repo already exists, pulling latest..."
    cd "$INSTALL_DIR" && git pull
  }
else
  echo "git is required for install"
  exit 1
fi

# Make CLI executable
chmod +x "$INSTALL_DIR/bin/cli.js"

# Symlink
ln -sf "$INSTALL_DIR/bin/cli.js" "$BIN_DIR/fixit"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Adding $BIN_DIR to PATH..."
  for rc in ~/.bashrc ~/.zshrc; do
    [[ -f "$rc" ]] && echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$rc"
  done
fi

# Detect shell and add hook
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  bash)
    HOOK_FILE="$INSTALL_DIR/shell/fixit.bash"
    RC_FILE="$HOME/.bashrc"
    ;;
  zsh)
    HOOK_FILE="$INSTALL_DIR/shell/fixit.zsh"
    RC_FILE="$HOME/.zshrc"
    ;;
  fish)
    HOOK_FILE="$INSTALL_DIR/shell/fixit.fish"
    RC_FILE="$HOME/.config/fish/config.fish"
    ;;
  *)
    echo "Unknown shell: $SHELL_NAME — source the hook from $INSTALL_DIR/shell/ manually"
    exit 0
    ;;
esac

# fish keeps its config under ~/.config/fish, which may not exist yet.
mkdir -p "$(dirname "$RC_FILE")"

if ! grep -q "fixit" "$RC_FILE" 2>/dev/null; then
  echo "" >> "$RC_FILE"
  echo "# fixit — terminal error fixer" >> "$RC_FILE"
  echo "source $HOOK_FILE" >> "$RC_FILE"
  echo "Hook added to $RC_FILE"
fi

echo ""
echo "✓ fixit installed"
echo "  Restart your terminal or run: source $RC_FILE"
