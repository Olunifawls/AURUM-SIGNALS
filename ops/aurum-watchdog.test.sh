#!/usr/bin/env bash
# Tests for ops/aurum-watchdog.sh. Local only: nothing here reaches the VPS, the
# public site or Telegram. Run: bash ops/aurum-watchdog.test.sh
#
# `docker` and Telegram are stubbed through PATH. The stub docker still runs the
# script's real node health snippet, against a local server on port 3001, and the
# certificate tests use real TLS. Needs bash, node, python3, openssl; port 3001,
# 18080 and 18443 free. Takes about 40 seconds (one test waits on a 10s timeout).
set -uo pipefail

WATCHDOG="$(cd "$(dirname "$0")" && pwd)/aurum-watchdog.sh"
WD_T=$(mktemp -d)
export WD_T
REAL_CURL=$(command -v curl)
export REAL_CURL
LIVE="$WD_T/state"
DRY_STATE="$WD_T/state.dry-run"
SERVER_PID=""
TLS_PID=""
PASSED=0
FAILED=0
OUT=""
DRY=1

cleanup() {
  local pid
  for pid in "$SERVER_PID" "$TLS_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
    fi
  done
  rm -rf "$WD_T"
}
trap cleanup EXIT

pass() {
  PASSED=$((PASSED + 1))
  echo "  PASS $1"
}
fail() {
  FAILED=$((FAILED + 1))
  echo "  FAIL $1"
  echo "       output: $OUT"
}
has() { if printf '%s' "$OUT" | grep -q -- "$1"; then pass "$2"; else fail "$2"; fi; }
hasnt() { if printf '%s' "$OUT" | grep -q -- "$1"; then fail "$2"; else pass "$2"; fi; }
equals() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (got '$1', wanted '$2')"; fi; }

# Modes for the local server: /health, /api/health, public /login.
serve() { echo "$1,$2,$3" >"$WD_T/mode"; }
fresh() {
  rm -rf "$LIVE" "$DRY_STATE"
  : >"$WD_T/docker.calls"
  : >"$WD_T/telegram.calls"
  : >"$WD_T/logger.calls"
}
restarts() { grep -c 'docker restart' "$WD_T/docker.calls"; }
sent() { grep -c -- "$1" "$WD_T/telegram.calls"; }
logged() { grep -c -- "$1" "$WD_T/logger.calls"; }
wd() {
  OUT=$(env PATH="$WD_T/bin:$PATH" WATCHDOG_DRY_RUN="$DRY" STATE_DIR="$LIVE" \
    ENV_FILE="${EF-$WD_T/env}" PUBLIC_URL="${PU-http://127.0.0.1:18080/login}" \
    CERT_HOST=localhost CERT_PORT="${CP-18443}" BACKEND_CONTAINER=test-c bash "$WATCHDOG" 2>&1)
}
wd_times() {
  local i
  for ((i = 0; i < $1; i++)); do wd; done
}
ago() { echo $(($(date +%s) - $1)); }
tls() {
  if [ -n "$TLS_PID" ]; then
    kill "$TLS_PID" 2>/dev/null
    wait "$TLS_PID" 2>/dev/null
  fi
  openssl s_server -quiet -www -accept 18443 -cert "$WD_T/tls/c$1.pem" -key "$WD_T/tls/k$1.pem" >/dev/null 2>&1 &
  TLS_PID=$!
  sleep 0.5
}

mkdir -p "$WD_T/bin" "$WD_T/tls"
printf 'TELEGRAM_BOT_TOKEN=FAKE-SECRET-TOKEN-123\nTELEGRAM_CHAT_ID=42\n' >"$WD_T/env"
for days in 5 30; do
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WD_T/tls/k$days.pem" \
    -out "$WD_T/tls/c$days.pem" -days "$days" -subj /CN=localhost >/dev/null 2>&1
done

cat >"$WD_T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $1" >>"$WD_T/docker.calls"
case "$1" in
  exec)
    [ -n "${STUB_EXEC_RC:-}" ] && exit "$STUB_EXEC_RC"
    shift 2
    exec "$@"
    ;;
  restart) exit "${STUB_RESTART_RC:-0}" ;;
esac
EOF
cat >"$WD_T/bin/logger" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$WD_T/logger.calls"
EOF
cat >"$WD_T/bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *api.telegram.org*)
    printf '%s\n' "$*" >>"$WD_T/telegram.calls"
    exit "${STUB_TELEGRAM_RC:-0}"
    ;;
esac
exec "$REAL_CURL" "$@"
EOF
if ! command -v timeout >/dev/null; then
  # macOS has no GNU timeout. `timeout -k N SECS cmd...`
  cat >"$WD_T/bin/timeout" <<'EOF'
#!/usr/bin/env perl
splice(@ARGV, 0, 2) if $ARGV[0] eq '-k';
my $seconds = shift @ARGV;
alarm $seconds;
exec @ARGV;
EOF
fi
chmod +x "$WD_T"/bin/*

cat >"$WD_T/server.py" <<'EOF'
import http.server, pathlib, sys, threading, time

mode = pathlib.Path(sys.argv[1])
BODIES = {
    "ok": (200, b'{"status":"ok","ts":"2026-10-30T00:00:00.000Z"}'),
    "nots": (200, b'{"status":"ok"}'),
    "notok": (200, b'{"status":"down","ts":"2026-10-30T00:00:00.000Z"}'),
    "500": (500, b'{"status":"ok","ts":"x"}'),
    "html": (200, b"<html>"),
}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        health, api_health, public = mode.read_text().strip().split(",")
        if self.server.server_port == 18080:
            code = int(public)
            self.send_response(code)
            if code in (301, 302, 307):
                self.send_header("Location", "/x")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        wanted = health if self.path == "/health" else api_health
        if wanted == "hang":
            time.sleep(13)
            return
        code, body = BODIES[wanted]
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body)

for port in (3001, 18080):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
time.sleep(3600)
EOF

serve ok ok 200
python3 "$WD_T/server.py" "$WD_T/mode" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 0.7
tls 30

echo '== 1 backend check'
fresh
wd
has 'backend check OK' 'healthy: 200, status ok, ts'
has 'public check OK' 'public OK at the same time'
has 'certificate check OK' '30-day cert OK'
for mode in nots notok 500 html; do
  fresh
  serve "$mode" ok 200
  wd
  has 'FAILED (1/3)' "unhealthy /health: $mode"
done
fresh
serve 500 ok 200
wd_times 2
hasnt 'would restart' 'no restart at 2 failures'
wd
has 'would restart test-c after 3' 'restart at 3 failures'
has 'would send Telegram.*restarted test-c' 'alert with restart'
equals "$(restarts)" 0 'dry run never calls docker restart'
equals "$(cat "$DRY_STATE/backend.fails")" 0 'counter reset after restart'
fresh
serve 500 ok 200
wd_times 2
serve ok ok 200
wd
equals "$(cat "$DRY_STATE/backend.fails")" 0 'recovery resets the count'
serve 500 ok 200
wd
has 'FAILED (1/3)' 'count restarts from 1 after recovery'
fresh
serve hang ok 200
started=$SECONDS
wd
has 'FAILED (1/3)' "hanging backend fails on the node 10s timeout ($((SECONDS - started))s)"
fresh
mkdir -p "$DRY_STATE"
echo 'x7' >"$DRY_STATE/backend.fails"
serve 500 ok 200
wd
has 'FAILED (1/3)' 'corrupt state reads as 0'
fresh
serve ok ok 200
export STUB_EXEC_RC=1
wd
has 'FAILED (1/3)' 'missing container counts as failure'
unset STUB_EXEC_RC

echo '== 1b uses /health, not /api/health'
for broken in 500 html hang; do
  fresh
  serve ok "$broken" 200
  wd_times 4
  has 'backend check OK' "healthy while /api/health is $broken"
  equals "$(cat "$DRY_STATE/backend.fails")" 0 "no failures counted with /api/health $broken"
done
fresh
serve 500 ok 200
wd
has 'FAILED (1/3)' 'fails when /health fails, even if /api/health is fine'

echo '== 2 public check'
for code in 307 302 500 404; do
  fresh
  serve ok ok "$code"
  wd
  has "HTTP $code" "HTTP $code is a failure"
  has 'would send Telegram.*Backend not restarted' "alert on $code"
done
fresh
serve ok ok 200
PU=https://nonexistent.invalid/login wd
has 'public check FAILED' 'bad host fails'
has 'curl exit 6' 'reports the DNS failure'
fresh
PU=http://127.0.0.1:1/login wd
has 'HTTP 000, curl exit 7' 'connection refused fails'
echo ' -- 3 Oct regression: invalid cert on the public site, healthy backend'
fresh
for _ in 1 2 3 4 5 6; do PU=https://localhost:18443/login wd; done
equals "$(restarts)" 0 '6 runs: zero restarts'
equals "$(cat "$DRY_STATE/backend.fails")" 0 'backend counter untouched'
fresh
PU=https://localhost:18443/login wd
has 'curl exit 60' 'self-signed cert rejected, no -k'
has 'would send Telegram' 'alerts on first failure'
PU=https://localhost:18443/login wd
has 'alert suppressed' 'second failure suppressed'
hasnt 'would send Telegram' 'no second send inside the hour'
ago 3590 >"$DRY_STATE/public.last_alert"
PU=https://localhost:18443/login wd
hasnt 'would send Telegram' 'still suppressed at 59m50s'
ago 3601 >"$DRY_STATE/public.last_alert"
PU=https://localhost:18443/login wd
has 'would send Telegram' 'alerts again after an hour'

echo '== 3 certificate check'
tls 5
fresh
serve ok ok 200
wd
has 'expires within 14 days' '5-day cert alerts'
has 'would send Telegram.*certificate for localhost' 'telegram text'
wd
has 'alert suppressed' 'suppressed the same day'
hasnt 'would send Telegram' 'no repeat the same day'
ago 86390 >"$DRY_STATE/cert.last_alert"
wd
hasnt 'would send Telegram' 'suppressed at 23h59m50s'
ago 86401 >"$DRY_STATE/cert.last_alert"
wd
has 'would send Telegram' 'alerts again after a day'
equals "$(restarts)" 0 'cert check never restarts'
fresh
CP=1 wd
has 'could not read a certificate' 'unreachable port is logged'
hasnt 'would send Telegram' 'unreachable is not an expiry alert'
tls 30
fresh
wd
hasnt 'expires within' '30-day cert does not alert'

echo '== independence'
fresh
serve 500 ok 500
tls 5
wd
has 'FAILED (1/3)' 'backend failing'
has 'public check FAILED' 'public check still ran'
has 'expires within' 'cert check still ran'
serve ok ok 200
tls 30

echo '== live mode (stub docker and Telegram)'
DRY=0
fresh
serve 500 ok 200
wd_times 3
equals "$(restarts)" 1 'docker restart called once at 3 failures'
equals "$(sent 'restarted test-c')" 1 'restart alert sent'
if printf '%s' "$OUT" | grep -q FAKE-SECRET; then fail 'token in output'; else pass 'token absent from output'; fi
fresh
export STUB_RESTART_RC=1
wd_times 3
unset STUB_RESTART_RC
equals "$(sent 'FAILED on')" 1 'failed restart reported as failed'
fresh
serve ok ok 500
export STUB_TELEGRAM_RC=1
wd
unset STUB_TELEGRAM_RC
if [ -s "$LIVE/public.last_alert" ]; then fail 'stamped despite Telegram failure'; else pass 'Telegram failure leaves no throttle stamp'; fi
wd
if [ -s "$LIVE/public.last_alert" ]; then pass 'next run retries and stamps'; else fail 'no retry'; fi
fresh
if EF="$WD_T/nope" wd; then pass 'missing env file exits cleanly'; else fail 'missing env file'; fi
fresh
serve 500 ok 200
wd
DRY=1 wd
equals "$(cat "$LIVE/backend.fails")" 1 'dry run leaves the live counter alone'
if [ -d "$DRY_STATE" ]; then pass 'dry run uses a separate state dir'; else fail 'no separate dir'; fi

echo '== restart cap (live mode)'
fresh
serve 500 ok 200
wd_times 9
equals "$(restarts)" 3 '3 restarts allowed inside 60 minutes'
equals "$(sent 'cap')" 0 'no cap alert yet'
wd_times 3
equals "$(restarts)" 3 '4th restart inside 60 minutes refused'
equals "$(sent 'cap')" 1 'cap alert sent once'
equals "$(logged 'restart cap reached')" 1 'cap is logged'
wd_times 7
equals "$(restarts)" 3 'still refused on later runs'
equals "$(sent 'cap')" 1 'stays quiet: still one cap alert'
equals "$(logged 'restart cap reached')" 8 'later runs log only'
equals "$(sent 'restarted test-c')" 3 'no restart alert for a refused restart'
serve ok ok 200
wd
equals "$(cat "$LIVE/backend.fails")" 0 'recovery during the cap resets the failure count'
serve 500 ok 200
wd_times 3
equals "$(restarts)" 3 'failing again inside the window: still refused'
equals "$(sent 'cap')" 1 'failing again inside the window: no second cap alert'

echo ' -- window boundaries'
now=$(date +%s)
printf '%s\n' $((now - 3590)) $((now - 3589)) $((now - 3588)) >"$LIVE/restarts.log"
wd
equals "$(restarts)" 3 'still refused with the oldest at 59m50s'
printf '%s\n' $((now - 3700)) $((now - 3650)) $((now - 3620)) >"$LIVE/restarts.log"
wd
equals "$(restarts)" 4 'restarts resume once the window clears'
equals "$(sent 'cap')" 1 'resuming sends no cap alert'
equals "$(wc -l <"$LIVE/restarts.log" | tr -d ' ')" 1 'expired entries are pruned'
if [ -e "$LIVE/restart_cap.alerted" ]; then fail 'cap flag left after the window'; else pass 'cap flag cleared with the window'; fi

fresh
serve 500 ok 200
now=$(date +%s)
mkdir -p "$LIVE"
printf '%s\n' $((now - 3700)) $((now - 100)) $((now - 50)) >"$LIVE/restarts.log"
echo 3 >"$LIVE/backend.fails"
wd
equals "$(restarts)" 1 'rolling: one entry aged out allows one restart'
wd_times 3
equals "$(restarts)" 1 'rolling: back at 3 in the window, refused'
equals "$(sent 'cap')" 1 'a new cap episode alerts again'

fresh
serve 500 ok 200
mkdir -p "$LIVE"
printf 'garbage\n\n%s\n' "$(ago 10)" >"$LIVE/restarts.log"
echo 3 >"$LIVE/backend.fails"
wd
equals "$(restarts)" 1 'corrupt restart log lines are ignored'

fresh
serve 500 ok 200
mkdir -p "$LIVE"
printf '%s\n' "$(ago 30)" "$(ago 20)" "$(ago 10)" >"$LIVE/restarts.log"
echo 3 >"$LIVE/backend.fails"
export STUB_TELEGRAM_RC=1
wd
unset STUB_TELEGRAM_RC
wd
equals "$(sent 'cap')" 2 'a failed cap alert is retried'
wd
equals "$(sent 'cap')" 2 'and stops once it is delivered'

fresh
serve 500 ok 200
export STUB_RESTART_RC=1
wd_times 12
unset STUB_RESTART_RC
equals "$(restarts)" 3 'failed restart attempts count toward the cap'

echo '== restart cap (dry run)'
DRY=1
fresh
serve 500 ok 200
wd_times 9
has 'would restart test-c' 'dry run counts toward its own cap'
wd_times 3
has 'restart cap reached' 'dry run reaches the cap'
has 'would send Telegram.*cap' 'dry run reports the cap alert'
equals "$(restarts)" 0 'dry run never calls docker restart'
wd
hasnt 'would send Telegram.*cap' 'dry run stays quiet after the cap alert'
if [ -e "$LIVE/restarts.log" ]; then fail 'dry run wrote the live restart log'; else pass 'dry-run cap state is separate'; fi

echo
echo "RESULT: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
