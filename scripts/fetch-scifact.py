"""Fetch the public BEIR SciFact archive; verify its published checksum before extraction."""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

URL = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
MD5 = "5f7d1de60b170fc8027bb7898e2efca1"  # BEIR's published identity, not a security signature.
folder = Path(__file__).resolve().parent.parent / ".cache" / "relevance"
folder.mkdir(parents=True, exist_ok=True)
archive = folder / "scifact.zip"
if not archive.exists() or hashlib.md5(archive.read_bytes()).hexdigest() != MD5:
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, suffix=".zip", delete=False) as output:
            temp = Path(output.name)
            with urllib.request.urlopen(URL, timeout=240) as response:
                while chunk := response.read(65536):
                    output.write(chunk)
        if hashlib.md5(temp.read_bytes()).hexdigest() != MD5:
            raise ValueError("SciFact archive does not match BEIR's published checksum")
        os.replace(temp, archive)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)
with zipfile.ZipFile(archive) as source:
    for name in ["scifact/corpus.jsonl", "scifact/queries.jsonl", "scifact/qrels/test.tsv"]:
        source.extract(name, folder)
print(folder / "scifact")
