# External relevance data

`npm run evaluate:fetch` downloads the [BEIR SciFact archive](https://github.com/beir-cellar/beir/wiki/Datasets-available) into ignored `.cache/relevance/`. Its published MD5 is `5f7d1de60b170fc8027bb7898e2efca1`. The fetcher verifies the whole archive before extracting three explicitly named files. `npm run evaluate:real` evaluates all 5,183 abstracts and all 300 judged queries in the BEIR test split.

The original dataset is [AllenAI SciFact](https://github.com/allenai/scifact), described in [Fact or Fiction: Verifying Scientific Claims](https://arxiv.org/abs/2004.14974). SciFact claims and evidence annotations are released under CC BY 4.0. The abstract corpus comes from Semantic Scholar S2ORC and is released under ODC-By 1.0. See the [original license](https://github.com/allenai/scifact/blob/master/LICENSE.md).

The labels are external expert-authored judgments. Shardly does not create or change them, and does not receive relevance labels during indexing or search. The benchmark uses any-word matching and reports both BM25 and field/passage ranking at cutoff 10. Missing relevant documents remain in ideal gain and recall. Per-query results are published so an aggregate cannot hide failures.

This measures scientific claim retrieval over abstracts. It does not establish code-navigation quality, personal document relevance, or a universal ranking advantage. The authored `fixtures/relevance.json` remains a separate behavioral regression suite.
