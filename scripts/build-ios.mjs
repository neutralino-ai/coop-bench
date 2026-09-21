import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {webFiles} from './client-files.mjs';
const root=new URL('../',import.meta.url),out=new URL('../ios/Web/',import.meta.url);
await mkdir(out,{recursive:true});
for(const name of webFiles){
 let content=await readFile(new URL('web/'+name,root),'utf8');
 if(name.endsWith('.html'))content=content.replaceAll('href="/','href="').replaceAll('src="/','src="')
   .replace(/<meta name="viewport"[^>]*>/,'<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">')
   .replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`)
   .replace('</head>','<link rel="stylesheet" href="ios.css"></head>');
 await writeFile(new URL(name,out),content);
}
for(const file of ['ios-bridge.js','ios.css'])await copyFile(new URL('ios/'+file,root),new URL(file,out));
const manifest={version:JSON.parse(await readFile(new URL('package.json',root))).version,platform:'ios',containsGameEngine:false,files:[...webFiles,'ios-bridge.js','ios.css']};
await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log('iOS shared UI prepared: '+fileURLToPath(out));
