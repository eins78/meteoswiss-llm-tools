# Forecast region fixtures (synthetic)

These files are **not** MeteoSwiss's forecast regions. Each one is a set of small boxes
(±0.02°) around the forecast points in `../ogd/metadata/ogd-local-forecasting_meta_point.csv`,
grouped by the region each point lies in. Andermatt is deliberately in no box, so tests cover
the nearest-region fallback.

MeteoSwiss's region files are website content, not Open Data: the server downloads them at
runtime (`src/data/forecast-regions-source.ts`), and they are never committed to this repository.
