# Rerank and cut

One row per run of `pnpm eval:fit` and kind of case, oldest first; the JSON next to this file has every case. A model judges the first 50 cards Best match shows against what no filter reads. Precision and recall are of the cards it kept, against the cards among the 50 whose lore fits. Precision at 20 is of the page's first 20 listings, before / after the cut. Cost is the whole run's.

| Run | Ran at (UTC) | Commit | Cases | n | Fit, of judged | Kept | Precision | Recall | Precision at 20, before / after | Judge ms, p50 / p95 | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | 2026-11-07 11:03 | d48292f | filtered | 32 | 39.2 of 50.0 | 37.5 | 1.00 | 0.95 | 0.81 / 1.00 | 2009 / 4055 | $0.0559 |
| run1 | 2026-11-07 11:03 | d48292f | description alone | 28 | 23.6 of 50.0 | 24.4 | 0.94 | 0.97 | 0.50 / 0.92 | 1701 / 2514 | $0.0559 |
| run2 | 2026-11-07 11:07 | d48292f | filtered | 32 | 39.2 of 50.0 | 37.2 | 1.00 | 0.96 | 0.81 / 1.00 | 1904 / 4059 | $0.0558 |
| run2 | 2026-11-07 11:07 | d48292f | description alone | 28 | 23.6 of 50.0 | 24.1 | 0.93 | 0.96 | 0.50 / 0.90 | 1614 / 2094 | $0.0558 |
