// ==========================================================================
// Tasks & Personal Notes Management Module
// ==========================================================================

const Tasks = {
  tasksList: [],
  userNotes: {},
  currentNoteLessonId: null,

  async init() {
    this.bindEvents();
    await this.loadNotes();
    await this.loadTasks();
  },

  async loadTasks() {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const data = await res.json();
        this.tasksList = data.tasks || [];
        this.renderTasks();
        this.updateBadge();
      }
    } catch (e) {
      console.warn('Could not load tasks', e);
    }
  },

  async loadNotes() {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        this.userNotes = data.notes || {};
        if (window.Schedule && Schedule.rawSchedule) {
          Schedule.render();
        }
      }
    } catch (e) {
      console.warn('Could not load notes', e);
    }
  },

  updateBadge() {
    const badge = document.getElementById('tasksCountBadge');
    if (!badge) return;
    const activeTasksCount = this.tasksList.filter(t => !t.is_completed).length;
    badge.textContent = activeTasksCount;
    badge.style.display = activeTasksCount > 0 ? 'inline-block' : 'none';
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
      const card = document.createElement('div');
      card.className = `task-card ${task.is_completed ? 'completed' : ''}`;
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
            <button class="btn btn-icon btn-ghost btn-delete-task" title="Удалить задание" style="width:28px; height:28px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="task-body">
          <div class="task-checkbox" title="${task.is_completed ? 'Снять отметку' : 'Отметить выполненным'}">
            ${task.is_completed ? '✓' : ''}
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:0.4rem;">
            <p class="task-text">${this.escapeHtml(task.title)}</p>
            ${dueDateHtml}
          </div>
        </div>
      `;

      // Checkbox toggle event
      card.querySelector('.task-checkbox').addEventListener('click', () => {
        this.toggleTask(task.id, !task.is_completed);
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
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: isCompleted ? 1 : 0 })
      });
      if (res.ok) {
        const item = this.tasksList.find(t => t.id === taskId);
        if (item) item.is_completed = isCompleted ? 1 : 0;
        this.renderTasks();
        this.updateBadge();
      }
    } catch (e) {
      console.error(e);
    }
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
      // Find matching option or set value
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
    if (!Auth.currentUser) {
      App.showToast('Авторизуйтесь, чтобы сохранять личные заметки', 'error');
      App.openModal(document.getElementById('authModal'));
      return;
    }

    this.currentNoteLessonId = lessonId;
    const modal = document.getElementById('noteModal');
    const titleEl = document.getElementById('noteModalTitle');
    const infoEl = document.getElementById('noteLessonInfo');
    const textInput = document.getElementById('noteContentInput');

    titleEl.textContent = `Заметка к паре`;
    infoEl.textContent = `${subject} (${teacher})`;
    textInput.value = this.userNotes[lessonId] || '';

    App.openModal(modal);
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
      const content = document.getElementById('noteContentInput').value.trim();

      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson_id: this.currentNoteLessonId, content })
        });
        if (res.ok) {
          if (content) {
            this.userNotes[this.currentNoteLessonId] = content;
          } else {
            delete this.userNotes[this.currentNoteLessonId];
          }

          // Update preview in DOM
          const previewEl = document.getElementById(`note-preview-${this.currentNoteLessonId}`);
          if (previewEl) {
            previewEl.innerHTML = content
              ? `📝 ${this.escapeHtml(content)}`
              : '<span style="color:var(--text-muted);">Нет личных заметок</span>';
          }

          App.closeModal(document.getElementById('noteModal'));
          App.showToast('Заметка сохранена!', 'success');
        } else {
          App.showToast('Ошибка сохранения заметки', 'error');
        }
      } catch (err) {
        App.showToast('Ошибка сохранения заметки', 'error');
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
