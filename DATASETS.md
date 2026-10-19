# External relevance data

`npm run evaluate:fetch` downloads the [BEIR SciFact archive](https://github.com/beir-cellar/beir/wiki/Datasets-available) into ignored `.cache/relevance/`. Its published MD5 is `5f7d1de60b170fc8027bb7898e2efca1`. The fetcher verifies the whole archive before extracting three explicitly named files. `npm run evaluate:real` evaluates all 5,183 abstracts and all 300 judged queries in the BEIR test split.

The original dataset is [AllenAI SciFact](https://github.com/allenai/scifact), described in [Fact or Fiction: Verifying Scientific Claims](https://arxiv.org/abs/2004.14974). SciFact claims and evidence annotations are released under CC BY 4.0. The abstract corpus comes from Semantic Scholar S2ORC and is released under ODC-By 1.0. See the [original license](https://github.com/allenai/scifact/blob/master/LICENSE.md).

The labels are external expert-authored judgments. Shardly does not create or change them, and does not receive relevance labels during indexing or search. The benchmark uses any-word matching and reports both BM25 and field/passage ranking at cutoff 10. Missing relevant documents remain in ideal gain and recall. Per-query results are published so an aggregate cannot hide failures.

This measures scientific claim retrieval over abstracts. It does not establish code-navigation quality, personal document relevance, or a universal ranking advantage. The authored `fixtures/relevance.json` remains a separate behavioral regression suite.

## Repository task judgments

`npm run evaluate:workspace` uses `fixtures/relevance-workspace.json`: 20 real Shardly source and documentation files frozen at commit `b63d56f0574efe6fcbd8aed7d060e3fdb2006005`. The fixture records a SHA-256 checksum for each original file. It needs neither a network connection nor the current working tree to reproduce its corpus.

The 24 task queries and grades were authored before running either ranking profile. Grade 3 identifies the primary implementation, grade 2 identifies useful explanations or related implementations, and grade 1 identifies context. Unjudged documents score zero. The evaluator reports MRR, nDCG, recall, and individual rankings at cutoff 10, and checks both profiles after restart. Fixed nDCG floors are 0.78 for BM25 and 0.82 for fields and passages.

Fields and passages scores 0.861 nDCG@10; BM25 scores 0.826. That supports retaining fields and passages for the developer workspace. These provisional authored judgments do not establish real-user preference or personal-document quality. The grades and corpus remain fixed when ranking changes are evaluated. [Per-query report](benchmarks/relevance-workspace.json).


## Parser regression fixtures

`tests/formats.test.ts` builds small real-format ZIP/XML, MIME, HTML, CSV and RTF payloads. `fixtures/ocr-search.pdf` is a generated image-only page containing the original test phrase “Durable recovery evidence”; it contains no embedded searchable text. The optional real-tool OCR check runs only where Poppler and Tesseract are installed. These fixtures verify parser contracts and locations, not representative extraction accuracy or model relevance. No private documents were added.
