// ==========================================================================
// Schedule Rendering, Numerator/Denominator & Manual Editing Module
// ==========================================================================

const Schedule = {
  rawSchedule: null,
  selectedSubgroup: 1, // Default to 1st subgroup (no "all groups" view)
  selectedDay: 'today', // 'today', 1..6, 'all'
  weekFilter: 'all', // 'all', 'numerator', 'denominator', 'current'
  searchQuery: '',

  bellSlots: [
    { pair: 1, start: '08:00', end: '09:35', sMin: 8 * 60, eMin: 9 * 60 + 35 },
    { pair: 2, start: '09:45', end: '11:20', sMin: 9 * 60 + 45, eMin: 11 * 60 + 20 },
    { pair: 3, start: '11:30', end: '13:05', sMin: 11 * 60 + 30, eMin: 13 * 60 + 5 },
    { pair: 4, start: '13:30', end: '15:05', sMin: 13 * 60 + 30, eMin: 15 * 60 + 5 },
    { pair: 5, start: '15:15', end: '16:50', sMin: 15 * 60 + 15, eMin: 16 * 60 + 50 },
    { pair: 6, start: '17:00', end: '18:35', sMin: 17 * 60, eMin: 18 * 60 + 35 },
    { pair: 7, start: '18:40', end: '20:05', sMin: 18 * 60 + 40, eMin: 20 * 60 + 5 }
  ],

  async init() {
    this.bindEvents();
    await this.loadSchedule();
    this.startLiveStatusTimer();
  },

  getCampusAddress(room) {
    if (!room) return 'ул. 20-летия Октября, 84 (Главный корпус)';
    const r = String(room);
    if (r.includes('/1')) return 'Московский просп., 14 (Корпус 1)';
    if (r.includes('/2')) return 'Плехановская ул., 11 (Корпус 2)';
    if (r.includes('/5')) return 'Московский просп., 14 (Корпус 5)';
    return 'ул. 20-летия Октября, 84 (Главный корпус)';
  },

  async loadSchedule() {
    try {
      const res = await fetch('/api/schedule');
      if (res.ok) {
        this.rawSchedule = await res.json();
        this.render();
        this.updateLiveStatus();
      }
    } catch (e) {
      console.error('Failed to load schedule', e);
    }
  },

  setSubgroup(sg) {
    this.selectedSubgroup = parseInt(sg, 10) || 1;
    
    // Update quick buttons (only 1 and 2)
    document.querySelectorAll('.subgroup-pill-btn').forEach(btn => {
      const bSg = parseInt(btn.dataset.subgroup, 10);
      btn.classList.toggle('active', bSg === this.selectedSubgroup);
    });

    this.render();
    this.updateLiveStatus();
  },

  setDay(day) {
    this.selectedDay = day;
    document.querySelectorAll('.day-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.day == day);
    });
    this.render();
  },

  bindEvents() {
    // Subgroup quick pill clicks
    document.querySelectorAll('.subgroup-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setSubgroup(btn.dataset.subgroup);
      });
    });

    // Day chips clicks
    document.querySelectorAll('.day-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.setDay(chip.dataset.day);
      });
    });

    // Search input
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    // Week selector
    const weekSelect = document.getElementById('weekFilterSelect');
    weekSelect?.addEventListener('change', (e) => {
      this.weekFilter = e.target.value;
      this.render();
    });

    // Add Lesson button
    document.getElementById('addLessonBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.AdminAuth) {
        AdminAuth.prompt(() => this.openAddLessonModal());
      } else {
        this.openAddLessonModal();
      }
    });

    // Reset Schedule button
    document.getElementById('resetScheduleBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.AdminAuth) {
        AdminAuth.prompt(() => this.resetSchedule());
      } else {
        this.resetSchedule();
      }
    });

    // Auto-update address when room input changes in modal
    const roomInput = document.getElementById('editLessonRoom');
    roomInput?.addEventListener('input', (e) => {
      const addressInput = document.getElementById('editLessonAddress');
      if (addressInput) {
        addressInput.value = this.getCampusAddress(e.target.value);
      }
    });

    // Auto-update standard time when pair number changes in modal
    document.getElementById('editLessonPair')?.addEventListener('change', (e) => {
      const pairNum = parseInt(e.target.value, 10);
      const slot = this.bellSlots.find(s => s.pair === pairNum);
      const customTimeInput = document.getElementById('editLessonCustomTime');
      if (slot && customTimeInput && !customTimeInput.value) {
        // keep slot standard
      }
    });

    // Save lesson form submit
    document.getElementById('lessonEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleLessonFormSubmit();
    });

    // Delete lesson button in modal
    document.getElementById('deleteLessonBtn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const lessonId = document.getElementById('editLessonId').value;
      if (!lessonId) return;
      if (confirm('Вы действительно хотите удалить это занятие из расписания?')) {
        await this.deleteLesson(lessonId);
      }
    });

    // Event delegation on scheduleGrid for 100% reliable clicks
    const grid = document.getElementById('scheduleGrid');
    grid?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-edit-lesson');
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        const lessonId = editBtn.dataset.lessonId;
        const dayOfWeek = parseInt(editBtn.dataset.day, 10) || 1;
        if (window.AdminAuth) {
          AdminAuth.prompt(() => this.openEditLessonModalById(lessonId, dayOfWeek));
        } else {
          this.openEditLessonModalById(lessonId, dayOfWeek);
        }
        return;
      }

      const noteBtn = e.target.closest('.btn-note');
      if (noteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const lessonId = noteBtn.dataset.lessonId;
        const subject = noteBtn.dataset.subject;
        const teacher = noteBtn.dataset.teacher;
        if (window.Tasks) {
          Tasks.openNoteModal(lessonId, subject, teacher);
        }
        return;
      }

      const hwBtn = e.target.closest('.btn-add-hw');
      if (hwBtn) {
        e.preventDefault();
        e.stopPropagation();
        const subject = hwBtn.dataset.subject;
        if (window.Tasks) {
          Tasks.openAddTaskModal(subject);
        }
        return;
      }
    });
  },

  getCurrentAcademicWeek() {
    const semesterStart = new Date(2026, 8, 1); // 1 Sept 2026
    const now = new Date();
    const diffTime = Math.max(0, now - semesterStart);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  },

  isCurrentWeekNumerator() {
    return this.getCurrentAcademicWeek() % 2 !== 0;
  },

  getCurrentDayOfWeek() {
    const day = new Date().getDay(); // 0 is Sun, 1 is Mon ... 6 is Sat
    return day === 0 ? 7 : day;
  },

  parseTimeSlot(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split('-').map(s => s.trim());
    if (parts.length === 2) {
      const sParts = parts[0].split(':').map(Number);
      const eParts = parts[1].split(':').map(Number);
      if (!isNaN(sParts[0]) && !isNaN(sParts[1]) && !isNaN(eParts[0]) && !isNaN(eParts[1])) {
        return {
          start: parts[0],
          end: parts[1],
          sMin: sParts[0] * 60 + sParts[1],
          eMin: eParts[0] * 60 + eParts[1]
        };
      }
    }
    return null;
  },

  updateLiveStatus() {
    const liveText = document.getElementById('liveStatusText');
    if (!liveText || !this.rawSchedule) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = this.getCurrentDayOfWeek();
    const currentWeek = this.getCurrentAcademicWeek();
    const isNum = currentWeek % 2 !== 0;
    const weekName = isNum ? 'Числитель (нечетная)' : 'Знаменатель (четная)';

    if (dayOfWeek > 6) {
      liveText.innerHTML = `<strong>Воскресенье</strong> • Неделя ${currentWeek} (${weekName}) • Занятий сегодня нет.`;
      return;
    }

    const currentDayData = this.rawSchedule.days.find(d => d.dayOfWeek === dayOfWeek);
    if (!currentDayData || !currentDayData.lessons.length) {
      liveText.innerHTML = `Сегодня нет занятий • Неделя ${currentWeek} (${weekName})`;
      return;
    }

    // Filter today's lessons for current subgroup and current week parity
    const todayLessons = currentDayData.lessons.filter(l => {
      if (l.subgroup !== 0 && l.subgroup !== this.selectedSubgroup) {
        return false;
      }
      if (isNum && l.weekType === 'denominator') return false;
      if (!isNum && l.weekType === 'numerator') return false;
      return true;
    });

    let ongoing = null;
    let upcoming = null;
    let upcomingDiff = Infinity;

    for (const l of todayLessons) {
      const slot = this.parseTimeSlot(l.time) || this.bellSlots.find(s => s.pair === l.pair);
      if (slot) {
        if (currentMinutes >= slot.sMin && currentMinutes <= slot.eMin) {
          ongoing = { lesson: l, slot };
          break;
        } else if (currentMinutes < slot.sMin) {
          const diff = slot.sMin - currentMinutes;
          if (diff < upcomingDiff) {
            upcomingDiff = diff;
            upcoming = { lesson: l, slot };
          }
        }
      }
    }

    const weekBadgeHtml = `<span class="badge ${isNum ? 'badge-numerator' : 'badge-denominator'}" style="font-size:0.75rem; margin-right:4px;">${weekName}</span>`;

    if (ongoing) {
      const addr = ongoing.lesson.address || this.getCampusAddress(ongoing.lesson.room);
      liveText.innerHTML = `${weekBadgeHtml} <span class="status-time">Идет ${ongoing.lesson.pair} пара (${ongoing.lesson.time}):</span> <strong>${ongoing.lesson.subject}</strong> [ауд. ${ongoing.lesson.room} • ${addr}]`;
    } else if (upcoming) {
      const startTime = upcoming.slot.start || upcoming.lesson.time.split('-')[0].trim();
      liveText.innerHTML = `${weekBadgeHtml} След. пара в <strong>${startTime}</strong> (через ${upcomingDiff} мин): <strong>${upcoming.lesson.subject}</strong> [ауд. ${upcoming.lesson.room}]`;
    } else {
      liveText.innerHTML = `${weekBadgeHtml} Занятия на сегодня окончены`;
    }
  },

  startLiveStatusTimer() {
    this.updateLiveStatus();
    setInterval(() => {
      this.updateLiveStatus();
    }, 30000);
  },

  render() {
    const container = document.getElementById('scheduleGrid');
    if (!container || !this.rawSchedule) return;

    container.innerHTML = '';

    const currentDayOfWeek = this.getCurrentDayOfWeek();
    const isCurrentWeekNum = this.isCurrentWeekNumerator();

    let targetDayNum = null;
    if (this.selectedDay === 'today') {
      targetDayNum = currentDayOfWeek <= 6 ? currentDayOfWeek : 1;
    } else if (this.selectedDay !== 'all') {
      targetDayNum = parseInt(this.selectedDay, 10);
    }

    let daysToRender = this.rawSchedule.days;
    if (targetDayNum !== null) {
      daysToRender = daysToRender.filter(d => d.dayOfWeek === targetDayNum);
    }

    let totalLessonsRendered = 0;

    daysToRender.forEach(day => {
      const filteredLessons = day.lessons.filter(lesson => {
        // 1. SUBGROUP FILTER: show only current subgroup (1 or 2) and general lessons (0)
        if (lesson.subgroup !== 0 && lesson.subgroup !== this.selectedSubgroup) {
          return false;
        }

        // 2. WEEK / NUMERATOR / DENOMINATOR FILTER
        if (this.weekFilter === 'numerator') {
          if (lesson.weekType === 'denominator') return false;
        } else if (this.weekFilter === 'denominator') {
          if (lesson.weekType === 'numerator') return false;
        } else if (this.weekFilter === 'current') {
          if (isCurrentWeekNum && lesson.weekType === 'denominator') return false;
          if (!isCurrentWeekNum && lesson.weekType === 'numerator') return false;
        }

        // 3. SEARCH QUERY
        if (this.searchQuery) {
          const address = lesson.address || this.getCampusAddress(lesson.room);
          const hay = `${lesson.subject} ${lesson.teacher} ${lesson.room} ${address} ${lesson.type}`.toLowerCase();
          if (!hay.includes(this.searchQuery)) return false;
        }

        return true;
      });

      if (filteredLessons.length === 0 && this.selectedDay === 'all') {
        return;
      }

      totalLessonsRendered += filteredLessons.length;

      const daySection = document.createElement('div');
      daySection.className = 'day-section';

      const isToday = day.dayOfWeek === currentDayOfWeek;
      const dayHeader = document.createElement('div');
      dayHeader.className = 'day-header';
      dayHeader.innerHTML = `
        <h3 class="day-title">
          ${day.name}
          ${isToday ? '<span class="brand-badge">Сегодня</span>' : ''}
        </h3>
        <span class="day-pair-count">${filteredLessons.length} ${this.pluralizePairs(filteredLessons.length)} • ${this.selectedSubgroup} п/г</span>
      `;
      daySection.appendChild(dayHeader);

      const lessonsList = document.createElement('div');
      lessonsList.className = 'lessons-list';

      if (filteredLessons.length === 0) {
        lessonsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </div>
            <h4>Нет занятий для ${this.selectedSubgroup} подгруппы</h4>
            <p style="font-size: 0.85rem;">В этот день у выбранной подгруппы нет пар</p>
          </div>
        `;
      } else {
        filteredLessons.forEach(lesson => {
          lessonsList.appendChild(this.createLessonCard(lesson, isToday, day.dayOfWeek));
        });
      }

      daySection.appendChild(lessonsList);
      container.appendChild(daySection);
    });

    if (totalLessonsRendered === 0 && daysToRender.length > 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 4rem 1rem;">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h3>Ничего не найдено</h3>
          <p>По выбранным параметрам подходящих пар для ${this.selectedSubgroup} подгруппы не обнаружено</p>
        </div>
      `;
    }
  },

  createLessonCard(lesson, isToday, dayOfWeek) {
    const card = document.createElement('div');
    card.className = `lesson-card ${lesson.weekType === 'denominator' ? 'denominator-card' : ''}`;
    card.dataset.lessonId = lesson.id;
    card.dataset.day = dayOfWeek;

    // Check if currently active pair
    if (isToday) {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const slot = this.parseTimeSlot(lesson.time) || this.bellSlots.find(s => s.pair === lesson.pair);
      if (slot && currentMin >= slot.sMin && currentMin <= slot.eMin) {
        card.classList.add('current-lesson');
      }
    }

    // Badge styling for lesson type
    let typeClass = 'badge-practice';
    if (lesson.type.includes('Лекцион')) typeClass = 'badge-lecture';
    else if (lesson.type.includes('Лаборатор')) typeClass = 'badge-lab';

    // Week parity badge
    let parityBadge = '';
    if (lesson.weekType === 'numerator') {
      parityBadge = '<span class="badge badge-numerator" title="Нечетные недели">Числитель</span>';
    } else if (lesson.weekType === 'denominator') {
      parityBadge = '<span class="badge badge-denominator" title="Четные недели (синий цвет)">Знаменатель</span>';
    } else {
      parityBadge = '<span class="badge" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-secondary);">Каждую нед.</span>';
    }

    // Subgroup badge
    let subgroupBadge = '';
    if (lesson.subgroup === 1) subgroupBadge = '<span class="badge badge-subgroup">1 подгруппа</span>';
    else if (lesson.subgroup === 2) subgroupBadge = '<span class="badge badge-subgroup">2 подгруппа</span>';
    else subgroupBadge = '<span class="badge badge-subgroup">Обе подгруппы</span>';

    // Weeks numbers badge
    let weeksBadge = '';
    if (lesson.weeksDisplay) {
      weeksBadge = `<span class="badge badge-weeks">${lesson.weeksDisplay}</span>`;
    }

    // Campus address
    const campusAddress = lesson.address || this.getCampusAddress(lesson.room);

    // User note preview
    const savedNotes = (window.Tasks && Tasks.userNotes) || {};
    const existingNote = savedNotes[lesson.id] || '';

    card.innerHTML = `
      <div class="lesson-top">
        <div class="time-slot">
          <span class="pair-number">${lesson.pair}</span>
          <span class="pair-time">${this.escapeHtml(lesson.time)}</span>
        </div>
        <div class="badges-group">
          ${parityBadge}
          ${weeksBadge}
          ${subgroupBadge}
          <span class="badge ${typeClass}">${lesson.type}</span>
        </div>
      </div>

      <div class="lesson-main">
        <h4 class="subject-name">${this.escapeHtml(lesson.subject)}</h4>
        <div class="lesson-meta">
          <div class="meta-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>${this.escapeHtml(lesson.teacher || 'Преподаватель не указан')}</span>
          </div>

          <div class="meta-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="15"></line>
              <line x1="15" y1="9" x2="9" y2="15"></line>
            </svg>
            <span class="room-badge">Ауд. ${this.escapeHtml(lesson.room || '—')}</span>
          </div>

          <div class="campus-address-tag" title="Адрес учебного корпуса">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${this.escapeHtml(campusAddress)}</span>
          </div>
        </div>
      </div>

      <div class="lesson-footer">
        <div class="lesson-note-preview" id="note-preview-${lesson.id}">
          ${existingNote ? `📝 ${this.escapeHtml(existingNote)}` : '<span style="color:var(--text-muted);">Нет личных заметок</span>'}
        </div>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
          <button class="btn btn-card-action btn-add-hw" data-subject="${this.escapeHtml(lesson.subject)}">
            + ДЗ
          </button>
          <button class="btn btn-card-action btn-note" data-lesson-id="${lesson.id}" data-subject="${this.escapeHtml(lesson.subject)}" data-teacher="${this.escapeHtml(lesson.teacher || '')}">
            Заметка
          </button>
          <button class="btn btn-card-action btn-edit-lesson" data-lesson-id="${lesson.id}" data-day="${dayOfWeek}" title="Редактировать пару (аудитория, предмет, преподаватель, адрес)">
            ✏️ Изменить
          </button>
        </div>
      </div>
    `;

    return card;
  },

  openEditLessonModalById(lessonId, dayOfWeek) {
    if (!this.rawSchedule) return;
    let targetLesson = null;
    let foundDay = dayOfWeek;

    for (const day of this.rawSchedule.days) {
      const found = day.lessons.find(l => l.id === lessonId);
      if (found) {
        targetLesson = found;
        foundDay = day.dayOfWeek;
        break;
      }
    }

    if (targetLesson) {
      this.openEditLessonModal(targetLesson, foundDay);
    }
  },

  openAddLessonModal() {
    const modal = document.getElementById('lessonEditModal');
    if (!modal) return;

    document.getElementById('lessonEditModalTitle').textContent = 'Добавить пару в расписание';
    document.getElementById('editLessonId').value = '';

    // Auto select day
    const daySelect = document.getElementById('editLessonDay');
    if (this.selectedDay !== 'today' && this.selectedDay !== 'all') {
      daySelect.value = this.selectedDay;
    } else {
      const cur = this.getCurrentDayOfWeek();
      daySelect.value = cur <= 6 ? cur : 1;
    }

    document.getElementById('editLessonPair').value = 1;
    const timeInput = document.getElementById('editLessonTime');
    if (timeInput) timeInput.value = '08:00 - 09:35';

    document.getElementById('editLessonSubject').value = '';
    document.getElementById('editLessonType').value = 'Лекционные занятия';
    document.getElementById('editLessonWeekType').value = 'all';
    document.getElementById('editLessonSubgroup').value = this.selectedSubgroup || 1;
    document.getElementById('editLessonTeacher').value = '';
    document.getElementById('editLessonRoom').value = '';
    document.getElementById('editLessonAddress').value = 'ул. 20-летия Октября, 84 (Главный корпус)';
    document.getElementById('editLessonWeeks').value = '';

    const delBtn = document.getElementById('deleteLessonBtn');
    if (delBtn) delBtn.style.display = 'none';

    App.openModal(modal);
  },

  openEditLessonModal(lesson, dayOfWeek) {
    const modal = document.getElementById('lessonEditModal');
    if (!modal) return;

    document.getElementById('lessonEditModalTitle').textContent = 'Редактировать пару';
    document.getElementById('editLessonId').value = lesson.id;
    document.getElementById('editLessonDay').value = dayOfWeek || 1;
    document.getElementById('editLessonPair').value = lesson.pair || 1;

    const timeInput = document.getElementById('editLessonTime');
    if (timeInput) timeInput.value = lesson.time || '';

    document.getElementById('editLessonSubject').value = lesson.subject || '';
    document.getElementById('editLessonType').value = lesson.type || 'Лекционные занятия';
    document.getElementById('editLessonWeekType').value = lesson.weekType || 'all';
    document.getElementById('editLessonSubgroup').value = lesson.subgroup !== undefined ? lesson.subgroup : 1;
    document.getElementById('editLessonTeacher').value = lesson.teacher || '';
    document.getElementById('editLessonRoom').value = lesson.room || '';
    document.getElementById('editLessonAddress').value = lesson.address || this.getCampusAddress(lesson.room);
    document.getElementById('editLessonWeeks').value = lesson.weeksDisplay || '';

    const delBtn = document.getElementById('deleteLessonBtn');
    if (delBtn) delBtn.style.display = 'inline-flex';

    App.openModal(modal);
  },

  async handleLessonFormSubmit() {
    const lessonId = document.getElementById('editLessonId').value;
    const dayOfWeek = parseInt(document.getElementById('editLessonDay').value, 10);
    const pair = parseInt(document.getElementById('editLessonPair').value, 10);
    const subject = document.getElementById('editLessonSubject').value.trim();
    const type = document.getElementById('editLessonType').value;
    const weekType = document.getElementById('editLessonWeekType').value;
    const subgroup = parseInt(document.getElementById('editLessonSubgroup').value, 10);
    const teacher = document.getElementById('editLessonTeacher').value.trim();
    const room = document.getElementById('editLessonRoom').value.trim();
    const address = document.getElementById('editLessonAddress').value.trim() || this.getCampusAddress(room);
    const timeInput = document.getElementById('editLessonTime');
    const weeksText = document.getElementById('editLessonWeeks').value.trim();

    const slot = this.bellSlots.find(s => s.pair === pair);
    const standardTime = slot ? `${slot.start} - ${slot.end}` : '08:00 - 09:35';
    const time = (timeInput ? timeInput.value.trim() : '') || standardTime;

    let weeks = 'all';
    if (weeksText) {
      const matches = weeksText.match(/\d+/g);
      if (matches) {
        weeks = matches.map(n => parseInt(n, 10));
      }
    }

    const payload = {
      id: lessonId,
      dayOfWeek,
      pair,
      time,
      subject,
      type,
      weekType,
      subgroup,
      teacher,
      room,
      address,
      weeks,
      weeksDisplay: weeksText || null
    };

    try {
      const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
      const res = await fetch('/api/schedule/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        App.closeModal(document.getElementById('lessonEditModal'));
        App.showToast(lessonId ? 'Занятие успешно изменено!' : 'Новая пара добавлена в расписание!', 'success');
        await this.loadSchedule();
      } else {
        App.showToast(data.error || 'Ошибка сохранения', 'error');
        if (res.status === 403 && window.AdminAuth) {
          AdminAuth.prompt();
        }
      }
    } catch (e) {
      App.showToast('Сетевая ошибка при сохранении', 'error');
    }
  },

  async deleteLesson(lessonId) {
    try {
      const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
      const res = await fetch(`/api/schedule/lesson/${lessonId}`, {
        method: 'DELETE',
        headers: { ...authHeaders }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        App.closeModal(document.getElementById('lessonEditModal'));
        App.showToast('Пара удалена из расписания', 'success');
        await this.loadSchedule();
      } else {
        App.showToast(data.error || 'Ошибка при удалении пары', 'error');
        if (res.status === 403 && window.AdminAuth) {
          AdminAuth.prompt();
        }
      }
    } catch (e) {
      App.showToast('Сетевая ошибка при удалении', 'error');
    }
  },

  async resetSchedule() {
    if (confirm('Сбросить расписание к исходному варианту (с числителем и знаменателем)?')) {
      try {
        const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
        const res = await fetch('/api/schedule/reset', {
          method: 'POST',
          headers: { ...authHeaders }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          App.showToast('Расписание сброшено к исходному состоянию', 'success');
          await this.loadSchedule();
        } else {
          App.showToast(data.error || 'Ошибка сброса расписания', 'error');
          if (res.status === 403 && window.AdminAuth) {
            AdminAuth.prompt();
          }
        }
      } catch (e) {
        App.showToast('Ошибка сброса расписания', 'error');
      }
    }
  },

  pluralizePairs(count) {
    if (count % 10 === 1 && count % 100 !== 11) return 'пара';
    if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'пары';
    return 'пар';
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
};

window.Schedule = Schedule;
