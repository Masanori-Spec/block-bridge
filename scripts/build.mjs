import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=['index.html','src/app.mjs','src/core.mjs','src/zip.mjs','src/styles.css','fixtures/owner-complete/target.dxf','fixtures/owner-complete/donor.dxf'];
for(const name of files){const out=path.join(root,'dist',name);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,await readFile(path.join(root,name)));}
console.log('Static build contains '+files.length+' original runtime/example files; no CAD SDK or external assets');
