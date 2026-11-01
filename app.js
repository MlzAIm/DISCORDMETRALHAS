const $ = (selector) => document.querySelector(selector);
const store = { user: 'mh_user', messages: 'mh_messages', accounts: 'mh_accounts', channel: 'mh_channel' };
const colors = ['av-blue','av-purple','av-orange','av-pink'];
let user = read(store.user, null);
let channel = read(store.channel, 'geral');
let authMode = 'signup';
let replyTarget = null;
let stream = null;
let toastTimer;
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function initials(name) { return (name || 'M').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); }
function notify(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
function messagesFor(name=channel) { const all=read(store.messages,{}); return all[name] || []; }
function saveMessages(items, name=channel) { const all=read(store.messages,{}); all[name]=items; localStorage.setItem(store.messages,JSON.stringify(all)); }
function renderMessages() {
  const host=$('#messages'); host.innerHTML='';
  messagesFor().forEach((m,i)=>{
    if(m.system){ const row=document.createElement('div'); row.className='system-message'; row.innerHTML=`<span>✦</span>${escapeHtml(m.text)}`; host.append(row); return; }
    const row=document.createElement('article'); row.className='message';
    const tone=colors[m.tone||0]; row.innerHTML=`<div class="message-avatar ${tone}">${escapeHtml(m.initials)}</div><div class="message-body"><div class="message-head"><span class="message-name">${escapeHtml(m.name)}</span><span class="message-time">${escapeHtml(m.time)}</span></div><div class="message-text">${escapeHtml(m.text)}</div>${m.reply?`<div class="reply-quote">↳ ${escapeHtml(m.reply)}</div>`:''}</div><div class="message-actions"><button data-reply="${i}" title="Responder">↩</button></div>`; host.append(row);
  });
  host.querySelectorAll('[data-reply]').forEach(btn=>btn.addEventListener('click',()=>{const m=messagesFor()[Number(btn.dataset.reply)]; if(!m||m.system)return; replyTarget=m.name; $('#replyTo').textContent=m.name; $('#replyPreview').classList.remove('hidden'); $('#messageInput').focus();}));
  $('#chatScroll').scrollTop=$('#chatScroll').scrollHeight;
}
function renderProfile() { const name=user?.name||'Visitante'; $('#profileName').textContent=name; $('#memberName').textContent=name; $('#voiceUserName').textContent=name; $('#profileAvatar').childNodes[0].textContent=initials(name); $('#topAvatar').textContent=initials(name); $('#memberCount').textContent='1'; $('#callPeople').textContent='1 pessoa por aqui'; }
function setChannel(next) { channel=next; localStorage.setItem(store.channel,JSON.stringify(next)); document.querySelectorAll('.channel[data-channel]').forEach(b=>b.classList.toggle('selected',b.dataset.channel===next)); $('#channelTitle').textContent=next; $('#welcomeChannel').textContent=next; $('#messageInput').placeholder=`Conversar em #${next}`; $('#channelSubtitle').textContent=({geral:'o ponto de encontro da galera',memes:'memes, clips e pérolas',jogos:'combinando a próxima partida'})[next]||'o ponto de encontro da galera'; renderMessages(); }
document.querySelectorAll('.channel[data-channel]').forEach(b=>b.addEventListener('click',()=>setChannel(b.dataset.channel)));
$('#messageForm').addEventListener('submit',e=>{e.preventDefault(); const input=$('#messageInput'), text=input.value.trim(); if(!text)return; const arr=messagesFor(); arr.push({name:user?.name||'Visitante',initials:initials(user?.name||'M'),tone:0,time:new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date()),text,reply:replyTarget}); saveMessages(arr); input.value=''; replyTarget=null; $('#replyPreview').classList.add('hidden'); renderMessages();});
$('#cancelReply').addEventListener('click',()=>{replyTarget=null;$('#replyPreview').classList.add('hidden');});
function setAuth(mode) { authMode=mode; $('#authTitle').textContent=mode==='signup'?'Chega mais.':'Bom te ver de novo.'; $('#authDescription').textContent=mode==='signup'?'Crie sua conta rapidinho e vem pra resenha.':'Entre com seu e-mail e continue de onde parou.'; $('#authName').parentElement.classList.toggle('hidden',mode==='login'); $('#inviteLabel').classList.toggle('hidden',mode==='login'); $('#inviteCode').required=mode==='signup'; $('#authPassword').autocomplete=mode==='signup'?'new-password':'current-password'; $('#authForm .auth-submit').innerHTML=mode==='signup'?'Criar minha conta <span>→</span>':'Entrar <span>→</span>'; $('#toggleAuth').textContent=mode==='signup'?'Entrar':'Criar conta'; $('#authError').textContent=''; }
function openAuth() { setAuth('signup'); $('#authModal').classList.remove('hidden'); }
$('#signInButton').addEventListener('click',openAuth); $('#settingsButton').addEventListener('click',()=>{if(user){if(confirm('Sair da sua conta neste navegador?')){localStorage.removeItem(store.user);user=null;renderProfile();notify('Você saiu da conta.');}}else openAuth();});
$('#toggleAuth').addEventListener('click',()=>setAuth(authMode==='signup'?'login':'signup'));
$('#authForm').addEventListener('submit',e=>{e.preventDefault(); const email=$('#authEmail').value.trim().toLowerCase(), password=$('#authPassword').value, accounts=read(store.accounts,{}); if(authMode==='signup'){if(accounts[email]){$('#authError').textContent='Esse e-mail já tem uma conta. Entre nela.';return;}const name=$('#authName').value.trim();accounts[email]={name,password};localStorage.setItem(store.accounts,JSON.stringify(accounts));user={name,email};localStorage.setItem(store.user,JSON.stringify(user));}else{if(!accounts[email]||accounts[email].password!==password){$('#authError').textContent='E-mail ou senha não conferem.';return;}user={name:accounts[email].name,email};localStorage.setItem(store.user,JSON.stringify(user));}$('#authModal').classList.add('hidden');renderProfile();notify(`Boas-vindas à resenha, ${user.name}!`);});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).classList.add('hidden'))); $('#authModal').addEventListener('click',e=>{if(e.target.id==='authModal')e.currentTarget.classList.add('hidden');});
function joinCall(){ $('#callBanner').classList.remove('hidden'); $('#voiceMembers').classList.remove('hidden'); $('#callStatus').textContent='Áudio entre dispositivos ainda não disponível'; notify('Sala Resenha aberta neste protótipo.'); }
function leaveCall(){ $('#callBanner').classList.add('hidden'); $('#voiceMembers').classList.add('hidden'); if(stream) stopShare(); notify('Você saiu da call.'); }
$('#joinCall').addEventListener('click',joinCall); $('#voiceJoin').addEventListener('click',joinCall); $('#leaveCall').addEventListener('click',leaveCall);
async function startShare(){ if(!navigator.mediaDevices?.getDisplayMedia){notify('Compartilhamento de tela não está disponível neste navegador.');return;}try{joinCall();stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:true});$('#screenVideo').srcObject=stream;$('#screenPreview').classList.remove('hidden');$('#callStatus').textContent='Compartilhando sua tela';stream.getVideoTracks()[0].addEventListener('ended',stopShare);notify('Compartilhamento iniciado.');}catch(err){if(err.name!=='NotAllowedError')notify('Não foi possível iniciar o compartilhamento.');}}
function stopShare(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('#screenVideo').srcObject=null;$('#screenPreview').classList.add('hidden');$('#callStatus').textContent='Áudio entre dispositivos ainda não disponível';}
$('#shareScreen').addEventListener('click',startShare); $('#bannerScreen').addEventListener('click',startShare); $('#stopScreen').addEventListener('click',stopShare);
$('#inviteButton').addEventListener('click',()=>copyInvite()); $('#copyInvite').addEventListener('click',()=>copyInvite());
async function copyInvite(){if(window.MetralhaCloud?.enabled){notify('Envie o instalador e o código privado de convite que você cadastrou no Supabase.');return;}try{await navigator.clipboard.writeText(location.href);notify('Link copiado! Manda pro seu squad.');}catch{notify('Copie o endereço desta página para convidar seus amigos.');}}
$('#searchToggle').addEventListener('click',()=>{$('#searchBox').classList.toggle('hidden');if(!$('#searchBox').classList.contains('hidden'))$('#searchInput').focus();});
$('#searchInput').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.message').forEach(m=>m.style.display=m.textContent.toLowerCase().includes(q)?'':'none');});
$('#emojiButton').addEventListener('click',()=>{const input=$('#messageInput');input.value+=' 😄';input.focus();}); $('#attachButton').addEventListener('click',()=>notify('Anexos chegam em uma próxima versão.')); $('#serverMenu').addEventListener('click',()=>notify('Metralha Squad · espaço da galera')); document.querySelectorAll('.tiny-plus,.add-server').forEach(b=>b.addEventListener('click',()=>notify('Convide a galera para começar seu espaço.')));
renderProfile();setChannel(channel);if(!user)setTimeout(()=>{if(!read(store.user,null))$('#authModal').classList.remove('hidden');},700);
