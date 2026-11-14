# Forecast fixtures

One CSV per OGD parameter, in the real layout (`point_id;point_type_id;Date;<param>`, UTC
`YYYYMMDDhhmm`). The rows of `800100;2` (Zürich 8001) and `48;1` (Napf) feed the
`meteoswissLocalForecast` tests; leave them unchanged.

## Weather-situation rows (synthetic)

`jww003i0`, `nprolohs`, `npromths` and `nprohihs` also hold one block per point for 32 more
points of `../metadata/ogd-local-forecasting_meta_point.csv`, at 07–11 UTC on 28.03.2026
(08:00–12:00 CET). They are made up for the `meteoswissWeatherSituation` tests, not taken from
a forecast run:

| UTC | Story |
|---|---|
| 07, 08 | Fog sea north of the Alps: low points carry fog (28) or stratus (27), or overcast (35) / partly sunny (3) under a low deck that the cloud rule turns into `fog_or_stratus`; one overcast point has medium cloud above and stays `cloudy`. Points above about 900 m are sunny; Jungfraujoch is inside cloud (28). The south side has rain and snow. |
| 09 | The fog lifts: low points are partly sunny with half low cloud. |
| 10 | Sunny north of the Alps. |
| 11 | Cloud above the deck: overcast with medium and high cloud (no fog), rain on the hills. |

Napf (`48;1`) has no row at these hours, so it counts as missing. Andermatt (`10;1`) lies
outside every synthetic region box and is counted in the nearest region.
