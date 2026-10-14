// ==========================================================================
// Authentication & User State Module
// ==========================================================================

const Auth = {
  currentUser: null,
  studentsList: [],

  async init() {
    this.bindEvents();
    await this.fetchStudents();
    await this.checkAuth();
  },

  async fetchStudents() {
    try {
      const res = await fetch('/api/students');
      if (res.ok) {
        const data = await res.json();
        this.studentsList = data.students || [];
        this.populateStudentPicker();
      }
    } catch (e) {
      console.warn('Could not fetch students list', e);
    }
  },

  populateStudentPicker() {
    const select = document.getElementById('studentSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Выберите ваше ФИО из списка --</option>';
    this.studentsList.forEach(student => {
      const opt = document.createElement('option');
      opt.value = student.id;
      opt.textContent = `${student.name} (${student.subgroup} п/г)`;
      opt.dataset.name = student.name;
      opt.dataset.subgroup = student.subgroup;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      const selected = select.options[select.selectedIndex];
      if (selected && selected.value) {
        const fullNameInput = document.getElementById('authFullName');
        const subgroupInput = document.getElementById('authSubgroup');
        const usernameInput = document.getElementById('authUsername');

        if (fullNameInput) fullNameInput.value = selected.dataset.name;
        if (subgroupInput) subgroupInput.value = selected.dataset.subgroup;

        // Auto-suggest username from transliterated or first name
        if (usernameInput && !usernameInput.value) {
          const parts = selected.dataset.name.split(' ');
          if (parts.length > 0) {
            usernameInput.value = parts[0].toLowerCase();
          }
        }
      }
    });
  },

  async checkAuth() {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data.authenticated && data.user) {
        this.currentUser = data.user;
        this.updateAuthUI();

        // Apply user's saved preferences
        if (this.currentUser.subgroup) {
          Schedule.setSubgroup(this.currentUser.subgroup);
        }
        if (this.currentUser.theme) {
          Theme.setTheme(this.currentUser.theme);
        }
      } else {
        this.currentUser = null;
        this.updateAuthUI();
      }
    } catch (err) {
      console.error('Check auth error', err);
      this.currentUser = null;
      this.updateAuthUI();
    }
  },

  updateAuthUI() {
    const authBtn = document.getElementById('authBtn');
    const authBtnText = document.getElementById('authBtnText');

    if (this.currentUser) {
      const shortName = this.currentUser.full_name
        ? this.currentUser.full_name.split(' ')[0]
        : this.currentUser.username;
      authBtnText.textContent = `${shortName} (${this.currentUser.subgroup || 1} п/г)`;
      authBtn.classList.add('logged-in');
    } else {
      authBtnText.textContent = 'Войти';
      authBtn.classList.remove('logged-in');
    }

    // Refresh tasks and notes when user state changes
    if (window.Tasks) {
      Tasks.loadTasks();
      Tasks.loadNotes();
    }
  },

  bindEvents() {
    const authBtn = document.getElementById('authBtn');
    const authModal = document.getElementById('authModal');
    const profileModal = document.getElementById('profileModal');
    const authTabLogin = document.getElementById('authTabLogin');
    const authTabRegister = document.getElementById('authTabRegister');
    const authForm = document.getElementById('authForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const saveProfileBtn = document.getElementById('saveProfileBtn');

    let isRegisterMode = false;

    authBtn?.addEventListener('click', () => {
      if (this.currentUser) {
        // Open profile modal
        document.getElementById('profileFullName').value = this.currentUser.full_name || '';
        document.getElementById('profileSubgroup').value = this.currentUser.subgroup || 1;
        document.getElementById('profileTheme').value = this.currentUser.theme || 'light';
        App.openModal(profileModal);
      } else {
        // Open login/register modal
        App.openModal(authModal);
      }
    });

    authTabLogin?.addEventListener('click', (e) => {
      e.preventDefault();
      isRegisterMode = false;
      authTabLogin.style.background = 'var(--bg-card)';
      authTabLogin.style.fontWeight = '600';
      authTabRegister.style.background = 'transparent';
      authTabRegister.style.fontWeight = 'normal';
      document.getElementById('authModalTitle').textContent = 'Вход в систему';
      document.getElementById('authSubmitBtn').textContent = 'Войти';
      document.getElementById('registerPickerGroup').style.display = 'none';
      document.getElementById('fullNameGroup').style.display = 'none';
      document.getElementById('subgroupSelectGroup').style.display = 'none';
      document.getElementById('authErrorMessage').style.display = 'none';
    });

    authTabRegister?.addEventListener('click', (e) => {
      e.preventDefault();
      isRegisterMode = true;
      authTabRegister.style.background = 'var(--bg-card)';
      authTabRegister.style.fontWeight = '600';
      authTabLogin.style.background = 'transparent';
      authTabLogin.style.fontWeight = 'normal';
      document.getElementById('authModalTitle').textContent = 'Регистрация студента';
      document.getElementById('authSubmitBtn').textContent = 'Зарегистрироваться';
      document.getElementById('registerPickerGroup').style.display = 'flex';
      document.getElementById('fullNameGroup').style.display = 'flex';
      document.getElementById('subgroupSelectGroup').style.display = 'flex';
      document.getElementById('authErrorMessage').style.display = 'none';
    });

    authForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('authErrorMessage');
      errBox.style.display = 'none';

      const username = document.getElementById('authUsername').value.trim();
      const password = document.getElementById('authPassword').value.trim();
      const fullName = document.getElementById('authFullName').value.trim();
      const subgroup = parseInt(document.getElementById('authSubgroup').value || '1', 10);

      const endpoint = isRegisterMode ? '/api/register' : '/api/login';
      const body = {
        username,
        password,
        full_name: fullName || username,
        subgroup,
        theme: Theme.currentTheme
      };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();

        if (!res.ok) {
          errBox.textContent = data.error || 'Произошла ошибка при аутентификации';
          errBox.style.display = 'block';
          return;
        }

        this.currentUser = data.user;
        this.updateAuthUI();
        App.closeModal(authModal);
        App.showToast(isRegisterMode ? 'Вы успешно зарегистрированы!' : 'С возвращением!', 'success');

        if (this.currentUser.subgroup) {
          Schedule.setSubgroup(this.currentUser.subgroup);
        }
      } catch (err) {
        errBox.textContent = 'Сетевая ошибка, повторите попытку';
        errBox.style.display = 'block';
      }
    });

    logoutBtn?.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
        this.currentUser = null;
        this.updateAuthUI();
        App.closeModal(profileModal);
        App.showToast('Вы вышли из учетной записи', 'success');
      } catch (err) {
        console.error(err);
      }
    });

    saveProfileBtn?.addEventListener('click', async () => {
      if (!this.currentUser) return;

      const fullName = document.getElementById('profileFullName').value.trim();
      const subgroup = parseInt(document.getElementById('profileSubgroup').value, 10);
      const theme = document.getElementById('profileTheme').value;

      try {
        const res = await fetch('/api/user/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: fullName, subgroup, theme })
        });
        const data = await res.json();
        if (res.ok && data.user) {
          this.currentUser = data.user;
          this.updateAuthUI();
          Schedule.setSubgroup(subgroup);
          Theme.setTheme(theme);
          App.closeModal(profileModal);
          App.showToast('Настройки профиля сохранены', 'success');
        }
      } catch (e) {
        App.showToast('Ошибка сохранения настроек', 'error');
      }
    });
  }
};

window.Auth = Auth;

