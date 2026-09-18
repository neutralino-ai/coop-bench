import { readFileSync, statSync } from 'node:fs';
const KEYS=['TENCENTCLOUD_SECRET_ID','TENCENTCLOUD_SECRET_KEY'];
/** Parse literal env assignments, never execute shell code or expand variables. */
export function parseEnvCredentials(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>65536)throw Error('环境文件必须是小于 64 KiB 的文本文件。');
  const found={};
  for(const source of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=source.trim();if(!line||line.startsWith('#'))continue;
    const assignment=/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if(!assignment||!KEYS.includes(assignment[1]))continue;
    const [,key,raw]=assignment;
    if(Object.hasOwn(found,key))throw Error(`环境文件重复定义了 ${key}。`);
    let value=raw.trim();
    if(value.startsWith('"')||value.startsWith("'")){
      const quote=value[0],end=value.indexOf(quote,1);
      if(end<0||!/^\s*(?:#.*)?$/.test(value.slice(end+1)))throw Error(`请检查 ${key} 的引号格式。`);
      value=value.slice(1,end);
    }else value=value.replace(/\s+#.*$/,'').trim();
    if(!value||value.toLowerCase().startsWith('replace-')||value.length>512||/[\s\x00-\x1f]/.test(value))throw Error(`请在环境文件中设置有效的 ${key}，不能使用空值或 replace- 占位符。`);
    found[key]=value;
  }
  if(KEYS.some(key=>!found[key]))throw Error('环境文件需要同时设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY。');
  return {secretId:found.TENCENTCLOUD_SECRET_ID,secretKey:found.TENCENTCLOUD_SECRET_KEY};
}
export function readEnvCredentials(file){
  if(typeof file!=='string'||!file)throw Error('请选择环境文件。');
  const info=statSync(file);if(!info.isFile()||info.size>65536)throw Error('环境文件必须是小于 64 KiB 的普通文本文件。');
  return parseEnvCredentials(readFileSync(file,'utf8'));
}
