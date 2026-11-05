// ==========================================================================
// Schedule Rendering, Numerator/Denominator & Manual Editing Module
// ==========================================================================

const Schedule = {
  rawSchedule: null,
  selectedSubgroup: 1, // Default to 1st subgroup (no "all groups" view)
  selectedDay: 'today', // 'today', 1..6, 'all'
  weekFilter: 'current', // Automatically current week
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

  initSync() {
    this.selectedSubgroup = parseInt(localStorage.getItem('btii_subgroup') || '1', 10);
    document.querySelectorAll('.subgroup-pill-btn').forEach(btn => {
      const bSg = parseInt(btn.dataset.subgroup, 10);
      btn.classList.toggle('active', bSg === this.selectedSubgroup);
    });

    this.updateDayChipDates();
    this.bindEvents();

    // 0 ms instant render from local cache
    const cached = localStorage.getItem('btii_schedule_cache');
    if (cached) {
      try {
        this.rawSchedule = JSON.parse(cached);
        this.render();
        this.updateLiveStatus();
        this.updateHeroWidget();
        if (window.App) App.updateSyncStatus('cached', 'Данные актуальны (из кеша)');
      } catch (e) {
        console.warn('Schedule cache parse error', e);
      }
    }

    this.startLiveStatusTimer();
  },

  async init() {
    this.initSync();
    await this.loadSchedule();
  },

  getCampusAddress(room) {
    if (!room) return 'ул. 20-летия Октября, 84 (Главный корпус)';
    const r = String(room);
    if (r.includes('/1')) return 'Московский просп., 14 (Корпус 1)';
    if (r.includes('/2')) return 'Плехановская ул., 11 (Корпус 2)';
    if (r.includes('/5')) return 'Московский просп., 14 (Корпус 5)';
    return 'ул. 20-летия Октября, 84 (Главный корпус)';
  },

  getCampusCode(room) {
    if (!room) return 'ГК';
    const r = String(room);
    if (r.includes('/1')) return 'К1';
    if (r.includes('/2')) return 'К2';
    if (r.includes('/5')) return 'К5';
    return 'ГК';
  },

  getCampusBadgeClass(room) {
    const code = this.getCampusCode(room);
    if (code === 'К1') return 'badge-campus-k1';
    if (code === 'К2') return 'badge-campus-k2';
    if (code === 'К5') return 'badge-campus-k5';
    return 'badge-campus-gk';
  },

  getBadgeTypeClass(type) {
    if (!type) return 'badge-practice';
    if (type.includes('Лекцион')) return 'badge-lecture';
    if (type.includes('Лаборатор')) return 'badge-lab';
    return 'badge-practice';
  },

  getCardTypeClass(type) {
    if (!type) return 'type-practice';
    if (type.includes('Лекцион')) return 'type-lecture';
    if (type.includes('Лаборатор')) return 'type-lab';
    return 'type-practice';
  },

  escapeIcs(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  },

  getGoogleCalendarUrl(lesson, dayOfWeek) {
    const now = new Date();
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const currentAcademicWeek = this.getCurrentAcademicWeek();

    const slot = this.parseTimeSlot(lesson.time) || this.bellSlots.find(s => s.pair === lesson.pair) || { start: '08:00', end: '09:35', eMin: 9 * 60 + 35 };
    const [startH, startM] = slot.start.split(':').map(Number);
    const [endH, endM] = slot.end.split(':').map(Number);
    const slotEndMin = endH * 60 + endM;

    let targetDate = new Date(now);
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && currentMin >= slotEndMin)) {
      daysUntil += 7;
    }
    targetDate.setDate(now.getDate() + daysUntil);

    // If lesson has discrete weeks (e.g. weeks: [2, 6, 10, 14])
    if (Array.isArray(lesson.weeks) && lesson.weeks.length > 0) {
      const nextWeek = lesson.weeks.find(w => {
        if (w > currentAcademicWeek) return true;
        if (w === currentAcademicWeek) {
          if (dayOfWeek > currentDay) return true;
          if (dayOfWeek === currentDay && currentMin < slotEndMin) return true;
        }
        return false;
      }) || lesson.weeks[0];

      const semStart = new Date(2026, 7, 31);
      targetDate = new Date(semStart);
      targetDate.setDate(semStart.getDate() + (nextWeek - 1) * 7 + (dayOfWeek - 1));
    } else if (lesson.weekType === 'numerator' || lesson.weekType === 'denominator') {
      const semStart = new Date(2026, 7, 31);
      const diffDays = Math.floor((targetDate - semStart) / (1000 * 60 * 60 * 24));
      const targetWeek = Math.floor(diffDays / 7) + 1;
      const isTargetNum = targetWeek % 2 !== 0;

      if (lesson.weekType === 'numerator' && !isTargetNum) {
        targetDate.setDate(targetDate.getDate() + 7);
      } else if (lesson.weekType === 'denominator' && isTargetNum) {
        targetDate.setDate(targetDate.getDate() + 7);
      }
    }

    // Voronezh is UTC+3. Subtract 3 hours for standard UTC representation
    const startUtc = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), startH - 3, startM, 0));
    const endUtc = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), endH - 3, endM, 0));

    const pad = (n) => String(n).padStart(2, '0');
    const formatGcal = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

    const dates = `${formatGcal(startUtc)}/${formatGcal(endUtc)}`;
    const campusAddr = lesson.address || this.getCampusAddress(lesson.room);
    const location = `${campusAddr}, ауд. ${lesson.room || ''}`;
    const title = `[бТИИ-262] ${lesson.subject} (${lesson.type})`;
    const details = `Пара: ${lesson.pair} (${lesson.time})\nПреподаватель: ${lesson.teacher || '—'}\nПодгруппа: ${lesson.subgroup === 0 ? 'Обе подгруппы' : lesson.subgroup + ' п/г'}\nАудитория: ${lesson.room || '—'}\nАдрес: ${campusAddr}`;

    let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

    if (!lesson.weeks || !Array.isArray(lesson.weeks) || lesson.weeks.length === 0) {
      const untilUtcStr = '20261227T205959Z';
      if (lesson.weekType === 'numerator' || lesson.weekType === 'denominator') {
        url += `&recur=${encodeURIComponent(`RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${untilUtcStr}`)}`;
      } else {
        url += `&recur=${encodeURIComponent(`RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=${untilUtcStr}`)}`;
      }
    }

    return url;
  },

  exportSemesterIcs() {
    if (!this.rawSchedule || !this.rawSchedule.days) {
      if (window.App) App.showToast('Расписание еще не загружено', 'error');
      return;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const formatIcsUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

    // Semester start: Monday 31 Aug 2026 (Week 1)
    // Semester end: Sunday 27 Dec 2026 (17 academic weeks)
    const semesterStartMonday = new Date(2026, 7, 31);
    const untilUtcStr = '20261227T205959Z';

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BTII262//Schedule Calendar//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:Расписание бТИИ-262 (${this.selectedSubgroup} п/г)`,
      'X-WR-TIMEZONE:Europe/Moscow'
    ];

    let eventsCount = 0;

    this.rawSchedule.days.forEach(day => {
      const dayOffset = day.dayOfWeek - 1;

      day.lessons.forEach(lesson => {
        // Filter by subgroup
        if (lesson.subgroup !== 0 && lesson.subgroup !== this.selectedSubgroup) {
          return;
        }

        const slot = this.parseTimeSlot(lesson.time) || this.bellSlots.find(s => s.pair === lesson.pair) || { start: '08:00', end: '09:35' };
        const [startH, startM] = slot.start.split(':').map(Number);
        const [endH, endM] = slot.end.split(':').map(Number);

        const campusAddr = lesson.address || this.getCampusAddress(lesson.room);
        const loc = `${campusAddr}, ауд. ${lesson.room || ''}`;
        const summary = `[${lesson.type.replace('занятия', '').trim()}] ${lesson.subject}`;
        const desc = `Пара: ${lesson.pair} (${lesson.time})\\nПреподаватель: ${lesson.teacher || '—'}\\nПодгруппа: ${lesson.subgroup === 0 ? 'Обе подгруппы' : lesson.subgroup + ' п/г'}\\nАудитория: ${lesson.room || '—'}\\nАдрес: ${campusAddr}`;

        // Discrete specific weeks
        if (Array.isArray(lesson.weeks) && lesson.weeks.length > 0) {
          lesson.weeks.forEach(w => {
            const weekDate = new Date(semesterStartMonday);
            weekDate.setDate(semesterStartMonday.getDate() + (w - 1) * 7 + dayOffset);
            const dtStart = new Date(Date.UTC(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate(), startH - 3, startM, 0));
            const dtEnd = new Date(Date.UTC(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate(), endH - 3, endM, 0));
            const uid = `${lesson.id}-w${w}-day${day.dayOfWeek}-2026@btii262`;

            lines.push('BEGIN:VEVENT');
            lines.push(`UID:${uid}`);
            lines.push(`DTSTAMP:${formatIcsUtc(new Date())}`);
            lines.push(`DTSTART:${formatIcsUtc(dtStart)}`);
            lines.push(`DTEND:${formatIcsUtc(dtEnd)}`);
            lines.push(`SUMMARY:${this.escapeIcs(summary)}`);
            lines.push(`LOCATION:${this.escapeIcs(loc)}`);
            lines.push(`DESCRIPTION:${this.escapeIcs(desc)}`);
            lines.push('STATUS:CONFIRMED');
            lines.push('TRANSP:OPAQUE');
            lines.push('END:VEVENT');
            eventsCount++;
          });
        } else {
          let firstDate = new Date(semesterStartMonday);
          let rrule = '';

          if (lesson.weekType === 'denominator') {
            firstDate.setDate(semesterStartMonday.getDate() + 7 + dayOffset);
            rrule = `RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${untilUtcStr}`;
          } else if (lesson.weekType === 'numerator') {
            firstDate.setDate(semesterStartMonday.getDate() + dayOffset);
            rrule = `RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${untilUtcStr}`;
          } else {
            firstDate.setDate(semesterStartMonday.getDate() + dayOffset);
            rrule = `RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=${untilUtcStr}`;
          }

          const dtStart = new Date(Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate(), startH - 3, startM, 0));
          const dtEnd = new Date(Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate(), endH - 3, endM, 0));
          const uid = `${lesson.id}-day${day.dayOfWeek}-2026@btii262`;

          lines.push('BEGIN:VEVENT');
          lines.push(`UID:${uid}`);
          lines.push(`DTSTAMP:${formatIcsUtc(new Date())}`);
          lines.push(`DTSTART:${formatIcsUtc(dtStart)}`);
          lines.push(`DTEND:${formatIcsUtc(dtEnd)}`);
          if (rrule) {
            lines.push(rrule);
          }
          lines.push(`SUMMARY:${this.escapeIcs(summary)}`);
          lines.push(`LOCATION:${this.escapeIcs(loc)}`);
          lines.push(`DESCRIPTION:${this.escapeIcs(desc)}`);
          lines.push('STATUS:CONFIRMED');
          lines.push('TRANSP:OPAQUE');
          lines.push('END:VEVENT');
          eventsCount++;
        }
      });
    });

    lines.push('END:VCALENDAR');

    const icsContent = lines.join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `raspisanie_btii262_subgroup_${this.selectedSubgroup}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (window.App) {
      App.showToast(`Экспортировано ${eventsCount} пар в файл .ics для ${this.selectedSubgroup} подгруппы!`, 'success');
    }
  },

  getWeekDates(refDate = new Date()) {
    const cur = new Date(refDate);
    const day = cur.getDay(); // 0 is Sun, 1 is Mon...
    const distanceToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(cur);
    monday.setDate(cur.getDate() + distanceToMonday);
    monday.setHours(0, 0, 0, 0);

    const dates = {};
    for (let i = 1; i <= 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + (i - 1));
      dates[i] = d;
    }
    return dates;
  },

  formatFullDate(dateObj) {
    if (!dateObj) return '';
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${dateObj.getDate()} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
  },

  updateDayChipDates() {
    const now = new Date();
    const weekDates = this.getWeekDates(now);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    const todaySub = document.getElementById('chip-date-today');
    if (todaySub) {
      todaySub.textContent = `${now.getDate()} ${months[now.getMonth()]}`;
    }

    for (let i = 1; i <= 6; i++) {
      const chipSub = document.getElementById(`chip-date-${i}`);
      if (chipSub && weekDates[i]) {
        chipSub.textContent = `${weekDates[i].getDate()} ${months[weekDates[i].getMonth()]}`;
      }
    }

    const datePicker = document.getElementById('dayDatePicker');
    if (datePicker && !datePicker.value) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      datePicker.value = `${y}-${m}-${d}`;
    }
  },

  async loadSchedule(isBackground = false) {
    if (window.App && !isBackground) {
      if (!this.rawSchedule) {
        App.updateSyncStatus('syncing', 'Загрузка с сервера...');
      } else {
        App.updateSyncStatus('syncing', 'Синхронизация...');
      }
    }

    try {
      const res = await fetch('/api/schedule');
      if (res.ok) {
        const data = await res.json();
        this.rawSchedule = data;
        localStorage.setItem('btii_schedule_cache', JSON.stringify(data));
        this.render();
        this.updateLiveStatus();
        this.updateHeroWidget();
        if (window.App) App.updateSyncStatus('online', 'Данные актуальны');
      } else {
        if (this.rawSchedule && window.App) {
          App.updateSyncStatus('offline', 'Офлайн-режим (из кеша)');
        }
      }
    } catch (e) {
      console.warn('Network error loading schedule', e);
      if (this.rawSchedule && window.App) {
        App.updateSyncStatus('offline', 'Офлайн-режим (из кеша)');
      } else if (window.App) {
        App.updateSyncStatus('offline', 'Ошибка сети (офлайн)');
      }
    }
  },

  setSubgroup(sg) {
    this.selectedSubgroup = parseInt(sg, 10) || 1;
    localStorage.setItem('btii_subgroup', String(this.selectedSubgroup));

    // Update quick buttons (only 1 and 2)
    document.querySelectorAll('.subgroup-pill-btn').forEach(btn => {
      const bSg = parseInt(btn.dataset.subgroup, 10);
      btn.classList.toggle('active', bSg === this.selectedSubgroup);
    });

    this.render();
    this.updateLiveStatus();
    this.updateHeroWidget();
  },

  setDay(day) {
    this.selectedDay = day;
    document.querySelectorAll('.day-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.day == day);
    });

    // If day is 1..6, sync datePicker to that day's date
    if (day !== 'today' && day !== 'all') {
      const dayNum = parseInt(day, 10);
      const weekDates = this.getWeekDates(new Date());
      const targetDate = weekDates[dayNum];
      const datePicker = document.getElementById('dayDatePicker');
      if (targetDate && datePicker) {
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const d = String(targetDate.getDate()).padStart(2, '0');
        datePicker.value = `${y}-${m}-${d}`;
      }
    } else if (day === 'today') {
      const now = new Date();
      const datePicker = document.getElementById('dayDatePicker');
      if (datePicker) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        datePicker.value = `${y}-${m}-${d}`;
      }
    }

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

    // Date picker input
    const datePicker = document.getElementById('dayDatePicker');
    datePicker?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const parts = e.target.value.split('-').map(Number);
      const chosen = new Date(parts[0], parts[1] - 1, parts[2]);
      let dayOfWeek = chosen.getDay();
      if (dayOfWeek === 0) dayOfWeek = 7;
      if (dayOfWeek <= 6) {
        this.setDay(dayOfWeek);
      } else {
        this.setDay('all');
      }
    });

    // Search input
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
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

    // Subject template select
    const subjectSelect = document.getElementById('subjectTemplateSelect');
    subjectSelect?.addEventListener('change', (e) => {
      if (e.target.value) {
        const subInput = document.getElementById('editLessonSubject');
        if (subInput) subInput.value = e.target.value;
      }
    });

    // Subject template chips
    document.querySelectorAll('#subjectChipsRow .template-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.val;
        const subInput = document.getElementById('editLessonSubject');
        if (subInput && val) {
          subInput.value = val;
          if (subjectSelect) subjectSelect.value = val;
        }
      });
    });

    // Address template select
    const addressSelect = document.getElementById('addressTemplateSelect');
    addressSelect?.addEventListener('change', (e) => {
      if (e.target.value) {
        const addrInput = document.getElementById('editLessonAddress');
        if (addrInput) addrInput.value = e.target.value;
      }
    });

    // Address template chips
    document.querySelectorAll('#addressChipsRow .template-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.val;
        const addrInput = document.getElementById('editLessonAddress');
        if (addrInput && val) {
          addrInput.value = val;
          if (addressSelect) addressSelect.value = val;
        }
      });
    });

    // Auto-update address when room input changes in modal
    const roomInput = document.getElementById('editLessonRoom');
    roomInput?.addEventListener('input', (e) => {
      const addressInput = document.getElementById('editLessonAddress');
      if (addressInput && !addressInput.dataset.manuallyEdited) {
        const autoAddr = this.getCampusAddress(e.target.value);
        addressInput.value = autoAddr;
        if (addressSelect) addressSelect.value = autoAddr;
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

    // Export Semester Calendar .ics button
    document.getElementById('exportIcsBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.exportSemesterIcs();
    });

    // Event delegation on scheduleGrid for 100% reliable clicks
    const grid = document.getElementById('scheduleGrid');
    grid?.addEventListener('click', (e) => {
      const gcalBtn = e.target.closest('.btn-gcal');
      if (gcalBtn) {
        e.preventDefault();
        e.stopPropagation();
        const lessonId = gcalBtn.dataset.lessonId;
        const day = parseInt(gcalBtn.dataset.day, 10) || 1;
        const lesson = this.findLessonById(lessonId);
        if (lesson) {
          const url = this.getGoogleCalendarUrl(lesson, day);
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

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

      const cancelBtn = e.target.closest('.btn-cancel-lesson');
      if (cancelBtn) {
        e.preventDefault();
        e.stopPropagation();
        const lessonId = cancelBtn.dataset.lessonId;
        const isCurrentlyCancelled = cancelBtn.dataset.cancelled === '1';
        const currentWeek = this.getCurrentAcademicWeek();
        const doToggle = () => this.toggleCancelLesson(lessonId, currentWeek, !isCurrentlyCancelled);
        if (window.AdminAuth) {
          AdminAuth.prompt(doToggle);
        } else {
          doToggle();
        }
        return;
      }
    });
  },

  getCurrentAcademicWeek() {
    // 31 Aug 2026 is Monday of the 1st academic week (semester start)
    const semesterStart = new Date(2026, 7, 31);
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
    const weekBadgeElem = document.getElementById('currentWeekBadgeText');
    if (!this.rawSchedule) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = this.getCurrentDayOfWeek();
    const currentWeek = this.getCurrentAcademicWeek();
    const isNum = currentWeek % 2 !== 0;
    const weekName = isNum ? 'Числитель (нечетная)' : 'Знаменатель (четная)';

    // Update current week indicator badge
    if (weekBadgeElem) {
      weekBadgeElem.textContent = `Неделя ${currentWeek} • ${isNum ? 'Числитель' : 'Знаменатель'}`;
    }

    if (!liveText) return;

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
      const isCancelled = ongoing.lesson.cancelledWeeks && ongoing.lesson.cancelledWeeks.includes(currentWeek);
      const cancelNotice = isCancelled ? ' <span style="color:#ef4444;font-weight:700;">(ПАРА ОТМЕНЕНА)</span>' : '';
      const addr = ongoing.lesson.address || this.getCampusAddress(ongoing.lesson.room);
      liveText.innerHTML = `${weekBadgeHtml} <span class="status-time">Идет ${ongoing.lesson.pair} пара (${ongoing.lesson.time}):</span> <strong>${ongoing.lesson.subject}</strong>${cancelNotice} [ауд. ${ongoing.lesson.room} • ${addr}]`;
    } else if (upcoming) {
      const isCancelled = upcoming.lesson.cancelledWeeks && upcoming.lesson.cancelledWeeks.includes(currentWeek);
      const cancelNotice = isCancelled ? ' <span style="color:#ef4444;font-weight:700;">(ОТМЕНЕНА)</span>' : '';
      const startTime = upcoming.slot.start || upcoming.lesson.time.split('-')[0].trim();
      liveText.innerHTML = `${weekBadgeHtml} След. пара в <strong>${startTime}</strong> (через ${upcomingDiff} мин): <strong>${upcoming.lesson.subject}</strong>${cancelNotice} [ауд. ${upcoming.lesson.room}]`;
    } else {
      liveText.innerHTML = `${weekBadgeHtml} Занятия на сегодня окончены`;
    }
  },

  updateHeroWidget() {
    const widget = document.getElementById('heroCurrentWidget');
    if (!widget || !this.rawSchedule || !this.rawSchedule.days) return;

    const statusPill = document.getElementById('heroStatusPill');
    const statusLabel = document.getElementById('heroStatusLabel');
    const countdownPill = document.getElementById('heroCountdownPill');
    const countdownText = document.getElementById('heroCountdownText');
    const pairBadge = document.getElementById('heroPairBadge');
    const typeBadge = document.getElementById('heroTypeBadge');
    const subgroupBadge = document.getElementById('heroSubgroupBadge');
    const campusBadge = document.getElementById('heroCampusBadge');
    const subjectTitle = document.getElementById('heroSubjectTitle');
    const teacherName = document.getElementById('heroTeacherName');
    const roomBadge = document.getElementById('heroRoomBadge');
    const campusText = document.getElementById('heroCampusText');
    const progressBar = document.getElementById('heroProgressBar');

    if (!subjectTitle || !statusLabel) return;

    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = this.getCurrentDayOfWeek();
    const currentAcademicWeek = this.getCurrentAcademicWeek();
    const isNum = currentAcademicWeek % 2 !== 0;

    if (subgroupBadge) {
      subgroupBadge.textContent = `${this.selectedSubgroup} подгруппа`;
    }

    // Weekend (Sunday)
    if (dayOfWeek > 6) {
      if (statusPill) statusPill.className = 'hero-status-pill free';
      statusLabel.textContent = 'Выходной день';
      if (countdownText) countdownText.textContent = 'Воскресенье 🎉';
      subjectTitle.textContent = 'Занятий сегодня нет — приятного отдыха!';
      if (pairBadge) pairBadge.style.display = 'none';
      if (typeBadge) typeBadge.style.display = 'none';
      if (campusBadge) campusBadge.style.display = 'none';
      if (teacherName) teacherName.textContent = 'Подготовка к новой неделе';
      if (roomBadge) roomBadge.textContent = '—';
      if (campusText) campusText.textContent = 'Корпуса закрыты';
      if (progressBar) progressBar.style.width = '0%';
      return;
    }

    const currentDayData = this.rawSchedule.days.find(d => d.dayOfWeek === dayOfWeek);
    if (!currentDayData || !currentDayData.lessons || !currentDayData.lessons.length) {
      if (statusPill) statusPill.className = 'hero-status-pill free';
      statusLabel.textContent = 'Свободный день';
      if (countdownText) countdownText.textContent = 'Пар нет';
      subjectTitle.textContent = 'Сегодня нет занятий в расписании';
      if (pairBadge) pairBadge.style.display = 'none';
      if (typeBadge) typeBadge.style.display = 'none';
      if (campusBadge) campusBadge.style.display = 'none';
      if (teacherName) teacherName.textContent = 'Свободный от пар день';
      if (roomBadge) roomBadge.textContent = '—';
      if (campusText) campusText.textContent = '—';
      if (progressBar) progressBar.style.width = '0%';
      return;
    }

    // Filter today's lessons for selected subgroup and week parity
    const todayLessons = currentDayData.lessons.filter(l => {
      if (l.subgroup !== 0 && l.subgroup !== this.selectedSubgroup) return false;
      if (isNum && l.weekType === 'denominator') return false;
      if (!isNum && l.weekType === 'numerator') return false;
      if (Array.isArray(l.weeks) && l.weeks.length > 0) {
        if (!l.weeks.includes(currentAcademicWeek)) return false;
      }
      return true;
    });

    if (todayLessons.length === 0) {
      if (statusPill) statusPill.className = 'hero-status-pill free';
      statusLabel.textContent = 'Пар нет';
      if (countdownText) countdownText.textContent = 'Свободно';
      subjectTitle.textContent = `Сегодня у ${this.selectedSubgroup} подгруппы нет пар`;
      if (pairBadge) pairBadge.style.display = 'none';
      if (typeBadge) typeBadge.style.display = 'none';
      if (campusBadge) campusBadge.style.display = 'none';
      if (teacherName) teacherName.textContent = 'Свободный день по расписанию';
      if (roomBadge) roomBadge.textContent = '—';
      if (campusText) campusText.textContent = '—';
      if (progressBar) progressBar.style.width = '0%';
      return;
    }

    let ongoing = null;
    let upcoming = null;
    let upcomingDiff = Infinity;

    for (const l of todayLessons) {
      const slot = this.parseTimeSlot(l.time) || this.bellSlots.find(s => s.pair === l.pair);
      if (slot) {
        if (currentMin >= slot.sMin && currentMin <= slot.eMin) {
          ongoing = { lesson: l, slot };
          break;
        } else if (currentMin < slot.sMin) {
          const diff = slot.sMin - currentMin;
          if (diff < upcomingDiff) {
            upcomingDiff = diff;
            upcoming = { lesson: l, slot };
          }
        }
      }
    }

    if (pairBadge) pairBadge.style.display = 'inline-block';
    if (typeBadge) typeBadge.style.display = 'inline-block';
    if (campusBadge) campusBadge.style.display = 'inline-block';

    if (ongoing) {
      const l = ongoing.lesson;
      const slot = ongoing.slot;
      const isCancelled = l.cancelledWeeks && l.cancelledWeeks.includes(currentAcademicWeek);
      const remainingMin = Math.max(1, slot.eMin - currentMin);
      const totalDuration = Math.max(1, slot.eMin - slot.sMin);
      const elapsed = Math.max(0, currentMin - slot.sMin);
      const progressPercent = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));

      if (statusPill) {
        statusPill.className = isCancelled ? 'hero-status-pill free' : 'hero-status-pill';
      }
      statusLabel.textContent = isCancelled ? 'ПАРА ОТМЕНЕНА' : 'ИДЁТ ПАРА';
      if (countdownText) {
        countdownText.textContent = isCancelled ? 'Отменена' : `Осталось ${remainingMin} мин`;
      }

      if (pairBadge) pairBadge.textContent = `${l.pair} пара (${l.time})`;
      if (typeBadge) {
        typeBadge.textContent = l.type;
        typeBadge.className = `badge ${this.getBadgeTypeClass(l.type)}`;
      }

      const campusCode = this.getCampusCode(l.room);
      if (campusBadge) {
        campusBadge.textContent = campusCode;
        campusBadge.className = `badge badge-campus ${this.getCampusBadgeClass(l.room)}`;
      }

      subjectTitle.textContent = l.subject;
      if (teacherName) teacherName.textContent = l.teacher || 'Преподаватель не указан';
      if (roomBadge) roomBadge.textContent = `Ауд. ${l.room || '—'}`;
      if (campusText) campusText.textContent = l.address || this.getCampusAddress(l.room);

      if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
      }
    } else if (upcoming) {
      const l = upcoming.lesson;
      const slot = upcoming.slot;
      const isCancelled = l.cancelledWeeks && l.cancelledWeeks.includes(currentAcademicWeek);

      if (statusPill) {
        statusPill.className = 'hero-status-pill break';
      }
      statusLabel.textContent = currentMin >= 480 ? 'ПЕРЕМЕНА' : 'СКОРО НАЧАЛО';
      if (countdownText) {
        countdownText.textContent = isCancelled ? 'Отменена' : `Через ${upcomingDiff} мин (${slot.start})`;
      }

      if (pairBadge) pairBadge.textContent = `След: ${l.pair} пара (${l.time})`;
      if (typeBadge) {
        typeBadge.textContent = l.type;
        typeBadge.className = `badge ${this.getBadgeTypeClass(l.type)}`;
      }

      const campusCode = this.getCampusCode(l.room);
      if (campusBadge) {
        campusBadge.textContent = campusCode;
        campusBadge.className = `badge badge-campus ${this.getCampusBadgeClass(l.room)}`;
      }

      subjectTitle.textContent = l.subject;
      if (teacherName) teacherName.textContent = l.teacher || 'Преподаватель не указан';
      if (roomBadge) roomBadge.textContent = `Ауд. ${l.room || '—'}`;
      if (campusText) campusText.textContent = l.address || this.getCampusAddress(l.room);

      if (progressBar) {
        let breakTotal = 15;
        let elapsed = 0;
        if (currentMin < slot.sMin) {
          let prevEnd = 0;
          for (const prevL of todayLessons) {
            const pSlot = this.parseTimeSlot(prevL.time) || this.bellSlots.find(s => s.pair === prevL.pair);
            if (pSlot && pSlot.eMin <= currentMin && pSlot.eMin > prevEnd) {
              prevEnd = pSlot.eMin;
            }
          }
          if (prevEnd > 0) {
            breakTotal = Math.max(5, slot.sMin - prevEnd);
            elapsed = Math.max(0, currentMin - prevEnd);
          } else {
            breakTotal = 60;
            elapsed = Math.max(0, 60 - upcomingDiff);
          }
        }
        const breakPct = Math.min(100, Math.max(0, Math.round((elapsed / breakTotal) * 100)));
        progressBar.style.width = `${breakPct}%`;
      }
    } else {
      if (statusPill) statusPill.className = 'hero-status-pill free';
      statusLabel.textContent = 'ЗАНЯТИЯ ОКОНЧЕНЫ';
      if (countdownText) countdownText.textContent = 'Отдыхаем ✨';
      subjectTitle.textContent = 'Все пары на сегодня закончились!';
      if (pairBadge) pairBadge.textContent = `${todayLessons.length} ${this.pluralizePairs(todayLessons.length)}`;
      if (typeBadge) {
        typeBadge.textContent = 'Завершено';
        typeBadge.className = 'badge badge-practice';
      }
      if (campusBadge) campusBadge.style.display = 'none';
      if (teacherName) teacherName.textContent = 'Отличного вечера и подготовки к занятиям!';
      if (roomBadge) roomBadge.textContent = 'До завтра';
      if (campusText) campusText.textContent = 'бТИИ-262';
      if (progressBar) progressBar.style.width = '100%';
    }
  },

  startLiveStatusTimer() {
    this.updateLiveStatus();
    this.updateHeroWidget();
    setInterval(() => {
      this.updateLiveStatus();
      this.updateHeroWidget();
    }, 15000);
  },

  render() {
    const container = document.getElementById('scheduleGrid');
    if (!container || !this.rawSchedule) return;

    this.updateDayChipDates();

    container.innerHTML = '';
    this.updateHeroWidget();

    const currentDayOfWeek = this.getCurrentDayOfWeek();
    const currentAcademicWeek = this.getCurrentAcademicWeek();
    const isCurrentWeekNum = this.isCurrentWeekNumerator();

    // Update current week indicator
    const weekBadgeElem = document.getElementById('currentWeekBadgeText');
    if (weekBadgeElem) {
      weekBadgeElem.textContent = `Неделя ${currentAcademicWeek} • ${isCurrentWeekNum ? 'Числитель' : 'Знаменатель'}`;
    }

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
    const weekDates = this.getWeekDates(new Date());

    daysToRender.forEach(day => {
      const filteredLessons = day.lessons.filter(lesson => {
        // 1. SUBGROUP FILTER: show only current subgroup (1 or 2) and general lessons (0)
        if (lesson.subgroup !== 0 && lesson.subgroup !== this.selectedSubgroup) {
          return false;
        }

        // 2. AUTOMATIC CURRENT WEEK FILTER: only show lessons for the active week parity
        if (isCurrentWeekNum && lesson.weekType === 'denominator') return false;
        if (!isCurrentWeekNum && lesson.weekType === 'numerator') return false;

        // Specific numbered weeks filter (if specified on lesson)
        if (Array.isArray(lesson.weeks) && lesson.weeks.length > 0) {
          if (!lesson.weeks.includes(currentAcademicWeek)) {
            return false;
          }
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
      const dayDate = weekDates[day.dayOfWeek];
      const dayDateFormatted = dayDate ? this.formatFullDate(dayDate) : '';

      const dayHeader = document.createElement('div');
      dayHeader.className = 'day-header';
      dayHeader.innerHTML = `
        <h3 class="day-title">
          <span class="day-name">${day.name}</span>
          ${dayDateFormatted ? `<span class="day-date-badge">${dayDateFormatted}</span>` : ''}
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
    const currentWeek = this.getCurrentAcademicWeek();
    const isCancelled = Boolean(lesson.cancelledWeeks && lesson.cancelledWeeks.includes(currentWeek));

    const card = document.createElement('div');
    const typeClassBorder = this.getCardTypeClass(lesson.type);
    card.className = `lesson-card ${typeClassBorder} ${lesson.weekType === 'denominator' ? 'denominator-card' : ''} ${isCancelled ? 'cancelled-card' : ''}`;
    card.dataset.lessonId = lesson.id;
    card.dataset.day = dayOfWeek;

    // Check if currently active pair
    if (isToday && !isCancelled) {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const slot = this.parseTimeSlot(lesson.time) || this.bellSlots.find(s => s.pair === lesson.pair);
      if (slot && currentMin >= slot.sMin && currentMin <= slot.eMin) {
        card.classList.add('current-lesson');
      }
    }

    // Cancellation banner at top
    const cancelBanner = isCancelled ? `
      <div class="cancelled-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
        <span>ПАРА ОТМЕНЕНА (на этой неделе)</span>
      </div>
    ` : '';

    // Badge styling for lesson type
    let typeClass = this.getBadgeTypeClass(lesson.type);

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

    // Campus address & code
    const campusAddress = lesson.address || this.getCampusAddress(lesson.room);
    const campusCode = this.getCampusCode(lesson.room);
    const campusBadgeClass = this.getCampusBadgeClass(lesson.room);
    const campusBadgeHtml = `<span class="badge badge-campus ${campusBadgeClass}" title="${this.escapeHtml(campusAddress)}">${this.escapeHtml(campusCode)}</span>`;

    // User note preview (both local and synced)
    let existingNote = '';
    if (window.Tasks) {
      existingNote = Tasks.getNote(lesson.id) || '';
    }

    card.innerHTML = `
      ${cancelBanner}
      <div class="lesson-top">
        <div class="time-slot">
          <span class="pair-number">${lesson.pair}</span>
          <span class="pair-time">${this.escapeHtml(lesson.time)}</span>
        </div>
        <div class="badges-group">
          ${parityBadge}
          ${weeksBadge}
          ${subgroupBadge}
          ${campusBadgeHtml}
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
        <div class="lesson-card-actions">
          <button class="btn btn-card-action btn-add-hw" data-subject="${this.escapeHtml(lesson.subject)}">
            + ДЗ
          </button>
          <button class="btn btn-card-action btn-note" data-lesson-id="${lesson.id}" data-subject="${this.escapeHtml(lesson.subject)}" data-teacher="${this.escapeHtml(lesson.teacher || '')}">
            Заметка
          </button>
          <button class="btn btn-card-action btn-gcal" data-lesson-id="${lesson.id}" data-day="${dayOfWeek}" title="Добавить эту пару в Google Календарь">
            📅 В Google
          </button>
          <button class="btn btn-card-action btn-edit-lesson" data-lesson-id="${lesson.id}" data-day="${dayOfWeek}" title="Редактировать пару (аудитория, предмет, преподаватель, адрес)">
            ✏️ Изменить
          </button>
          <button class="btn btn-card-action btn-cancel-lesson ${isCancelled ? 'btn-is-cancelled' : ''}" data-lesson-id="${lesson.id}" data-cancelled="${isCancelled ? '1' : '0'}" title="${isCancelled ? 'Восстановить пару на этой неделе' : 'Отменить пару на этой неделе'}">
            ${isCancelled ? '↩️ Восстановить' : '🚫 Отменить'}
          </button>
        </div>
      </div>
    `;

    return card;
  },

  findLessonById(lessonId) {
    if (!this.rawSchedule) return null;
    for (const day of this.rawSchedule.days) {
      const found = day.lessons.find(l => l.id === lessonId);
      if (found) return found;
    }
    return null;
  },

  async toggleCancelLesson(lessonId, week, cancelState) {
    try {
      const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
      const res = await fetch(`/api/schedule/lesson/${lessonId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ week, cancelled: cancelState })
      });
      const data = await res.json();
      if (res.ok) {
        App.showToast(cancelState ? `Пара отменена на текущей неделе (${week} нед.)` : `Пара восстановлена на текущей неделе (${week} нед.)`, 'success');
        await this.loadSchedule();
      } else {
        App.showToast(data.error || 'Ошибка изменения статуса пары', 'error');
        if (res.status === 403 && window.AdminAuth) {
          AdminAuth.prompt();
        }
      }
    } catch (e) {
      App.showToast('Сетевая ошибка при изменении статуса пары', 'error');
    }
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
    const subSel = document.getElementById('subjectTemplateSelect');
    if (subSel) subSel.value = '';

    document.getElementById('editLessonType').value = 'Лекционные занятия';
    document.getElementById('editLessonWeekType').value = 'all';
    document.getElementById('editLessonSubgroup').value = this.selectedSubgroup || 1;
    document.getElementById('editLessonTeacher').value = '';
    document.getElementById('editLessonRoom').value = '';

    document.getElementById('editLessonAddress').value = 'ул. 20-летия Октября, 84 (Главный корпус)';
    const addrSel = document.getElementById('addressTemplateSelect');
    if (addrSel) addrSel.value = 'ул. 20-летия Октября, 84 (Главный корпус)';

    document.getElementById('editLessonWeeks').value = '';

    const cancelGroup = document.getElementById('editLessonCancelGroup');
    if (cancelGroup) cancelGroup.style.display = 'none';

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
    const subSel = document.getElementById('subjectTemplateSelect');
    if (subSel) subSel.value = lesson.subject || '';

    document.getElementById('editLessonType').value = lesson.type || 'Лекционные занятия';
    document.getElementById('editLessonWeekType').value = lesson.weekType || 'all';
    document.getElementById('editLessonSubgroup').value = lesson.subgroup !== undefined ? lesson.subgroup : 1;
    document.getElementById('editLessonTeacher').value = lesson.teacher || '';
    document.getElementById('editLessonRoom').value = lesson.room || '';

    const addr = lesson.address || this.getCampusAddress(lesson.room);
    document.getElementById('editLessonAddress').value = addr;
    const addrSel = document.getElementById('addressTemplateSelect');
    if (addrSel) addrSel.value = addr;

    document.getElementById('editLessonWeeks').value = lesson.weeksDisplay || '';

    const currentWeek = this.getCurrentAcademicWeek();
    const isCancelledThisWeek = Boolean(lesson.cancelledWeeks && lesson.cancelledWeeks.includes(currentWeek));
    const cancelGroup = document.getElementById('editLessonCancelGroup');
    const cancelCheckbox = document.getElementById('editLessonCancelCheckbox');
    const cancelLabel = document.getElementById('editLessonCancelLabel');
    if (cancelGroup && cancelCheckbox) {
      cancelGroup.style.display = 'block';
      cancelCheckbox.checked = isCancelledThisWeek;
      if (cancelLabel) {
        cancelLabel.textContent = isCancelledThisWeek
          ? '↩️ Пара отменена на этой неделе (снимите галочку для восстановления)'
          : `🚫 Отменить пару на этой неделе (неделя ${currentWeek})`;
      }
    }

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

    const currentWeek = this.getCurrentAcademicWeek();
    const existing = lessonId ? this.findLessonById(lessonId) : null;
    let cancelledWeeks = (existing && existing.cancelledWeeks) ? [...existing.cancelledWeeks] : [];

    const cancelCheckbox = document.getElementById('editLessonCancelCheckbox');
    if (cancelCheckbox && lessonId) {
      const isChecked = cancelCheckbox.checked;
      const set = new Set(cancelledWeeks);
      if (isChecked) set.add(currentWeek);
      else set.delete(currentWeek);
      cancelledWeeks = Array.from(set);
    }

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
      weeksDisplay: weeksText || null,
      cancelledWeeks
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
