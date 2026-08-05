(() => {
  'use strict';

  const STORE_KEY = 'tasks.v2';
  const OLD_KEY = 'tasks.v1';
  const THEME_KEY = 'tasks.theme';
  const PROFILE_KEY = 'tasks.profile';

  // ---------- State ----------
  let tasks = load();
  let profile = loadProfile();
  let view = 'today';                 // today | tomorrow | week | month | custom
  let customDate = '';                // selected date for the Custom filter
  let dueSel = todayStr();            // selected due date for new tasks
  let undoBuffer = null;
  let toastTimer = null;

  // ---------- Elements ----------
  const $groups = document.getElementById('groups');
  const $empty = document.getElementById('empty');
  const $emptyTitle = document.getElementById('empty-title');
  const $emptySub = document.getElementById('empty-sub');
  const $form = document.getElementById('composer');
  const $input = document.getElementById('input');
  const $addBtn = document.getElementById('add-btn');
  const $segment = document.getElementById('segment');
  const $fill = document.getElementById('progress-fill');
  const $ptext = document.getElementById('progress-text');
  const $heroSub = document.getElementById('hero-sub');
  const $heroTitle = document.getElementById('hero-title');
  const $toast = document.getElementById('toast');
  const $themeToggle = document.getElementById('theme-toggle');
  const $due = document.getElementById('due');
  const $dateChip = document.getElementById('date-chip');
  const $dateChipLabel = document.getElementById('date-chip-label');
  // profile
  const $profileBtn = document.getElementById('profile-btn');
  const $avatar = document.getElementById('avatar');
  const $greeting = document.getElementById('greeting');
  const $nameLabel = document.getElementById('name-label');
  const $overlay = document.getElementById('overlay');
  const $sheet = document.getElementById('sheet');
  const $avatarPicker = document.getElementById('avatar-picker');
  const $nameInput = document.getElementById('name-input');
  const $profileSave = document.getElementById('profile-save');
  const $statTotal = document.getElementById('stat-total');
  const $statDone = document.getElementById('stat-done');
  const $statPct = document.getElementById('stat-pct');

  // ---------- Date helpers (all local time) ----------
  function ymd(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayStr() { return ymd(new Date()); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }

  function weekBounds() {
    const t = new Date();
    const dow = (t.getDay() + 6) % 7;           // Monday = 0
    const start = new Date(t); start.setDate(t.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start: ymd(start), end: ymd(end) };
  }

  function inView(due, v) {
    const today = todayStr();
    if (v === 'today') return due === today;
    if (v === 'tomorrow') return due === addDays(today, 1);
    if (v === 'week') { const { start, end } = weekBounds(); return due >= start && due <= end; }
    if (v === 'month') return due.slice(0, 7) === today.slice(0, 7);
    if (v === 'custom') return due === customDate;
    return true;
  }

  // Friendly long label for group headers / cards
  function dateLabel(due) {
    const today = todayStr();
    if (due === today) return 'Today';
    if (due === addDays(today, 1)) return 'Tomorrow';
    if (due === addDays(today, -1)) return 'Yesterday';
    const d = parseYmd(due);
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (due.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }
  // Short label for the composer chip
  function shortLabel(due) {
    const today = todayStr();
    if (due === today) return 'Today';
    if (due === addDays(today, 1)) return 'Tomorrow';
    const d = parseYmd(due);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- Persistence ----------
  function load() {
    try {
      let raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
      // migrate v1 (no due dates) → assign today
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const migrated = JSON.parse(old).map(t => ({ ...t, due: t.due || todayStr() }));
        localStorage.setItem(STORE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return [];
    } catch { return []; }
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch {} cloudSave(); }
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: '', avatar: 'eclipse' }; }
    catch { return { name: '', avatar: 'eclipse' }; }
  }
  function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} cloudSave(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Theme ----------
  function setThemeColor(theme) {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    setThemeColor(theme);
  }
  $themeToggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    setThemeColor(next);
  });

  // ---------- Profile UI ----------
  function greetingText() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }
  // Creative black & white avatars (geometric SVG, no emoji)
  const AVATARS = [
    { id: 'eclipse', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0a0a0a"/><circle cx="50" cy="50" r="30" fill="#fff"/><circle cx="64" cy="42" r="26" fill="#0a0a0a"/></svg>' },
    { id: 'rings', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><g fill="none" stroke="#0a0a0a" stroke-width="7"><circle cx="50" cy="50" r="13"/><circle cx="50" cy="50" r="27"/><circle cx="50" cy="50" r="41"/></g></svg>' },
    { id: 'split', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><polygon points="0,0 100,0 100,100" fill="#0a0a0a"/></svg>' },
    { id: 'checker', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><rect width="50" height="50" fill="#0a0a0a"/><rect x="50" y="50" width="50" height="50" fill="#0a0a0a"/></svg>' },
    { id: 'stripes', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0a0a0a"/><g stroke="#fff" stroke-width="13"><line x1="-10" y1="40" x2="40" y2="-10"/><line x1="10" y1="90" x2="90" y2="10"/><line x1="60" y1="110" x2="110" y2="60"/></g></svg>' },
    { id: 'burst', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><g stroke="#0a0a0a" stroke-width="9" stroke-linecap="round"><line x1="50" y1="16" x2="50" y2="84"/><line x1="16" y1="50" x2="84" y2="50"/><line x1="27" y1="27" x2="73" y2="73"/><line x1="73" y1="27" x2="27" y2="73"/></g></svg>' },
    { id: 'dot', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="25" fill="#0a0a0a"/></svg>' },
    { id: 'grid', svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0a0a0a"/><g fill="#fff"><circle cx="30" cy="30" r="6.5"/><circle cx="50" cy="30" r="6.5"/><circle cx="70" cy="30" r="6.5"/><circle cx="30" cy="50" r="6.5"/><circle cx="50" cy="50" r="6.5"/><circle cx="70" cy="50" r="6.5"/><circle cx="30" cy="70" r="6.5"/><circle cx="50" cy="70" r="6.5"/><circle cx="70" cy="70" r="6.5"/></g></svg>' },
  ];
  const DEFAULT_AVATAR = 'eclipse';
  function avatarMarkup(id) { return (AVATARS.find(a => a.id === id) || AVATARS[0]).svg; }
  function buildAvatarPicker() {
    $avatarPicker.innerHTML = '';
    AVATARS.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ava-opt'; b.dataset.avatar = a.id; b.innerHTML = a.svg;
      $avatarPicker.appendChild(b);
    });
  }

  function renderProfile() {
    $avatar.innerHTML = avatarMarkup(profile.avatar);
    $greeting.textContent = greetingText();
    $nameLabel.textContent = profile.name || 'Set up profile';
  }
  function openSheet() {
    // hydrate controls
    $nameInput.value = profile.name || '';
    [...$avatarPicker.children].forEach(b =>
      b.classList.toggle('is-active', b.dataset.avatar === (profile.avatar || DEFAULT_AVATAR)));
    const total = tasks.length;
    const done = tasks.filter(t => t.done).length;
    $statTotal.textContent = total;
    $statDone.textContent = done;
    $statPct.textContent = (total ? Math.round(done / total * 100) : 0) + '%';
    updateSyncAgo();

    $overlay.hidden = false;
    $sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $overlay.classList.add('show'); $sheet.classList.add('show'); });
  }
  function closeSheet() {
    $overlay.classList.remove('show');
    $sheet.classList.remove('show');
    $sheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { $overlay.hidden = true; }, 280);
  }
  $profileBtn.addEventListener('click', openSheet);
  $overlay.addEventListener('click', closeSheet);
  $avatarPicker.addEventListener('click', e => {
    const b = e.target.closest('.ava-opt'); if (!b) return;
    [...$avatarPicker.children].forEach(x => x.classList.toggle('is-active', x === b));
  });
  $profileSave.addEventListener('click', () => {
    const active = $avatarPicker.querySelector('.ava-opt.is-active');
    profile.name = $nameInput.value.trim();
    profile.avatar = active ? active.dataset.avatar : DEFAULT_AVATAR;
    saveProfile();
    renderProfile();
    closeSheet();
  });

  // ---------- Hero ----------
  function renderHero() {
    const now = new Date();
    if (view === 'today') {
      $heroSub.textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
      $heroTitle.textContent = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    } else if (view === 'tomorrow') {
      const t = parseYmd(addDays(todayStr(), 1));
      $heroSub.textContent = 'Tomorrow';
      $heroTitle.textContent = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    } else if (view === 'week') {
      const { start, end } = weekBounds();
      const s = parseYmd(start), e = parseYmd(end);
      const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      $heroSub.textContent = 'This Week';
      $heroTitle.textContent = fmt(s) + ' – ' + fmt(e);
    } else if (view === 'month') {
      $heroSub.textContent = 'This Month';
      $heroTitle.textContent = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else { // custom
      $heroSub.textContent = 'Custom';
      $heroTitle.textContent = customDate
        ? parseYmd(customDate).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })
        : 'Pick a date';
    }
  }

  // ---------- Rendering list ----------
  function render() {
    renderHero();
    $groups.innerHTML = '';

    const today = todayStr();
    let shown = [];

    // Overdue group (Today view only): unfinished tasks due before today
    if (view === 'today') {
      const overdue = tasks.filter(t => !t.done && t.due < today)
        .sort((a, b) => a.due < b.due ? -1 : 1);
      if (overdue.length) {
        $groups.appendChild(groupHeader('Overdue', overdue.length, true));
        $groups.appendChild(listOf(overdue));
        shown = shown.concat(overdue);
      }
    }

    const inRange = tasks.filter(t => inView(t.due, view));

    if (view === 'today') {
      if (inRange.length) $groups.appendChild(listOf(inRange));
      shown = shown.concat(inRange);
    } else {
      // group by due date, ascending
      const byDate = {};
      inRange.forEach(t => (byDate[t.due] = byDate[t.due] || []).push(t));
      Object.keys(byDate).sort().forEach(due => {
        $groups.appendChild(groupHeader(dateLabel(due), byDate[due].length, false));
        $groups.appendChild(listOf(byDate[due]));
      });
      shown = inRange;
    }

    // Empty state
    if (shown.length === 0) {
      $empty.hidden = false;
      const labels = { today: 'today', tomorrow: 'tomorrow', week: 'this week', month: 'this month', custom: 'that day' };
      $emptyTitle.textContent = 'Nothing for ' + labels[view];
      $emptySub.textContent = 'Add a task below — it defaults to ' + shortLabel(dueSel).toLowerCase() + '.';
    } else {
      $empty.hidden = true;
    }

    renderProgress(shown);
  }

  function groupHeader(label, count, overdue) {
    const h = document.createElement('div');
    h.className = 'group-head' + (overdue ? ' is-overdue' : '');
    const span = document.createElement('span');
    span.textContent = label;
    const c = document.createElement('span');
    c.className = 'group-count';
    c.textContent = count;
    h.append(span, c);
    return h;
  }

  function listOf(items) {
    const ul = document.createElement('ul');
    ul.className = 'list';
    // urgent (and not done) float to the top, otherwise keep existing order
    const ordered = items.map((t, i) => [t, i])
      .sort((a, b) => ((b[0].urgent && !b[0].done) - (a[0].urgent && !a[0].done)) || (a[1] - b[1]))
      .map(x => x[0]);
    ordered.forEach(t => ul.appendChild(renderItem(t)));
    return ul;
  }

  function renderItem(t) {
    const today = todayStr();
    const isOverdue = !t.done && t.due < today;
    const li = document.createElement('li');
    li.className = 'item' + (t.done ? ' done' : '') + (isOverdue ? ' overdue' : '') + (t.urgent && !t.done ? ' urgent' : '');
    li.dataset.id = t.id;

    const check = document.createElement('button');
    check.className = 'check';
    check.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
    check.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    check.addEventListener('click', () => toggle(t.id));

    const body = document.createElement('div');
    body.className = 'item-body';

    const text = document.createElement('span');
    text.className = 'item-text';
    text.textContent = t.text;
    text.setAttribute('role', 'button');
    text.addEventListener('click', () => openTaskSheet(t.id));   // tap to edit full details

    const due = document.createElement('span');
    due.className = 'item-due' + (isOverdue ? ' is-overdue' : '');
    const dueParts = [dateLabel(t.due) + (t.time ? ' · ' + formatTime(t.time) : '') + (isOverdue ? ' · overdue' : '')];
    due.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>'
      + (t.urgent && !t.done ? '<span class="urgent-pill">Urgent</span>' : '')
      + '<span>' + dueParts[0] + (t.notes ? ' · ' + escapeHtml(t.notes) : '') + '</span>';

    body.append(text, due);

    if (t.tags && t.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'item-tags';
      t.tags.forEach(tag => { const c = document.createElement('span'); c.className = 'tag-chip'; c.textContent = '#' + tag; tags.append(c); });
      body.append(tags);
    }

    const del = document.createElement('button');
    del.className = 'del-btn';
    del.setAttribute('aria-label', 'Delete task');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
    del.addEventListener('click', () => remove(t.id));

    li.append(check, body, del);
    return li;
  }

  function renderProgress(shown) {
    const total = shown.length;
    const done = shown.filter(t => t.done).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    $fill.style.width = pct + '%';
    const noun = { today: 'today', tomorrow: 'tomorrow', week: 'this week', month: 'this month', custom: 'that day' }[view];
    if (total === 0) $ptext.textContent = 'Nothing scheduled ' + noun + '.';
    else if (done === total) $ptext.textContent = `All ${total} done ${noun}. Nice work! 🎉`;
    else $ptext.textContent = `${done} of ${total} done ${noun} · ${pct}%`;
  }

  // ---------- Actions ----------
  function add(textValue) {
    const text = textValue.trim();
    if (!text) return;
    tasks.unshift({ id: uid(), text, notes: '', done: false, due: dueSel, time: '', urgent: false, tags: [], created: Date.now() });
    save();
    render();
  }

  // ---------- Task sheet (rich create / edit) ----------
  let editTaskId = null;
  const $taskOverlay = document.getElementById('task-overlay');
  const $taskSheet = document.getElementById('task-sheet');
  const $taskSheetTitle = document.getElementById('task-sheet-title');
  const $taskTitle = document.getElementById('task-title');
  const $taskNotes = document.getElementById('task-notes');
  const $taskDate = document.getElementById('task-date');
  const $taskTime = document.getElementById('task-time');
  const $taskUrgent = document.getElementById('task-urgent');
  const $taskTags = document.getElementById('task-tags');
  const $taskSave = document.getElementById('task-save');
  const $taskDelete = document.getElementById('task-delete');
  const $detailsBtn = document.getElementById('details-btn');

  function openTaskSheet(id) {
    editTaskId = id || null;
    const t = id ? tasks.find(x => x.id === id) : null;
    $taskSheetTitle.textContent = t ? 'Edit task' : 'New task';
    $taskTitle.value = t ? t.text : ($input.value.trim());
    $taskNotes.value = t ? (t.notes || '') : '';
    $taskDate.value = t ? t.due : dueSel;
    $taskTime.value = t ? (t.time || '') : '';
    $taskUrgent.checked = t ? !!t.urgent : false;
    $taskTags.value = t && t.tags ? t.tags.join(', ') : '';
    $taskDelete.hidden = !t;
    $taskOverlay.hidden = false;
    $taskSheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $taskOverlay.classList.add('show'); $taskSheet.classList.add('show'); });
  }
  function closeTaskSheet() {
    $taskOverlay.classList.remove('show');
    $taskSheet.classList.remove('show');
    $taskSheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { $taskOverlay.hidden = true; }, 280);
  }
  function parseTags(s) {
    return s.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 8);
  }
  $detailsBtn.addEventListener('click', () => openTaskSheet(null));
  $taskOverlay.addEventListener('click', closeTaskSheet);
  $taskDelete.addEventListener('click', () => {
    if (!editTaskId) return;
    tasks = tasks.filter(x => x.id !== editTaskId);
    save(); closeTaskSheet(); render(); flashToast('Task deleted');
  });
  $taskSave.addEventListener('click', () => {
    const text = $taskTitle.value.trim();
    if (!text) { $taskTitle.focus(); return; }
    const data = {
      text, notes: $taskNotes.value.trim(), due: $taskDate.value || dueSel,
      time: $taskTime.value || '', urgent: $taskUrgent.checked, tags: parseTags($taskTags.value),
    };
    if (editTaskId) {
      const t = tasks.find(x => x.id === editTaskId); if (t) Object.assign(t, data);
    } else {
      tasks.unshift({ id: uid(), done: false, created: Date.now(), ...data });
      $input.value = ''; $addBtn.disabled = true;
    }
    save(); closeTaskSheet(); render();
  });
  function toggle(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    t.done = !t.done; save(); render();
  }
  function remove(id) {
    const idx = tasks.findIndex(x => x.id === id); if (idx === -1) return;
    const li = $groups.querySelector(`[data-id="${id}"]`);
    undoBuffer = { task: tasks[idx], index: idx };
    tasks.splice(idx, 1); save();
    const finish = () => { render(); showUndoToast(); };
    if (li) {
      li.classList.add('removing');
      li.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 300);
    } else finish();
  }
  function undoRemove() {
    if (!undoBuffer) return;
    const { task, index } = undoBuffer;
    tasks.splice(Math.min(index, tasks.length), 0, task);
    undoBuffer = null; save(); render(); hideToast();
  }

  // ---------- Toast ----------
  function showUndoToast() {
    clearTimeout(toastTimer);
    $toast.innerHTML = '';
    const label = document.createElement('span'); label.textContent = 'Task deleted';
    const btn = document.createElement('button');
    btn.className = 'toast-undo'; btn.textContent = 'Undo';
    btn.addEventListener('click', undoRemove);
    $toast.append(label, btn);
    $toast.classList.add('show');
    toastTimer = setTimeout(() => { hideToast(); undoBuffer = null; }, 4000);
  }
  function hideToast() { clearTimeout(toastTimer); $toast.classList.remove('show'); }
  function flashToast(msg) {
    clearTimeout(toastTimer);
    $toast.innerHTML = '';
    const label = document.createElement('span'); label.textContent = msg;
    $toast.append(label);
    $toast.classList.add('show');
    toastTimer = setTimeout(hideToast, 3500);
  }

  // ---------- Composer / due date ----------
  function refreshDateChip() {
    $due.value = dueSel;
    $dateChipLabel.textContent = shortLabel(dueSel);
  }
  $dateChip.addEventListener('click', () => {
    if (typeof $due.showPicker === 'function') { try { $due.showPicker(); return; } catch {} }
    $due.focus(); $due.click();
  });
  $due.addEventListener('change', () => {
    if ($due.value) { dueSel = $due.value; refreshDateChip(); if ($empty.hidden === false) render(); }
  });

  $form.addEventListener('submit', e => {
    e.preventDefault();
    add($input.value);
    $input.value = ''; $addBtn.disabled = true; $input.focus();
  });
  $input.addEventListener('input', () => { $addBtn.disabled = $input.value.trim() === ''; });
  // keep the bottom nav from floating above the keyboard while typing a task
  $input.addEventListener('focus', () => document.body.classList.add('kb-open'));
  $input.addEventListener('blur', () => document.body.classList.remove('kb-open'));

  const $customDate = document.getElementById('custom-date');
  $segment.addEventListener('click', e => {
    const btn = e.target.closest('.segment-btn'); if (!btn) return;
    view = btn.dataset.view;
    [...$segment.children].forEach(b => b.classList.toggle('is-active', b === btn));
    render();
    if (view === 'custom') {                 // open a date picker to choose the day
      if (!customDate) customDate = todayStr();
      $customDate.value = customDate;
      if (typeof $customDate.showPicker === 'function') { try { $customDate.showPicker(); } catch {} }
      else { $customDate.focus(); $customDate.click(); }
    }
  });
  $customDate.addEventListener('change', () => {
    if ($customDate.value) { customDate = $customDate.value; render(); }
  });

  // ==========================================================
  //  HABITS
  // ==========================================================
  const HABIT_KEY = 'tasks.habits';
  const HABIT_EMOJIS = ['💪', '📚', '🏃', '💧', '🧘', '🍎', '😴', '🎯', '✍️', '🎸'];
  const HABIT_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

  let habits = loadHabits();
  let habitDraft = { emoji: HABIT_EMOJIS[0], reminder: '' };
  let habitUndo = null;
  let reminderEditId = null;        // habit whose reminder is being edited via card chip

  const $habitList = document.getElementById('habit-list');
  const $habitEmpty = document.getElementById('habit-empty');
  const $habitFill = document.getElementById('habit-fill');
  const $habitProgress = document.getElementById('habit-progress');
  const $newHabitBtn = document.getElementById('new-habit-btn');
  const $habitOverlay = document.getElementById('habit-overlay');
  const $habitSheet = document.getElementById('habit-sheet');
  const $habitName = document.getElementById('habit-name');
  const $habitReason = document.getElementById('habit-reason');
  const $habitEmoji = document.getElementById('habit-emoji');
  const $habitColor = document.getElementById('habit-color');
  const $habitReminder = document.getElementById('habit-reminder');
  const $habitReminderClear = document.getElementById('habit-reminder-clear');
  const $habitSave = document.getElementById('habit-save');
  const $reminderNative = document.getElementById('reminder-native');

  function loadHabits() {
    try { return JSON.parse(localStorage.getItem(HABIT_KEY)) || []; } catch { return []; }
  }
  function saveHabits() { try { localStorage.setItem(HABIT_KEY, JSON.stringify(habits)); } catch {} cloudSave(); }

  function weekDays() {
    const { start } = weekBounds();
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  function streakOf(h) {
    let s = 0, cursor = todayStr();
    if (!h.checks[cursor]) cursor = addDays(cursor, -1); // grace: today not done yet
    while (h.checks[cursor]) { s++; cursor = addDays(cursor, -1); }
    return s;
  }

  // ---------- weekly-target stats ----------
  const habitTarget = h => Math.min(7, Math.max(1, h.target || 7));

  function mondayOf(ymd) {
    const d = parseYmd(ymd);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return ymdOf(d);
  }
  function ymdOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function checksInWeek(h, weekStart) {
    let n = 0;
    for (let i = 0; i < 7; i++) if (h.checks[addDays(weekStart, i)]) n++;
    return n;
  }
  function weekProgress(h) { return checksInWeek(h, weekBounds().start); }

  // Consecutive weeks the target was met (this week counts even if not yet met, so it doesn't break early)
  function weekStreakOf(h) {
    const target = habitTarget(h);
    let s = 0, wk = weekBounds().start;
    if (checksInWeek(h, wk) < target) wk = addDays(wk, -7);   // grace for the in-progress week
    while (checksInWeek(h, wk) >= target) { s++; wk = addDays(wk, -7); }
    return s;
  }
  // Longest run ever, in the habit's natural unit (days for daily, weeks for weekly-target)
  function bestStreakOf(h) {
    const days = Object.keys(h.checks).filter(k => h.checks[k]).sort();
    if (!days.length) return 0;
    if (habitTarget(h) >= 7) {
      let best = 1, run = 1;
      for (let i = 1; i < days.length; i++) {
        run = (addDays(days[i - 1], 1) === days[i]) ? run + 1 : 1;
        best = Math.max(best, run);
      }
      return best;
    }
    // weekly: scan every week from first check's week to this week
    const target = habitTarget(h);
    let wk = mondayOf(days[0]);
    const end = weekBounds().start;
    let best = 0, run = 0;
    while (wk <= end) {
      if (checksInWeek(h, wk) >= target) { run++; best = Math.max(best, run); } else run = 0;
      wk = addDays(wk, 7);
    }
    return best;
  }
  function currentStreak(h) { return habitTarget(h) >= 7 ? streakOf(h) : weekStreakOf(h); }
  function streakUnit(h) { return habitTarget(h) >= 7 ? 'day' : 'wk'; }

  function completionRate(h) {
    const created = mondayOf(ymdOf(new Date(h.created || Date.now())));
    const end = weekBounds().start;
    const target = habitTarget(h);
    if (habitTarget(h) >= 7) {
      // done days vs days elapsed since created
      const startDay = ymdOf(new Date(h.created || Date.now()));
      let total = 0, cursor = startDay, t = todayStr(), done = 0;
      let guard = 0;
      while (cursor <= t && guard < 400) { total++; if (h.checks[cursor]) done++; cursor = addDays(cursor, 1); guard++; }
      return total ? Math.round(done / total * 100) : 0;
    }
    let weeks = 0, met = 0, wk = created, guard = 0;
    while (wk <= end && guard < 520) { weeks++; if (checksInWeek(h, wk) >= target) met++; wk = addDays(wk, 7); guard++; }
    return weeks ? Math.round(met / weeks * 100) : 0;
  }

  function renderHabits() {
    $habitList.innerHTML = '';
    const today = todayStr();

    habits.forEach(h => $habitList.appendChild(renderHabitCard(h)));

    $habitEmpty.hidden = habits.length !== 0;

    // progress = habits completed today
    const total = habits.length;
    const doneToday = habits.filter(h => h.checks[today]).length;
    const pct = total ? Math.round(doneToday / total * 100) : 0;
    $habitFill.style.width = pct + '%';
    if (total === 0) $habitProgress.textContent = 'No habits yet.';
    else if (doneToday === total) $habitProgress.textContent = `All ${total} done today. Keep the streak! 🔥`;
    else $habitProgress.textContent = `${doneToday} of ${total} done today · ${pct}%`;
  }

  function renderHabitCard(h) {
    const today = todayStr();
    const card = document.createElement('div');
    card.className = 'habit';
    card.dataset.id = h.id;

    // Top row
    const top = document.createElement('div');
    top.className = 'habit-top';

    const handle = document.createElement('button');
    handle.className = 'drag-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Drag to reorder');
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    handle.addEventListener('pointerdown', e => startDrag(e, card, h));

    const emoji = document.createElement('div');
    emoji.className = 'habit-emoji';
    emoji.textContent = h.emoji;

    const info = document.createElement('div');
    info.className = 'habit-info';
    const name = document.createElement('div');
    name.className = 'habit-name';
    name.textContent = h.name;
    name.contentEditable = 'true';
    name.spellcheck = false;
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('blur', () => {
      const v = name.textContent.trim();
      if (!v) { name.textContent = h.name; return; }
      if (v !== h.name) { h.name = v; saveHabits(); }
    });
    info.append(name);

    if (h.reason) {
      const reason = document.createElement('div');
      reason.className = 'habit-reason';
      reason.textContent = '“' + h.reason + '”';
      info.append(reason);
    }

    const sub = document.createElement('div');
    sub.className = 'habit-sub';
    const st = currentStreak(h);
    const target = habitTarget(h);
    const parts = [];
    if (st > 0) parts.push(`<span class="streak">🔥 ${st}-${streakUnit(h)} streak</span>`);
    if (target < 7) {
      const wp = weekProgress(h);
      parts.push(`<span${wp >= target ? ' class="streak"' : ''}>${wp}/${target} this week${wp >= target ? ' ✓' : ''}</span>`);
    }
    sub.innerHTML = parts.length ? parts.join(' · ') : 'Tap a day to check in';
    info.append(sub);

    const stats = document.createElement('button');
    stats.className = 'report-stat-btn';
    stats.type = 'button';
    stats.setAttribute('aria-label', 'View report');
    stats.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="10"/></svg>';
    stats.addEventListener('click', () => openReport(h.id));

    const del = document.createElement('button');
    del.className = 'habit-del';
    del.setAttribute('aria-label', 'Delete habit');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
    del.addEventListener('click', () => removeHabit(h.id));

    top.append(handle, emoji, info, stats, del);

    // Week strip
    const strip = document.createElement('div');
    strip.className = 'week-strip';
    weekDays().forEach(day => {
      const d = parseYmd(day);
      const isToday = day === today;
      const isFuture = day > today;
      const done = !!h.checks[day];

      const cell = document.createElement('button');
      cell.className = 'hday' + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      cell.type = 'button';
      cell.setAttribute('aria-label', d.toLocaleDateString(undefined, { weekday: 'long' }) + (done ? ', done' : ''));

      const lbl = document.createElement('span');
      lbl.className = 'hday-lbl';
      lbl.textContent = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1);

      const dot = document.createElement('span');
      dot.className = 'hday-dot' + (done ? ' done' : '');
      dot.innerHTML = `<span class="hd-num">${d.getDate()}</span><svg class="hd-check" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

      cell.append(lbl, dot);
      if (!isFuture) cell.addEventListener('click', () => toggleCheck(h.id, day));
      strip.appendChild(cell);
    });

    // Actions: reminder chip + add-to-calendar
    const actions = document.createElement('div');
    actions.className = 'habit-actions';

    const remChip = document.createElement('button');
    remChip.type = 'button';
    remChip.className = 'chip-btn' + (h.reminder ? ' on' : '');
    remChip.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>'
      + '<span>' + (h.reminder ? formatTime(h.reminder) : 'Set reminder') + '</span>';
    remChip.addEventListener('click', () => editReminder(h.id));

    actions.append(remChip);

    card.append(top, strip, actions);
    return card;
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function toggleCheck(id, day) {
    const h = habits.find(x => x.id === id); if (!h) return;
    if (h.checks[day]) delete h.checks[day]; else h.checks[day] = true;
    saveHabits();
    renderHabits();
  }

  function removeHabit(id) {
    const idx = habits.findIndex(x => x.id === id); if (idx === -1) return;
    const card = $habitList.querySelector(`[data-id="${id}"]`);
    habitUndo = { habit: habits[idx], index: idx };
    habits.splice(idx, 1); saveHabits(); syncPush();
    const finish = () => { renderHabits(); showHabitUndo(); };
    if (card) {
      card.classList.add('removing');
      card.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 300);
    } else finish();
  }
  function showHabitUndo() {
    clearTimeout(toastTimer);
    $toast.innerHTML = '';
    const label = document.createElement('span'); label.textContent = 'Habit deleted';
    const btn = document.createElement('button');
    btn.className = 'toast-undo'; btn.textContent = 'Undo';
    btn.addEventListener('click', () => {
      if (!habitUndo) return;
      habits.splice(Math.min(habitUndo.index, habits.length), 0, habitUndo.habit);
      habitUndo = null; saveHabits(); syncPush(); renderHabits(); hideToast();
    });
    $toast.append(label, btn);
    $toast.classList.add('show');
    toastTimer = setTimeout(() => { hideToast(); habitUndo = null; }, 4000);
  }

  // Habit sheet
  const $habitTarget = document.getElementById('habit-target');
  function buildHabitPickers() {
    $habitEmoji.innerHTML = '';
    HABIT_EMOJIS.forEach(e => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'emoji-opt'; b.textContent = e;
      b.addEventListener('click', () => {
        habitDraft.emoji = e;
        [...$habitEmoji.children].forEach(x => x.classList.toggle('is-active', x === b));
      });
      $habitEmoji.appendChild(b);
    });
    $habitTarget.innerHTML = '';
    [1, 2, 3, 4, 5, 6, 7].forEach(n => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'target-opt'; b.dataset.n = n;
      b.textContent = n === 7 ? 'Daily' : n;
      b.addEventListener('click', () => {
        habitDraft.target = n;
        [...$habitTarget.children].forEach(x => x.classList.toggle('is-active', x === b));
      });
      $habitTarget.appendChild(b);
    });
  }
  function syncHabitPickers() {
    [...$habitEmoji.children].forEach(b => b.classList.toggle('is-active', b.textContent === habitDraft.emoji));
    [...$habitTarget.children].forEach(b => b.classList.toggle('is-active', +b.dataset.n === habitDraft.target));
  }

  function openHabitSheet() {
    habitDraft = { emoji: HABIT_EMOJIS[0], reminder: '', target: 7 };
    $habitName.value = '';
    $habitReason.value = '';
    $habitReminder.value = '';
    syncHabitPickers();
    // fallback: mark first option active
    $habitEmoji.firstChild && $habitEmoji.firstChild.classList.add('is-active');
    $habitOverlay.hidden = false;
    $habitSheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $habitOverlay.classList.add('show'); $habitSheet.classList.add('show'); });
  }
  function closeHabitSheet() {
    $habitOverlay.classList.remove('show');
    $habitSheet.classList.remove('show');
    $habitSheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { $habitOverlay.hidden = true; }, 280);
  }
  $newHabitBtn.addEventListener('click', openHabitSheet);
  $habitOverlay.addEventListener('click', closeHabitSheet);
  $habitReminderClear.addEventListener('click', () => { $habitReminder.value = ''; });
  $habitSave.addEventListener('click', async () => {
    const name = $habitName.value.trim();
    if (!name) { $habitName.focus(); return; }
    const reminder = $habitReminder.value || '';
    habits.push({
      id: uid(), name, reason: $habitReason.value.trim(),
      emoji: habitDraft.emoji, target: habitDraft.target || 7,
      reminder, lastNotified: '', created: Date.now(), checks: {}
    });
    saveHabits();
    renderHabits();
    closeHabitSheet();
    if (reminder) { const ok = await subscribeAndSync(); if (!ok) await ensureNotifyPermission(); }
    syncPush();
  });

  // ---------- Habit report ----------
  const $reportOverlay = document.getElementById('report-overlay');
  const $reportSheet = document.getElementById('report-sheet');
  const $reportTitle = document.getElementById('report-title');
  const $reportSub = document.getElementById('report-sub');
  const $repStreak = document.getElementById('rep-streak');
  const $repStreakLbl = document.getElementById('rep-streak-lbl');
  const $repBest = document.getElementById('rep-best');
  const $repTotal = document.getElementById('rep-total');
  const $repWeek = document.getElementById('rep-week');
  const $repRate = document.getElementById('rep-rate');
  const $repBars = document.getElementById('rep-bars');
  const $reportClose = document.getElementById('report-close');

  function openReport(id) {
    const h = habits.find(x => x.id === id); if (!h) return;
    const target = habitTarget(h);
    const unit = streakUnit(h) === 'day' ? 'Day' : 'Week';
    $reportTitle.textContent = h.emoji + ' ' + h.name;
    $reportSub.textContent = target >= 7 ? 'Goal: every day' : 'Goal: ' + target + '× per week';
    $repStreak.textContent = currentStreak(h);
    $repStreakLbl.textContent = unit + ' streak';
    $repBest.textContent = bestStreakOf(h);
    $repTotal.textContent = Object.keys(h.checks).filter(k => h.checks[k]).length;
    $repWeek.textContent = weekProgress(h) + '/' + target;
    $repRate.textContent = completionRate(h) + '%';

    // last 8 weeks bar chart
    $repBars.innerHTML = '';
    let wk = addDays(weekBounds().start, -49);   // 7 weeks back → 8 including current
    for (let i = 0; i < 8; i++) {
      const n = checksInWeek(h, wk);
      const pct = Math.min(100, Math.round(n / target * 100));
      const met = n >= target;
      const bar = document.createElement('div');
      bar.className = 'mini-bar';
      bar.innerHTML = `<div class="mini-bar-track"><div class="mini-bar-fill${met ? ' met' : ''}" style="height:${Math.max(6, pct)}%"></div></div>`
        + `<span class="mini-bar-lbl">${parseYmd(wk).getDate()}</span>`;
      bar.title = n + '/' + target + ' that week';
      $repBars.appendChild(bar);
      wk = addDays(wk, 7);
    }

    $reportOverlay.hidden = false;
    $reportSheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $reportOverlay.classList.add('show'); $reportSheet.classList.add('show'); });
  }
  function closeReport() {
    $reportOverlay.classList.remove('show');
    $reportSheet.classList.remove('show');
    $reportSheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { $reportOverlay.hidden = true; }, 280);
  }
  $reportClose.addEventListener('click', closeReport);
  $reportOverlay.addEventListener('click', closeReport);

  // ---------- Reminder editing from a card ----------
  function editReminder(id) {
    const h = habits.find(x => x.id === id); if (!h) return;
    reminderEditId = id;
    $reminderNative.value = h.reminder || '';
    if (typeof $reminderNative.showPicker === 'function') { try { $reminderNative.showPicker(); return; } catch {} }
    $reminderNative.focus(); $reminderNative.click();
  }
  $reminderNative.addEventListener('change', async () => {
    const h = habits.find(x => x.id === reminderEditId); if (!h) return;
    h.reminder = $reminderNative.value || '';
    saveHabits();
    renderHabits();
    if (h.reminder) {
      const ok = (await subscribeAndSync()) || (await ensureNotifyPermission());
      if (!ok) flashToast('Enable notifications in your browser to get reminders');
    }
    syncPush();
  });

  // ---------- Notifications ----------
  async function ensureNotifyPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
  }
  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  async function fireHabitNotification(h) {
    const title = 'Time for your habit';
    const body = `${h.emoji} ${h.name}` + (h.reason ? ` — ${h.reason}` : '');
    const opts = { body, tag: 'habit-' + h.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch {}
  }
  function checkReminders() {
    if (push.sub) return;   // server push handles delivery (even when closed)
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const t = todayStr(), hhmm = nowHHMM();
    habits.forEach(h => {
      if (h.reminder && h.reminder === hhmm && h.lastNotified !== t && !h.checks[t]) {
        h.lastNotified = t; saveHabits();
        fireHabitNotification(h);
      }
    });
    events.forEach(ev => {
      const at = eventReminderAt(ev);
      if (at && at.date === t && at.time === hhmm && ev.lastNotified !== t) {
        ev.lastNotified = t; saveEvents();
        fireNotification('Upcoming event', '📅 ' + ev.title + (ev.time ? ' at ' + formatTime(ev.time) : ''));
      }
    });
  }
  async function fireNotification(title, body) {
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch {}
  }

  // ---------- Drag to reorder ----------
  let dragState = null;
  function startDrag(e, card, h) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'habit-ph';
    ph.style.height = rect.height + 'px';
    card.parentNode.insertBefore(ph, card);

    card.classList.add('dragging');
    card.style.width = rect.width + 'px';
    card.style.left = rect.left + 'px';
    card.style.top = rect.top + 'px';

    dragState = { card, ph, grab: e.clientY - rect.top };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd, { once: true });
  }
  function onDragMove(e) {
    if (!dragState) return;
    const { card, ph, grab } = dragState;
    card.style.top = (e.clientY - grab) + 'px';
    const mid = e.clientY - grab + card.offsetHeight / 2;
    const siblings = [...$habitList.querySelectorAll('.habit:not(.dragging)')];
    let target = null;
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      if (mid < r.top + r.height / 2) { target = s; break; }
    }
    if (target) $habitList.insertBefore(ph, target);
    else $habitList.appendChild(ph);
  }
  function onDragEnd() {
    if (!dragState) return;
    document.removeEventListener('pointermove', onDragMove);
    const { card, ph } = dragState;
    card.classList.remove('dragging');
    card.style.width = card.style.left = card.style.top = '';
    ph.parentNode.replaceChild(card, ph);
    // commit new order from DOM
    const order = [...$habitList.querySelectorAll('.habit')].map(el => el.dataset.id);
    habits.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    dragState = null;
    saveHabits();
    renderHabits();
  }

  // ==========================================================
  //  CALENDAR (events + reminders)
  // ==========================================================
  const EVENTS_KEY = 'tasks.events';
  let events = loadEvents();
  let calOffset = 0;                 // months from current (0 = this month)
  let calSelected = todayStr();      // selected day
  let editEventId = null;            // event being edited (null = new)
  let calView = 'grid';             // 'grid' | 'month' | 'upcoming'
  let agendaFilter = 'all';         // 'all' | 'reminder' | 'location'

  const $calModes = document.getElementById('cal-modes');
  const $agendaFilters = document.getElementById('agenda-filters');
  const $calCard = document.getElementById('cal-card');
  const $calDaySection = document.getElementById('cal-daysection');
  const $calAgenda = document.getElementById('cal-agenda');
  const $agendaSummary = document.getElementById('agenda-summary');
  const $agendaList = document.getElementById('agenda-list');
  const $agendaEmpty = document.getElementById('agenda-empty');
  const $calGrid = document.getElementById('cal-grid');
  const $calPrev = document.getElementById('cal-prev');
  const $calNext = document.getElementById('cal-next');
  const $calTodayBtn = document.getElementById('cal-today');
  const $calMonthTitle = document.getElementById('cal-monthtitle');
  const $calDayTitle = document.getElementById('cal-day-title');
  const $calEvents = document.getElementById('cal-events');
  const $calEmpty = document.getElementById('cal-empty');
  const $newEventBtn = document.getElementById('new-event-btn');
  const $eventOverlay = document.getElementById('event-overlay');
  const $eventSheet = document.getElementById('event-sheet');
  const $eventSheetTitle = document.getElementById('event-sheet-title');
  const $eventTitle = document.getElementById('event-title');
  const $eventDate = document.getElementById('event-date');
  const $eventTime = document.getElementById('event-time');
  const $eventReminder = document.getElementById('event-reminder');
  const $eventNote = document.getElementById('event-note');
  const $eventEndDate = document.getElementById('event-end-date');
  const $eventLocation = document.getElementById('event-location');
  const $eventMapLink = document.getElementById('event-map-link');
  const $eventSave = document.getElementById('event-save');
  const $eventDelete = document.getElementById('event-delete');

  function mapsUrl(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); }
  function refreshEventMapLink() {
    const v = $eventLocation.value.trim();
    if (v) { $eventMapLink.href = mapsUrl(v); $eventMapLink.hidden = false; }
    else { $eventMapLink.hidden = true; }
  }

  function loadEvents() {
    try { return JSON.parse(localStorage.getItem(EVENTS_KEY)) || []; } catch { return []; }
  }
  function saveEvents() { try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)); } catch {} cloudSave(); }

  // reminder timing: returns {date,time} the reminder should fire, or null
  function eventReminderAt(ev) {
    if (ev.reminderMin == null) return null;
    const base = ev.time || '09:00';
    let [h, m] = base.split(':').map(Number);
    let total = h * 60 + m - (ev.reminderMin | 0);
    let date = ev.date;
    while (total < 0) { total += 1440; date = addDays(date, -1); }
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return { date, time: hh + ':' + mm };
  }
  function reminderLabel(min) {
    if (min == null) return '';
    if (min === 0) return 'At time';
    if (min === 1440) return '1 day before';
    if (min === 60) return '1 hour before';
    return min + ' min before';
  }

  function eventsOn(date) {
    return events.filter(e => date >= e.date && date <= (e.endDate || e.date))
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }

  function renderCalendar() {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
    const year = base.getFullYear(), month = base.getMonth();
    const today = todayStr();

    // toggle grid / month-agenda / upcoming
    const gridMode = calView === 'grid';
    const upcoming = calView === 'upcoming';
    $calCard.hidden = !gridMode;
    $calDaySection.hidden = !gridMode;
    $calAgenda.hidden = gridMode;
    $agendaFilters.hidden = gridMode;

    // month bar: the month is meaningless in Upcoming, so show a label and hide nav
    $calMonthTitle.textContent = upcoming ? 'Upcoming' : base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    [$calPrev, $calNext, $calTodayBtn].forEach(b => b.style.visibility = upcoming ? 'hidden' : 'visible');

    if (!gridMode) { renderAgenda(year, month); return; }

    $calGrid.innerHTML = '';
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const daysIn = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < lead; i++) {
      const b = document.createElement('div'); b.className = 'cal-cell blank'; $calGrid.append(b);
    }
    for (let day = 1; day <= daysIn; day++) {
      const ds = ymd(new Date(year, month, day));
      const dayEvents = eventsOn(ds);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell' + (ds === today ? ' today' : '') + (ds === calSelected ? ' selected' : '');
      cell.dataset.date = ds;

      const num = document.createElement('span');
      num.className = 'cal-num'; num.textContent = day;

      const dots = document.createElement('span');
      dots.className = 'cal-dots';
      dayEvents.slice(0, 3).forEach(() => {
        const d = document.createElement('span'); d.className = 'cal-dot';
        dots.append(d);
      });

      cell.append(num, dots);
      cell.addEventListener('click', () => { calSelected = ds; renderCalendar(); });
      $calGrid.append(cell);
    }

    renderDaySection();
  }

  function renderDaySection() {
    const today = todayStr();
    const sel = parseYmd(calSelected);
    let title = sel.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    if (calSelected === today) title = 'Today · ' + title;
    else if (calSelected === addDays(today, 1)) title = 'Tomorrow · ' + title;
    $calDayTitle.textContent = title;

    const list = eventsOn(calSelected);
    $calEvents.innerHTML = '';
    $calEmpty.hidden = list.length !== 0;
    list.forEach(ev => $calEvents.append(renderEventRow(ev)));
  }

  // Month / Upcoming overview: events grouped by day, with optional filters.
  function renderAgenda(year, month) {
    const today = todayStr();
    const upcoming = calView === 'upcoming';
    const monthStart = ymd(new Date(year, month, 1));
    const daysIn = new Date(year, month + 1, 0).getDate();
    const monthEnd = ymd(new Date(year, month, daysIn));

    let list = upcoming
      ? events.filter(e => (e.endDate || e.date) >= today)                         // from today onward
      : events.filter(e => e.date <= monthEnd && (e.endDate || e.date) >= monthStart);
    if (agendaFilter === 'reminder') list = list.filter(e => e.reminderMin != null);
    else if (agendaFilter === 'location') list = list.filter(e => e.location);

    // group by the day the event appears in this view (clamp ongoing/earlier starts)
    const byDay = {};
    list.forEach(e => {
      const floor = upcoming ? today : monthStart;
      const key = e.date < floor ? floor : e.date;
      (byDay[key] = byDay[key] || []).push(e);
    });
    const days = Object.keys(byDay).sort();

    const n = list.length;
    const monthName = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long' });
    $agendaSummary.textContent = n
      ? (upcoming ? `${n} upcoming event${n > 1 ? 's' : ''}` : `${n} event${n > 1 ? 's' : ''} in ${monthName}`)
      : '';
    $agendaEmpty.hidden = n !== 0;
    $agendaEmpty.querySelector('.empty-sub').textContent =
      (agendaFilter !== 'all') ? 'No matching events. Try “All”.'
      : upcoming ? 'Nothing upcoming. Tap “Add event” below.'
      : 'No events this month. Tap “Add event” below.';

    $agendaList.innerHTML = '';
    let lastMonthKey = '';
    days.forEach(ds => {
      const d = parseYmd(ds);
      if (upcoming) {                          // month divider when the month changes
        const mk = ds.slice(0, 7);
        if (mk !== lastMonthKey) {
          lastMonthKey = mk;
          const div = document.createElement('div');
          div.className = 'agenda-month';
          div.textContent = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          $agendaList.append(div);
        }
      }
      const head = document.createElement('div');
      head.className = 'agenda-day' + (ds === today ? ' is-today' : '');
      head.innerHTML = `<span class="agenda-daynum">${d.getDate()}</span>`
        + `<span class="agenda-daymeta"><span class="agenda-dow">${d.toLocaleDateString(undefined, { weekday: 'long' })}</span></span>`;
      $agendaList.append(head);
      byDay[ds]
        .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
        .forEach(ev => $agendaList.append(renderEventRow(ev)));
    });
  }

  function renderEventRow(ev) {
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.dataset.id = ev.id;

    const color = document.createElement('span');
    color.className = 'ev-color';
    color.style.background = 'var(--accent)';

    const main = document.createElement('div');
    main.className = 'ev-main';
    const title = document.createElement('div');
    title.className = 'ev-title';
    title.textContent = ev.title;
    const meta = document.createElement('div');
    meta.className = 'ev-meta';
    const parts = [];
    if (ev.endDate && ev.endDate !== ev.date) {
      const fmt = d => parseYmd(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      parts.push(fmt(ev.date) + ' – ' + fmt(ev.endDate));
    } else if (ev.time) parts.push(`<span class="ev-time">${formatTime(ev.time)}</span>`);
    else parts.push('All day');
    if (ev.time && ev.endDate && ev.endDate !== ev.date) parts.push(formatTime(ev.time));
    if (ev.note) parts.push(escapeHtml(ev.note));
    let html = parts.join(' · ');
    if (ev.reminderMin != null) {
      html += ` <span class="ev-bell"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>${reminderLabel(ev.reminderMin)}</span>`;
    }
    if (ev.location) {
      html += ` <span class="ev-loc"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><a href="${mapsUrl(ev.location)}" target="_blank" rel="noopener">${escapeHtml(ev.location)}</a></span>`;
    }
    meta.innerHTML = html;
    main.append(title, meta);

    row.append(color, main);
    // open editor when tapping the row, but let the map link work
    row.addEventListener('click', e => { if (e.target.closest('a')) return; openEventSheet(ev.id); });
    return row;
  }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ---------- Event sheet ----------
  function openEventSheet(id) {
    editEventId = id || null;
    const ev = id ? events.find(e => e.id === id) : null;
    $eventSheetTitle.textContent = ev ? 'Edit event' : 'New event';
    $eventTitle.value = ev ? ev.title : '';
    $eventDate.value = ev ? ev.date : calSelected;
    $eventTime.value = ev ? (ev.time || '') : '';
    $eventReminder.value = ev && ev.reminderMin != null ? String(ev.reminderMin) : 'none';
    $eventNote.value = ev ? (ev.note || '') : '';
    $eventEndDate.value = ev ? (ev.endDate || '') : '';
    $eventLocation.value = ev ? (ev.location || '') : '';
    refreshEventMapLink();
    $eventDelete.hidden = !ev;

    $eventOverlay.hidden = false;
    $eventSheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $eventOverlay.classList.add('show'); $eventSheet.classList.add('show'); });
  }
  function closeEventSheet() {
    $eventOverlay.classList.remove('show');
    $eventSheet.classList.remove('show');
    $eventSheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { $eventOverlay.hidden = true; }, 280);
  }
  $newEventBtn.addEventListener('click', () => openEventSheet(null));
  $eventOverlay.addEventListener('click', closeEventSheet);
  $eventLocation.addEventListener('input', refreshEventMapLink);
  $eventDelete.addEventListener('click', () => {
    if (!editEventId) return;
    events = events.filter(e => e.id !== editEventId);
    saveEvents(); syncPush(); closeEventSheet(); renderCalendar();
    flashToast('Event deleted');
  });
  $eventSave.addEventListener('click', async () => {
    const title = $eventTitle.value.trim();
    if (!title) { $eventTitle.focus(); return; }
    const date = $eventDate.value || calSelected;
    const time = $eventTime.value || '';
    const rv = $eventReminder.value;
    const reminderMin = rv === 'none' ? null : parseInt(rv, 10);
    let endDate = $eventEndDate.value || '';
    if (endDate && endDate < date) endDate = '';   // ignore invalid ranges
    const data = { title, date, time, reminderMin, note: $eventNote.value.trim(), endDate, location: $eventLocation.value.trim() };

    if (editEventId) {
      const ev = events.find(e => e.id === editEventId);
      Object.assign(ev, data);
    } else {
      events.push({ id: uid(), ...data, lastNotified: '', created: Date.now() });
    }
    calSelected = date;
    saveEvents();
    closeEventSheet();
    renderCalendar();
    if (reminderMin != null) { const ok = await subscribeAndSync(); if (!ok) await ensureNotifyPermission(); }
    syncPush();
  });

  // ---------- calendar nav ----------
  document.getElementById('cal-prev').addEventListener('click', () => { calOffset--; renderCalendar(); });
  document.getElementById('cal-next').addEventListener('click', () => { calOffset++; renderCalendar(); });
  document.getElementById('cal-today').addEventListener('click', () => { calOffset = 0; calSelected = todayStr(); renderCalendar(); });
  $calModes.addEventListener('click', e => {
    const b = e.target.closest('.cal-mode'); if (!b) return;
    calView = b.dataset.mode;
    [...$calModes.children].forEach(x => x.classList.toggle('is-active', x === b));
    renderCalendar();
  });
  $agendaFilters.addEventListener('click', e => {
    const b = e.target.closest('.fchip'); if (!b) return;
    agendaFilter = b.dataset.filter;
    [...$agendaFilters.children].forEach(x => x.classList.toggle('is-active', x === b));
    renderCalendar();
  });

  // ==========================================================
  //  SCREEN SWITCHING
  // ==========================================================
  const $tabbar = document.getElementById('tabbar');
  const $screenTasks = document.getElementById('screen-tasks');
  const $screenHabits = document.getElementById('screen-habits');
  const $screenCalendar = document.getElementById('screen-calendar');
  function switchScreen(name) {
    $screenTasks.hidden = name !== 'tasks';
    $screenHabits.hidden = name !== 'habits';
    $screenCalendar.hidden = name !== 'calendar';
    [...$tabbar.children].forEach(b => b.classList.toggle('is-active', b.dataset.screen === name));
    if (name === 'habits') renderHabits();
    if (name === 'calendar') renderCalendar();
  }
  $tabbar.addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    switchScreen(b.dataset.screen);
  });

  // ==========================================================
  //  CALENDAR (.ics) EXPORT
  // ==========================================================
  function icsEscape(s) { return String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'); }
  function icsStamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function downloadICS(filename, lines) {
    const ics = lines.join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function safeName(s) { return (s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event'; }

  // One-time all-day event on the task's due date, with a 9am reminder
  function addTaskToCalendar(t) {
    const d = t.due.replace(/-/g, '');
    const dEnd = addDays(t.due, 1).replace(/-/g, '');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tasks PWA//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:task-' + t.id + '@tasks.local',
      'DTSTAMP:' + icsStamp(),
      'DTSTART;VALUE=DATE:' + d,
      'DTEND;VALUE=DATE:' + dEnd,
      'SUMMARY:' + icsEscape(t.text),
      'DESCRIPTION:' + icsEscape('Task from Tasks PWA'),
      'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(t.text), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    downloadICS('task-' + safeName(t.text) + '.ics', lines);
    flashToast('Calendar event downloaded 📅');
  }

  // Recurring daily event at the habit's reminder time (or 9am), with an alarm
  function addHabitToCalendar(h) {
    const time = h.reminder || '09:00';
    const [hh, mm] = time.split(':');
    const startDate = todayStr().replace(/-/g, '');
    const dtStart = startDate + 'T' + hh + mm + '00';
    // +15 minutes for the end time
    const endMin = (parseInt(hh) * 60 + parseInt(mm) + 15);
    const eh = String(Math.floor(endMin / 60) % 24).padStart(2, '0');
    const em = String(endMin % 60).padStart(2, '0');
    const dtEnd = startDate + 'T' + eh + em + '00';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tasks PWA//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:habit-' + h.id + '@tasks.local',
      'DTSTAMP:' + icsStamp(),
      'DTSTART:' + dtStart,        // floating local time -> recurs at local wall-clock
      'DTEND:' + dtEnd,
      'RRULE:FREQ=DAILY',
      'SUMMARY:' + icsEscape(h.emoji + ' ' + h.name),
      'DESCRIPTION:' + icsEscape(h.reason ? 'Why: ' + h.reason : 'Daily habit'),
      'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(h.name), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    downloadICS('habit-' + safeName(h.name) + '.ics', lines);
    flashToast('Daily calendar reminder downloaded 📅');
  }

  // ==========================================================
  //  WEB PUSH (delivered by a Supabase Edge Function on a cron —
  //  reminders arrive even when the app and browser are closed)
  // ==========================================================
  const VAPID_PUBLIC = 'BCW58CX0uLHF2aY4Z70yk5YnctcgHCfDSi0_yw6CFcnjHeH4I9Tn00HN02Pczdn9k6fjs7RIlubkQ3fXv3Wmq0E';
  const push = { supported: ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window), sub: null };

  function urlB64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  // Only re-subscribe silently on load if permission is already granted (no prompt).
  async function initPush() {
    if (!push.supported || !sb.access_token) return;
    if (Notification.permission === 'granted') await subscribeAndSync();
  }

  // Requests permission if needed, subscribes, and uploads the schedule to Supabase.
  async function subscribeAndSync() {
    if (!push.supported || !sb.access_token) return false;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
        });
      }
      push.sub = sub;
      await syncPush();
      return true;
    } catch (e) { return false; }
  }

  function habitReminderEntries() {
    return habits.filter(h => h.reminder).map(h => ({
      time: h.reminder, tag: 'habit-' + h.id,      // daily (no date)
      title: 'Time for your habit',
      body: `${h.emoji} ${h.name}` + (h.reason ? ` — ${h.reason}` : ''),
    }));
  }
  function eventReminderEntries() {
    const out = [];
    events.forEach(ev => {
      const at = eventReminderAt(ev);
      if (!at) return;
      out.push({
        date: at.date, time: at.time, tag: 'event-' + ev.id,   // one-time (has date)
        title: 'Upcoming event',
        body: '📅 ' + ev.title + (ev.time ? ' · ' + formatTime(ev.time) : '') + (ev.note ? ' — ' + ev.note : ''),
      });
    });
    return out;
  }

  // Upsert this device's subscription + schedule + timezone into Supabase.
  async function syncPush() {
    if (!push.sub || !sb.access_token) return;
    if (!(await ensureToken())) return;
    const reminders = [...habitReminderEntries(), ...eventReminderEntries()];
    const timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    try {
      await fetch(SB_URL + '/rest/v1/push_subscriptions', {
        method: 'POST',
        headers: {
          'apikey': SB_KEY, 'Authorization': 'Bearer ' + sb.access_token,
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ user_id: sb.userId, subscription: push.sub, reminders, timezone }),
      });
    } catch {}
  }

  // ==========================================================
  //  AUTH + CLOUD SYNC
  // ==========================================================
  // Supabase project (publishable key is safe in client code)
  const SB_URL = 'https://ohruurnsxzmzsqyvqskt.supabase.co';
  const SB_KEY = 'sb_publishable_6ggMJ9qVhIvZHl5evLIJbg_ZDReH851';
  const SESSION_KEY = 'daymark.session';

  const sb = { access_token: null, refresh_token: null, expires_at: 0, userId: null, email: null };
  let cloudTimer = null, cloudSuppress = false;

  const $authScreen = document.getElementById('auth-screen');
  const $authForm = document.getElementById('auth-form');
  const $authEmail = document.getElementById('auth-email');
  const $authPassword = document.getElementById('auth-password');
  const $authError = document.getElementById('auth-error');
  const $authSubmit = document.getElementById('auth-submit');
  const $authSub = document.getElementById('auth-sub');
  const $authToggleText = document.getElementById('auth-toggle-text');
  const $authToggleBtn = document.getElementById('auth-toggle-btn');
  const $accountRow = document.getElementById('account-row');
  const $accountEmail = document.getElementById('account-email');
  const $logoutBtn = document.getElementById('logout-btn');
  const $syncRow = document.getElementById('sync-row');
  const $syncStatus = document.getElementById('sync-status');
  const $syncText = document.getElementById('sync-text');
  const $syncAgo = document.getElementById('sync-ago');
  const $syncNow = document.getElementById('sync-now');

  let authMode = 'login';   // 'login' | 'signup'

  const LASTSYNC_KEY = 'daymark.lastsync';
  let lastSync = parseInt(localStorage.getItem(LASTSYNC_KEY) || '0', 10) || 0;
  function markSynced() {
    lastSync = Date.now();
    try { localStorage.setItem(LASTSYNC_KEY, String(lastSync)); } catch {}
    updateSyncAgo();
  }
  function relTime(ms) {
    if (!ms) return 'Not synced yet';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 10) return 'Last synced: just now';
    if (s < 60) return 'Last synced: ' + s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return 'Last synced: ' + m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return 'Last synced: ' + h + 'h ago';
    const d = Math.round(h / 24);
    return 'Last synced: ' + d + 'd ago';
  }
  function updateSyncAgo() { $syncAgo.textContent = relTime(lastSync); }

  function setSyncStatus(state, text) {
    $syncStatus.classList.remove('ok', 'err');
    if (state === 'ok') $syncStatus.classList.add('ok');
    if (state === 'err') $syncStatus.classList.add('err');
    $syncText.textContent = text;
  }
  $syncNow && $syncNow.addEventListener('click', async () => {
    if (!sb.access_token) return;
    setSyncStatus('', 'Syncing…');
    await cloudLoad();   // pushes if this device has unsynced edits, otherwise pulls the latest
  });

  function loadSession() {
    try { Object.assign(sb, JSON.parse(localStorage.getItem(SESSION_KEY)) || {}); } catch {}
  }
  function persistSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sb)); } catch {}
  }
  function clearSession() {
    sb.access_token = sb.refresh_token = sb.userId = sb.email = null; sb.expires_at = 0;
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }
  function setSession(d) {
    sb.access_token = d.access_token;
    sb.refresh_token = d.refresh_token;
    sb.expires_at = Date.now() + (d.expires_in || 3600) * 1000;
    sb.userId = d.user && d.user.id;
    sb.email = d.user && d.user.email;
    persistSession();
  }
  function showAuth() { $authScreen.hidden = false; }
  function hideAuth() { $authScreen.hidden = true; }
  function updateAccountRow() {
    $accountRow.hidden = !sb.email;
    $accountEmail.textContent = sb.email || '';
    $syncRow.hidden = !sb.access_token;
  }

  function setAuthMode(mode) {
    authMode = mode;
    if (mode === 'signup') {
      $authSub.textContent = 'Create an account to sync across devices';
      $authSubmit.textContent = 'Sign up';
      $authToggleText.textContent = 'Already have an account?';
      $authToggleBtn.textContent = 'Log in';
      $authPassword.autocomplete = 'new-password';
    } else {
      $authSub.textContent = 'Log in to sync your tasks, habits & events';
      $authSubmit.textContent = 'Log in';
      $authToggleText.textContent = 'New here?';
      $authToggleBtn.textContent = 'Create an account';
      $authPassword.autocomplete = 'current-password';
    }
  }
  $authToggleBtn.addEventListener('click', () => { $authError.hidden = true; setAuthMode(authMode === 'login' ? 'signup' : 'login'); });

  const $pwToggle = document.getElementById('pw-toggle');
  $pwToggle.addEventListener('click', () => {
    const reveal = $authPassword.type === 'password';
    $authPassword.type = reveal ? 'text' : 'password';
    $pwToggle.classList.toggle('show', reveal);
    $pwToggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });

  // ---------- Supabase auth calls ----------
  async function sbAuth(path, body) {
    const r = await fetch(SB_URL + path, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }
  function sbError(data, fallback) {
    const m = data.error_description || data.msg || data.message || data.error || fallback;
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password';
    return m;
  }
  async function ensureToken() {
    if (!sb.access_token) return false;
    if (Date.now() < sb.expires_at - 60000) return true;
    const { ok, data } = await sbAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: sb.refresh_token });
    if (ok && data.access_token) { setSession(data); return true; }
    return false;
  }

  $authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $authEmail.value.trim().toLowerCase();
    const password = $authPassword.value;
    if (!email || !password) return;
    $authError.hidden = true;
    $authSubmit.disabled = true;
    $authSubmit.textContent = authMode === 'signup' ? 'Signing up…' : 'Logging in…';
    try {
      if (authMode === 'signup') {
        const { ok, data } = await sbAuth('/auth/v1/signup', { email, password });
        if (!ok) throw new Error(sbError(data, 'Sign up failed'));
        if (data.access_token) {          // session issued → logged in
          setSession(data); updateAccountRow(); $authForm.reset(); hideAuth();
          await pushData();               // adopt any local data into the new account
        } else {                          // email confirmation required
          setAuthMode('login');
          $authError.textContent = 'Account created — check your email to confirm, then log in.';
          $authError.hidden = false;
        }
      } else {
        const { ok, data } = await sbAuth('/auth/v1/token?grant_type=password', { email, password });
        if (!ok || !data.access_token) throw new Error(sbError(data, 'Wrong email or password'));
        setSession(data); updateAccountRow(); $authForm.reset(); hideAuth();
        await cloudLoad();                // pull this account's data
      }
    } catch (err) {
      $authError.textContent = /fetch|network/i.test(err.message) ? 'Can’t reach Supabase. Check your connection.' : err.message;
      $authError.hidden = false;
    } finally {
      $authSubmit.disabled = false;
      if (authMode === 'signup') $authSubmit.textContent = 'Sign up';
      else $authSubmit.textContent = 'Log in';
    }
  });

  $logoutBtn.addEventListener('click', () => doLogout(false));

  async function doLogout(expired) {
    if (sb.access_token) {
      try { fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + sb.access_token } }); } catch {}
    }
    clearSession();
    // clear cached app data so the next person doesn't see it
    [STORE_KEY, HABIT_KEY, EVENTS_KEY, PROFILE_KEY, DIRTY_KEY, LASTSYNC_KEY].forEach(k => localStorage.removeItem(k));
    dirty = false; lastSync = 0;  // reset sync state for the next account
    cloudSuppress = true;
    tasks = []; habits = []; events = []; profile = { name: '', avatar: 'eclipse' };
    save(); saveHabits(); saveEvents(); saveProfile();
    cloudSuppress = false;
    renderProfile(); render(); renderHabits(); renderCalendar();
    updateAccountRow();
    try { closeSheet(); } catch {}
    setAuthMode('login');
    $authError.hidden = true;
    showAuth();
    if (expired) { $authError.textContent = 'Your session expired — please log in again.'; $authError.hidden = false; }
  }

  // ---------- cloud data (Supabase Postgres, row-level secured) ----------
  // Model: a device is "dirty" when it has local edits not yet on the server.
  //  - A dirty device PUSHES (its edits win); it never gets overwritten by a pull.
  //  - A clean device PULLS the server copy (the server is the source of truth).
  // This gives reliable cross-device sync without depending on device clocks, and
  // never loses unsynced local edits.
  const DIRTY_KEY = 'daymark.dirty';
  let dirty = localStorage.getItem(DIRTY_KEY) === '1';
  function setDirty(v) { dirty = v; try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch {} }

  function cloudSave() {
    if (cloudSuppress) return;   // applying server data → not a user edit
    setDirty(true);              // this device now has changes the server doesn't
    if (!sb.access_token) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(pushData, 700);
  }
  async function pushData() {
    if (!(await ensureToken())) { if (sb.refresh_token) doLogout(true); return false; }
    if (!sb.userId) { console.warn('[sync] no user id — cannot save'); return false; }
    try {
      setSyncStatus('', 'Syncing…');
      const r = await fetch(SB_URL + '/rest/v1/user_data', {
        method: 'POST',
        headers: {
          'apikey': SB_KEY, 'Authorization': 'Bearer ' + sb.access_token,
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ user_id: sb.userId, data: { tasks, habits, events, profile } }),
      });
      if (r.status === 401) { doLogout(true); return false; }
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.warn('[sync] save failed', r.status, detail);
        setSyncStatus('err', 'Sync failed (' + r.status + ')');
        return false;
      }
      setDirty(false);           // our changes are now on the server
      setSyncStatus('ok', 'Synced');
      markSynced();
      return true;
    } catch (e) { console.warn('[sync] save error', e); setSyncStatus('err', 'Offline — will sync later'); return false; }
  }
  async function cloudLoad() {
    if (!(await ensureToken())) { if (sb.refresh_token) doLogout(true); return; }
    if (dirty) { await pushData(); return; }   // we have unsynced edits → push them, don't overwrite
    try {
      setSyncStatus('', 'Syncing…');
      const r = await fetch(SB_URL + '/rest/v1/user_data?select=data', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + sb.access_token, 'Cache-Control': 'no-cache' },
      });
      if (r.status === 401) { doLogout(true); return; }
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.warn('[sync] load failed', r.status, detail);
        setSyncStatus('err', 'Sync error (' + r.status + ')');
        return;
      }
      const rows = await r.json();
      if (rows.length) { applyData(rows[0].data || {}); setDirty(false); setSyncStatus('ok', 'Synced'); markSynced(); }
      else { await pushData(); }   // first time on this account → seed the row from local
      initPush();                  // (re)subscribe to push if already permitted, and upload schedule
    } catch (e) { console.warn('[sync] load error', e); setSyncStatus('err', 'Offline'); }
  }
  // Pull the latest whenever the app returns to the foreground (so a device that was
  // already open still picks up changes made on another device).
  let lastPull = 0;
  async function pullLatest() {
    if (!sb.access_token || document.hidden) return;
    if (Date.now() - lastPull < 1500) return;   // debounce focus/visibility double-fires
    lastPull = Date.now();
    await cloudLoad();
  }
  function applyData(d) {
    cloudSuppress = true;
    tasks = Array.isArray(d.tasks) ? d.tasks : [];
    habits = Array.isArray(d.habits) ? d.habits : [];
    events = Array.isArray(d.events) ? d.events : [];
    profile = (d.profile && typeof d.profile === 'object') ? d.profile : { name: '', avatar: 'eclipse' };
    save(); saveHabits(); saveEvents(); saveProfile();
    cloudSuppress = false;
    renderProfile(); render(); renderHabits(); renderCalendar();
  }

  function initAuth() {
    loadSession();
    setAuthMode('login');
    if (sb.access_token) { hideAuth(); updateAccountRow(); cloudLoad(); }
    else { showAuth(); }
  }

  // ---------- Init ----------
  initTheme();
  buildAvatarPicker();
  renderProfile();
  refreshDateChip();
  buildHabitPickers();
  $addBtn.disabled = true;
  render();
  renderHabits();
  initAuth();   // loads session → cloudLoad → initPush (push subscribes after we know the user)

  // refresh when the day rolls over so "Today" stays correct + check reminders each minute
  let currentDay = todayStr();
  checkReminders();
  setInterval(() => {
    const now = todayStr();
    if (now !== currentDay) { currentDay = now; refreshDateChip(); render(); renderHabits(); }
    checkReminders();
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); pullLatest(); } });
  window.addEventListener('focus', () => { checkReminders(); pullLatest(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
