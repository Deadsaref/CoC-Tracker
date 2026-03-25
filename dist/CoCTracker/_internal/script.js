const STORAGE_KEY = 'dmTracker';
const STORAGE_VERSION = 1;

let rows = [];
let mode = 'investigator';
let saveName = localStorage.getItem('dmTrackerName') || 'Untitled';
let sortState = { key: null, asc: true };
let draggedRowId = null;

/** Игровой «сегодня» кампании (YYYY-MM-DD) и события по датам */
let campaignDateISO = null;
let calendarEvents = [];
let campaignDatePicker = null;

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
  { key: 'madness', label: 'Безумие' },
];

function todayISO() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDDMMYYYY(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, mo, da] = iso.split('-');
  return `${da}-${mo}-${y}`;
}

function normalizeCalendarEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e) => ({
      id: e.id || crypto.randomUUID(),
      date: e.date,
      text: typeof e.text === 'string' ? e.text.slice(0, 500) : '',
    }));
}

function applyNewDaySanReset() {
  rows.forEach((r) => {
    if (r.mode === 'investigator') {
      r.baseSan = r.san;
      r.sanAlert = false;
    }
  });
}

function getPickerSelectedISO(fp) {
  if (fp.selectedDates && fp.selectedDates[0]) {
    return fp.formatDate(fp.selectedDates[0], 'Y-m-d');
  }
  return campaignDateISO || todayISO();
}

function applyCampaignDateFromPicker(fp, selExplicit) {
  const sel =
    selExplicit && /^\d{4}-\d{2}-\d{2}$/.test(selExplicit) ? selExplicit : getPickerSelectedISO(fp);
  const prev = campaignDateISO;
  if (sel === prev) return;
  pushUndo('Смена дня кампании');
  if (sel > prev) {
    applyNewDaySanReset();
  }
  campaignDateISO = sel;
  save();
  render();
  if (fp && typeof fp.redraw === 'function') fp.redraw();
  refreshCampaignEventsPanel(fp);
}

function refreshCampaignEventsPanel(fp) {
  if (!fp || !fp.calendarContainer) return;
  const cal = fp.calendarContainer;
  const wrap = cal.querySelector('.coc-calendar-events');
  if (!wrap) return;
  const campEl = wrap.querySelector('.coc-cal-campaign-val');
  const browseEl = wrap.querySelector('.coc-cal-browse-val');
  if (campEl) campEl.textContent = formatDDMMYYYY(campaignDateISO);
  if (browseEl) browseEl.textContent = formatDDMMYYYY(getPickerSelectedISO(fp));

  const iso = getPickerSelectedISO(fp);
  const list = wrap.querySelector('.coc-calendar-events-list');
  if (!list) return;
  list.innerHTML = '';
  calendarEvents
    .filter((e) => e.date === iso)
    .forEach((ev) => {
      const li = document.createElement('li');
      li.className = 'coc-calendar-event-item';
      const span = document.createElement('span');
      span.className = 'coc-calendar-event-text';
      span.textContent = ev.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'coc-calendar-event-del';
      del.setAttribute('aria-label', 'Удалить событие');
      del.textContent = '×';
      del.addEventListener('click', () => {
        pushUndo('Удаление события календаря');
        calendarEvents = calendarEvents.filter((x) => x.id !== ev.id);
        save();
        fp.redraw();
        refreshCampaignEventsPanel(fp);
      });
      li.appendChild(span);
      li.appendChild(del);
      list.appendChild(li);
    });
}

function ensureCampaignEventsPanel(fp) {
  const cal = fp.calendarContainer;
  if (!cal || cal.querySelector('.coc-calendar-events')) return;
  const wrap = document.createElement('div');
  wrap.className = 'coc-calendar-events';
  wrap.innerHTML =
    '<div class="coc-calendar-meta">' +
    '<div class="coc-cal-line">Текущий день кампании: <strong class="coc-cal-campaign-val"></strong></div>' +
    '<div class="coc-cal-line">События для выбранного дня: <strong class="coc-cal-browse-val"></strong></div>' +
    '<button type="button" class="coc-cal-apply-btn stat-btn">Сделать выбранную дату текущим днём</button>' +
    '</div>' +
    '<div class="coc-calendar-events-head">Заметки на выбранный день</div>' +
    '<ul class="coc-calendar-events-list" role="list"></ul>' +
    '<div class="coc-calendar-events-add">' +
    '<input type="text" class="coc-calendar-event-input" placeholder="Текст события" maxlength="500" />' +
    '<button type="button" class="coc-calendar-event-add-btn stat-btn">Добавить</button>' +
    '</div>';
  cal.appendChild(wrap);

  const inp = wrap.querySelector('.coc-calendar-event-input');
  const btn = wrap.querySelector('.coc-calendar-event-add-btn');
  const applyBtn = wrap.querySelector('.coc-cal-apply-btn');

  const addFromInput = () => {
    const text = (inp.value || '').trim();
    if (!text) return;
    const iso = getPickerSelectedISO(fp);
    pushUndo('Событие календаря');
    calendarEvents.push({ id: crypto.randomUUID(), date: iso, text });
    inp.value = '';
    save();
    fp.redraw();
    refreshCampaignEventsPanel(fp);
  };

  btn.addEventListener('click', addFromInput);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  });
  /* capture: true — до onClose Flatpickr, иначе setDate в onClose сбрасывает выбор и дата не меняется */
  applyBtn.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = getPickerSelectedISO(fp);
      applyCampaignDateFromPicker(fp, sel);
    },
    true
  );
}

function onCampaignCalendarDayCreate(instance, dayElem) {
  const dObj = dayElem && dayElem.dateObj;
  if (!dObj || !instance) return;
  const iso = instance.formatDate(dObj, 'Y-m-d');
  if (calendarEvents.some((e) => e.date === iso)) {
    dayElem.classList.add('coc-cal-has-event');
  }
  if (campaignDateISO && iso === campaignDateISO) {
    dayElem.classList.add('coc-cal-campaign-day');
  }
}

function syncCampaignDateToPicker() {
  if (!campaignDatePicker) return;
  if (!campaignDateISO) campaignDateISO = todayISO();
  campaignDatePicker.setDate(campaignDateISO, false);
}

function setupCampaignDatePicker() {
  const el = document.getElementById('campaignDatePicker');
  if (!el || typeof flatpickr === 'undefined') return;
  if (!campaignDateISO) campaignDateISO = todayISO();

  const ruLocale =
    typeof flatpickr !== 'undefined' && flatpickr.l10ns && flatpickr.l10ns.ru
      ? flatpickr.l10ns.ru
      : undefined;

  campaignDatePicker = flatpickr(el, {
    locale: ruLocale,
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd-m-Y',
    altInputClass: 'stat-btn investigator-only campaign-date-alt',
    defaultDate: campaignDateISO,
    allowInput: false,
    clickOpens: true,
    /* Иначе клик по дню закрывает календарь, срабатывает onClose и сбрасывает выбор на день кампании — просмотр/события для других дней невозможны */
    closeOnSelect: false,
    onOpen(selectedDates, dateStr, instance) {
      ensureCampaignEventsPanel(instance);
      instance.setDate(campaignDateISO, false);
      refreshCampaignEventsPanel(instance);
    },
    onChange(selectedDates, dateStr, instance) {
      refreshCampaignEventsPanel(instance);
    },
    onClose(selectedDates, dateStr, instance) {
      if (instance && campaignDateISO) {
        instance.setDate(campaignDateISO, false);
      }
    },
    onMonthChange(selectedDates, dateStr, instance) {
      ensureCampaignEventsPanel(instance);
      refreshCampaignEventsPanel(instance);
    },
    onYearChange(selectedDates, dateStr, instance) {
      ensureCampaignEventsPanel(instance);
      refreshCampaignEventsPanel(instance);
    },
    onDayCreate(selectedDates, dateStr, instance, dayElem) {
      onCampaignCalendarDayCreate(instance, dayElem);
    },
  });
}

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

  const keeperExportBtn = document.getElementById('keeperExportBtn');
  const keeperImportBtn = document.getElementById('keeperImportBtn');
  const keeperImportFile = document.getElementById('keeperImportFile');
  const keeperClearBtn = document.getElementById('keeperClearBtn');
  if (keeperExportBtn) keeperExportBtn.addEventListener('click', exportKeeperScreenData);
  if (keeperImportBtn && keeperImportFile) {
    keeperImportBtn.addEventListener('click', () => keeperImportFile.click());
  }
  if (keeperImportFile) {
    keeperImportFile.addEventListener('change', onKeeperImportFileChange);
  }
  if (keeperClearBtn) keeperClearBtn.addEventListener('click', clearKeeperScreen);

  setupKeeperSideMenu();

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
        if (mode === 'investigator') {
          const row = rows.find(r => r.id === id && r.mode === 'investigator');
          if (row) {
            openDeleteInvestigatorModal(id);
            return;
          }
        }
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

      const hpIncompleteTd = e.target.closest('td.hp-incomplete');
      if (hpIncompleteTd) {
        if (!e.target.closest('[data-action="hp-dec"]') && !e.target.closest('[data-action="hp-inc"]')) {
          restoreHpPrompt(rowId);
          return;
        }
      }

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
      } else if (action === 'toggleDex') {
        toggleDex(rowId);
      } else if (action === 'row-eye') {
        toggleHidden(rowId);
      } else if (action === 'row-remove') {
        if (mode === 'investigator') {
          const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
          if (row) {
            openDeleteInvestigatorModal(rowId);
            return;
          }
        }
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
  setupWeaponSuggestPositioning();
  setupCampaignDatePicker();
  setupSceneMenu();
  updateUndoRedoButtons();
}

function syncModeToUI() {
  const tracker = document.querySelector('.tracker');
  if (tracker) {
    tracker.classList.toggle('investigator-mode', mode === 'investigator');
    tracker.classList.toggle('arsenal-mode', mode === 'arsenal');
    tracker.classList.toggle('grimoire-mode', mode === 'grimoire');
  }
  const modeInvestigators = document.getElementById('modeInvestigators');
  const modeArsenal = document.getElementById('modeArsenal');
  const modeGrimoireBtn = document.getElementById('modeGrimoire');
  if (modeInvestigators) modeInvestigators.classList.toggle('active', mode === 'investigator');
  if (modeArsenal) modeArsenal.classList.toggle('active', mode === 'arsenal');
  if (modeGrimoireBtn) modeGrimoireBtn.classList.toggle('active', mode === 'grimoire');
}

function setMode(m) {
  mode = m;
  if (m !== 'investigator') closeKeeperSideMenu();
  closeSceneMenu();
  syncModeToUI();
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

/** Базовая ЛВК с листа (без временного буста в трекере). */
function getBaseDex(row) {
  if (row.mode !== 'investigator') return row.dex ?? 0;
  return row.baseDex ?? row.dex ?? 0;
}

/** ЛВК для отображения/сортировки: с бустом dexBoosted = base + 50. */
function getEffectiveDex(row) {
  if (row.mode !== 'investigator') return row.dex ?? 0;
  const base = getBaseDex(row);
  return row.dexBoosted ? base + 50 : base;
}

function sortBy(key) {
  if (mode === 'arsenal' && !['name', 'damage'].includes(key)) return;
  if (mode === 'investigator' && key === 'damage') return;
  if (sortState.key === key) sortState.asc = !sortState.asc;
  else { sortState.key = key; sortState.asc = true; }
  syncNotesFromDOM();
  rows.sort((a, b) => {
    const va =
      key === 'speed' && a.mode === 'investigator'
        ? getCurrentSpeed(a)
        : key === 'dex' && a.mode === 'investigator'
          ? getEffectiveDex(a)
          : a[key];
    const vb =
      key === 'speed' && b.mode === 'investigator'
        ? getCurrentSpeed(b)
        : key === 'dex' && b.mode === 'investigator'
          ? getEffectiveDex(b)
          : b[key];
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
  syncModeToUI();
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
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

  // Подсветка активной боевой строки после перерисовки (только вкладка персонажей)
  if (mode === 'investigator' && AppState.combat.active && AppState.combat.selectedId) {
    setCombatSelection(AppState.combat.selectedId, false);
  }

  const listEl = document.getElementById('keeperScreenList');
  if (listEl) {
    listEl.innerHTML = '';

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
        summary = `${row.name} — ПЗ ${row.hp}, РАС ${row.san}, ЛВК ${getBaseDex(row)}`;
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
      listEl.appendChild(div);
    });
  }

  refreshPywebviewFindAfterRender();
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
        data-action="toggleDex">
      ${getEffectiveDex(row)}
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

    <td class="col-actions inv-action-cell investigator-only">
      <span class="inv-action-btns">
        <button type="button" class="eye-btn" data-action="row-eye" title="Скрыть в ширму">👁</button>
        <button type="button" class="remove-btn" data-action="row-remove" title="Удалить">✖</button>
      </span>
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
        <div><b>ЛВК</b>: ${getBaseDex(r)}</div>
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

    <td class="col-actions arsenal-only">
      <button type="button" class="remove-btn" data-action="row-remove" title="Удалить">✖</button>
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

    <td class="col-actions grimoire-only">
      <button type="button" class="remove-btn" data-action="row-remove" title="Удалить">✖</button>
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
  if (!r || r.mode !== 'investigator') return;
  r.dexBoosted = !r.dexBoosted;
  syncNotesFromDOM();
  rows.sort((a, b) => getEffectiveDex(b) - getEffectiveDex(a));
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
  updateSaveNameLabels();

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
      campaignDate: campaignDateISO,
      calendarEvents,
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

function updateSaveNameLabels() {
  const text = saveName || 'Untitled';
  const display = document.getElementById('saveNameDisplay');
  const preview = document.getElementById('sceneMenuSavePreview');
  if (display) display.textContent = text;
  if (preview) preview.textContent = text;
}

function initSaveNameUI() {
  const display = document.getElementById('saveNameDisplay');
  const input = document.getElementById('saveNameInput');
  if (!display || !input) return;

  updateSaveNameLabels();

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
      updateSaveNameLabels();
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

function getGameDateDDMMYYYYForExport() {
  const iso =
    campaignDateISO && /^\d{4}-\d{2}-\d{2}$/.test(campaignDateISO) ? campaignDateISO : todayISO();
  return formatDDMMYYYY(iso);
}

function getExportFileName() {
  const base = (saveName || 'Untitled').trim() || 'Untitled';
  // Разрешаем буквы/цифры, пробелы, дефис и подчёркивание (включая кириллицу)
  const sanitized = base
    .replace(/[^0-9A-Za-z\u0400-\u04FF _-]/g, '')
    .replace(/\s+/g, '_');
  const name = sanitized || 'Untitled';
  const datePart = getGameDateDDMMYYYYForExport();
  return `${name}_${datePart}.json`;
}

function getKeeperExportFileName() {
  const base = (saveName || 'Untitled').trim() || 'Untitled';
  const sanitized = base
    .replace(/[^0-9A-Za-z\u0400-\u04FF _-]/g, '')
    .replace(/\s+/g, '_');
  const name = sanitized || 'Untitled';
  return `ширма_${name}.json`;
}

function exportKeeperScreenData() {
  const keeperRows = rows.filter(r => r.mode === 'investigator' && r.hidden);
  if (!keeperRows.length) {
    alert('В ширме нет скрытых персонажей');
    return;
  }

  const payload = {
    version: STORAGE_VERSION,
    kind: 'keeper-investigators',
    exportedAt: Date.now(),
    rows: keeperRows.map(r => JSON.parse(JSON.stringify(r))),
  };
  const json = JSON.stringify(payload);

  if (window.pywebview) {
    window.pywebview.api.save_json(json, getKeeperExportFileName());
  } else {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = getKeeperExportFileName();
    a.click();
  }
}

function extractKeeperImportRows(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  let arr;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (Array.isArray(parsed.rows)) {
    arr = parsed.rows;
  } else {
    return [];
  }
  return arr.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item.mode === 'investigator' || item.mode == null)
  );
}

function normalizeImportedKeeperInvestigator(raw) {
  const r = JSON.parse(JSON.stringify(raw));
  r.id = crypto.randomUUID();
  r.mode = 'investigator';
  r.hidden = true;
  r.name = (r.name != null && String(r.name).trim()) ? String(r.name).trim() : 'Без имени';

  r.armor ??= 0;
  r.str ??= 0;
  r.con ??= 0;
  r.siz ??= 0;
  r.pow ??= 0;
  r.san ??= 0;
  r.baseSan ??= r.san;
  r.baseDex ??= r.dex;
  r.dex = r.baseDex;
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
  r.dexBoosted ??= false;
  r.sanAlert ??= false;
  r.note ??= '';

  r.weapons = (r.weapons || []).filter((wid) =>
    rows.some((x) => x.id === wid && x.mode === 'arsenal')
  );

  return r;
}

function importKeeperScreenFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert('Файл не является корректным JSON');
    return;
  }

  const incoming = extractKeeperImportRows(parsed);
  if (!incoming.length) {
    alert('В файле нет записей персонажей для ширмы.');
    return;
  }

  pushUndo('Импорт ширмы');
  for (const raw of incoming) {
    rows.push(normalizeImportedKeeperInvestigator(raw));
  }
  commit({ scope: 'all' });
  showToast(`Добавлено в ширму: ${incoming.length}`);
}

function onKeeperImportFileChange(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    importKeeperScreenFromText(reader.result);
  };
  reader.readAsText(file);
}

function closeKeeperSideMenu() {
  const menu = document.getElementById('keeperSideMenu');
  const toggle = document.getElementById('keeperMenuToggle');
  if (!menu || !toggle) return;
  menu.classList.remove('keeper-side-menu--open');
  toggle.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-hidden', 'true');
}

function openKeeperSideMenu() {
  const menu = document.getElementById('keeperSideMenu');
  const toggle = document.getElementById('keeperMenuToggle');
  if (!menu || !toggle) return;
  menu.classList.add('keeper-side-menu--open');
  toggle.setAttribute('aria-expanded', 'true');
  menu.setAttribute('aria-hidden', 'false');
}

function setupKeeperSideMenu() {
  const toggle = document.getElementById('keeperMenuToggle');
  const menu = document.getElementById('keeperSideMenu');
  const closeBtn = document.getElementById('keeperMenuClose');
  if (!toggle || !menu || !closeBtn) return;

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    if (!menu.classList.contains('keeper-side-menu--open')) openKeeperSideMenu();
  });

  closeBtn.addEventListener('click', () => closeKeeperSideMenu());
}

function closeSceneMenu() {
  const panel = document.getElementById('scenePanel');
  const toggle = document.getElementById('sceneMenuToggle');
  if (!panel || !toggle) return;
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function openSceneMenu() {
  const panel = document.getElementById('scenePanel');
  const toggle = document.getElementById('sceneMenuToggle');
  if (!panel || !toggle) return;
  panel.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  if (campaignDatePicker && typeof campaignDatePicker.redraw === 'function') {
    requestAnimationFrame(() => campaignDatePicker.redraw());
  }
}

function setupSceneMenu() {
  const toggle = document.getElementById('sceneMenuToggle');
  const panel = document.getElementById('scenePanel');
  const wrap = document.querySelector('.scene-menu-wrap');
  if (!toggle || !panel || !wrap) return;

  const isOpen = () => !panel.hidden;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) closeSceneMenu();
    else openSceneMenu();
  });

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (wrap.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.flatpickr-calendar')) return;
    closeSceneMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isOpen()) return;
    closeSceneMenu();
  });
}

function clearKeeperScreen() {
  const hiddenInv = rows.filter((r) => r.mode === 'investigator' && r.hidden);
  if (!hiddenInv.length) {
    alert('В ширме нет персонажей');
    return;
  }
  if (!confirm(`Удалить всех персонажей из ширмы (${hiddenInv.length})?`)) return;

  pushUndo('Очистка ширмы');
  const removeIds = new Set(hiddenInv.map((r) => r.id));
  rows = rows.filter((r) => !removeIds.has(r.id));

  if (AppState.combat.selectedId && !rows.some((r) => r.id === AppState.combat.selectedId)) {
    AppState.combat.selectedId = null;
  }

  commit({ scope: 'all' });
}

function load() {
  const d = localStorage.getItem(STORAGE_KEY);
  if (!d) {
    campaignDateISO = todayISO();
    calendarEvents = [];
    syncModeToUI();
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(d);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    campaignDateISO = todayISO();
    calendarEvents = [];
    syncModeToUI();
    return;
  }

  // v0 (старый формат): {rows, mode, combat}
  // v1+: {version, savedAt, data:{rows, mode, combat}}
  const data = parsed && typeof parsed === 'object' && 'version' in parsed && parsed.data
    ? parsed.data
    : parsed;

  rows = data.rows || [];
  mode = data.mode || 'investigator';

  if (data.campaignDate && /^\d{4}-\d{2}-\d{2}$/.test(data.campaignDate)) {
    campaignDateISO = data.campaignDate;
  } else {
    campaignDateISO = todayISO();
  }
  calendarEvents = normalizeCalendarEvents(data.calendarEvents);

  // Восстанавливаем состояние боя, если есть
  const combat = data.combat || {};
  AppState.combat.active = !!combat.active;
  AppState.combat.round = combat.round || 0;
  AppState.combat.selectedId = combat.selectedId || null;

  /* Что пишем в строку */
  rows.forEach((r) => {
      
      if (r.mode === 'investigator') {
        r.str ??= 0;
        r.con ??= 0;
        r.siz ??= 0;
        r.pow ??= 0;
        r.baseDex ??= r.dex;
        r.dex = r.baseDex;
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

  syncModeToUI();
  syncCampaignDateToPicker();
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
  undoStack.push({
    state: JSON.stringify({ rows, mode, campaignDateISO, calendarEvents }),
    description: desc,
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoRedoButtons();
}

function canUndo() {
  return undoStack.length > 0;
}

function canRedo() {
  return redoStack.length > 0;
}

function undo() {
  if (undoStack.length === 0) return;
  const item = undoStack.pop();
  const prev = JSON.parse(item.state);
  redoStack.push({
    state: JSON.stringify({ rows, mode, campaignDateISO, calendarEvents }),
    description: item.description,
  });
  rows = prev.rows;
  mode = prev.mode;
  if (prev.campaignDateISO != null && /^\d{4}-\d{2}-\d{2}$/.test(prev.campaignDateISO)) {
    campaignDateISO = prev.campaignDateISO;
  }
  if (Array.isArray(prev.calendarEvents)) {
    calendarEvents = normalizeCalendarEvents(prev.calendarEvents);
  }
  syncModeToUI();
  syncCampaignDateToPicker();
  save();
  render();
  updateUndoRedoButtons();
  showToast('Отменено: ' + item.description);
}

function redo() {
  if (redoStack.length === 0) return;
  const item = redoStack.pop();
  const next = JSON.parse(item.state);
  undoStack.push({
    state: JSON.stringify({ rows, mode, campaignDateISO, calendarEvents }),
    description: item.description,
  });
  rows = next.rows;
  mode = next.mode;
  if (next.campaignDateISO != null && /^\d{4}-\d{2}-\d{2}$/.test(next.campaignDateISO)) {
    campaignDateISO = next.campaignDateISO;
  }
  if (Array.isArray(next.calendarEvents)) {
    calendarEvents = normalizeCalendarEvents(next.calendarEvents);
  }
  syncModeToUI();
  syncCampaignDateToPicker();
  save();
  render();
  updateUndoRedoButtons();
  showToast('Повторено: ' + item.description);
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) {
    undoBtn.disabled = undoStack.length === 0;
    undoBtn.title = undoStack.length === 0 ? 'Нет шагов для отката' : 'Откатить шаг';
  }
  if (redoBtn) {
    redoBtn.disabled = redoStack.length === 0;
    redoBtn.title = redoStack.length === 0 ? 'Нет шагов для повтора' : 'Повторить шаг';
  }
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
  const deleteInvestigatorModal = document.getElementById('deleteInvestigatorModal');
  const modalOpen =
    (createModal && !createModal.classList.contains('hidden')) ||
    (editModal && !editModal.classList.contains('hidden')) ||
    (deleteInvestigatorModal && !deleteInvestigatorModal.classList.contains('hidden'));
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
    if (canUndo()) undo();
    return;
  }
  if ((ctrl && shift && e.key.toLowerCase() === 'z') || (ctrl && e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    if (canRedo()) redo();
    return;
  }

  // Бой (только вкладка «Персонажи»)
  if (mode === 'investigator') {
    // Alt+ArrowUp / Alt+ArrowDown — перемещение выделения
    if (e.altKey && !ctrl && !shift && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveCombatSelection(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }

    // Alt+B — старт/панель боя (как клик по кнопке)
    if (e.altKey && !ctrl && !shift && (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И')) {
      e.preventDefault();
      const toggle = document.getElementById('combatToggle');
      if (toggle) toggle.click();
      return;
    }

    // Alt+E — завершение боя
    if (e.altKey && !ctrl && !shift && (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У')) {
      e.preventDefault();
      const endBtn = document.getElementById('combatEnd');
      if (endBtn) endBtn.click();
      return;
    }
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

    const spellCls = w.mode === 'grimoire' ? 'spell-tag' : '';
    return `
      <span class="weapon-tag ${spellCls}"
            onmouseenter="showWeaponTagTooltip(event,'${row.id}','${id}')"
            onmouseleave="hideTooltip()">
        <span class="weapon-tag-label">${w.name}</span>
        <button type="button" data-action="weapon-remove" data-weapon-id="${id}">✖</button>
      </span>
    `;
  }).join('');
}



function clearWeaponSuggestPosition(box) {
  if (!box) return;
  box.style.left = '';
  box.style.top = '';
  box.style.bottom = '';
  box.style.width = '';
  box.style.maxHeight = '';
}

function positionWeaponSuggestBox(box, input) {
  if (!box?.childElementCount || !input) return;
  const rect = input.getBoundingClientRect();
  const margin = 6;
  const maxList = 280;
  const below = window.innerHeight - rect.bottom - margin;
  const above = rect.top - margin;

  let maxH;
  if (below >= 120 || below >= above) {
    maxH = Math.min(maxList, below);
    box.style.top = `${rect.bottom}px`;
    box.style.bottom = 'auto';
  } else {
    maxH = Math.min(maxList, above);
    box.style.bottom = `${window.innerHeight - rect.top + margin}px`;
    box.style.top = 'auto';
  }
  box.style.maxHeight = `${Math.max(72, maxH)}px`;

  let left = rect.left;
  const w = rect.width;
  const vw = window.innerWidth;
  if (left + w > vw - margin) {
    left = Math.max(margin, vw - w - margin);
  }
  if (left < margin) left = margin;
  box.style.left = `${left}px`;
  box.style.width = `${w}px`;
}

function repositionAllWeaponSuggestPopups() {
  document.querySelectorAll('.weapon-suggestions').forEach((box) => {
    if (!box.childElementCount) return;
    const cell = box.closest('.weapons-cell');
    const inp = cell?.querySelector('.weapon-input');
    if (inp) positionWeaponSuggestBox(box, inp);
  });
}

function setupWeaponSuggestPositioning() {
  const handler = () => repositionAllWeaponSuggestPopups();
  window.addEventListener('resize', handler);
  window.addEventListener('scroll', handler, true);
  const tw = document.querySelector('.table-wrap');
  if (tw) tw.addEventListener('scroll', handler);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handler);
    window.visualViewport.addEventListener('scroll', handler);
  }
}

function showWeaponSuggestions(invId, input) {
  const inv = rows.find(r => r.id === invId);
  const box = document.getElementById(`weapon-suggest-${invId}`);
  if (!box) return;
  box.innerHTML = '';
  clearWeaponSuggestPosition(box);

  const query = (input?.value || '').trim().toLowerCase();
  if (!input || !inv) return;
  const anchorInput =
    box.closest('.weapons-cell')?.querySelector('.weapon-input') || input;
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
      const boxAfter = document.getElementById(`weapon-suggest-${invId}`);
      const live = boxAfter?.closest('.weapons-cell')?.querySelector('.weapon-input');
      if (live) live.value = '';
      showWeaponSuggestions(invId, live || input);
      (live || input)?.focus();
    };

    box.appendChild(div);
  });

  if (box.childElementCount) {
    requestAnimationFrame(() => positionWeaponSuggestBox(box, anchorInput));
  }
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

      if (list) {
        list.innerHTML = '';
        clearWeaponSuggestPosition(list);
      }

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
  showInvTooltip(e, `Базовый РАС: ${base}`, false);
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
  const deleteModal = document.getElementById('deleteInvestigatorModal');
  if (deleteModal && !deleteModal.classList.contains('hidden')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmDeleteInvestigator();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDeleteInvestigatorModal();
    }
    return;
  }

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

function focusInvestigatorModalNameField(inputId) {
  requestAnimationFrame(() => {
    const el = document.getElementById(inputId);
    if (el) {
      el.focus();
      el.select();
    }
  });
}

function openInvestigatorModal() {
  clearInvestigatorModal();
  const modal = document.getElementById('investigatorModal');
  modal.classList.remove('hidden');
  focusInvestigatorModalNameField('modal-name');
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

let pendingDeleteInvestigatorId = null;

function openDeleteInvestigatorModal(rowId) {
  const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
  if (!row) return;
  pendingDeleteInvestigatorId = rowId;
  const msg = document.getElementById('deleteInvestigatorMessage');
  if (msg) {
    msg.textContent = `Удалить персонажа (${row.name})?`;
  }
  document.getElementById('deleteInvestigatorModal').classList.remove('hidden');
  requestAnimationFrame(() => {
    const yesBtn = document.getElementById('deleteInvestigatorConfirmBtn');
    if (yesBtn) yesBtn.focus();
  });
}

function closeDeleteInvestigatorModal() {
  pendingDeleteInvestigatorId = null;
  document.getElementById('deleteInvestigatorModal').classList.add('hidden');
}

function confirmDeleteInvestigator() {
  const id = pendingDeleteInvestigatorId;
  closeDeleteInvestigatorModal();
  if (id) removeRow(id);
}

function openEditInvestigatorModal(rowId) {
  const row = rows.find(r => r.id === rowId && r.mode === 'investigator');
  if (!row) return;
  editingInvestigatorId = rowId;
  fillEditInvestigatorForm(row);
  document.getElementById('editInvestigatorModal').classList.remove('hidden');
  focusInvestigatorModalNameField('edit-modal-name');
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
  set('edit-modal-dex', getBaseDex(row));
  set('edit-modal-speed', getBaseSpeed(row));
  set('edit-modal-pow', row.pow ?? 0);
  set('edit-modal-mp', row.mp ?? Math.floor(((row.pow || 0) / 5)));
  set('edit-modal-san', row.san ?? 0);
  set('edit-modal-brawl', row.brawl ?? 25);
  set('edit-modal-handgun', row.handgun ?? 20);
  set('edit-modal-rifle', row.rifle ?? 25);
  set('edit-modal-dodge', row.dodge ?? row.baseDodge ?? Math.floor(getBaseDex(row) / 2));
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
  set('modal-dex', getBaseDex(sourceRow));
  set('modal-pow', sourceRow.pow ?? 0);
  set('modal-mp', sourceRow.mp ?? Math.floor(((sourceRow.pow || 0) / 5)));
  set('modal-san', sourceRow.san ?? 0);
  set('modal-brawl', sourceRow.brawl ?? 25);
  set('modal-handgun', sourceRow.handgun ?? 20);
  set('modal-rifle', sourceRow.rifle ?? 25);

  const dodgeValue =
    sourceRow.dodge ??
    sourceRow.baseDodge ??
    Math.floor(getBaseDex(sourceRow) / 2);
  set('modal-dodge', dodgeValue);

  set('modal-note', sourceRow.note ?? '');

  // Копируем список оружий/заклинаний
  clonedWeapons = Array.isArray(sourceRow.weapons) ? [...sourceRow.weapons] : [];

  const modal = document.getElementById('investigatorModal');
  modal.classList.remove('hidden');
  focusInvestigatorModalNameField('modal-name');
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
        <dt>Enter / Esc в подтверждении удаления персонажа</dt><dd>Удалить или отменить</dd>
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

  if (window.pywebview) {
    appendPywebviewFindHelpHotkey();
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
  if (mode !== 'investigator') return;

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
  if (mode !== 'investigator' || !AppState.combat.active) return;

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

    if (snapshot.campaignDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.campaignDate)) {
      campaignDateISO = snapshot.campaignDate;
    } else {
      campaignDateISO = todayISO();
    }
    calendarEvents = normalizeCalendarEvents(snapshot.calendarEvents);

    // Приводим строки к актуальному формату, как в load()
    rows.forEach(r => {
      if (r.mode === 'investigator') {
        r.str ??= 0;
        r.con ??= 0;
        r.siz ??= 0;
        r.pow ??= 0;
        r.baseDex ??= r.dex;
        r.dex = r.baseDex;
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

    syncModeToUI();
    syncCampaignDateToPicker();
    // После применения состояния сразу сохраняем и перерисовываем
    save();
    render();
  } catch (err) {
    // Если что‑то пошло не так при разборе, просто оставляем текущее состояние
    console.error('Failed to apply autosave state', err);
  }
}

// --- Поиск по странице (Ctrl+F) только в окне pywebview; в браузере шорткат не перехватывается ---
let pywebviewFindInitialized = false;

const pywebviewFindState = {
  open: false,
  query: '',
  ranges: [],
  markElements: null,
  currentIndex: -1,
};

function pywebviewFindUseCssHighlight() {
  return typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
}

function getPywebviewFindRoots() {
  const roots = [];
  const tbody = document.getElementById('tableBody');
  if (tbody) roots.push(tbody);
  if (mode === 'investigator') {
    const keeperList = document.getElementById('keeperScreenList');
    if (keeperList) roots.push(keeperList);
  }
  return roots;
}

function isVisibleForPywebviewFind(el) {
  let n = el;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (n.hasAttribute && n.hasAttribute('hidden')) return false;
    n = n.parentElement;
  }
  return true;
}

function collectPywebviewFindRanges(queryLower) {
  const ranges = [];
  if (!queryLower.length) return ranges;
  const roots = getPywebviewFindRoots();
  for (const root of roots) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest('script, style')) return NodeFilter.FILTER_REJECT;
          if (!isVisibleForPywebviewFind(p)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      let start = 0;
      let idx;
      while ((idx = lower.indexOf(queryLower, start)) !== -1) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + queryLower.length);
        ranges.push(r);
        start = idx + queryLower.length;
      }
    }
  }
  return ranges;
}

function clearPywebviewFindHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    try {
      CSS.highlights.delete('coc-pyw-find');
      CSS.highlights.delete('coc-pyw-find-active');
    } catch (_) {
      /* ignore */
    }
  }
  document.querySelectorAll('mark.coc-pyw-find-mark').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  document.getElementById('tableBody')?.normalize();
  document.getElementById('keeperScreenList')?.normalize();
}

function applyPywebviewFindMarks(ranges) {
  const sorted = [...ranges].sort((a, b) => b.compareBoundaryPoints(Range.START_TO_START, a));
  for (const r of sorted) {
    try {
      const mark = document.createElement('mark');
      mark.className = 'coc-pyw-find-mark';
      r.surroundContents(mark);
    } catch (_) {
      /* граница не в одном текстовом узле — пропускаем */
    }
  }
}

function pywebviewFindMatchTotal() {
  if (pywebviewFindState.ranges.length) return pywebviewFindState.ranges.length;
  return pywebviewFindState.markElements ? pywebviewFindState.markElements.length : 0;
}

/** Подсветка: остальные совпадения слабее, текущее (после Enter) — ярче; цикл по индексу задаётся снаружи. */
function syncPywebviewFindHighlights() {
  const idx = pywebviewFindState.currentIndex;
  const marks = pywebviewFindState.markElements;
  if (marks && marks.length) {
    marks.forEach((m, i) => {
      if (idx >= 0 && i === idx) {
        m.classList.add('coc-pyw-find-mark-active');
      } else {
        m.classList.remove('coc-pyw-find-mark-active');
      }
    });
    return;
  }

  const ranges = pywebviewFindState.ranges;
  if (!ranges.length || !pywebviewFindUseCssHighlight()) return;

  try {
    CSS.highlights.delete('coc-pyw-find');
    CSS.highlights.delete('coc-pyw-find-active');
  } catch (_) {
    /* ignore */
  }

  const n = ranges.length;
  if (idx < 0) {
    try {
      CSS.highlights.set('coc-pyw-find', new Highlight(...ranges));
    } catch (_) {
      /* ignore */
    }
    return;
  }

  const safeIdx = ((idx % n) + n) % n;
  const inactive = ranges.filter((_, i) => i !== safeIdx);
  try {
    if (inactive.length) {
      CSS.highlights.set('coc-pyw-find', new Highlight(...inactive));
    }
    if (ranges[safeIdx]) {
      CSS.highlights.set('coc-pyw-find-active', new Highlight(ranges[safeIdx]));
    }
  } catch (_) {
    /* ignore */
  }
}

function updatePywebviewFindCounter() {
  const el = document.getElementById('pywebviewFindCounter');
  if (!el) return;
  const q = pywebviewFindState.query.trim();
  if (!q) {
    el.textContent = '';
    return;
  }
  const n = pywebviewFindMatchTotal();
  if (n === 0) {
    el.textContent = 'Нет совпадений';
    return;
  }
  const i = pywebviewFindState.currentIndex;
  el.textContent = i < 0 ? `— / ${n}` : `${i + 1} / ${n}`;
}

function scrollPywebviewFindToIndex(i) {
  const n = pywebviewFindMatchTotal();
  if (n <= 0) return;
  const safeIdx = ((i % n) + n) % n;
  const r = pywebviewFindState.ranges[safeIdx];
  if (r) {
    const el =
      r.startContainer.nodeType === Node.TEXT_NODE
        ? r.startContainer.parentElement
        : r.startContainer;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
    return;
  }
  const m = pywebviewFindState.markElements && pywebviewFindState.markElements[safeIdx];
  if (m) m.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
}

function pywebviewFindNext() {
  const n = pywebviewFindMatchTotal();
  if (!n) return;
  const prev = pywebviewFindState.currentIndex;
  pywebviewFindState.currentIndex = prev < 0 ? 0 : (prev + 1) % n;
  scrollPywebviewFindToIndex(pywebviewFindState.currentIndex);
  syncPywebviewFindHighlights();
  updatePywebviewFindCounter();
}

function runPywebviewFind() {
  const input = document.getElementById('pywebviewFindInput');
  const q = input ? input.value.trim() : '';
  pywebviewFindState.query = q;
  clearPywebviewFindHighlights();
  pywebviewFindState.ranges = [];
  pywebviewFindState.markElements = null;
  pywebviewFindState.currentIndex = -1;
  if (!q) {
    updatePywebviewFindCounter();
    return;
  }
  const ranges = collectPywebviewFindRanges(q.toLowerCase());
  pywebviewFindState.ranges = ranges;
  if (!ranges.length) {
    updatePywebviewFindCounter();
    return;
  }
  if (pywebviewFindUseCssHighlight()) {
    try {
      syncPywebviewFindHighlights();
    } catch (_) {
      applyPywebviewFindMarks(ranges);
      pywebviewFindState.markElements = Array.from(document.querySelectorAll('mark.coc-pyw-find-mark'));
      pywebviewFindState.ranges = [];
      syncPywebviewFindHighlights();
    }
  } else {
    applyPywebviewFindMarks(ranges);
    pywebviewFindState.markElements = Array.from(document.querySelectorAll('mark.coc-pyw-find-mark'));
    pywebviewFindState.ranges = [];
    syncPywebviewFindHighlights();
  }
  updatePywebviewFindCounter();
}

function closePywebviewFind() {
  const bar = document.getElementById('pywebviewFindBar');
  const input = document.getElementById('pywebviewFindInput');
  if (bar) bar.hidden = true;
  if (input) input.value = '';
  pywebviewFindState.open = false;
  pywebviewFindState.query = '';
  pywebviewFindState.ranges = [];
  pywebviewFindState.markElements = null;
  pywebviewFindState.currentIndex = -1;
  clearPywebviewFindHighlights();
  const c = document.getElementById('pywebviewFindCounter');
  if (c) c.textContent = '';
}

function openPywebviewFind() {
  const bar = document.getElementById('pywebviewFindBar');
  const input = document.getElementById('pywebviewFindInput');
  if (!bar || !input) return;
  pywebviewFindState.open = true;
  bar.hidden = false;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
    runPywebviewFind();
  });
}

function refreshPywebviewFindAfterRender() {
  if (!window.pywebview || !pywebviewFindState.open) return;
  const input = document.getElementById('pywebviewFindInput');
  if (!input || !input.value.trim()) return;
  runPywebviewFind();
}

function appendPywebviewFindHelpHotkey() {
  const hotkeysEl = document.getElementById('helpHotkeys');
  if (!hotkeysEl || hotkeysEl.dataset.pywebviewFindHelp === '1') return;
  hotkeysEl.dataset.pywebviewFindHelp = '1';
  const dl = hotkeysEl.querySelector('dl');
  if (dl) {
    dl.insertAdjacentHTML(
      'beforeend',
      '<dt>Ctrl+F</dt><dd>Поиск по текущей вкладке (окно приложения)</dd>'
    );
  }
}

function tryInitPywebviewFind() {
  if (!window.pywebview || pywebviewFindInitialized) return;
  const input = document.getElementById('pywebviewFindInput');
  if (!input) return;
  pywebviewFindInitialized = true;

  document.addEventListener(
    'keydown',
    (e) => {
      if (!window.pywebview) return;
      if ((e.key === 'F' || e.key === 'А' || e.key === 'а' || e.key === 'f') && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openPywebviewFind();
        return;
      }
      if (e.key === 'Escape' && pywebviewFindState.open) {
        e.preventDefault();
        closePywebviewFind();
      }
    },
    true
  );

  input.addEventListener('input', () => {
    runPywebviewFind();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pywebviewFindNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePywebviewFind();
    }
  });

  appendPywebviewFindHelpHotkey();
}

tryInitPywebviewFind();
window.addEventListener('pywebviewready', tryInitPywebviewFind);

load();
setupUI();
render();

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