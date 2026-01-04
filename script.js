// ===== Stato & util =====
const LS_KEY = 'bestia-counter-html-v11';

const state = {
    players: [],            // {id,name,total}
    pot: 0,                 // bestia corrente (piatto prossima mano)
    hands: [],              // [{ base, deltas:{playerId:+/-} }]
    history: [],            // undo stack
    locked: false,
    gameStake: 0,
    dealerIndex: 0,
    round: {
        active: false,
        dealerId: null,
        basePot: 0,
        participants: new Set(),
        groups: [],               // [{id,name,memberIds:[]}]
        winners: [null,null,null] // entità vincenti (id player o group.id)
    }
};

const uid = () => Math.random().toString(36).slice(2,9);
const currency = n => (isNaN(n)? '-' : n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
const $  = id => document.getElementById(id);
const on = (el,ev,fn)=> el && el.addEventListener(ev,fn);

// ===== Persistenza =====
function save(){
    localStorage.setItem(LS_KEY, JSON.stringify({
        players: state.players,
        pot: state.pot,
        hands: state.hands,
        locked: state.locked,
        gameStake: state.gameStake,
        dealerIndex: state.dealerIndex
    }));
}
function load(){
    const s = localStorage.getItem(LS_KEY); if(!s) return;
    try{
        const v = JSON.parse(s);
        state.players = (v.players||[]).map(p=>({...p,total:+p.total||0}));
        state.pot = +v.pot||0;
        state.hands = v.hands||[];
        state.locked = !!v.locked;
        state.gameStake = +v.gameStake||0;
        state.dealerIndex = Number.isInteger(v.dealerIndex)? v.dealerIndex : 0;
        recomputeTotals();
    }catch{}
}
function recomputeTotals(){
    state.players.forEach(p=>p.total=0);
    state.hands.forEach(h=>{
        for(const id in h.deltas){
            const pl = state.players.find(p=>p.id===id);
            if(pl) pl.total += h.deltas[id];
        }
    });
}

// ===== Undo =====
function addHistory(inv){ state.history.unshift(inv); if(state.history.length>200) state.history.pop(); }
function undo(){ const f=state.history.shift(); if(f){ f(); render(); save(); } }

// ===== Helpers =====
const currentDealer = ()=> state.players.length? state.players[state.dealerIndex%state.players.length] : null;
const nameOf = id => state.players.find(p=>p.id===id)?.name || id;
const entOf  = pid => (state.round.groups.find(g=>g.memberIds.includes(pid))?.id) || pid;

function canEditPlayers(){
    return !state.round.active && Number(state.pot.toFixed(2)) === 0;
}

function randomSplit(amountEuro, ids){
    const cents = Math.round(+amountEuro*100), n=ids.length; if(n===0) return {};
    const base = Math.floor(cents/n); let rem=cents-base*n;
    const shuffled=[...ids].sort(()=>Math.random()-0.5);
    const out={}; shuffled.forEach(id=>out[id]=base);
    for(let i=0;i<rem;i++) out[shuffled[i%shuffled.length]]++;
    Object.keys(out).forEach(k=> out[k]/=100);
    return out;
}

function combinations(arr,size){
    const out=[]; (function rec(s,c){
        if(c.length===size){out.push(c.slice());return;}
        for(let i=s;i<arr.length;i++){ c.push(arr[i]); rec(i+1,c); c.pop(); }
    })(0,[]); return out;
}

function currentNonParticipants(){
    const all= state.players.map(p=>p.id);
    const parts=[...state.round.participants];
    return all.filter(id=>!parts.includes(id));
}

function getRoundEntitiesLabeled(){
    const entIds=[...new Set([...state.round.participants].map(entOf))];
    return entIds.map(eid=>{
        const g=state.round.groups.find(g=>g.id===eid);
        return g ? {id:eid,label:g.memberIds.map(nameOf).join('/')} : {id:eid,label:nameOf(eid)};
    });
}

function setWinnersTitles(){
    const vs = getRoundEntitiesLabeled().map(e=>e.label).join(' vs ');
    const safe = vs || '–';
    $('hand1Title').textContent = `1ª mano: ${safe}`;
    $('hand2Title').textContent = `2ª mano: ${safe}`;
    $('hand3Title').textContent = `3ª mano: ${safe}`;
}

// ordine di scelta: dal giocatore DOPO il mazziere fino al mazziere
function orderedForChoice(){
    const n = state.players.length;
    if (n === 0) return [];
    const start = (state.dealerIndex + 1) % n;
    const out = [];
    for (let k=0;k<n;k++) out.push(state.players[(start + k) % n]);
    return out;
}

// ===== Azioni giocatori =====
function addPlayer(name){
    if(state.locked) return;
    if(!canEditPlayers()) { alert('Puoi aggiungere giocatori solo quando la Bestia è € 0,00.'); return; }
    const nm=(name||'').trim(); if(!nm) return;
    const p={id:uid(),name:nm,total:0}; state.players.push(p);
    addHistory(()=>{ state.players=state.players.filter(x=>x.id!==p.id); recomputeTotals(); });
    render(); save();
}

function removePlayer(id){
    if(state.locked) return;
    if(!canEditPlayers()) { alert('Puoi modificare i giocatori solo quando la Bestia è € 0,00.'); return; }
    const i=state.players.findIndex(p=>p.id===id); if(i<0) return;
    const r=state.players[i]; state.players.splice(i,1);
    // sistema dealerIndex
    state.dealerIndex = Math.min(state.dealerIndex, Math.max(0, state.players.length-1));
    addHistory(()=>{ state.players.push(r); recomputeTotals(); });
    recomputeTotals();
    render(); save();
}

function lockPlayers(){
    if(state.locked) return;
    const cur = $('gameStakeInput') ? String($('gameStakeInput').value || '0.30') : '0.30';
    const ans = prompt('Imposta la posta fissa del mazziere (es. 0,30):', cur);
    if(ans===null) return;
    const num = Number(String(ans).replace(',','.'));
    if(!isFinite(num)||num<0){ alert('Valore non valido.'); return; }
    state.gameStake=+num.toFixed(2); state.locked=true;
    if($('gameStakeInput')){
        $('gameStakeInput').value=state.gameStake.toFixed(2);
        $('gameStakeInput').disabled=true;
    }
    addHistory(()=>{
        state.locked=false; state.gameStake=0;
        if($('gameStakeInput')) $('gameStakeInput').disabled=false;
    });
    render(); save();
}

// ===== Turno =====
function startRound(){
    if(state.round.active||state.players.length===0) return;
    if(!state.locked) lockPlayers();
    const dealer=currentDealer(); if(!dealer) return;

    const base = state.pot>0 ? state.pot : state.gameStake;
    if(base<=0) return;

    state.round = {
        active:true,
        dealerId: dealer.id,
        basePot: base,
        participants:new Set(),
        groups:[],
        winners:[null,null,null]
    };

    // mostra bestia corrente
    state.pot = base;

    addHistory(()=>{
        state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    });

    openParticipantsModal();
    render();
    save();
}

// Step 1: partecipanti (in ordine)
function openParticipantsModal(){
    const list=$('participantsList'); list.innerHTML='';
    orderedForChoice().forEach(p=>{
        const card=document.createElement('div');
        card.className='choice';
        card.dataset.pid=p.id;
        card.textContent=p.name;

        const sel=state.round.participants.has(p.id);
        if(sel) card.classList.add('selected');

        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.checked=sel;
        card.appendChild(cb);

        card.addEventListener('click',()=>{
            const was=state.round.participants.has(p.id);
            was ? state.round.participants.delete(p.id) : state.round.participants.add(p.id);
            card.classList.toggle('selected',!was);
            cb.checked=!was;
        });

        list.appendChild(card);
    });

    $('participantsModal').showModal();
}

// Step 2: non partecipanti – rientri/gruppi (persistenti + toggle + cestino + indietro)
function openNonParticipantsModal(){
    const sizeWrap   = $('npSizeWrap');
    const combosWrap = $('npGroupCombos');
    const soloWrap   = $('npSoloList');

    // box gruppi selezionati (creato una volta)
    let selectedList = $('npSelectedList');
    if (!selectedList){
        const h = document.createElement('div');
        h.className = 'small muted';
        h.style.margin = '10px 0 6px';
        h.textContent = 'Gruppi selezionati';

        selectedList = document.createElement('div');
        selectedList.id = 'npSelectedList';
        selectedList.className = 'list';

        combosWrap.parentElement.appendChild(h);
        combosWrap.parentElement.appendChild(selectedList);
    }

    const sameSet = (a,b) => a.length===b.length && a.every(x=>b.includes(x));
    const inAnyGroup = pid => state.round.groups.some(g=>g.memberIds.includes(pid));

    let selectedSize = null;

    function buildSizeChips(){
        const nonp = currentNonParticipants();
        const maxSize = nonp.length;
        sizeWrap.innerHTML = '';

        if (maxSize < 2){
            sizeWrap.innerHTML = `<div class="small muted">Nessun gruppo possibile.</div>`;
            selectedSize = null;
            return;
        }

        for (let s = 2; s <= maxSize; s++){
            const chip = document.createElement('div');
            chip.className = 'choice center';
            chip.dataset.size = String(s);
            chip.textContent = String(s);
            chip.addEventListener('click', ()=>{
                selectedSize = s; // una sola taglia
                renderAll();
            });
            sizeWrap.appendChild(chip);
        }

        // default: se non scelto, metti la max
        if (!selectedSize || selectedSize > maxSize) selectedSize = maxSize;
    }

    function renderChipsState(){
        const nonpCount = currentNonParticipants().length;
        sizeWrap.querySelectorAll('.choice').forEach(el=>{
            const s = Number(el.dataset.size);
            const enabled = s <= nonpCount;
            el.classList.toggle('selected', selectedSize === s);
            el.style.opacity = enabled ? 1 : .4;
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    function renderSolo(){
        soloWrap.innerHTML = '';
        const nonp = currentNonParticipants();

        if (nonp.length === 0){
            soloWrap.innerHTML = `<div class="small muted">Nessuno fuori.</div>`;
            return;
        }

        nonp.forEach(id=>{
            const item = document.createElement('div');
            item.className = 'choice';
            item.textContent = nameOf(id);

            const grouped = inAnyGroup(id);
            const selected = state.round.participants.has(id);

            item.classList.toggle('selected', selected || grouped);

            if (grouped){
                item.style.opacity = .5;
                item.title = 'Giocatore già incluso in un gruppo';
            } else {
                item.addEventListener('click', ()=>{
                    if (state.round.participants.has(id)) state.round.participants.delete(id);
                    else state.round.participants.add(id);
                    renderAll();
                });
            }

            soloWrap.appendChild(item);
        });
    }

    function renderSelectedList(){
        selectedList.innerHTML = '';
        if (state.round.groups.length === 0) return;

        state.round.groups.forEach(g=>{
            const card = document.createElement('div');
            card.className = 'choice center selected';
            card.textContent = g.memberIds.map(nameOf).join(' / ');

            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'btn-red icon-btn';
            rm.style.marginTop = '6px';
            rm.title = 'Rimuovi gruppo';
            rm.textContent = '🗑️';
            rm.addEventListener('click', (e)=>{
                e.preventDefault();
                e.stopPropagation();

                state.round.groups = state.round.groups.filter(x=>x.id!==g.id);

                g.memberIds.forEach(pid=>{
                    const stillGrouped = state.round.groups.some(gg=>gg.memberIds.includes(pid));
                    if (!stillGrouped) state.round.participants.delete(pid);
                });

                renderAll();
            });

            card.appendChild(rm);
            selectedList.appendChild(card);
        });
    }

    function renderCombos(){
        combosWrap.innerHTML = '';
        const nonp = currentNonParticipants();

        if (nonp.length < 2 || !selectedSize){
            combosWrap.innerHTML = `<div class="small muted">Seleziona una taglia per vedere le combinazioni.</div>`;
            return;
        }
        if (selectedSize > nonp.length){
            combosWrap.innerHTML = `<div class="small muted">Non ci sono abbastanza giocatori fuori.</div>`;
            return;
        }

        const title = document.createElement('div');
        title.className = 'small muted';
        title.style.margin = '8px 0 4px';
        title.textContent = `Combinazioni da ${selectedSize}`;
        combosWrap.appendChild(title);

        combinations(nonp, selectedSize).forEach(ids=>{
            const card = document.createElement('div');
            card.className = 'choice center';
            card.textContent = ids.map(nameOf).join(' / ');

            const existing = state.round.groups.find(g => sameSet(g.memberIds, ids));

            if (existing){
                card.classList.add('selected');
                card.title = 'Già selezionato';
                // non lo facciamo sparire, rimane visibile e selezionato
                card.style.opacity = 1;
            } else {
                const conflict = ids.some(inAnyGroup);
                if (conflict){
                    card.style.opacity = .5;
                    card.style.pointerEvents = 'none';
                    card.title = 'Conflitto con un gruppo già selezionato';
                } else {
                    card.title = 'Tocca per creare il gruppo';
                    card.addEventListener('click', ()=>{
                        const g = { id: uid(), name: ids.map(nameOf).join('/'), memberIds: ids.slice() };
                        state.round.groups.push(g);
                        ids.forEach(pid=> state.round.participants.add(pid));
                        renderAll();
                    });
                }
            }

            combosWrap.appendChild(card);
        });
    }

    function renderAll(){
        buildSizeChips();
        renderChipsState();
        renderSolo();
        renderCombos();
        renderSelectedList();
    }

    renderAll();
    $('npModal').showModal();
}

// Step 3: vincitori
function openWinnersModal(){
    const ents=getRoundEntitiesLabeled();
    if(ents.length<2){ alert('Servono almeno 2 entità per giocare la mano.'); return; }

    setWinnersTitles();

    function build(colId, idx){
        const box=$(colId); box.innerHTML='';
        ents.forEach(ent=>{
            const c=document.createElement('div');
            c.className='choice center';
            c.dataset.eid=ent.id;
            c.textContent=ent.label;

            const sel=state.round.winners[idx]===ent.id;
            c.classList.toggle('selected',sel);

            c.addEventListener('click',()=>{
                state.round.winners[idx]=ent.id;
                [...box.querySelectorAll('.choice')].forEach(el=>{
                    const ok=el.dataset.eid===String(ent.id);
                    el.classList.toggle('selected',ok);
                });
                validateWinnersConfirm();
            });

            box.appendChild(c);
        });
    }

    build('hand1',0);
    build('hand2',1);
    build('hand3',2);

    validateWinnersConfirm();
    $('winnersModal').showModal();
}

function validateWinnersConfirm(){
    $('winnersConfirm').disabled = !state.round.winners.every(x=>x!==null);
}

// ===== Chiusura mano =====
function settleAndClose(){
    const base=state.round.basePot; if(!state.round.active||base<=0) return;

    const participants=[...state.round.participants];
    const entities=[...new Set(participants.map(entOf))];

    const wins=state.round.winners.filter(Boolean).map(id => state.round.groups.find(g=>g.id===id)? id : entOf(id));
    const winCount={}; entities.forEach(e=>winCount[e]=0);
    wins.forEach(e=>{ if(e in winCount) winCount[e]+=1; });

    const losers=entities.filter(e=>(winCount[e]||0)===0);
    const everyoneTook = losers.length===0;

    const deltas={}, report=[];
    const membersOf = ent => (state.round.groups.find(g=>g.id===ent)?.memberIds || [ent]);

    // Premi
    entities.forEach(ent=>{
        const frac=(winCount[ent]||0)/3; if(frac<=0) return;
        const split=randomSplit(base*frac,membersOf(ent));
        Object.entries(split).forEach(([pid,amt])=>{
            report.push({id:pid,type:'win',amount:amt});
            deltas[pid]=(deltas[pid]||0)+amt;
        });
    });

    // Bestie
    if(!everyoneTook){
        losers.forEach(ent=>{
            const split=randomSplit(base,membersOf(ent));
            Object.entries(split).forEach(([pid,amt])=>{
                report.push({id:pid,type:'lose',amount:amt});
                deltas[pid]=(deltas[pid]||0)-amt;
            });
        });
    }

    // Posta mazziere (sempre, ma non la mostriamo come "mazziere" in UI)
    const dealer=currentDealer();
    if(dealer && state.gameStake>0){
        report.push({id:dealer.id,type:'dealer',amount:state.gameStake});
        deltas[dealer.id]=(deltas[dealer.id]||0)-state.gameStake;
    }

    // Prossima bestia
    const prevPot=state.pot;
    state.pot = everyoneTook ? 0 : (losers.length*base + state.gameStake);

    // Quote x/3 (senza label "mazziere")
    const fractionsStr=[...new Set(participants.map(entOf))].map(e=>{
        const c=(winCount[e]||0);
        const label=state.round.groups.find(g=>g.id===e)?.name || nameOf(e);
        return `<span class="tag">${label}: ${c}/3</span>`;
    }).join(' ');

    // Storico + totali
    state.hands.push({ base, deltas });
    recomputeTotals();

    addHistory(()=>{
        state.hands.pop();
        recomputeTotals();
        state.pot=prevPot;
        state.dealerIndex=(state.dealerIndex-1+Math.max(1,state.players.length))%Math.max(1,state.players.length);
    });

    // Chiudi round e ruota mazziere
    state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    if(state.players.length>0) state.dealerIndex=(state.dealerIndex+1)%state.players.length;

    showResult(report, base, losers.length, state.pot, fractionsStr);
    render(); save();
}

// caso: nessuno gioca la mano (giro a vuoto)
// bestia successiva = piatto presente + posta del mazziere
function settleNoPlayers(){
    const dealer = currentDealer();
    if (!dealer || state.gameStake <= 0) {
        state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
        render(); save();
        return;
    }

    const deltas = {};
    deltas[dealer.id] = -state.gameStake;

    state.hands.push({ base: state.round.basePot, deltas });
    recomputeTotals();

    addHistory(()=>{
        state.hands.pop();
        recomputeTotals();
        state.dealerIndex = (state.dealerIndex - 1 + state.players.length) % state.players.length;
    });

    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
    state.pot = Number((state.round.basePot + state.gameStake).toFixed(2));

    state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    render(); save();
}

// Riepilogo (senza "Mazziere: ...")
function showResult(items, base, nBestie, nextBase, fractionsStr){
    const wrap=$('resultSummary');
    const agg={};
    items.forEach(it=>{
        (agg[it.id] ??= ({win:0,lose:0,dealer:0}))[it.type]+=it.amount;
    });

    const rows=Object.entries(agg).map(([id,val])=>{
        let nm=nameOf(id);
        return `<tr>
      <td>${nm}</td>
      <td class="right">€ ${currency(val.win||0)}</td>
      <td class="right">€ ${currency(val.lose||0)}</td>
    </tr>`;
    }).join('');

    wrap.innerHTML = `
    <p class="small">
      Piatto d'inizio: <strong>€ ${currency(base)}</strong> •
      Quote: ${fractionsStr||'—'} •
      Bestie: <strong>${nBestie}</strong> •
      Prossimo piatto: <strong>€ ${currency(nextBase)}</strong>
    </p>
    <table class="table">
      <thead><tr><th>Giocatore</th><th class="right">Premi</th><th class="right">Bestia</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
    $('resultModal').showModal();
}

// ===== Storico: senza colonna "Mano" =====
function renderHistoryTable(){
    const tbl=$('historyTable'); if(!tbl) return;
    const players=state.players; if(players.length===0){ tbl.innerHTML=''; return; }

    const thead=`<thead><tr>${players.map(p=>`<th class="right">${p.name}</th>`).join('')}</tr></thead>`;

    const rows=state.hands.map((h)=>{
        const cells=players.map(p=>{
            const d=h.deltas[p.id]||0;
            if(!d) return `<td class="right" style="color:#6b7280">—</td>`;
            const sign=d>0?'+':'';
            const color=d>0?'#10b981':'#ef4444';
            return `<td class="right" style="color:${color}">${sign}€ ${currency(Math.abs(d))}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    const totals=`<tr>${
        players.map(p=>`<td class="right"><strong>€ ${currency(p.total||0)}</strong></td>`).join('')
    }</tr>`;

    tbl.innerHTML = thead + '<tbody>' + rows + '</tbody>' + '<tfoot>' + totals + '</tfoot>';
}

// ===== Render =====
function render(){
    if($('potValTop')) $('potValTop').textContent = '€ ' + currency(state.pot);

    const compact=state.locked;

    if($('addWrap')) $('addWrap').style.display=compact?'none':'grid';
    if($('playersTableWrap')) $('playersTableWrap').style.display=compact?'none':'';
    if($('historyWrap')) $('historyWrap').style.display='';

    if($('stakeBlock')) $('stakeBlock').style.display=compact?'none':'';

    if($('gameStakeInput')){
        $('gameStakeInput').disabled=state.locked;
        if(state.locked && state.gameStake>0) $('gameStakeInput').value=state.gameStake.toFixed(2);
    }

    if($('playersHead')) $('playersHead').innerHTML='<tr><th>#</th><th>Giocatore</th><th class="right">Totale</th><th style="width:60px"></th></tr>';

    const body=$('playersBody');
    if(body){
        body.innerHTML='';
        if(!state.locked){
            state.players.forEach((p,i)=>{
                const tr=document.createElement('tr');
                tr.innerHTML=`<td>${i+1}</td><td>${p.name}</td><td class="right">€ ${currency(p.total||0)}</td>
          <td><button class="btn-red">🗑️</button></td>`;
                tr.querySelector('button').addEventListener('click',()=>removePlayer(p.id));
                body.appendChild(tr);
            });
        }
    }

    renderHistoryTable();

    if($('startRound')) $('startRound').disabled = state.round.active || state.players.length===0;

    // abilita/disabilita impostazioni giocatori
    if($('openSettings')) $('openSettings').disabled = !canEditPlayers();
}

// ===== Impostazioni giocatori (modal) =====
function openSettingsModal(){
    renderSettings();
    $('settingsModal').showModal();
}

function renderSettings(){
    const wrap = $('settingsPlayersList');
    if(!wrap) return;
    wrap.innerHTML='';

    const editable = canEditPlayers();
    if($('settingsNewName')) $('settingsNewName').disabled = !editable;
    if($('settingsAddBtn')) $('settingsAddBtn').disabled = !editable;

    state.players.forEach((p, idx)=>{
        const row = document.createElement('div');
        row.className = 'choice';
        row.style.display='flex';
        row.style.alignItems='center';
        row.style.justifyContent='space-between';
        row.style.gap='10px';

        const left = document.createElement('div');
        left.style.display='flex';
        left.style.alignItems='center';
        left.style.gap='10px';
        left.style.flex='1';

        const pos = document.createElement('div');
        pos.className='tag';
        pos.textContent = String(idx+1);

        const input = document.createElement('input');
        input.value = p.name;
        input.disabled = !editable;
        input.addEventListener('change', ()=>{
            p.name = input.value.trim() || p.name;
            save();
            render();
            renderSettings();
        });

        left.appendChild(pos);
        left.appendChild(input);

        const actions = document.createElement('div');
        actions.style.display='flex';
        actions.style.gap='8px';

        const up = document.createElement('button');
        up.type='button';
        up.className='btn-blue icon-btn';
        up.textContent='⬆️';
        up.disabled = !editable || idx===0;
        up.addEventListener('click', ()=>{
            const a=idx, b=idx-1;
            [state.players[a], state.players[b]] = [state.players[b], state.players[a]];
            if (state.dealerIndex===a) state.dealerIndex=b;
            else if (state.dealerIndex===b) state.dealerIndex=a;
            save(); render(); renderSettings();
        });

        const down = document.createElement('button');
        down.type='button';
        down.className='btn-blue icon-btn';
        down.textContent='⬇️';
        down.disabled = !editable || idx===state.players.length-1;
        down.addEventListener('click', ()=>{
            const a=idx, b=idx+1;
            [state.players[a], state.players[b]] = [state.players[b], state.players[a]];
            if (state.dealerIndex===a) state.dealerIndex=b;
            else if (state.dealerIndex===b) state.dealerIndex=a;
            save(); render(); renderSettings();
        });

        const del = document.createElement('button');
        del.type='button';
        del.className='btn-red icon-btn';
        del.textContent='🗑️';
        del.disabled = !editable;
        del.addEventListener('click', ()=>{
            removePlayer(p.id);
            renderSettings();
        });

        actions.appendChild(up);
        actions.appendChild(down);
        actions.appendChild(del);

        row.appendChild(left);
        row.appendChild(actions);

        wrap.appendChild(row);
    });

    if(!editable){
        const note = document.createElement('div');
        note.className='small muted';
        note.textContent='Per modificare giocatori/ordine la Bestia deve essere € 0,00 e non deve esserci una mano in corso.';
        wrap.appendChild(note);
    }
}

// ===== Reset =====
function resetGame(){
    if(!confirm('Sei sicuro di voler resettare la partita?\nQuesto azzera piatto, totali, stake e storico.')) return;
    state.players=[];
    state.pot=0;
    state.hands=[];
    state.history=[];
    state.locked=false;
    state.gameStake=0;
    state.dealerIndex=0;
    state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    localStorage.removeItem(LS_KEY);
    if($('gameStakeInput')) $('gameStakeInput').value='0.30';
    render(); save();
}

// ===== Wiring =====
document.addEventListener('DOMContentLoaded', ()=>{
    on($('resetBtn'),'click',resetGame);
    on($('undoBtn'),'click',undo);

    on($('addPlayerBtn'),'click',()=>{
        addPlayer($('newName').value);
        $('newName').value='';
        $('newName').focus();
    });

    on($('lockBtn'),'click',lockPlayers);
    on($('startRound'),'click',startRound);

    // impostazioni giocatori
    on($('openSettings'),'click',(e)=>{
        e.preventDefault();
        openSettingsModal();
    });

    on($('settingsAddBtn'),'click',(e)=>{
        e.preventDefault();
        if(!canEditPlayers()) return;
        const nm = $('settingsNewName').value.trim();
        if(!nm) return;
        state.players.push({id:uid(), name:nm, total:0});
        $('settingsNewName').value='';
        save(); render(); renderSettings();
    });

    // step 1 -> step 2
    on($('participantsConfirm'),'click',e=>{
        e.preventDefault();
        $('participantsModal').close();

        if(state.round.participants.size===0){
            settleNoPlayers();
            return;
        }

        const all=state.players.map(p=>p.id);
        const parts=[...state.round.participants];
        const nonp=all.filter(id=>!parts.includes(id));

        if(nonp.length===0) openWinnersModal();
        else openNonParticipantsModal();
    });

    // indietro: torna alla schermata partecipanti (mantiene scelte)
    on($('npBack'),'click',e=>{
        e.preventDefault();
        $('npModal').close();
        openParticipantsModal();
    });

    // avanti: np -> winners
    on($('npNext'),'click',e=>{
        e.preventDefault();
        $('npModal').close();
        openWinnersModal();
    });

    // winners -> settle
    on($('winnersConfirm'),'click',e=>{
        e.preventDefault();
        $('winnersModal').close();
        settleAndClose();
    });

    load();
    render();
    save();
});
