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
  function action(fn) {return async event=>{event?.preventDefault();try{await fn(event);}catch(e){const status=$('#league-message');if(status)status.textContent=e.message;}};}
  async function showPublicPage(recent) {
    const main = $('main');
    if (recent) {
      main.innerHTML = `<section class="club-board"><h2>최근 기록</h2>
        <h3>진행 중인 모임</h3><div id="active-meetings"></div>
        <h3>최근 결과</h3><div id="past-meetings"></div>
        <p id="records-status" role="status">기록을 불러오는 중입니다.</p></section>`;
    } else {
      main.innerHTML = `<section class="club-board"><h2>개인 누적 순위</h2>
        <p class="club-note">관리자가 게시한 완료 모임의 성적을 합산합니다.</p>
        <div class="club-filters" role="group" aria-label="티어 필터">
          ${['전체','1티어','2티어','3티어'].map((name,i)=>'<button data-filter="'+i+'" aria-pressed="'+(i===0)+'">'+name+'</button>').join('')}
        </div><div id="club-ranks"></div><p id="records-status" role="status">순위를 불러오는 중입니다.</p></section>`;
    }
    main.hidden = false;
    let players = [], sessions = [], shared = [], tier = 0;
    const failures = [];
    async function get(path, format) {
      const response = await fetch(path, {cache:'no-store'});
      if (!response.ok) throw Error(path);
      return response[format]();
    }
    function drawRanks() {
      const ranked = R.individualStandings(sessions, players).rows;
      const ids = new Set(ranked.map(p=>p.id));
      const rows = ranked.concat(players.filter(p=>!ids.has(p.id))).filter(p=>!tier || p.tier===tier);
      $('#club-ranks').innerHTML = rows.length ? `<table><thead><tr><th>순위</th><th>선수</th><th>티어</th><th>누적 점수</th></tr></thead><tbody>${rows.map(p=>{
        const name = esc(R.displayName(p.name));
        const detail = p.rank ? `<details><summary>${name}</summary><small>참가 ${p.meetings}회 · 평균 ${p.average.toFixed(1)}점 · 우승 ${p.titles}회</small></details>` : name;
        return `<tr><td>${p.rank??'—'}</td><td>${detail}</td><td><span class="club-tier level-${p.tier}">${p.tier}티어</span></td><td>${p.rank?Number(p.points.toFixed(2)):'—'}</td></tr>`;
      }).join('')}</tbody></table>` : '<p>표시할 선수가 없습니다.</p>';
    }
    function drawRecent() {
      const published = new Map(sessions.map(s=>[s.id,s]));
      const link = r=>`<a class="club-record" href="${esc(url(r.id))}"><small>${esc(r.date)}</small><strong>${esc(r.title)}</strong></a>`;
      $('#active-meetings').innerHTML = shared.filter(r=>!r.closed).map(link).join('') || '<p>진행 중인 모임이 없습니다.</p>';
      const past = shared.filter(r=>r.closed && !published.has(r.sessionId)).map(r=>({date:r.date,html:link(r)}));
      for(const s of sessions){
        const names = new Map(s.teams.map(t=>[t.id,esc(t.name)]));
        const ranks = R.standings(s).map(t=>`<li>${t.rank}위 · ${esc(t.name)} · ${t.wins}승</li>`).join('');
        const games = s.matches.map(m=>`<li>${names.get(m.teams[0])} · ${names.get(m.teams[1])}<b>${m.finished?R.replay(s,m).score.join(' : '):'대기'}</b></li>`).join('');
        past.push({date:s.date,html:`<details class="club-result"><summary><small>${esc(s.date)}</small> ${esc(s.title)}</summary><h4>팀 순위</h4><ul>${ranks}</ul><h4>경기별 점수</h4><ul>${games}</ul></details>`});
      }
      $('#past-meetings').innerHTML = past.sort((a,b)=>b.date.localeCompare(a.date)).map(r=>r.html).join('') || '<p>아직 등록된 결과가 없습니다.</p>';
    }
    async function load(label, task) {
      try { await task(); } catch { failures.push(label); }
    }
    if(!recent) $('.club-filters').onclick = e=>{
      const button = e.target.closest('[data-filter]');
      if(!button)return;
      tier = Number(button.dataset.filter);
      for(const item of $('.club-filters').children)item.setAttribute('aria-pressed',String(item===button));
      drawRanks();
    };
    const records = load('게시 기록',async()=>{
      const index = R.index(await get('records.json','json'));
      for(let offset=0; offset<index.sessions.length; offset+=4){
        await Promise.all(index.sessions.slice(offset,offset+4).map(item=>load(item.title,async()=>{
          const s = R.fromMarkdown(await get(item.file,'text'));
          if(s.id!==item.id || s.date!==item.date)throw Error();
          sessions.push(s);
        })));
      }
    });
    const extra = recent ? load('공유 모임',async()=>{
      if (!client) throw Error();
      shared = await checked(client.from('league_meetings').select('id,closed,sessionId:session->>id,title:session->>title,date:session->>date').order('created_at',{ascending:false}).limit(100));
    }) : load('선수 명단',async()=>{ players = R.roster(await get('players.json','json')).players; drawRanks(); });
    await Promise.all([records,extra]);
    if(recent)drawRecent();else drawRanks();
    const status = $('#records-status');
    status.textContent = failures.length ? failures.join(', ')+' 조회에 실패했습니다. ' : recent?'':('완료 모임 '+sessions.filter(s=>s.matches.every(m=>m.finished)).length+'개 반영');
    if(failures.length){
      const retry = document.createElement('button');
      retry.textContent = '다시 시도'; retry.onclick = ()=>showPublicPage(recent); status.append(retry);
    }
  }
  if (!mid) {
    const recent = params.get('view')==='recent';
    const route = organizer?'host':recent?'recent':'ranks';
    $(`[data-route="${route}"]`).setAttribute('aria-current','page');
    if(!organizer){ await showPublicPage(recent); return; }
    document.body.classList.add('host-page','host-signed-out','host-locked');
  }
  $('main').hidden = false;
  if (!mid) {
    const box=document.createElement('section');box.className='league-launch';
    document.querySelector('main').prepend(box);
    box.innerHTML='<span role="status" id="league-message"></span>';
    box.insertAdjacentHTML('afterbegin',`
      <div class="host-access">
        <form id="league-login">
          <h2>개설자 로그인</h2>
          <label>아이디 또는 이메일<input name="identifier" type="text" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
          <label>비밀번호<input name="password" type="password" required autocomplete="current-password"></label>
          <button class="primary" type="submit">로그인</button>
        </form>
        <div id="host-session" hidden>
          <div class="host-account"><span id="host-email"></span><button type="button" id="host-logout">로그아웃</button></div>
          <details id="host-alias" hidden>
            <summary>로그인 아이디 등록</summary>
            <form id="alias-form">
              <label for="alias-input">사용할 아이디</label>
              <small id="alias-hint">영문자로 시작하는 3~24자. 영문, 숫자, 밑줄을 사용할 수 있습니다.</small>
              <input id="alias-input" name="alias" required minlength="3" maxlength="24" pattern="[A-Za-z][A-Za-z0-9_]{2,23}" aria-describedby="alias-hint" autocomplete="off" autocapitalize="none" spellcheck="false">
              <button type="submit">아이디 등록</button>
            </form>
          </details>
          <h2 id="host-phase"></h2><p id="host-next"></p>
          <button type="button" id="host-prepare">팀 편성하기</button>
          <button type="button" id="reload-draft" hidden>최신 대진 불러오기</button>
          <button type="button" id="league-open" class="primary">공유 모임 개설</button>
        </div>
      </div>`);
    const form=$('#league-login'),openButton=$('#league-open');
    let hostUser=null, opening=false, accountId=null, profileState='pending';
    function updateDraft(){
      const draft=window.leagueDraft?.();
      const ready=draft && !draft.matches.some(m=>m.lineups||m.finished);
      const stale=window.leagueDraftCurrent?.()===false;
      $('#reload-draft').hidden=!hostUser||!stale;
      openButton.disabled=!hostUser||!ready||opening||stale;
      $('#host-prepare').hidden=!hostUser||!!ready;
      if(accountId && !hostUser){
        $('#host-phase').textContent=profileState==='pending'?'권한 확인 중':'개설 권한을 확인하세요';
        $('#host-next').textContent=profileState==='pending'?'':profileState==='denied'?'등록된 개설자 계정으로 로그인해 주세요.':'페이지를 새로고침하여 다시 시도해 주세요.';
        return;
      }
      if(stale && hostUser){
        $('#host-phase').textContent='저장된 대진을 다시 확인해 주세요';
        $('#host-next').textContent='최신 대진을 불러온 뒤 공유 모임을 개설하세요.';
        return;
      }
      $('#host-phase').textContent=ready?'모임을 열 준비가 됐습니다':'경기 준비';
      $('#host-next').textContent=ready?draft.title+' · '+draft.teams.length+'조 · '+draft.matches.length+'경기':'참석자를 선택하고 팀을 편성한 뒤 대진을 만들어 주세요.';
    }
    let profileVersion=0;
    async function showAccount(user){
      const id=user?.email&&!user.is_anonymous?user.id:null;
      if(id && id===accountId)return;
      accountId=id;
      const version=++profileVersion;
      hostUser=null;profileState='pending';
      document.body.classList.add('host-locked');
      form.hidden=!!id;
      $('#host-session').hidden=!id;
      document.body.classList.toggle('host-signed-out',!id);
      $('#host-email').textContent=id?user.email:'';
      const panel=$('#host-alias');
      panel.hidden=true;panel.open=false;$('#alias-form').reset();
      updateDraft();
      if(!id)return;
      const {data,error}=await client.rpc('league_organizer_profile');
      if(version!==profileVersion)return;
      // During rollout the original league_open RPC still enforces the organizer list.
      if(error?.code==='PGRST202'){
        hostUser=user;
      }else if(error || !data){
        profileState=error?'error':'denied';
      }else{
        hostUser=user;
        panel.hidden=!!data.alias;
        if(data.alias)$('#host-email').textContent='로그인 아이디 · '+data.alias;
      }
      const returnMeeting = params.get('returnMeeting');
      if (hostUser && /^meet-[a-zA-Z0-9-]{1,74}$/.test(returnMeeting)) {
        location.replace(url(returnMeeting));
        return;
      }
      document.body.classList.toggle('host-locked', !hostUser);
      updateDraft();
    }
    if(!client){form.querySelector('button').disabled=true;$('#league-message').textContent='공유 모임을 열려면 Supabase 프로젝트 연결이 필요합니다.';return;}
    // Release the Auth client lock before making an authenticated RPC request.
    client.auth.onAuthStateChange((_event,session)=>{setTimeout(action(()=>showAccount(session?.user)),0);});
    await action(async()=>showAccount((await checked(client.auth.getSession())).session?.user))();
    form.onsubmit=action(async e=>{
      const {identifier,password}=e.target.elements;
      const submit=form.querySelector('[type=submit]');
      submit.disabled=true;submit.textContent='로그인 중…';
      try{
        const login=identifier.value.trim();
        let result;
        if(login.includes('@')){
          result=await checked(client.auth.signInWithPassword({email:login,password:password.value}));
        }else{
          const {data,error}=await client.functions.invoke('organizer-login',{body:{alias:login,password:password.value}});
          if(error){
            const status=error.context?.status;
            if(status===429)throw Error('시도가 많습니다. 잠시 뒤 다시 로그인해 주세요.');
            if(status===401)throw Error('아이디와 비밀번호를 확인하세요.');
            throw Error('아이디 로그인에 연결할 수 없습니다. 기존 이메일로 로그인해 주세요.');
          }
          result=await checked(client.auth.setSession(data));
        }
        password.value='';$('#league-message').textContent='';await showAccount(result.user);
      }finally{submit.disabled=false;submit.textContent='로그인';}
    });
    $('#alias-form').onsubmit=action(async e=>{
      const input=e.target.elements.alias, submit=e.target.querySelector('button');
      const version=profileVersion;
      submit.disabled=true;
      try{
        const alias=await rpc('register_alias',{requested_alias:input.value.trim()});
        if(version!==profileVersion)return;
        $('#host-alias').hidden=true;
        $('#host-email').textContent='로그인 아이디 · '+alias;
        $('#league-message').textContent='아이디를 등록했습니다. 다음부터 기존 비밀번호와 함께 사용하세요.';
        $('#host-logout').focus();
      }finally{submit.disabled=false;}
    });
    $('#host-logout').onclick=action(async()=>{await checked(client.auth.signOut({scope:'local'}));await showAccount(null);$('#league-message').textContent='';form.elements.identifier.focus();});
    $('#host-prepare').onclick=()=>{$('[data-tab="setup"]').click();$('#setup').scrollIntoView({block:'start'});};
    $('#reload-draft').onclick=()=>location.reload();
    window.addEventListener('storage',updateDraft);
    window.addEventListener('pageshow',updateDraft);
    new MutationObserver(updateDraft).observe($('#match-list'),{childList:true});
    openButton.onclick=action(async()=>{
      updateDraft();
      if(openButton.disabled)return;
      opening=true;updateDraft();
      try{
        const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>v.toString(16).padStart(2,'0')).join('');
        const s=window.leagueDraft?.();if(!s||s.matches.some(m=>m.finished||m.lineups))throw Error('경기 준비에서 편성 후 리그 대진을 만들어 주세요. 경기 시작 전에 개설할 수 있습니다.');
        const submitted=R.validate(s);
        const id=await rpc('open',{s:submitted,entry_code:code});
        try{
          window.completeLeagueDraft?.(submitted);
        }finally{
          location.assign(url(id));
        }
      }finally{opening=false;updateDraft();}
    });return;
  }

  const main=$('main');main.className='league-live';
  main.innerHTML='<div class="meeting-bar"><a class="back-link" href="?view=recent">← 최근 기록</a><div id="meeting-management" hidden><span>모임 관리</span><a id="manage-login">개설자 로그인</a><button id="cancel-league" type="button" class="danger" hidden>모임 취소·제거</button></div></div><section class="league-head"><div><p id="league-date"></p><h1 id="league-title">공유 모임</h1></div><span id="connection" role="status">연결 중</span><p id="summary"></p></section><nav aria-label="모임 보기"><button data-pane="games" aria-pressed="true">점수 입력</button><button data-pane="ranks" aria-pressed="false">현재 순위</button></nav><p id="league-message" role="status"></p><button type="button" id="access-retry" hidden>다시 시도</button><section id="games" class="sheet-layout"><section><h2 id="matrix-heading">전체 대진표</h2><p id="matrix-help"></p><div id="score-matrix" tabindex="0" role="region" aria-labelledby="matrix-heading" aria-describedby="matrix-help"></div></section><section class="order-panel"><h2>대진 순서표</h2><details class="order-filters"><summary>일정 필터</summary><div class="league-tools"><label>내 조 <select id="team-filter"><option value="">전체 조</option></select></label></div></details><div class="order-frame"><table class="sheet-order" id="order-table"></table></div><h2>조별 팀원</h2><ul class="sheet-roster" id="team-roster"></ul></section></section><section id="ranks" hidden><h2>조 순위</h2><div id="rank-table"></div></section><div class="league-tools" id="actions" hidden><button id="print-league" disabled>경기지 인쇄</button><span id="print-help"></span><button id="close-league" hidden>모임 마감</button><button id="league-md" hidden>확정 기록 MD 다운로드</button></div><dialog id="league-dialog" aria-labelledby="game-title"><form id="score-form"><h2 id="game-title"></h2><div id="score-inputs"></div><p id="score-status" role="status"></p><button type="button" id="cancel-score">닫기</button><button class="primary" id="save-score">점수 저장</button></form></dialog><section id="league-paper"></section>';
  $('#manage-login').href='?'+new URLSearchParams({organize:'1',returnMeeting:mid});
  if(!client){$('#connection').textContent='연결 설정 필요';return;}
  let row, session, hostCode, active, opener, subscribed=false, defaultPane=true;
  const entryCode = new URLSearchParams(location.hash.slice(1)).get('entry');
  let joined = false, accessReady = false, accessRequest;
  const retryAccess=$('#access-retry');
  retryAccess.textContent=entryCode===null?'권한 확인 다시 시도':'참가 다시 시도';
  const canScore = () => !row.closed && Boolean(hostCode || joined);
  const team=id=>session.teams.find(t=>t.id===id);
  const names=t=>t.players.map(id=>R.displayName(session.players.find(p=>p.id===id).name)).join(' · ');
  function pane(v){$('#games').hidden=v!=='games';$('#ranks').hidden=v!=='ranks';main.querySelectorAll('[data-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pane===v)));}
  main.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>pane(b.dataset.pane));
  function matchMatrix(print=false) {
    const {teams, matches} = session;
    const opponents = teams.slice(1);
    const matrix = teams.map((left, i) => {
      const cells = opponents.map((right, j) => {
        if (j < i) return '<td class="unused">—</td>';
        const match = matches.find(m => m.teams.includes(left.id) && m.teams.includes(right.id));
        if (!match) return '<td>—</td>';
        const score = match.finished ? R.replay(session, match).score : null;
        const value = score && [left.id, right.id].map(id => score[match.teams.indexOf(id)]).join(' : ');
        if(print) return '<td class="score-cell">'+(value || '　:　')+'</td>';
        const editable = canScore();
        const label = value || (editable?'＋ 입력':'대기');
        const action = editable ? (score?' 점수 수정':' 점수 입력') : '';
        return '<td><button type="button" data-game="'+esc(match.id)+'" data-left="'+esc(left.id)+'" aria-label="'+esc(left.name+' 대 '+right.name+' '+label+action)+'"'+(editable?'':' disabled')+'>'+label+'</button></td>';
      }).join('');
      return '<tr><th scope="row">'+esc(left.name)+'</th>'+cells+'</tr>';
    }).join('');
    return `<table class="${print?'paper-matrix':'match-grid'}"><thead><tr><th scope="col">조</th>${opponents.map(t=>'<th scope="col">'+esc(t.name)+'</th>').join('')}</tr></thead><tbody>${matrix}</tbody></table>`;
  }
  function printSheet(qrLink) {
    const {teams} = session;
    const order=R.printOrder ? R.printOrder(session) : R.sheetOrder(session,session.matches,(_match,label)=>label);
    return `<header><h1>${esc(session.title)}</h1><p>${esc(session.date)} · ${teams.length}조</p></header>
      <div class="paper-columns"><section><h2>전체 대진표</h2><p>점수는 왼쪽 조 : 위쪽 조 순서로 적으세요.</p>
      ${matchMatrix(true)}</section>
      <section><h2>대진 순서표</h2><table class="paper-order">${order}</table>
      <h2>조별 팀원</h2><div class="roster-share"><ul class="paper-roster">${R.sheetRoster(session)}</ul>${qrLink}</div></section></div>`;
  }
  function draw(){
    $('#print-league').disabled=true;
    const games=session.matches,done=games.filter(m=>m.finished).length;
    $('#league-title').textContent=session.title;$('#league-date').textContent=session.date;
    $('#summary').textContent=session.players.length+'명 · '+session.teams.length+'조　|　'+done+' / '+games.length+'경기 완료';
    if($('#team-filter').options.length===1){for(const t of session.teams)$('#team-filter').add(new Option(t.name,t.id));}
    $('#team-roster').innerHTML=R.sheetRoster(session);
    const matrixFocus = $('#score-matrix').contains(document.activeElement) && document.activeElement.dataset.game;
    $('#score-matrix').innerHTML=matchMatrix();
    if(matrixFocus)$('#score-matrix').querySelector('[data-game="'+CSS.escape(matrixFocus)+'"]')?.focus({preventScroll:true});
    $('#matrix-help').textContent=canScore()?'두 조가 만나는 칸을 눌러 점수를 입력하거나 수정하세요. 왼쪽 조 점수가 먼저 표시됩니다.':'점수는 왼쪽 조, 위쪽 조 순서입니다.';
    const filtered=games.filter(m=>!$('#team-filter').value||m.teams.includes($('#team-filter').value));
    $('#order-table').innerHTML=R.sheetOrder(session,filtered,(m,label)=>canScore()?'<button type="button" class="pair-link" data-game="'+esc(m.id)+'" aria-haspopup="dialog">'+label+'</button>':label);
    $('#rank-table').innerHTML='<table><thead><tr><th>순위</th><th>조</th><th>승</th><th>패</th><th>득실</th></tr></thead><tbody>'+R.standings(session).map(r=>'<tr>'+[r.rank,r.name,r.wins,r.losses,r.diff].map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    $('#actions').hidden=false;$('#close-league').hidden=!hostCode||row.closed;$('#meeting-management').hidden=row.closed;$('#manage-login').hidden=Boolean(hostCode)||!$('#manage-login').hasAttribute('href');$('#cancel-league').hidden=!hostCode||row.closed;$('#league-md').hidden=!row.closed;
    $('[data-pane="games"]').textContent=canScore()?'경기 일정·점수':'경기 일정';
    if(defaultPane&&row.closed)pane('ranks');defaultPane=false;
    if(row.closed){$('#league-message').textContent='마감된 모임 · 최종 결과';$('#league-dialog').open&&$('#league-dialog').close();}
    if(!row.closed && !accessReady){
      $('#print-help').textContent='권한 확인 후 QR을 인쇄할 수 있습니다.';
      $('#league-paper').innerHTML=printSheet('');
      return;
    }
    const printUrl=new URL(url(mid));
    if(hostCode && !row.closed)printUrl.hash=new URLSearchParams({entry:hostCode}).toString();
    const qr=window.qrcode(0,'M');qr.addData(printUrl.href);qr.make();
    const svg=qr.createSvgTag({cellSize:4,margin:16});
    const label=row.closed?'최종 결과 보기':printUrl.hash?'점수 입력 · 현재 순위':'경기 일정 · 순위';
    const paper=$('#league-paper');
    paper.innerHTML=printSheet('<a class="meeting-qr" href="'+esc(printUrl.href)+'">'+svg+'<span>'+label+'</span></a>');
    paper.querySelector('.meeting-qr svg').setAttribute('aria-hidden','true');
    $('#print-help').textContent=printUrl.hash?'점수 입력용 QR':'조회용 QR';
    $('#print-league').disabled=false;
  }
  let removed = false;
  function showRemoved() {
    removed = true;
    main.innerHTML = '<section class="league-head"><div><h1>모임을 찾을 수 없습니다</h1><p>취소되었거나 유효하지 않은 모임입니다.</p><a href="?view=recent">최근 기록 보기</a></div></section>';
  }
  async function refresh(){
    if(removed)return;
    const result=await client.from('league_meetings').select('*').eq('id',mid).single();
    if(removed)return;
    if(result.error?.code==='PGRST116'){showRemoved();return;}
    if(result.error)throw Error(result.error.message);
    const data=result.data;
    if(row&&data.revision<row.revision)return;
    session=R.validate(data.session);row=data;draw();$('#connection').textContent=subscribed?'실시간 연결':'재연결 대기';
  }
  $('#team-filter').onchange=draw;
  main.addEventListener('click',e=>{const b=e.target.closest('[data-game]');if(!b||!canScore())return;
    opener=b;const m=row.session.matches.find(g=>g.id===b.dataset.game);active={id:m.id,version:m.version||0};
    $('#game-title').textContent=m.slot+'차례 · 점수 입력';
    const sides=b.dataset.left===m.teams[1]?[1,0]:[0,1];
    const score=m.finished?R.replay(session,m).score:null;
    $('#score-inputs').innerHTML=sides.map(i=>{const id=m.teams[i];return '<label><strong>'+esc(team(id).name)+'</strong><small>'+esc(names(team(id)))+'</small><input name="side'+i+'" placeholder="—" type="number" min="0" max="30" inputmode="numeric" required value="'+(score?.[i]??'')+'"></label>';}).join('');
    $('#score-status').textContent='';$('#league-dialog').showModal();$('#score-inputs input').focus();$('#score-inputs input').select();});
  $('#cancel-score').onclick=()=>$('#league-dialog').close();
  $('#league-dialog').onclose=()=>{const group=opener?.hasAttribute('data-left')?$('#score-matrix'):main;const next=group?.querySelector('[data-game="'+active?.id+'"]');(opener?.isConnected?opener:next)?.focus();};
  $('#score-form').onsubmit=async e=>{e.preventDefault();const btn=$('#save-score');btn.disabled=true;
    try{if(!navigator.onLine)throw Error('연결이 끊겼습니다. 입력값을 유지합니다.');
      const {side0,side1}=e.target.elements;
      const a=side0.valueAsNumber, b=side1.valueAsNumber;
      await rpc('score',{mid,game:active.id,a,b,expected:active.version});$('#league-dialog').close();$('#league-message').textContent='결과를 저장했습니다.';await refresh();
    }catch(e){let msg=e.message;
      if(msg.includes('최신 점수')){await refresh();const m=row.session.matches.find(g=>g.id===active.id);active.version=m.version||0;if(m.finished){const saved=R.replay(session,m).score;msg+=' 저장된 결과 '+[...$('#score-inputs').querySelectorAll('input')].map(input=>saved[input.name==='side0'?0:1]).join(' : ');}}
      $('#score-status').textContent=msg;
    }finally{btn.disabled=false;}};
  $('#print-league').onclick=()=>window.print();
  $('#cancel-league').onclick=action(async()=>{
    if(!hostCode || row.closed || !confirm('“'+session.title+'” 모임을 취소할까요? 입력한 모든 점수가 삭제되고 참가용 QR을 더 이상 사용할 수 없습니다.'))return;
    const button=$('#cancel-league');
    button.disabled=true;
    try {
      await rpc('cancel',{mid});
      location.replace('?view=recent');
    } finally { button.disabled=false; }
  });
  $('#close-league').onclick=action(async()=>{if(confirm('모임을 마감하고 점수 입력을 종료할까요?')){await rpc('close',{mid});await refresh();pane('ranks');}});
  $('#league-md').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([R.markdown(session)],{type:'text/markdown'}));a.download=session.id+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  async function resolveAccess(){
    retryAccess.hidden=true;
    const auth=await checked(client.auth.getSession());
    if(auth.session) {
      hostCode=await rpc('host_code',{mid});
      if(!hostCode && auth.session.user && !auth.session.user.is_anonymous) {
        $('#manage-login').hidden=true;
        $('#meeting-management span').textContent='모임 관리 · 이 모임의 개설자만 가능';
        $('#manage-login').removeAttribute('href');
      }
    }
    if(!hostCode && entryCode!==null){
      if(!/^[0-9a-f]{16}$/.test(entryCode))throw Error('점수 입력 QR을 다시 스캔해 주세요.');
      if(!auth.session){
        const {error}=await client.auth.signInAnonymously();
        if(error?.code==='anonymous_provider_disabled')throw Error('점수 입력을 열 수 없습니다. 개설자에게 익명 로그인 설정을 확인해 달라고 요청하세요.');
        if(error)throw Error(error.message);
      }
      await rpc('join',{mid,entry_code:entryCode});
      joined=true;
    }
    accessReady=true;
    if(!removed&&!row.closed){$('#league-message').textContent='';draw();}
  }
  const sync=action(async()=>{
    try{
      await refresh();
      if(removed)return;
      if(row.closed){retryAccess.hidden=true;return;}
      if(!accessReady){
        if(!accessRequest)accessRequest=resolveAccess().finally(()=>{accessRequest=null;});
        await accessRequest;
      }
    }catch(error){
      if(!removed && !accessReady)retryAccess.hidden=false;
      throw error;
    }
  });
  retryAccess.onclick=sync;
  window.addEventListener('offline',()=>{if(!removed)$('#connection').textContent='오프라인';});window.addEventListener('online',sync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  client.channel('league-'+mid)
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'league_meetings'},event=>{if(event.old?.id===mid)showRemoved();})
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'league_meetings',filter:'id=eq.'+mid},sync).subscribe(status=>{subscribed=status==='SUBSCRIBED';if(subscribed)sync();else if(!removed)$('#connection').textContent='재연결 대기';});
  await sync();
})();
