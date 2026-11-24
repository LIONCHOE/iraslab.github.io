/* Shared league view. Match snapshots and MD exports use the existing badminton rules. */
(async function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const mid = params.get('meeting');
  const organizer = params.has('organize');
  const config = window.IRASLeagueConfig || {};
  const client = config.url && config.key ? window.supabase.createClient(config.url, config.key) : null;
  const R = window.IRASBadminton;
  const $ = s => document.querySelector(s);
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = id => {const u=new URL(location.pathname,location.origin);u.searchParams.set('meeting',id);return u.href;};
  async function checked(query) {const {data,error}=await query;if(error)throw Error(error.message);return data;}
  const rpc = (name,args) => checked(client.rpc('league_'+name,args));
  function action(fn) {return async event=>{event?.preventDefault();try{await fn(event);}catch(e){$('#league-message').textContent=e.message;}};}
  if (!mid) {
    const box=document.createElement('section');box.className='league-launch';
    document.querySelector('main').prepend(box);
    box.innerHTML='<strong>공유 모임</strong><div id="league-links"></div><span role="status" id="league-message"></span>';
    if(client) {
      await action(async()=>{const rows=await checked(client.from('league_meetings').select('id,closed,title:session->>title,date:session->>date').order('created_at',{ascending:false}).limit(8));
        $('#league-links').innerHTML=rows.map(r=>'<a href="'+esc(url(r.id))+'">'+esc(r.date+' · '+r.title)+(r.closed?' · 최종 결과':' · 경기 일정')+'</a>').join('')||'개설된 모임이 없습니다.';
      })();
    } else if(!organizer){box.remove();return;}
    if(!organizer)return;
    box.insertAdjacentHTML('beforeend','<form id="league-login"><label>개설자 이메일<input type="email" required autocomplete="username"></label><label>비밀번호<input type="password" required autocomplete="current-password"></label><button>개설자 로그인</button></form><button id="league-open" class="primary">편성한 모임 열기</button>');
    if(!client){$('#league-login').hidden=true;$('#league-open').disabled=true;$('#league-message').textContent='공유 모임을 열려면 Supabase 프로젝트 연결이 필요합니다.';return;}
    $('#league-login').onsubmit=action(async e=>{const [email,password]=e.target.querySelectorAll('input');await checked(client.auth.signInWithPassword({email:email.value,password:password.value}));password.value='';$('#league-message').textContent='로그인했습니다. 팀 편성과 대진 생성을 마친 뒤 모임을 여세요.';});
    $('#league-open').onclick=action(async()=>{
      const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>v.toString(16).padStart(2,'0')).join('');
      const s=window.leagueDraft?.();if(!s||s.matches.some(m=>m.finished||m.lineups))throw Error('경기 준비에서 편성 후 리그 대진을 만들어 주세요. 경기 시작 전에 개설할 수 있습니다.');
      const id=await rpc('open',{s:R.validate(s),entry_code:code});location.assign(url(id));
    });return;
  }

  const main=$('main');main.className='league-live';
  main.innerHTML='<section class="league-head"><div><p id="league-date"></p><h1 id="league-title">공유 모임</h1></div><span id="connection" role="status">연결 중</span><p id="summary"></p></section><nav aria-label="모임 보기"><button data-pane="games" aria-pressed="true">점수 입력</button><button data-pane="ranks" aria-pressed="false">현재 순위</button></nav><p id="league-message" role="status"></p><section id="games"><h2>코트별 다음 경기</h2><div id="upcoming"></div><div class="league-tools"><h2>경기 일정</h2><label>내 조 <select id="team-filter"><option value="">전체 조</option></select></label><label>코트 <select id="court-filter"><option value="">전체 코트</option></select></label></div><div id="schedule"></div></section><section id="ranks" hidden><h2>조 순위</h2><div id="rank-table"></div></section><div class="league-tools" id="actions" hidden><button id="print-league">경기지 인쇄</button><span id="host-code"></span><button id="close-league" hidden>모임 마감</button><button id="league-md" hidden>확정 기록 MD 다운로드</button></div><dialog id="league-dialog"><form id="score-form"><h2 id="game-title"></h2><div id="score-inputs"></div><label id="code-field">모임 코드<input id="entry-code" autocomplete="off" maxlength="16"></label><p id="score-status" role="status"></p><button type="button" id="cancel-score">닫기</button><button class="primary" id="save-score">결과 저장</button></form></dialog><section id="league-paper"></section>';
  if(!client){$('#connection').textContent='연결 설정 필요';return;}
  let row, session, hostCode, active, opener, subscribed=false, defaultPane=true;
  const joinedKey='league-writer-'+mid;
  const team=id=>session.teams.find(t=>t.id===id);
  const names=t=>t.players.map(id=>session.players.find(p=>p.id===id).name).join(' · ');
  function pane(v){$('#games').hidden=v!=='games';$('#ranks').hidden=v!=='ranks';main.querySelectorAll('[data-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pane===v)));}
  main.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>pane(b.dataset.pane));
  function gameButton(m,i){const label=m.teams.map(t=>esc(team(t).name)).join(' — ');
    return '<button class="league-game" data-game="'+esc(m.id)+'"><small>'+i+'경기 · '+m.slot+'차례 · 코트 '+m.court+'</small><strong>'+label+'</strong><span>'+(m.finished?m.result.join(' : ')+' · 기록 완료':'점수 입력')+'</span></button>';}
  function draw(){
    const games=session.matches,done=games.filter(m=>m.finished).length;
    $('#league-title').textContent=session.title;$('#league-date').textContent=session.date;
    $('#summary').textContent=session.players.length+'명 · '+session.teams.length+'조 · '+session.courts+'코트　|　'+done+' / '+games.length+'경기 완료';
    if($('#team-filter').options.length===1){for(const t of session.teams)$('#team-filter').add(new Option(t.name,t.id));for(let i=1;i<=session.courts;i++)$('#court-filter').add(new Option(i,i));}
    const upcoming=new Map();for(const m of games)if(!m.finished&&!upcoming.has(m.court))upcoming.set(m.court,m);
    $('#upcoming').innerHTML=[...upcoming.values()].map(m=>gameButton(m,games.indexOf(m)+1)).join('')||'모든 경기 결과가 입력되었습니다.';
    $('#schedule').innerHTML=games.map((m,i)=>(!$('#team-filter').value||m.teams.includes($('#team-filter').value))&&(!$('#court-filter').value||m.court===Number($('#court-filter').value))?gameButton(m,i+1):'').join('')||'해당 경기가 없습니다.';
    $('#rank-table').innerHTML='<table><thead><tr><th>순위</th><th>조</th><th>승</th><th>패</th><th>득실</th></tr></thead><tbody>'+R.standings(session).map(r=>'<tr>'+[r.rank,r.name,r.wins,r.losses,r.diff].map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    $('#actions').hidden=false;$('#close-league').hidden=!hostCode||row.closed;$('#league-md').hidden=!row.closed;
    $('#host-code').textContent=hostCode&&!row.closed?'입력 코드 '+hostCode:'';
    if(defaultPane&&row.closed)pane('ranks');defaultPane=false;
    if(row.closed){$('#league-message').textContent='마감된 모임 · 최종 결과';$('#league-dialog').open&&$('#league-dialog').close();}
    const qr=window.qrcode(0,'M');qr.addData(url(mid));qr.make();
    $('#league-paper').innerHTML='<header><div><h1>'+esc(session.title)+'</h1><p>'+esc(session.date)+' · '+session.teams.length+'조 · '+session.courts+'코트</p></div><figure>'+qr.createSvgTag({cellSize:4,margin:16})+'<figcaption>점수 입력 · 현재 순위</figcaption></figure></header><table><thead><tr><th>경기</th><th>차례 / 코트</th><th>우리 조</th><th>상대 조</th><th>점수</th></tr></thead><tbody>'+games.map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+m.slot+' / '+m.court+'</td>'+m.teams.map(id=>'<td><b>'+esc(team(id).name)+'</b> '+esc(names(team(id)))+'</td>').join('')+'<td>'+(m.finished?m.result.join(' : '):'_____ : _____')+'</td></tr>').join('')+'</tbody></table>';
  }
  async function refresh(){
    const data=await checked(client.from('league_meetings').select('*').eq('id',mid).single());
    if(row&&data.revision<row.revision)return;
    session=R.validate(data.session);row=data;draw();$('#connection').textContent=subscribed?'실시간 연결':'재연결 대기';
  }
  $('#team-filter').onchange=$('#court-filter').onchange=draw;
  main.addEventListener('click',e=>{const b=e.target.closest('[data-game]');if(!b||row.closed)return;
    opener=b;const m=row.session.matches.find(g=>g.id===b.dataset.game);active={id:m.id,version:m.version||0};
    $('#game-title').textContent=(session.matches.findIndex(g=>g.id===m.id)+1)+'경기 점수';
    $('#score-inputs').innerHTML=m.teams.map((id,i)=>'<label>'+esc(team(id).name)+'<small>'+esc(names(team(id)))+'</small><input type="number" min="0" max="30" inputmode="numeric" required value="'+(m.result?.[i]??'')+'"></label>').join('');
    $('#code-field').hidden=!!hostCode||sessionStorage.getItem(joinedKey)==='1';$('#score-status').textContent='';$('#league-dialog').showModal();$('#score-inputs input').focus();});
  $('#cancel-score').onclick=()=>$('#league-dialog').close();
  $('#league-dialog').onclose=()=>{const next=main.querySelector('[data-game="'+active?.id+'"]');(opener?.isConnected?opener:next)?.focus();};
  $('#score-form').onsubmit=async e=>{e.preventDefault();const btn=$('#save-score');btn.disabled=true;
    try{if(!navigator.onLine)throw Error('연결이 끊겼습니다. 입력값을 유지합니다.');
      {const auth=await checked(client.auth.getSession());if(!auth.session)await checked(client.auth.signInAnonymously());}
      if(!$('#code-field').hidden){await rpc('join',{mid,entry_code:$('#entry-code').value.trim()});sessionStorage.setItem(joinedKey,'1');$('#code-field').hidden=true;$('#entry-code').value='';}
      const [a,b]=[...$('#score-inputs').querySelectorAll('input')].map(el=>el.valueAsNumber);
      await rpc('score',{mid,game:active.id,a,b,expected:active.version});$('#league-dialog').close();$('#league-message').textContent='결과를 저장했습니다.';await refresh();
    }catch(e){let msg=e.message;if(msg.includes('코드')){$('#code-field').hidden=false;sessionStorage.removeItem(joinedKey);}
      if(msg.includes('최신 점수')){await refresh();const m=row.session.matches.find(g=>g.id===active.id);active.version=m.version||0;msg+=' 저장된 결과 '+(m.result||[]).join(' : ');}
      $('#score-status').textContent=msg;
    }finally{btn.disabled=false;}};
  $('#print-league').onclick=()=>window.print();
  $('#close-league').onclick=action(async()=>{if(confirm('모임을 마감하고 점수 입력을 종료할까요?')){await rpc('close',{mid});await refresh();pane('ranks');}});
  $('#league-md').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([R.markdown(session)],{type:'text/markdown'}));a.download=session.id+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  const sync=action(refresh);
  window.addEventListener('offline',()=>{$('#connection').textContent='오프라인';});window.addEventListener('online',sync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  client.channel('league-'+mid).on('postgres_changes',{event:'UPDATE',schema:'public',table:'league_meetings',filter:'id=eq.'+mid},sync).subscribe(status=>{subscribed=status==='SUBSCRIBED';if(subscribed)sync();else $('#connection').textContent='재연결 대기';});
  await action(async()=>{const auth=await checked(client.auth.getSession());if(auth.session)hostCode=await rpc('host_code',{mid});await refresh();})();
})();