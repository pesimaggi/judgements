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
#   sh scripts/ingest-all.sh icelandic-gaps   # finish the Icelandic archive
#   sh scripts/ingest-all.sh stjornarradid-backfill   # carry the boards forward
#   sh scripts/ingest-all.sh stjornarradid-priority   # the board being rushed
#   sh scripts/ingest-all.sh efta-court umbodsmadur
#
# On Railway there is no shell to type any of that into: a service runs its
# start command and nothing else. So the same selection can be made with the
# INGEST_ADAPTERS variable, which the dashboard can set without a code change:
#
#   INGEST_ADAPTERS="stjornarradid-priority"  # only the board being rushed
#   INGEST_ADAPTERS="icelandic-gaps"          # one-off, finish the archive
#   INGEST_ADAPTERS="icelandic-retry"         # just re-attempt known gaps
#   INGEST_ADAPTERS="logretta ulfljotur"      # just the new sources
#   (unset)                                   # every adapter, in order
#
# Command-line arguments win over the variable, so a local run can still
# override whatever the service has set.
#
# Per-adapter knobs, all overridable as Railway service variables. These are
# read here rather than written inline into the start command, because an
# inline `VAR=x cmd` overrides the service variable and cannot be changed from
# the dashboard.
#
#   ICELANDIC_INGEST_MODE   default "recent"
#   ICELANDIC_MAX_PAGES     default 40
#   ICELANDIC_GAP_PAGES     default 600   — list pages the rolling gap sweep
#                                           may walk per run; "0" for no limit
#                                           (a full ~4,300-page sweep)
#   ICELANDIC_RETRY_CASES   default 500   — cases the retry sweep re-attempts
#   EFTA_FETCH_DOCUMENTS    default 1     — see README on eftacourt.int robots.txt
#   EFTA_MAX_CASES          default 1000  — the register is ~461 cases
#   UMBODSMADUR_MAX_CASES   default 600   — full backfill is ~11,455; raise for a one-off
#   FELAGSDOMUR_MAX_CASES   default 400   — the court publishes 306 across its two
#                                           sites; one run seeds the lot, and a
#                                           quiet run fetches none
#   UUA_MAX_CASES           default 400   — rulings uua.is may be asked for per run;
#                                           the archive is ~3,000, so a fresh
#                                           database fills over about eight runs
#   UUA_RETRY               default 200   — rulings the retry sweep re-attempts
#   OBYGGDANEFND_MAX_CASES  default 12    — þjóðlendu úrskurðir per run. Small on
#                                           purpose: each is a 1-5 MB PDF of
#                                           several hundred pages
#   STJORNARRADID_CASES     default 400   — cases the incremental pass may fetch per run
#   STJORNARRADID_BACKFILL  default 900   — cases the rolling backfill may fetch per
#                                           run, shared across all 40 boards in list
#                                           order; the priority pass below has its own
#   STJORNARRADID_PRIORITY  default "kaerunefnd-husamala" — board key(s), comma
#                                           separated, backfilled ahead of the rest;
#                                           set empty to drop the priority pass
#   STJORNARRADID_PRIORITY_CASES  default 1200 — cases that pass may fetch per run
#   STJORNARRADID_RETRY     default 300   — cases the retry sweep re-attempts
#   STJORNARRADID_BOARDS    unset         — comma-separated board keys; all 40 by default
#   LOGRETTA_FETCH_PDFS     unset         — see README on the Prismic CDN's robots.txt
#
set -u

# Order matters on three counts: citations links judgments to the provisions
# they cite, so lagasafn must have run first; anything slow should come last, so
# a deploy that gets cut short has already done the cheap sources; and the
# priority board comes first, ahead of even the cheap sources, because being
# first is the whole point of it — a run cut short must not be a run where the
# board somebody is waiting on got nothing.
#
# icelandic-retry and icelandic-gaps are in the default chain deliberately.
# Completeness used to depend on someone remembering to set INGEST_ADAPTERS by
# hand, which is why Endurupptökudómur sat at 2 of 102 cases: the sweep that
# would have found the other 100 was opt-in and nobody opted in. A source that
# only closes its gaps when prompted does not close them.
DEFAULT_ADAPTERS="stjornarradid-priority icelandic-courts icelandic-retry icelandic-gaps felagsdomur felagsdomur-retry efta-court umbodsmadur uua uua-retry obyggdanefnd stjornarradid stjornarradid-retry stjornarradid-backfill logretta ulfljotur lagasafn citations"
ADAPTERS=${*:-${INGEST_ADAPTERS:-$DEFAULT_ADAPTERS}}

echo "Running adapters: $ADAPTERS"

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
    icelandic-retry)
      # Not a separate adapter: the Icelandic one working its gap ledger. Every
      # case we know exists but could not store has a row in IngestGap, so this
      # needs no listing at all — one detail fetch per outstanding case. Cheap
      # enough to run every time, and it is what actually recovers a case lost
      # to a one-off 503 rather than leaving it missing forever.
      INGEST_MODE=retry \
      INGEST_MAX_CASES="${ICELANDIC_RETRY_CASES:-500}" \
        npm run ingest -- --adapter=icelandic-courts
      ;;
    icelandic-gaps)
      # Not a separate adapter: the Icelandic one in gap mode, which walks the
      # feed court by court and fetches only what is missing. The scheduled
      # `recent` sweep stops after a run of already-known cases, so it can
      # never reach back to an older gap; this is what does.
      #
      # Bounded by default and resumable — each court keeps its own cursor, so
      # successive runs carry the sweep forward instead of re-walking page 1,
      # and a court that reaches the end wraps around to re-verify. Set
      # ICELANDIC_GAP_PAGES=0 for an unbounded one-off pass.
      gap_pages="${ICELANDIC_GAP_PAGES:-600}"
      if [ "$gap_pages" = "0" ]; then
        INGEST_MODE=gaps npm run ingest -- --adapter=icelandic-courts
      else
        INGEST_MODE=gaps \
        INGEST_MAX_PAGES="$gap_pages" \
          npm run ingest -- --adapter=icelandic-courts
      fi
      ;;
    felagsdomur)
      # The labour court, both halves of it: felagsdomur.is from case year 2010
      # and stjornarradid.is before that. 306 cases in all, so there is no
      # backfill mode to schedule separately: every run walks both listings in
      # full (eleven fetches) and fetches only what is missing, which on a
      # quiet run is nothing at all. The default budget is above the size of
      # the archive on purpose — a fresh database is seeded by one run.
      INGEST_MAX_CASES="${FELAGSDOMUR_MAX_CASES:-400}" \
        npm run ingest -- --adapter=felagsdomur
      ;;
    felagsdomur-retry)
      # The gap ledger and nothing else, as for the other sources. Costs one
      # request per outstanding case and nothing when there are none.
      INGEST_MODE=retry \
        npm run ingest -- --adapter=felagsdomur
      ;;
    umbodsmadur)
      INGEST_MAX_CASES="${UMBODSMADUR_MAX_CASES:-600}" \
        npm run ingest -- --adapter=umbodsmadur
      ;;
    uua)
      # Úrskurðarnefnd umhverfis- og auðlindamála, which publishes on its own
      # site rather than through stjornarradid.is. ~3,000 rulings, so it is
      # bounded like the other archives — but it needs no cursor and no
      # separate backfill pass: its whole index is one page, so every run sees
      # the entire archive, diffs it against what is stored and spends its
      # budget on the oldest thing missing. A quiet run is one index fetch.
      INGEST_MAX_CASES="${UUA_MAX_CASES:-400}" \
        npm run ingest -- --adapter=uua
      ;;
    uua-retry)
      # The gap ledger and nothing else, as for the other sources.
      INGEST_MODE=retry \
      INGEST_MAX_CASES="${UUA_RETRY:-200}" \
        npm run ingest -- --adapter=uua
      ;;
    obyggdanefnd)
      # Óbyggðanefnd's þjóðlendu úrskurðir, on its own site. Only 84 of them,
      # but each is a PDF of several hundred pages, so the budget is small and
      # a full backfill takes a handful of runs. No retry pass is scheduled:
      # its only outstanding gaps are the 2000-01 rulings whose PDFs carry no
      # usable text at all, and re-fetching 2.6 MB apiece to fail again every
      # three hours would be waste. Run it by hand if that ever changes.
      INGEST_MAX_CASES="${OBYGGDANEFND_MAX_CASES:-12}" \
        npm run ingest -- --adapter=obyggdanefnd
      ;;
    stjornarradid)
      # The scheduled pickup: each of the 40 boards' newest pages, stopping
      # once a run of already-stored rulings appears. A firing with nothing new
      # is 40 list queries and no detail fetches at all.
      INGEST_MODE=recent \
      INGEST_MAX_CASES="${STJORNARRADID_CASES:-400}" \
        npm run ingest -- --adapter=stjornarradid
      ;;
    stjornarradid-retry)
      # The gap ledger and nothing else — one fetch per ruling we know exists
      # but could not store. Cheap, and it is what recovers a case lost to a
      # one-off 5xx rather than leaving it missing for good.
      INGEST_MODE=retry \
      INGEST_MAX_CASES="${STJORNARRADID_RETRY:-300}" \
        npm run ingest -- --adapter=stjornarradid
      ;;
    stjornarradid-priority)
      # One board pulled to the front of the queue. The rolling backfill below
      # walks ADR_BOARDS in order and shares one case budget across all 40, so
      # a board partway down the list gets nothing until the ones above it are
      # complete: Kærunefnd húsamála (2,013 cases) sits behind Kærunefnd
      # útlendingamála (4,846) and Almannatryggingar (3,453), i.e. days of
      # firings before its first case would be fetched. This pass gives it its
      # own budget, ahead of everything else, so it finishes in a handful of
      # runs instead.
      #
      # It shares the per-board cursor with the rolling backfill, so nothing is
      # re-walked and the board keeps its progress when the pass is dropped.
      # Set STJORNARRADID_PRIORITY empty (from the Railway dashboard, no code
      # change) once the board is complete — and consider restoring
      # STJORNARRADID_BACKFILL to 1500, which is what it was before this pass
      # took a slice of the run's time.
      priority_boards="${STJORNARRADID_PRIORITY-kaerunefnd-husamala}"
      if [ -z "$priority_boards" ]; then
        echo "STJORNARRADID_PRIORITY is empty — no priority board this run."
      else
        INGEST_MODE=backfill \
        STJORNARRADID_BOARDS="$priority_boards" \
        INGEST_MAX_CASES="${STJORNARRADID_PRIORITY_CASES:-1200}" \
          npm run ingest -- --adapter=stjornarradid
      fi
      ;;
    stjornarradid-backfill)
      # The rolling backfill. ~23,700 rulings at the polite fetch rate is far
      # more than one run, so it is bounded and resumable: every board keeps
      # its own cursor, successive runs carry the sweep forward, and a board
      # that reaches its last page wraps around to re-verify.
      #
      # Seeding a fresh database is a one-off run of the on-demand service
      # with INGEST_ADAPTERS="stjornarradid-backfill" and a much larger
      # STJORNARRADID_BACKFILL — see the README.
      INGEST_MODE=backfill \
      INGEST_MAX_CASES="${STJORNARRADID_BACKFILL:-900}" \
        npm run ingest -- --adapter=stjornarradid
      ;;
    logretta)
      # Both journals list in a handful of API calls, so they run in full every
      # time rather than being chunked like the archives above. The only knob
      # is whether the article PDFs are fetched, and it is named here so the
      # dashboard can set it — the default is off, deliberately.
      LOGRETTA_FETCH_PDFS="${LOGRETTA_FETCH_PDFS:-}" \
        npm run ingest -- --adapter=logretta
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
