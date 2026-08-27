#!/usr/bin/env sh
#
# Runs the ingestion adapters, one after another, each isolated from the rest.
#
# Why this exists: the adapters used to be chained with `&&` in the Railway
# start command, and the runner exits non-zero when an adapter throws. One
# failing source therefore silently prevented every source behind it from
# running at all — a lagasafn or island.is hiccup meant no EFTA Court cases,
# with nothing in the deploy log obviously pointing at the cause.
#
# So: a failure is recorded and reported, but the remaining adapters still run.
# The script exits non-zero if any adapter failed, so the deploy is still
# marked failed rather than silently green, and /admin/ingestion shows which
# one it was.
#
# Usage:
#   sh scripts/ingest-all.sh                  # every adapter, in order
#   sh scripts/ingest-all.sh efta-court       # just one
#   sh scripts/ingest-all.sh efta-court umbodsmadur
#
# Per-adapter knobs, all overridable as Railway service variables. These are
# read here rather than written inline into the start command, because an
# inline `VAR=x cmd` overrides the service variable and cannot be changed from
# the dashboard.
#
#   ICELANDIC_INGEST_MODE   default "recent"
#   ICELANDIC_MAX_PAGES     default 40
#   EFTA_FETCH_DOCUMENTS    default 1     — see README on eftacourt.int robots.txt
#   EFTA_MAX_CASES          default 1000  — the register is ~461 cases
#   UMBODSMADUR_MAX_CASES   default 600   — full backfill is ~11,455; raise for a one-off
#
set -u

# Order matters on two counts: citations links judgments to the provisions they
# cite, so lagasafn must have run first; and anything slow should come last, so
# a deploy that gets cut short has already done the cheap sources.
DEFAULT_ADAPTERS="icelandic-courts efta-court umbodsmadur lagasafn citations"
ADAPTERS=${*:-$DEFAULT_ADAPTERS}

failed=""

for adapter in $ADAPTERS; do
  echo ""
  echo "=================================================================="
  echo "== $adapter"
  echo "=================================================================="

  case "$adapter" in
    icelandic-courts)
      INGEST_MODE="${ICELANDIC_INGEST_MODE:-recent}" \
      INGEST_MAX_PAGES="${ICELANDIC_MAX_PAGES:-40}" \
        npm run ingest -- --adapter=icelandic-courts
      ;;
    efta-court)
      EFTA_FETCH_DOCUMENTS="${EFTA_FETCH_DOCUMENTS:-1}" \
      INGEST_MAX_CASES="${EFTA_MAX_CASES:-1000}" \
        npm run ingest -- --adapter=efta-court
      ;;
    umbodsmadur)
      INGEST_MAX_CASES="${UMBODSMADUR_MAX_CASES:-600}" \
        npm run ingest -- --adapter=umbodsmadur
      ;;
    *)
      npm run ingest -- --adapter="$adapter"
      ;;
  esac

  status=$?
  if [ "$status" -ne 0 ]; then
    echo "!! $adapter FAILED (exit $status) — continuing with the rest"
    failed="$failed $adapter"
  fi
done

echo ""
echo "=================================================================="
if [ -n "$failed" ]; then
  echo "== Ingestion finished with failures:$failed"
  echo "== See /admin/ingestion for each run's error."
  exit 1
fi
echo "== Ingestion finished: every adapter succeeded."
