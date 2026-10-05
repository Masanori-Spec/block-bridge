import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTransferZip} from '../src/zip.mjs';
import {extractTransferZip} from './browser/artifact-contract.mjs';
test('original ZIP writer is independently decoded with exact UTF-8 bytes and CRC',async()=>{const files={'donor-transfer.dxf':'0\r\nEOF\r\n','collision-map.json':'{"name":"日本語"}\n','preservation-report.json':'{"unchanged":true}\n'};const first=Buffer.from(await makeTransferZip(files).arrayBuffer());const second=Buffer.from(await makeTransferZip(files).arrayBuffer());assert.deepEqual(first,second);const decoded=extractTransferZip(first);for(const[name,text]of Object.entries(files))assert.equal(decoded[name].toString('utf8'),text);});
test('ZIP writer rejects unsafe paths and arbitrary filenames',()=>{for(const name of ['../donor-transfer.dxf','a/b.json','UPPER.json','name.txt'])assert.throws(()=>makeTransferZip({[name]:'x'}));});
