---
"meteoswiss-mcp": minor
---

`meteoswissWeatherSituation`: with `map: "grid"` the grid now states its size in `grid.cols` (characters per row) and `grid.row_count` (number of rows), so a model no longer has to count. The description explains `missing` (point-hours without a weather symbol), says to use `meteoswissWeatherMapExperimental` when it is listed and the user wants to see a map, and the `source` text now carries the MeteoSwiss links.
