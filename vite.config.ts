import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
/** The Sky Mavis Mixer 3D content pack, as installed with the toolkit. It is
 *  510 MB and is never copied into public/ or dist/: the dev and preview
 *  servers stream it from node_modules on demand, exactly the files a
 *  character asks for. Production points VITE_AXIE_ASSET_BASE at a host that
 *  carries the pack — see docs/MIXER.md. */
const AXIE_PACK = path.join(ROOT, 'node_modules/@jaatster/threejs-axie-mixer3d-public/public/assets/axie');
const AXIE_URL = '/assets/axie/';
const MIME: Record<string, string> = {
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.axanim': 'application/octet-stream', '.bc1': 'application/octet-stream',
  '.bc3': 'application/octet-stream', '.bc7': 'application/octet-stream',
  '.shader': 'text/plain', '.shadergraph': 'text/plain',
};

function axiePack(): Plugin {
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (!url.startsWith(AXIE_URL)) return next();
    const rel = decodeURIComponent(new URL(url, 'http://localhost').pathname.slice(AXIE_URL.length));
    const file = path.join(AXIE_PACK, rel);
    if (!file.startsWith(AXIE_PACK + path.sep)) { res.statusCode = 403; res.end(); return; }
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      size = st.size;
    } catch {
      res.statusCode = 404; res.end(`not in the Axie pack: ${rel}`); return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'luna-prix-axie-pack',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

export default defineConfig({
  base: './',
  plugins: [axiePack()],
  // The toolkit was installed from git, so npm left its own three@0.178 under
  // its node_modules. One three per page, or materials and geometry fail
  // instanceof checks across the two copies.
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['@jaatster/threejs-axie-mixer3d-public'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { port: 5173, host: true },
});
