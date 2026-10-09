#!/usr/bin/env bash
# The look is dark with glow on purpose, so gradients and soft shadows are allowed.
# What is checked: icon libraries, typefaces, emoji, and a few writing tells.
cd "$(dirname "$0")/.." || exit 1
fail=0
scan() { # label, pattern, paths...
  local label=$1 pat=$2; shift 2
  local hits
  hits=$(grep -rnP --exclude-dir=node_modules --exclude-dir=dist --exclude=ui-lint.sh --exclude=package-lock.json "$pat" "$@" 2>/dev/null)
  if [ -n "$hits" ]; then echo "BANNED ($label):"; echo "$hits" | head -5; fail=1; fi
}
UI="apps/web/src apps/web/index.html apps/web/public"
ALL="apps packages scripts README.md render.yaml"
scan "icon library"   'lucide|feather-icons|heroicons|react-icons'                    $UI apps/web/package.json
scan "typeface"       "\\b(Inter|Roboto|Open Sans)\\b"                                  $UI
scan "emoji"          '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]'                           $ALL
scan "em dash"        '\x{2014}'                                                         $ALL
scan "curly quotes"   '[\x{2018}\x{2019}\x{201C}\x{201D}]'                               $ALL
scan "ai vocabulary"  '\b(delve|leverage|seamless|robust|elevate|unleash|game-changer|cutting-edge)\b' $ALL
[ $fail -eq 0 ] && echo UI_LINT_OK
exit $fail
