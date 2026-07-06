// ==================== ECO AUTH & RBAC — Phân quyền ====================
// Framework phân quyền theo VAI (role-based) cho Ricons MEP Workspace.
//
// Auth backend: Supabase Auth (email/password).
//   - Vai trò lưu trong user_metadata.role khi tạo user trên Supabase.
//   - Subcontractor cần thêm user_metadata.sub_id = mã thầu phụ.
//
// ⚠️ QUAN TRỌNG VỀ BẢO MẬT: đây là tầng phân quyền PHÍA CLIENT — chỉ để
// ẩn/hiện UI và chặn thao tác trên giao diện. BẮT BUỘC dựng đúng ma trận
// này bằng Row Level Security (RLS) ở Supabase. File này = "nguồn sự thật".
//
// CẤU TRÚC PHÂN QUYỀN (theo yêu cầu dự án):
//   NHÓM 1 — BAN CHỈ HUY (command): phân quyền chi tiết theo từng vai
//     pd        : Giám đốc dự án      (toàn quyền)
//     ch_truong : Chỉ huy trưởng      (toàn quyền)
//     ch_pho    : Chỉ huy phó         (gần toàn quyền)
//     qs        : Kỹ sư QS            (khối lượng / dự toán / VO / mua sắm)
//     bim       : Kỹ sư BIM/SHOP      (shop drawing / submittal)
//     qaqc      : Kỹ sư QAQC          (duyệt submittal)
//     field     : Kỹ sư hiện trường   (thi công / nhập-xuất kho / cập nhật KL)
//   NHÓM 2 — NHÀ THẦU PHỤ (subcontractor): 1 vai duy nhất, mỗi user gắn 1 thầu phụ,
//             dữ liệu mặc định bị giới hạn theo thầu phụ của mình (scope 'own').
//
// LOAD: sau eco-store.js & các module. (Gating chạy sau khi auth state sẵn sàng.)
// =======================================================================

(function (global) {
  'use strict';

  // ---------- 1. ĐỊNH NGHĨA VAI ----------
  const ECO_ROLES = {
    pd:           { label: 'Giám đốc dự án',    group: 'command',       super: true  },
    ch_truong:    { label: 'Chỉ huy trưởng',    group: 'command',       super: true  },
    ch_pho:       { label: 'Chỉ huy phó',       group: 'command',       super: false },
    qs:           { label: 'Kỹ sư QS',          group: 'command',       super: false },
    bim:          { label: 'Kỹ sư BIM/SHOP',    group: 'command',       super: false },
    qaqc:         { label: 'Kỹ sư QAQC',        group: 'command',       super: false },
    field:        { label: 'Kỹ sư hiện trường', group: 'command',       super: false },
    subcontractor:{ label: 'Nhà thầu phụ',      group: 'subcontractor', super: false },
  };

  // ---------- 2. TÀI NGUYÊN (module) & HÀNH ĐỘNG ----------
  const ECO_RESOURCES = [
    'schedule', 'boq', 'vo', 'suppliers', 'po', 'kho', 'materials',
    'submittals', 'subcontractors', 'users',
  ];
  const ECO_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];
 
  // Ánh xạ tab (UI) -> resource (để ẩn/hiện menu)
  const ECO_TAB_RESOURCE = {
    schedule:      'schedule',
    boq:           'boq',
    materials:     'materials',
    submittals:    'submittals',
    subcontractors:'subcontractors',
  };
 
  // ---------- 3. MA TRẬN QUYỀN (CHỈNH Ở ĐÂY) ----------
  const A_ALL   = ['view', 'create', 'edit', 'delete', 'approve'];
  const A_CRUD  = ['view', 'create', 'edit', 'delete'];
  const A_WRITE = ['view', 'create', 'edit'];
  const A_VIEW  = ['view'];
 
  const ECO_PERMISSIONS = {
    ch_pho: {
      schedule: ['view', 'create', 'approve'], boq: ['view', 'create', 'approve'], vo: ['view', 'create', 'approve'],
      suppliers: ['view', 'create'], po: ['view', 'create', 'approve'], kho: ['view', 'create'], materials: ['view', 'create'],
      submittals: ['view', 'create', 'approve'], subcontractors: ['view', 'create'], users: A_VIEW,
    },
    qs: {
      schedule: A_VIEW, boq: ['view', 'create'], vo: ['view', 'create'], suppliers: ['view', 'create'],
      po: ['view', 'create'], kho: A_VIEW, materials: ['view', 'create'], submittals: A_VIEW,
      subcontractors: A_VIEW,
    },
    bim: {
      schedule: A_VIEW, boq: A_VIEW, materials: A_VIEW,
      submittals: ['view', 'create'], subcontractors: A_VIEW,
    },
    qaqc: {
      schedule: A_VIEW, boq: A_VIEW, materials: A_VIEW, kho: A_VIEW,
      submittals: ['view', 'approve'], subcontractors: A_VIEW,
    },
    field: {
      schedule: A_VIEW, boq: ['view'], po: A_VIEW, kho: ['view', 'create'],
      materials: A_VIEW, submittals: ['view', 'create'],
      subcontractors: A_VIEW,
    },
    subcontractor: {
      schedule: A_VIEW, po: ['view', 'create'], kho: A_VIEW, materials: A_VIEW,
      submittals: ['view', 'create'], subcontractors: A_VIEW,
    },
  };
 
  // ---------- 4. PHẠM VI DỮ LIỆU (SCOPE) ----------
  const ECO_SCOPE = {
    subcontractor: {
      schedule: 'all',
      boq: 'own', po: 'own', kho: 'own', materials: 'all',
      submittals: 'own', subcontractors: 'own',
    },
  };

  let ECO_SCOPE_OVERRIDE = function (/* user, resource */) { return null; };

  const ECO_SCOPE_FIELDS = {
    subcontractors: 'id',
    po: 'subId',
  };

  // ---------- 5. PHIÊN ĐĂNG NHẬP (Tài khoản cơ sở dữ liệu / Cục bộ) ----------
  let _currentUser = null;

  function _showLoginScreen() {
    const screen = document.getElementById('eco-login-screen');
    const app    = document.querySelector('.app-layout');
    if (screen) screen.style.display = 'flex';
    if (app)    app.style.visibility = 'hidden';
  }

  function _hideLoginScreen() {
    const screen = document.getElementById('eco-login-screen');
    const app    = document.querySelector('.app-layout');
    if (screen) screen.style.display = 'none';
    if (app)    app.style.visibility = '';
  }

  const ECO_Session = {
    get user()   { return _currentUser; },
    get userId() { return _currentUser ? _currentUser.id : null; },

    async signIn(email, password) {
      const emailLower = String(email || '').trim().toLowerCase();
      const passClean = String(password || '').trim();

      let users = [];
      const sb = global.supabase;
      if (sb) {
        try {
          const { data, error } = await sb.from('users').select('*');
          if (!error && data) {
            const subIdMap = { 1: 'dat-phan', 2: 'dinh-an', 3: 'phan-nguyen', 4: 'han-viet', 5: 'thuan-thien' };
            users = data.map(u => ({
              id: u.id,
              email: u.email,
              password: u.password,
              name: u.name,
              role: u.role,
              subId: u.sub_id ? (subIdMap[u.sub_id] || u.sub_id) : null
            }));
          }
        } catch (e) {
          console.warn('[ECO_Session] Lỗi truy vấn bảng users, chuyển sang tài khoản quản trị mặc định.', e);
        }
      }

      if (users.length === 0) {
        users = [{ id: 1, email: 'admin', password: 'admin@ricons', name: 'Quản trị hệ thống', role: 'pd', subId: null }];
      }

      const user = users.find(u => 
        (String(u.email || '').trim().toLowerCase() === emailLower) &&
        (String(u.password || '').trim() === passClean)
      );

      if (!user) {
        throw new Error('Tài khoản hoặc mật khẩu không chính xác.');
      }

      _currentUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        subId: user.subId || null
      };

      localStorage.setItem('eco_logged_in_user', JSON.stringify(_currentUser));
      _hideLoginScreen();
      ECO_Auth.applyGates();
      return _currentUser;
    },

    async signOut() {
      _currentUser = null;
      localStorage.removeItem('eco_logged_in_user');
      _showLoginScreen();
    },

    async init() {
      try {
        const saved = localStorage.getItem('eco_logged_in_user');
        if (saved) {
          _currentUser = JSON.parse(saved);
          return true;
        }
      } catch (e) {
        console.error('[ECO_Session] Init error', e);
      }
      return false;
    },
  };

  // ---------- 6. ENGINE ----------
  const ECO_Auth = {
    user()     { return ECO_Session.user; },
    role()     { const u = this.user(); return (u && ECO_ROLES[u.role]) ? u.role : null; },
    roleInfo() { return ECO_ROLES[this.role()] || null; },

    isSuperAdmin() {
      if (!this.user()) return false;
      const r = this.roleInfo();
      return !!(r && r.super);
    },
    isSubcontractor() {
      const u = this.user();
      return !!(u && u.role === 'subcontractor');
    },

    can(action, resource) {
      if (!this.user()) return false;
      if (this.isSuperAdmin()) return true;
      const perms = ECO_PERMISSIONS[this.role()];
      if (!perms || !perms[resource]) return false;
      return perms[resource].indexOf(action) !== -1;
    },

    canView(resource) { return this.can('view', resource); },
    canViewTab(tabId) {
      const res = ECO_TAB_RESOURCE[tabId];
      return res ? this.canView(res) : true;
    },

    scopeOf(resource) {
      const ovr = ECO_SCOPE_OVERRIDE(this.user(), resource);
      if (ovr === 'all' || ovr === 'own') return ovr;
      if (this.isSuperAdmin()) return 'all';
      const byRole = ECO_SCOPE[this.role()];
      if (byRole && byRole[resource]) return byRole[resource];
      return 'all';
    },

    filter(resource, rows) {
      if (!Array.isArray(rows)) return rows;
      if (this.scopeOf(resource) === 'all') return rows;
      const field = ECO_SCOPE_FIELDS[resource];
      if (!field) {
        console.warn('[ECO_Auth] scope "own" nhưng resource "' + resource +
          '" chưa khai báo ECO_SCOPE_FIELDS — tạm trả toàn bộ.');
        return rows;
      }
      const mine = this.user().subId;
      return rows.filter((r) => {
        if (!r) return false;
        const val = r[field];
        if (typeof val === 'string' && val.includes(',')) {
          const ids = val.split(',').map(s => s.trim());
          return ids.includes(mine);
        }
        return val === mine;
      });
    },

    // ---------- GATING UI ----------
    applyGates() {
      if (!this.user()) return;

      // Sidebar: ẩn menu-item theo tab
      document.querySelectorAll('.menu-item[onclick*="switchTab("]').forEach((el) => {
        const m = /switchTab\('([^']+)'/.exec(el.getAttribute('onclick') || '');
        if (!m) return;
        const allowed = this.canViewTab(m[1]);
        const li = el.closest('li') || el;
        li.style.display = allowed ? '' : 'none';
      });

      // Phần tử gắn data-perm="resource:action" => ẩn/khóa nếu không có quyền
      document.querySelectorAll('[data-perm]').forEach((el) => {
        const [resource, action] = (el.getAttribute('data-perm') || '').split(':');
        if (!resource || !action) return;
        const ok = this.can(action, resource);
        if (el.hasAttribute('data-perm-disable')) {
          el.disabled = !ok;
          el.classList.toggle('is-disabled', !ok);
          el.style.opacity = ok ? '' : '0.45';
          el.style.pointerEvents = ok ? '' : 'none';
        } else {
          el.style.display = ok ? '' : 'none';
        }
      });

      // Tab đang mở mà mất quyền xem -> chuyển về tab đầu tiên còn quyền
      const active = document.querySelector('.tab-content.active');
      if (active && !this.canViewTab(active.id)) {
        const firstOk = Object.keys(ECO_TAB_RESOURCE).find((t) => this.canViewTab(t));
        const menu = firstOk && document.querySelector('.menu-item[onclick*="\'' + firstOk + '\'"]');
        if (menu && typeof global.switchTab === 'function') menu.click();
      }

      this._syncProfile();
    },

    _syncProfile() {
      const u = this.user();
      if (!u) return;
      let roleLabel = (ECO_ROLES[u.role] && ECO_ROLES[u.role].label) || u.role;
      if (u.id === 1 || String(u.email).toLowerCase() === 'admin') {
        roleLabel = 'Quản trị hệ thống';
      }
      const nameEl = document.getElementById('eco-profile-name');
      const roleEl = document.getElementById('eco-profile-role');
      const initEl = document.getElementById('eco-profile-initials');
      if (nameEl) { nameEl.textContent = u.name; nameEl.setAttribute('title', u.name); }
      if (roleEl) roleEl.textContent = roleLabel;

      const avatarContainer = document.getElementById('eco-profile-avatar-container');
      if (avatarContainer) {
        // Clear previous custom avatar image if any
        const existingImg = avatarContainer.querySelector('img');
        if (existingImg) existingImg.remove();
        
        // Find user details from store to check if they have avatar
        let storedUser = null;
        if (typeof ECO_Storage !== 'undefined') {
          storedUser = ECO_Storage.getUsers().find(x => String(x.id) === String(u.id));
        }
        
        if (storedUser && storedUser.avatar) {
          if (initEl) initEl.style.display = 'none';
          const img = document.createElement('img');
          img.src = storedUser.avatar;
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%; position: absolute; top:0; left:0; z-index: 1;';
          avatarContainer.appendChild(img);
        } else {
          if (initEl) {
            initEl.style.display = '';
            initEl.textContent = this._initials(u.name);
          }
        }
      } else if (initEl) {
        initEl.textContent = this._initials(u.name);
      }
    },

    editProfile() {
      const u = this.user();
      if (!u) return;

      const users = ECO_Storage.getUsers();
      const dbUser = users.find(x => String(x.id) === String(u.id));
      if (!dbUser) return;

      const initials = this._initials(dbUser.name);
      const avatarHtml = dbUser.avatar 
        ? `<img id="profile-modal-avatar-preview" src="${dbUser.avatar}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover;" />`
        : `<div id="profile-modal-avatar-initials" style="width: 80px; height: 80px; border-radius: 50%; background: rgba(0,86,255,0.08); color: #0056FF; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.8rem;">${initials}</div>`;

      const escapeHTML = (str) => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

      ECO_UI.openModal('Thông tin cá nhân', `
        <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 20px;">
          <div style="position: relative; cursor: pointer;" onclick="document.getElementById('profile-avatar-upload').click()" title="Thay đổi ảnh đại diện">
            <div style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid rgba(0,86,255,0.2); overflow: hidden; display: flex; align-items: center; justify-content: center; background: #fff;">
              ${avatarHtml}
            </div>
            <div style="position: absolute; bottom: 0; right: 0; background: #0056FF; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.15); z-index: 10;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            </div>
          </div>
          <input type="file" id="profile-avatar-upload" accept="image/*" style="display: none;" onchange="ECO_Auth._handleAvatarUpload(event)">
          <span style="font-size: 0.78rem; color: #64748B; margin-top: 8px; font-weight: 550;">Nhấp vào ảnh để thay đổi</span>
        </div>
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label style="font-weight: 600; color: #475569; margin-bottom: 6px; display: block;">Tên đăng nhập</label>
            <input class="eco-input" value="${escapeHTML(dbUser.email)}" disabled style="background: #f1f5f9; color: #64748B; cursor: not-allowed;">
          </div>
          <div class="eco-form-group">
            <label style="font-weight: 600; color: #475569; margin-bottom: 6px; display: block;">Mật khẩu *</label>
            <input id="profile-password" class="eco-input" type="text" placeholder="Nhập mật khẩu..." value="${escapeHTML(dbUser.password || '')}">
          </div>
        </div>
        <div class="eco-form-group">
          <label style="font-weight: 600; color: #475569; margin-bottom: 6px; display: block;">Họ và tên *</label>
          <input id="profile-name" class="eco-input" placeholder="Nhập họ tên..." value="${escapeHTML(dbUser.name)}">
        </div>
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label style="font-weight: 600; color: #475569; margin-bottom: 6px; display: block;">Email liên hệ</label>
            <input id="profile-email-address" class="eco-input" placeholder="VD: name@ricons.vn" value="${escapeHTML(dbUser.emailAddress || '')}">
          </div>
          <div class="eco-form-group">
            <label style="font-weight: 600; color: #475569; margin-bottom: 6px; display: block;">Số điện thoại</label>
            <input id="profile-phone" class="eco-input" placeholder="VD: 090xxxxxxx" value="${escapeHTML(dbUser.phone || '')}">
          </div>
        </div>
      `, `
        <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
        <button onclick="ECO_Auth._saveProfile()" class="btn btn-primary" style="padding:9px 20px;">Lưu thay đổi</button>
      `, { size: 'md' });
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    },

    _handleAvatarUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        
        // Update the preview in the modal
        const previewImg = document.getElementById('profile-modal-avatar-preview');
        const previewInitials = document.getElementById('profile-modal-avatar-initials');
        
        if (previewImg) {
          previewImg.src = base64;
        } else if (previewInitials) {
          // Replace initials div with an image element
          const parent = previewInitials.parentNode;
          previewInitials.remove();
          const img = document.createElement('img');
          img.id = 'profile-modal-avatar-preview';
          img.src = base64;
          img.style.cssText = 'width: 80px; height: 80px; border-radius: 50%; object-fit: cover;';
          parent.appendChild(img);
        }
        
        // Store temporarily in window to save on confirm
        window._tempAvatarData = base64;
      };
      reader.readAsDataURL(file);
    },

    async _saveProfile() {
      const u = this.user();
      if (!u) return;

      const name = document.getElementById('profile-name').value.trim();
      const password = document.getElementById('profile-password').value.trim();
      const emailAddress = document.getElementById('profile-email-address') ? document.getElementById('profile-email-address').value.trim() : '';
      const phone = document.getElementById('profile-phone') ? document.getElementById('profile-phone').value.trim() : '';

      if (!name || !password) {
        if (typeof ECO_UI !== 'undefined') ECO_UI.toast('Vui lòng nhập đầy đủ Họ tên và Mật khẩu', 'error');
        return;
      }

      if (typeof ECO_Storage !== 'undefined') {
        const users = ECO_Storage.getUsers();
        const dbUser = users.find(x => String(x.id) === String(u.id));
        if (dbUser) {
          dbUser.name = name;
          dbUser.password = password;
          dbUser.emailAddress = emailAddress;
          dbUser.phone = phone;
          if (window._tempAvatarData) {
            dbUser.avatar = window._tempAvatarData;
            delete window._tempAvatarData;
          }

          try {
            await ECO_Storage.saveUsers(users);
            
            // Update current user session state
            u.name = name;
            localStorage.setItem('eco_logged_in_user', JSON.stringify(u));
            
            if (typeof ECO_UI !== 'undefined') {
              ECO_UI.toast('Đã cập nhật hồ sơ cá nhân thành công!', 'success');
              ECO_UI.closeModal();
            }
            
            this._syncProfile();
            
            // Re-render other modules
            if (document.getElementById('bch-content-container') && typeof BCHModule !== 'undefined') {
              BCHModule.render();
            }
            if (document.getElementById('users-content') && typeof UserModule !== 'undefined') {
              UserModule.render();
            }
          } catch (err) {
            console.error('Lỗi khi lưu profile:', err);
          }
        }
      }
    },

    _initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    setScopeOverride(fn)              { if (typeof fn === 'function') ECO_SCOPE_OVERRIDE = fn; },
    registerScopeField(resource, field) { ECO_SCOPE_FIELDS[resource] = field; },
  };

  // ---------- 7. USER MODULE (Quản trị người dùng) ----------
  const UserModule = {
    currentTab: 'bch', // 'bch' hoặc 'subcon'

    setTab(tab) {
      this.currentTab = tab;
      this.render();
    },

    render() {
      const container = document.getElementById('users-content');
      if (!container) return;

      const allUsers = ECO_Storage.getUsers();
      const isSuperAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();
      
      // Lọc tài khoản Ban Chỉ Huy (BCH) - Loại trừ tài khoản quản trị hệ thống gốc (admin)
      const bchUsers = allUsers.filter(u => 
        ECO_ROLES[u.role] && 
        ECO_ROLES[u.role].group === 'command' &&
        u.id !== 1 &&
        u.email !== 'admin'
      );

      // Lọc tài khoản Nhà thầu phụ (NTP)
      const subconUsers = allUsers.filter(u => u.role === 'subcontractor');
      const subcons = window.subcontractorsData || {};

      let contentHtml = '';

      if (this.currentTab === 'bch') {
        contentHtml = `
          <div class="glass-panel content-table-panel">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
              <div style="display:flex;align-items:center;gap:12px;">
                <h3 style="font-size:1rem;font-weight:700;margin:0;">Tài khoản Ban Chỉ Huy (BCH)</h3>
                <span style="background:rgba(0,86,255,0.1);color:#0056FF;border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:700;">${bchUsers.length} tài khoản</span>
              </div>
              ${isSuperAdmin ? `
              <button class="btn btn-outline btn-blue" onclick="BCHModule.addNode()" style="font-size:0.85rem;padding:8px 18px;">
                <i data-lucide="user-plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm nhân sự BCH
              </button>
              ` : ''}
            </div>
            <div class="table-container" style="margin:0;border-radius:0;">
              <table class="tech-table">
                <thead><tr>
                  <th>Họ và tên</th>
                  <th>Chức danh</th>
                  <th>Tên đăng nhập / Email</th>
                  <th>Mật khẩu</th>
                  <th>Phụ trách / Phạm vi</th>
                  ${isSuperAdmin ? `<th style="width:120px;text-align:center;">Hành động</th>` : ''}
                </tr></thead>
                <tbody>
                  ${bchUsers.length === 0
                    ? `<tr><td colspan="${isSuperAdmin ? 6 : 5}" style="text-align:center;padding:40px 20px;color:#94A3B8;">Chưa có tài khoản Ban Chỉ Huy nào.</td></tr>`
                    : bchUsers.map(u => {
                        const roleLabel = ECO_ROLES[u.role] ? ECO_ROLES[u.role].label : u.role;
                        const initials = ECO_Auth._initials(u.name);
                        const avatarImg = u.avatar 
                          ? `<img src="${u.avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-right: 8px;" />`
                          : `<div style="width: 28px; height: 28px; border-radius: 50%; background: rgba(0,86,255,0.06); color: #0056FF; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.72rem; margin-right: 8px;">${initials}</div>`;
                        const details = [u.responsibility, u.scope].filter(Boolean).join(' | ') || '—';
                        return `
                          <tr>
                            <td style="font-weight:700;color:#0F172A;"><div style="display:flex;align-items:center;gap:8px;">${avatarImg}<span>${u.name || '—'}</span></div></td>
                            <td><span class="badge badge-active">${roleLabel}</span></td>
                            <td><span style="font-family:monospace;background:rgba(0,86,255,0.06);padding:2px 6px;border-radius:4px;color:#0056FF;">${u.email}</span></td>
                            <td style="font-family:monospace;color:#64748B;">${u.password || '••••••••'}</td>
                            <td style="font-size:0.82rem;color:#475569;">${details}</td>
                            ${isSuperAdmin ? `
                            <td style="text-align:center;">
                              <button onclick="BCHModule.editNode(${u.id})" class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;margin-right:4px;border-color:rgba(0,0,0,0.15);">Sửa / Xóa</button>
                            </td>
                            ` : ''}
                          </tr>`;
                      }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      } else {
        contentHtml = `
          <div class="glass-panel content-table-panel">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
              <div style="display:flex;align-items:center;gap:12px;">
                <h3 style="font-size:1rem;font-weight:700;margin:0;">Tài khoản Nhà thầu phụ</h3>
                <span style="background:rgba(0,86,255,0.1);color:#0056FF;border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:700;">${subconUsers.length} tài khoản</span>
              </div>
              ${isSuperAdmin ? `
              <button class="btn btn-outline btn-blue" onclick="UserModule.addUser()" style="font-size:0.85rem;padding:8px 18px;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm tài khoản phụ</button>
              ` : ''}
            </div>
            <div class="table-container" style="margin:0;border-radius:0;">
              <table class="tech-table">
                <thead><tr>
                  <th>Tên người dùng</th>
                  <th>Tên đăng nhập / Email</th>
                  <th>Mật khẩu</th>
                  <th>Thuộc nhà thầu phụ</th>
                  ${isSuperAdmin ? `<th style="width:120px;text-align:center;">Hành động</th>` : ''}
                </tr></thead>
                <tbody>
                  ${subconUsers.length === 0
                    ? `<tr><td colspan="${isSuperAdmin ? 5 : 4}" style="text-align:center;padding:40px 20px;color:#94A3B8;">Chưa có tài khoản nhà thầu phụ nào.</td></tr>`
                    : subconUsers.map(u => {
                        const scName = u.subId && subcons[u.subId] ? subcons[u.subId].name : '—';
                        const initials = ECO_Auth._initials(u.name);
                        const avatarImg = u.avatar 
                          ? `<img src="${u.avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-right: 8px;" />`
                          : `<div style="width: 28px; height: 28px; border-radius: 50%; background: rgba(0,86,255,0.06); color: #0056FF; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.72rem; margin-right: 8px;">${initials}</div>`;
                        return `
                          <tr>
                            <td style="font-weight:700;color:#0F172A;"><div style="display:flex;align-items:center;gap:8px;">${avatarImg}<span>${u.name || '—'}</span></div></td>
                            <td><span style="font-family:monospace;background:rgba(0,86,255,0.06);padding:2px 6px;border-radius:4px;color:#0056FF;">${u.email}</span></td>
                            <td style="font-family:monospace;color:#64748B;">${u.password || '••••••••'}</td>
                            <td><span style="font-size:0.82rem;background:rgba(0,86,255,0.08);color:#0033A0;padding:3px 8px;border-radius:6px;font-weight:600;">${scName}</span></td>
                            ${isSuperAdmin ? `
                            <td style="text-align:center;">
                              <button onclick="UserModule.editUser(${u.id})" class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;margin-right:4px;border-color:rgba(0,0,0,0.15);">Sửa / Xóa</button>
                            </td>
                            ` : ''}
                          </tr>`;
                      }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      }

      container.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button class="btn ${this.currentTab === 'bch' ? 'btn-primary' : 'btn-outline'}" onclick="UserModule.setTab('bch')" style="font-size:0.85rem;padding:8px 18px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            <i data-lucide="network" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Tài khoản Ban Chỉ Huy (BCH)
          </button>
          <button class="btn ${this.currentTab === 'subcon' ? 'btn-primary' : 'btn-outline'}" onclick="UserModule.setTab('subcon')" style="font-size:0.85rem;padding:8px 18px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            <i data-lucide="users" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Tài khoản Nhà thầu phụ
          </button>
        </div>
        ${contentHtml}
      `;
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    },

    addUser() {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền thêm tài khoản!', 'error');
        return;
      }
      this._openUserModal();
    },

    editUser(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền sửa tài khoản!', 'error');
        return;
      }
      const users = ECO_Storage.getUsers();
      const u = users.find(x => x.id == id);
      if (u) this._openUserModal(u);
    },

    _openUserModal(user = null) {
      const subcons = window.subcontractorsData || {};
      const isEdit = !!user;

      ECO_UI.openModal(isEdit ? 'Chỉnh sửa tài khoản Nhà thầu phụ' : 'Tạo tài khoản Nhà thầu phụ mới', `
        <div class="eco-form-group">
          <label>Tên đăng nhập *</label>
          <input id="u-email" class="eco-input" placeholder="VD: ntphu_thuanthien..." value="${user ? user.email : ''}" ${isEdit ? 'disabled style="background:#F1F5F9;color:#64748B;"' : ''}>
        </div>
        <div class="eco-form-group">
          <label>Mật khẩu đăng nhập *</label>
          <input id="u-password" class="eco-input" type="text" placeholder="Nhập mật khẩu..." value="${user ? user.password : ''}">
        </div>
        <div class="eco-form-group">
          <label>Tên người dùng hiển thị *</label>
          <input id="u-name" class="eco-input" placeholder="Họ và tên..." value="${user ? user.name : ''}">
        </div>
        <div class="eco-form-group">
          <label>Thuộc nhà thầu phụ *</label>
          <select id="u-subId" class="eco-select">
            <option value="">-- Chọn thầu phụ liên kết --</option>
            ${Object.entries(subcons).map(([id, sc]) => `<option value="${id}" ${user && user.subId === id ? 'selected' : ''}>${sc.name}</option>`).join('')}
          </select>
        </div>`,
        `
        ${isEdit ? `<button onclick="UserModule._deleteUser(${user.id})" class="btn btn-outline" style="padding:9px 20px;color:#E31837;border-color:#E31837;margin-right:auto;">Xóa tài khoản</button>` : ''}
        <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
        <button onclick="UserModule._saveUser(${user ? user.id : ''})" class="btn btn-primary" style="padding:9px 20px;">Lưu</button>`
      );
    },

    async _saveUser(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền lưu tài khoản!', 'error');
        return;
      }
      const email = document.getElementById('u-email').value.trim();
      const password = document.getElementById('u-password').value.trim();
      const name = document.getElementById('u-name').value.trim();
      const role = 'subcontractor';
      const subId = document.getElementById('u-subId').value;

      if (!email || !password || !name) {
        ECO_UI.toast('Vui lòng điền đầy đủ các thông tin bắt buộc (*)', 'error');
        return;
      }
      if (!subId) {
        ECO_UI.toast('Vui lòng chọn nhà thầu phụ liên kết', 'error');
        return;
      }

      const users = ECO_Storage.getUsers();

      if (id) {
        const u = users.find(x => x.id == id);
        if (u) {
          u.password = password;
          u.name = name;
          u.role = role;
          u.subId = subId;
        }
      } else {
        const existing = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
        if (existing) {
          ECO_UI.toast('Tên đăng nhập đã tồn tại trong hệ thống!', 'error');
          return;
        }
        const newId = ECO_Storage.nextId(users);
        users.push({ id: newId, email, password, name, role, subId });
      }

      try {
        await ECO_Storage.saveUsers(users);
        ECO_UI.closeModal();
        ECO_UI.toast(id ? 'Đã cập nhật tài khoản Nhà thầu phụ' : 'Đã thêm tài khoản Nhà thầu phụ', 'success');
        this.render();
      } catch (e) {
        // Error toast already shown by ECO_Cache.set
      }
    },

    async _deleteUser(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa tài khoản!', 'error');
        return;
      }
      if (id === 1) {
        ECO_UI.toast('Không thể xóa tài khoản Admin gốc!', 'error');
        return;
      }
      if (!confirm('Bạn có chắc chắn muốn xóa tài khoản này không?')) return;

      const users = ECO_Storage.getUsers().filter(x => x.id != id);
      try {
        await ECO_Storage.saveUsers(users);
        ECO_UI.closeModal();
        ECO_UI.toast('Đã xóa tài khoản', 'warning');
        this.render();
      } catch (e) {
        // Error toast already shown by ECO_Cache.set
      }
    }
  };

  global.UserModule = UserModule;

  // ---------- 7.5. BCH MODULE (Sơ đồ tổ chức động) ----------
  const BCHModule = {
    _seedData() {
      const users = ECO_Storage.getUsers();
      if (!Array.isArray(users)) return;
      
      let changed = false;
      
      // 1. Ensure admin (id: 1) is just a system account
      let adminUser = users.find(u => u.id === 1 || String(u.email).toLowerCase() === 'admin');
      if (adminUser) {
        if (adminUser.name !== 'Quản trị hệ thống' || adminUser.email !== 'admin' || adminUser.parentId !== null) {
          adminUser.name = 'Quản trị hệ thống';
          adminUser.email = 'admin';
          adminUser.parentId = null;
          delete adminUser.responsibility; // Remove BCH responsibility
          delete adminUser.scope;
          changed = true;
        }
      } else {
        adminUser = { id: 1, email: 'admin', password: 'admin@ricons', name: 'Quản trị hệ thống', role: 'pd', parentId: null, subId: null };
        users.push(adminUser);
        changed = true;
      }

      // 2. Define other seed users for the actual BCH
      const seedCommandUsers = [
        { email: 'pd', password: '123', name: 'Nguyễn Văn A', role: 'pd', parentId: null, responsibility: '', scope: '', emailAddress: 'nva@ricons.vn', phone: '0901.111.222', subId: null },
        { email: 'cht', password: '123', name: 'Trần Văn B', role: 'ch_truong', parentName: 'Nguyễn Văn A', responsibility: '', scope: '', emailAddress: 'tvb@ricons.vn', phone: '0902.222.333', subId: null },
        { email: 'cbkt_dien', password: '123', name: 'Lê Văn C', role: 'field', parentName: 'Trần Văn B', responsibility: 'Điện (E)', scope: 'Tháp S1', emailAddress: 'lvc@ricons.vn', phone: '0903.333.444', subId: null },
        { email: 'cbkt_nuoc', password: '123', name: 'Phạm Văn D', role: 'field', parentName: 'Trần Văn B', responsibility: 'Cấp thoát nước (PL)', scope: 'Hầm', emailAddress: 'pvd@ricons.vn', phone: '0904.444.555', subId: null }
      ];

      // Add missing users
      seedCommandUsers.forEach(seed => {
        const existing = users.find(u => String(u.email).toLowerCase() === String(seed.email).toLowerCase());
        if (!existing) {
          const newId = ECO_Storage.nextId(users);
          users.push({
            id: newId,
            email: seed.email,
            password: seed.password,
            name: seed.name,
            role: seed.role,
            responsibility: seed.responsibility,
            scope: seed.scope,
            emailAddress: seed.emailAddress,
            phone: seed.phone,
            subId: seed.subId
          });
          changed = true;
        } else {
          // If the seed has empty responsibility, and existing user has 'Quản lý chung dự án' or 'Điều hành & Giám sát', clear it to conform to new requirements
          if ((seed.responsibility === '' || !seed.responsibility) && 
              (existing.responsibility === 'Quản lý chung dự án' || existing.responsibility === 'Điều hành & Giám sát')) {
            existing.responsibility = '';
            changed = true;
          }
          // If the seed has empty scope, and existing user has 'Toàn dự án', clear it to conform to new requirements
          if ((seed.scope === '' || !seed.scope) && existing.scope === 'Toàn dự án') {
            existing.scope = '';
            changed = true;
          }
        }
      });

      // Now resolve parentIds based on names/emails of parentName to avoid ID hardcoding mismatches
      seedCommandUsers.forEach(seed => {
        const user = users.find(u => String(u.email).toLowerCase() === String(seed.email).toLowerCase());
        if (user && seed.parentName) {
          const parent = users.find(u => u.name === seed.parentName);
          if (parent && user.parentId !== parent.id) {
            user.parentId = parent.id;
            changed = true;
          }
        } else if (user && seed.parentId === null && user.parentId !== null && user.id !== 1) {
          user.parentId = null;
          changed = true;
        }
      });
      
      // 3. Auto-seed 1 default account for each subcontractor
      const subcons = window.subcontractorsData || {};
      const cleanUsername = (str) => {
        return str
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Remove accents
          .replace(/đ/g, 'd')             // Replace special letter đ
          .replace(/[^a-z0-9]/g, '');     // Remove spaces and non-alphanumeric
      };

      Object.entries(subcons).forEach(([subId, sc]) => {
        const username = cleanUsername(sc.name);
        const existing = users.find(u => String(u.email).toLowerCase() === username);
        if (!existing) {
          const newId = ECO_Storage.nextId(users);
          users.push({
            id: newId,
            email: username,
            password: '123', // Mật khẩu mặc định là 123
            name: sc.name,
            role: 'subcontractor',
            subId: subId
          });
          changed = true;
        }
      });

      if (changed) ECO_Storage.saveUsers(users);
    },

    render() {
      this._seedData();
      const container = document.getElementById('bch-content-container');
      if (!container) return;
      const isSuperAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();

      // Filter out system admin account (id: 1, email: admin) from organizational chart
      const users = ECO_Storage.getUsers().filter(u => 
        ECO_ROLES[u.role] && 
        ECO_ROLES[u.role].group === 'command' &&
        u.id !== 1 &&
        u.email !== 'admin'
      );

      // Build tree
      const map = {};
      const roots = [];
      users.forEach(u => map[u.id] = { ...u, children: [] });
      users.forEach(u => {
        if (u.parentId && map[u.parentId]) {
          map[u.parentId].children.push(map[u.id]);
        } else {
          roots.push(map[u.id]);
        }
      });

      const getRoleColor = (role) => {
        if (role === 'pd') return 'red';
        if (role === 'ch_truong' || role === 'ch_pho') return 'blue';
        return 'cyan';
      };

      const getRoleIcon = (role) => {
        if (role === 'pd') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>';
        if (role === 'ch_truong' || role === 'ch_pho') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>';
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
      };

      const getAbbrevs = (respStr) => {
        if (!respStr) return [];
        return respStr.split(',').map(s => {
          const trimmed = s.trim();
          const match = trimmed.match(/\(([^)]+)\)/);
          if (match) return match[1].toUpperCase();
          if (trimmed === 'Điện - Điện nhẹ (ELV)' || trimmed === 'Điện nhẹ (ELV)') return 'ELV';
          if (trimmed === 'Điều hòa Thông gió (ACMV)') return 'ACMV';
          if (trimmed === 'Chữa cháy (FF)') return 'FF';
          if (trimmed === 'Báo cháy (FA)') return 'FA';
          return trimmed.split(/\s+/).map(w => w.charAt(0)).join('').toUpperCase().replace(/[^\w\s]/gi, '');
        }).filter(Boolean);
      };

      const renderNode = (node) => {
        const color = getRoleColor(node.role);
        const roleLabel = ECO_ROLES[node.role] ? ECO_ROLES[node.role].label : node.role;
        const icon = getRoleIcon(node.role);
        
        let childrenHtml = '';
        if (node.children.length > 0) {
          childrenHtml = `<ul>${node.children.map(renderNode).join('')}</ul>`;
        }

        const abbrevs = getAbbrevs(node.responsibility);
        const badgesHtml = abbrevs.map(ab => `
          <span style="background: rgba(255,255,255, 0.2); color: var(--text-inverse); font-size: 0.68rem; font-weight: 850; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.22); text-transform: uppercase; letter-spacing: 0.02em;" title="${escapeHTML(node.responsibility)}">${escapeHTML(ab)}</span>
        `).join('');

        return `
          <li>
            <div class="org-node accent-card accent-${color}" style="width: 300px; position: relative; text-align: left; padding: 20px; box-sizing: border-box; ${isSuperAdmin ? 'cursor: pointer;' : ''}" ${isSuperAdmin ? `onclick="BCHModule.editNode(${node.id})"` : ''}>
              <div style="display: flex; flex-direction: column; width: 100%; position: relative; z-index: 2;">
                
                <!-- Top Header: Avatar + Info side-by-side -->
                <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px; width: 100%;">
                  <!-- Avatar Circle -->
                  <div style="width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; border: 1.5px solid rgba(255,255,255,0.5); overflow: hidden; position: relative; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                    ${node.avatar 
                      ? `<img src="${node.avatar}" style="width: 100%; height: 100%; object-fit: cover;" />`
                      : `<div style="color: var(--text-inverse); display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">${icon}</div>`
                    }
                  </div>
                  <!-- Name & Role Badge -->
                  <div style="display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 6px; overflow: hidden; flex: 1;">
                    <div style="font-size: 1.15rem; font-weight: 850; color: var(--text-inverse); line-height: 1.25; font-family: 'Inter', sans-serif; letter-spacing: -0.01em; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; text-shadow: 0 1px 3px rgba(0,0,0,0.25);" title="${escapeHTML(node.name)}">
                      ${escapeHTML(node.name)}
                    </div>
                    <div style="background: rgba(255,255,255, 0.18); color: var(--text-inverse); font-size: 0.68rem; font-weight: 850; text-transform: uppercase; padding: 4px 10px; border-radius: 12px; letter-spacing: 0.05em; display: inline-block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; border: 1px solid rgba(255,255,255,0.25);" title="${escapeHTML(roleLabel)}">
                      ${escapeHTML(roleLabel)}
                    </div>
                  </div>
                </div>

                <!-- Info Grid / Contacts -->
                <div style="width: 100%; display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1.5px solid rgba(255,255,255,0.2); box-sizing: border-box;">
                  
                  <!-- Scope on Top, Centered -->
                  ${node.scope ? `
                  <div style="display: flex; justify-content: center; align-items: center; gap: 6px; width: 100%; color: rgba(255,255,255,0.95); font-size: 0.82rem; font-weight: 700;">
                    <i data-lucide="map-pin" style="width:14px;height:14px;color:rgba(255,255,255,0.85); flex-shrink: 0;"></i> 
                    <span>${escapeHTML(node.scope)}</span>
                  </div>
                  ` : ''}

                  <!-- Email & Phone on same row immediately below -->
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; font-size: 0.76rem; color: rgba(255,255,255,0.9);">
                    <div style="display: flex; align-items: center; gap: 5px; overflow: hidden; max-width: 50%;" title="${escapeHTML(node.emailAddress || '')}">
                      <i data-lucide="mail" style="width:13px;height:13px;color:rgba(255,255,255,0.8); flex-shrink: 0;"></i> 
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(node.emailAddress || '—')}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; overflow: hidden; max-width: 50%;" title="${escapeHTML(node.phone || '')}">
                      <i data-lucide="phone" style="width:13px;height:13px;color:rgba(255,255,255,0.8); flex-shrink: 0;"></i> 
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(node.phone || '—')}</span>
                    </div>
                  </div>

                  <!-- Systems abbreviated badges centered at the bottom -->
                  <div style="display: flex; justify-content: center; align-items: center; gap: 6px; width: 100%; flex-wrap: wrap; margin-top: 2px;">
                    ${badgesHtml || ''}
                  </div>

                </div>
              </div>
            </div>
            ${childrenHtml}
          </li>
        `;
      };

      container.innerHTML = `
        <div style="position: relative; width: 100%;">
          ${isSuperAdmin ? `
          <div style="position: absolute; right: 24px; top: -56px; z-index: 10;">
            <button class="btn" style="background: linear-gradient(135deg, #0056FF, #0033A0); color: white; font-weight: 600; font-size: 0.82rem; padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 4px 12px rgba(0,86,255,0.3); display: flex; align-items: center; cursor: pointer; transition: all 0.2s ease;" onclick="BCHModule.addNode()" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 16px rgba(0,86,255,0.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 12px rgba(0,86,255,0.3)'">
              <i data-lucide="user-plus" style="width:15px;height:15px;margin-right:8px;"></i>Thêm nhân sự
            </button>
          </div>
          ` : ''}
          <div class="content-table-scroll" style="padding: 30px 16px 80px 16px; overflow: auto; width: 100%; box-sizing: border-box;">
            <div class="org-chart" style="display: flex; justify-content: center; min-width: max-content;">
              <div class="org-tree">
                <ul>
                  ${roots.map(renderNode).join('')}
                </ul>
              </div>
            </div>
          </div>
        </div>
      `;
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    },

    addNode() {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền thêm nhân sự BCH!', 'error');
        return;
      }
      this._openModal();
    },

    editNode(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền sửa nhân sự BCH!', 'error');
        return;
      }
      const user = ECO_Storage.getUsers().find(u => String(u.id) === String(id));
      if (user) this._openModal(user);
    },

    _openModal(user = null) {
      const isEdit = !!user;
      const allUsers = ECO_Storage.getUsers();
      // Filter out system admin account (id: 1, email: admin) from the "Báo cáo cho" dropdown selection
      const bchUsers = allUsers.filter(u => 
        ECO_ROLES[u.role] && 
        ECO_ROLES[u.role].group === 'command' && 
        u.id !== 1 &&
        u.email !== 'admin' &&
        (!user || String(u.id) !== String(user.id))
      );
      
      const roles = Object.entries(ECO_ROLES).filter(([_, r]) => r.group === 'command').map(([v, r]) => ({ v, l: r.label }));
      
      // Systems dropdown configuration
      const systems = [
        "Điện (E)",
        "Điện - Điện nhẹ (ELV)",
        "Điều hòa Thông gió (ACMV)",
        "Cấp thoát nước (PL)",
        "Chữa cháy (FF)",
        "Báo cháy (FA)"
      ];
      const currentResps = user && user.responsibility ? user.responsibility.split(',').map(s => s.trim()) : [];

      ECO_UI.openModal(isEdit ? 'Chỉnh sửa nhân sự Ban Chỉ Huy' : 'Thêm nhân sự Ban Chỉ Huy mới', `
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label>Họ và tên *</label>
            <input id="bch-name" class="eco-input" placeholder="Nhập họ tên..." value="${user ? user.name : ''}">
          </div>
          <div class="eco-form-group">
            <label>Chức danh *</label>
            <select id="bch-role" class="eco-select">
               ${roles.map(r => `<option value="${r.v}" ${user && user.role === r.v ? 'selected' : ''}>${r.l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="eco-form-row" style="display: flex; flex-direction: column;">
          <div class="eco-form-group" style="width: 100%; max-width: 100%;">
            <label style="font-weight: 600; color: #475569; margin-bottom: 8px; display: block;">Phụ trách</label>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; background: rgba(0,86,255,0.02); border: 1px solid rgba(0,86,255,0.1); border-radius: 10px; padding: 14px;">
              ${systems.map(sys => {
                const isChecked = currentResps.includes(sys) ? 'checked' : '';
                return `
                  <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 550; color: #334155; user-select: none;">
                    <input type="checkbox" class="bch-resp-checkbox" value="${sys}" ${isChecked} style="width: 16px; height: 16px; border-radius: 4px; border: 1px solid #cbd5e1; cursor: pointer; accent-color: #0056FF;">
                    ${sys}
                  </label>
                `;
              }).join('')}
            </div>
          </div>
        </div>
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label>Email liên hệ</label>
            <input id="bch-email-address" class="eco-input" placeholder="VD: name@ricons.vn" value="${user && user.emailAddress ? user.emailAddress : ''}">
          </div>
          <div class="eco-form-group">
            <label>Số điện thoại</label>
            <input id="bch-phone" class="eco-input" placeholder="VD: 090xxxxxxx" value="${user && user.phone ? user.phone : ''}">
          </div>
        </div>
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label>Phạm vi</label>
            <input id="bch-scope" class="eco-input" placeholder="Gợi ý: Tháp S1, Hầm,..." value="${user && user.scope ? user.scope : ''}">
          </div>
          <div class="eco-form-group">
            <label>Báo cáo cho (Quản lý trực tiếp)</label>
            <select id="bch-parent" class="eco-select">
              <option value="">-- Cấp cao nhất (Không có) --</option>
              ${bchUsers.map(u => `<option value="${u.id}" ${user && String(user.parentId) === String(u.id) ? 'selected' : ''}>${u.name} (${ECO_ROLES[u.role].label})</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:20px; border: 1px solid rgba(0,86,255,0.15); background: rgba(0,86,255,0.03); border-radius: 10px; padding: 16px;">
          <h4 style="font-size: 0.95rem; margin: 0 0 16px 0; color: #0056FF; display: flex; align-items: center;"><i data-lucide="shield-check" style="width:16px;height:16px;margin-right:6px;"></i> Thông tin tài khoản hệ thống</h4>
          <div class="eco-form-row">
            <div class="eco-form-group">
              <label>Tên đăng nhập *</label>
              <input id="bch-email" class="eco-input" placeholder="Nhập tên đăng nhập..." value="${user ? user.email : ''}" ${isEdit && user.id === 1 ? 'disabled' : ''}>
            </div>
            <div class="eco-form-group">
              <label>Mật khẩu *</label>
              <input id="bch-password" class="eco-input" type="text" placeholder="Mật khẩu đăng nhập..." value="${user ? user.password : ''}">
            </div>
          </div>
        </div>
      `,
      `
        ${isEdit && user.id !== 1 ? `<button onclick="BCHModule._deleteNode(${user.id})" class="btn btn-outline" style="padding:9px 20px;color:#E31837;border-color:#E31837;margin-right:auto;">Xóa nhân sự</button>` : ''}
        <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
        <button onclick="BCHModule._saveNode(${user ? user.id : ''})" class="btn btn-primary" style="padding:9px 20px;">Lưu thông tin</button>
      `, { size: 'lg' });
    },

    async _saveNode(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền lưu thông tin nhân sự BCH!', 'error');
        return;
      }
      const name = document.getElementById('bch-name').value.trim();
      const role = document.getElementById('bch-role').value;
      
      // Collect selected responsibilities from checkboxes
      const respCheckboxes = document.querySelectorAll('.bch-resp-checkbox:checked');
      const resp = Array.from(respCheckboxes).map(cb => cb.value).join(', ');
      
      const scope = document.getElementById('bch-scope') ? document.getElementById('bch-scope').value.trim() : '';
      const emailAddress = document.getElementById('bch-email-address') ? document.getElementById('bch-email-address').value.trim() : '';
      const phone = document.getElementById('bch-phone') ? document.getElementById('bch-phone').value.trim() : '';
      const parentId = document.getElementById('bch-parent').value;
      const emailEl = document.getElementById('bch-email');
      const email = emailEl ? emailEl.value.trim() : '';
      const password = document.getElementById('bch-password').value.trim();

      if (!name || (!email && (!id || id !== 1)) || !password || !role) {
        ECO_UI.toast('Vui lòng điền đầy đủ các thông tin bắt buộc (*)', 'error');
        return;
      }

      const users = ECO_Storage.getUsers();

      if (id) {
        const u = users.find(x => String(x.id) === String(id));
        if (u) {
          u.name = name;
          u.role = role;
          u.responsibility = resp;
          u.scope = scope;
          u.emailAddress = emailAddress;
          u.phone = phone;
          u.parentId = parentId ? parseInt(parentId) : null;
          if (email) u.email = email;
          u.password = password;
        }
      } else {
        const newId = ECO_Storage.nextId(users);
        users.push({
          id: newId, name, role, responsibility: resp, scope, emailAddress, phone, parentId: parentId ? parseInt(parentId) : null,
          email, password, subId: null
        });
      }

      try {
        await ECO_Storage.saveUsers(users);
        ECO_UI.closeModal();
        ECO_UI.toast(id ? 'Đã cập nhật nhân sự BCH' : 'Đã thêm nhân sự BCH mới', 'success');
        this.render();
        if (typeof UserModule !== 'undefined' && document.getElementById('users-content')) {
          UserModule.render();
        }
      } catch (e) {
        // Error toast already shown by ECO_Cache.set
      }
    },

    async _deleteNode(id) {
      if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
        ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa nhân sự BCH!', 'error');
        return;
      }
      if (parseInt(id) === 1 || String(id) === '1') {
        ECO_UI.toast('Không thể xóa tài khoản Admin gốc!', 'error');
        return;
      }

      const users = ECO_Storage.getUsers();
      const hasChildren = users.some(u => String(u.parentId) === String(id));
      if (hasChildren) {
        ECO_UI.toast('Không thể xóa nhân sự đang có người báo cáo (cấp dưới)! Vui lòng cập nhật cấp dưới trước.', 'error');
        return;
      }

      if (!confirm('Bạn có chắc chắn muốn xóa nhân sự này (và tài khoản liên quan) khỏi sơ đồ Ban Chỉ Huy?')) return;

      const newUsers = users.filter(x => String(x.id) !== String(id));
      try {
        await ECO_Storage.saveUsers(newUsers);
        ECO_UI.closeModal();
        ECO_UI.toast('Đã xóa nhân sự BCH', 'warning');
        this.render();
        if (typeof UserModule !== 'undefined' && document.getElementById('users-content')) {
          UserModule.render();
        }
      } catch (e) {
        // Error toast already shown by ECO_Cache.set
      }
    }
  };

  global.BCHModule = BCHModule;

  // Proactively load eco_users so BCH & UserModule have data on startup
  if (typeof ECO_Cache !== 'undefined') {
    ECO_Cache.on('eco_users', () => {
      if (document.getElementById('bch-content-container') && typeof BCHModule !== 'undefined') {
        BCHModule.render();
      }
      if (document.getElementById('users-content') && typeof UserModule !== 'undefined') {
        UserModule.render();
      }
    });
  }

  // ---------- 8. EXPORT ----------
  global.ECO_ROLES       = ECO_ROLES;
  global.ECO_RESOURCES   = ECO_RESOURCES;
  global.ECO_ACTIONS     = ECO_ACTIONS;
  global.ECO_PERMISSIONS = ECO_PERMISSIONS;
  global.ECO_SCOPE       = ECO_SCOPE;
  global.ECO_Session     = ECO_Session;
  global.ECO_Auth        = ECO_Auth;

  // Fallback init: nếu onAuthStateChange cũ đã xóa, ta init trực tiếp qua ECO_Session
  if (typeof document !== 'undefined') {
    const _init = async function () {
      const loggedIn = await ECO_Session.init();
      if (loggedIn) {
        _hideLoginScreen();
        ECO_Auth.applyGates();
      } else {
        _showLoginScreen();
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _init);
    } else {
      _init();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
