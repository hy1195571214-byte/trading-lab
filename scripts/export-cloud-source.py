"""Emit the deployment source allowlist as JSON; excludes all runtime/private files."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
paths=['.gitignore','.dockerignore','.env.example','AGENTS.md','README.md','Dockerfile','render.yaml',
       'backend/requirements.txt','backend/README.md',
       'frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/vite.config.ts','frontend/index.html',
       'cloudflare/package.json','cloudflare/package-lock.json','cloudflare/wrangler.jsonc','cloudflare/worker.mjs','cloudflare/worker.test.mjs',
       'docs/CLOUD_DEPLOYMENT.md','docs/IMPLEMENTATION_CONTRACT.md',
       'outputs/PROJECT_CONSTRAINTS.md','outputs/UI_FUNCTIONAL_SPEC.md',
       'scripts/setup.sh','scripts/dev.sh','scripts/dev.py','scripts/cloudflare.sh','scripts/export-cloud-source.py']
for pattern in ['backend/app/*.py','backend/tests/*.py','backend/app/engine_tests/*.py','frontend/src/*','frontend/public/*']:
 paths.extend(str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file())
files=[]
for name in sorted(set(paths)):
 p=root/name
 if not p.is_file(): raise SystemExit('Required source missing: '+name)
 if p.is_symlink(): raise SystemExit('Refusing symlink: '+name)
 files.append({'path':name,'content':p.read_text()})
print(json.dumps(files))
