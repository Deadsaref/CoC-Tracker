const STORAGE_KEY = 'dmTracker';
const STORAGE_VERSION = 1;

let rows = [];
let mode = 'investigator';
let saveName = localStorage.getItem('dmTrackerName') || 'Untitled';
let sortState = { key: null, asc: true };
let draggedRowId = null;

// Состояние боя и UI в одном объекте
const AppState = {
  combat: {
    active: false,
    round: 0,
    selectedId: null,
  },
  stateMenu: {
    rowId: null,
    selectedEffect: null,
  },
  help: {
    open: false,
  },
};

const EFFECT_DEFS = [
  { key: 'unconscious', label: 'Без сознания' },
  { key: 'amnesia', label: 'Амнезия' },
  { key: 'rampage', label: 'Буйство' },
  { key: 'disorder', label: 'Расстройство' },
  { key: 'paranoia', label: 'Паранойя' },
  { key: 'flee', label: 'Бегство' },
  { key: 'emotional', label: 'Взрыв эмоций' },
  { key: 'phobia', label: 'Фобия/мания' },
  { key: 'injury', label: 'Серьёзная рана' },
  { key: 'madness', label: 'Затаённое безумие' },
];

load();
setupUI();
render();


function setupUI() {
  document.getElementById('addBtn').onclick = addRow;

  document.getElementById('modeInvestigators').onclick = () => setMode('investigator');
  document.getElementById('modeArsenal').onclick = () => setMode('arsenal');
  const modeGrimoireBtn = document.getElementById('modeGrimoire');
  if (modeGrimoireBtn) {
    modeGrimoireBtn.onclick = () => setMode('grimoire');
  }

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.onclick = () => sortBy(th.dataset.sort);
  });

  document.querySelector('.add-form').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRow();
    }
  });

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const keeperScreen = document.getElementById('keeperScreen');
  const tbody = document.getElementById('tableBody');
  const spellDescInput = document.getElementById('spellDesc');

  if (undoBtn) undoBtn.addEventListener('click', () => undo());
  if (redoBtn) redoBtn.addEventListener('click', () => redo());
  if (exportBtn) exportBtn.addEventListener('click', () => exportData());
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const input = document.getElementById('importFile');
      if (input) input.click();
    });
  }
  if (keeperScreen) {
    keeperScreen.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      const action = btn.dataset.action;
      if (action === 'screen-show') {
        toggleHidden(id);
      } else if (action === 'screen-remove') {
        removeRow(id);
      }
    });
  }

  // Авто-рост поля описания заклинания в гримуаре
  if (spellDescInput) {
    const autoResize = (el) => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };
    spellDescInput.addEventListener('input', () => autoResize(spellDescInput));
    autoResize(spellDescInput);
  }

  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const rowId = tr.dataset.id;
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;

      if (action === 'hp-dec') {
        changeHp(rowId, -1);
      } else if (action === 'hp-inc') {
        changeHp(rowId, 1);
      } else if (action === 'san-dec') {
        changeSan(rowId, -1);
      } else if (action === 'san-inc') {
        changeSan(rowId, 1);
      } else if (action === 'san-ack') {
        ackSan(rowId);
      } else if (action === 'speed-dec') {
        changeSpeed(rowId, -1);
      } else if (action === 'speed-inc') {
        changeSpeed(rowId, 1);
      } else if (action === 'row-eye') {
        toggleHidden(rowId);
      } else if (action === 'row-remove') {
        removeRow(rowId);
      } else if (action === 'effect-badge') {
        const effectKey = actionEl.dataset.effect;
        if (effectKey) onEffectBadgeClick(rowId, effectKey);
      } else if (action === 'weapon-remove') {
        const weaponId = actionEl.dataset.weaponId;
        if (weaponId) removeWeaponFromInvestigator(rowId, weaponId);
      }
    });

    tbody.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const rowId = tr.dataset.id;
      const nameCell = e.target.closest('td.name');
      if (nameCell) {
        // Двойной клик по имени (по всей ячейке) — редактирование персонажа
        openEditInvestigatorModal(rowId);
        return;
      }

      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;

      if (action === 'row-restore-hp') {
        restoreHpPrompt(rowId);
      }
    });

    tbody.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const rowId = tr.dataset.id;
      const nameCell = e.target.closest('td.name');
      const actionEl = e.target.closest('[data-action]');
      const action = actionEl ? actionEl.dataset.action : null;

      // ПКМ по имени или ячейке имени — открыть меню состояний
      if (nameCell || action === 'open-state-menu' || action === 'edit-investigator') {
        e.preventDefault();
        openStateMenu(rowId);
      }
    });
  }

  initSaveNameUI();
  setupCombatUI();
  setupStateMenuUI();
  setupHelpUI();
}

function setMode(m) {
  mode = m;

  const tracker = document.querySelector('.tracker');
  tracker.classList.toggle('investigator-mode', m === 'investigator');
  tracker.classList.toggle('arsenal-mode', m === 'arsenal');
  tracker.classList.toggle('grimoire-mode', m === 'grimoire');

  document.getElementById('modeInvestigators')
    .classList.toggle('active', m === 'investigator');

  document.getElementById('modeArsenal')
    .classList.toggle('active', m === 'arsenal');

  const modeGrimoireBtn = document.getElementById('modeGrimoire');
  if (modeGrimoireBtn) {
    modeGrimoireBtn.classList.toggle('active', m === 'grimoire');
  }

  save();
  render();
}



function addRow() {
  pushUndo('Добавление записи');
  const nameInput = document.getElementById('name');
  if (!nameInput.value.trim()) return alert('Имя не может быть пустым');
  if (mode === 'investigator') {
  row = {
    id: crypto.randomUUID(),
    mode: 'investigator',
    name: nameInput.value.trim(),
    
    hp: +hp.value || 0,
    baseHp: +hp.value || 0,
    
    armor: +armor.value || 0,
    
    str: +str.value || 0,
    con: +con.value || 0,
    siz: +siz.value || 0,
    db: '', // вычислим ниже
    dex: +dex.value || 0,
    baseDex: +dex.value || 0,
    dexBoosted: false,
    
    san: +san.value || 0,
    baseSan: +san.value || 0,
    sanAlert: false,
    
    brawl,        // Драка
    handgun,     // Стрельба (пистолет)
    rifle,      //Стрельба (винтовка/дробовик)
    pow: +pow.value || 0,
    mp: Math.floor((+pow.value || 0) / 5),
    weapons: [], // оружие
    note: '',
    hidden:false
  };
    row.db = calcDB(row.str, row.siz);
    row.baseSpeed = calcSpeed(row.dex, row.str, row.siz);
    row.speedMod = 0;
    row.hp = row.baseHp = calcHp(row.siz, row.con);

  } else if (mode === 'arsenal') {
    row = {
      id: crypto.randomUUID(),
      mode: 'arsenal',        // ← арсенал
      name: nameInput.value.trim(),
      bonus: weaponBonus.checked,
      damage: damage.value.trim() || '—',
      range: weaponRange.value.trim() || '',
      note: '',
      hidden: false
    };
  } else if (mode === 'grimoire') {
    const costInput = document.getElementById('spellCost');
    const timeInput = document.getElementById('spellTime');
    const descInput = document.getElementById('spellDesc');
    row = {
      id: crypto.randomUUID(),
      mode: 'grimoire',
      name: nameInput.value.trim(),
      cost: costInput ? costInput.value.trim() : '',
      time: timeInput ? timeInput.value.trim() : '',
      note: descInput ? descInput.value.trim() : '',
      hidden: false
    };
  }

  rows.push(row);
  nameInput.value = hp.value = armor.value = dex.value = san.value = damage.value = '';
  if (typeof weaponRange !== 'undefined') {
    weaponRange.value = '';
  }
  const spellCost = document.getElementById('spellCost');
  const spellTime = document.getElementById('spellTime');
  const spellDesc = document.getElementById('spellDesc');
  if (spellCost) spellCost.value = '';
  if (spellTime) spellTime.value = '';
  if (spellDesc) {
    spellDesc.value = '';
    spellDesc.style.height = '36px'; // Сб��ос высоты к автоматической после очистки
  }
  save();
  render();
}

function calcDB(str, siz) {
  const sum = str + siz;

  if (sum <= 64) return '-2';
  if (sum <= 84) return '-1';
  if (sum <= 124) return '0';
  if (sum <= 164) return '+1d4';
  if (sum <= 204) return '+1d6';
  if (sum <= 284) return '+2d6';
  if (sum <= 364) return '+3d6';
  if (sum <= 444) return '+4d6';
  if (sum <= 524) return '+5d6';
  return '+6d6';
}

/** HP from (siz+con)/10, rounding down */
function calcHp(siz, con) {
  return Math.floor(((+siz || 0) + (+con || 0)) / 10);
}

function getMaxHp(row) {
  if (row.baseHp != null) return row.baseHp;
  return calcHp(row.siz, row.con);
}

/** Speed from dex, str, siz: (dex & str) < siz → 7; dex>=siz && str>=siz → 9; else 8 */
function calcSpeed(dex, str, siz) {
  const d = +dex || 0, s = +str || 0, z = +siz || 0;
  if (d >= z && s >= z) return 9;
  if (d < z && s < z) return 7;
  return 8;
}

function getBaseSpeed(row) {
  return row.baseSpeed != null ? row.baseSpeed : (row.speed != null ? row.speed : calcSpeed(row.dex, row.str, row.siz));
}
function getSpeedMod(row) {
  return row.speedMod ?? 0;
}
function getCurrentSpeed(row) {
  return getBaseSpeed(row) + getSpeedMod(row);
}
function sortBy(key) {
  if (mode === 'arsenal' && !['name', 'damage'].includes(key)) return;
  if (mode === 'investigator' && key === 'damage') return;
  if (sortState.key === key) sortState.asc = !sortState.asc;
  else { sortState.key = key; sortState.asc = true; }
  syncNotesFromDOM();
  rows.sort((a, b) => {
    const va = key === 'speed' && a.mode === 'investigator' ? getCurrentSpeed(a) : a[key];
    const vb = key === 'speed' && b.mode === 'investigator' ? getCurrentSpeed(b) : b[key];
    if (va < vb) return sortState.asc ? -1 : 1;
    if (va > vb) return sortState.asc ? 1 : -1;
    return 0;
  });
  render();
}

function getArsenalOptions(selectedId) {
  return rows
    .filter(r => r.mode === 'arsenal')
    .map(w => `
      <option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>
        ${w.name} (${w.damage})
      </option>
    `)
    .join('');
}

function render() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  rows.filter(r => r.mode === mode && !r.hidden).forEach(row => {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.classList.add('tracker-row');
    tr.dataset.id = row.id;

    tr.addEventListener('dragstart', (e) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        const node = sel.anchorNode;
        const el = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
        if (el && el.closest('.note-content')) {
          e.preventDefault();
          return;
        }
      }
      draggedRowId = row.id;
      tr.classList.add('dragging');
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      draggedRowId = null;
      save();
});

    tr.innerHTML = renderRowInner(row);
    tbody.appendChild(tr);
  });

   tbody.ondragover = e => {
    e.preventDefault();

    const targetRow = e.target.closest('tr');
    if (!targetRow || !draggedRowId) return;

    const targetId = targetRow.dataset.id;
    if (targetId === draggedRowId) return;

    const from = rows.findIndex(r => r.id === draggedRowId && r.mode === mode);
    const to   = rows.findIndex(r => r.id === targetId && r.mode === mode);


    if (from === -1 || to === -1) return;

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);

    render();
  };

  // Подсветка активной боевой строки после перерисовки
  if (AppState.combat.active && AppState.combat.selectedId) {
    setCombatSelection(AppState.combat.selectedId, false);
  }

  const screen = document.getElementById('keeperScreen');
  screen.innerHTML = '';

  const hiddenRows = rows
    .filter(r => r.mode === mode && r.hidden)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { sensitivity: 'base' }));

  hiddenRows.forEach(row => {
      const div = document.createElement('div');
      div.className = 'screen-row';

      // Ширма
      let summary = row.name;
      if (row.mode === 'investigator') {
        summary = `${row.name} — ПЗ ${row.hp}, РАС ${row.san}, ЛВК ${row.dex}`;
      } else if (row.mode === 'arsenal') {
        summary = `${row.name} — ${row.damage || '—'}`;
      } else if (row.mode === 'grimoire') {
        summary = `${row.name} — ${row.cost || ''}`;
      }

      div.innerHTML = `
        <button class='eye-btn' data-action="screen-show" data-id="${row.id}" title="Показать">👁</button>
        <span>${summary}</span>
        <button class='remove-btn' data-action="screen-remove" data-id="${row.id}" title="Удалить строку">✖</button>
      `;
      screen.appendChild(div);
    });
  
}

function renderRowInner(row) {
  return (
    row.mode === 'investigator'
      ? renderInvestigatorRow(row)
      : row.mode === 'arsenal'
        ? renderArsenalRow(row)
        : renderGrimoireRow(row)
  );
}

function updateRowDom(rowId) {
  const row = rows.find(r => r.id === rowId && r.mode === mode);
  if (!row) return;
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  const tr = tbody.querySelector(`tr[data-id="${rowId}"]`);
  if (!tr) return;
  tr.innerHTML = renderRowInner(row);
}

function updateField(id, field, value) {
  const r = rows.find(x => x.id === id);
  if (!r) return;

  const num = parseInt(value, 10);
  if (!isNaN(num)) {
    r[field] = num;
    save();
  }
}
/* функция доджа+изменение
<td class="investigator-only dodge">
      <div class="editable"
          contenteditable="true"
          onblur="updateField('${row.id}', 'dodge', this.innerText)">
        ${row.dodge}
      </div>
    </td> */
/* Что выводим в строку персонажа */
function renderInvestigatorRow(row) {
  return `
    <td class="effects-cell investigator-only">
      <div class="effects-stack">
        ${renderRowEffects(row)}
      </div>
    </td>

    <td class="name"
      onmouseenter="showInvestigatorTooltip(event, '${row.id}')"
      onmousemove="moveTooltip(event)"
      onmouseleave="hideTooltip()">

     <div class="name-content" data-action="edit-investigator">${row.name}</div>

    </td>


    <td class="${row.hp < (row.baseHp ?? calcHp(row.siz, row.con)) ? 'hp-incomplete' : ''}"
        onmouseenter="showHpTooltip(event, '${row.id}')"
        onmouseleave="hideTooltip()">
      <button class="stat-btn" data-action="hp-dec">−</button>
      <span class="stat-value" id="hp-${row.id}" data-action="row-restore-hp">${row.hp}</span>
      <button class="stat-btn" data-action="hp-inc">+</button>
    </td>



    <td class="db-cell">
      ${row.db}
    </td>

    <td class="${row.dexBoosted ? 'highlight' : ''}"
        data-action="toggle-dex">
      ${row.dex}
    </td>

    <td class="speed-cell ${getSpeedMod(row) === -1 ? 'speed-low' : getSpeedMod(row) === 1 ? 'speed-high' : ''}">
      <button class="stat-btn speed-btn ${getSpeedMod(row) <= -1 ? 'speed-btn-locked' : ''}" data-action="speed-dec" ${getSpeedMod(row) <= -1 ? 'disabled' : ''}>−</button>
      <span class="stat-value">${getCurrentSpeed(row)}</span>
      <button class="stat-btn speed-btn ${getSpeedMod(row) >= 1 ? 'speed-btn-locked' : ''}" data-action="speed-inc" ${getSpeedMod(row) >= 1 ? 'disabled' : ''}>+</button>
    </td>

    <td class="${row.sanAlert ? 'san-alert' : ''}"
        data-action="san-ack"
        onmouseenter="showSanTooltip(event, '${row.id}')"
        onmouseleave="hideTooltip()">
      <button class="stat-btn" data-action="san-dec">−</button>
      <span class="stat-value" id="san-${row.id}">${row.san}</span>
      <button class="stat-btn" data-action="san-inc">+</button>
    </td>
    

    <td class="weapons-cell">
      <div class="weapon-tags">
        ${renderWeaponTags(row)}
      </div>

      <input
        class="weapon-input"
        placeholder="+ оружие"
        oninput="showWeaponSuggestions('${row.id}', this)"
        onfocus="showWeaponSuggestions('${row.id}', this)"
        onkeydown="weaponInputKeydown(event, '${row.id}', this)"
      >

      <div class="weapon-suggestions" id="weapon-suggest-${row.id}"></div>
    </td>


    <td class="note">
      <div class="note-content"
           contenteditable="true"
           oninput="updateNote('${row.id}', this)">
        ${row.note || ''}
      </div>
    </td>

    <td>
      <button class="eye-btn" data-action="row-eye">👁</button>
    </td>

    <td>
      <button class="remove-btn" data-action="row-remove">✖</button>
    </td>
  `;
}

function showInvestigatorTooltip(e, id) {
  const r = rows.find(x => x.id === id);
  if (!r) return;

  const html = `
    <div class="inv-tooltip">
      <div class="inv-tooltip-name">${r.name}</div>
      <div class="inv-tooltip-stats">
        <div><b>СИЛ</b>: ${r.str}</div>
        <div><b>ВЫН</b>: ${r.con}</div>
        <div><b>ТЕЛ</b>: ${r.siz}</div>
        <div><b>ЛВК</b>: ${r.dex}</div>
        <div><b>МОЩ</b>: ${r.pow ?? 0}</div>
        <div><b>ПМ</b>: ${r.mp ?? Math.floor(((r.pow || 0) / 5))}</div>
        </div>
        <div class="inv-tooltip-skills">
        <div><b>Драка</b>: ${r.brawl}%</div>
        <div><b>Пистолет</b>: ${r.handgun}%</div>
        <div><b>Винтовка</b>: ${r.rifle}%</div>
        <div><b>Уклонение</b>: ${r.dodge}%</div>
        <div><b>Броня</b>: ${r.armor}</div>
      </div>
    </div>
  `;

  showInvTooltip(e, html, true);
}

/* Что выводим в строку арсенала*/
function renderArsenalRow(row) {
  return `
    <td class="name">
      <div class="name-content"
           ondblclick="enableNameEdit(this)"
           onblur="disableNameEdit('${row.id}', this)"
           onkeydown="handleNameKey(event, '${row.id}', this)">
        ${row.name}
      </div>
    </td>
    
    <td>
      <input type="checkbox"
        ${row.bonus ? 'checked' : ''}
        onchange="toggleWeaponBonus('${row.id}', this.checked)">
    </td>

    <td class="arsenal-only">
      <div class="name-content"
           ondblclick="enableWeaponTextEdit(this)"
           onblur="disableWeaponTextEdit('${row.id}', 'damage', this)"
           onkeydown="handleWeaponTextKey(event, '${row.id}', 'damage', this)">
        ${row.damage}
      </div>
    </td>

    <td class="arsenal-only">
      <div class="name-content"
           ondblclick="enableWeaponTextEdit(this)"
           onblur="disableWeaponTextEdit('${row.id}', 'range', this)"
           onkeydown="handleWeaponTextKey(event, '${row.id}', 'range', this)">
        ${row.range || ''}
      </div>
    </td>

    <td class="note">
      <div class="note-content"
           contenteditable="true"
           oninput="updateNote('${row.id}', this)">
        ${row.note || ''}
      </div>
    </td>

    <td>
      <button class="remove-btn" data-action="row-remove">✖</button>
    </td>
  `;
}

/* Что выводим в строку гримуара */
function renderGrimoireRow(row) {
  return `
    <td class="name">
      <div class="name-content"
           ondblclick="enableNameEdit(this)"
           onblur="disableNameEdit('${row.id}', this)"
           onkeydown="handleNameKey(event, '${row.id}', this)">
        ${row.name}
      </div>
    </td>

    <td class="grimoire-only">
      <div class="name-content"
           ondblclick="enableWeaponTextEdit(this)"
           onblur="disableWeaponTextEdit('${row.id}', 'cost', this)"
           onkeydown="handleWeaponTextKey(event, '${row.id}', 'cost', this)">
        ${row.cost || ''}
      </div>
    </td>

    <td class="grimoire-only">
      <div class="name-content"
           ondblclick="enableWeaponTextEdit(this)"
           onblur="disableWeaponTextEdit('${row.id}', 'time', this)"
           onkeydown="handleWeaponTextKey(event, '${row.id}', 'time', this)">
        ${row.time || ''}
      </div>
    </td>

    <td class="note">
      <div class="note-content"
           contenteditable="true"
           oninput="updateNote('${row.id}', this)">
        ${row.note || ''}
      </div>
    </td>

    <td>
      <button class="remove-btn" data-action="row-remove">✖</button>
    </td>
  `;
}

// Speed buttons only change the ±1 modifier. baseSpeed is set only by creation or modal edit (modal has priority).
function changeSpeed(id, delta) {
  const r = rows.find(x => x.id === id);
  if (!r || r.mode !== 'investigator') return;
  const mod = getSpeedMod(r);
  const newMod = Math.max(-1, Math.min(1, mod + delta));
  if (newMod === mod) return;
  r.speedMod = newMod; // never touch r.baseSpeed — modal/creation own the base
  save();
  render();
}

function changeHp(id, d) {
  const r = rows.find(r => r.id === id);
  if (!r) return;

  const max = getMaxHp(r);
  r.hp = Math.max(0, Math.min(max, r.hp + d));
  save();
  updateRowDom(id);

  requestAnimationFrame(() => {
    const el = document.getElementById(`hp-${id}`);
    if (!el) return;
    el.classList.remove('stat-animate');
    void el.offsetWidth; // 👈 перезапуск анимации
    el.classList.add('stat-animate');
  });
}

function restoreHpPrompt(id) {
  const r = rows.find(row => row.id === id);
  if (!r || r.mode !== 'investigator') return;
  const max = getMaxHp(r);
  if (r.hp >= max) return;

  const ok = confirm(`Восстановить ПЗ до максимума (${max})?`);
  if (!ok) return;

  r.hp = max;
  save();
  updateRowDom(id);
}

function toggleDex(id) {
  const r = rows.find(r => r.id === id);
  r.dexBoosted = !r.dexBoosted;
  r.dex = r.dexBoosted ? r.baseDex + 50 : r.baseDex;
  syncNotesFromDOM();
  rows.sort((a, b) => b.dex - a.dex);
  commit({ scope: 'rows' });
}

function changeSan(id, d) {
  const r = rows.find(r => r.id === id);
  if (!r) return;

  r.san = Math.max(0, r.san + d);

  const base = r.baseSan ?? r.san;
  const threshold = base - base / 5;

  r.sanAlert = r.san <= threshold;

  save();
  updateRowDom(id);
}

function ackSan(id) {
  const r = rows.find(r => r.id === id);
  if (r.sanAlert) {
    r.sanAlert = false;
    r.baseSan = r.san; // пересчёт базы
  }
  save();
  updateRowDom(id);
}

function updateNote(id, el) {
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row.note = el.innerText;
  save();
}

function toggleHidden(id) {
  const r = rows.find(r => r.id === id);
  if (!r) return;
  r.hidden = !r.hidden;
  commit({ scope: 'all' });
}

document.getElementById("newDayBtn").onclick = () => {
  pushUndo('Новый день');
  rows.forEach(r => {
    r.baseSan = r.san;
    r.sanAlert = false;
  });
  render();
  save();

};

function syncNotesFromDOM() {
  document.querySelectorAll('.note-content').forEach(el => {
    const id = el.closest('tr').dataset.id;
    const row = rows.find(r => r.id === id);
    if (row) row.note = el.innerText;
  });
}

function removeRow(id) {
  pushUndo('Удаление записи');
  rows = rows.filter(r => r.id !== id);
  commit({ scope: 'all' });
}

function exportData() {

  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return alert('Нет данных для экспорта');

  // если приложение запущено как exe
  if (window.pywebview) {

    // Передаём подсказку имени файла из saveNameDisplay / saveName
    window.pywebview.api.save_json(data, getExportFileName());

  } else {

    // обычный браузер
    const blob = new Blob([data], { type: 'application/json' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = getExportFileName();
    a.click();

  }
}

document.getElementById('importFile').onchange = e => {
  pushUndo('Импорт');
  const file = e.target.files[0];
  if (!file) return;

   // Обновляем имя сохранения по имени файла
  const baseName = file.name.replace(/\.json$/i, '') || 'Untitled';
  saveName = baseName;
  localStorage.setItem('dmTrackerName', saveName);
  const display = document.getElementById('saveNameDisplay');
  if (display) display.textContent = saveName;

  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(STORAGE_KEY, reader.result);
    load();
    render();
  };
  reader.readAsText(file);
};

function save() {
  const payload = {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    data: {
      rows,
      mode,
      combat: {
        active: AppState.combat.active,
        round: AppState.combat.round,
        selectedId: AppState.combat.selectedId,
      },
    },
  };
  const json = JSON.stringify(payload);
  localStorage.setItem(STORAGE_KEY, json);

  // В режиме pywebview сразу дублируем локальное хранилище в autosave.json
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.autosave === 'function') {
    try {
      window.pywebview.api.autosave(json);
    } catch (err) {
      // если не получилось — просто продолжаем, чтобы не ломать работу в браузере
    }
  }
}

function initSaveNameUI() {
  const display = document.getElementById('saveNameDisplay');
  const input = document.getElementById('saveNameInput');
  if (!display || !input) return;

  display.textContent = saveName || 'Untitled';

  const startEdit = () => {
    input.value = saveName || 'Untitled';
    display.style.display = 'none';
    input.style.display = 'inline-block';
    input.focus();
    input.select();
  };

  const finishEdit = (commit) => {
    if (commit) {
      const value = input.value.trim() || 'Untitled';
      saveName = value;
      localStorage.setItem('dmTrackerName', saveName);
      display.textContent = saveName;
    }
    input.style.display = 'none';
    display.style.display = 'inline-block';
  };

  display.ondblclick = startEdit;

  input.addEventListener('blur', () => finishEdit(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  });
}

function getExportFileName() {
  const base = (saveName || 'Untitled').trim() || 'Untitled';
  // Разрешаем буквы/цифры, пробелы, дефис и подчёркивание (включая кириллицу)
  const sanitized = base
    .replace(/[^0-9A-Za-z\u0400-\u04FF _-]/g, '')
    .replace(/\s+/g, '_');
  const name = sanitized || 'Untitled';
  return name + '.json';
}

function load() {
  const d = localStorage.getItem(STORAGE_KEY);
  if (d) {
    let parsed;
    try {
      parsed = JSON.parse(d);
    } catch {
      parsed = null;
    }
    if (!parsed) return;

    // v0 (старый формат): {rows, mode, combat}
    // v1+: {version, savedAt, data:{rows, mode, combat}}
    const data = parsed && typeof parsed === 'object' && 'version' in parsed && parsed.data
      ? parsed.data
      : parsed;

    rows = data.rows || [];
    mode = data.mode || 'investigator';

    // Восстанавливаем состояние боя, если есть
    const combat = data.combat || {};
    AppState.combat.active = !!combat.active;
    AppState.combat.round = combat.round || 0;
    AppState.combat.selectedId = combat.selectedId || null;

     /* Что пишем в строку */
    rows.forEach(r => {
      
      if (r.mode === 'investigator') {
        r.str ??= 0;
        r.con ??= 0;
        r.siz ??= 0;
        r.pow ??= 0;
        r.db ??= calcDB(r.str, r.siz);
        if (r.baseSpeed === undefined) r.baseSpeed = r.speed != null ? r.speed : calcSpeed(r.dex, r.str, r.siz);
        r.speedMod ??= 0;
        if (r.hp === undefined && r.baseHp === undefined) {
          const h = calcHp(r.siz, r.con);
          r.hp = h;
          r.baseHp = h;
        }
        r.mp ??= Math.floor(((r.pow || 0) / 5));
        r.brawl ??= 25;
        r.handgun ??= 20;
        r.rifle ??= 25;
        r.weapons ??= [];
        r.effects ??= [];
        if (r.dodge === undefined) {
          const base = Math.floor((r.dex || 0) / 2);
          r.dodge = base;
          r.baseDodge = base;
        }
      }

      // 🔹 arsenal
      if (r.mode === 'arsenal') {
        r.bonus ??= false;
        r.damage ??= '—';
        r.range ??= '';
      }

      // 🔹 grimoire
      if (r.mode === 'grimoire') {
        r.cost ??= '';
        r.time ??= '';
      }

      r.note ??= '';
      r.hidden ??= false;
    });
  }
}

function commit(options) {
  const opts = options || {};
  const doSave = opts.save !== false;
  const scope = opts.scope || 'all';

  if (doSave) {
    save();
  }

  // Пока что все варианты обновляют весь UI.
  if (scope === 'all' || scope === 'rows' || scope === 'row') {
    render();
  }
}

const SNAPSHOT_KEY = 'dmTracker_snapshots';
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 минут

function saveSnapshot() {
  const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');

  snapshots.push({
    time: Date.now(),
    data: (() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    })()
  });

  // храним последние 10
  if (snapshots.length > 10) snapshots.shift();

  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
}
setInterval(saveSnapshot, SNAPSHOT_INTERVAL);

let undoStack = [];
let redoStack = [];
const UNDO_LIMIT = 20;
const TOAST_DURATION = 3000;

function pushUndo(description) {
  const desc = description || 'Изменение';
  redoStack.length = 0;
  undoStack.push({ state: JSON.stringify({ rows, mode }), description: desc });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoRedoButtons();
}

function undo() {
  if (undoStack.length === 0) {
    alert('Нечего отменять');
    return;
  }
  const item = undoStack.pop();
  const prev = JSON.parse(item.state);
  redoStack.push({ state: JSON.stringify({ rows, mode }), description: item.description });
  rows = prev.rows;
  mode = prev.mode;
  save();
  render();
  updateUndoRedoButtons();
  showToast('Отменено: ' + item.description);
}

function redo() {
  if (redoStack.length === 0) return;
  const item = redoStack.pop();
  const next = JSON.parse(item.state);
  undoStack.push({ state: JSON.stringify({ rows, mode }), description: item.description });
  rows = next.rows;
  mode = next.mode;
  save();
  render();
  updateUndoRedoButtons();
  showToast('Повторено: ' + item.description);
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    setTimeout(() => el.remove(), 200);
  }, TOAST_DURATION);
}

// Глобальные хоткеи
document.addEventListener('keydown', (e) => {
  // Не ломаем модалки создания/редактирования — там отдельный обработчик
  const createModal = document.getElementById('investigatorModal');
  const editModal = document.getElementById('editInvestigatorModal');
  const modalOpen =
    (createModal && !createModal.classList.contains('hidden')) ||
    (editModal && !editModal.classList.contains('hidden'));
  if (modalOpen) return;

  // Игнорируем, когда фокус в полях ввода/заметках
  const target = e.target;
  const tag = target.tagName;
  const isEditable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable;
  if (isEditable) return;

  // F1 — помощь (модальное окно)
  if (e.key === 'F1') {
    e.preventDefault();
    if (!AppState.help.open) {
      openHelpModal();
    } else {
      closeHelpModal();
    }
    return;
  }

  if (e.key === 'Escape' && AppState.help.open) {
    e.preventDefault();
    closeHelpModal();
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // Undo / Redo
  if (ctrl && !shift && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if ((ctrl && shift && e.key.toLowerCase() === 'z') || (ctrl && e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    redo();
    return;
  }

  // Бой: Alt+ArrowUp / Alt+ArrowDown — перемещение выделения
  if (e.altKey && !ctrl && !shift && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    moveCombatSelection(e.key === 'ArrowUp' ? 'up' : 'down');
    return;
  }

  // Бой: Alt+B — старт/панель боя (как клик по кнопке)
  if (e.altKey && !ctrl && !shift && (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И')) {
    e.preventDefault();
    const toggle = document.getElementById('combatToggle');
    if (toggle) toggle.click();
    return;
  }

    // Бой: Alt+E — завершение боя
  if (e.altKey && !ctrl && !shift && (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У')) {
    e.preventDefault();
    const toggle = document.getElementById('combatEnd');
    if (toggle) toggle.click();
    return;
  }
});

function updateName(id, el) {
  pushUndo();
  const row = rows.find(r => r.id === id);
  if (!row) return;

  const value = el.innerText.trim();

  // запрещаем пустое имя
  if (!value) {
    el.innerText = row.name;
    return;
  }

  row.name = value;
  save();
}

function enableNameEdit(el) {
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();

  // курсор в конец
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function disableNameEdit(id, el) {
  el.contentEditable = 'false';
  el.classList.remove('editing');

  const row = rows.find(r => r.id === id);
  if (!row) return;

  const value = el.innerText.trim();

  if (!value) {
    el.innerText = row.name; // откат
    return;
  }

  if (row.name !== value) {
    pushUndo();
    row.name = value;
    save();
  }
}

function handleNameKey(e, id, el) {
  if (e.key === 'Enter') {
    
    e.preventDefault();
    el.blur();
  }

  if (e.key === 'Escape') {
    el.innerText = rows.find(r => r.id === id).name;
    el.blur();
  }
}

function enableWeaponTextEdit(el) {
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();

  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function disableWeaponTextEdit(id, field, el) {
  el.contentEditable = 'false';
  el.classList.remove('editing');

  const row = rows.find(r => r.id === id);
  if (!row) return;

  const value = el.innerText.trim();

  // Пустое значение не сохраняем — восстанавливаем предыдущее
  if (!value && row[field]) {
    el.innerText = row[field];
    return;
  }

  if (row[field] !== value) {
    pushUndo();
    row[field] = value;
    save();
  }
}

function handleWeaponTextKey(e, id, field, el) {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.blur();
  }

  if (e.key === 'Escape') {
    const row = rows.find(r => r.id === id);
    if (row) {
      el.innerText = row[field] || '';
    }
    el.blur();
  }
}

function setWeapon(id, weaponId) {
  const r = rows.find(r => r.id === id);
  if (!r) return;

  pushUndo();
  r.weaponId = weaponId || null;
  save();
}

function getArsenal() {
  // Теперь возвращаем и оружие, и заклинания
  return rows.filter(r => r.mode === 'arsenal' || r.mode === 'grimoire');
}

function addWeaponToInvestigator(invId, weaponId) {
  const inv = rows.find(r => r.id === invId);
  if (!inv) return;

  if (!Array.isArray(inv.weapons)) {
    inv.weapons = [];
  }

  if (inv.weapons.includes(weaponId)) return;

  pushUndo();
  inv.weapons.push(weaponId);
  save();
  render();
}

function removeWeaponFromInvestigator(invId, weaponId) {
  const inv = rows.find(r => r.id === invId);
  if (!inv) return;

  pushUndo();
  inv.weapons = inv.weapons.filter(id => id !== weaponId);
  save();
  render();
}

function renderWeaponTags(row) {
  if (!row.weapons?.length) return '';

  return row.weapons.map(id => {
    const w = rows.find(r => r.id === id);
    if (!w) return '';

    return `
      <span class="weapon-tag ${w.mode === 'grimoire' ? 'spell-tag' : ''}"
            onmouseenter="showWeaponTagTooltip(event,'${row.id}','${id}')"
            onmouseleave="hideTooltip()">
        ${w.name}
        <button data-action="weapon-remove" data-weapon-id="${id}">✖</button>
      </span>
    `;
  }).join('');
}



function showWeaponSuggestions(invId, input) {
  const inv = rows.find(r => r.id === invId);
  const box = document.getElementById(`weapon-suggest-${invId}`);
  box.innerHTML = '';

const query = (input?.value || '').trim().toLowerCase();
  if (!input || !inv) return;
  let list = getArsenal();

  if (query) {
    list = list.filter(w =>
      w.name.toLowerCase().includes(query)
    );
  }

  list.slice(0, 10).forEach(w => {
    const div = document.createElement('div');
    div.className = 'weapon-suggestion';
    let label = w.name;
    if (w.mode === 'arsenal') {
      label = `${w.name} (${w.damage || '—'})`;
    } else if (w.mode === 'grimoire') {
      const cost = w.cost || '';
      const time = w.time || '';
      const extra = [cost, time].filter(Boolean).join(' · ');
      label = extra ? `${w.name} (${extra})` : w.name;
    }
    div.textContent = label;
    
    if (inv.weapons?.includes(w.id)) {
      div.classList.add('selected');
    }

    div.onclick = () => {
      addWeaponToInvestigator(invId, w.id);
      input.value = '';
      showWeaponSuggestions(invId, input); // 🔥 перерисовать с подсветкой
      //box.innerHTML = '';
      input.focus();
      
    };

    box.appendChild(div);
  });
}

function weaponInputKeydown(e, invId, input) {
  if (e.key === 'Escape') {
    input.value = '';
    showWeaponSuggestions(invId, '');
  }
}

/* document.addEventListener('click', e => {
  if (!e.target.closest('.weapons-cell')) {
    document.querySelectorAll('.weapon-suggestions')
      .forEach(b => b.innerHTML = '');
  }
}); */

document.addEventListener('mousedown', e => {

  const clickedBlock = e.target.closest('.weapons-cell');

  document.querySelectorAll('.weapons-cell').forEach(block => {

    if (block !== clickedBlock) {

      const list = block.querySelector('.weapon-suggestions');

      if (list) list.innerHTML = '';
      

    }

  });

});

/*div.classList.toggle(
  'selected',
  inv.weapons?.includes(w.id)
);*/
/*
if (inv.weapons?.includes(w.id)) {
  div.classList.add('selected');
}*/

function toggleWeaponBonus(id, value) {
  const r = rows.find(r => r.id === id);
  if (!r) return;

  pushUndo();
  r.bonus = value;
  save();
}

function recalcDB(row) {
  row.db = calcDB(row.str, row.siz);
}

function editNumberCell(rowId, field, el) {
  const row = rows.find(r => r.id === rowId);
  if (!row) return;

  const input = document.createElement('input');
  input.type = 'number';
  input.value = row[field];
  input.className = 'inline-edit';

  input.onblur = () => saveValue();
  input.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  };

  function saveValue() {
    row[field] = +input.value || 0;

    // 🔥 если менялись СИЛ или ТЕЛ — пересчитываем БкУ
    if (field === 'str' || field === 'siz') {
      row.db = calcDB(row.str, row.siz);
    }

    // 🔥 если менялись ВЫН или ТЕЛ — пересчитываем максимум ПЗ
    if (field === 'con' || field === 'siz') {
      const newMax = calcHp(row.siz, row.con);
      row.baseHp = newMax;
      if (row.hp > newMax) {
        row.hp = newMax;
      }
    }

    save();
    render();
  }

  el.replaceWith(input);
  input.focus();
  input.select();
}

function formatDamage(base, db, hasBonus) {
  if (!hasBonus || !db || db === '0') return base;

  if (db.startsWith('-')) {
    return `${base} ${db}`;
  }

  return `${base} + ${db.replace('+', '')}`;
}

function showWeaponTagTooltip(e, invId, itemId) {
  const inv = rows.find(r => r.id === invId);
  const item = rows.find(r => r.id === itemId);
  if (!item) return;

  if (item.mode === 'arsenal') {
    const t = document.getElementById('tooltip');
    if (t) t.classList.remove('spell-tooltip');
    const damageText = formatDamage(
      item.damage || '—',
      inv ? inv.db : '',
      item.bonus
    );
    showTooltip(e, damageText);
    return;
  }

  if (item.mode === 'grimoire') {
    const t = document.getElementById('tooltip');
    if (t) t.classList.add('spell-tooltip');
    const lines = [];
    lines.push(item.name || 'Без названия');
    if (item.cost) lines.push(`Стоимость: ${item.cost}`);
    if (item.time) lines.push(`Время сотворения: ${item.time}`);
    if (item.note) lines.push(`Описание: ${item.note}`);

    const text = lines.join('\n');
    showInvTooltip(e, text, false);
  }
}

function showInvTooltip(e, content, isHtml = false) {
  const t = document.getElementById('tooltip');
  if (isHtml) {
    t.innerHTML = content;
  } else {
    t.textContent = content;
  }

  t.style.left = e.clientX + 14 + 'px';
  t.style.top  = e.clientY + 14 + 'px';
  t.style.opacity = 1;
}

function showHpTooltip(e, id) {
  const r = rows.find(x => x.id === id);
  if (!r || r.mode !== 'investigator') return;
  const max = getMaxHp(r);
  showInvTooltip(e, `Максимум ПЗ: ${max}`, false);
}

function showSanTooltip(e, id) {
  const r = rows.find(x => x.id === id);
  if (!r || r.mode !== 'investigator') return;
  const base = r.baseSan ?? r.san ?? 0;
  showInvTooltip(e, `Базовая РАС: ${base}`, false);
}

function showTooltip(e, text) {
  const t = document.getElementById('tooltip');
  // Тултип урона оружия: свой класс, без «магического» оформления спелла
  t.classList.remove('spell-tooltip');
  t.classList.add('weapon-tooltip');
  t.textContent = `Урон: ${text}`;
  t.style.left = e.clientX + 12 + 'px';
  t.style.top = e.clientY + 12 + 'px';
  t.style.opacity = 1;
}

function hideTooltip() {
  const t = document.getElementById('tooltip');
  t.style.opacity = 0;
  // При скрытии тоже снимаем классы, чтобы следующий тултип начинал «с чистого листа»
  t.classList.remove('spell-tooltip', 'weapon-tooltip');
}

let clonedWeapons = null;

function confirmAddInvestigator() {
  const mName = document.getElementById('modal-name');
  const mArmor = document.getElementById('modal-armor');
  const mStr = document.getElementById('modal-str');
  const mCon = document.getElementById('modal-con');
  const mSiz = document.getElementById('modal-siz');
  const mDex = document.getElementById('modal-dex');
  const mPow = document.getElementById('modal-pow');
  const mSan = document.getElementById('modal-san');
  const mBrawl = document.getElementById('modal-brawl');
  const mHandgun = document.getElementById('modal-handgun');
  const mRifle = document.getElementById('modal-rifle');
  const mNote = document.getElementById('modal-note');
  
  if (!mName.value.trim()) {
    alert('Имя не может быть пустым');
    return;
  }
  
  const dexVal = +mDex.value || 0;
  const dex = +document.getElementById('modal-dex').value || 0;
  const dodgeInput = document.getElementById('modal-dodge').value;
  const baseDodge = Math.floor(dex / 2);
  const dodge = dodgeInput !== ''
  ? +dodgeInput
  : baseDodge;

  const sanVal = +mSan.value || 0;
  const powVal = +mPow.value || 0;

  const row = {
    id: crypto.randomUUID(),
    mode: 'investigator',
    name: mName.value.trim(),

    hp: 0,
    baseHp: 0,
    armor: +mArmor.value || 0,

    str: +mStr.value || 0,
    con: +mCon.value || 0,
    siz: +mSiz.value || 0,

    dex: dexVal,
    baseDex: dexVal,
    dexBoosted: false,
    dodge: dodge,
    baseDodge: dodge,

    pow: powVal,
    mp: Math.floor(powVal / 5),

    san: sanVal,
    baseSan: sanVal,
    sanAlert: false,

    brawl: +mBrawl.value || 25,
    handgun: +mHandgun.value || 20,
    rifle: +mRifle.value || 25,

    weapons: clonedWeapons ? [...clonedWeapons] : [],
    note: (mNote && mNote.value) ? mNote.value.trim() : '',
    hidden: false
  };

  row.db = calcDB(row.str, row.siz);
  row.hp = row.baseHp = calcHp(row.siz, row.con);
  row.baseSpeed = calcSpeed(row.dex, row.str, row.siz);
  row.speedMod = 0;

  pushUndo();
  rows.push(row);
  save();
  render();
  clearInvestigatorModal();
  closeInvestigatorModal();
  clonedWeapons = null;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#newInvestigatorBtn');
  if (!btn) return;
  openInvestigatorModal();
});

// Глобальные хоткеи для модалок создания/редактирования персонажа:
// Enter — сохранить, Esc — закрыть.
document.addEventListener('keydown', (e) => {
  const createModal = document.getElementById('investigatorModal');
  const editModal = document.getElementById('editInvestigatorModal');
  const createOpen = createModal && !createModal.classList.contains('hidden');
  const editOpen = editModal && !editModal.classList.contains('hidden');

  if (!createOpen && !editOpen) return;

  // Не перехватываем Enter внутри textarea (заметки)
  const tag = e.target.tagName;
  if (e.key === 'Enter' && tag === 'TEXTAREA') return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (editOpen) {
      confirmEditInvestigator();
    } else if (createOpen) {
      confirmAddInvestigator();
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (editOpen) {
      closeEditInvestigatorModal();
    } else if (createOpen) {
      closeInvestigatorModal();
    }
  }
});

function openInvestigatorModal() {
  clearInvestigatorModal();
  const modal = document.getElementById('investigatorModal');
  modal.classList.remove('hidden');
}

function clearInvestigatorModal() {
  const ids = ['modal-name', 'modal-armor', 'modal-str', 'modal-con', 'modal-siz', 'modal-dex', 'modal-pow', 'modal-mp', 'modal-dodge', 'modal-san', 'modal-brawl', 'modal-handgun', 'modal-rifle', 'modal-note'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function closeInvestigatorModal() {
  document.getElementById('investigatorModal').classList.add('hidden');
}

// --- Edit investigator modal (double-click on td.name in investigator row)
let editingInvestigatorId = null;

function openEditInvestigatorModal(rowId) {
  const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
  if (!row) return;
  editingInvestigatorId = rowId;
  fillEditInvestigatorForm(row);
  document.getElementById('editInvestigatorModal').classList.remove('hidden');
}

function cloneInvestigatorFromEdit() {
  if (!editingInvestigatorId) return;
  const row = rows.find(r => r.id === editingInvestigatorId && r.mode === 'investigator');
  if (!row) return;

  closeEditInvestigatorModal();
  openInvestigatorCloneModal(row);
}

function fillEditInvestigatorForm(row) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : value;
  };
  set('edit-modal-name', row.name);
  set('edit-modal-hp', row.hp);
  set('edit-modal-armor', row.armor ?? 0);
  set('edit-modal-str', row.str ?? 0);
  set('edit-modal-con', row.con ?? 0);
  set('edit-modal-siz', row.siz ?? 0);
  set('edit-modal-dex', row.dex ?? 0);
  set('edit-modal-speed', getBaseSpeed(row));
  set('edit-modal-pow', row.pow ?? 0);
  set('edit-modal-mp', row.mp ?? Math.floor(((row.pow || 0) / 5)));
  set('edit-modal-san', row.san ?? 0);
  set('edit-modal-brawl', row.brawl ?? 25);
  set('edit-modal-handgun', row.handgun ?? 20);
  set('edit-modal-rifle', row.rifle ?? 25);
  set('edit-modal-dodge', row.dodge ?? row.baseDodge ?? Math.floor((row.dex || 0) / 2));
  set('edit-modal-note', row.note ?? '');
}

function openInvestigatorCloneModal(sourceRow) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : value;
  };

  // Имя пустое, остальные параметры копируем
  set('modal-name', '');
  set('modal-armor', sourceRow.armor ?? 0);
  set('modal-str', sourceRow.str ?? 0);
  set('modal-con', sourceRow.con ?? 0);
  set('modal-siz', sourceRow.siz ?? 0);
  set('modal-dex', sourceRow.dex ?? 0);
  set('modal-pow', sourceRow.pow ?? 0);
  set('modal-mp', sourceRow.mp ?? Math.floor(((sourceRow.pow || 0) / 5)));
  set('modal-san', sourceRow.san ?? 0);
  set('modal-brawl', sourceRow.brawl ?? 25);
  set('modal-handgun', sourceRow.handgun ?? 20);
  set('modal-rifle', sourceRow.rifle ?? 25);

  const dodgeValue =
    sourceRow.dodge ??
    sourceRow.baseDodge ??
    Math.floor((sourceRow.dex || 0) / 2);
  set('modal-dodge', dodgeValue);

  set('modal-note', sourceRow.note ?? '');

  // Копируем список оружий/заклинаний
  clonedWeapons = Array.isArray(sourceRow.weapons) ? [...sourceRow.weapons] : [];

  const modal = document.getElementById('investigatorModal');
  modal.classList.remove('hidden');

  const nameInput = document.getElementById('modal-name');
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

function confirmEditInvestigator() {
  if (!editingInvestigatorId) return;
  const row = rows.find(r => r.id === editingInvestigatorId && r.mode === 'investigator');
  if (!row) return;

  const mName = document.getElementById('edit-modal-name');
  if (!mName || !mName.value.trim()) {
    alert('Имя не может быть пустым');
    return;
  }

  const hpVal = +document.getElementById('edit-modal-hp').value || 0;
  const dexVal = +document.getElementById('edit-modal-dex').value || 0;
  const sanVal = +document.getElementById('edit-modal-san').value || 0;
  const powVal = +document.getElementById('edit-modal-pow').value || 0;

  pushUndo();
  row.name = mName.value.trim();
  row.hp = hpVal;
  row.baseHp = hpVal;
  row.armor = +document.getElementById('edit-modal-armor').value || 0;
  row.str = +document.getElementById('edit-modal-str').value || 0;
  row.con = +document.getElementById('edit-modal-con').value || 0;
  row.siz = +document.getElementById('edit-modal-siz').value || 0;
  row.dex = dexVal;
  row.baseDex = dexVal;
  row.pow = powVal;
  row.mp = Math.floor(powVal / 5);
  // Speed cell reads from modal: use edit-modal-speed as-is, do not overwrite with clamp or calc.
  const speedInput = document.getElementById('edit-modal-speed');
  const newBaseSpeed = speedInput && speedInput.value !== '' ? +speedInput.value : calcSpeed(row.dex, row.str, row.siz);
  row.baseSpeed = newBaseSpeed;
  row.speedMod = 0;
  row.san = sanVal;
  row.baseSan = sanVal;
  row.brawl = +document.getElementById('edit-modal-brawl').value || 25;
  row.handgun = +document.getElementById('edit-modal-handgun').value || 20;
  row.rifle = +document.getElementById('edit-modal-rifle').value || 25;
  const editDodgeEl = document.getElementById('edit-modal-dodge');
  const dodgeVal = editDodgeEl && editDodgeEl.value !== '' ? +editDodgeEl.value : Math.floor(row.dex / 2);
  row.dodge = dodgeVal;
  row.baseDodge = dodgeVal;
  const editNote = document.getElementById('edit-modal-note');
  row.note = editNote ? editNote.value.trim() : '';
  row.db = calcDB(row.str, row.siz);

  save();
  render();
  editingInvestigatorId = null;
  closeEditInvestigatorModal();
}

function closeEditInvestigatorModal() {
  document.getElementById('editInvestigatorModal').classList.add('hidden');
  editingInvestigatorId = null;
}

// --- Help modal (F1) ---

function setupHelpUI() {
  const title = document.getElementById('appTitle');
  if (title) {
    title.title = 'F1 — помощь';
  }

  const hotkeysEl = document.getElementById('helpHotkeys');
  if (hotkeysEl) {
    hotkeysEl.innerHTML = `
      <dl>
        <dt>Ctrl+Z</dt><dd>Отменить последнее изменение (Undo)</dd>
        <dt>Ctrl+Y / Ctrl+Shift+Z</dt><dd>Повторить изменение (Redo)</dd>
        <dt>Alt+↑ / Alt+↓ (только Персонажи)</dt><dd>Перемещение по инициативе в бою</dd>
        <dt>Alt+B (только Персонажи)</dt><dd>Запуск боя или показать/скрыть панель боя</dd>
        <dt>Alt+E (только Персонажи)</dt><dd>Завершить текущий бой</dd>
        <dt>Enter в форме добавления</dt><dd>Быстро создать запись, не нажимая кнопку</dd>
        <dt>Enter / Esc в модалках персонажа</dt><dd>Сохранить или закрыть окно создания/редактирования</dd>
        <dt>ПКМ по имени персонажа</dt><dd>Открыть радиальное меню состояний</dd>
        <dt>F1</dt><dd>Открыть/закрыть это окно справки</dd>
      </dl>
    `;
  }

  // Загрузим changelog.txt для вкладки "Описание версии"
  const changelogEl = document.getElementById('helpChangelog');
  if (changelogEl) {
    fetch('/changelog.txt')
      .then((r) => r.text())
      .then((text) => {
        changelogEl.textContent = text;
      })
      .catch(() => {
        changelogEl.textContent = 'Не удалось загрузить changelog.txt';
      });
  }

  // Переключение вкладок справки
  const tabs = document.querySelectorAll('.help-tab');
  const panels = document.querySelectorAll('.help-tab-panel');
  if (tabs.length && panels.length) {
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.helpTab;
        tabs.forEach((t) => t.classList.remove('active'));
        panels.forEach((p) => {
          if (p.dataset.helpPanel === target) {
            p.classList.add('active');
          } else {
            p.classList.remove('active');
          }
        });
        tab.classList.add('active');
      });
    });
  }
}

function openHelpModal() {
  const modal = document.getElementById('helpModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  AppState.help.open = true;
}

function closeHelpModal() {
  const modal = document.getElementById('helpModal');
  if (!modal) return;
  modal.classList.add('hidden');
  AppState.help.open = false;
}

// --- Бой / раунды ---

function setupCombatUI() {
  const toggle = document.getElementById('combatToggle');
  const upBtn = document.getElementById('combatUp');
  const downBtn = document.getElementById('combatDown');
  const endBtn = document.getElementById('combatEnd');
  const clearBtn = document.getElementById('combatClearEffects');

  if (!toggle || !upBtn || !downBtn || !endBtn) return;

  toggle.addEventListener('click', () => {
    if (!AppState.combat.active) {
      startCombat();
    } else {
      const panel = document.getElementById('combatPanel');
      if (panel) panel.classList.toggle('open');
    }
  });

  upBtn.onclick = () => moveCombatSelection('up');
  downBtn.onclick = () => moveCombatSelection('down');
  endBtn.onclick = endCombat;

  if (clearBtn) {
    clearBtn.onclick = clearAllEffects;
  }

  updateCombatUI();
}

function clearAllEffects() {
  const ok = confirm('Сбросить все состояния у всех персонажей?');
  if (!ok) return;

  rows.forEach(r => {
    if (r.mode === 'investigator' && Array.isArray(r.effects) && r.effects.length) {
      r.effects = [];
    }
  });

  save();
  render();
}

function updateCombatUI() {
  const panel = document.getElementById('combatPanel');
  const roundEl = document.getElementById('combatRound');
  if (!panel || !roundEl) return;

  if (AppState.combat.active) {
    panel.classList.add('open');
    roundEl.textContent = AppState.combat.round || 1;
  } else {
    panel.classList.remove('open');
    roundEl.textContent = AppState.combat.round || 0;
  }
}

function getVisibleCombatRows() {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll('tr'));
}

function setCombatSelection(id, withScroll) {
  const tbody = document.getElementById('tableBody');
  if (!tbody) {
    AppState.combat.selectedId = id;
    return;
  }

  tbody.querySelectorAll('.combat-selected').forEach(tr => {
    tr.classList.remove('combat-selected');
  });

  AppState.combat.selectedId = id;
  if (!id) return;

  const tr = tbody.querySelector(`tr[data-id="${id}"]`);
  if (!tr) return;

  tr.classList.add('combat-selected');

  if (withScroll) {
    const rect = tr.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const offset = rect.top + rect.height / 2 - viewportHeight / 2;
    window.scrollBy({ top: offset, behavior: 'smooth' });
  }
}

function startCombat() {
  const rowsDom = getVisibleCombatRows();
  if (!rowsDom.length) {
    alert('Нет строк для боя');
    return;
  }

  AppState.combat.active = true;
  AppState.combat.round = 1;
  AppState.combat.selectedId = rowsDom[0].dataset.id;

  setCombatSelection(AppState.combat.selectedId, true);
  updateCombatUI();
  save();
}

function moveCombatSelection(direction) {
  if (!AppState.combat.active) return;

  const rowsDom = getVisibleCombatRows();
  if (!rowsDom.length) return;

  let index = rowsDom.findIndex(tr => tr.dataset.id === AppState.combat.selectedId);
  if (index === -1) index = 0;

  const prevRound = AppState.combat.round;

  if (direction === 'up') {
    // В самом начале боя (раунд 1 и первая строка) вверх не двигаемся
    if (index === 0 && AppState.combat.round <= 1) {
      return;
    }

    if (index > 0) {
      index -= 1;
    } else {
      // были на первой строке
      index = rowsDom.length - 1;
      if (AppState.combat.round > 1) {
        AppState.combat.round -= 1;
      }
    }
  } else if (direction === 'down') {
    if (index < rowsDom.length - 1) {
      index += 1;
    } else {
      index = 0;
      AppState.combat.round += 1;
    }
  }

  const newTr = rowsDom[index];
  if (!newTr) return;

  AppState.combat.selectedId = newTr.dataset.id;
  const deltaRound = AppState.combat.round - prevRound;
  if (deltaRound !== 0) {
    tickRowEffects(deltaRound);
  }
  save();
  render();
  setCombatSelection(AppState.combat.selectedId, true);
  updateCombatUI();
}

function endCombat() {
  if (!AppState.combat.active) return;

  const ok = confirm('Закончить бой?');
  if (!ok) return;

  AppState.combat.active = false;
  AppState.combat.round = 0;
  AppState.combat.selectedId = null;
  setCombatSelection(null, false);
  updateCombatUI();
  save();
}

// --- Состояния персонажей ---

function renderRowEffects(row) {
  if (!row.effects || !row.effects.length) return '';
  return row.effects.map(e => {
    const def = EFFECT_DEFS.find(d => d.key === e.key) || { label: e.label || e.key };
    const cls = e.remaining <= 0 ? 'effect-badge expired' : 'effect-badge';
    const isTimed = !(e.key === 'injury' || e.key === 'madness');
    const count = e.remaining ?? 0;
    const showCount = isTimed && count > 0;
    return `
      <span class="${cls}" data-action="effect-badge" data-effect="${e.key}">
        <span class="effect-label">${def.label}</span>
        ${showCount ? `<span class="effect-count">${count}</span>` : ''}
      </span>
    `;
  }).join('');
}

function onEffectBadgeClick(rowId, effectKey) {
  const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
  if (!row || !row.effects) return;
  const eff = row.effects.find(e => e.key === effectKey);
  if (!eff) return;
  if ((eff.remaining ?? 0) > 0) return; // удаляем только, когда счётчик 0
  row.effects = row.effects.filter(e => e.key !== effectKey);
  save();
  render();
}

function onNameCellClick(e, rowId) {
  e.stopPropagation();
}

function onNameCellContextMenu(e, rowId) {
  e.preventDefault();
  e.stopPropagation();
  openStateMenu(rowId);
}

function setupStateMenuUI() {
  const overlay = document.getElementById('stateMenuOverlay');
  const input = document.getElementById('stateEffectInput');
  if (!overlay || !input) return;

  // по умолчанию поле ввода скрыто
  input.classList.add('hidden');

  // Клик по фону закрывает меню
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeStateMenu();
    }
  });

  // Кнопки эффектов
  overlay.querySelectorAll('.state-effect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
  
      if (btn.disabled) return;
  
      const instant = btn.dataset.instant === "true";
      AppState.stateMenu.selectedEffect = btn.dataset.effect;
  
      // снимаем активность со всех кнопок
      overlay.querySelectorAll('.state-effect-btn')
        .forEach(b => b.classList.remove('selected'));
  
      // подсвечиваем выбранную
      btn.classList.add('selected');
  
      if (instant) {
  
        applyInstantStateEffect(AppState.stateMenu.selectedEffect);
        closeStateMenu();
        return;
  
      }
  
      input.classList.remove('hidden');
      input.value = '';
      input.focus();
      input.select();
  
    });
  });

  // Enter / Esc для ввода длительности
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyStateEffect();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeStateMenu();
    }
  });

  // Глобальный Esc для закрытия меню
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeStateMenu();
    }
  });
}

function openStateMenu(rowId) {
  const overlay = document.getElementById('stateMenuOverlay');
  const input = document.getElementById('stateEffectInput');
  if (!overlay || !input) return;

  const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
  if (!row) return;

  AppState.stateMenu.rowId = rowId;
  AppState.stateMenu.selectedEffect = null;

  // убираем прошлые выделения кнопок
  overlay.querySelectorAll('.state-effect-btn')
    .forEach(b => b.classList.remove('selected'));

  // Дизейблим уже активные эффекты
  const activeKeys = new Set((row.effects || []).map(e => e.key));
  overlay.querySelectorAll('.state-effect-btn').forEach(btn => {
    const key = btn.dataset.effect;
    btn.disabled = activeKeys.has(key);
  });

  overlay.classList.remove('hidden');

  // небольшой трюк, чтобы анимация всегда срабатывала
  void overlay.offsetWidth;
  overlay.classList.add('visible');
  input.value = '';
  input.blur();
  input.classList.add('hidden');
}

function closeStateMenu() {
  const overlay = document.getElementById('stateMenuOverlay');
  if (!overlay) return;
  if (overlay.classList.contains('hidden')) {
    AppState.stateMenu.rowId = null;
    AppState.stateMenu.selectedEffect = null;
    return;
  }

  overlay.classList.remove('visible');

  const onTransitionEnd = (e) => {
    if (e.target !== overlay || e.propertyName !== 'opacity') return;
    overlay.removeEventListener('transitionend', onTransitionEnd);
    overlay.classList.add('hidden');
    AppState.stateMenu.rowId = null;
    AppState.stateMenu.selectedEffect = null;
  };

  overlay.addEventListener('transitionend', onTransitionEnd);
}

function applyStateEffect() {
  const overlay = document.getElementById('stateMenuOverlay');
  const input = document.getElementById('stateEffectInput');
  if (!overlay || !input) return;
  if (!AppState.stateMenu.rowId || !AppState.stateMenu.selectedEffect) return;

  const value = parseInt(input.value, 10);
  if (!Number.isFinite(value) || value <= 0) return;

  const row = rows.find(r => r.id === AppState.stateMenu.rowId && r.mode === 'investigator');
  if (!row) return;

  row.effects ??= [];
  if (row.effects.some(e => e.key === AppState.stateMenu.selectedEffect)) {
    closeStateMenu();
    return;
  }

  row.effects.push({
    key: AppState.stateMenu.selectedEffect,
    remaining: value,
  });

  save();
  render();
  closeStateMenu();
}

function applyInstantStateEffect(effectKey) {

  const row = rows.find(r => r.id === AppState.stateMenu.rowId && r.mode === 'investigator');
  if (!row) return;

  row.effects ??= [];

  if (row.effects.some(e => e.key === effectKey)) return;

  row.effects.push({
    key: effectKey,
    remaining: null
  });

  save();
  render();
}

function tickRowEffects(deltaRound) {
  if (!deltaRound) return;
  const dir = deltaRound > 0 ? -1 : 1;

  rows.forEach(r => {
    if (r.mode !== 'investigator' || !r.effects || !r.effects.length) return;
    r.effects.forEach(e => {
      const current = e.remaining ?? 0;
      const next = current + dir;
      e.remaining = Math.max(0, next);
    });
  });
}

window.addEventListener("beforeunload", function (e) {

  // При закрытии окна в exe дополнительно записываем автосейв на диск
  try {
    autosave();
  } catch (err) {
    // глушим ошибку, чтобы не мешать закрытию
  }

  const confirmationMessage = "Вы уверены, что хотите закрыть трекер?";

  e.preventDefault();
  e.returnValue = confirmationMessage;

  return confirmationMessage;

});

function exportTracker(data){

  const json = JSON.stringify(data, null, 2);

  if (window.pywebview) {

    window.pywebview.api.save_json(json);

  } else {

    const blob = new Blob([json], {type:'application/json'});

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "tracker.json";
    a.click();

  }

}

function autosave() {

  if (!window.pywebview) return;

  const data = localStorage.getItem(STORAGE_KEY);

  window.pywebview.api.autosave(data);

}

setInterval(autosave, 15000);

async function loadAutosave() {

  if (!window.pywebview) return;

  const data = await window.pywebview.api.load_autosave();

  if (!data) return;

  // Обновляем локальное хранилище, а затем подменяем состояние в памяти
  localStorage.setItem(STORAGE_KEY, data);

  // Попробуем разобрать JSON и применить его к текущему состоянию
  try {
    const parsed = JSON.parse(data);
    const snapshot = parsed && typeof parsed === 'object' && 'version' in parsed && parsed.data
      ? parsed.data
      : parsed;

    rows = snapshot.rows || [];
    mode = snapshot.mode || 'investigator';

    const combat = snapshot.combat || {};
    AppState.combat.active = !!combat.active;
    AppState.combat.round = combat.round || 0;
    AppState.combat.selectedId = combat.selectedId || null;

    // Приводим строки к актуальному формату, как в load()
    rows.forEach(r => {
      if (r.mode === 'investigator') {
        r.str ??= 0;
        r.con ??= 0;
        r.siz ??= 0;
        r.pow ??= 0;
        r.db ??= calcDB(r.str, r.siz);
        if (r.baseSpeed === undefined) r.baseSpeed = r.speed != null ? r.speed : calcSpeed(r.dex, r.str, r.siz);
        r.speedMod ??= 0;
        if (r.hp === undefined && r.baseHp === undefined) {
          const h = calcHp(r.siz, r.con);
          r.hp = h;
          r.baseHp = h;
        }
        r.mp ??= Math.floor(((r.pow || 0) / 5));
        r.brawl ??= 25;
        r.handgun ??= 20;
        r.rifle ??= 25;
        r.weapons ??= [];
        r.effects ??= [];
        if (r.dodge === undefined) {
          const base = Math.floor((r.dex || 0) / 2);
          r.dodge = base;
          r.baseDodge = base;
        }
      }

      if (r.mode === 'arsenal') {
        r.bonus ??= false;
        r.damage ??= '—';
        r.range ??= '';
      }

      if (r.mode === 'grimoire') {
        r.cost ??= '';
        r.time ??= '';
      }

      r.note ??= '';
      r.hidden ??= false;
    });

    // После применения состояния сразу сохраняем и перерисовываем
    save();
    render();
  } catch (err) {
    // Если что‑то пошло не так при разборе, просто оставляем текущее состояние
    console.error('Failed to apply autosave state', err);
  }
}

// Ждём, пока pywebview и его API будут готовы, затем подтягиваем последнее автосохранение.
// Это гарантирует, что при старте exe‑версии загрузится последний autosave.json.
if (window.pywebview) {
  // Если API уже доступен (редкий, но возможный случай) — пробуем сразу
  loadAutosave();
} else {
  window.addEventListener("pywebviewready", () => {
    loadAutosave();
  });
}