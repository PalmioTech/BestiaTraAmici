// ===== Stato & util =====
const LS_KEY = 'bestia-counter-html-v12';

const state = {
    players: [],            // {id,name,total}
    pot: 0,                 // bestia corrente
    hands: [],              // [{ base, deltas:{playerId:+/-}, dealerId }]
    history: [],            // undo stack
    locked: false,          // iscrizioni chiuse (posta fissata)
    gameStake: 0,           // posta fissa del mazziere
    dealerIndex: 0,         // chi fa le carte ORA (ordine di inserimento)
    round: {
        active: false,
        dealerId: null,
        basePot: 0,
        participants: new Set(), // giocatori che partecipano (id player)
        groups: [],              // [{id,name,memberIds:[]}] solo per questa mano
        winners: [null, null, null] // id entità (player o group.id)
    }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const currency = n => (isNaN(n) ? '-' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const $ = id => document.getElementById(id);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

// ===== Persistenza =====
function save() {
    localStorage.setItem(LS_KEY, JSON.stringify({
        players: state.players,
        pot: state.pot,
        hands: state.hands,
        locked: state.locked,
        gameStake: state.gameStake,
        dealerIndex: state.dealerIndex
    }));
}

function load() {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return;
    try {
        const v = JSON.parse(s);
        state.players = (v.players || []).map(p => ({ ...p, total: +p.total || 0 }));
        state.pot = +v.pot || 0;
        state.hands = v.hands || [];
        state.locked = !!v.locked;
        state.gameStake = +v.gameStake || 0;
        state.dealerIndex = Number.isInteger(v.dealerIndex) ? v.dealerIndex : 0;
        recomputeTotals();
    } catch { }
}

function recomputeTotals() {
    state.players.forEach(p => p.total = 0);
    state.hands.forEach(h => {
        for (const id in h.deltas) {
            const pl = state.players.find(p => p.id === id);
            if (pl) pl.total += h.deltas[id];
        }
    });
}

// ===== Undo =====
function addHistory(inv) {
    state.history.unshift(inv);
    if (state.history.length > 200) state.history.pop();
}
function undo() {
    const f = state.history.shift();
    if (f) { f(); render(); save(); }
}

// ===== Helpers =====
const currentDealer = () => state.players.length ? state.players[state.dealerIndex % state.players.length] : null;
const nameOf = id => state.players.find(p => p.id === id)?.name || id;
const entOf = pid => (state.round.groups.find(g => g.memberIds.includes(pid))?.id) || pid;

function randomSplit(amountEuro, ids) {
    const cents = Math.round(+amountEuro * 100), n = ids.length;
    if (n === 0) return {};
    const base = Math.floor(cents / n); let rem = cents - base * n;
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const out = {}; shuffled.forEach(id => out[id] = base);
    for (let i = 0; i < rem; i++) out[shuffled[i % shuffled.length]]++;
    Object.keys(out).forEach(k => out[k] /= 100);
    return out;
}

function combinations(arr, size) {
    const out = [];
    (function rec(s, c) {
        if (c.length === size) { out.push(c.slice()); return; }
        for (let i = s; i < arr.length; i++) { c.push(arr[i]); rec(i + 1, c); c.pop(); }
    })(0, []);
    return out;
}

function currentNonParticipants() {
    const all = state.players.map(p => p.id);
    const parts = [...state.round.participants];
    return all.filter(id => !parts.includes(id));
}

function getRoundEntitiesLabeled() {
    const entIds = [...new Set([...state.round.participants].map(entOf))];
    return entIds.map(eid => {
        const g = state.round.groups.find(g => g.id === eid);
        return g
            ? { id: eid, label: g.memberIds.map(nameOf).join('/') }
            : { id: eid, label: nameOf(eid) };
    });
}

function setWinnersTitles() {
    const vs = getRoundEntitiesLabeled().map(e => e.label).join(' vs ');
    const safe = vs || '–';
    $('hand1Title').textContent = `1ª mano: ${safe}`;
    $('hand2Title').textContent = `2ª mano: ${safe}`;
    $('hand3Title').textContent = `3ª mano: ${safe}`;
}

// Ordine selezione: parte da "dopo il mazziere", mazziere per ultimo
function playersInPickOrder() {
    const n = state.players.length;
    if (n === 0) return [];
    const start = (state.dealerIndex + 1) % n;
    const rotated = [];
    for (let k = 0; k < n; k++) rotated.push(state.players[(start + k) % n]);
    return rotated;
}

// ===== Azioni Giocatori =====
// Permetti inserimento SOLO quando bestia=0 e non in mano
function canEditPlayersNow() {
    return !state.round.active && Number(state.pot.toFixed(2)) === 0;
}

function addPlayer(name) {
    const nm = (name || '').trim();
    if (!nm) return;
    if (!canEditPlayersNow()) return;

    const p = { id: uid(), name: nm, total: 0 };
    state.players.push(p);

    addHistory(() => {
        state.players = state.players.filter(x => x.id !== p.id);
        // aggiusta dealerIndex se serve
        state.dealerIndex = Math.min(state.dealerIndex, Math.max(0, state.players.length - 1));
        recomputeTotals();
    });

    render(); save();
}

function removePlayer(id) {
    if (!canEditPlayersNow()) return;

    const i = state.players.findIndex(p => p.id === id);
    if (i < 0) return;
    const removed = state.players[i];

    state.players.splice(i, 1);

    // se rimuovi uno prima del dealerIndex, scala
    if (i < state.dealerIndex) state.dealerIndex = Math.max(0, state.dealerIndex - 1);
    if (state.dealerIndex >= state.players.length) state.dealerIndex = 0;

    addHistory(() => {
        state.players.splice(i, 0, removed);
        recomputeTotals();
    });

    render(); save();
}

function lockPlayers() {
    if (state.locked) return;
    const cur = $('gameStakeInput') ? String($('gameStakeInput').value || '0.30') : '0.30';
    const ans = prompt('Imposta la posta fissa del mazziere (es. 0,30):', cur);
    if (ans === null) return;
    const num = Number(String(ans).replace(',', '.'));
    if (!isFinite(num) || num < 0) { alert('Valore non valido.'); return; }

    state.gameStake = +num.toFixed(2);
    state.locked = true;

    if ($('gameStakeInput')) {
        $('gameStakeInput').value = state.gameStake.toFixed(2);
        $('gameStakeInput').disabled = true;
    }

    addHistory(() => {
        state.locked = false;
        state.gameStake = 0;
        if ($('gameStakeInput')) $('gameStakeInput').disabled = false;
    });

    render(); save();
}

// ===== Turno =====
function startRound() {
    if (state.round.active || state.players.length === 0) return;
    if (!state.locked) lockPlayers();
    const dealer = currentDealer();
    if (!dealer) return;

    const base = state.pot > 0 ? state.pot : state.gameStake;
    if (base <= 0) return;

    state.round = {
        active: true,
        dealerId: dealer.id,
        basePot: base,
        participants: new Set(),
        groups: [],
        winners: [null, null, null]
    };

    state.pot = base;

    addHistory(() => {
        state.round = { active: false, dealerId: null, basePot: 0, participants: new Set(), groups: [], winners: [null, null, null] };
    });

    openParticipantsModal();
    render(); save();
}

// Step 1: partecipanti (ordine corretto)
function openParticipantsModal() {
    const list = $('participantsList');
    list.innerHTML = '';

    const dealer = currentDealer();
    $('participantsOrderHint').textContent = dealer
        ? `Ordine scelta: dal giocatore dopo ${dealer.name} (mazziere) fino al mazziere.`
        : '';

    playersInPickOrder().forEach(p => {
        const card = document.createElement('div');
        card.className = 'choice';
        card.dataset.pid = p.id;
        card.textContent = p.name;

        const sel = state.round.participants.has(p.id);
        card.classList.toggle('selected', sel);
        card.setAttribute('aria-checked', String(sel));

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = sel;
        card.appendChild(cb);

        card.addEventListener('click', () => {
            const was = state.round.participants.has(p.id);
            was ? state.round.participants.delete(p.id) : state.round.participants.add(p.id);
            card.classList.toggle('selected', !was);
            card.setAttribute('aria-checked', String(!was));
            cb.checked = !was;
        });

        list.appendChild(card);
    });

    $('participantsModal').showModal();
}

// Step 2: non partecipanti (rientri/gruppi) – selezione persistente + cestino + solo 1 taglia per volta
function openNonParticipantsModal() {
    const sizeWrap = $('npSizeWrap');
    const combosWrap = $('npGroupCombos');
    const soloWrap = $('npSoloList');
    const selectedList = $('npSelectedList');

    const inAnyGroup = pid => state.round.groups.some(g => g.memberIds.includes(pid));
    const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

    // Una sola taglia alla volta
    let selectedSize = null;

    function buildSizes() {
        const nonp = currentNonParticipants();
        const maxSize = nonp.length; // “tutti contro uno” possibile
        sizeWrap.innerHTML = '';

        if (maxSize < 2) {
            sizeWrap.innerHTML = `<div class="small muted">Non ci sono abbastanza giocatori fuori per fare gruppi.</div>`;
            selectedSize = null;
            return;
        }

        for (let s = 2; s <= maxSize; s++) {
            const chip = document.createElement('div');
            chip.className = 'choice center';
            chip.dataset.size = String(s);
            chip.textContent = String(s);

            chip.addEventListener('click', () => {
                selectedSize = (selectedSize === s) ? null : s;
                renderAll();
            });

            sizeWrap.appendChild(chip);
        }

        // default: massimo (tutti contro uno)
        selectedSize = maxSize;
    }

    function renderChips() {
        const nonpCount = currentNonParticipants().length;
        [...sizeWrap.querySelectorAll('.choice')].forEach(chip => {
            const s = Number(chip.dataset.size);
            const enabled = s <= nonpCount;
            chip.classList.toggle('selected', selectedSize === s);
            chip.style.opacity = enabled ? 1 : .4;
            chip.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    // Toggle rientro singolo
    function renderSolo() {
        soloWrap.innerHTML = '';
        const nonp = currentNonParticipants();
        if (nonp.length === 0) {
            soloWrap.innerHTML = `<div class="small muted">Nessuno fuori.</div>`;
            return;
        }

        nonp.forEach(pid => {
            const item = document.createElement('div');
            item.className = 'choice center';
            item.textContent = nameOf(pid);

            const grouped = inAnyGroup(pid);
            const selected = state.round.participants.has(pid);

            item.classList.toggle('selected', grouped || selected);

            if (grouped) {
                item.style.opacity = .5;
                item.title = 'Giocatore già incluso in un gruppo';
            } else {
                item.addEventListener('click', () => {
                    if (state.round.participants.has(pid)) state.round.participants.delete(pid);
                    else state.round.participants.add(pid);
                    renderAll();
                });
            }

            soloWrap.appendChild(item);
        });
    }

    // Lista gruppi selezionati con 🗑️
    function renderSelected() {
        selectedList.innerHTML = '';
        if (state.round.groups.length === 0) {
            selectedList.innerHTML = `<div class="small muted">Nessun gruppo selezionato.</div>`;
            return;
        }

        state.round.groups.forEach(g => {
            const card = document.createElement('div');
            card.className = 'choice center selected';
            card.textContent = g.memberIds.map(nameOf).join(' / ');

            const rm = document.createElement('button');
            rm.className = 'btn-red';
            rm.title = 'Rimuovi gruppo';
            rm.textContent = '🗑️';
            rm.style.marginLeft = '8px';

            rm.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                state.round.groups = state.round.groups.filter(x => x.id !== g.id);

                // rimuovi dai partecipanti se non sono rientrati singoli e non sono in altri gruppi
                g.memberIds.forEach(pid => {
                    const stillGrouped = inAnyGroup(pid);
                    if (!stillGrouped) {
                        // resta dentro solo se era stato selezionato come singolo
                        // (se non è selezionato singolo, lo togliamo)
                        // NB: qui “singolo” = participants.has(pid) ma non in gruppi
                        // se vuoi che il singolo resti selezionato dopo la rimozione del gruppo,
                        // devi cliccare nella colonna "rientri da solo" (rimane selezionato).
                        if (!state.round.participants.has(pid)) state.round.participants.delete(pid);
                    }
                });

                renderAll();
            });

            card.appendChild(rm);
            selectedList.appendChild(card);
        });
    }

    // Combinazioni per la taglia selezionata (solo quella)
    function renderCombos() {
        combosWrap.innerHTML = '';
        const nonp = currentNonParticipants();

        if (!selectedSize) {
            combosWrap.innerHTML = `<div class="small muted">Seleziona una taglia per vedere le combinazioni.</div>`;
            return;
        }
        if (nonp.length < 2 || selectedSize > nonp.length) {
            combosWrap.innerHTML = `<div class="small muted">Non ci sono abbastanza giocatori fuori.</div>`;
            return;
        }

        const title = document.createElement('div');
        title.className = 'small muted';
        title.style.margin = '8px 0 4px';
        title.textContent = `Combinazioni da ${selectedSize}`;
        combosWrap.appendChild(title);

        combinations(nonp, selectedSize).forEach(ids => {
            const card = document.createElement('div');
            card.className = 'choice center';
            card.textContent = ids.map(nameOf).join(' / ');

            const existing = state.round.groups.find(g => sameSet(g.memberIds, ids));
            if (existing) {
                card.classList.add('selected');
                card.title = 'Gruppo già selezionato';
                // non lo togliamo da qui: lo togli col cestino nella lista selezionati
                combosWrap.appendChild(card);
                return;
            }

            // conflitto: qualcuno è già in un altro gruppo
            const conflict = ids.some(inAnyGroup);
            if (conflict) {
                card.style.opacity = .5;
                card.style.pointerEvents = 'none';
                card.title = 'Conflitto con un gruppo già selezionato';
                combosWrap.appendChild(card);
                return;
            }

            card.title = 'Tocca per creare il gruppo';
            card.addEventListener('click', () => {
                const g = { id: uid(), name: ids.map(nameOf).join('/'), memberIds: ids.slice() };
                state.round.groups.push(g);
                ids.forEach(pid => state.round.participants.add(pid)); // entrano come entità gruppo
                renderAll();
            });

            combosWrap.appendChild(card);
        });
    }

    function renderAll() {
        renderChips();
        renderSolo();
        renderCombos();
        renderSelected();
    }

    buildSizes();
    renderAll();
    $('npModal').showModal();
}

// Step 3: vincitori (indietro -> rientri/gruppi)
function openWinnersModal() {
    const ents = getRoundEntitiesLabeled();
    if (ents.length < 2) {
        alert('Servono almeno 2 entità per giocare la mano.');
        return;
    }

    setWinnersTitles();

    function build(colId, idx) {
        const box = $(colId);
        box.innerHTML = '';

        ents.forEach(ent => {
            const c = document.createElement('div');
            c.className = 'choice center';
            c.dataset.eid = ent.id;
            c.textContent = ent.label;

            const sel = state.round.winners[idx] === ent.id;
            c.classList.toggle('selected', sel);
            c.setAttribute('aria-checked', String(sel));

            c.addEventListener('click', () => {
                state.round.winners[idx] = ent.id;
                [...box.querySelectorAll('.choice')].forEach(el => {
                    const ok = el.dataset.eid === String(ent.id);
                    el.classList.toggle('selected', ok);
                    el.setAttribute('aria-checked', String(ok));
                });
                validateWinnersConfirm();
            });

            box.appendChild(c);
        });
    }

    build('hand1', 0);
    build('hand2', 1);
    build('hand3', 2);

    validateWinnersConfirm();
    $('winnersModal').showModal();
}

function validateWinnersConfirm() {
    $('winnersConfirm').disabled = !state.round.winners.every(x => x !== null);
}

// ===== Casi particolari =====
// nessuno gioca: il mazziere paga la posta; bestia = basePot + posta
function settleNoPlayers() {
    const dealer = currentDealer();

    if (!dealer || state.gameStake <= 0) {
        state.round = { active: false, dealerId: null, basePot: 0, participants: new Set(), groups: [], winners: [null, null, null] };
        render(); save();
        return;
    }

    const deltas = {};
    deltas[dealer.id] = -state.gameStake;

    state.hands.push({ base: state.round.basePot, deltas, dealerId: dealer.id });
    recomputeTotals();

    addHistory(() => {
        state.hands.pop();
        recomputeTotals();
        state.dealerIndex = (state.dealerIndex - 1 + state.players.length) % state.players.length;
    });

    // ruota mazziere e aggiorna bestia
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
    state.pot = Number((state.round.basePot + state.gameStake).toFixed(2));

    state.round = { active: false, dealerId: null, basePot: 0, participants: new Set(), groups: [], winners: [null, null, null] };
    render(); save();
}

// ===== Chiusura mano =====
function settleAndClose() {
    const base = state.round.basePot;
    if (!state.round.active || base <= 0) return;

    const participants = [...state.round.participants];
    const entities = [...new Set(participants.map(entOf))];

    const wins = state.round.winners
        .filter(Boolean)
        .map(id => state.round.groups.find(g => g.id === id) ? id : entOf(id));

    const winCount = {};
    entities.forEach(e => winCount[e] = 0);
    wins.forEach(e => { if (e in winCount) winCount[e] += 1; });

    const losers = entities.filter(e => (winCount[e] || 0) === 0);
    const everyoneTook = losers.length === 0;

    const deltas = {}, report = {};
    const addReport = (pid, win, lose) => {
        report[pid] ||= { win: 0, lose: 0 };
        report[pid].win += win;
        report[pid].lose += lose;
    };

    const membersOf = ent => (state.round.groups.find(g => g.id === ent)?.memberIds || [ent]);

    // Premi
    entities.forEach(ent => {
        const frac = (winCount[ent] || 0) / 3;
        if (frac <= 0) return;
        const split = randomSplit(base * frac, membersOf(ent));
        Object.entries(split).forEach(([pid, amt]) => {
            deltas[pid] = (deltas[pid] || 0) + amt;
            addReport(pid, amt, 0);
        });
    });

    // Bestie
    if (!everyoneTook) {
        losers.forEach(ent => {
            const split = randomSplit(base, membersOf(ent));
            Object.entries(split).forEach(([pid, amt]) => {
                deltas[pid] = (deltas[pid] || 0) - amt;
                addReport(pid, 0, amt);
            });
        });
    }

    // Posta mazziere (sempre)
    const dealer = currentDealer();
    const dealerIdLastHand = dealer ? dealer.id : null;
    if (dealer && state.gameStake > 0) {
        deltas[dealer.id] = (deltas[dealer.id] || 0) - state.gameStake;
    }

    // Prossima bestia
    const prevPot = state.pot;
    state.pot = everyoneTook ? 0 : (losers.length * base + state.gameStake);

    // Storico + totali
    state.hands.push({ base, deltas, dealerId: dealerIdLastHand });
    recomputeTotals();

    addHistory(() => {
        state.hands.pop();
        recomputeTotals();
        state.pot = prevPot;
        state.dealerIndex = (state.dealerIndex - 1 + Math.max(1, state.players.length)) % Math.max(1, state.players.length);
    });

    // ruota mazziere
    state.round = { active: false, dealerId: null, basePot: 0, participants: new Set(), groups: [], winners: [null, null, null] };
    if (state.players.length > 0) state.dealerIndex = (state.dealerIndex + 1) % state.players.length;

    const fractionsStr = [...new Set(participants.map(entOf))].map(e => {
        const c = (winCount[e] || 0);
        const label = state.round.groups?.find?.(g => g.id === e)?.name || (state.players.find(p => p.id === e)?.name) || e;
        return `<span class="tag">${label}: ${c}/3</span>`;
    }).join(' ');

    showResult(report, base, losers.length, state.pot, fractionsStr, dealer ? dealer.name : '—', dealerIdLastHand, new Set(participants));
    render(); save();
}

// Riepilogo
function showResult(reportByPlayer, base, nBestie, nextBase, fractionsStr, dealerName, dealerIdLastHand, participantsSet) {
    const wrap = $('resultSummary');

    const rows = Object.keys(reportByPlayer).map(pid => {
        let nm = nameOf(pid);
        if (dealerIdLastHand && participantsSet?.has(dealerIdLastHand) && pid === dealerIdLastHand) nm += ' 🎴';

        const win = reportByPlayer[pid]?.win || 0;
        const lose = reportByPlayer[pid]?.lose || 0;

        return `<tr>
      <td>${nm}</td>
      <td class="right">€ ${currency(win)}</td>
      <td class="right">€ ${currency(lose)}</td>
    </tr>`;
    }).join('');

    wrap.innerHTML = `
    <p class="small">
      Mazziere: <strong>${dealerName}</strong> •
      Piatto d'inizio: <strong>€ ${currency(base)}</strong> •
      Quote: ${fractionsStr || '—'} •
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

// ===== Chiudi conti (pagamenti minimi) =====
function computeTransfers() {
    // negativo = deve dare, positivo = deve ricevere
    const debtors = [];
    const creditors = [];

    state.players.forEach(p => {
        const t = Number((p.total || 0).toFixed(2));
        if (t < -0.005) debtors.push({ id: p.id, amount: -t });
        else if (t > 0.005) creditors.push({ id: p.id, amount: t });
    });

    // ordine: chi deve di più / chi deve ricevere di più
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = debtors[i], rec = creditors[j];
        const x = Math.min(pay.amount, rec.amount);
        if (x > 0.0001) {
            transfers.push({ from: pay.id, to: rec.id, amount: Number(x.toFixed(2)) });
            pay.amount = Number((pay.amount - x).toFixed(2));
            rec.amount = Number((rec.amount - x).toFixed(2));
        }
        if (pay.amount <= 0.0001) i++;
        if (rec.amount <= 0.0001) j++;
    }
    return transfers;
}

function showSettlement() {
    const box = $('settlementBody');
    const transfers = computeTransfers();

    if (transfers.length === 0) {
        box.innerHTML = `<p class="small muted">Nessun trasferimento necessario (tutti a zero).</p>`;
        $('settlementModal').showModal();
        return;
    }

    const lines = transfers.map(t => {
        return `<tr>
      <td><strong>${nameOf(t.from)}</strong></td>
      <td class="center">→</td>
      <td><strong>${nameOf(t.to)}</strong></td>
      <td class="right">€ ${currency(t.amount)}</td>
    </tr>`;
    }).join('');

    box.innerHTML = `
    <p class="small muted">Paga così chiudi i conti con il minimo numero di movimenti.</p>
    <table class="table">
      <thead><tr><th>Da</th><th></th><th>A</th><th class="right">Importo</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
  `;
    $('settlementModal').showModal();
}

// ===== Render =====
function renderHistoryTable() {
    const tbl = $('historyTable');
    if (!tbl) return;

    const players = state.players;
    if (players.length === 0) { tbl.innerHTML = ''; return; }

    // niente colonna "Mano": solo giocatori
    const thead = `<thead><tr>${players.map(p => `<th class="right">${p.name}</th>`).join('')}</tr></thead>`;

    const bodyRows = state.hands.map(h => {
        const cells = players.map(p => {
            const d = h.deltas[p.id] || 0;
            const isDealer = h.dealerId && p.id === h.dealerId;
            const badge = isDealer ? ` <span class="tag" title="Mazziere">🎴</span>` : '';

            if (!d) return `<td class="right" style="color:#6b7280">—${badge}</td>`;
            const sign = d > 0 ? '+' : '';
            const color = d > 0 ? '#10b981' : '#ef4444';
            return `<td class="right" style="color:${color}">${sign}€ ${currency(Math.abs(d))}${badge}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    // Totali in fondo (sempre sotto i nomi)
    const totals = `<tr>${players.map(p => `<td class="right"><strong>€ ${currency(p.total || 0)}</strong></td>`).join('')}</tr>`;

    tbl.innerHTML = thead + `<tbody>${bodyRows}</tbody>` + `<tfoot>${totals}</tfoot>`;
}

function render() {
    const bestiaTxt = '€ ' + currency(state.pot);
    if ($('potVal')) $('potVal').textContent = bestiaTxt;
    if ($('bestiaTop')) $('bestiaTop').textContent = bestiaTxt;

    const dealer = currentDealer();
    if ($('dealerName')) $('dealerName').textContent = dealer ? dealer.name : '—';
    if ($('dealerHint')) $('dealerHint').textContent = dealer ? `Ora fa le carte: ${dealer.name}` : '';

    // input posta
    if ($('gameStakeInput')) {
        $('gameStakeInput').disabled = state.locked;
        if (state.locked && state.gameStake > 0) $('gameStakeInput').value = state.gameStake.toFixed(2);
    }

    // Aggiunta giocatori SOLO quando bestia=0
    const canEdit = canEditPlayersNow();
    if ($('addWrap')) $('addWrap').style.display = canEdit ? 'grid' : 'none';
    if ($('playersTableWrap')) $('playersTableWrap').style.display = canEdit ? '' : 'none';
    if ($('addHint')) $('addHint').textContent = canEdit
        ? 'Puoi aggiungere/rimuovere giocatori solo quando la Bestia è 0.'
        : 'Per aggiungere giocatori, la Bestia deve essere 0.';

    // tabella giocatori (solo setup)
    if ($('playersHead')) $('playersHead').innerHTML =
        `<tr><th>#</th><th>Giocatore</th><th class="right">Totale</th><th style="width:60px"></th></tr>`;

    const body = $('playersBody');
    if (body) {
        body.innerHTML = '';
        if (canEdit) {
            state.players.forEach((p, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${p.name}${(i === state.dealerIndex ? ' 🎴' : '')}</td>
          <td class="right">€ ${currency(p.total || 0)}</td>
          <td><button class="btn-red">🗑️</button></td>
        `;
                tr.querySelector('button').addEventListener('click', () => removePlayer(p.id));
                body.appendChild(tr);
            });
        }
    }

    renderHistoryTable();

    // start mano
    if ($('startRound')) $('startRound').disabled = state.round.active || state.players.length === 0;

    // chiudi conti: attivo solo se c'è almeno una mano o totali != 0
    const anyHands = state.hands.length > 0;
    if ($('settleBtn')) $('settleBtn').disabled = !anyHands;

    save();
}

// ===== Reset =====
function resetGame() {
    if (!confirm('Sei sicuro di voler resettare la partita?\nQuesto azzera piatto, totali, stake e storico.')) return;
    state.players = [];
    state.pot = 0;
    state.hands = [];
    state.history = [];
    state.locked = false;
    state.gameStake = 0;
    state.dealerIndex = 0;
    state.round = { active: false, dealerId: null, basePot: 0, participants: new Set(), groups: [], winners: [null, null, null] };
    localStorage.removeItem(LS_KEY);
    if ($('gameStakeInput')) $('gameStakeInput').value = '0.30';
    render();
}

// ===== Wiring =====
document.addEventListener('DOMContentLoaded', () => {
    on($('resetBtn'), 'click', resetGame);
    on($('undoBtn'), 'click', undo);
    on($('settleBtn'), 'click', showSettlement);

    on($('addPlayerBtn'), 'click', () => {
        addPlayer($('newName').value);
        $('newName').value = '';
        $('newName').focus();
    });

    on($('lockBtn'), 'click', lockPlayers);
    on($('startRound'), 'click', startRound);

    // partecipanti -> avanti
    on($('participantsConfirm'), 'click', (e) => {
        e.preventDefault();
        $('participantsModal').close();

        if (state.round.participants.size === 0) {
            settleNoPlayers();
            return;
        }

        const nonp = currentNonParticipants();
        if (nonp.length === 0) {
            openWinnersModal();
        } else {
            openNonParticipantsModal();
        }
    });

    // indietro da rientri/gruppi -> torna ai partecipanti
    on($('npBack'), 'click', (e) => {
        e.preventDefault();
        $('npModal').close();
        openParticipantsModal();
    });

    // avanti da rientri/gruppi -> vincitori
    on($('npNext'), 'click', (e) => {
        e.preventDefault();
        $('npModal').close();
        openWinnersModal();
    });

    // indietro da vincitori -> rientri/gruppi (se ci sono non partecipanti), altrimenti partecipanti
    on($('winnersBack'), 'click', (e) => {
        e.preventDefault();
        $('winnersModal').close();

        const nonp = currentNonParticipants();
        if (nonp.length === 0) openParticipantsModal();
        else openNonParticipantsModal();
    });

    on($('winnersConfirm'), 'click', (e) => {
        e.preventDefault();
        $('winnersModal').close();
        settleAndClose();
    });

    load();
    render();
});
