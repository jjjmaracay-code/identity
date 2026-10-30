// Read-only proof for optional passkeys/Wallet. Reuses the account's existing
// token, trial and device rules; never creates/transfers a device or account.
import { authenticateOwner } from '../_shared/business.js';
import { accountId, jsonResponse } from '../_shared/card-trial.js';
import { isValidDeviceId, isDeviceLimitEnforced, getDevicesList, findDevice, isNewDeviceOverLimit } from '../_shared/devices.js';
export async function onRequestPost({request,env}) {
  try {
    const body=await request.json();
    if(!isValidDeviceId(body?.deviceId))return jsonResponse({ok:false},400);
    const owner=await authenticateOwner(env,body.email,body.token);
    if(!owner.ok)return jsonResponse({ok:false},401);
    if(owner.bloqueado)return jsonResponse({ok:false},402);
    if(isDeviceLimitEnforced(env)) {
      const device=findDevice(await getDevicesList(env,owner.emailKey),body.deviceId);
      if(device?.status==='revoked'||await isNewDeviceOverLimit(env,owner.emailKey,body.deviceId,owner.plan))return jsonResponse({ok:false},403);
    }
    const epoch=await accountId(body.token);
    const subject=await accountId('identity.passkeys.v1:'+owner.emailKey+':'+epoch);
    return jsonResponse({ok:true,subject,epoch,deviceId:body.deviceId});
  }catch(_){return jsonResponse({ok:false},503);}
}
