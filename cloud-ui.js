'use strict';
// Access/migration UI. Secrets live only in memory until explicitly downloaded.
let authGeneration=0,authBusy=false,migrationReceipt=null,importCandidate=null;

function captureReceipt(result,operation){
  if(!result?.recovery_key)throw Error('No recovery receipt was returned. Do not repeat the operation: reconnect and inspect the table first.');
  migrationReceipt={format:'felt-private-migration-receipt-v1',operation,created_at:new Date().toISOString(),site:location.origin+location.pathname,group_id:result.group_id,recovery_key:result.recovery_key,claim_tokens:result.claim_tokens||{}};
  recoveryKey=result.recovery_key;
}
function showReceipt(){
  if(!migrationReceipt)return;
  const count=Object.keys(migrationReceipt.claim_tokens).length;
  modal('Save your private table receipt',`<div class="notice"><strong>Shown once. Save before leaving.</strong><p>Your host recovery key and ${count} one-use player claim token${count===1?'':'s'} cannot be retrieved from ordinary backups. They are kept only in this page’s memory until you save this receipt.</p></div><label>Group UUID<code class="secret">${esc(migrationReceipt.group_id)}</code></label><label>Private host recovery key<code class="secret">${esc(migrationReceipt.recovery_key)}</code></label><p class="tiny muted">Recovery requires BOTH the group UUID and key. This browser remembers your normal access. The key is for transfer to a new device and rotates when used.</p>${count?'<p class="tiny muted">The private JSON receipt contains each player’s individual claim token. Give each person ONLY their own token privately, never this entire receipt. After import, compare every player, session and amount with your offline backup before switching the group.</p>':''}<div class="actions"><button data-action="save-recovery" class="primary">↓ Download private receipt</button><button data-action="copy-recovery">Copy recovery key only</button></div><label class="receipt-check"><input type="checkbox" id="receipt-saved"><span>I saved the group UUID, recovery key and any player claim tokens securely. I understand they will not be shown again.</span></label><div class="dialog-foot"><button data-action="close">I saved it · continue</button></div>`,'recovery');
}
function saveReceipt(){
  if(!migrationReceipt)throw Error('No private receipt is pending.');
  download(JSON.stringify({...migrationReceipt,player_names:Object.fromEntries(state.players.map(p=>[p.id,p.name]))},null,2),'application/json','felt-PRIVATE-table-receipt.json');
  toast('Private receipt downloaded. Keep it offline; never publish or share the entire file.');
}
function confirmForgetDevice(){
  if(migrationReceipt)throw Error('Save and acknowledge your private receipt before forgetting this device.');
  modal('Forget this device?',`<p>This removes your saved access from this browser, not your player or ledger.</p><div class="notice error"><strong>Your name and room code cannot restore your existing identity.</strong><p>On a new device, players need their own unused claim token (if provided by the host); hosts need their group UUID and recovery key. Without recovery, you may lose access permanently. Do not create a duplicate player.</p></div><div class="dialog-foot"><button data-action="close">Keep this device</button><button class="danger" data-action="confirm-forget">Forget this device</button></div>`,'forget-device');
}
async function signOutCloud(){
  if(migrationReceipt)throw Error('Save and acknowledge your private receipt before signing out.');
  if(busy||authBusy)return;
  busy=true;
  try{await cloud.api('logout',{});$('#modal').close();modalKind='';state={me:null,group:null,players:[],sessions:[],auth_required:true};lastJSON='';ready=true;importCandidate=null;render();$('#sync').textContent='Device forgotten · create, join or recover'}finally{busy=false}
}
// Dedicated forms stay separate from all existing ledger mutation handlers.
document.addEventListener('submit',async event=>{
  const form=event.target,type=form.dataset.cloudForm;if(!type)return;
  event.preventDefault();if(authBusy||busy)return;
  const values=new FormData(form),buttons=[...form.querySelectorAll('button')];
  authBusy=true;buttons.forEach(b=>b.disabled=true);
  try{
    const box=form.closest('.panel')?.querySelector('.form-error');if(box)box.hidden=true;
    if(type==='import'){
      const file=values.get('ledger');
      if(!file||!file.size)throw Error('Choose the host ledger JSON backup.');
      if(file.size>2*1024*1024)throw Error('This ledger exceeds the 2 MiB import limit. Nothing was uploaded.');
      if(!values.get('import_confirm'))throw Error('Confirm you have an offline backup before importing.');
      let parsed;try{parsed=JSON.parse(await file.text())}catch{throw Error('This file is not valid JSON. Nothing was uploaded.')}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!parsed.group||!Array.isArray(parsed.players)||!Array.isArray(parsed.sessions))throw Error('Choose a ledger export with group, players and sessions.');
      const result=await mutate('import',{ledger:parsed});
      if(result){importCandidate=null;history.replaceState(null,'',location.pathname);tab='tonight';render();showReceipt()}
    }else if(type==='claim'){
      const token=String(values.get('token')).trim();if(!token)throw Error('Enter your own private player claim token.');
      busy=true;
      try{await cloud.claimPlayer(token);form.reset();if(!await refresh(true))throw Error('Claim accepted, but state could not be verified. Reconnect and inspect membership before trying again.');history.replaceState(null,'',location.pathname);toast('Existing player claimed. This browser will remember your membership.')}finally{busy=false}
    }
  }catch(error){formError(error)}finally{authBusy=false;buttons.forEach(b=>b.disabled=false)}
});
document.addEventListener('change',async event=>{
  if(!event.target.matches('[data-cloud-form=import] input[type=file]'))return;
  const file=event.target.files[0],box=$('#import-preview');if(!box)return;
  if(!file){box.textContent='No file selected.';return}
  try{
    if(file.size>2*1024*1024)throw Error('File is larger than 2 MiB. Nothing uploaded.');
    const data=JSON.parse(await file.text());
    if(!data.group||!Array.isArray(data.players)||!Array.isArray(data.sessions))throw Error('Not a ledger export (group, players and sessions are required).');
    // textContent prevents imported names or filenames from becoming HTML.
    box.textContent=`Ready to validate on import: ${data.group.name||'Unnamed table'} · ${data.players.length} players · ${data.sessions.length} sessions. Nothing uploaded yet. Keep a separate offline copy.`;
  }catch(error){box.textContent='Cannot import: '+(error instanceof SyntaxError?'Invalid JSON.':error.message)}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  try{
    if(button.dataset.action==='cloud-logout')confirmForgetDevice();
    else if(button.dataset.action==='confirm-forget')await signOutCloud();
    else if(button.dataset.action==='clear-selection'){if(busy||authBusy||migrationReceipt)return;cloud.selectGroup(null);await refresh(true)}
  }catch(error){formError(error)}
});
document.addEventListener('input',event=>{const form=event.target.closest('#app form');if(form)form.dataset.dirty='true'});
document.addEventListener('change',event=>{const form=event.target.closest('#app form');if(form)form.dataset.dirty='true'});
window.addEventListener('beforeunload',event=>{if(migrationReceipt){event.preventDefault();event.returnValue=''}});
