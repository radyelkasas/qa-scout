#!/bin/bash
# Send one test step (JS read from stdin) to the running driver.
# Usage: step.sh <runDir> <<'JS'
#          await H.go('/x'); return await H.inventory();
#        JS
RUN="${1:-.}"
PORT=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['port'])" "$RUN/driver.json" 2>/dev/null || echo 9333)
curl -s --max-time "${QA_STEP_TIMEOUT:-600}" -X POST --data-binary @- "http://127.0.0.1:$PORT/run"
echo
