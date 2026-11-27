"""Emit complete deployable source, excluding runtime data and private files."""
import argparse
import hashlib
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
paths=['.gitignore','.dockerignore','.env.example','AGENTS.md','README.md','Dockerfile','render.yaml',
       'backend/requirements.txt','backend/README.md',
       'frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/vite.config.ts','frontend/index.html','frontend/favicon.svg',
       'cloudflare/package.json','cloudflare/package-lock.json','cloudflare/wrangler.jsonc','cloudflare/worker.mjs','cloudflare/worker.test.mjs','cloudflare/edge-data.mjs','cloudflare/edge-data.test.mjs',
       'docs/CLOUD_DEPLOYMENT.md','docs/IMPLEMENTATION_CONTRACT.md',
       'docs/research/harness/RESEARCH_AND_IMPLEMENTATION.md',
       'docs/research/harness/OPEN_SOURCE_QUANT_BASELINES.md',
       'docs/research/harness/STYLE_CONTROL_PATH_DECISION_2026-11-23.md',
       'outputs/PROJECT_CONSTRAINTS.md','outputs/UI_FUNCTIONAL_SPEC.md',
       'scripts/setup.sh','scripts/dev.sh','scripts/dev.py','scripts/cloudflare.sh','scripts/export-cloud-source.py']
for pattern in ['backend/app/**/*.py','backend/app/vendor/*','backend/tests/*.py',
                'frontend/src/*','frontend/public/**/*','frontend/tests/*',
                'cloudflare/*.mjs','cloudflare/fixtures/*.json',
                'scripts/*.py','scripts/*.sh','docs/*.md']:
 paths.extend(str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file())
files=[]
for name in sorted(set(paths)):
 p=root/name
 if not p.is_file(): raise SystemExit('Required source missing: '+name)
 if p.is_symlink(): raise SystemExit('Refusing symlink: '+name)
 files.append({'path':name,'content':p.read_text(encoding='utf-8')})
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest',action='store_true',help='Emit file hashes instead of source text')
args=parser.parse_args()
if args.manifest:
 manifest={entry['path']:hashlib.sha256(entry['content'].encode('utf-8')).hexdigest() for entry in files}
 digest=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 print(json.dumps({'source_sha256':digest,'file_count':len(files),'files':manifest},indent=2))
else:
 print(json.dumps(files))
