#!/bin/sh
# Installa la guardia dei dati veri nella cartella COMUNE di git di questo repository: vale per tutti i worktree,
# anche quelli su rami vecchi che non hanno tools/. Va rilanciato quando cambiano guardia.mjs o ammessi.txt:
# la copia installata è quella che decide, e un commit da solo non può allargarla (revisione del 4/11).
set -e
cd "$(git rev-parse --show-toplevel)"
C="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
mkdir -p "$C/guardia-dati-veri" "$C/hooks"
cp tools/guardia-dati-veri/guardia.mjs tools/guardia-dati-veri/ammessi.txt "$C/guardia-dati-veri/"
cp .githooks/pre-push "$C/hooks/pre-push"
chmod 755 "$C/hooks/pre-push"
# core.hooksPath relativo punta ai file del worktree corrente, e negli altri git non esegue niente senza dirlo
git config --unset-all core.hooksPath 2>/dev/null || true
echo "guardia installata in $C (hook pre-push per tutti i worktree)"
