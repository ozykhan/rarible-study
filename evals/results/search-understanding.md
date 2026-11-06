# Reading described searches

One row per run of `pnpm eval:search`, oldest first; the JSON next to this file has every case. Times are for one search read end to end (the word lookups, the cache and the model call).

| Run | Ran at (UTC) | Commit | Model | Prompt | Cases passed | Readings with an extra tag | Readings missing a tag | Model reading ms, p50 / p95 | Cached ms, p50 | Model calls | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | 2026-11-06 18:37 | 4605ffe | claude-haiku-5-5 | 1 | 34 of 45 | 4 | 0 | 989 / 1866 | 2 | 35 | 0.0025 |
| run2 | 2026-11-06 18:39 | 4605ffe | claude-haiku-5-5 | 2 | 45 of 50 | 1 | 0 | 963 / 1594 | 2 | 39 | 0.0031 |
| run3 | 2026-11-06 18:40 | 4605ffe | claude-haiku-5-5 | 3 | 46 of 50 | 1 | 0 | 982 / 1578 | 2 | 39 | 0.0031 |
