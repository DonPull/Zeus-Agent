/** Authenticate controller results; public keys must be pinned before candidate execution. */
import crypto from 'node:crypto';
export const SIGNED_LIMIT=256*1024;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function decode(value,limit){
  if(typeof value!=='string'||value.length>limit*4/3+4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid signed encoding');
  const bytes=Buffer.from(value,'base64');if(bytes.length>limit||bytes.toString('base64')!==value)throw Error('Signed body exceeds its allowance');return bytes;
}
export function controllerKey(){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,spki:spki.toString('base64'),fingerprint:sha(spki)};
}
export function pinControllerKey(doc,{id,nonce}){
  if(doc?.schema_version!==1||doc.id!==id||doc.nonce!==nonce)throw Error('Controller key identity mismatch');
  const bytes=decode(doc.key_spki,128),key=crypto.createPublicKey({key:bytes,format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519'||bytes.length!==44)throw Error('Unexpected controller key algorithm');
  return {key,spki:doc.key_spki,fingerprint:sha(bytes)};
}
export function signGradingResult(key,{id,nonce,packet_sha256},body){
  const bytes=Buffer.from(JSON.stringify({schema_version:1,id,nonce,packet_sha256,body}));
  if(bytes.length>SIGNED_LIMIT)throw Error('Grading result exceeds its signed allowance');
  return {kind:'signed-grading-result-v1',payload_base64:bytes.toString('base64'),signature_base64:crypto.sign(null,bytes,key.privateKey).toString('base64')};
}
export function verifyGradingResult(envelope,pinned,{id,nonce,packet_sha256}){
  if(envelope?.kind!=='signed-grading-result-v1')throw Error('Missing signed grading result');
  const bytes=decode(envelope.payload_base64,SIGNED_LIMIT),signature=decode(envelope.signature_base64,64);
  if(signature.length!==64||!crypto.verify(null,bytes,pinned.key,signature))throw Error('Invalid controller signature');
  const result=JSON.parse(bytes);
  if(result.schema_version!==1||result.id!==id||result.nonce!==nonce||result.packet_sha256!==packet_sha256)throw Error('Signed grading identity mismatch');
  return result.body;
}
