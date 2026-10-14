// ==========================================================================
// Main Application Controller & Theme Manager
// ==========================================================================

const Theme = {
  currentTheme: 'light',

  init() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    this.setTheme(savedTheme);

    const toggleBtn = document.getElementById('themeToggleBtn');
    toggleBtn?.addEventListener('click', () => {
      const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
      this.setTheme(nextTheme);
      // If user is authenticated, save theme preference to server
      if (window.Auth && Auth.currentUser) {
        fetch('/api/user/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: nextTheme })
        }).catch(() => {});
      }
    });
  },

  setTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    const sunIcon = document.getElementById('themeIconSun');
    const moonIcon = document.getElementById('themeIconMoon');

    if (sunIcon && moonIcon) {
      if (theme === 'dark') {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      }
    }
  }
};

const AdminAuth = {
  isUnlocked: false,
  password: '',
  pendingCallback: null,

  async init() {
    this.password = localStorage.getItem('btii_admin_password') || '';
    this.bindEvents();
    if (this.password) {
      await this.verifySavedPassword();
    } else {
      this.updateUI();
    }
  },

  async verifySavedPassword() {
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': this.password },
        body: JSON.stringify({ password: this.password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.isUnlocked = true;
      } else {
        this.isUnlocked = false;
        this.password = '';
        localStorage.removeItem('btii_admin_password');
      }
    } catch (e) {
      this.isUnlocked = Boolean(this.password);
    }
    this.updateUI();
  },

  getHeaders() {
    const headers = {};
    if (this.password) {
      headers['X-Admin-Password'] = this.password;
    }
    return headers;
  },

  updateUI() {
    const btn = document.getElementById('editorModeBtn');
    const btnText = document.getElementById('editorModeBtnText');
    if (!btn) return;

    if (this.isUnlocked) {
      btn.classList.add('active');
      btn.title = 'Режим редактора ВКЛЮЧЕН (нажмите, чтобы выйти)';
      if (btnText) btnText.textContent = 'Редактор: ВКЛ 🔓';
    } else {
      btn.classList.remove('active');
      btn.title = 'Режим редактирования расписания и ДЗ (нажмите для ввода пароля)';
      if (btnText) btnText.textContent = 'Редактор: 🔒';
    }
  },

  prompt(callbackOnSuccess) {
    if (this.isUnlocked) {
      if (typeof callbackOnSuccess === 'function') callbackOnSuccess();
      return;
    }

    this.pendingCallback = callbackOnSuccess;
    const modal = document.getElementById('adminAuthModal');
    const input = document.getElementById('adminPasswordInput');
    const errBox = document.getElementById('adminPasswordError');

    if (errBox) {
      errBox.style.display = 'none';
      errBox.textContent = '';
    }
    if (input) {
      input.value = '';
    }

    App.openModal(modal);
    setTimeout(() => input?.focus(), 120);
  },

  lock() {
    this.isUnlocked = false;
    this.password = '';
    localStorage.removeItem('btii_admin_password');
    this.updateUI();
    App.showToast('Режим редактора выключен 🔒', 'info');
  },

  bindEvents() {
    const btn = document.getElementById('editorModeBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.isUnlocked) {
          if (confirm('Выйти из режима редактора расписания и ДЗ?')) {
            this.lock();
          }
        } else {
          this.prompt();
        }
      });
    }

    const toggleVisBtn = document.getElementById('toggleAdminPasswordVisibility');
    const input = document.getElementById('adminPasswordInput');
    if (toggleVisBtn && input) {
      toggleVisBtn.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    }

    const form = document.getElementById('adminAuthForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('adminPasswordError');
        const pwd = (input?.value || '').trim();
        if (!pwd) return;

        try {
          const res = await fetch('/api/admin/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            this.isUnlocked = true;
            this.password = pwd;
            localStorage.setItem('btii_admin_password', pwd);
            this.updateUI();
            App.closeModal(document.getElementById('adminAuthModal'));
            App.showToast('Пароль принят! Режим редактора активирован 🔓', 'success');

            if (this.pendingCallback) {
              const cb = this.pendingCallback;
              this.pendingCallback = null;
              cb();
            }
          } else {
            if (errBox) {
              errBox.textContent = data.error || 'Неверный пароль редактора';
              errBox.style.display = 'block';
            }
          }
        } catch (err) {
          if (errBox) {
            errBox.textContent = 'Ошибка проверки пароля на сервере';
            errBox.style.display = 'block';
          }
        }
      });
    }
  }
};

const App = {
  async init() {
    Theme.init();
    this.initTabs();
    this.initModals();
    await AdminAuth.init();
    await Auth.init();
    await Schedule.init();
    await Tasks.init();
    this.renderStudentsDirectory();
  },

  initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;

        // Switch active tab button
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Switch visible tab panel
        document.querySelectorAll('.tab-content').forEach(content => {
          content.style.display = 'none';
          content.classList.remove('active');
        });

        const targetContent = document.getElementById(`tab-${targetId}`);
        if (targetContent) {
          targetContent.style.display = targetId === 'schedule' ? 'block' : 'block';
          targetContent.classList.add('active');
        }

        // If tasks tab is opened, refresh tasks
        if (targetId === 'tasks' && window.Tasks) {
          Tasks.loadTasks();
        }
      });
    });
  },

  renderStudentsDirectory() {
    const container = document.getElementById('studentsColumnsContainer');
    if (!container || !Auth.studentsList.length) return;

    container.innerHTML = '';

    const subgroupNums = [...new Set(Auth.studentsList.map(s => s.subgroup))].sort((a,b) => a - b);
    const subgroups = subgroupNums.map(num => ({
      num,
      title: `${num} подгруппа`
    }));

    subgroups.forEach(sg => {
      const students = Auth.studentsList.filter(s => s.subgroup === sg.num);
      sg.count = students.length;

      const col = document.createElement('div');
      col.className = 'subgroup-column';

      col.innerHTML = `
        <div class="subgroup-col-header">
          <h4 class="subgroup-col-title">
            <span class="pair-number" style="width:22px;height:22px;font-size:0.75rem;">${sg.num}</span>
            ${sg.title}
          </h4>
          <span class="brand-badge">${students.length} студентов</span>
        </div>
        <div class="subgroup-students-list">
          ${students.map((st, idx) => `
            <div class="student-item">
              <span class="student-index">${idx + 1}.</span>
              <span class="student-name">${this.escapeHtml(st.name)}</span>
              ${st.role ? `<span class="badge badge-lecture" style="font-size:0.7rem;">${st.role}</span>` : ''}
            </div>
          `).join('')}
        </div>
      `;

      container.appendChild(col);
    });
  },

  initModals() {
    // Close modal on click on overlay or close button
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('.closeModalBtn')) {
          this.closeModal(modal);
        }
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(modal => {
          this.closeModal(modal);
        });
      }
    });
  },

  openModal(modal) {
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  },

  closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
};

window.Theme = Theme;
window.AdminAuth = AdminAuth;
window.App = App;

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

