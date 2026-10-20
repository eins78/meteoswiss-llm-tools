---
"meteoswiss-mcp": patch
---

Tool failures are now logged as one sanitized stderr line. Before, the error object was logged as is, and resolver messages carry the raw tool argument, so a newline in an argument could start a forged log line. The full error stays available in the debug log.
