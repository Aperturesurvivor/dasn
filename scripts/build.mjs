import { hash } from "../src/store.mjs";
await Deno.mkdir("dist", { recursive: true });
const manifest = { version: "0.2.0", files: {} };
for (const file of ["store.mjs", "tools.mjs", "worker.mjs"]) {
  await Deno.copyFile(`src/${file}`, `dist/${file}`);
}
const assets = {};
for (
  const [filename, type] of [["index.html", "text/html; charset=utf-8"], [
    "style.css",
    "text/css; charset=utf-8",
  ], ["site.js", "text/javascript; charset=utf-8"]]
) assets[`/${filename}`] = { type, body: await Deno.readTextFile(`public/${filename}`) };
await Deno.writeTextFile(
  "dist/assets.mjs",
  `const assets=${
    JSON.stringify(assets)
  };\nexport const ASSETS={fetch(request){const u=new URL(request.url);const a=assets[u.pathname==='/'?'/index.html':u.pathname];return a?new Response(a.body,{headers:{'Content-Type':a.type}}):new Response('Not found',{status:404});}};\n`,
);
await Deno.writeTextFile(
  "dist/entry.mjs",
  `import {handle} from './worker.mjs';\nimport {ASSETS} from './assets.mjs';\nexport default {fetch(request,env){return handle(request,{...env,ASSETS});}};\n`,
);
for (const filename of ["entry.mjs", "assets.mjs", "store.mjs", "tools.mjs", "worker.mjs"]) {
  const content = await Deno.readTextFile(`dist/${filename}`);
  manifest.files[filename] = {
    bytes: new TextEncoder().encode(content).length,
    sha256: await hash(content),
  };
}
await Deno.writeTextFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  "Built a dependency-free Worker package with 5 modules. No data, invitations, or membership keys included.",
);
