# Best match

One row per run of `pnpm eval:rank`, oldest first; the JSON next to this file has every case. Pairs are Best match / newest first, over the first 20 listings of each search. The base rate is the share of the cards each search matches that fit, so newest first should land near it. Times are one search end to end, warm; the first search also embeds the query.

| Run | Ran at (UTC) | Commit | Listings | Cases | Precision at 10 | Precision at 20 | MRR | Base rate | Cards in first 20 | Best match ms, p50 / p95 | Newest ms, p50 / p95 | First search ms, p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | 2026-11-07 00:44 | 71cd478 | 1,000,199 | 32 | 0.81 / 0.19 | 0.81 / 0.19 | 0.90 / 0.40 | 0.19 | 20.0 / 20.0 | 38 / 59 | 29 / 46 | 59 |
| opensearch1 | 2026-11-07 11:57 | e64e81c | 1,000,199 | 32 | 0.81 / 0.19 | 0.81 / 0.19 | 0.90 / 0.40 | 0.19 | 20.0 / 20.0 | 24 / 33 | 8 / 12 | 64 |
| run2 | 2026-11-07 12:20 | 3619e89 | 1,000,199 | 32 | 0.81 / 0.19 | 0.81 / 0.19 | 0.90 / 0.40 | 0.19 | 20.0 / 20.0 | 38 / 58 | 30 / 42 | 65 |
| opensearch2 | 2026-11-07 12:20 | 3619e89 | 1,000,199 | 32 | 0.81 / 0.19 | 0.81 / 0.19 | 0.90 / 0.40 | 0.19 | 20.0 / 20.0 | 26 / 33 | 9 / 11 | 66 |
