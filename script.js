// ===== Stato & util =====
const LS_KEY = 'bestia-counter-html-v11';

const state = {
    players: [],            // {id,name,total}
    pot: 0,                 // bestia corrente (piatto prossima mano)
    hands: [],              // [{ base, deltas:{playerId:+/-}, dealerId }]
    history: [],            // stack funzioni inverse (undo)
    locked: false,          // dopo lock non si aggiungono/rimuovono giocatori
    gameStake: 0,           // posta fissa del mazziere
    dealerIndex: 0,         // rotazione mazziere in ordine d'inserimento
    round: {                // stato round attuale
        active: false,
        dealerId: null,
        basePot: 0,
        participants: new Set(), // id giocatori che giocheranno
        groups: [],              // [{id,name,memberIds:[]}] gruppi SOLO per questa mano
        winners: [null,null,null]// id entità (singolo o gruppo) vincitrici 1ª/2ª/3ª
    }
};

const uid = () => Math.random().toString(36).slice(2,9);
const currency = n => (isNaN(n)? '-' : n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
const $  = id => document.getElementById(id);
const on = (el,ev,fn)=> el && el.addEventListener(ev,fn);

// ===== Persistenza =====
function save(){
    localStorage.setItem(LS_KEY, JSON.stringify({
        players: state.players, pot: state.pot, hands: state.hands, locked: state.locked,
        gameStake: state.gameStake, dealerIndex: state.dealerIndex
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

function randomSplit(amountEuro, ids){
    const cents = Math.round(+amountEuro*100), n=ids.length; if(n===0) return {};
    const base = Math.floor(cents/n); let rem=cents-base*n;
    const shuffled=[...ids].sort(()=>Math.random()-0.5);
    const out={}; shuffled.forEach(id=>out[id]=base);
    for(let i=0;i<rem;i++) out[shuffled[i%shuffled.length]]++;
    Object.keys(out).forEach(k=> out[k]/=100); return out;
}
function combinations(arr,size){
    const out=[]; (function rec(s,c){ if(c.length===size){out.push(c.slice());return;}
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

// ===== Azioni Giocatori =====
function addPlayer(name){
    if(state.locked) return;
    const nm=(name||'').trim(); if(!nm) return;
    const p={id:uid(),name:nm,total:0}; state.players.push(p);
    addHistory(()=>{ state.players=state.players.filter(x=>x.id!==p.id); recomputeTotals(); });
    render(); save();
}
function removePlayer(id){
    if(state.locked) return;
    const i=state.players.findIndex(p=>p.id===id); if(i<0) return;
    const r=state.players[i]; state.players.splice(i,1);
    addHistory(()=>{ state.players.push(r); recomputeTotals(); });
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
    if($('gameStakeInput')){ $('gameStakeInput').value=state.gameStake.toFixed(2); $('gameStakeInput').disabled=true; }
    addHistory(()=>{ state.locked=false; state.gameStake=0; if($('gameStakeInput')) $('gameStakeInput').disabled=false; });
    render(); save();
}

// ===== Turno =====
function startRound(){
    if(state.round.active||state.players.length===0) return;
    if(!state.locked) lockPlayers();
    const dealer=currentDealer(); if(!dealer) return;
    const hadBestia = state.pot > 0;
    const base = hadBestia ? state.pot : state.gameStake;
    if(base<=0) return;
    state.round = {
        active:true,
        dealerId: dealer.id,
        basePot: base,
        participants:new Set(),
        groups:[],
        winners:[null,null,null],
        hadBestia: hadBestia        // <<< AGGIUNTO
    };
    state.pot = base;
    addHistory(()=>{ state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]}; });
    openParticipantsModal(); render(); save();
}

// Step 1: partecipanti
function openParticipantsModal(){
    const list=$('participantsList'); list.innerHTML='';
    state.players.forEach(p=>{
        const card=document.createElement('div');
        card.className='choice'; card.dataset.pid=p.id; card.textContent=p.name;
        const sel=state.round.participants.has(p.id);
        if(sel) card.classList.add('selected'); card.setAttribute('aria-checked',String(sel));
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=sel; card.appendChild(cb);
        card.addEventListener('click',()=>{
            const was=state.round.participants.has(p.id);
            was? state.round.participants.delete(p.id) : state.round.participants.add(p.id);
            card.classList.toggle('selected',!was);
            card.setAttribute('aria-checked',String(!was));
            cb.checked=!was;
        });
        list.appendChild(card);
    });
    $('participantsModal').showModal();
}

// Step 2: non partecipanti – rientro/gruppi (persistenti)
// step 2: non partecipanti – rientro/gruppi (selezioni persistenti, applicate con Avanti)
// step 2: non partecipanti – rientro/gruppi (selezioni persistenti, applicate con Avanti)
// Step 2: non partecipanti (rientri/gruppi) – versione dinamica "tutti contro uno"
function openNonParticipantsModal(){
    const sizeWrap   = document.getElementById('npSizeWrap');
    const combosWrap = document.getElementById('npGroupCombos');
    const soloWrap   = document.getElementById('npSoloList');

    // ——— crea (se manca) un box per i gruppi selezionati ———
    let selectedList = document.getElementById('npSelectedList');
    if (!selectedList){
        const h = document.createElement('div');
        h.className = 'small muted';
        h.style.margin = '10px 0 6px';
        h.textContent = 'Gruppi selezionati';
        selectedList = document.createElement('div');
        selectedList.id = 'npSelectedList';
        selectedList.className = 'list';
        // lo appendiamo dopo l’elenco combinazioni
        combosWrap.parentElement.appendChild(h);
        combosWrap.parentElement.appendChild(selectedList);
    }

    // ——— helper ———
    const nameOf = id => state.players.find(p=>p.id===id)?.name || id;
    const sameSet = (a,b) => a.length===b.length && a.every(x=>b.includes(x));
    const inAnyGroup = pid => state.round.groups.some(g=>g.memberIds.includes(pid));

    // **una** taglia alla volta
    let selectedSize = null;

    // calcola max taglia consentita = numero non-partecipanti
    const nonpInit  = currentNonParticipants();
    const maxSize   = nonpInit.length; // “tutti contro uno” possibile

    // costruisci chip dinamiche (2..maxSize)
    sizeWrap.innerHTML = '';
    if (maxSize >= 2){
        for (let s = 2; s <= maxSize; s++){
            const chip = document.createElement('div');
            chip.className = 'choice center';
            chip.dataset.size = String(s);
            chip.textContent = String(s);
            chip.addEventListener('click', ()=>{
                // selezione esclusiva
                selectedSize = (selectedSize === s) ? null : s;
                renderAll();
            });
            sizeWrap.appendChild(chip);
        }
        // pre-seleziona la massima (utile per “tutti contro uno”)
        selectedSize = maxSize;
    }

    // ——— render rientro singolo (toggle) ———
    function renderSolo(){
        soloWrap.innerHTML = '';
        const nonp = currentNonParticipants();
        if (nonp.length === 0){
            soloWrap.innerHTML = `<div class="small muted">Nessuno fuori.</div>`;
            return;
        }

        nonp.forEach(id=>{
            const p = state.players.find(x=>x.id===id);
            const item = document.createElement('div');
            item.className = 'choice';
            item.textContent = p.name;

            const selected = state.round.participants.has(id); // già rientrato singolo
            // se è dentro un gruppo, lo mostro come selezionato e disabilito il toggle singolo
            const grouped = inAnyGroup(id);

            item.classList.toggle('selected', selected || grouped);
            if (!grouped){
                item.addEventListener('click', ()=>{
                    if (state.round.participants.has(id)) state.round.participants.delete(id);
                    else state.round.participants.add(id);
                    renderAll();
                });
            } else {
                item.style.opacity = .5;
                item.title = 'Giocatore già incluso in un gruppo';
            }

            soloWrap.appendChild(item);
        });
    }

    // ——— render lista gruppi selezionati ———
    function renderSelectedList(){
        selectedList.innerHTML = '';
        if (state.round.groups.length === 0) return;

        state.round.groups.forEach(g=>{
            const card = document.createElement('div');
            card.className = 'choice center selected';
            card.textContent = g.memberIds.map(nameOf).join(' / ');

            const rm = document.createElement('button');
            rm.className = 'btn-red';
            rm.style.marginTop = '6px';
            rm.title = 'Rimuovi gruppo';
            rm.textContent = '🗑️';   // cestino
            rm.addEventListener('click', ()=>{
                state.round.groups = state.round.groups.filter(x=>x.id!==g.id);
                g.memberIds.forEach(pid=>{
                    // esce anche dai partecipanti se non rimane in altri gruppi
                    const stillGrouped = state.round.groups.some(gg=>gg.memberIds.includes(pid));
                    if (!stillGrouped) state.round.participants.delete(pid);
                });
                renderAll();
            });
            card.appendChild(rm);

            selectedList.appendChild(card);
        });
    }

    // ——— render combinazioni per la sola taglia selezionata ———
    function renderCombos(){
        combosWrap.innerHTML = '';

        const nonp = currentNonParticipants();
        if (nonp.length < 2 || !selectedSize){
            combosWrap.innerHTML = `<div class="small muted">Seleziona una taglia per vedere le combinazioni.</div>`;
            return;
        }
        if (selectedSize > nonp.length) {
            combosWrap.innerHTML = `<div class="small muted">Non ci sono abbastanza giocatori fuori.</div>`;
            return;
        }

        // titolo
        const title = document.createElement('div');
        title.className = 'small muted';
        title.style.margin = '8px 0 4px';
        title.textContent = `Combinazioni da ${selectedSize}`;
        combosWrap.appendChild(title);

        combinations(nonp, selectedSize).forEach(ids=>{
            const card = document.createElement('div');
            card.className = 'choice center';
            card.textContent = ids.map(nameOf).join(' / ');

            // già selezionato?
            const existing = state.round.groups.find(g => sameSet(g.memberIds, ids));
            if (existing){
                card.classList.add('selected');
                card.title = 'Tocca per rimuovere il gruppo';
                card.addEventListener('click', ()=>{
                    // toggle off
                    state.round.groups = state.round.groups.filter(g=>g!==existing);
                    ids.forEach(pid=>{
                        if (!inAnyGroup(pid)) state.round.participants.delete(pid);
                    });
                    renderAll();
                });
            } else {
                // conflitto: qualcuno in ids è già in un altro gruppo?
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

    // ——— render chip stato ———
    function renderChipsState(){
        sizeWrap.querySelectorAll('.choice').forEach(el=>{
            const s = Number(el.dataset.size);
            const nonpCount = currentNonParticipants().length;
            const enabled = s <= nonpCount;
            el.classList.toggle('selected', selectedSize === s);
            el.style.opacity = enabled ? 1 : .4;
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    function renderAll(){
        renderChipsState();
        renderSolo();
        renderCombos();
        renderSelectedList();
    }

    renderAll();
    document.getElementById('npModal').showModal();
}

// Step 3: vincitori
function openWinnersModal(){
    const ents=getRoundEntitiesLabeled();
    if(ents.length<2){ alert('Servono almeno 2 entità per giocare la mano.'); return; }
    setWinnersTitles();
    function build(colId, idx){
        const box=$(colId); box.innerHTML='';
        ents.forEach(ent=>{
            const c=document.createElement('div'); c.className='choice center'; c.dataset.eid=ent.id; c.textContent=ent.label;
            const sel=state.round.winners[idx]===ent.id; c.classList.toggle('selected',sel); c.setAttribute('aria-checked',String(sel));
            c.addEventListener('click',()=>{
                state.round.winners[idx]=ent.id;
                [...box.querySelectorAll('.choice')].forEach(el=>{
                    const ok=el.dataset.eid===String(ent.id); el.classList.toggle('selected',ok); el.setAttribute('aria-checked',String(ok));
                });
                validateWinnersConfirm();
            });
            box.appendChild(c);
        });
    }
    build('hand1',0); build('hand2',1); build('hand3',2);
    validateWinnersConfirm(); $('winnersModal').showModal();
}
function validateWinnersConfirm(){ $('winnersConfirm').disabled = !state.round.winners.every(x=>x!==null); }

// ===== Chiusura mano =====
function settleAndClose(){
    const base=state.round.basePot; if(!state.round.active||base<=0) return;

    const participants=[...state.round.participants];
    const entities=[...new Set(participants.map(entOf))];

    const wins=state.round.winners.filter(Boolean).map(id => state.round.groups.find(g=>g.id===id)? id : entOf(id));
    const winCount={}; entities.forEach(e=>winCount[e]=0); wins.forEach(e=>{ if(e in winCount) winCount[e]+=1; });

    const losers=entities.filter(e=>(winCount[e]||0)===0);
    const everyoneTook = losers.length===0;

    const deltas={}, report=[];
    const membersOf = ent => (state.round.groups.find(g=>g.id===ent)?.memberIds || [ent]);

    // Premi
    entities.forEach(ent=>{
        const frac=(winCount[ent]||0)/3; if(frac<=0) return;
        const split=randomSplit(base*frac,membersOf(ent));
        Object.entries(split).forEach(([pid,amt])=>{ report.push({id:pid,type:'win',amount:amt}); deltas[pid]=(deltas[pid]||0)+amt; });
    });

    // Bestie
    if(!everyoneTook){
        losers.forEach(ent=>{
            const split=randomSplit(base,membersOf(ent));
            Object.entries(split).forEach(([pid,amt])=>{ report.push({id:pid,type:'lose',amount:amt}); deltas[pid]=(deltas[pid]||0)-amt; });
        });
    }

    // Posta mazziere (sempre)
    const dealer=currentDealer(); const dealerIdLastHand=dealer?dealer.id:null;
    if(dealer && state.gameStake>0){ report.push({id:dealer.id,type:'dealer',amount:state.gameStake}); deltas[dealer.id]=(deltas[dealer.id]||0)-state.gameStake; }

    // Prossima bestia
    const prevPot=state.pot;
    state.pot = everyoneTook ? 0 : (losers.length*base + state.gameStake);

    // Quote x/3
    const fractionsStr=[...new Set(participants.map(entOf))].map(e=>{
        const c=(winCount[e]||0), label=state.round.groups.find(g=>g.id===e)?.name || nameOf(e);
        return `<span class="tag">${label}: ${c}/3</span>`;
    }).join(' ');

    // Storico + totali
    state.hands.push({ base, deltas, dealerId: dealerIdLastHand }); recomputeTotals();
    addHistory(()=>{ state.hands.pop(); recomputeTotals(); state.pot=prevPot; state.dealerIndex=(state.dealerIndex-1+Math.max(1,state.players.length))%Math.max(1,state.players.length); });

    // Chiudi round e ruota mazziere
    state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    if(state.players.length>0) state.dealerIndex=(state.dealerIndex+1)%state.players.length;

    showResult(report, base, losers.length, state.pot, fractionsStr, dealer?dealer.name:'—', dealerIdLastHand, new Set(participants));
    render(); save();
}

// Riepilogo
function showResult(items, base, nBestie, nextBase, fractionsStr, dealerName, dealerIdLastHand, participantsSet){
    const wrap=$('resultSummary');
    const agg={}; items.forEach(it=>{ (agg[it.id]??=( {win:0,lose:0,dealer:0} ))[it.type]+=it.amount; });
    const rows=Object.entries(agg).map(([id,val])=>{
        let nm=nameOf(id); if(dealerIdLastHand && participantsSet?.has(dealerIdLastHand) && id===dealerIdLastHand) nm+=' 🎴';
        return `<tr><td>${nm}</td><td class="right">€ ${currency(val.win||0)}</td><td class="right">€ ${currency(val.lose||0)}</td></tr>`;
    }).join('');
    wrap.innerHTML = `
    <p class="small">
      Mazziere: <strong>${dealerName}</strong> •
      Piatto d'inizio: <strong>€ ${currency(base)}</strong> •
      Quote: ${fractionsStr||'—'} •
      Bestie: <strong>${nBestie}</strong> •
      Prossimo piatto: <strong>€ ${currency(nextBase)}</strong>
    </p>
    <table class="table">
      <thead><tr><th>Giocatore</th><th class="right">Premi</th><th class="right">Bestia</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    $('resultModal').showModal();
}

// ===== Render =====
let el={};
function render(){
    if($('potVal')) $('potVal').textContent='€ '+currency(state.pot);
    const compact=state.locked;

    if($('addWrap')) $('addWrap').style.display=compact?'none':'grid';
    if($('playersTableWrap')) $('playersTableWrap').style.display=compact?'none':'';
    if($('historyWrap')) $('historyWrap').style.display='';

    if($('stakeBlock')) $('stakeBlock').style.display=compact?'none':'';

    const dealer=currentDealer(); if($('dealerName')) $('dealerName').textContent=dealer?dealer.name:'—';
    if($('gameStakeInput')){ $('gameStakeInput').disabled=state.locked; if(state.locked&&state.gameStake>0) $('gameStakeInput').value=state.gameStake.toFixed(2); }

    if($('playersHead')) $('playersHead').innerHTML='<tr><th>#</th><th>Giocatore</th><th class="right">Totale</th><th style="width:60px"></th></tr>';
    const body=$('playersBody');
    if(body){
        body.innerHTML='';
        if(!state.locked){
            state.players.forEach((p,i)=>{
                const tr=document.createElement('tr');
                tr.innerHTML=`<td>${i+1}</td><td>${p.name}</td><td class="right">€ ${currency(p.total||0)}</td><td><button class="btn-red">🗑️</button></td>`;
                tr.querySelector('button').addEventListener('click',()=>removePlayer(p.id));
                body.appendChild(tr);
            });
        }
    }
    renderHistoryTable();
    if($('startRound')) $('startRound').disabled = state.round.active || state.players.length===0;
}
function renderHistoryTable(){
    const tbl=$('historyTable'); if(!tbl) return;
    const players=state.players; if(players.length===0){ tbl.innerHTML=''; return; }
    const thead=`<thead><tr><th>Mano</th>${players.map(p=>`<th class="right">${p.name}</th>`).join('')}</tr></thead>`;
    const rows=state.hands.map((h,i)=>{
        const cells=players.map(p=>{
            const d=h.deltas[p.id]||0, isDealer=h.dealerId && p.id===h.dealerId, badge=isDealer?` <span class="tag" title="Mazziere">🎴</span>`:'';
            if(!d) return `<td class="right" style="color:#6b7280">—${badge}</td>`;
            const sign=d>0?'+':'', color=d>0?'#10b981':'#ef4444';
            return `<td class="right" style="color:${color}">${sign}€ ${currency(Math.abs(d))}${badge}</td>`;
        }).join('');
        return `<tr><td>${i+1}</td>${cells}</tr>`;
    }).join('');
    const totals=`<tr>${
        ['Totale'].concat(players.map(p=>`€ ${currency(p.total||0)}`))
            .map((t,i)=> i? `<td class="right"><strong>${t}</strong></td>` : `<td><strong>${t}</strong></td>`).join('')
    }</tr>`;
    tbl.innerHTML = thead + '<tbody>' + rows + '</tbody>' + '<tfoot>' + totals + '</tfoot>';
}

// ===== Reset & casi particolari =====
function resetGame(){
    if(!confirm('Sei sicuro di voler resettare la partita?\nQuesto azzera piatto, totali, stake e storico.')) return;
    state.players=[]; state.pot=0; state.hands=[]; state.history=[]; state.locked=false; state.gameStake=0; state.dealerIndex=0;
    state.round={active:false,dealerId:null,basePot:0,participants:new Set(),groups:[],winners:[null,null,null]};
    localStorage.removeItem(LS_KEY); if($('gameStakeInput')) $('gameStakeInput').value='0.30'; render();
}
// caso: nessuno gioca la mano (solo posta mazziere)
// BESTIA SUCCESSIVA = piatto presente (basePot) + posta del mazziere
function settleNoPlayers(){
    const dealer = currentDealer();

    // chiudi round se non abbiamo dealer o posta
    if (!dealer || state.gameStake <= 0) {
        state.round = { active:false, dealerId:null, basePot:0, participants:new Set(), groups:[], winners:[null,null,null] };
        render(); save();
        return;
    }

    const deltas = {};
    deltas[dealer.id] = -state.gameStake; // il mazziere paga la posta

    // registra mano "vuota"
    state.hands.push({ base: state.round.basePot, deltas, dealerId: dealer.id });
    recomputeTotals();

    addHistory(()=>{
        state.hands.pop();
        recomputeTotals();
        state.dealerIndex = (state.dealerIndex - 1 + state.players.length) % state.players.length;
    });

    // ruota mazziere e aggiorna bestia: piatto presente + posta
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
    state.pot = Number((state.round.basePot + state.gameStake).toFixed(2));

    state.round = { active:false, dealerId:null, basePot:0, participants:new Set(), groups:[], winners:[null,null,null] };
    render(); save();
}



// ===== Wiring =====
document.addEventListener('DOMContentLoaded', ()=>{
    // bottoni top
    on($('resetBtn'),'click',resetGame);
    on($('undoBtn'),'click',undo);

    // inserimento & setup
    on($('addPlayerBtn'),'click',()=>{ addPlayer($('newName').value); $('newName').value=''; $('newName').focus(); });
    on($('lockBtn'),'click',lockPlayers);
    on($('startRound'),'click',startRound);

    // partecipanti -> step successivo
    on($('participantsConfirm'),'click',e=>{
        e.preventDefault(); $('participantsModal').close();
        if(state.round.participants.size===0){ settleNoPlayers(); return; }
        const all=state.players.map(p=>p.id), parts=[...state.round.participants], nonp=all.filter(id=>!parts.includes(id));
        if(nonp.length===0) openWinnersModal(); else openNonParticipantsModal();
    });

    // np -> winners
    on($('npNext'),'click',e=>{ e.preventDefault(); $('npModal').close(); openWinnersModal(); });
// ——— Aggiunge il bottone "Indietro" nel modale Non partecipanti ———
    (function addNpBackButton(){
        const npModal = $('npModal');
        if (!npModal) return;
        const footer = npModal.querySelector('.footer');
        if (!footer) return;

        // Evita duplicati
        if (footer.querySelector('[data-role="np-back"]')) return;

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.dataset.role = 'np-back';
        backBtn.className = 'btn-primary';
        backBtn.textContent = 'Indietro';
        backBtn.style.marginRight = '8px';

        backBtn.addEventListener('click', ()=>{
            npModal.close();
            // Torna alla schermata "Chi gioca questa mano?" mantenendo lo stato
            openParticipantsModal();
        });

        // Inseriscilo prima di "Avanti"
        footer.insertBefore(backBtn, $('npNext') || footer.firstChild);
    })();
    // winners -> settle
    on($('winnersConfirm'),'click',e=>{ e.preventDefault(); $('winnersModal').close(); settleAndClose(); });

    load(); render(); save();
});
