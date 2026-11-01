(() => {
  const config = window.METRALHA_CONFIG || {};
  const cloud = window.MetralhaCloud = { enabled: Boolean(config.supabaseUrl && config.supabaseAnonKey) };
  if (!cloud.enabled) return;
  if (!window.supabase?.createClient) { cloud.enabled=false; console.error('Supabase SDK did not load.'); return; }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const roomTopic = 'metralhahub-main-room';
  let current = null;
  let room = null;
  let localMedia = null;
  let screenMedia = null;
  let peers = new Map();
  let outputMuted = false;
  let heartbeatTimer = null;
  let messagesChannel = null;
  let renderedMessageIds = new Set();

  const $ = selector => document.querySelector(selector);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const announce = message => window.notify ? window.notify(message) : console.log(message);

  function updateProfile() {
    if (!current) return;
    user = current;
    localStorage.setItem('mh_user', JSON.stringify({ id: current.id, name: current.name, email: current.email }));
    if (window.renderProfile) window.renderProfile();
    $('#authModal')?.classList.add('hidden');
  }

  function messageToUi(row) {
    return { id: row.id, name: row.username, initials: row.username.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(), tone: 0,
      time: new Intl.DateTimeFormat('pt-BR', { hour:'2-digit', minute:'2-digit' }).format(new Date(row.created_at)), text: row.body };
  }

  function drawCloudMessages(rows) {
    const host = $('#messages');
    if (!host) return;
    const html = rows.map(row => {
      const m = messageToUi(row); renderedMessageIds.add(String(row.id));
      return `<article class="message"><div class="message-avatar av-blue">${safe(m.initials)}</div><div class="message-body"><div class="message-head"><span class="message-name">${safe(m.name)}</span><span class="message-time">${safe(m.time)}</span></div><div class="message-text">${safe(m.text)}</div></div></article>`;
    }).join('');
    host.innerHTML = html;
    $('#chatScroll').scrollTop = $('#chatScroll').scrollHeight;
  }

  cloud.loadMessages = async (target = channel || 'geral') => {
    if (!current) return;
    const { data, error } = await client.from('messages').select('id,username,body,created_at').eq('channel', target).order('created_at', { ascending:true }).limit(150);
    if (error) { announce('Não foi possível carregar as mensagens.'); console.error(error); return; }
    renderedMessageIds = new Set(); drawCloudMessages(data || []);
  };

  cloud.sendMessage = async (text) => {
    if (!current) return announce('Entre na sua conta para conversar.');
    const body = String(text).trim().slice(0, 2000);
    if (!body) return;
    const { error } = await client.from('messages').insert({ author_id: current.id, username: current.name, channel: channel || 'geral', body });
    if (error) { announce('Não foi possível enviar. Confira a conexão do app.'); console.error(error); }
  };

  cloud.submitAuth = async () => {
    const name = $('#authName').value.trim();
    const email = $('#authEmail').value.trim().toLowerCase();
    const password = $('#authPassword').value;
    const signup = !$('#authName').parentElement.classList.contains('hidden');
    $('#authError').textContent = '';
    let result;
    if (signup) result = await client.auth.signUp({ email, password, options:{ data:{ username:name, invite_code:$('#inviteCode').value.trim() } } });
    else result = await client.auth.signInWithPassword({ email, password });
    if (result.error) { $('#authError').textContent = result.error.message; return; }
    const session = result.data.session;
    if (!session) { announce('Confira seu e-mail para confirmar a conta e depois entre.'); return; }
    current = { id:session.user.id, email:session.user.email, name:session.user.user_metadata?.username || name || email.split('@')[0] };
    updateProfile();
    await cloud.loadMessages(channel || 'geral');
    announce(`Boas-vindas à resenha, ${current.name}!`);
  };

  async function sendSignal(peerId, data) {
    if (!room) return;
    await room.send({ type:'broadcast', event:'signal', payload:{ from:current.id, to:peerId, ...data } });
  }

  function createPeer(peerId, name) {
    if (peers.has(peerId)) return peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers:[{ urls:'stun:stun.l.google.com:19302' }] });
    const state = { pc, name, makingOffer:false, ignoreOffer:false, pendingCandidates:[], remoteStream:new MediaStream() };
    peers.set(peerId, state);
    if (localMedia) localMedia.getAudioTracks().forEach(track => pc.addTrack(track, localMedia));
    if (screenMedia) screenMedia.getVideoTracks().forEach(track => pc.addTrack(track, screenMedia));
    pc.onicecandidate = event => { if (event.candidate) sendSignal(peerId, { candidate:event.candidate }); };
    pc.ontrack = event => {
      const stream = event.streams[0];
      if (!stream) return;
      state.remoteStream = stream;
      showRemote(peerId, name, stream);
    };
    pc.onconnectionstatechange = () => {
      if (['failed','closed','disconnected'].includes(pc.connectionState)) {
        if (pc.connectionState !== 'disconnected') removePeer(peerId);
        $('#callStatus').textContent = pc.connectionState === 'failed' ? 'Uma conexão falhou; algumas redes precisam de TURN' : 'Reconectando…';
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        await sendSignal(peerId, { description:pc.localDescription });
      } catch (error) { console.warn('Negociação WebRTC:', error); }
      finally { state.makingOffer = false; }
    };
    return state;
  }

  function showRemote(peerId, name, stream) {
    const host = $('#remoteMedia');
    let tile = document.getElementById(`remote-${peerId}`);
    if (!tile) {
      tile = document.createElement('div'); tile.className = 'remote-tile'; tile.id = `remote-${peerId}`;
      tile.innerHTML = `<video autoplay playsinline></video><audio autoplay></audio><span>${safe(name)}</span><button class="fullscreen-screen" type="button" title="Tela cheia" aria-label="Ver compartilhamento em tela cheia">Tela cheia</button>`;
      host.append(tile);
    }
    const hasVideo = stream.getVideoTracks().some(track=>track.readyState==='live');
    const video = tile.querySelector('video');
    const audio = tile.querySelector('audio');
    video.srcObject = stream;
    video.muted = true;
    video.classList.toggle('audio-only', !hasVideo);
    tile.classList.toggle('sharing', hasVideo);
    audio.srcObject = stream;
    audio.muted = outputMuted;
    updateMemberCount();
  }

  function removePeer(peerId) {
    const state = peers.get(peerId);
    if (state) { state.pc.close(); peers.delete(peerId); }
    document.getElementById(`remote-${peerId}`)?.remove();
    document.getElementById(`voice-member-${peerId}`)?.remove();
    updateMemberCount();
  }

  async function toggleScreenFullscreen(button) {
    const tile = button.closest('.remote-tile');
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      // Keep the action button inside the fullscreen element so Escape/button both work.
      if (tile?.requestFullscreen) await tile.requestFullscreen({ navigationUI:'hide' });
      else throw new Error('Fullscreen API indisponível');
    } catch (error) {
      console.warn('Fullscreen da transmissão falhou:', error);
      announce('Não foi possível abrir a tela cheia. Tente novamente pelo botão da transmissão.');
    }
  }

  function tuneScreenSender(sender) {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.degradationPreference = 'maintain-framerate';
    parameters.encodings[0].maxBitrate = 4_000_000;
    parameters.encodings[0].maxFramerate = 30;
    sender.setParameters(parameters).catch(error => console.warn('Ajuste do vídeo compartilhado:', error));
  }

  function updateMemberCount() {
    const count = Math.min(15, peers.size + 1);
    $('#memberCount').textContent = String(count);
    $('#callPeople').textContent = `${count} ${count === 1 ? 'pessoa por aqui' : 'pessoas por aqui'}`;
  }

  cloud.toggleMute = () => {
    if (!localMedia) return;
    const enabled = localMedia.getAudioTracks().some(track=>track.enabled);
    localMedia.getAudioTracks().forEach(track=>track.enabled=!enabled);
    $('#muteMic').classList.toggle('muted', enabled);
    $('#muteMic').title = enabled ? 'Ativar microfone' : 'Silenciar microfone';
    $('#muteMic').setAttribute('aria-pressed', String(enabled));
    $('#muteMicLabel').textContent = enabled ? 'Microfone mutado' : 'Mutar microfone';
    $('#callStatus').textContent = enabled ? 'Microfone silenciado · P2P' : 'Microfone ativo · P2P';
  };

  cloud.toggleOutput = () => {
    outputMuted = !outputMuted;
    document.querySelectorAll('.remote-tile audio').forEach(audio => { audio.muted = outputMuted; });
    const button = $('#muteOutput');
    button.classList.toggle('muted', outputMuted);
    button.title = outputMuted ? 'Ativar áudio recebido' : 'Silenciar áudio recebido';
    button.setAttribute('aria-pressed', String(outputMuted));
    $('#muteOutputLabel').textContent = outputMuted ? 'Áudio silenciado' : 'Silenciar áudio';
  };

  $('#remoteMedia')?.addEventListener('click', async event => {
    const button = event.target.closest('.fullscreen-screen');
    if (!button) return;
    const tile = button.closest('.remote-tile');
    try {
      await toggleScreenFullscreen(button);
    } catch (error) {
      console.warn('Não foi possível abrir a tela cheia:', error);
      announce('Não foi possível abrir a tela cheia.');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    document.querySelectorAll('.fullscreen-screen').forEach(button => {
      const active = document.fullscreenElement === button.closest('.remote-tile');
      button.textContent = active ? 'Sair da tela cheia' : '⛶ Tela cheia';
      button.title = active ? 'Sair da tela cheia' : 'Tela cheia';
    });
  });

  async function onSignal({ payload }) {
    if (!current || !payload || payload.to !== current.id || payload.from === current.id) return;
    const presence = room?.presenceState()?.[payload.from]?.[0];
    const state = createPeer(payload.from, presence?.name || 'Amigo');
    const pc = state.pc;
    if (payload.description) {
      const description = payload.description;
      const collision = description.type === 'offer' && (state.makingOffer || pc.signalingState !== 'stable');
      state.ignoreOffer = collision && current.id < payload.from;
      if (state.ignoreOffer) return;
      if (collision) await pc.setLocalDescription({ type:'rollback' });
      await pc.setRemoteDescription(description);
      for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
      if (description.type === 'offer') { await pc.setLocalDescription(); await sendSignal(payload.from, { description:pc.localDescription }); }
    } else if (payload.candidate) {
      if (!pc.remoteDescription) state.pendingCandidates.push(payload.candidate);
      else try { await pc.addIceCandidate(payload.candidate); } catch (error) { if (!state.ignoreOffer) console.warn(error); }
    }
  }

  function refreshPresence() {
    if (!room || !current) return;
    const state = room.presenceState();
    const remotes = new Set();
    for (const [id, entries] of Object.entries(state)) {
      if (id === current.id) continue;
      remotes.add(id);
      createPeer(id, entries?.[0]?.name || 'Amigo');
      showVoiceMember(id, entries?.[0]?.name || 'Amigo');
    }
    for (const id of peers.keys()) if (!remotes.has(id)) removePeer(id);
    document.querySelectorAll('.remote-member').forEach(el=>{if(!remotes.has(el.dataset.peerId))el.remove();});
    updateMemberCount();
  }

  function showVoiceMember(id, name) {
    const list=$('#voiceMembers');
    if (!list || document.getElementById(`voice-member-${id}`)) return;
    const row=document.createElement('div'); row.className='remote-member'; row.dataset.peerId=id; row.id=`voice-member-${id}`;
    const initials=name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    row.innerHTML=`<div class="mini-avatar av-purple">${safe(initials)}</div><span>${safe(name)}</span><span class="voice-wave">▂▅▃</span>`;
    list.append(row);
  }

  cloud.joinCall = async () => {
    if (!current) { announce('Entre na sua conta antes de entrar na call.'); return; }
    if (room) return;
    try {
      const { data: admitted, error: admissionError } = await client.rpc('join_voice_room', { p_room:'main' });
      if (admissionError || !admitted) { announce('A sala já está cheia (limite: 15 pessoas) ou o backend ainda não está configurado.'); return; }
      localMedia = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }, video:false });
      heartbeatTimer = setInterval(() => client.rpc('heartbeat_voice_room', { p_room:'main' }), 30000);
      room = client.channel(roomTopic, { config:{ private:true, presence:{ key:current.id } } });
      room.on('broadcast', { event:'signal' }, onSignal);
      room.on('presence', { event:'sync' }, refreshPresence);
      room.on('presence', { event:'join' }, refreshPresence);
      room.on('presence', { event:'leave' }, refreshPresence);
      room.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await room.track({ name:current.name, joined_at:new Date().toISOString() });
          refreshPresence();
          if (Object.values(room.presenceState()).flat().length > 15) { announce('A sala já chegou ao limite de 15 pessoas.'); await cloud.leaveCall(); return; }
          $('#callBanner').classList.remove('hidden'); $('#voiceMembers').classList.remove('hidden');
          $('#callStatus').textContent='Microfone ativo · P2P';
          announce('Você entrou na call.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { announce('Não foi possível conectar à sala. Confira o backend.'); await cloud.leaveCall(); }
      });
    } catch (error) {
      await client.rpc('leave_voice_room', { p_room:'main' });
      clearInterval(heartbeatTimer); heartbeatTimer=null;
      if (localMedia) localMedia.getTracks().forEach(t=>t.stop()); localMedia=null;
      announce(error.name === 'NotAllowedError' ? 'Permita o acesso ao microfone para entrar na call.' : 'Não foi possível iniciar a call.');
      console.error(error);
    }
  };

  cloud.shareScreen = async () => {
    if (!room) await cloud.joinCall();
    if (!room) return;
    try {
      screenMedia = await navigator.mediaDevices.getDisplayMedia({ video:{ frameRate:{ ideal:30, max:30 }, width:{ ideal:1920, max:1920 }, height:{ ideal:1080, max:1080 } }, audio:false });
      $('#screenVideo').srcObject = screenMedia; $('#screenPreview').classList.remove('hidden');
      for (const { pc } of peers.values()) screenMedia.getVideoTracks().forEach(track=>tuneScreenSender(pc.addTrack(track,screenMedia)));
      $('#callStatus').textContent='Compartilhando sua tela com a call';
      screenMedia.getVideoTracks()[0].addEventListener('ended', cloud.stopScreen, { once:true });
    } catch (error) { if (error.name !== 'NotAllowedError') announce('Não foi possível compartilhar a tela.'); }
  };

  cloud.stopScreen = () => {
    if (screenMedia) {
      for (const { pc } of peers.values()) for (const sender of pc.getSenders()) if (sender.track?.kind === 'video') pc.removeTrack(sender);
      screenMedia.getTracks().forEach(track=>track.stop()); screenMedia=null;
    }
    $('#screenVideo').srcObject=null; $('#screenPreview').classList.add('hidden');
    if (room) $('#callStatus').textContent='Microfone ativo · P2P';
  };

  cloud.leaveCall = async () => {
    cloud.stopScreen();
    clearInterval(heartbeatTimer); heartbeatTimer=null;
    if (current) await client.rpc('leave_voice_room', { p_room:'main' });
    if (room) { try { await room.untrack(); await client.removeChannel(room); } catch {} room=null; }
    for (const id of [...peers.keys()]) removePeer(id);
    if (localMedia) localMedia.getTracks().forEach(track=>track.stop()); localMedia=null;
    $('#callBanner').classList.add('hidden'); $('#voiceMembers').classList.add('hidden');
    announce('Você saiu da call.');
  };

  const capture = (selector, action) => document.querySelector(selector)?.addEventListener('click', event => {
    if (!cloud.enabled) return;
    event.preventDefault(); event.stopImmediatePropagation(); action(event);
  }, true);
  $('#authForm')?.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); cloud.submitAuth(); }, true);
  $('#messageForm')?.addEventListener('submit', event => {
    if (!current) { event.preventDefault(); event.stopImmediatePropagation(); announce('Entre na sua conta para conversar.'); return; }
    event.preventDefault(); event.stopImmediatePropagation(); const input=$('#messageInput'); const text=input.value.trim(); if(text)cloud.sendMessage(text); input.value='';
  }, true);
  capture('#joinCall', cloud.joinCall); capture('#voiceJoin', cloud.joinCall); capture('#leaveCall', cloud.leaveCall);
  capture('#shareScreen', cloud.shareScreen); capture('#bannerScreen', cloud.shareScreen); capture('#stopScreen', cloud.stopScreen); capture('#muteMic', cloud.toggleMute); capture('#muteOutput', cloud.toggleOutput);
  $('#settingsButton')?.addEventListener('click', event => {
    if (!cloud.enabled || !current) return;
    event.preventDefault(); event.stopImmediatePropagation(); client.auth.signOut().then(()=>{ cloud.leaveCall(); current=null; user=null; localStorage.removeItem('mh_user'); location.reload(); });
  }, true);

  function subscribeMessages() {
    if (messagesChannel) return;
    messagesChannel = client.channel('metralhahub-messages').on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const row=payload.new;
      if (row.channel !== (channel || 'geral') || renderedMessageIds.has(String(row.id))) return;
      const rowEl=document.createElement('article'); rowEl.className='message'; const m=messageToUi(row);
      rowEl.innerHTML=`<div class="message-avatar av-blue">${safe(m.initials)}</div><div class="message-body"><div class="message-head"><span class="message-name">${safe(m.name)}</span><span class="message-time">${safe(m.time)}</span></div><div class="message-text">${safe(m.text)}</div></div>`;
      $('#messages').append(rowEl); renderedMessageIds.add(String(row.id)); $('#chatScroll').scrollTop=$('#chatScroll').scrollHeight;
    }).subscribe();
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) { current=null; user=null; return; }
    current = { id:session.user.id, email:session.user.email, name:session.user.user_metadata?.username || session.user.email.split('@')[0] };
    updateProfile(); subscribeMessages(); setTimeout(()=>cloud.loadMessages(channel || 'geral'),0);
  });
  document.querySelectorAll('.channel[data-channel]').forEach(button=>button.addEventListener('click',()=>setTimeout(()=>cloud.loadMessages(channel),0)));
})();
