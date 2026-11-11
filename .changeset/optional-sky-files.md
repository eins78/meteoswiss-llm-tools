---
"meteoswiss-mcp": patch
---

With `detail: "sky"`, a failed download of a cloud cover file (or, for a station, of the hourly weather symbol file) no longer fails the call. The fields from that file are `null`, and the answer has a `warnings` list that names the file. Answers without `"sky"` do not change.
