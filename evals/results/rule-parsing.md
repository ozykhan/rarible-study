# Drafting watch rules

One row per run of `pnpm eval:parse`, oldest first; the JSON next to this file has every draft. "Asked when clear" counts drafts that put a question to the collector when a careful reader would not; times are one draft end to end (the name lookups and the model call).

| Run | Ran at (UTC) | Commit | Model | Prompt | Catalog | Cases passed | Asked when clear | Missed questions | Fields right | Input tokens, avg | ms, p50 / p95 | Model calls | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prompt1 | 2026-11-07 21:26 | 43578c0 | claude-haiku-5-5 | 1 | 40 cards | 14 of 18 | 3 | 0 | 142 of 144 | 1720 | 909 / 2541 | 18 | 0.0040 |
| run1 | 2026-11-07 21:32 | aa1b684 | claude-haiku-5-5 | 2 | 40 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1828 | 853 / 1197 | 18 | 0.0040 |
| run2 | 2026-11-07 21:33 | aa1b684 | claude-haiku-5-5 | 2 | 40 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1828 | 872 / 1290 | 18 | 0.0040 |
| run3 | 2026-11-07 21:34 | aa1b684 | claude-haiku-5-5 | 2 | 20040 cards | 17 of 18 | 0 | 1 | 144 of 144 | 1893 | 944 / 3325 | 18 | 0.0044 |
| run4 | 2026-11-07 21:35 | aa1b684 | claude-haiku-5-5 | 2 | 20040 cards | 17 of 18 | 0 | 1 | 144 of 144 | 1893 | 944 / 3260 | 18 | 0.0044 |
| run5 | 2026-11-07 21:35 | 27aaa5a | claude-haiku-5-5 | 2 | 40 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1864 | 867 / 1726 | 18 | 0.0041 |
| run6 | 2026-11-07 21:36 | 27aaa5a | claude-haiku-5-5 | 2 | 40 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1864 | 885 / 1361 | 18 | 0.0041 |
| run7 | 2026-11-07 21:37 | 27aaa5a | claude-haiku-5-5 | 2 | 20040 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1929 | 884 / 2060 | 18 | 0.0043 |
| run8 | 2026-11-07 21:37 | 27aaa5a | claude-haiku-5-5 | 2 | 20040 cards | 18 of 18 | 0 | 0 | 144 of 144 | 1929 | 919 / 1946 | 18 | 0.0043 |
