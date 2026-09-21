import {mkdir,writeFile} from 'node:fs/promises';
import {startMockApi} from '../desktop/mock-api.mjs';
const mock=await startMockApi(),password='synthetic-ios-password-only';
await mock.call('/auth/password',mock.adminToken,{password});
await mkdir('artifacts/ios',{recursive:true});
await writeFile('artifacts/ios/launch.txt',Buffer.from(JSON.stringify({apiUrl:mock.apiUrl,password})).toString('base64'));
process.on('SIGTERM',async()=>{await mock.close();process.exit(0)});
console.log('Loopback iOS synthetic fixture ready.');
