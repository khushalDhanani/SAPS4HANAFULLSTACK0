"""Explicit opt-in gate for tools that connect to SAP or a live CAP server."""

import os
import sys

def require_live_sap_tool():
    if '--selftest' in sys.argv:
        return
    if os.environ.get('ALLOW_LIVE_SAP_TOOLS') != '1' or '--allow-live-sap' not in sys.argv:
        raise SystemExit('Blocked: live integration tool requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap')
    sys.argv.remove('--allow-live-sap')
