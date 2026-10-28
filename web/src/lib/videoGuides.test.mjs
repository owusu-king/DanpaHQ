import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const ts=createRequire(import.meta.url)('typescript');
function loadUpload(fetchManagement,storageFetch){
 const exports={};
 vm.runInNewContext(ts.transpileModule(read('./guideUploads.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({managementFetch:fetchManagement}),FormData,AbortSignal,fetch:storageFetch,Date,setTimeout,Promise});
 return exports.uploadGuideAsset;
}
test('guide upload uses its management reserve, storage and scan gates',async()=>{
 const calls=[];const file=new File(['WEBVTT\n\n'],'intro.vtt',{type:'text/plain'});
 const upload=loadUpload(async(path,options)=>{calls.push([path,options]);return path.endsWith('/uploads/')?{file_id:'preview-file',url:'https://storage.example/upload',method:'POST',headers:{},fields:{key:'guide-key'}}:{is_usable:true};},async(url,options)=>{assert.equal(url,'https://storage.example/upload');assert.equal(options.method,'POST');assert.equal(options.body.get('key'),'guide-key');assert.equal(options.body.get('file').name,'intro.vtt');return {ok:true};});
 assert.equal(await upload(file,'guide_captions',()=>{}),'preview-file');
 assert.equal(JSON.parse(calls[0][1].body).content_type,'text/vtt');
 assert.equal(calls[1][0],'/how-it-works/uploads/preview-file/');
 assert.equal(calls[1][1].method,'POST');
});
test('a storage rejection never completes or publishes an upload',async()=>{
 let calls=0;
 const upload=loadUpload(async()=>{calls++;return {file_id:'preview-file',url:'https://storage.example/upload',method:'PUT',headers:{},fields:{}};},async()=>({ok:false}));
 await assert.rejects(upload(new File(['x'],'intro.mp4'),'guide_video',()=>{}),/upload did not finish/);
 assert.equal(calls,1);
});
test('editor offers explicit publishing, source selection and ordering',()=>{
 const page=read('../../app/management/how-it-works/page.tsx');
 for(const text of ['Move up','Move down','Published','Save guides','Discard changes'])assert.ok(page.includes(text));
 assert.match(page,/can\("manage_configuration"\)/);
 assert.match(page,/revision: saved.revision/);
 assert.match(read('../components/management/ManagementShell.tsx'),/href: "\/management\/how-it-works"/);
});
