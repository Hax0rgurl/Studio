"""Copy the private crew runtime and exactly the model layers its manifest names."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

resources = Path(sys.argv[1])
home = Path.home()
python = Path(os.environ.get('STUDIO_PYTHON_RUNTIME', home/'.local/share/uv/python/cpython-3.12.13-macos-aarch64-none'))
engine = Path(os.environ.get('STUDIO_ENGINE_RUNTIME', '/Applications/Ollama.app/Contents/Resources'))
models = Path(os.environ.get('STUDIO_MODEL_LIBRARY', home/'.ollama/models'))
manifest = Path('manifests/registry.ollama.ai/library/qwen3.5/latest')
for source, name in ((python,'python'), (engine,'engine')):
    subprocess.run(['/usr/bin/ditto','--norsrc','--noextattr',str(source),str(resources/name)],check=True)
subprocess.run(['/bin/chmod','-R','u+rX',str(resources/'python')],check=True)
target = resources/'models'
(target/manifest).parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(models/manifest,target/manifest)
(target/'blobs').mkdir(exist_ok=True)
data = json.loads((models/manifest).read_text())
for item in [data['config'], *data['layers']]:
    name = item['digest'].replace(':','-')
    dest = target/'blobs'/name
    if not dest.exists():
        subprocess.run(['/bin/cp','-c',str(models/'blobs'/name),str(dest)],check=True)
