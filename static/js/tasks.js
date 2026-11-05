// ==========================================================================
// Tasks & Personal Notes Management Module (Hybrid Local & Cloud Mode)
// ==========================================================================

const Tasks = {
  tasksList: [],
  userNotes: {},
  localNotes: {},
  localCompletedTasks: {},
  currentNoteLessonId: null,

  initSync() {
    this.loadLocalStorageData();
    this.bindEvents();

    // 0 ms instant render from cached data
    const cachedTasks = localStorage.getItem('btii_tasks_cache');
    if (cachedTasks) {
      try {
        this.tasksList = JSON.parse(cachedTasks);
        this.renderTasks();
        this.updateBadge();
      } catch (e) {
        console.warn('Corrupt tasks cache', e);
      }
    }
  },

  async init() {
    this.initSync();
    await this.loadNotes();
    await this.loadTasks();
  },

  loadLocalStorageData() {
    try {
      this.localNotes = JSON.parse(localStorage.getItem('btii_personal_notes') || '{}');
      this.localCompletedTasks = JSON.parse(localStorage.getItem('btii_local_completed_tasks') || '{}');
    } catch (e) {
      this.localNotes = {};
      this.localCompletedTasks = {};
    }
  },

  isTaskCompleted(task) {
    if (!task) return false;
    if (Object.prototype.hasOwnProperty.call(this.localCompletedTasks, task.id)) {
      return Boolean(this.localCompletedTasks[task.id]);
    }
    return false;
  },

  getNote(lessonId) {
    if (!lessonId) return '';
    if (this.localNotes && this.localNotes[lessonId]) {
      return this.localNotes[lessonId];
    }
    if (this.userNotes && this.userNotes[lessonId]) {
      return this.userNotes[lessonId];
    }
    return '';
  },

  async loadTasks() {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const data = await res.json();
        this.tasksList = data.tasks || [];
        localStorage.setItem('btii_tasks_cache', JSON.stringify(this.tasksList));
        this.renderTasks();
        this.updateBadge();
      }
    } catch (e) {
      console.warn('Could not load tasks from network, using cache', e);
    }
  },

  async loadNotes() {
    // If user is logged in, fetch server notes
    if (window.Auth && Auth.currentUser) {
      try {
        const res = await fetch('/api/notes');
        if (res.ok) {
          const data = await res.json();
          this.userNotes = data.notes || {};
          // Sync server notes into local notes as baseline
          Object.assign(this.localNotes, this.userNotes);
          localStorage.setItem('btii_personal_notes', JSON.stringify(this.localNotes));
        }
      } catch (e) {
        console.warn('Could not load server notes, using local', e);
      }
    }

    if (window.Schedule && Schedule.rawSchedule) {
      Schedule.render();
    }
  },

  updateBadge() {
    const badge = document.getElementById('tasksCountBadge');
    const mobileBadge = document.getElementById('mobileTasksBadge');
    const activeTasksCount = this.tasksList.filter(t => !this.isTaskCompleted(t)).length;

    if (badge) {
      badge.textContent = activeTasksCount;
      badge.style.display = activeTasksCount > 0 ? 'inline-block' : 'none';
    }
    if (mobileBadge) {
      mobileBadge.textContent = activeTasksCount;
      mobileBadge.style.display = activeTasksCount > 0 ? 'inline-block' : 'none';
    }
  },

  renderTasks() {
    const container = document.getElementById('tasksListContainer');
    if (!container) return;

    container.innerHTML = '';

    if (this.tasksList.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem 1.5rem;">
          <div class="empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h3>Нет активных заданий</h3>
          <p>Все задачи выполнены или еще не добавлены. Добавить общее ДЗ группы может старостат по паролю редактора.</p>
        </div>
      `;
      return;
    }

    this.tasksList.forEach(task => {
      const isDone = this.isTaskCompleted(task);
      const card = document.createElement('div');
      card.className = `task-card ${isDone ? 'completed' : ''}`;
      card.dataset.taskId = task.id;

      let dueDateHtml = '';
      if (task.due_date) {
        dueDateHtml = `
          <div class="task-due">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Сдать до: ${task.due_date}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="task-top">
          <span class="task-subject">${this.escapeHtml(task.subject)}</span>
          <div class="task-actions">
            <button class="btn btn-icon btn-ghost btn-delete-task" title="Удалить задание (для старостата)" style="width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="task-body">
          <div class="task-checkbox" title="${isDone ? 'Снять отметку' : 'Отметить выполненным'}">
            <div class="task-checkbox-box">${isDone ? '✓' : ''}</div>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:0.4rem;">
            <p class="task-text">${this.escapeHtml(task.title)}</p>
            ${dueDateHtml}
          </div>
        </div>
      `;

      // Checkbox toggle event
      card.querySelector('.task-checkbox').addEventListener('click', () => {
        this.toggleTask(task.id, !isDone);
      });

      // Delete task event
      card.querySelector('.btn-delete-task').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteTask(task.id);
      });

      container.appendChild(card);
    });
  },

  async toggleTask(taskId, isCompleted) {
    // 1. Immediately toggle in localStorage for instant personal response (0 ms)
    this.localCompletedTasks[taskId] = isCompleted;
    localStorage.setItem('btii_local_completed_tasks', JSON.stringify(this.localCompletedTasks));

    this.renderTasks();
    this.updateBadge();
  },

  deleteTask(taskId) {
    if (window.AdminAuth) {
      AdminAuth.prompt(() => {
        this._doDeleteTask(taskId);
      });
    } else {
      this._doDeleteTask(taskId);
    }
  },

  async _doDeleteTask(taskId) {
    if (!confirm('Удалить это домашнее задание для всей группы?')) return;
    try {
      const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { ...authHeaders }
      });
      if (res.ok) {
        this.tasksList = this.tasksList.filter(t => t.id !== taskId);
        delete this.localCompletedTasks[taskId];
        localStorage.setItem('btii_local_completed_tasks', JSON.stringify(this.localCompletedTasks));
        localStorage.setItem('btii_tasks_cache', JSON.stringify(this.tasksList));
        this.renderTasks();
        this.updateBadge();
        App.showToast('Задание удалено', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        App.showToast(data.error || 'Ошибка при удалении задания', 'error');
        if (res.status === 403 && window.AdminAuth) {
          AdminAuth.prompt();
        }
      }
    } catch (e) {
      App.showToast('Ошибка сети при удалении задания', 'error');
    }
  },

  openAddTaskModal(subject = '') {
    if (window.AdminAuth) {
      AdminAuth.prompt(() => {
        this._showTaskModal(subject);
      });
    } else {
      this._showTaskModal(subject);
    }
  },

  _showTaskModal(subject = '') {
    const modal = document.getElementById('taskModal');
    const subjectSelect = document.getElementById('taskSubject');
    const titleInput = document.getElementById('taskTitle');
    const dueDateInput = document.getElementById('taskDueDate');

    titleInput.value = '';
    dueDateInput.value = '';

    if (subject) {
      let found = false;
      for (const opt of subjectSelect.options) {
        if (opt.value === subject || subject.includes(opt.value)) {
          subjectSelect.value = opt.value;
          found = true;
          break;
        }
      }
      if (!found) subjectSelect.value = 'Общее';
    }

    App.openModal(modal);
  },

  openNoteModal(lessonId, subject, teacher) {
    this.currentNoteLessonId = lessonId;
    const modal = document.getElementById('noteModal');
    const titleEl = document.getElementById('noteModalTitle');
    const infoEl = document.getElementById('noteLessonInfo');
    const textInput = document.getElementById('noteContentInput');
    const hintEl = document.getElementById('noteSyncHint');

    if (titleEl) titleEl.textContent = 'Личная заметка к занятию';
    if (infoEl) infoEl.textContent = `${subject} (${teacher || 'преподаватель не указан'})`;

    const existingNote = this.getNote(lessonId);
    if (textInput) textInput.value = existingNote;

    if (hintEl) {
      if (window.Auth && Auth.currentUser) {
        hintEl.innerHTML = '☁️ Заметка сохраняется в браузере и синхронизируется с вашим профилем';
      } else {
        hintEl.innerHTML = '💾 Заметка мгновенно сохраняется в браузере (доступна офлайн, вход не требуется)';
      }
    }

    App.openModal(modal);
    setTimeout(() => textInput?.focus(), 100);
  },

  bindEvents() {
    // Add task button in tasks tab
    document.getElementById('openAddTaskModalBtn')?.addEventListener('click', () => {
      this.openAddTaskModal();
    });

    // Submit task form
    document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subject = document.getElementById('taskSubject').value;
      const title = document.getElementById('taskTitle').value.trim();
      const dueDate = document.getElementById('taskDueDate').value;

      if (!title) return;

      try {
        const authHeaders = window.AdminAuth ? AdminAuth.getHeaders() : {};
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ subject, title, due_date: dueDate })
        });
        const data = await res.json();
        if (res.ok && data.task) {
          this.tasksList.unshift(data.task);
          localStorage.setItem('btii_tasks_cache', JSON.stringify(this.tasksList));
          this.renderTasks();
          this.updateBadge();
          App.closeModal(document.getElementById('taskModal'));
          App.showToast('Домашнее задание добавлено для группы!', 'success');
        } else {
          App.showToast(data.error || 'Ошибка при сохранении задания', 'error');
          if (res.status === 403 && window.AdminAuth) {
            AdminAuth.prompt();
          }
        }
      } catch (err) {
        App.showToast('Не удалось сохранить задание', 'error');
      }
    });

    // Save lesson note button
    document.getElementById('saveNoteBtn')?.addEventListener('click', async () => {
      if (!this.currentNoteLessonId) return;
      const lessonId = this.currentNoteLessonId;
      const content = (document.getElementById('noteContentInput')?.value || '').trim();

      // 1. Immediately save to localStorage (0 ms, works offline, works for guest students!)
      if (content) {
        this.localNotes[lessonId] = content;
      } else {
        delete this.localNotes[lessonId];
      }
      localStorage.setItem('btii_personal_notes', JSON.stringify(this.localNotes));

      // Update preview in DOM
      const previewEl = document.getElementById(`note-preview-${lessonId}`);
      if (previewEl) {
        previewEl.innerHTML = content
          ? `📝 ${this.escapeHtml(content)}`
          : '<span style="color:var(--text-muted);">Нет личных заметок</span>';
      }

      App.closeModal(document.getElementById('noteModal'));
      App.showToast('Заметка сохранена!', 'success');

      // 2. If authenticated, sync with server in background
      if (window.Auth && Auth.currentUser) {
        try {
          fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lesson_id: lessonId, content })
          }).then(res => {
            if (res.ok) {
              if (content) {
                this.userNotes[lessonId] = content;
              } else {
                delete this.userNotes[lessonId];
              }
            }
          }).catch(() => {});
        } catch (err) {
          // Ignore background sync errors
        }
      }
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
};

window.Tasks = Tasks;
