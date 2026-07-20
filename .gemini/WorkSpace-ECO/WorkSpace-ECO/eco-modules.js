// ==================== ECO PO & KHO MODULES ====================
// Dữ liệu đi qua ECO_Cache (eco-store.js), hướng tới Supabase backend sau

function cleanPrefix(str) {
  if (!str || str === 'none') return '';
  let s = String(str).replace(/^[A-Za-z0-9]+\.\s*/, '').trim();
  if (s.length === 0) return '';
  s = s.toLowerCase();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  s = s.replace(/\bkv\b/gi, 'kV')
       .replace(/\bmep\b/gi, 'MEP')
       .replace(/\bip4k\b/gi, 'IP4K')
       .replace(/\bahu\b/gi, 'AHU')
       .replace(/\bfcu\b/gi, 'FCU')
       .replace(/\bppr\b/gi, 'PPR')
       .replace(/\bhdpe\b/gi, 'HDPE')
       .replace(/\bpvc\b/gi, 'PVC')
       .replace(/\bmsb\b/gi, 'MSB')
       .replace(/\blv\b/gi, 'LV')
       .replace(/\bxml\b/gi, 'XML')
       .replace(/\bsw\b/gi, 'SW')
       .replace(/\butp\b/gi, 'UTP')
       .replace(/\bca\b/gi, 'CA');
  return s;
}

function cleanPoNoToHeading(poNo) {
  if (!poNo) return '—';
  let s = String(poNo).trim();
  s = s.replace(/^(ECO\s*HH1\s*[-–]?\s*PO\s*|ECO\s*HH1\s*[-–]?\s*|PO\s*)/i, '');
  s = s.replace(/\s*[-–_]?\s*\d+\s*$/, '');
  return s.trim() || poNo;
}

function renderAreaCheckboxes(currentAreaStr = '', isReadOnly = false) {
  const allowedAreas = ['Hầm B2', 'Hầm B1', 'Hầm P1', 'Tháp S1', 'Tháp S2'];
  const currentAreas = String(currentAreaStr || '').split(',').map(x => x.trim()).filter(Boolean);
  
  if (isReadOnly) {
    return currentAreas.join(', ') || 'Chung';
  }
  
  let html = `<div class="area-checkboxes-wrapper" style="display:flex; flex-direction:column; gap:4px; max-height:100px; overflow-y:auto; border:1px solid rgba(0,0,0,0.12); padding:6px; border-radius:6px; background:#fff; width:100%; box-sizing:border-box;">`;
  allowedAreas.forEach(area => {
    const isChecked = currentAreas.includes(area);
    html += `
      <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.75rem; color:#0F172A; font-weight:normal; margin:0; cursor:pointer; user-select:none; text-transform:none;">
        <input type="checkbox" class="area-cb" value="${area}" ${isChecked ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer; accent-color:#0056FF;">
        <span>${area}</span>
      </label>
    `;
  });
  html += `</div>`;
  return html;
}

function getSelectedAreasFromRow(row) {
  const cbs = row.querySelectorAll('.area-cb:checked');
  if (cbs.length === 0) return 'Chung';
  return Array.from(cbs).map(cb => cb.value).join(', ');
}


// ===== MEP SYSTEM MAPPING =====
// Ánh xạ động từ ECO_SYSTEMS của BOQ ↔ system ID nội bộ.
function systemLabelToIds(label) {
  if (!label) return [];
  const systems = (typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS : []);
  const parts = String(label).split(',').map(s => s.trim()).filter(Boolean);
  
  if (parts.some(p => p.toLowerCase() === 'tổng hợp')) {
    return [];
  }
  
  const ids = [];
  parts.forEach(part => {
    const entry = systems.find(
      e => e.name.toLowerCase() === part.toLowerCase()
    );
    if (entry) ids.push(entry.id);
  });
  return ids;
}

// ===== STORAGE =====
// Getter đọc giá trị đã xác nhận từ server (qua ECO_Cache._data).
// Setter ghi thẳng xuống DB qua ECO_Cache.set() — không cache local.
const ECO_Storage = {
  _get(key) {
    if (typeof ECO_Cache === 'undefined') return null;
    return ECO_Cache.get(key);
  },
  _set(key, val) {
    if (typeof ECO_Cache !== 'undefined') {
      return ECO_Cache.set(key, val).catch(e => {
        console.error('[ECO_Storage] Lỗi lưu:', key, e);
        throw e;
      });
    }
    return Promise.resolve();
  },
  // Trả về PO thô từ DB — dùng khi cần ghi lại (save/update/delete).
  _rawPOs() { return this._get('eco_pos') || []; },

  // Trả về PO đã làm giàu: tính receivedQty từ inventory logs và tự cập nhật
  // status theo thực tế nhập kho. Chỉ dùng cho hiển thị, KHÔNG dùng để save.
  getPOs() {
    const pos = this._rawPOs();
    const logs = this.getInventoryLogs() || [];
    const materials = this.getMaterials() || [];
    const suppliers = this._get('eco_suppliers') || [];
    const supMap = {};
    suppliers.forEach(s => { if (s && s.id) supMap[String(s.id)] = s.companyName; });

    const matMap = {};
    materials.forEach(m => { matMap[m.id] = m; });
    
    const recvMap = {};
    logs.forEach(log => {
      if (log.type !== 'in' || !log.poId) return;
      if (!recvMap[log.poId]) recvMap[log.poId] = {};
      (log.items || []).forEach(item => {
        if (!recvMap[log.poId][item.matId]) recvMap[log.poId][item.matId] = {};
        const v = item.variant || 'Tiêu chuẩn';
        recvMap[log.poId][item.matId][v] = (recvMap[log.poId][item.matId][v] || 0) + (parseFloat(item.qty) || 0);
      });
    });

    return pos.map(p => {
      const pId = String(p.id);
      const currentSupplierName = p.supplierId ? supMap[String(p.supplierId)] : null;
      const supplierName = currentSupplierName || p.supplier || '—';

      const items = (p.items || []).map(item => {
        const v = item.variant || 'Tiêu chuẩn';
        const received = (recvMap[pId] && recvMap[pId][item.matId] && recvMap[pId][item.matId][v]) || 0;
        const mat = matMap[item.matId];
        return {
          ...item,
          code: mat ? mat.code : (item.code || '—'),
          name: mat ? mat.name : item.name,
          unit: mat ? mat.unit : item.unit,
          receivedQty: received
        };
      });

      let newStatus = p.status;
      if (['approved', 'ordered', 'shipping', 'partially_received', 'received'].includes(p.status)) {
        const hasItems = items.length > 0;
        const allFullyReceived = hasItems && items.every(it => (parseFloat(it.receivedQty) || 0) >= (parseFloat(it.qty) || 0));
        const anyReceived = items.some(it => (parseFloat(it.receivedQty) || 0) > 0);

        if (allFullyReceived) {
          newStatus = 'received';
        } else if (anyReceived) {
          newStatus = 'partially_received';
        } else if (p.status === 'received' || p.status === 'partially_received') {
          newStatus = 'ordered';
        }
      }

      return { ...p, items, status: newStatus, supplier: supplierName };
    });
  },
  savePOs(pos) {
    // Strip receivedQty — field tính toán từ inventory logs, không cần lưu trong PO.
    const clean = pos.map(p => ({
      ...p,
      items: (p.items || []).map(({ receivedQty, ...item }) => item),
    }));
    return this._set('eco_pos', clean);
  },
  getSuppliers() {
    const raw = this._get('eco_suppliers') || [];
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    return raw.map(s => {
      const targetIds = systemLabelToIds(s.system);
      const matchedBoqIds = targetIds.length === 0
        ? boq.map(b => b.id)
        : boq.filter(b => targetIds.includes(b.system)).map(b => b.id);
      return {
        ...s,
        providedMaterials: s.providedMaterials && s.providedMaterials.length > 0
          ? s.providedMaterials
          : matchedBoqIds,
      };
    });
  },
  saveSuppliers(s) { return this._set('eco_suppliers', s); },
  getProgress() {
    const raw = this._get('eco_progress');
    // Nếu đang tải (null), trả về mảng rỗng tạm thời nhưng KHÔNG ghi đè defaults
    if (raw === null) return [];
    
    // Sử dụng cờ đánh dấu đã khởi tạo (eco_progress_seeded)
    const isSeeded = localStorage.getItem('eco_progress_seeded');
    if (!isSeeded && (!raw || raw.length === 0)) {
      const defaults = [
        { id: 1, code: 'SCH-MEP-001', system: 'Điện', subcontractor: 'ĐẤT PHAN', area: 'Khu A - Tầng 1 & 2', progress: 78, status: 'ON TRACK' },
        { id: 2, code: 'SCH-MEP-002', system: 'Phòng cháy Chữa cháy', subcontractor: 'THUẬN THIÊN', area: 'Toàn bộ Nhà xưởng chính', progress: 42, status: 'BỊ TRỄ' }
      ];
      localStorage.setItem('eco_progress_seeded', 'true');
      this.saveProgress(defaults);
      return defaults;
    }
    return raw || [];
  },
  saveProgress(p) { return this._set('eco_progress', p); },
  getInventoryLogs() {
    const raw = this._get('eco_inv_logs') || [];
    const materials = this.getMaterials() || [];
    const matMap = {};
    materials.forEach(m => { matMap[m.id] = m; });

    return raw.map(log => {
      const items = (log.items || []).map(item => {
        const mat = matMap[item.matId];
        return {
          ...item,
          name: mat ? mat.name : item.name,
          unit: mat ? mat.unit : item.unit
        };
      });
      return { ...log, items };
    });
  },
  saveInventoryLogs(logs) {
    const clean = (logs || []).map(({ items, ...log }) => ({
      ...log,
      items: (items || []).map(({ name, unit, ...item }) => item)
    }));
    return this._set('eco_inv_logs', clean);
  },
  nextId(list) { return list.length > 0 ? Math.max(...list.map(i => i.id || 0)) + 1 : 1; },
  getMaterials() {
    const raw = typeof ECO_Cache !== 'undefined' ? ECO_Cache.get('eco_materials') : null;
    if (raw === null) return [];

    const boqMap = {};
    const activeBoq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : (window.ECO_BOQ_INITIAL || []);
    activeBoq.forEach(b => {
      if (b.id) boqMap[b.id] = b.system;
    });

    const getSystemFromCode = (code) => {
      if (!code) return '';
      const c = String(code).toUpperCase();
      if (c.startsWith('E-') || c.startsWith('E.')) return 'electrical';
      if (c.startsWith('V-') || c.startsWith('ELV') || c.startsWith('V.')) return 'elv';
      if (c.startsWith('P-') || c.startsWith('PL') || c.startsWith('P.')) return 'plumbing';
      if (c.startsWith('AC-') || c.startsWith('ACMV') || c.startsWith('AC.')) return 'acmv';
      if (c.startsWith('F-') || c.startsWith('FF') || c.startsWith('F.')) return 'fire';
      return '';
    };

    return raw.map(m => {
      const sys = m.system || (m.boqItemId ? boqMap[m.boqItemId] : '') || getSystemFromCode(m.code);
      return { ...m, system: sys };
    });
  },
  saveMaterials(mats) { return this._set('eco_materials', mats); },
  getUsers() { return this._get('eco_users') || []; },
  saveUsers(users) { return this._set('eco_users', users); },
};

// ===== CẦU NỐI VẬT TƯ ↔ BOQ =====
// Tính KL Nhập của từng hạng mục BOQ từ các phiếu NHẬP KHO (type='in').
// Một nguồn sự thật duy nhất: nhập kho thực tế -> KL Nhập trong BOQ.
const ECO_MatLink = {
  _matBoqMap() {
    const map = {};
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    const materials = ECO_Storage.getMaterials();

    materials.forEach(m => {
      // 1. Khớp trực tiếp bằng ID
      let matchedBoq = boq.find(b => String(b.id) === String(m.boqItemId));

      // 2. Dự phòng: Khớp bằng Mã hiệu (Code)
      if (!matchedBoq && m.code) {
        matchedBoq = boq.find(b => b.code && String(b.code).toLowerCase() === String(m.code).toLowerCase());
      }

      // 3. Dự phòng: Khớp bằng Tên vật tư (Name)
      if (!matchedBoq && m.name) {
        const cleanMName = String(m.name).toLowerCase().replace(/[\s\-\.\_]/g, '');
        matchedBoq = boq.find(b => {
          const cleanBName = String(b.name).toLowerCase().replace(/[\s\-\.\_]/g, '');
          return cleanBName === cleanMName || cleanBName.includes(cleanMName) || cleanMName.includes(cleanBName);
        });
      }

      map[m.id] = matchedBoq ? matchedBoq.id : null;
    });
    return map;
  },
  // boqItemId -> tổng KL đã nhập kho
  receivedByBoq() {
    const matBoq = this._matBoqMap();
    const res = {};
    ECO_Storage.getInventoryLogs().forEach(log => {
      if (log.type !== 'in') return;
      (log.items || []).forEach(it => {
        const bid = matBoq[it.matId];
        if (!bid) return;
        res[bid] = (res[bid] || 0) + (parseFloat(it.qty) || 0);
      });
    });
    return res;
  },
  receivedFor(boqItemId) { return this.receivedByBoq()[boqItemId] || 0; },
  // Chi tiết các vật tư & phiếu đóng góp vào KL Nhập của 1 hạng mục BOQ
  contributionsFor(boqItemId) {
    const matBoq = this._matBoqMap();
    const byId = {};
    ECO_Storage.getMaterials().forEach(m => { byId[m.id] = m; });
    const rows = {};
    ECO_Storage.getInventoryLogs().forEach(log => {
      if (log.type !== 'in') return;
      (log.items || []).forEach(it => {
        const m = byId[it.matId];
        const bid = matBoq[it.matId];
        if (!m || bid !== boqItemId) return;
        if (!rows[it.matId]) rows[it.matId] = { mat: m, qty: 0, logs: [] };
        rows[it.matId].qty += parseFloat(it.qty) || 0;
        rows[it.matId].logs.push({ date: log.date, poNo: log.poNo, qty: parseFloat(it.qty) || 0 });
      });
    });
    return Object.values(rows);
  },
  // boqItemId -> tổng KL đã xuất kho
  exportedByBoq() {
    const matBoq = this._matBoqMap();
    const res = {};
    ECO_Storage.getInventoryLogs().forEach(log => {
      if (log.type !== 'out') return;
      (log.items || []).forEach(it => {
        const bid = matBoq[it.matId];
        if (!bid) return;
        res[bid] = (res[bid] || 0) + (parseFloat(it.qty) || 0);
      });
    });
    return res;
  },
  exportedFor(boqItemId) { return this.exportedByBoq()[boqItemId] || 0; },
  contributionsExportFor(boqItemId) {
    const byId = {};
    ECO_Storage.getMaterials().forEach(m => { byId[m.id] = m; });
    const rows = {};
    ECO_Storage.getInventoryLogs().forEach(log => {
      if (log.type !== 'out') return;
      (log.items || []).forEach(it => {
        const m = byId[it.matId];
        if (!m || (m.boqItemId || null) !== boqItemId) return;
        if (!rows[it.matId]) rows[it.matId] = { mat: m, qty: 0, logs: [] };
        rows[it.matId].qty += parseFloat(it.qty) || 0;
        rows[it.matId].logs.push({ date: log.date, subconName: log.subconName, qty: parseFloat(it.qty) || 0 });
      });
    });
    return Object.values(rows);
  },
};
window.ECO_MatLink = ECO_MatLink;

// ===== UI HELPERS =====
const ECO_UI = {
  fmtNum(n, d = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  toast(msg, type = 'success') {
    const c = document.getElementById('eco-toast-container');
    if (!c) return;
    const colors = { success: '#00C853', error: '#E31837', warning: '#F59E0B', info: '#0056FF' };
    const t = document.createElement('div');
    t.style.cssText = `background:rgba(255,255,255,0.95);border-left:4px solid ${colors[type] || colors.info};border-radius:10px;padding:14px 18px;font-size:0.88rem;font-weight:600;color:#0F172A;box-shadow:0 8px 24px rgba(0,0,0,0.12);margin-bottom:10px;`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; t.style.transition = 'all 0.3s';
      setTimeout(() => t.remove(), 300);
    }, 3200);
  },
  openModal(title, bodyHtml, footerHtml = '', options = {}) {
    document.getElementById('eco-modal-title').textContent = title;
    document.getElementById('eco-modal-body').innerHTML = bodyHtml;
    document.getElementById('eco-modal-footer').innerHTML = footerHtml;
    
    const box = document.getElementById('eco-modal-box');
    box.className = 'eco-modal-box eco-modal-' + (options.size || 'md');
    
    document.getElementById('eco-modal-overlay').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  },
  closeModal() { document.getElementById('eco-modal-overlay').style.display = 'none'; },
  statusBadge(status) {
    const map = {
      draft:              { label: 'Nháp',         cls: 'badge-neutral', icon: 'file-text' },
      pending:            { label: 'Chờ duyệt',    cls: 'badge-warning', icon: 'clock' },
      submitted:          { label: 'Đã gửi',       cls: 'badge-orange',  icon: 'send' },
      approved:           { label: 'Đã duyệt',     cls: 'badge-active',  icon: 'check-circle' },
      rejected:           { label: 'Từ chối',      cls: 'badge-alert',   icon: 'x-circle' },
      ordered:            { label: 'Đã đặt NCC',   cls: 'badge-info',    icon: 'shopping-cart' },
      shipping:           { label: 'Đang giao',    cls: 'badge-purple',  icon: 'truck' },
      partially_received: { label: 'Nhập 1 phần',  cls: 'badge-orange',  icon: 'package-open' },
      received:           { label: 'Đã nhập kho',  cls: 'badge-teal',    icon: 'package' },
      closed:             { label: 'Đóng',         cls: 'badge-neutral', icon: 'lock' },
    };
    const s = map[status] || { label: status || '—', cls: 'badge-neutral', icon: 'help-circle' };
    return `<span class="badge ${s.cls}"><i data-lucide="${s.icon}" style="width:13px;height:13px;stroke-width:2.5px;"></i>${s.label}</span>`;
  },
  typeBadge(type) {
    return type === 'in'
      ? `<span class="badge badge-active"><i data-lucide="arrow-down-circle" style="width:13px;height:13px;stroke-width:2.5px;"></i>NHẬP</span>`
      : `<span class="badge badge-alert"><i data-lucide="arrow-up-circle" style="width:13px;height:13px;stroke-width:2.5px;"></i>XUẤT</span>`;
  },
  tableEmpty(colspan, msg) {
    return `<tr><td colspan="${colspan}" style="text-align:center;padding:40px 20px;color:#94A3B8;font-size:0.9rem;">${msg}</td></tr>`;
  },
};

const POModule = {
  currentTab: 'list',
  _filterSubcon: '',

  _escapeAttr(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  },

  _getPOApprovedFile(p) {
    return p && (p.approvedFile || p.signedApprovedFile || p.signedFile || null);
  },

  _renderApprovedFileLink(p, showDelete = true) {
    const file = this._getPOApprovedFile(p);
    if (!file || !file.url) {
      return '<span style="color:#94A3B8;font-size:0.82rem;">Chưa có</span>';
    }
    const name = this._escapeAttr(file.name || 'PO đã ký duyệt');
    const deleteBtn = showDelete && typeof ECO_Auth !== 'undefined' && ECO_Auth.can('edit', 'po')
      ? ` <button type="button" onclick="POModule.deleteApprovedFile('${p.id}', event)" style="background:none;border:none;color:#dc2626;cursor:pointer;padding:2px 6px;margin-left:8px;transition:opacity 0.2s;" title="Xóa file trên Drive"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle;display:inline-block;"></i></button>`
      : '';
    return `<a href="${this._escapeAttr(file.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:5px;color:#15803D;text-decoration:none;font-weight:700;font-size:0.82rem;"><i data-lucide="file-check" style="width:13px;height:13px;"></i>${name}</a>${deleteBtn}`;
  },

  async _uploadApprovedFileToDrive(file, po) {
    const uploaders = [
      window.ECO_GoogleDrive && window.ECO_GoogleDrive.uploadFile,
      window.ECO_Drive && window.ECO_Drive.uploadFile,
      window.GoogleDriveUploader && window.GoogleDriveUploader.uploadFile,
      window.uploadFileToGoogleDrive,
    ].filter(fn => typeof fn === 'function');

    if (uploaders.length === 0) {
      throw new Error('Chưa tìm thấy bộ upload Google Drive của hệ thống.');
    }

    const context = {
      module: 'po',
      type: 'po_approved_signed_file',
      poId: po.id,
      poNo: po.poNo,
      folder: 'PO/Approved',
    };
    return uploaders[0](file, context);
  },

  setTab(t) {
    this.currentTab = t;
    document.querySelectorAll('#coverflow-purchasing .coverflow-item').forEach(item => {
      item.classList.toggle('active', item.dataset.poTab === t);
    });
    const container = document.getElementById('coverflow-purchasing');
    if (container && window.updateCoverFlowLayout) {
      window.updateCoverFlowLayout(container);
    }
    this.render();
  },

  render() {
    const el = document.getElementById('po-content');
    if (!el) return;
    if (this.currentTab === 'list') {
      el.innerHTML = this._renderList();
    } else if (this.currentTab === 'suppliers') {
      el.innerHTML = this._renderSuppliers();
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },

  _renderList() {
    const allPos = ECO_Storage.getPOs();
    const subcons = [...new Set(allPos.map(p => p.subconName || 'Chung'))].sort();
    const active = this._filterSubcon;
    const pos = active ? allPos.filter(p => (p.subconName || 'Chung') === active) : allPos;
    return `
      <div class="glass-panel content-table-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <h3 style="font-size:1rem;font-weight:700;margin:0;">Danh sách Đơn đặt hàng</h3>
            <span style="background:rgba(0,86,255,0.1);color:#0056FF;border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:700;">${pos.length}/${allPos.length} đơn</span>
            <select onchange="POModule._setSubconFilter(this.value)" style="font-size:0.82rem;padding:5px 10px;border:1px solid rgba(0,86,255,0.25);border-radius:8px;background:rgba(0,86,255,0.04);color:#0033A0;font-weight:600;cursor:pointer;outline:none;">
              <option value="">Tất cả thầu phụ</option>
              ${subcons.map(s => `<option value="${s}"${active === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
            ${active ? `<button onclick="POModule._setSubconFilter('')" style="background:none;border:none;color:#E31837;cursor:pointer;font-size:0.8rem;font-weight:700;padding:0;" title="Xóa lọc">✕ Xóa lọc</button>` : ''}
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-outline" onclick="POModule.exportAllPosToExcel()" style="font-size:0.85rem;padding:8px 18px;color:#10B981;border-color:#10B981;"><i data-lucide="file-up" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Xuất Excel</button>
            <button class="btn btn-outline btn-blue" data-perm="po:create" onclick="POModule.createPO()" style="font-size:0.85rem;padding:8px 18px;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Tạo PO mới</button>
          </div>
        </div>
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead><tr>
              <th style="width:140px;">Số PO</th>
              <th>Nhà cung cấp</th>
              <th style="width:180px;">Hệ thống</th>
              <th style="width:140px;">Nhà thầu phụ</th>
              <th style="text-align:center;width:110px;">Ngày tạo</th>
              <th style="text-align:center;width:140px;">Trạng thái</th>
              <th style="text-align:center;width:140px;">PO ký duyệt</th>
              <th style="text-align:center;width:88px;">PDF</th>
            </tr></thead>
            <tbody>
              ${pos.length === 0
                ? ECO_UI.tableEmpty(8, active ? 'Không có PO nào cho thầu phụ "' + active + '".' : 'Chưa có đơn đặt hàng nào. Nhấn "+ Tạo PO mới" để bắt đầu.')
                : pos.slice().reverse().map(p => `
                  <tr onclick="POModule.viewDetail('${p.id}')" style="cursor:pointer;">
                    <td style="font-weight:700;color:#0056FF;">${p.poNo || '—'}</td>
                    <td>${p.supplier || '—'}</td>
                    <td><span style="font-size:0.82rem;background:rgba(0,51,160,0.06);color:#0033A0;padding:3px 8px;border-radius:6px;font-weight:600;">${p.system || '—'}</span></td>
                    <td><span style="font-size:0.82rem;background:rgba(0,86,255,0.08);color:#0033A0;padding:3px 8px;border-radius:6px;font-weight:600;">${p.subconName || 'Chung'}</span></td>
                    <td style="text-align:center;font-size:0.85rem;">${ECO_UI.fmtDate(p.date)}</td>
                    <td style="text-align:center;">${ECO_UI.statusBadge(p.status)}</td>
                    <td style="text-align:center;">${this._renderApprovedFileLink(p, false)}</td>
                    <td style="text-align:center;"><button class="btn btn-outline" onclick="event.stopPropagation(); ECO_PDF.exportPO('${p.id}')" title="Xuất PDF PO" style="font-size:0.75rem;padding:5px 9px;"><i data-lucide="file-down" style="width:13px;height:13px;vertical-align:middle;display:inline-block"></i></button></td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  _setSubconFilter(val) {
    this._filterSubcon = val;
    this.render();
  },

  _renderSuppliers() {
    const suppliers = ECO_Storage.getSuppliers();
    const isSuperAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();
    return `
      <div class="glass-panel content-table-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
          <div style="display:flex;align-items:center;gap:12px;">
            <h3 style="font-size:1rem;font-weight:700;margin:0;">Danh sách Nhà cung cấp</h3>
            <span style="background:rgba(0,86,255,0.1);color:#0056FF;border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:700;">${suppliers.length} NCC</span>
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-outline" onclick="POModule.exportSuppliersToExcel()" style="font-size:0.85rem;padding:8px 18px;color:#10B981;border-color:#10B981;"><i data-lucide="file-up" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Xuất Excel</button>
            ${isSuperAdmin ? `
            <button class="btn btn-outline" onclick="POModule.importSuppliersFromExcel()" style="font-size:0.85rem;padding:8px 18px;color:#D97706;border-color:#D97706;"><i data-lucide="download" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Import Excel</button>
            <button class="btn btn-outline btn-blue" onclick="POModule.addSupplier()" style="font-size:0.85rem;padding:8px 18px;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm NCC</button>
            ` : ''}
          </div>
        </div>
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead><tr>
              <th>Tên công ty</th>
              <th style="width:210px;">Hệ thống MEP</th>
              <th style="width:200px;">Người đại diện</th>
              <th style="width:140px;">Điện thoại</th>
              <th>Email</th>
            </tr></thead>
            <tbody>
              ${suppliers.length === 0
                ? ECO_UI.tableEmpty(5, 'Chưa có nhà cung cấp nào.')
                : suppliers.map(s => `
                  <tr ${isSuperAdmin ? `onclick="POModule.editSupplier('${s.id}')" style="cursor:pointer;"` : ''}>
                    <td style="font-weight:700;color:#0056FF;">${s.companyName || '—'}</td>
                    <td><span style="font-size:0.82rem;background:rgba(227,24,55,0.08);color:#E31837;padding:3px 8px;border-radius:6px;font-weight:600;">${s.system || '—'}</span></td>
                    <td>${s.representative || '—'}</td>
                    <td>${s.phone || '—'}</td>
                    <td style="font-size:0.85rem;">${s.email || '—'}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  createPO(po = null) {
    const isEdit = !!po;
    if (isEdit && typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền sửa PO!', 'error');
      return;
    }
    const suppliers = ECO_Storage.getSuppliers();
    const subcons = Object.values(window.subcontractorsData || {});
    const today = isEdit ? po.date : new Date().toISOString().split('T')[0];

    const isSub = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSubcontractor();
    const user = typeof ECO_Auth !== 'undefined' ? ECO_Auth.user() : null;
    let mySubName = '';
    if (isSub && user && user.subId) {
      const sc = window.subcontractorsData ? window.subcontractorsData[user.subId] : null;
      if (sc) mySubName = sc.name;
    }

    ECO_UI.openModal(isEdit ? 'Chỉnh sửa Đơn đặt hàng (PO)' : 'Tạo Đơn đặt hàng mới (PO)', `
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Số PO *</label>
          <input id="m-poNo" class="eco-input" placeholder="VD: PO-ECO-2025-001" value="${isEdit ? po.poNo : ''}">
        </div>
        <div class="eco-form-group">
          <label>Ngày tạo *</label>
          <input id="m-date" type="date" class="eco-input" value="${today}">
        </div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Nhà cung cấp *</label>
          <select id="m-supplier" class="eco-select" onchange="POModule._onSupplierChange()">
            <option value="">-- Chọn nhà cung cấp --</option>
            ${suppliers.map(s => `<option value="${s.id}" ${isEdit && String(po.supplierId) === String(s.id) ? 'selected' : ''}>${s.companyName}</option>`).join('')}
          </select>
        </div>
        <div class="eco-form-group">
          <label>Hệ thống *</label>
          <select id="m-system" class="eco-select">
            <option value="">-- Chọn hệ thống --</option>
            ${(typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS : []).map(s => `
              <option value="${s.name}" ${isEdit && po.system === s.name ? 'selected' : ''}>${s.name}</option>
            `).join('')}
          </select>
        </div>
        <div class="eco-form-group">
          <label>Nhà thầu phụ (Chọn 1 hoặc nhiều)</label>
          ${isSub 
            ? `<select id="m-subcon" class="eco-select" disabled>
                 <option value="${mySubName}">${mySubName}</option>
               </select>`
            : `<div id="m-subcon-container" style="display:flex;gap:8px;flex-wrap:wrap;padding:4px 8px;border:1px solid rgba(0,0,0,0.08);border-radius:10px;background:rgba(0,0,0,0.015);min-height:38px;align-items:center;box-sizing:border-box;">
                 ${subcons.map(s => {
                   const isChecked = isEdit && po.subconName && po.subconName.split(', ').map(x => x.trim()).includes(s.name);
                   return `
                     <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:#475569;font-weight:600;cursor:pointer;background:rgba(0,86,255,0.03);padding:4px 10px;border:1px solid rgba(0,86,255,0.08);border-radius:6px;user-select:none;margin:0;">
                       <input type="checkbox" class="po-subcon-cb" value="${s.name}" ${isChecked ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer;accent-color:#0056FF;">
                       ${s.name}
                     </label>
                   `;
                 }).join('')}
               </div>`
          }
        </div>
      </div>
      <div class="eco-form-group">
        <label>Ghi chú</label>
        <input id="m-notes" class="eco-input" placeholder="Ghi chú thêm..." value="${isEdit ? (po.notes || '') : ''}">
      </div>
      <div class="eco-form-group" style="margin-top:12px;">
        <label>Đính kèm File PDF PO</label>
        <input type="file" id="m-poFile" class="eco-input" accept=".pdf" style="font-size:0.85rem;padding:6px 12px;background:rgba(255,255,255,0.4);">
        ${isEdit && po.approvedFile ? `<div style="font-size:0.82rem;color:#15803D;margin-top:6px;font-weight:600;">Đã đính kèm: <a href="${po.approvedFile.url}" target="_blank">${po.approvedFile.name}</a></div>` : ''}
      </div>
      <div style="margin-top:16px;">
        <div style="font-size:0.82rem;font-weight:700;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Danh sách vật tư</div>
        <div style="overflow-x:auto;border:1px solid rgba(0,0,0,0.08);border-radius:10px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead style="background:rgba(0,86,255,0.06);">
              <tr>
                <th style="padding:10px 12px;width:45px;text-align:center;">
                  <input type="checkbox" id="po-select-all" onchange="POModule._toggleSelectAll(this)" style="cursor:pointer;width:16px;height:16px;vertical-align:middle;" title="Chọn tất cả">
                </th>
                <th style="padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:120px;">Mã vật tư</th>
                <th style="padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Tên vật tư (quy cách chi tiết)</th>
                <th style="padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:180px;">Khu vực thi công</th>
                <th style="padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:150px;">Chi tiết</th>
                <th style="padding:10px 12px;width:110px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">Số lượng</th>
                <th style="padding:10px 12px;width:65px;text-align:center;font-size:0.8rem;font-weight:700;color:#475569;">ĐVT</th>
              </tr>
            </thead>
            <tbody id="po-items-body">
              <tr><td colspan="7" style="text-align:center;padding:24px;color:#94A3B8;font-size:0.85rem;">Vui lòng chọn Nhà cung cấp ở trên để tải danh sách vật tư.</td></tr>
            </tbody>
          </table>
        </div>
        <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" onclick="POModule._addCustomItemRow()" style="background:none;border:1px dashed rgba(0,86,255,0.3);border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#0056FF;cursor:pointer;flex:1;min-width:180px;font-weight:600;font-family:inherit;">+ Chọn vật tư ngoài danh mục</button>
          <button type="button" onclick="POModule._addManualItemRow()" style="background:none;border:1px dashed #10B981;border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#10B981;cursor:pointer;flex:1;min-width:140px;font-weight:600;font-family:inherit;">+ Nhập vật tư</button>
          <button type="button" onclick="POModule.exportPOExcelTemplate()" style="background:none;border:1px dashed #475569;border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#475569;cursor:pointer;font-weight:600;font-family:inherit;"><i data-lucide="file-up" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Tải File Mẫu Excel</button>
          <button type="button" onclick="POModule.importPOItemsFromExcel()" style="background:none;border:1px dashed #D97706;border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#D97706;cursor:pointer;font-weight:600;font-family:inherit;"><i data-lucide="download" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Import Excel Vật tư</button>
        </div>
      </div>`,
      `<button onclick="${isEdit ? `POModule.viewDetail('${po.id}')` : 'ECO_UI.closeModal()'}" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
       <button onclick="POModule._savePO(${isEdit ? `'${po.id}'` : 'null'})" class="btn btn-primary" style="padding:9px 20px;">${isEdit ? 'Lưu thay đổi' : 'Tạo đơn hàng'}</button>`,
      { size: 'lg' }
    );

    if (isEdit) {
      this._onSupplierChange(po.items);
    }
  },

  _onSupplierChange(prefilledItems = null) {
    const tbody = document.getElementById('po-items-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const supplierId = document.getElementById('m-supplier')?.value;
    if (!supplierId) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94A3B8;font-size:0.85rem;">Vui lòng chọn Nhà cung cấp ở trên để tải danh sách vật tư.</td></tr>`;
      return;
    }

    const suppliers = ECO_Storage.getSuppliers();
    const selectedSupplier = suppliers.find(s => String(s.id) === String(supplierId));
    const allowedMatIds = selectedSupplier ? (selectedSupplier.providedMaterials || []) : [];
    
    const materials = ECO_Storage.getMaterials().filter(m => 
      allowedMatIds.includes(m.id) || 
      allowedMatIds.includes(String(m.id)) || 
      allowedMatIds.includes(m.boqItemId)
    );
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];

    if (materials.length === 0 && (!prefilledItems || prefilledItems.length === 0)) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94A3B8;font-size:0.85rem;">Nhà cung cấp này chưa được gán vật tư nào. Vui lòng gán vật tư trong phần cấu hình Nhà cung cấp.</td></tr>`;
      return;
    }

    const fillMap = {};
    if (prefilledItems) {
      prefilledItems.forEach(item => {
        fillMap[item.matId] = item;
      });
    }

    materials.forEach(m => {
      const fill = fillMap[m.id];
      const isChecked = !!fill;
      const qtyVal = fill ? fill.qty : 0;
      const fillArea = fill ? fill.area : '';

      const b = boq.find(x => String(x.id) === String(m.boqItemId));
      let areaStr = 'Chung';
      if (b) {
        const parts = [];
        const sClean = cleanPrefix(b.scope); if (sClean) parts.push(sClean);
        const l1Clean = cleanPrefix(b.level1); if (l1Clean) parts.push(l1Clean);
        const l2Clean = cleanPrefix(b.level2); if (l2Clean) parts.push(l2Clean);
        areaStr = parts.join(' - ') || 'Chung';
      }
      if (fillArea) areaStr = fillArea;

      const tr = document.createElement('tr');
      tr.className = 'po-item-row supplier-mat-row';
      const areaHtml = renderAreaCheckboxes(areaStr, false);
      const detailStr = fill ? (fill.detail || '') : '';
      tr.innerHTML = `
        <td style="padding:10px 12px;text-align:center;vertical-align:middle;">
          <input type="checkbox" class="po-item-check" onchange="POModule._toggleRowActive(this)" style="cursor:pointer;width:16px;height:16px;" ${isChecked ? 'checked' : ''}>
        </td>
        <td style="padding:10px 12px;font-weight:700;color:#0056FF;font-size:0.85rem;vertical-align:middle;">${m.code || '—'}</td>
        <td style="padding:10px 12px;font-weight:600;font-size:0.85rem;vertical-align:middle;">${m.name}</td>
        <td style="padding:10px 12px;vertical-align:middle;">
          ${areaHtml}
        </td>
        <td style="padding:10px 12px;vertical-align:middle;">
          <input type="text" class="eco-input item-detail" value="${detailStr}" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;box-shadow:none;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-sizing:border-box;" placeholder="Chi tiết...">
        </td>
        <td style="padding:10px 12px;vertical-align:middle;">
          <input type="number" class="eco-input item-qty" value="${qtyVal}" min="0" step="0.01" ${isChecked ? '' : 'disabled'} style="font-size:0.85rem;text-align:right;margin:0;padding:4px 8px;width:100%;box-shadow:none;">
          <input type="hidden" class="item-mat-id" value="${m.id}">
          <input type="hidden" class="item-var" value="${fill ? fill.variant : 'Tiêu chuẩn'}">
        </td>
        <td style="padding:10px 12px;text-align:center;font-size:0.85rem;color:#475569;vertical-align:middle;">${m.unit || '—'}</td>
      `;
      tbody.appendChild(tr);
    });

    if (prefilledItems) {
      const allowedMatIdsSet = new Set(materials.map(m => m.id));
      prefilledItems.forEach(item => {
        if (!allowedMatIdsSet.has(item.matId)) {
          const allMats = ECO_Storage.getMaterials();
          const tr = document.createElement('tr');
          tr.className = 'po-item-row custom-mat-row';
          const areaHtml = renderAreaCheckboxes(item.area || 'Chung', false);
          const detailStr = item.detail || '';
          tr.innerHTML = `
            <td style="padding:8px 6px;text-align:center;vertical-align:middle;">—</td>
            <td style="padding:8px 6px;vertical-align:middle;" colspan="2">
              <select class="eco-select item-mat" style="font-size:0.85rem;width:100%;">
                ${allMats.map(m => `<option value="${m.id}" data-code="${m.code}" data-name="${m.name}" ${m.id === item.matId ? 'selected' : ''}>[${m.code}] ${m.name} (${m.unit})</option>`).join('')}
              </select>
            </td>
            <td style="padding:8px 6px;vertical-align:middle;">
              ${areaHtml}
            </td>
            <td style="padding:8px 6px;vertical-align:middle;">
              <input type="text" class="eco-input item-detail" value="${detailStr}" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;box-shadow:none;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-sizing:border-box;" placeholder="Chi tiết...">
            </td>
            <td style="padding:8px 6px;vertical-align:middle;">
              <input type="number" class="eco-input item-qty" value="${item.qty}" min="0" step="0.01" style="font-size:0.85rem;text-align:right;margin:0;padding:4px 8px;width:100%;">
              <input type="hidden" class="item-var" value="${item.variant || 'Tiêu chuẩn'}">
              <input type="hidden" class="item-mat-id" value="${item.matId}">
            </td>
            <td style="padding:8px 6px;text-align:center;vertical-align:middle;">
              <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#E31837;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button>
            </td>
          `;
          tbody.appendChild(tr);
        }
      });
    }
  },

  _toggleRowActive(cb) {
    const row = cb.closest('tr');
    const qtyInput = row.querySelector('.item-qty');
    if (qtyInput) {
      qtyInput.disabled = !cb.checked;
      if (cb.checked && parseFloat(qtyInput.value) === 0) {
        qtyInput.value = '1';
      } else if (!cb.checked) {
        qtyInput.value = '0';
      }
    }
  },

  _toggleSelectAll(headerCb) {
    const checked = headerCb.checked;
    const checkboxes = document.querySelectorAll('#po-items-body .po-item-check');
    checkboxes.forEach(cb => {
      if (cb.checked !== checked) {
        cb.checked = checked;
        POModule._toggleRowActive(cb);
      }
    });
  },

  _addCustomItemRow() {
    const tbody = document.getElementById('po-items-body');
    if (!tbody) return;

    if (tbody.rows.length === 1 && tbody.rows[0].cells.length === 1) {
      tbody.innerHTML = '';
    }

    const allMats = ECO_Storage.getMaterials();
    if (allMats.length === 0) {
      ECO_UI.toast('Chưa có vật tư nào được khai báo trong hệ thống.', 'warning');
      return;
    }

    const tr = document.createElement('tr');
    tr.className = 'po-item-row custom-mat-row';
    const areaHtml = renderAreaCheckboxes('Chung', false);
    tr.innerHTML = `
      <td style="padding:8px 6px;text-align:center;vertical-align:middle;">—</td>
      <td style="padding:8px 6px;vertical-align:middle;" colspan="2">
        <select class="eco-select item-mat" style="font-size:0.85rem;width:100%;">
          <option value="">-- Chọn vật tư --</option>
          ${allMats.map(m => `<option value="${m.id}" data-code="${m.code}" data-name="${m.name}">[${m.code}] ${m.name} (${m.unit})</option>`).join('')}
        </select>
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        ${areaHtml}
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="text" class="eco-input item-detail" value="" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;box-shadow:none;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-sizing:border-box;" placeholder="Chi tiết...">
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="number" class="eco-input item-qty" value="1" min="0" step="0.01" style="font-size:0.85rem;text-align:right;margin:0;padding:4px 8px;width:100%;">
        <input type="hidden" class="item-var" value="Tiêu chuẩn">
      </td>
      <td style="padding:8px 6px;text-align:center;vertical-align:middle;">
        <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#E31837;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button>
      </td>
    `;
    tbody.appendChild(tr);
  },

  _addManualItemRow() {
    const tbody = document.getElementById('po-items-body');
    if (!tbody) return;

    if (tbody.rows.length === 1 && tbody.rows[0].cells.length === 1) {
      tbody.innerHTML = '';
    }

    const tr = document.createElement('tr');
    tr.className = 'po-item-row manual-typed-row';
    const areaHtml = renderAreaCheckboxes('Chung', false);
    tr.innerHTML = `
      <td style="padding:10px 12px;text-align:center;vertical-align:middle;">
        <span style="font-size:0.7rem;background:#10B981;color:#fff;border-radius:4px;padding:2px 5px;font-weight:700;white-space:nowrap;">Tự nhập</span>
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="text" class="eco-input manual-code" placeholder="Mã hiệu (tùy chọn)" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;font-weight:700;color:#0056FF;box-shadow:none;">
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="text" class="eco-input manual-name" placeholder="Nhập tên vật tư & quy cách chi tiết bằng tay *" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;font-weight:600;box-shadow:none;">
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        ${areaHtml}
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="text" class="eco-input item-detail" value="" style="font-size:0.82rem;margin:0;padding:4px 8px;width:100%;box-shadow:none;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-sizing:border-box;" placeholder="Chi tiết...">
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <input type="number" class="eco-input item-qty" value="1" min="0" step="0.01" style="font-size:0.82rem;text-align:right;margin:0;padding:4px 8px;width:100%;box-shadow:none;">
        <input type="hidden" class="item-var" value="Tiêu chuẩn">
      </td>
      <td style="padding:8px 6px;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:6px;justify-content:center;">
          <input type="text" class="eco-input manual-unit" placeholder="ĐVT" value="cái" style="font-size:0.82rem;margin:0;padding:4px 6px;width:48px;text-align:center;box-shadow:none;">
          <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#E31837;font-size:1.25rem;cursor:pointer;line-height:1;padding:0;">&times;</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  },

  updateItemArea(selectEl) {
    const row = selectEl.closest('tr');
    const areaSelect = row.querySelector('.item-area-select');
    if (!areaSelect) return;
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const code = selectedOption.getAttribute('data-code');
    const name = selectedOption.getAttribute('data-name');
    
    areaSelect.innerHTML = '';
    
    if (!code && !name) {
      areaSelect.innerHTML = '<option value="">—</option>';
      return;
    }
    
    const allMats = ECO_Storage.getMaterials();
    const matchingMats = allMats.filter(m => 
      (code && m.code === code) || (name && m.name === name)
    );
    
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    
    matchingMats.forEach(m => {
      const b = boq.find(x => String(x.id) === String(m.boqItemId));
      let areaStr = 'Chung';
      if (b) {
        const parts = [];
        const sClean = cleanPrefix(b.scope); if (sClean) parts.push(sClean);
        const l1Clean = cleanPrefix(b.level1); if (l1Clean) parts.push(l1Clean);
        const l2Clean = cleanPrefix(b.level2); if (l2Clean) parts.push(l2Clean);
        areaStr = parts.join(' - ') || 'Chung';
      }
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = areaStr;
      areaSelect.appendChild(opt);
    });
    
    if (areaSelect.options.length === 0) {
      areaSelect.innerHTML = '<option value="">Chung</option>';
    }
  },

  importPOItemsFromExcel() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls';
    inp.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      ECO_UI.toast('Đang đọc file Excel...', 'info');
      try {
        await _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        
        const sheetNames = wb.SheetNames;
        if (sheetNames.length === 0) {
          ECO_UI.toast('File Excel không có sheet nào!', 'error');
          return;
        }

        if (sheetNames.length === 1) {
          POModule._processPOImportSheet(wb, sheetNames[0]);
        } else {
          POModule._showSheetSelectorModal(wb);
        }
      } catch (err) {
        console.error(err);
        ECO_UI.toast('Lỗi đọc file: ' + err.message, 'error');
      }
    };
    inp.click();
  },

  _showSheetSelectorModal(wb) {
    const options = wb.SheetNames.map(name => `<option value="${name}">${name}</option>`).join('');
    window._tempImportWb = wb;

    ECO_UI.openModal(
      'Chọn Sheet để nhập dữ liệu',
      `
      <div class="eco-form-group">
        <label style="font-weight:600;color:#475569;margin-bottom:8px;display:block;">File Excel có nhiều Sheet. Vui lòng chọn Sheet chứa danh sách vật tư cần import *</label>
        <select id="m-import-sheet-select" class="eco-select">
          ${options}
        </select>
      </div>
      `,
      `
      <button onclick="ECO_UI.closeModal(); delete window._tempImportWb;" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
      <button onclick="POModule._confirmSheetImport()" class="btn btn-primary" style="padding:9px 20px;">✓ Nhập dữ liệu</button>
      `,
      { size: 'md' }
    );
  },

  _confirmSheetImport() {
    const select = document.getElementById('m-import-sheet-select');
    const sheetName = select ? select.value : '';
    const wb = window._tempImportWb;
    
    if (!sheetName || !wb) {
      ECO_UI.toast('Không tìm thấy dữ liệu Sheet hoặc file!', 'error');
      return;
    }

    ECO_UI.closeModal();
    delete window._tempImportWb;
    
    this._processPOImportSheet(wb, sheetName);
  },

  async _processPOImportSheet(wb, sheetName) {
    ECO_UI.toast('Đang xử lý sheet "' + sheetName + '"...', 'info');
    try {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      let hdrIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const joined = rows[i].map(c => String(c).toUpperCase()).join('|');
        if (/KHỐI LƯỢNG ĐẶT HÀNG|SỐ LƯỢNG|MÃ VẬT LIỆU|MÔ TẢ|ĐƠN VỊ|KHU VỰC|QUANTITY|CODE|QTY/.test(joined)) {
          hdrIdx = i;
          break;
        }
      }

      if (hdrIdx === -1) hdrIdx = 0;

      const header = rows[hdrIdx].map(c => String(c).trim().toUpperCase());
      const colCode = header.findIndex(c => c === 'MÃ VẬT LIỆU' || c === 'MÃ VẬT TƯ' || c === 'MÃ' || c.includes('CODE'));
      const colName = header.findIndex(c => c === 'MÔ TẢ' || c === 'TÊN VẬT TƯ' || c === 'TÊN' || c.includes('DESCRIPTION') || c.includes('NAME'));
      const colQty = header.findIndex(c => c === 'KHỐI LƯỢNG ĐẶT HÀNG' || c === 'SỐ LƯỢNG' || c === 'SL' || c.includes('QUANTITY') || c.includes('QTY') || c.includes('KL'));
      const colArea = header.findIndex(c => c === 'KHU VỰC THI CÔNG' || c === 'KHU VỰC' || c.includes('AREA'));
      const colNote = header.findIndex(c => c === 'GHI CHÚ' || c === 'QUY CÁCH' || c.includes('NOTE'));
      const colUnit = header.findIndex(c => c === 'ĐƠN VỊ' || c === 'ĐVT' || c.includes('UNIT'));

      if (colQty === -1 || (colCode === -1 && colName === -1)) {
        ECO_UI.toast('Không tìm thấy cột Số lượng hoặc Mô tả vật tư trong sheet "' + sheetName + '".', 'error');
        return;
      }

      const allMats = ECO_Storage.getMaterials();
      let successCount = 0;
      let failCount = 0;

      function cleanText(txt) {
        return String(txt || '').normalize('NFC').toLowerCase().replace(/[\s\-\.\_\,]/g, '');
      }

      function getPnRating(c, n) {
        const str = `${c || ''} ${n || ''}`.toLowerCase().replace(/[\,\.]/g, '');
        const match = str.match(/pn\s*(\d+)/);
        return match ? match[1] : null;
      }

      const newMatsToDeclare = [];

      for (let i = hdrIdx + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r || r.length === 0) continue;
        const code = colCode !== -1 ? String(r[colCode] || '').trim() : '';
        const name = colName !== -1 ? String(r[colName] || '').trim() : '';
        const qty = colQty !== -1 ? parseFloat(String(r[colQty]).replace(/,/g, '')) : 0;
        const area = colArea !== -1 ? String(r[colArea] || '').trim() : 'Chung';
        const note = colNote !== -1 ? String(r[colNote] || '').trim() : 'Tiêu chuẩn';
        const unit = colUnit !== -1 ? String(r[colUnit] || '').trim() : 'cái';

        if (isNaN(qty) || qty <= 0) continue;
        if (!code && !name) continue;

        let matched = null;
        const cleanCodeStr = code ? cleanText(code) : '';
        const cleanNameStr = name ? cleanText(name) : '';

        // 1. Tìm khớp cả Mã và Tên (Độ ưu tiên cao nhất)
        if (cleanCodeStr && cleanNameStr) {
          matched = allMats.find(m => 
            m.code && cleanText(m.code) === cleanCodeStr && 
            m.name && cleanText(m.name) === cleanNameStr
          );
        }

        // 2. Nếu không khớp cả hai, tìm khớp theo Tên (vì mô tả vật tư thường rất cụ thể và chính xác)
        if (!matched && cleanNameStr) {
          matched = allMats.find(m => {
            if (!m.name || cleanText(m.name) !== cleanNameStr) return false;
            const importPN = getPnRating(code, name);
            const matPN = getPnRating(m.code, m.name);
            if (importPN !== null && matPN !== null && importPN !== matPN) return false;
            return true;
          });
          
          // Thử tìm khớp tương đối theo tên (nhưng chặt chẽ hơn: độ dài ký tự khớp lớn)
          if (!matched) {
            matched = allMats.find(m => {
              if (!m.name) return false;
              const cleanMName = cleanText(m.name);
              const nameMatch = (cleanMName.includes(cleanNameStr) && cleanNameStr.length > 4) ||
                                (cleanNameStr.includes(cleanMName) && cleanMName.length > 4);
              if (!nameMatch) return false;
              
              const importPN = getPnRating(code, name);
              const matPN = getPnRating(m.code, m.name);
              if (importPN !== null && matPN !== null && importPN !== matPN) return false;
              return true;
            });
          }
        }

        // 3. Nếu vẫn không khớp, chỉ khớp theo Mã nếu Mã đó không phải là các mã áp lực / đơn vị chung chung
        if (!matched && cleanCodeStr) {
          const genericCodes = new Set(['pn5', 'pn6', 'pn8', 'pn9', 'pn10', 'pn12', 'pn125', 'pn15', 'pn16', 'pn20', 'pn25', 'm', 'kg', 'cai', 'co', 'te']);
          const isGeneric = genericCodes.has(cleanCodeStr) || /^pn\d+$/.test(cleanCodeStr);
          if (!isGeneric) {
            matched = allMats.find(m => m.code && cleanText(m.code) === cleanCodeStr);
          }
        }

        if (!matched) {
          const nextMatId = ECO_Storage.nextId([...allMats, ...newMatsToDeclare]);
          const newMat = {
            id: nextMatId,
            code: code || ('MAT-' + nextMatId),
            name: name || 'Vật tư mới',
            unit: unit || 'cái',
            system: document.getElementById('m-system')?.value || 'Tổng hợp'
          };
          newMatsToDeclare.push(newMat);
          matched = newMat;
          console.log(`[AutoCreate] Tự động thêm vật tư mới từ Excel: [${newMat.code}] ${newMat.name}`);
        }

        if (matched) {
          const rowEls = document.querySelectorAll('.supplier-mat-row');
          let found = false;
          rowEls.forEach(row => {
            const matId = parseInt(row.querySelector('.item-mat-id').value);
            if (matId === matched.id) {
              const cb = row.querySelector('.po-item-check');
              cb.checked = true;
              const qtyInput = row.querySelector('.item-qty');
              qtyInput.disabled = false;
              qtyInput.value = qty;
              
              const areaInput = row.querySelector('.item-area');
              if (areaInput && area !== 'Chung') areaInput.value = area;
              
              const varInput = row.querySelector('.item-var');
              if (varInput) varInput.value = note;

              const areaTd = row.cells[3];
              if (areaTd) areaTd.textContent = area !== 'Chung' ? area : areaTd.textContent;

              found = true;
            }
          });

          if (!found) {
            const tbody = document.getElementById('po-items-body');
            if (tbody.rows.length === 1 && tbody.rows[0].cells.length === 1) {
              tbody.innerHTML = '';
            }
            const tr = document.createElement('tr');
            tr.className = 'po-item-row custom-mat-row';
            tr.innerHTML = `
              <td style="padding:8px 6px;text-align:center;">
                <input type="checkbox" class="po-item-check" checked style="pointer-events:none;width:16px;height:16px;">
              </td>
              <td style="padding:8px 6px;" colspan="2">
                <select class="eco-select item-mat" style="font-size:0.85rem;width:100%;" onchange="POModule.updateItemArea(this)">
                  ${[...allMats, ...newMatsToDeclare].map(m => `<option value="${m.id}" data-code="${m.code}" data-name="${m.name}" ${m.id === matched.id ? 'selected' : ''}>[${m.code}] ${m.name} (${m.unit})</option>`).join('')}
                </select>
              </td>
              <td style="padding:8px 6px;">
                <input type="text" class="eco-input item-area-text" value="${area}" style="font-size:0.85rem;margin:0;padding:4px 8px;width:100%;">
                <select class="eco-select item-area-select" style="font-size:0.85rem;width:100%;display:none;">
                  <option value="${matched.id}">${area}</option>
                </select>
              </td>
              <td style="padding:8px 6px;">
                <input type="number" class="eco-input item-qty" value="${qty}" min="0" step="0.01" style="font-size:0.85rem;text-align:right;margin:0;padding:4px 8px;width:100%;">
                <input type="hidden" class="item-var" value="${note}">
                <input type="hidden" class="item-mat-id" value="${matched.id}">
                <input type="hidden" class="item-area" value="${area}">
              </td>
              <td style="padding:8px 6px;text-align:center;font-size:0.85rem;color:#475569;">${matched.unit || '—'}</td>
            `;
            tbody.appendChild(tr);
          }
          successCount++;
        } else {
          failCount++;
        }
      }

      if (newMatsToDeclare.length > 0) {
        await ECO_Storage.saveMaterials([...allMats, ...newMatsToDeclare]);
      }

      if (window.lucide && lucide.createIcons) lucide.createIcons();
      ECO_UI.toast(`Đã import thành công ${successCount} vật tư! (Bỏ qua ${failCount} vật tư không khớp)`, 'success');
    } catch (err) {
      console.error(err);
      ECO_UI.toast('Lỗi đọc file: ' + err.message, 'error');
    }
  },

  async exportPOExcelTemplate() {
    ECO_UI.toast('Đang khởi tạo file mẫu Excel...', 'info');
    try {
      await _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      
      const data = [
        ['MÃ VẬT LIỆU', 'MÔ TẢ', 'ĐƠN VỊ', 'KHỐI LƯỢNG ĐẶT HÀNG', 'KHU VỰC THI CÔNG', 'GHI CHÚ'],
        ['PN6', 'Ống uPVC D42', 'm', 1400, 'Tầng 4-7', 'Tiêu chuẩn'],
        ['PN6', 'Ống uPVC D49', 'm', 836, 'Tầng 4-7', 'Tiêu chuẩn'],
        ['PN8', 'Ống uPVC D110', 'm', 468, 'Tầng 4-8', 'Có bát nối'],
        ['STEEL.D10', 'Thép CB 400V (SD390), D10', 'kg', 7500, 'Chung', 'Hàng nhập khẩu']
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [
        { wch: 15 },
        { wch: 35 },
        { wch: 10 },
        { wch: 22 },
        { wch: 20 },
        { wch: 20 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mau_Import_Vat_Tu");
      
      XLSX.writeFile(wb, "Mau_Import_Vat_Tu_PO.xlsx");
      ECO_UI.toast('Đã tải xuống file mẫu Excel thành công!', 'success');
    } catch (err) {
      console.error(err);
      ECO_UI.toast('Lỗi khi xuất file mẫu: ' + err.message, 'error');
    }
  },

  async exportAllPosToExcel() {
    ECO_UI.toast('Đang tạo file Excel PO...', 'info');
    try {
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ECO Workspace'; wb.created = new Date();
      
      const allPos = ECO_Storage.getPOs();
      const today = new Date().toLocaleDateString('vi-VN');
      const logs = ECO_Storage.getInventoryLogs() || [];
      
      const BG_HEADER = 'FF0033A0', FG_WHITE = 'FFFFFFFF';
      const BG_DATA_ODD = 'FFF8FAFF';
      const BG_SCOPE = 'FFDBEAFE';
      const border = { style: 'thin', color: { argb: 'FFD1D9E6' } };
      const bd = () => ({ top: border, left: border, bottom: border, right: border });
      const numFmt = '#,##0.00';

      const getReceivingDatesStr = (poNo, poId, matId) => {
        const matched = logs.filter(l => 
          l.type === 'in' && 
          (l.poNo === poNo || String(l.poId) === String(poId)) &&
          (l.items || []).some(li => String(li.matId) === String(matId))
        );
        if (matched.length === 0) return '—';
        return matched.map(l => {
          const logItem = l.items.find(li => String(li.matId) === String(matId));
          const qtyStr = logItem ? ` (SL: ${logItem.qty})` : '';
          const dateStr = l.date ? new Date(l.date).toLocaleDateString('vi-VN') : '';
          return dateStr ? `${dateStr}${qtyStr}` : '';
        }).filter(Boolean).join(', ') || '—';
      };

      const getPoReceivingDatesStr = (poNo) => {
        const matched = logs.filter(l => 
          l.type === 'in' && l.poNo === poNo
        );
        if (matched.length === 0) return '—';
        return matched.map(l => {
          const totalQty = (l.items || []).reduce((sum, li) => sum + (parseFloat(li.qty) || 0), 0);
          const qtyStr = totalQty > 0 ? ` (SL: ${totalQty})` : '';
          const dateStr = l.date ? new Date(l.date).toLocaleDateString('vi-VN') : '';
          return dateStr ? `${dateStr}${qtyStr}` : '';
        }).filter(Boolean).join(', ') || '—';
      };


      // ────────────────────────────────────────────────────────
      // Sheet 1: Tổng quan Đơn hàng (PO Summary)
      // ────────────────────────────────────────────────────────
      const wsSum = wb.addWorksheet('Danh sách Đơn hàng');
      wsSum.mergeCells('A1:H1');
      Object.assign(wsSum.getCell('A1'), {
        value: 'DANH SÁCH ĐƠN ĐẶT HÀNG (PO SUMMARY)',
        font: { name: 'Arial', size: 13, bold: true, color: { argb: FG_WHITE } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      wsSum.getRow(1).height = 32;

      wsSum.mergeCells('A2:H2');
      wsSum.getCell('A2').value = 'Dự án: ECO Long An  |  Ngày xuất: ' + today;
      wsSum.getCell('A2').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
      wsSum.getCell('A2').alignment = { horizontal: 'center' };
      wsSum.addRow([]);

      const hRowSum = wsSum.addRow([
        'Số PO', 'Ngày tạo', 'Nhà cung cấp', 'Hệ thống MEP', 'Nhà thầu phụ', 'Trạng thái', 'Số loại vật tư', 'Ghi chú'
      ]);
      hRowSum.height = 22;
      wsSum.columns = [
        { width: 22 }, { width: 14 }, { width: 32 }, { width: 20 }, { width: 20 }, { width: 16 }, { width: 15 }, { width: 35 }
      ];
      hRowSum.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: FG_WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } },
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = bd();
      });

      let sumIdx = 0;
      allPos.forEach(p => {
        const row = wsSum.addRow([
          p.poNo || '',
          p.date ? new Date(p.date).toLocaleDateString('vi-VN') : '',
          p.supplier || '',
          p.system || '',
          p.subconName || 'Chung',
          p.status || 'pending',
          p.items ? p.items.length : 0,
          p.notes || ''
        ]);
        const isOdd = (sumIdx++ % 2 === 0);
        const rowBg = isOdd ? BG_DATA_ODD : 'FFFFFFFF';
        row.eachCell((c, col) => {
          c.border = bd();
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          c.font = { name: 'Arial', size: 9 };
          if (col === 1) c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0056FF' } };
          if (col === 2 || col === 6 || col === 7) c.alignment = { horizontal: 'center' };
        });
      });

      // ────────────────────────────────────────────────────────
      // Sheet 2: Chi tiết vật tư PO (PO Details)
      // ────────────────────────────────────────────────────────
      const wsDet = wb.addWorksheet('Chi tiết Vật tư PO');
      wsDet.mergeCells('A1:N1');
      Object.assign(wsDet.getCell('A1'), {
        value: 'CHI TIẾT VẬT TƯ ĐẶT HÀNG QUA CÁC ĐƠN HÀNG (PO DETAILS)',
        font: { name: 'Arial', size: 13, bold: true, color: { argb: FG_WHITE } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      wsDet.getRow(1).height = 32;

      wsDet.mergeCells('A2:N2');
      wsDet.getCell('A2').value = 'Dự án: ECO Long An  |  Ngày xuất: ' + today;
      wsDet.getCell('A2').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
      wsDet.getCell('A2').alignment = { horizontal: 'center' };
      wsDet.addRow([]);

      const hRowDet = wsDet.addRow([
        'Số PO', 'Ngày tạo', 'Nhà cung cấp', 'Hệ thống MEP', 'Nhà thầu phụ', 'Trạng thái PO',
        'Mã vật tư', 'Tên vật tư (quy cách)', 'ĐVT', 'Số lượng đặt', 'Số lượng đã nhập', 'Ngày nhập kho', 'Khu vực thi công', 'Chi tiết'
      ]);
      hRowDet.height = 22;
      wsDet.columns = [
        { width: 22 }, { width: 14 }, { width: 32 }, { width: 20 }, { width: 20 }, { width: 16 },
        { width: 16 }, { width: 38 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 28 }, { width: 24 }, { width: 24 }
      ];
      hRowDet.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: FG_WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = bd();
      });

      let detIdx = 0;
      allPos.forEach(p => {
        (p.items || []).forEach(it => {
          const row = wsDet.addRow([
            p.poNo || '',
            p.date ? new Date(p.date).toLocaleDateString('vi-VN') : '',
            p.supplier || '',
            p.system || '',
            p.subconName || 'Chung',
            p.status || 'pending',
            it.code || '—',
            it.name || '—',
            it.unit || '—',
            parseFloat(it.qty) || 0,
            parseFloat(it.receivedQty) || 0,
            getReceivingDatesStr(p.poNo, p.id, it.matId),
            it.area || 'Chung',
            it.detail || '—'
          ]);
          const isOdd = (detIdx++ % 2 === 0);
          const rowBg = isOdd ? BG_DATA_ODD : 'FFFFFFFF';
          row.eachCell((c, col) => {
            c.border = bd();
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            c.font = { name: 'Arial', size: 9 };
            if (col === 1) c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0056FF' } };
            if (col === 2 || col === 6 || col === 9) c.alignment = { horizontal: 'center' };
            if (col === 10 || col === 11) {
              c.numFmt = numFmt;
              c.alignment = { horizontal: 'right' };
            }
          });
        });
      });

      // ────────────────────────────────────────────────────────
      // Sheet 3: Chi tiết theo Khu vực (Details by Area)
      // ────────────────────────────────────────────────────────
      const wsArea = wb.addWorksheet('Chi tiết theo Khu vực');
      wsArea.mergeCells('A1:L1');
      Object.assign(wsArea.getCell('A1'), {
        value: 'CHI TIẾT VẬT TƯ ĐẶT HÀNG THEO KHU VỰC THI CÔNG',
        font: { name: 'Arial', size: 13, bold: true, color: { argb: FG_WHITE } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      wsArea.getRow(1).height = 32;

      wsArea.mergeCells('A2:L2');
      wsArea.getCell('A2').value = 'Dự án: ECO Long An  |  Ngày xuất: ' + today;
      wsArea.getCell('A2').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
      wsArea.getCell('A2').alignment = { horizontal: 'center' };
      wsArea.addRow([]);

      const hRowArea = wsArea.addRow([
        'Khu vực thi công', 'Chi tiết', 'Mã vật tư', 'Tên vật tư (quy cách)', 'ĐVT', 'Tổng số lượng đặt', 'Tổng số lượng đã nhập', 'Ngày nhập kho', 'Hệ thống MEP', 'Nhà thầu phụ', 'Số PO', 'Nhà cung cấp'
      ]);
      hRowArea.height = 22;
      wsArea.columns = [
        { width: 28 }, { width: 24 }, { width: 16 }, { width: 38 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 28 }, { width: 20 }, { width: 20 }, { width: 22 }, { width: 32 }
      ];
      hRowArea.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: FG_WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = bd();
      });

      // Gom nhóm dữ liệu theo khu vực
      const areaItems = [];
      const materials = ECO_Storage.getMaterials() || [];
      const matMap = {};
      materials.forEach(m => { matMap[m.id] = m; });

      allPos.forEach(p => {
        (p.items || []).forEach(it => {
          const areaName = (it.area || 'Chung').trim();
          const mat = matMap[it.matId];
          areaItems.push({
            area: areaName,
            detail: it.detail || '—',
            code: (mat && mat.code) || '—',
            name: it.name || (mat && mat.name) || '—',
            unit: it.unit || (mat && mat.unit) || '—',
            qty: parseFloat(it.qty) || 0,
            receivedQty: parseFloat(it.receivedQty) || 0,
            system: p.system || '',
            subconName: p.subconName || 'Chung',
            poNo: p.poNo || '',
            supplier: p.supplier || '',
            matId: it.matId
          });
        });
      });

      // Sắp xếp theo tên khu vực và mã vật tư
      areaItems.sort((a, b) => {
        const areaCompare = a.area.localeCompare(b.area, 'vi', { sensitivity: 'base' });
        if (areaCompare !== 0) return areaCompare;
        return a.code.localeCompare(b.code, 'vi', { numeric: true });
      });

      // Render dữ liệu vào sheet 3
      let areaIdx = 0;
      const startRowIndex = 5;
      
      areaItems.forEach((item) => {
        const row = wsArea.addRow([
          item.area,
          item.detail,
          item.code,
          item.name,
          item.unit,
          item.qty,
          item.receivedQty,
          getReceivingDatesStr(item.poNo, null, item.matId),
          item.system,
          item.subconName,
          item.poNo,
          item.supplier
        ]);
        
        const isOdd = (areaIdx++ % 2 === 0);
        const rowBg = isOdd ? BG_DATA_ODD : 'FFFFFFFF';
        row.eachCell((c, col) => {
          c.border = bd();
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          c.font = { name: 'Arial', size: 9 };
          if (col === 1) c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0033A0' } };
          if (col === 10) c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0056FF' } };
          if (col === 4) c.alignment = { horizontal: 'center' };
          if (col === 5 || col === 6) {
            c.numFmt = numFmt;
            c.alignment = { horizontal: 'right' };
          }
        });
      });


      // Tự động gộp các ô khu vực giống nhau ở cột A
      let currentArea = '';
      let mergeStartRow = startRowIndex;
      for (let i = startRowIndex; i <= wsArea.rowCount; i++) {
        const areaVal = wsArea.getCell(`A${i}`).value;
        if (areaVal !== currentArea || i === wsArea.rowCount) {
          const endRow = (i === wsArea.rowCount && areaVal === currentArea) ? i : i - 1;
          if (endRow > mergeStartRow) {
            wsArea.mergeCells(`A${mergeStartRow}:A${endRow}`);
            wsArea.getCell(`A${mergeStartRow}`).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          }
          currentArea = areaVal;
          mergeStartRow = i;
        }
      }

      wsSum.views = [{ state: 'frozen', ySplit: 4 }];
      wsDet.views = [{ state: 'frozen', ySplit: 4 }];
      wsArea.views = [{ state: 'frozen', ySplit: 4 }];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Danh_Sach_PO_Theo_Khu_Vuc_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      document.body.appendChild(a); a.click();
      a.remove();
      URL.revokeObjectURL(url);
      ECO_UI.toast('Đã xuất toàn bộ dữ liệu PO thành công!', 'success');
    } catch (err) {
      console.error(err);
      ECO_UI.toast('Lỗi xuất Excel PO: ' + err.message, 'error');
    }
  },

  async _savePO(editId = null) {
    const poNo = document.getElementById('m-poNo').value.trim();
    const supplierId = document.getElementById('m-supplier').value;
    const system = document.getElementById('m-system').value;
    if (!poNo) { ECO_UI.toast('Vui lòng nhập số PO', 'error'); return; }
    if (!supplierId) { ECO_UI.toast('Vui lòng chọn nhà cung cấp', 'error'); return; }
    if (!system) { ECO_UI.toast('Vui lòng chọn hệ thống', 'error'); return; }
    const suppliers = ECO_Storage.getSuppliers();
    const selectedSupplier = suppliers.find(s => String(s.id) === String(supplierId));
    const supplier = selectedSupplier ? selectedSupplier.companyName : '';
    const materials = ECO_Storage.getMaterials();
    const items = [];
    const newMatsToDeclare = [];

    const rows = Array.from(document.querySelectorAll('.po-item-row'));
    for (const row of rows) {
      const area = getSelectedAreasFromRow(row);
      const detail = (row.querySelector('.item-detail')?.value || '').trim();

      if (row.classList.contains('manual-typed-row')) {
        const code = (row.querySelector('.manual-code')?.value || '').trim();
        const name = (row.querySelector('.manual-name')?.value || '').trim();
        const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
        const unit = (row.querySelector('.manual-unit')?.value || '').trim() || 'cái';

        if (!name) continue;
        if (qty <= 0) continue;

        let mat = materials.find(m => 
          (code && String(m.code).toLowerCase() === code.toLowerCase()) || 
          (String(m.name).toLowerCase() === name.toLowerCase())
        );

        if (!mat) {
          const nextMatId = ECO_Storage.nextId([...materials, ...newMatsToDeclare]);
          const newMat = {
            id: nextMatId,
            code: code || ('MAT-' + nextMatId),
            name: name,
            unit: unit,
            system: system,
            boqItemId: null
          };
          newMatsToDeclare.push(newMat);
          mat = newMat;
        }

        items.push({
          matId: mat.id,
          qty,
          variant: row.querySelector('.item-var')?.value?.trim() || 'Tiêu chuẩn',
          name: mat.name,
          unit: mat.unit,
          area,
          detail
        });
      } else {
        const check = row.querySelector('.po-item-check');
        if (check) {
          if (!check.checked) continue;
          const matId = parseInt(row.querySelector('.item-mat-id')?.value || '0');
          const qty = parseFloat(row.querySelector('.item-qty')?.value || '0') || 0;
          const mat = materials.find(m => m.id === matId);
          if (matId && qty > 0) {
            const variant = row.querySelector('.item-var')?.value?.trim() || 'Tiêu chuẩn';
            items.push({ matId, qty, variant, name: mat?.name, unit: mat?.unit, area, detail });
          }
        } else {
          const matSelect = row.querySelector('.item-mat');
          const matId = parseInt(matSelect?.value || row.querySelector('.item-mat-id')?.value || '0');
          const qty = parseFloat(row.querySelector('.item-qty')?.value || '0') || 0;
          if (matId && qty > 0) {
            const mat = materials.find(m => m.id === matId);
            const variant = row.querySelector('.item-var')?.value?.trim() || 'Tiêu chuẩn';
            items.push({ matId, qty, variant, name: mat?.name, unit: mat?.unit, area, detail });
          }
        }
      }
    }

    if (items.length === 0) { ECO_UI.toast('Vui lòng chọn hoặc tự nhập ít nhất 1 vật tư hợp lệ', 'error'); return; }

    // Tự động lưu các vật tư tự nhập mới vào danh mục hệ thống và gán cho nhà cung cấp
    if (newMatsToDeclare.length > 0) {
      try {
        await ECO_Storage.saveMaterials([...materials, ...newMatsToDeclare]);
        if (selectedSupplier) {
          if (!selectedSupplier.providedMaterials) selectedSupplier.providedMaterials = [];
          const newIds = newMatsToDeclare.map(m => m.id);
          selectedSupplier.providedMaterials = [...new Set([...selectedSupplier.providedMaterials, ...newIds])];
          await ECO_Storage.saveSuppliers(suppliers);
        }
      } catch (err) {
        console.error('[POModule] Lưu vật tư tự nhập mới thất bại:', err);
        ECO_UI.toast('Không thể tự động lưu vật tư tự nhập mới', 'error');
        return;
      }
    }

    let subconName = '';
    let subId = null;

    const isSub = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSubcontractor();
    const user = typeof ECO_Auth !== 'undefined' ? ECO_Auth.user() : null;
    if (isSub && user) {
      subId = user.subId;
      const sc = window.subcontractorsData ? window.subcontractorsData[user.subId] : null;
      if (sc) subconName = sc.name;
    } else {
      const subconCbs = document.querySelectorAll('.po-subcon-cb');
      const selectedSubcons = Array.from(subconCbs).filter(cb => cb.checked).map(cb => cb.value);
      subconName = selectedSubcons.join(', ');
      
      if (selectedSubcons.length > 0) {
        const subIds = [];
        selectedSubcons.forEach(name => {
          const matchSub = Object.entries(window.subcontractorsData || {}).find(([_, s]) => s.name === name);
          if (matchSub) subIds.push(matchSub[0]);
        });
        subId = subIds.join(', ');
      }
    }

    const pos = ECO_Storage._rawPOs();
    if (pos.some(p => p.poNo === poNo && String(p.id) !== String(editId))) {
      ECO_UI.toast('Số PO "' + poNo + '" đã tồn tại. Vui lòng dùng số khác.', 'error');
      return;
    }

    const fileInput = document.getElementById('m-poFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    let approvedFile = null;

    if (file) {
      ECO_UI.toast(editId ? 'Đang cập nhật PO và tải file PDF lên Google Drive...' : 'Đang tạo PO và tải file PDF lên Google Drive...', 'info');
      try {
        const targetId = editId ? editId : ECO_Storage.nextId(pos);
        const virtualPo = { id: targetId, poNo };
        const uploaded = await this._uploadApprovedFileToDrive(file, virtualPo);
        const url = uploaded && (uploaded.url || uploaded.webViewLink || uploaded.webContentLink || uploaded.link);
        if (url) {
          approvedFile = {
            name: uploaded.name || file.name,
            url,
            driveId: uploaded.id || uploaded.fileId || uploaded.driveId || '',
            mimeType: uploaded.mimeType || file.type || '',
            size: uploaded.size || file.size || 0,
            uploadedAt: new Date().toISOString(),
            uploadedBy: (typeof ECO_Auth !== 'undefined' && ECO_Auth.user()) ? ECO_Auth.user().name : '',
          };
        }
      } catch (err) {
        console.error('[POModule] Failed to upload PO file during creation:', err);
        ECO_UI.toast('Không tải được file PDF lên Drive: ' + err.message, 'error');
      }
    }

    if (editId) {
      const p = pos.find(x => String(x.id) === String(editId));
      console.log('[POModule._savePO] Edit mode:', { editId, found: !!p, poNo, items });
      if (p) {
        p.poNo = poNo;
        p.date = document.getElementById('m-date').value;
        p.supplierId = supplierId;
        p.supplier = supplier;
        p.system = system;
        p.subconName = subconName;
        p.subId = subId;
        p.notes = document.getElementById('m-notes').value;
        p.items = items;
        if (approvedFile) p.approvedFile = approvedFile;
        ECO_UI.toast('Tìm thấy PO #' + editId + ' trong cache. Đã gán ' + items.length + ' vật tư.', 'info');
      } else {
        console.warn('[POModule._savePO] PO not found in array!', editId, pos);
        ECO_UI.toast('LỖI: Không tìm thấy PO ID ' + editId + ' trong cache!', 'error');
      }
    } else {
      console.log('[POModule._savePO] Creation mode:', { poNo, supplier, items });
      pos.push({
        id: ECO_Storage.nextId(pos),
        poNo,
        date: document.getElementById('m-date').value,
        supplierId,
        supplier,
        system,
        subconName,
        subId,
        notes: document.getElementById('m-notes').value,
        status: approvedFile ? 'approved' : 'pending',
        approvedFile,
        items,
        createdAt: new Date().toISOString(),
      });
    }

    if (items.length > 0) {
      ECO_UI.toast('Lưu PO: Vật tư đầu tiên "' + items[0].name + '" có SL: ' + items[0].qty, 'info');
    }

    try {
      console.log('[POModule._savePO] Before savePOs:', JSON.stringify(pos));
      await ECO_Storage.savePOs(pos);
      console.log('[POModule._savePO] savePOs success');
    } catch (saveErr) {
      console.error('[POModule._savePO] savePOs failed:', saveErr);
      ECO_UI.toast('Lưu PO thất bại: ' + saveErr.message, 'error');
      throw saveErr;
    }

    ECO_UI.closeModal();
    ECO_UI.toast(editId ? 'Đã cập nhật Đơn đặt hàng (PO)' : 'Đã tạo Đơn đặt hàng (PO) thành công', 'success');
    this.render();
    if (editId) {
      this.viewDetail(editId);
    }
  },

  _renderTimeline(selectedVal) {
    const steps = [
      { v: 'pending', l: 'Chờ duyệt', icon: 'file-text', activeColor: '#0056FF' },
      { v: 'rejected', l: 'Từ chối', icon: 'x-circle', activeColor: '#E31837' },
      { v: 'approved', l: 'Đã duyệt', icon: 'check-circle', activeColor: '#10B981' },
      { v: 'ordered', l: 'Đã đặt NCC', icon: 'shopping-cart', activeColor: '#0056FF' },
      { v: 'shipping', l: 'Đang giao', icon: 'truck', activeColor: '#0056FF' },
      { v: 'partially_received', l: 'Nhập 1 phần', icon: 'package-open', activeColor: '#F59E0B' },
      { v: 'received', l: 'Đã nhập kho', icon: 'package', activeColor: '#10B981' },
      { v: 'closed', l: 'Đóng', icon: 'lock', activeColor: '#64748B' }
    ];

    const getStepIndex = (val) => steps.findIndex(s => s.v === val);
    const selIdx = getStepIndex(selectedVal);

    let progressColor = '#0056FF';
    let progressWidth = selIdx > 0 ? (selIdx / (steps.length - 1)) * 100 : 0;
    if (selectedVal === 'rejected') {
      progressColor = '#E31837';
      progressWidth = 14.28;
    }

    let html = `
      <style>
        .po-timeline-step {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .po-timeline-step:not(.po-readonly):hover {
          transform: translateY(-3px);
        }
        .po-timeline-step:not(.po-readonly):hover .step-circle {
          transform: scale(1.12);
          box-shadow: 0 6px 16px rgba(0, 86, 255, 0.2) !important;
        }
        .po-timeline-step:not(.po-readonly):active .step-circle {
          transform: scale(0.92);
        }
        .po-readonly {
          opacity: 0.85;
        }
        .po-readonly .step-label {
          font-style: italic;
        }
        .po-pulse-active {
          animation: poPulse 2.2s infinite ease-in-out;
        }
        .po-pulse-rejected {
          animation: poPulseRed 2.2s infinite ease-in-out;
        }
        .po-pulse-success {
          animation: poPulseGreen 2.2s infinite ease-in-out;
        }
        .po-pulse-warning {
          animation: poPulseYellow 2.2s infinite ease-in-out;
        }
        @keyframes poPulse {
          0% { box-shadow: 0 0 0 0 rgba(0, 86, 255, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(0, 86, 255, 0); }
          100% { box-shadow: 0 0 0 0 rgba(0, 86, 255, 0); }
        }
        @keyframes poPulseRed {
          0% { box-shadow: 0 0 0 0 rgba(227, 24, 55, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(227, 24, 55, 0); }
          100% { box-shadow: 0 0 0 0 rgba(227, 24, 55, 0); }
        }
        @keyframes poPulseGreen {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        @keyframes poPulseYellow {
          0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
          100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
        }
      </style>
      <div class="po-timeline-container" style="position:relative; display:flex; justify-content:space-between; align-items:center; margin:15px 0 10px; padding:10px 5px; overflow-x:auto; gap:12px; min-width: 650px;">
        <!-- Line container -->
        <div style="position:absolute; top:28px; left:30px; right:30px; height:4px; z-index:1; pointer-events:none;">
          <!-- Background line -->
          <div style="width:100%; height:100%; background:#E2E8F0; border-radius:2px;"></div>
          <!-- Active progress line -->
          <div id="timeline-progress-line" style="position:absolute; top:0; left:0; width:${progressWidth}%; height:100%; background:${progressColor}; border-radius:2px; transition: all 0.3s ease;"></div>
        </div>
    `;

    steps.forEach((step, idx) => {
      const isCurrent = step.v === selectedVal;
      let isCompleted = idx < selIdx;
      
      if (selectedVal === 'rejected') {
        if (step.v === 'pending') isCompleted = true;
        if (idx > 1) isCompleted = false;
      } else {
        if (step.v === 'rejected') {
          isCompleted = false;
        }
      }

      let circleBg = '#FFFFFF';
      let border = '2px solid #CBD5E1';
      let textColor = '#64748B';
      let iconColor = '#94A3B8';
      let pulseClass = '';
      const isAuto = ['partially_received', 'received'].includes(step.v);

      if (isCurrent) {
        circleBg = step.activeColor;
        border = `2px solid ${step.activeColor}`;
        textColor = '#0F172A';
        iconColor = '#FFFFFF';
        
        if (step.v === 'rejected') {
          pulseClass = 'po-pulse-rejected';
        } else if (step.v === 'received' || step.v === 'approved') {
          pulseClass = 'po-pulse-success';
        } else if (step.v === 'partially_received') {
          pulseClass = 'po-pulse-warning';
        } else {
          pulseClass = 'po-pulse-active';
        }
      } else if (isCompleted) {
        circleBg = '#EFF6FF';
        border = '2px solid #3B82F6';
        textColor = '#1E40AF';
        iconColor = '#3B82F6';
      }

      html += `
        <div class="po-timeline-step ${isAuto ? 'po-readonly' : ''}" ${isAuto ? '' : `onclick="POModule._selectTimelineStep('${step.v}')"`} data-step-val="${step.v}" style="position:relative; display:flex; flex-direction:column; align-items:center; z-index:2; cursor:${isAuto ? 'default' : 'pointer'}; flex:1; min-width:75px;" title="${isAuto ? 'Trạng thái tự động cập nhật từ thực tế nhập kho' : ''}">
          <div class="step-circle ${pulseClass}" style="width:36px; height:36px; border-radius:50%; background:${circleBg}; border:${border}; display:flex; align-items:center; justify-content:center; transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1);">
            <i data-lucide="${step.icon}" style="width:16px;height:16px;color:${iconColor};stroke-width:2.5px;"></i>
          </div>
          <div class="step-label" style="font-size:0.75rem; font-weight:${isCurrent ? '700' : '600'}; color:${textColor}; margin-top:8px; text-align:center; white-space:nowrap; transition:all 0.25s ease;">
            ${step.l}
          </div>
        </div>
      `;
    });

    html += `</div>`;
    return html;
  },

  _selectTimelineStep(val) {
    const input = document.getElementById('detail-status');
    if (input) {
      input.value = val;
    }
    const container = document.getElementById('po-timeline-wrapper');
    if (container) {
      container.innerHTML = this._renderTimeline(val);
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    }
  },

  viewDetail(id) {
    const p = ECO_Storage.getPOs().find(x => String(x.id) === String(id));
    if (!p) return;
    ECO_UI.openModal('Chi tiết PO: ' + p.poNo, `
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:14px;">
        <div><div class="eco-kho-stat-label" style="margin-bottom:4px;">Nhà cung cấp</div><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.supplier}</div></div>
        <div><div class="eco-kho-stat-label" style="margin-bottom:4px;">Hệ thống</div><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.system || '—'}</div></div>
        <div><div class="eco-kho-stat-label" style="margin-bottom:4px;">Nhà thầu phụ</div><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.subconName || 'Chung'}</div></div>
        <div><div class="eco-kho-stat-label" style="margin-bottom:4px;">Ngày tạo</div><div style="font-weight:700;">${ECO_UI.fmtDate(p.date)}</div></div>
        <div><div class="eco-kho-stat-label" style="margin-bottom:4px;">Trạng thái</div><div style="margin-top:4px;">${ECO_UI.statusBadge(p.status)}</div></div>
      </div>
      ${p.notes ? `<div style="background:rgba(0,86,255,0.055);border:1px solid rgba(0,86,255,0.10);border-radius:6px;padding:9px 12px;margin-bottom:14px;font-size:0.8rem;"><strong>Ghi chú:</strong> ${p.notes}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.16);border-radius:8px;padding:12px 14px;margin-bottom:16px;">
        <div style="min-width:0;">
          <div style="font-size:0.78rem;font-weight:800;color:#15803D;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">File PO đã ký duyệt</div>
          <div id="po-approved-file-status" style="font-size:0.86rem;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;">${this._renderApprovedFileLink(p)}</div>
        </div>
        <div data-perm="po:edit" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <input type="file" id="po-approved-file-input" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style="display:none;" onchange="POModule._handleApprovedFileUpload('${p.id}', event)">
          <button onclick="document.getElementById('po-approved-file-input').click()" class="btn btn-outline btn-blue" style="padding:8px 14px;font-size:0.82rem;"><i data-lucide="upload-cloud" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Tải file</button>
        </div>
      </div>
      <div style="overflow-x:auto;border:1px solid rgba(0,86,255,0.12);border-radius:6px;margin-bottom:16px;background:rgba(255,255,255,0.34);">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="background:rgba(0,86,255,0.06);">
            <tr>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Vật tư</th>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:180px;">Khu vực thi công</th>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:180px;">Chi tiết</th>
              <th style="padding:10px 14px;width:120px;font-size:0.8rem;font-weight:700;color:#475569;">Quy cách</th>
              <th style="padding:10px 14px;width:100px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">SL đặt</th>
              <th style="padding:10px 14px;width:110px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">Đã nhập kho</th>
            </tr>
          </thead>
          <tbody>
            ${(p.items || []).map(item => `
              <tr style="border-top:1px solid rgba(0,0,0,0.06);">
                <td style="padding:10px 14px;font-weight:600;">${item.name || '—'}</td>
                <td style="padding:10px 14px;font-size:0.85rem;color:#475569;">${item.area || 'Chung'}</td>
                <td style="padding:10px 14px;font-size:0.85rem;color:#475569;">${item.detail || '—'}</td>
                <td style="padding:10px 14px;font-size:0.85rem;color:#475569;">${item.variant || 'Tiêu chuẩn'}</td>
                <td style="padding:10px 14px;text-align:right;font-weight:700;">${ECO_UI.fmtNum(item.qty, 2)} ${item.unit || ''}</td>
                <td style="padding:10px 14px;text-align:right;font-weight:700;color:${(item.receivedQty || 0) >= (item.qty || 0) ? '#15803D' : '#0056FF'};">${ECO_UI.fmtNum(item.receivedQty || 0, 2)} ${item.unit || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="eco-form-group" data-perm="po:edit" style="margin-top:20px;">
        <label style="font-weight:700;color:#475569;text-transform:uppercase;font-size:0.8rem;letter-spacing:0.04em;margin-bottom:8px;display:block;">Cập nhật trạng thái đơn hàng</label>
        <input type="hidden" id="detail-status" value="${p.status}">
        <div id="po-timeline-wrapper" style="overflow-x:auto;background:rgba(255,255,255,0.4);border:1px solid rgba(0,86,255,0.08);border-radius:12px;padding:6px 10px;">
          ${this._renderTimeline(p.status)}
        </div>
      </div>`,
      `<button data-perm="po:delete" onclick="POModule._deletePO('${p.id}')" class="btn btn-outline" style="padding:9px 20px;color:#E31837;border-color:#E31837;margin-right:auto;">Xóa PO</button>
       <button data-perm="po:edit" onclick="POModule.createPO(ECO_Storage.getPOs().find(x => String(x.id) === '${p.id}'))" class="btn btn-outline btn-blue" style="padding:9px 20px;"><i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Sửa PO</button>
       <button onclick="ECO_PDF.exportPO('${p.id}')" class="btn btn-outline btn-blue" style="padding:9px 20px;"><i data-lucide="file-down" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Xuất PDF</button>
       <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Đóng</button>
       <button data-perm="po:edit" onclick="POModule._updateStatus('${p.id}')" class="btn btn-primary" style="padding:9px 20px;">Lưu trạng thái</button>`,
      { size: 'lg' }
    );
  },

  async _handleApprovedFileUpload(id, event) {
    const input = event && event.target;
    const file = input && input.files && input.files[0];
    if (!file) return;

    const pos = ECO_Storage._rawPOs();
    const p = pos.find(x => String(x.id) === String(id));
    if (!p) return;

    const statusEl = document.getElementById('po-approved-file-status');
    const oldHtml = statusEl ? statusEl.innerHTML : '';
    if (statusEl) statusEl.innerHTML = '<span style="color:#0056FF;font-weight:700;">Đang tải lên Google Drive...</span>';

    try {
      const uploaded = await this._uploadApprovedFileToDrive(file, p);
      const url = uploaded && (uploaded.url || uploaded.webViewLink || uploaded.webContentLink || uploaded.link);
      if (!url) throw new Error('Upload thành công nhưng không nhận được link file.');

      p.approvedFile = {
        name: uploaded.name || file.name,
        url,
        driveId: uploaded.id || uploaded.fileId || uploaded.driveId || '',
        mimeType: uploaded.mimeType || file.type || '',
        size: uploaded.size || file.size || 0,
        uploadedAt: new Date().toISOString(),
        uploadedBy: (typeof ECO_Auth !== 'undefined' && ECO_Auth.user()) ? ECO_Auth.user().name : '',
      };
      if (['pending', 'submitted', 'rejected'].includes(p.status)) {
        p.status = 'approved';
      }
      await ECO_Storage.savePOs(pos);

      if (statusEl) statusEl.innerHTML = this._renderApprovedFileLink(p);
      ECO_UI.toast('Đã tải file PO ký duyệt và cập nhật trạng thái PO', 'success');
      this.render();
    } catch (err) {
      console.error('[POModule] Upload approved PO file failed:', err);
      if (statusEl) statusEl.innerHTML = oldHtml;
      ECO_UI.toast(err.message || 'Không tải được file PO ký duyệt', 'error');
    } finally {
      if (input) input.value = '';
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    }
  },

  async deleteApprovedFile(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Bạn có chắc chắn muốn xóa file này trên Google Drive không?')) return;

    const pos = ECO_Storage._rawPOs();
    const p = pos.find(x => String(x.id) === String(id));
    if (!p) return;

    const file = this._getPOApprovedFile(p);
    if (!file || !file.driveId) {
      // Just clear local reference if no driveId
      delete p.approvedFile;
      delete p.signedApprovedFile;
      delete p.signedFile;
      await ECO_Storage.savePOs(pos);
      this.render();
      ECO_UI.toast('Đã gỡ liên kết file', 'success');
      return;
    }

    const statusEl = document.getElementById('po-approved-file-status');
    const oldHtml = statusEl ? statusEl.innerHTML : '';
    if (statusEl) statusEl.innerHTML = '<span style="color:#E31837;font-weight:700;">Đang xóa trên Google Drive...</span>';

    try {
      if (window.ECO_Drive && typeof window.ECO_Drive.deleteFile === 'function') {
        await window.ECO_Drive.deleteFile(file.driveId);
      }
      
      delete p.approvedFile;
      delete p.signedApprovedFile;
      delete p.signedFile;
      await ECO_Storage.savePOs(pos);

      ECO_UI.toast('Đã xóa file trên Google Drive thành công', 'success');
      
      if (statusEl) statusEl.innerHTML = this._renderApprovedFileLink(p);
      this.render();
    } catch (err) {
      console.error('[POModule] Delete approved PO file failed:', err);
      if (statusEl) statusEl.innerHTML = oldHtml;
      ECO_UI.toast(err.message || 'Không xóa được file trên Google Drive', 'error');
    } finally {
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    }
  },

  async _updateStatus(id) {
    const newStatus = document.getElementById('detail-status').value;
    const pos = ECO_Storage._rawPOs();
    const p = pos.find(x => String(x.id) === String(id));
    if (!p) return;
    if (newStatus === 'approved' && !this._getPOApprovedFile(p)) {
      ECO_UI.toast('Vui lòng tải file PO đã ký duyệt trước khi chuyển sang Đã duyệt', 'error');
      return;
    }
    p.status = newStatus;
    await ECO_Storage.savePOs(pos);
    ECO_UI.closeModal();
    ECO_UI.toast('Đã cập nhật trạng thái PO', 'success');
    this.render();
  },

  async _deletePO(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa PO!', 'error');
      return;
    }
    if (!confirm('Xóa PO này? Tất cả các phiếu nhập kho liên quan cũng sẽ tự động bị xóa để đồng bộ tồn kho và số liệu BOQ.')) return;
    const pos = ECO_Storage._rawPOs().filter(x => String(x.id) !== String(id));
    const logs = ECO_Storage.getInventoryLogs().filter(log => String(log.poId) !== String(id));
    try {
      await ECO_Storage.savePOs(pos);
      await ECO_Storage.saveInventoryLogs(logs);
      ECO_UI.closeModal();
      ECO_UI.toast('Đã xóa PO và đồng bộ lại số liệu kho', 'warning');
      this.render();
    } catch (err) {
      console.error('[POModule] _deletePO failed:', err);
      ECO_UI.toast('Có lỗi xảy ra khi xóa PO', 'error');
    }
  },

  addSupplier() {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền thêm nhà cung cấp!', 'error');
      return;
    }
    const systems = typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS.map(s => s.name) : [];
    const materials = ECO_Storage.getMaterials();
    ECO_UI.openModal('Thêm Nhà cung cấp mới', `
      <div class="eco-form-group"><label>Tên công ty *</label><input id="s-name" class="eco-input" placeholder="Tên công ty NCC..."></div>
      <div class="eco-form-row">
        <div class="eco-form-group"><label>Người đại diện</label><input id="s-rep" class="eco-input" placeholder="Tên người đại diện"></div>
        <div class="eco-form-group"><label>Điện thoại</label><input id="s-phone" class="eco-input" placeholder="09xx..."></div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group" style="flex: 2;"><label>Email</label><input id="s-email" class="eco-input" type="email" placeholder="...@...com"></div>
      </div>
      <div class="eco-form-group">
        <label style="display:block;margin-bottom:8px;font-weight:700;font-size:0.82rem;color:#475569;text-transform:uppercase;letter-spacing:0.04em;">Hệ thống MEP *</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;background:rgba(255,255,255,0.4);border:1px solid rgba(0,86,255,0.15);border-radius:10px;padding:12px 16px;">
          ${systems.map(sys => `
            <label style="display:inline-flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:normal;text-transform:none;cursor:pointer;margin:0;color:#0F172A;">
              <input type="checkbox" class="s-system-checkbox" value="${sys}" onchange="POModule._filterModalMaterials()" style="cursor:pointer;width:16px;height:16px;">
              <span>${sys}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="eco-form-group">
        <label>Vật tư thiết bị có thể cung cấp</label>
        <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;">
          <input type="text" id="s-mat-search" class="eco-input" placeholder="Tìm kiếm vật tư theo mã hoặc tên..." oninput="POModule._filterModalMaterials()" style="font-size:0.85rem;padding:6px 12px;margin:0;flex:1;">
          <button type="button" onclick="POModule._selectAllVisibleMaterials(true)" class="btn btn-outline" style="font-size:0.75rem;padding:6px 10px;white-space:nowrap;">✓ Chọn tất cả</button>
          <button type="button" onclick="POModule._selectAllVisibleMaterials(false)" class="btn btn-outline" style="font-size:0.75rem;padding:6px 10px;white-space:nowrap;color:#dc2626;border-color:rgba(220,38,38,0.3);">✕ Bỏ chọn</button>
        </div>
        <div id="s-materials-list" style="max-height:180px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px;background:rgba(255,255,255,0.4);backdrop-filter:blur(6px);">
          ${materials.length === 0 ? '<div style="font-size:0.85rem;color:#94A3B8;">Chưa có vật tư thiết bị nào được khai báo.</div>' : materials.map(m => `
            <label class="s-mat-item" data-system="${m.system || ''}" data-text="${(m.code + ' ' + m.name).toLowerCase()}" style="display:flex;align-items:center;gap:8px;font-size:0.85rem;margin-bottom:6px;cursor:pointer;font-weight:normal;text-transform:none;color:#0F172A;">
              <input type="checkbox" class="s-mat-checkbox" value="${m.id}">
              <span>[${m.code}] ${m.name} (${m.unit})</span>
            </label>
          `).join('')}
        </div>
      </div>`,
      `<button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
       <button onclick="POModule._saveSupplier()" class="btn btn-primary" style="padding:9px 20px;">Thêm NCC</button>`,
      { size: 'lg' }
    );
    POModule._filterModalMaterials();
  },

  editSupplier(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền sửa nhà cung cấp!', 'error');
      return;
    }
    const s = ECO_Storage.getSuppliers().find(x => String(x.id) === String(id));
    if (!s) return;
    const systems = typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS.map(s => s.name) : [];
    const materials = ECO_Storage.getMaterials();
    const provided = s.providedMaterials || [];
    ECO_UI.openModal('Chỉnh sửa NCC: ' + s.companyName, `
      <div class="eco-form-group"><label>Tên công ty *</label><input id="s-name" class="eco-input" value="${s.companyName || ''}"></div>
      <div class="eco-form-row">
        <div class="eco-form-group"><label>Người đại diện</label><input id="s-rep" class="eco-input" value="${s.representative || ''}"></div>
        <div class="eco-form-group"><label>Điện thoại</label><input id="s-phone" class="eco-input" value="${s.phone || ''}"></div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group" style="flex: 2;"><label>Email</label><input id="s-email" class="eco-input" type="email" value="${s.email || ''}"></div>
      </div>
      <div class="eco-form-group">
        <label style="display:block;margin-bottom:8px;font-weight:700;font-size:0.82rem;color:#475569;text-transform:uppercase;letter-spacing:0.04em;">Hệ thống MEP *</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;background:rgba(255,255,255,0.4);border:1px solid rgba(0,86,255,0.15);border-radius:10px;padding:12px 16px;">
          ${systems.map(sys => {
            const isChecked = s.system && s.system.split(',').map(x => x.trim()).includes(sys);
            return `
              <label style="display:inline-flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:normal;text-transform:none;cursor:pointer;margin:0;color:#0F172A;">
                <input type="checkbox" class="s-system-checkbox" value="${sys}" ${isChecked ? 'checked' : ''} onchange="POModule._filterModalMaterials()" style="cursor:pointer;width:16px;height:16px;">
                <span>${sys}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
      <div class="eco-form-group">
        <label>Vật tư thiết bị có thể cung cấp</label>
        <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;">
          <input type="text" id="s-mat-search" class="eco-input" placeholder="Tìm kiếm vật tư theo mã hoặc tên..." oninput="POModule._filterModalMaterials()" style="font-size:0.85rem;padding:6px 12px;margin:0;flex:1;">
          <button type="button" onclick="POModule._selectAllVisibleMaterials(true)" class="btn btn-outline" style="font-size:0.75rem;padding:6px 10px;white-space:nowrap;">✓ Chọn tất cả</button>
          <button type="button" onclick="POModule._selectAllVisibleMaterials(false)" class="btn btn-outline" style="font-size:0.75rem;padding:6px 10px;white-space:nowrap;color:#dc2626;border-color:rgba(220,38,38,0.3);">✕ Bỏ chọn</button>
        </div>
        <div id="s-materials-list" style="max-height:180px;overflow-y:auto;border:1px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px;background:rgba(255,255,255,0.4);backdrop-filter:blur(6px);">
          ${materials.length === 0 ? '<div style="font-size:0.85rem;color:#94A3B8;">Chưa có vật tư thiết bị nào được khai báo.</div>' : materials.map(m => `
            <label class="s-mat-item" data-system="${m.system || ''}" data-text="${(m.code + ' ' + m.name).toLowerCase()}" style="display:flex;align-items:center;gap:8px;font-size:0.85rem;margin-bottom:6px;cursor:pointer;font-weight:normal;text-transform:none;color:#0F172A;">
              <input type="checkbox" class="s-mat-checkbox" value="${m.id}" ${provided.includes(m.id) || provided.includes(String(m.id)) || provided.includes(m.boqItemId) ? 'checked' : ''}>
              <span>[${m.code}] ${m.name} (${m.unit})</span>
            </label>
          `).join('')}
        </div>
      </div>`,
      `<button onclick="POModule._deleteSupplier('${id}')" class="btn btn-outline" style="padding:9px 20px;color:#E31837;border-color:#E31837;margin-right:auto;">Xóa</button>
       <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
       <button onclick="POModule._saveSupplier('${id}')" class="btn btn-primary" style="padding:9px 20px;">Lưu</button>`,
      { size: 'lg' }
    );
    POModule._filterModalMaterials();
  },

  _filterModalMaterials() {
    const searchInput = document.getElementById('s-mat-search');
    if (!searchInput) return;

    const selectedSysStr = Array.from(document.querySelectorAll('.s-system-checkbox:checked')).map(cb => cb.value).join(', ');
    const targetIds = systemLabelToIds(selectedSysStr);
    const query = searchInput.value.trim().toLowerCase();

    document.querySelectorAll('.s-mat-item').forEach(el => {
      const matchSys = targetIds.length === 0 || targetIds.includes(el.dataset.system);
      const matchSearch = (el.dataset.text || '').includes(query);
      el.style.display = matchSys && matchSearch ? 'flex' : 'none';
    });
  },

  _selectAllVisibleMaterials(select) {
    document.querySelectorAll('.s-mat-item').forEach(el => {
      if (el.style.display !== 'none') {
        const cb = el.querySelector('.s-mat-checkbox');
        if (cb) cb.checked = select;
      }
    });
  },

  _saveSupplier(editId) {
    const name = document.getElementById('s-name').value.trim();
    if (!name) { ECO_UI.toast('Vui lòng nhập tên công ty', 'error'); return; }
    const providedMaterials = Array.from(document.querySelectorAll('.s-mat-checkbox:checked')).map(cb => cb.value);
    const system = Array.from(document.querySelectorAll('.s-system-checkbox:checked')).map(cb => cb.value).join(', ');
    if (!system) { ECO_UI.toast('Vui lòng chọn ít nhất 1 hệ thống MEP', 'error'); return; }
    const suppliers = ECO_Storage.getSuppliers();
    if (editId) {
      const s = suppliers.find(x => String(x.id) === String(editId));
      if (s) {
        s.companyName = name;
        s.system = system;
        s.representative = document.getElementById('s-rep').value;
        s.phone = document.getElementById('s-phone').value;
        s.email = document.getElementById('s-email').value;
        s.providedMaterials = providedMaterials;
      }
    } else {
      suppliers.push({
        id: ECO_Storage.nextId(suppliers),
        companyName: name,
        system: system,
        representative: document.getElementById('s-rep').value,
        phone: document.getElementById('s-phone').value,
        email: document.getElementById('s-email').value,
        providedMaterials: providedMaterials
      });
    }
    ECO_Storage.saveSuppliers(suppliers);
    ECO_UI.closeModal();
    ECO_UI.toast(editId ? 'Đã cập nhật NCC' : 'Đã thêm NCC', 'success');
    this.render();
  },

  _deleteSupplier(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa nhà cung cấp!', 'error');
      return;
    }
    if (!confirm('Xóa nhà cung cấp này?')) return;
    ECO_Storage.saveSuppliers(ECO_Storage.getSuppliers().filter(x => String(x.id) !== String(id)));
    ECO_UI.closeModal();
    ECO_UI.toast('Đã xóa NCC', 'warning');
    this.render();
  },

  importSuppliersFromExcel() {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền import Excel nhà cung cấp!', 'error');
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls';
    inp.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      ECO_UI.toast('Đang đọc file Excel Nhà cung cấp...', 'info');
      try {
        await _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let hdrIdx = -1;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const joined = rows[i].map(c => String(c).toUpperCase()).join('|');
          if (/TÊN CÔNG TY|CÔNG TY|NHÀ CUNG CẤP|HỆ THỐNG|MEP|SYSTEM|EMAIL|ĐIỆN THOẠI|PHONE/.test(joined)) {
            hdrIdx = i;
            break;
          }
        }

        if (hdrIdx === -1) hdrIdx = 0;

        const header = rows[hdrIdx].map(c => String(c).trim().toUpperCase());
        const colCompanyName = header.findIndex(c => c === 'TÊN CÔNG TY' || c === 'CÔNG TY' || c === 'TÊN NCC' || c === 'NHÀ CUNG CẤP' || c.includes('COMPANY') || c.includes('NAME') || c.includes('SUPPLIER'));
        const colSystem = header.findIndex(c => c === 'HỆ THỐNG MEP' || c === 'HỆ THỐNG' || c.includes('MEP') || c.includes('SYSTEM'));
        const colRep = header.findIndex(c => c === 'NGƯỜI ĐẠI DIỆN' || c === 'ĐẠI DIỆN' || c === 'NGƯỜI LIÊN HỆ' || c.includes('REPRESENTATIVE') || c.includes('CONTACT'));
        const colPhone = header.findIndex(c => c === 'ĐIỆN THOẠI' || c === 'SĐT' || c.includes('PHONE') || c.includes('TEL'));
        const colEmail = header.findIndex(c => c === 'EMAIL' || c.includes('MAIL'));

        if (colCompanyName === -1) {
          ECO_UI.toast('Không tìm thấy cột Tên công ty/Nhà cung cấp trong file Excel.', 'error');
          return;
        }

        const suppliers = ECO_Storage.getSuppliers();
        let successCount = 0;
        let skipCount = 0;

        for (let i = hdrIdx + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r || r.length === 0) continue;
          const companyName = colCompanyName !== -1 ? String(r[colCompanyName] || '').trim() : '';
          const system = colSystem !== -1 ? String(r[colSystem] || '').trim() : 'Tổng hợp';
          const representative = colRep !== -1 ? String(r[colRep] || '').trim() : '';
          const phone = colPhone !== -1 ? String(r[colPhone] || '').trim() : '';
          const email = colEmail !== -1 ? String(r[colEmail] || '').trim() : '';

          if (!companyName) continue;

          const exist = suppliers.find(s => s.companyName.toLowerCase() === companyName.toLowerCase());
          if (exist) {
            exist.system = system;
            exist.representative = representative;
            exist.phone = phone;
            exist.email = email;
            skipCount++;
          } else {
            suppliers.push({
              id: ECO_Storage.nextId(suppliers),
              companyName,
              system,
              representative,
              phone,
              email,
              providedMaterials: []
            });
            successCount++;
          }
        }

        await ECO_Storage.saveSuppliers(suppliers);
        ECO_UI.toast(`Đã import ${successCount} nhà cung cấp mới, cập nhật ${skipCount} nhà cung cấp cũ!`, 'success');
        this.render();
      } catch (err) {
        console.error(err);
        ECO_UI.toast('Lỗi đọc file Excel: ' + err.message, 'error');
      }
    };
    inp.click();
  },

  exportSuppliersToExcel() {
    try {
      ECO_UI.toast('Đang xuất file Excel Nhà cung cấp...', 'info');
      
      const suppliers = ECO_Storage.getSuppliers();
      if (suppliers.length === 0) {
        ECO_UI.toast('Không có dữ liệu nhà cung cấp để xuất!', 'warning');
        return;
      }
      
      const excelData = suppliers.map(s => ({
        'Tên công ty': s.companyName || '',
        'Hệ thống MEP': s.system || '',
        'Người đại diện': s.representative || '',
        'Điện thoại': s.phone || '',
        'Email': s.email || ''
      }));

      const runExport = () => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(excelData);
        
        const colWidths = [
          { wch: 45 },
          { wch: 30 },
          { wch: 25 },
          { wch: 18 },
          { wch: 30 }
        ];
        ws['!cols'] = colWidths;
        
        XLSX.utils.book_append_sheet(wb, ws, 'DS_NhaCungCap');
        XLSX.writeFile(wb, `Danh_Sach_Nha_Cung_Cap_${new Date().toISOString().slice(0, 10)}.xlsx`);
        ECO_UI.toast('Xuất file Excel thành công!', 'success');
      };

      if (typeof XLSX !== 'undefined') {
        runExport();
      } else {
        _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(runExport).catch(err => {
          ECO_UI.toast('Không tải được thư viện Excel: ' + err.message, 'error');
        });
      }
    } catch (err) {
      console.error(err);
      ECO_UI.toast('Lỗi xuất file Excel: ' + err.message, 'error');
    }
  },
};

// ===== KHO MODULE =====
const KhoModule = {
  currentTab: 'stock',

  setTab(t) {
    this.currentTab = t;
    document.querySelectorAll('#coverflow-materials .coverflow-item').forEach(item => {
      item.classList.toggle('active', item.dataset.khoTab === t);
    });
    const container = document.getElementById('coverflow-materials');
    if (container && window.updateCoverFlowLayout) {
      window.updateCoverFlowLayout(container);
    }
    this.render();
  },

  _calcStock() {
    const stock = { "Tất cả": {} };
    const subcons = Object.values(window.subcontractorsData || {});
    const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
    
    ECO_Storage.getInventoryLogs().forEach(log => {
      const sign = log.type === 'in' ? 1 : -1;
      let subcon = log.subconName || 'Chung';
      
      if (subcon !== 'Chung') {
        const matched = subcons.find(s => norm(s.name) === norm(subcon));
        if (matched) subcon = matched.name;
      }
      
      if (!stock[subcon]) stock[subcon] = {};
      
      (log.items || []).forEach(item => {
        const qty = (parseFloat(item.qty) || 0) * sign;
        const v = item.variant || 'Tiêu chuẩn';
        
        if (!stock[subcon][item.matId]) stock[subcon][item.matId] = { total: 0, variants: {} };
        stock[subcon][item.matId].total += qty;
        stock[subcon][item.matId].variants[v] = (stock[subcon][item.matId].variants[v] || 0) + qty;
        
        if (!stock["Tất cả"][item.matId]) stock["Tất cả"][item.matId] = { total: 0, variants: {} };
        stock["Tất cả"][item.matId].total += qty;
        stock["Tất cả"][item.matId].variants[v] = (stock["Tất cả"][item.matId].variants[v] || 0) + qty;
      });
    });
    return stock;
  },

  render() {
    const el = document.getElementById('kho-content');
    if (!el) return;
    const logs = ECO_Storage.getInventoryLogs();
    const stock = this._calcStock();
    const allStock = stock["Tất cả"] || {};
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
        <div class="glass-panel eco-kho-stat">
          <div class="eco-kho-stat-label">Phiếu nhập</div>
          <div class="eco-kho-stat-val" style="color:#0056FF;">${logs.filter(l => l.type === 'in').length}</div>
        </div>
        <div class="glass-panel eco-kho-stat">
          <div class="eco-kho-stat-label">Phiếu xuất</div>
          <div class="eco-kho-stat-val" style="color:#E31837;">${logs.filter(l => l.type === 'out').length}</div>
        </div>
        <div class="glass-panel eco-kho-stat">
          <div class="eco-kho-stat-label">Mã vật tư có phát sinh</div>
          <div class="eco-kho-stat-val">${Object.keys(allStock).length}</div>
        </div>
      </div>
      ${this.currentTab === 'stock' ? this._renderStock(stock) : this._renderHistory(logs)}
    `;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },

  _renderStock(stock) {
    const subcons = Object.values(window.subcontractorsData || {});
    const activeTab = this._selectedSubconTab || 'Tất cả';
    const subconNames = ['Tất cả', ...subcons.map(s => s.name), 'Chung'];
    
    const tabsHtml = subconNames.map(name => {
      const isActive = activeTab === name;
      return `<button class="btn ${isActive ? 'btn-primary' : 'btn-outline'}" onclick="KhoModule._switchSubconTab('${name}')" style="font-size:0.82rem;padding:6px 14px;font-weight:600;cursor:pointer;">${name}</button>`;
    }).join(' ');

    const currentStock = stock[activeTab] || {};
    const materials = ECO_Storage.getMaterials();
    const rows = Object.entries(currentStock)
      .map(([matId, s]) => ({ mat: materials.find(m => m.id == matId), s }))
      .filter(r => r.mat)
      .sort((a, b) => b.s.total - a.s.total);

    const canEdit = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();
    const colsCount = canEdit ? 5 : 4;

    return `
      <div class="glass-panel content-table-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);flex-wrap:wrap;gap:12px;">
          <h3 style="font-size:1rem;font-weight:700;margin:0;">Tồn kho hiện tại (${activeTab === 'Tất cả' ? 'Toàn công trường' : 'Phân kho ' + activeTab})</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            ${tabsHtml}
            ${canEdit ? `<button onclick="KhoModule.triggerManualSanitize()" class="btn btn-outline" style="font-size:0.82rem;padding:6px 14px;color:#E31837;border-color:rgba(227,24,55,0.3);font-weight:600;margin-left:8px;" title="Rà soát & dọn sạch tất cả phiếu kho, vật tư mồ côi"><i data-lucide="shield-alert" style="width:13px;height:13px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Dọn rác mồ côi</button>` : ''}
          </div>
        </div>
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead><tr>
              <th style="width:120px;">Mã SP</th>
              <th>Tên vật tư</th>
              <th style="text-align:center;width:80px;">ĐVT</th>
              <th style="text-align:right;width:140px;">Tồn kho</th>
              ${canEdit ? `<th style="text-align:center;width:120px;">Thao tác</th>` : ''}
            </tr></thead>
            <tbody>
              ${rows.length === 0
                ? ECO_UI.tableEmpty(colsCount, 'Phân kho này chưa có phát sinh nhập/xuất vật tư.')
                : rows.map(({ mat, s }) => {
                    const actionCell = canEdit ? `
                      <td style="text-align:center;" onclick="event.stopPropagation()">
                        <button class="btn btn-outline" onclick="DanhMucVatTuModule.editMaterial(${mat.id})" style="font-size:0.75rem;padding:4px 8px;margin-right:4px;" title="Sửa vật tư"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
                        <button class="btn btn-outline" onclick="DanhMucVatTuModule.deleteMaterial(${mat.id})" style="font-size:0.75rem;padding:4px 8px;color:#E31837;border-color:rgba(227,24,55,0.15);" title="Xóa vật tư"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
                      </td>` : '';
                    return `
                      <tr onclick="KhoModule.viewItemHistory(${mat.id})" style="cursor:pointer;">
                        <td><code style="font-size:0.8rem;background:rgba(0,86,255,0.08);padding:2px 6px;border-radius:4px;">${mat.code}</code></td>
                        <td style="font-weight:600;">${mat.name}</td>
                        <td style="text-align:center;color:#475569;">${mat.unit}</td>
                        <td style="text-align:right;font-weight:800;font-size:1.05rem;color:${s.total < 0 ? '#E31837' : '#0056FF'};">${ECO_UI.fmtNum(s.total, 2)}</td>
                        ${actionCell}
                      </tr>`;
                  }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  _switchSubconTab(name) {
    this._selectedSubconTab = name;
    this.render();
  },

  _onFilterTypeChange(val) {
    this._filterType = val;
    this.render();
  },

  _onFilterSubconChange(val) {
    this._filterSubcon = val;
    this.render();
  },

  _clearFilters() {
    this._filterType = 'all';
    this._filterSubcon = 'all';
    this.render();
  },

  _renderHistory(logs) {
    const typeFilter = this._filterType || 'all';
    const subconFilter = this._filterSubcon || 'all';

    let filtered = logs;
    if (typeFilter !== 'all') {
      filtered = filtered.filter(l => l.type === typeFilter);
    }
    if (subconFilter !== 'all') {
      if (subconFilter === 'Chung') {
        filtered = filtered.filter(l => !l.subconName || l.subconName === 'Chung');
      } else {
        const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
        const normFilter = norm(subconFilter);
        filtered = filtered.filter(l => l.subconName && norm(l.subconName) === normFilter);
      }
    }

    const sorted = filtered.slice().sort((a, b) => b.id - a.id);
    const subcons = Object.values(window.subcontractorsData || {});

    const filterBarHtml = `
      <div style="display:flex;gap:16px;padding:12px 24px;background:rgba(0,0,0,0.02);border-bottom:1px solid rgba(0,0,0,0.06);align-items:center;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.8rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.02em;">Phân loại:</span>
          <select onchange="KhoModule._onFilterTypeChange(this.value)" class="eco-select" style="font-size:0.82rem;padding:4px 8px;width:120px;height:32px;margin:0;cursor:pointer;">
            <option value="all" ${typeFilter === 'all' ? 'selected' : ''}>— Tất cả —</option>
            <option value="in" ${typeFilter === 'in' ? 'selected' : ''}>Nhập kho</option>
            <option value="out" ${typeFilter === 'out' ? 'selected' : ''}>Xuất kho</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.8rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.02em;">Nhà thầu phụ:</span>
          <select onchange="KhoModule._onFilterSubconChange(this.value)" class="eco-select" style="font-size:0.82rem;padding:4px 8px;width:180px;height:32px;margin:0;cursor:pointer;">
            <option value="all" ${subconFilter === 'all' ? 'selected' : ''}>— Tất cả —</option>
            ${subcons.map(s => `<option value="${s.name}" ${subconFilter === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
            <option value="Chung" ${subconFilter === 'Chung' ? 'selected' : ''}>Chung</option>
          </select>
        </div>
        ${(typeFilter !== 'all' || subconFilter !== 'all') ? `
          <button onclick="KhoModule._clearFilters()" class="btn btn-outline" style="font-size:0.75rem;padding:4px 10px;height:32px;border-color:rgba(227,24,55,0.3);color:#E31837;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
            <i data-lucide="x" style="width:12px;height:12px;"></i> Xóa lọc
          </button>
        ` : ''}
      </div>
    `;

    return `
      <div class="glass-panel content-table-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
          <h3 style="font-size:1rem;font-weight:700;margin:0;">Lịch sử Nhập / Xuất kho</h3>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline" onclick="KhoModule.createLog('in')" style="font-size:0.85rem;padding:8px 16px;color:#0056FF;border-color:#0056FF;"><i data-lucide="arrow-down-to-line" style="width:15px;height:15px;margin-right:4px;"></i> Nhập kho</button>
            <button class="btn btn-outline" onclick="KhoModule.createLog('out')" style="font-size:0.85rem;padding:8px 16px;color:#E31837;border-color:#E31837;"><i data-lucide="arrow-up-from-line" style="width:15px;height:15px;margin-right:4px;"></i> Xuất kho</button>
          </div>
        </div>
        ${filterBarHtml}
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead><tr>
              <th style="width:110px;">Ngày</th>
              <th style="text-align:center;width:90px;">Loại</th>
              <th>Đối tượng</th>
              <th style="text-align:center;width:90px;">Tài liệu</th>
              <th style="text-align:center;width:110px;">Số mặt hàng</th>
            </tr></thead>
            <tbody>
              ${sorted.length === 0
                ? ECO_UI.tableEmpty(5, 'Không tìm thấy phiếu kho nào khớp với bộ lọc.')
                : sorted.map(l => {
                    const _fc = (l.deliveryNote && l.deliveryNote.url ? 1 : 0) + (Array.isArray(l.warehousePhotos) ? l.warehousePhotos.filter(p => p && p.url).length : 0) + (l.dispatchSlip && l.dispatchSlip.url ? 1 : 0);
                    return `
                  <tr onclick="KhoModule.viewLogDetail(${l.id})" style="cursor:pointer;">
                    <td style="font-size:0.88rem;">${ECO_UI.fmtDate(l.date)}</td>
                    <td style="text-align:center;">${ECO_UI.typeBadge(l.type)}</td>
                    <td>
                      <div style="font-weight:600;">${l.type === 'in' ? (l.poNo ? 'Theo PO: ' + l.poNo + (l.subconName ? ' (' + l.subconName + ')' : '') : (l.subconName ? 'Nhập lẻ (' + l.subconName + ')' : 'Nhập lẻ')) : 'Xuất cho: ' + (l.subconName || '—')}</div>
                      ${l.notes ? `<div style="font-size:0.8rem;color:#94A3B8;margin-top:2px;">${l.notes}</div>` : ''}
                    </td>
                    <td style="text-align:center;">${_fc > 0 ? `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(21,128,61,0.1);color:#15803D;border:1px solid rgba(21,128,61,0.18);border-radius:20px;padding:3px 10px;font-size:0.75rem;font-weight:700;"><i data-lucide="paperclip" style="width:12px;height:12px;flex-shrink:0;"></i>${_fc}</span>` : '<span style="color:#CBD5E1;font-size:0.8rem;">—</span>'}</td>
                    <td style="text-align:center;font-weight:700;">${(l.items || []).length}</td>
                  </tr>`;}).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },
  createLog(type) {
    const materials = ECO_Storage.getMaterials();
    const stock = this._calcStock();
    const pos = ECO_Storage.getPOs().filter(p => ['approved', 'ordered', 'shipping', 'partially_received'].includes(p.status));
    const subcons = Object.values(window.subcontractorsData || {});
    const today = new Date().toISOString().split('T')[0];

    ECO_UI.openModal(type === 'in' ? 'Phiếu Nhập Kho' : 'Phiếu Xuất Kho', `
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Ngày thực hiện *</label>
          <input id="k-date" type="date" class="eco-input" value="${today}">
        </div>
        ${type === 'in'
          ? `
            <div class="eco-form-group">
              <label>Theo đơn hàng (PO)</label>
              <select id="k-po" class="eco-select" onchange="KhoModule._onPOChange(this.value)">
                <option value="">-- Nhập ngoài PO --</option>
                ${pos.map(p => `<option value="${p.id}">${p.poNo} — ${p.supplier}</option>`).join('')}
              </select>
            </div>
            `
          : ''
        }
      </div>
      <div class="eco-form-row" style="display:grid; grid-template-columns: 240px 1fr; gap: 16px;">
        <div class="eco-form-group">
          <label>${type === 'in' ? 'Nhà thầu phụ nhận' : 'Nhà thầu phụ nhận *'}</label>
          <select id="k-subcon" class="eco-select" onchange="KhoModule._onSubconChange(this.value, '${type}')">
            <option value="">-- Chọn thầu phụ --</option>
            ${subcons.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
          </select>
          <div id="k-subcon-display" style="display:none; font-weight:700; color:#0056FF; padding:8px 12px; background:rgba(0,86,255,0.05); border:1px solid rgba(0,86,255,0.1); border-radius:8px; height:38px; align-items:center;">—</div>
        </div>
        <div class="eco-form-group">
          <label>Ghi chú</label>
          <input id="k-notes" class="eco-input" placeholder="Ghi chú phiếu...">
        </div>
      </div>
      <div style="margin-top:16px;">
        <div style="font-size:0.82rem;font-weight:700;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Tài liệu đính kèm</div>
        <div style="display:grid;grid-template-columns:${type === 'in' ? '1fr 1fr' : '1fr'};gap:12px;">
          ${type === 'in' ? `
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Scan phiếu giao hàng</label>
            <input id="k-delivery-note" type="file" accept=".pdf,.jpg,.jpeg,.png" class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.75rem;color:#94A3B8;margin-top:3px;">PDF hoặc hình ảnh</div>
          </div>
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Hình ảnh nhập kho</label>
            <input id="k-warehouse-photos" type="file" accept="image/*" multiple class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.75rem;color:#94A3B8;margin-top:3px;">Có thể chọn nhiều ảnh</div>
          </div>
          ` : `
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Phiếu xuất kho</label>
            <input id="k-dispatch-slip" type="file" accept=".pdf,.jpg,.jpeg,.png" class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.75rem;color:#94A3B8;margin-top:3px;">PDF hoặc hình ảnh</div>
          </div>
          `}
        </div>
      </div>
      <div style="margin-top:16px;">
        <div style="font-size:0.82rem;font-weight:700;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Danh sách vật tư</div>
        <div style="overflow-x:auto;border:1px solid rgba(0,0,0,0.08);border-radius:10px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead style="background:rgba(0,86,255,0.06);">
              <tr>
                <th style="padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Vật tư</th>
                <th style="padding:10px 12px;width:120px;font-size:0.8rem;font-weight:700;color:#475569;">Quy cách</th>
                <th style="padding:10px 12px;width:100px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">Số lượng</th>
                <th style="width:50px;"></th>
              </tr>
            </thead>
            <tbody id="kho-items-body"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:10px;margin-top:10px;">
          <button id="add-kho-item-btn" onclick="KhoModule._addKhoItemRow('${type}')" style="background:none;border:1px dashed rgba(0,86,255,0.3);border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#0056FF;cursor:pointer;width:100%;font-weight:600;font-family:inherit;">+ Thêm vật tư</button>
          <button id="fill-all-kho-qty-btn" onclick="KhoModule._fillAllRemaining()" style="display:none;background:none;border:1px dashed #10B981;border-radius:8px;padding:8px 16px;font-size:0.85rem;color:#10B981;cursor:pointer;width:100%;font-weight:600;font-family:inherit;">+ Nhận toàn bộ lượng còn lại</button>
        </div>
      </div>`,
      `<button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
       <button onclick="KhoModule._saveLog('${type}')" class="btn btn-primary" style="padding:9px 20px;">${type === 'in' ? 'Nhập kho' : 'Xuất kho'}</button>`
    );
    KhoModule._addKhoItemRow(type);
  },

  _filterPODropdown(subconName) {
    const poSelect = document.getElementById('k-po');
    if (!poSelect) return;
    const currentVal = poSelect.value;
    const pos = ECO_Storage.getPOs().filter(p => ['approved', 'ordered', 'shipping', 'partially_received'].includes(p.status));
    const filteredPOs = subconName 
      ? pos.filter(p => p.subconName && p.subconName.split(', ').map(x => x.trim()).includes(subconName))
      : pos;
    let html = `<option value="">-- Nhập ngoài PO --</option>`;
    html += filteredPOs.map(p => `<option value="${p.id}" ${String(p.id) === String(currentVal) ? 'selected' : ''}>${p.poNo} — ${p.supplier}</option>`).join('');
    poSelect.innerHTML = html;
  },

  _onPOChange(poId) {
    const tbody = document.getElementById('kho-items-body');
    if (!tbody) return;
    const addBtn = document.getElementById('add-kho-item-btn');
    const fillAllBtn = document.getElementById('fill-all-kho-qty-btn');
    const subconSelect = document.getElementById('k-subcon');
    const subconDisplay = document.getElementById('k-subcon-display');

    if (!poId) {
      tbody.innerHTML = '';
      if (addBtn) addBtn.style.display = 'block';
      if (fillAllBtn) fillAllBtn.style.display = 'none';
      if (subconSelect) {
        subconSelect.style.display = 'block';
        const subcons = Object.values(window.subcontractorsData || {});
        let html = '<option value="">-- Chọn thầu phụ --</option>';
        html += subcons.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
        subconSelect.innerHTML = html;
        subconSelect.value = '';
        this._filterPODropdown('');
      }
      if (subconDisplay) subconDisplay.style.display = 'none';
      this._addKhoItemRow('in');
      return;
    }

    const pos = ECO_Storage.getPOs();
    const po = pos.find(p => String(p.id) === String(poId));
    if (!po) return;

    const materials = ECO_Storage.getMaterials();

    const hasMultipleSubcons = po.subconName && po.subconName.includes(', ');
    if (subconSelect) {
      if (hasMultipleSubcons) {
        subconSelect.style.display = 'block';
        if (subconDisplay) subconDisplay.style.display = 'none';
        const allowedSubs = po.subconName.split(', ').map(x => x.trim());
        let html = '<option value="">-- Chọn thầu phụ nhận --</option>';
        html += allowedSubs.map(name => `<option value="${name}">${name}</option>`).join('');
        subconSelect.innerHTML = html;
        subconSelect.value = '';
      } else {
        subconSelect.style.display = 'none';
        if (subconDisplay) {
          subconDisplay.style.display = 'flex';
          subconDisplay.textContent = po.subconName || 'Chung';
        }
        subconSelect.value = po.subconName || '';
      }
    }

    tbody.innerHTML = '';
    if (addBtn) addBtn.style.display = 'none';
    if (fillAllBtn) fillAllBtn.style.display = 'block';

    (po.items || []).forEach(item => {
      const remaining = Math.max(0, (item.qty || 0) - (item.receivedQty || 0));
      const tr = document.createElement('tr');
      tr.className = 'kho-item-row';
      if (remaining === 0) {
        tr.style.opacity = '0.6';
        tr.style.background = 'rgba(241, 245, 249, 0.4)';
      }
      const mat = materials.find(m => String(m.id) === String(item.matId));
      const codePref = mat && mat.code ? `[${mat.code}] ` : '';
      tr.innerHTML = `
        <td style="padding:8px 6px;">
          <input type="hidden" class="kho-mat" value="${item.matId}">
          <div style="font-weight:600;font-size:0.88rem;color:#0F172A;">${codePref}${item.name || '—'}</div>
          <div style="font-size:0.78rem;color:#64748B;margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="background:rgba(0,86,255,0.08);color:#0056FF;padding:1px 6px;border-radius:4px;font-weight:600;">${item.area || 'Chung'}</span>
            <span>Đặt PO: <strong>${ECO_UI.fmtNum(item.qty, 2)} ${item.unit || ''}</strong></span>
            <span>| Đã nhập: <strong>${ECO_UI.fmtNum(item.receivedQty || 0, 2)} ${item.unit || ''}</strong></span>
            ${remaining === 0 ? `<span style="background:rgba(16,185,129,0.12);color:#10B981;padding:1px 6px;border-radius:4px;font-weight:700;font-size:0.75rem;">Đủ</span>` : ''}
          </div>
        </td>
        <td style="padding:8px 6px;"><input type="text" class="eco-input kho-var" value="${item.variant || 'Tiêu chuẩn'}" readonly style="font-size:0.85rem;background:#F1F5F9;color:#475569;"></td>
        <td style="padding:8px 6px;position:relative;">
          <input type="number" class="eco-input kho-qty" placeholder="${remaining}" min="0" step="0.01" style="font-size:0.85rem;text-align:right;font-weight:700;color:#0056FF;padding-right:32px;">
          ${remaining > 0 ? `<span onclick="this.previousElementSibling.value='${remaining}'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:0.72rem;color:#0056FF;cursor:pointer;font-weight:700;user-select:none;" title="Nhập toàn bộ lượng còn lại">all</span>` : ''}
        </td>
        <td style="padding:8px 6px;text-align:center;"><button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#E31837;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button></td>
      `;
      tbody.appendChild(tr);
    });
  },
  _fillAllRemaining() {
    document.querySelectorAll('.kho-item-row').forEach(row => {
      const input = row.querySelector('.eco-input.kho-qty');
      if (input && !input.value) {
        input.value = input.placeholder || '';
      }
    });
  },
  _addKhoItemRow(type) {
    const tbody = document.getElementById('kho-items-body');
    if (!tbody) return;
    const subconSelect = document.getElementById('k-subcon');
    const subconName = subconSelect ? subconSelect.value : '';

    const tr = document.createElement('tr');
    tr.className = 'kho-item-row';
    tr.innerHTML = `
      <td style="padding:8px 6px;">
        <select class="eco-select kho-mat" style="font-size:0.85rem;">
          <!-- Tự động tải danh sách dựa trên nhà thầu phụ chọn -->
        </select>
      </td>
      <td style="padding:8px 6px;"><input type="text" class="eco-input kho-var" placeholder="Màu/Mẫu..." style="font-size:0.85rem;"></td>
      <td style="padding:8px 6px;"><input type="number" class="eco-input kho-qty" value="1" min="0" step="0.01" style="font-size:0.85rem;text-align:right;"></td>
      <td style="padding:8px 6px;text-align:center;"><button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#E31837;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button></td>
    `;
    tbody.appendChild(tr);

    const selectEl = tr.querySelector('.kho-mat');
    this._populateMatSelectOptions(selectEl, subconName, type, '');
  },

  _onSubconChange(subconName, type) {
    const tbody = document.getElementById('kho-items-body');
    if (!tbody) return;
    const selectEls = tbody.querySelectorAll('.kho-mat');
    selectEls.forEach(select => {
      const currentVal = select.value;
      this._populateMatSelectOptions(select, subconName, type, currentVal);
    });
    if (type === 'in') {
      this._filterPODropdown(subconName);
    }
  },

  _populateMatSelectOptions(select, subconName, type, selectedVal) {
    const materials = ECO_Storage.getMaterials();
    const stock = this._calcStock();
    const allStock = stock["Tất cả"] || {};
    const subconStock = (subconName && stock[subconName]) ? stock[subconName] : {};
    const chungStock = stock["Chung"] || {};
    const allowedMatIds = this._getMatIdsForSubcon(subconName);

    let items = materials;
    if (type === 'out') {
      // Chỉ cho phép xuất các vật tư có tồn kho thực tế trong phân kho của thầu phụ này hoặc kho Chung
      items = materials.filter(m => {
        const subconTotal = subconStock[m.id] ? subconStock[m.id].total : 0;
        const chungTotal = chungStock[m.id] ? chungStock[m.id].total : 0;
        return (subconTotal + chungTotal) > 0;
      });
    }

    if (allowedMatIds) {
      items = items.filter(m => allowedMatIds.has(m.id) || String(m.id) === String(selectedVal));
    }

    let html = `<option value="">-- Chọn vật tư --</option>`;
    items.forEach(m => {
      let stockText = '';
      if (type === 'out') {
        const subconTotal = subconStock[m.id] ? subconStock[m.id].total : 0;
        const chungTotal = chungStock[m.id] ? chungStock[m.id].total : 0;
        const totalAvailable = subconTotal + chungTotal;
        stockText = ` (Tồn: ${ECO_UI.fmtNum(totalAvailable, 2)} ${m.unit})`;
      } else if (type === 'in' && allStock[m.id]) {
        stockText = ` (Tồn: ${ECO_UI.fmtNum(allStock[m.id].total, 2)} ${m.unit})`;
      }
      html += `<option value="${m.id}" ${String(m.id) === String(selectedVal) ? 'selected' : ''}>[${m.code}] ${m.name}${stockText}</option>`;
    });
    select.innerHTML = html;
  },

  _getMatIdsForSubcon(subconName) {
    if (!subconName) return null;
    const matIds = new Set();
    const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
    const normTarget = norm(subconName);

    // 1. Lọc từ các đơn đặt hàng (PO) đã gán cho thầu phụ này
    const pos = ECO_Storage.getPOs();
    pos.forEach(p => {
      if (p.subconName && p.items) {
        const subconNames = p.subconName.split(', ').map(x => norm(x));
        if (subconNames.includes(normTarget)) {
          p.items.forEach(item => {
            if (item.matId) matIds.add(item.matId);
          });
        }
      }
    });

    // 2. Lọc từ bảng định mức BOQ đã phân công cho thầu phụ này
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    const subconBoqIds = new Set(boq.filter(b => b.subconName && norm(b.subconName) === normTarget).map(b => b.id));
    const materials = ECO_Storage.getMaterials();
    materials.forEach(m => {
      if (m.boqItemId && subconBoqIds.has(m.boqItemId)) {
        matIds.add(m.id);
      }
    });

    return matIds;
  },

  async _saveLog(type) {
    const date = document.getElementById('k-date').value;
    if (!date) { ECO_UI.toast('Vui lòng chọn ngày', 'error'); return; }
    const materials = ECO_Storage.getMaterials();
    const stock = this._calcStock();
    const items = [];
    document.querySelectorAll('.kho-item-row').forEach(row => {
      const matId = parseInt(row.querySelector('.kho-mat').value);
      const qty = parseFloat(row.querySelector('.kho-qty').value) || 0;
      const variant = row.querySelector('.kho-var').value.trim();
      if (matId && qty > 0) {
        const mat = materials.find(m => m.id === matId);
        items.push({ matId, qty, variant, name: mat?.name, unit: mat?.unit });
      }
    });
    if (items.length === 0) { ECO_UI.toast('Vui lòng thêm ít nhất 1 vật tư', 'error'); return; }

    const allStock = stock["Tất cả"] || {};
    if (type === 'out') {
      for (const item of items) {
        const v = item.variant || 'Tiêu chuẩn';
        const matStock = allStock[item.matId];
        const available = matStock ? (matStock.variants[v] !== undefined ? matStock.variants[v] : matStock.total) : 0;
        if (item.qty > available + 0.001) {
          const mat = materials.find(m => m.id === item.matId);
          ECO_UI.toast('KHÔNG ĐỦ TỒN KHO: "' + (mat?.name || 'Vật tư') + '" chỉ còn ' + ECO_UI.fmtNum(available, 2) + ' ' + (mat?.unit || ''), 'error');
          return;
        }
      }
      const subconEl = document.getElementById('k-subcon');
      if (subconEl && !subconEl.value) { ECO_UI.toast('Vui lòng chọn nhà thầu phụ', 'error'); return; }
    }

    // Upload tài liệu đính kèm lên Google Drive
    const attachments = {};
    if (window.ECO_Drive) {
      const _makeFileRef = (res, fallbackFile) => ({
        name: res.name || fallbackFile.name,
        url: res.url || '',
        driveId: res.id || res.fileId || res.driveId || '',
        mimeType: res.mimeType || fallbackFile.type || '',
        uploadedAt: new Date().toISOString(),
      });

      if (type === 'in') {
        const dnInput = document.getElementById('k-delivery-note');
        if (dnInput && dnInput.files && dnInput.files[0]) {
          try {
            ECO_UI.toast('Đang tải phiếu giao hàng lên Google Drive...', 'info');
            const res = await window.ECO_Drive.uploadFile(dnInput.files[0], { folder: 'Kho/NhapKho', module: 'kho', type: 'delivery_note' });
            attachments.deliveryNote = _makeFileRef(res, dnInput.files[0]);
          } catch(e) { ECO_UI.toast('Lỗi tải phiếu giao hàng: ' + e.message, 'error'); }
        }
        const photoInput = document.getElementById('k-warehouse-photos');
        if (photoInput && photoInput.files && photoInput.files.length) {
          const photos = [];
          ECO_UI.toast('Đang tải ' + photoInput.files.length + ' ảnh nhập kho...', 'info');
          for (const f of Array.from(photoInput.files)) {
            try {
              const res = await window.ECO_Drive.uploadFile(f, { folder: 'Kho/NhapKho', module: 'kho', type: 'warehouse_photo' });
              photos.push(_makeFileRef(res, f));
            } catch(e) { ECO_UI.toast('Lỗi tải ảnh "' + f.name + '": ' + e.message, 'error'); }
          }
          if (photos.length) attachments.warehousePhotos = photos;
        }
      } else {
        const slipInput = document.getElementById('k-dispatch-slip');
        if (slipInput && slipInput.files && slipInput.files[0]) {
          try {
            ECO_UI.toast('Đang tải phiếu xuất kho lên Google Drive...', 'info');
            const res = await window.ECO_Drive.uploadFile(slipInput.files[0], { folder: 'Kho/XuatKho', module: 'kho', type: 'dispatch_slip' });
            attachments.dispatchSlip = _makeFileRef(res, slipInput.files[0]);
          } catch(e) { ECO_UI.toast('Lỗi tải phiếu xuất kho: ' + e.message, 'error'); }
        }
      }
    }

    const logs = ECO_Storage.getInventoryLogs();
    const subconEl = document.getElementById('k-subcon');
    const subconName = subconEl ? subconEl.value.trim() : '';
    const log = {
      id: ECO_Storage.nextId(logs),
      type,
      date,
      subconName: subconName || null,
      items,
      notes: document.getElementById('k-notes').value,
      ...attachments,
      createdAt: new Date().toISOString(),
    };
    if (type === 'in') {
      const poEl = document.getElementById('k-po');
      if (poEl && poEl.value) { const po = ECO_Storage.getPOs().find(p => String(p.id) === poEl.value); log.poId = poEl.value; log.poNo = po?.poNo; }
    }
    logs.push(log);
    ECO_Storage.saveInventoryLogs(logs);
    ECO_UI.closeModal();
    ECO_UI.toast('Đã lưu phiếu ' + (type === 'in' ? 'nhập' : 'xuất') + ' kho (' + items.length + ' vật tư)', 'success');
    this.render();
  },

  viewLogDetail(id) {
    const log = ECO_Storage.getInventoryLogs().find(l => l.id == id);
    if (!log) return;
    const isSuper = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();
    const isSub = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSubcontractor();
    const user = typeof ECO_Auth !== 'undefined' ? ECO_Auth.user() : null;
    const subconName = (user && window.subcontractorsData && window.subcontractorsData[user.subId]) ? window.subcontractorsData[user.subId].name : '';
    const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
    const isOwnLog = isSub && subconName && log.subconName && (norm(log.subconName) === norm(subconName));
    const canEdit = isSuper || (typeof ECO_Auth !== 'undefined' && ECO_Auth.can('edit', 'kho') && isOwnLog);
    ECO_UI.openModal('Chi tiết Phiếu ' + (log.type === 'in' ? 'Nhập' : 'Xuất') + ' Kho', `
      <div style="display:grid;grid-template-columns:repeat(${log.type === 'in' ? 4 : 3}, 1fr);gap:12px;margin-bottom:20px;">
        <div class="eco-kho-stat"><div class="eco-kho-stat-label">Ngày thực hiện</div><div style="font-weight:700;margin-top:4px;">${ECO_UI.fmtDate(log.date)}</div></div>
        <div class="eco-kho-stat"><div class="eco-kho-stat-label">Loại phiếu</div><div style="margin-top:6px;">${ECO_UI.typeBadge(log.type)}</div></div>
        ${log.type === 'in'
          ? `
            <div class="eco-kho-stat"><div class="eco-kho-stat-label">Theo PO</div><div style="font-weight:700;margin-top:4px;">${log.poNo || 'Nhập lẻ'}</div></div>
            <div class="eco-kho-stat"><div class="eco-kho-stat-label">Nhà thầu phụ nhận</div><div style="font-weight:700;margin-top:4px;">${log.subconName || 'Chung'}</div></div>
            `
          : `
            <div class="eco-kho-stat"><div class="eco-kho-stat-label">Nhà thầu phụ nhận</div><div style="font-weight:700;margin-top:4px;">${log.subconName || '—'}</div></div>
            `
        }
      </div>
      ${log.notes ? `<div style="background:rgba(0,86,255,0.05);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.88rem;"><strong>Ghi chú:</strong> ${log.notes}</div>` : ''}
      ${this._renderFileAttachments(log)}
      <div style="border:1px dashed rgba(0,86,255,0.22);border-radius:10px;padding:12px 16px;margin-bottom:16px;background:rgba(0,86,255,0.015);">
        <div style="font-size:0.78rem;font-weight:700;color:#64748B;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Thêm / cập nhật tài liệu</div>
        <div style="display:grid;grid-template-columns:${log.type === 'in' ? '1fr 1fr' : '1fr'};gap:12px;">
          ${log.type === 'in' ? `
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Scan phiếu giao hàng</label>
            <input id="k-delivery-note-edit" type="file" accept=".pdf,.jpg,.jpeg,.png" class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.73rem;color:#94A3B8;margin-top:3px;">Sẽ thay thế nếu đã có</div>
          </div>
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Hình ảnh nhập kho</label>
            <input id="k-warehouse-photos-edit" type="file" accept="image/*" multiple class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.73rem;color:#94A3B8;margin-top:3px;">Ảnh mới sẽ được bổ sung thêm</div>
          </div>
          ` : `
          <div class="eco-form-group" style="margin:0;">
            <label style="font-size:0.82rem;font-weight:600;color:#475569;margin-bottom:5px;display:block;">Phiếu xuất kho</label>
            <input id="k-dispatch-slip-edit" type="file" accept=".pdf,.jpg,.jpeg,.png" class="eco-input" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;">
            <div style="font-size:0.73rem;color:#94A3B8;margin-top:3px;">Sẽ thay thế nếu đã có</div>
          </div>
          `}
        </div>
      </div>
      <div style="overflow-x:auto;border:1px solid rgba(0,0,0,0.08);border-radius:10px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="background:rgba(0,86,255,0.06);">
            <tr>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Vật tư</th>
              <th style="padding:10px 14px;width:130px;font-size:0.8rem;font-weight:700;color:#475569;">Quy cách</th>
              <th style="padding:10px 14px;width:130px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">Số lượng</th>
            </tr>
          </thead>
          <tbody>
            ${(log.items || []).map((item, idx) => `
              <tr style="border-top:1px solid rgba(0,0,0,0.06);">
                <td style="padding:10px 14px;font-weight:600;">${item.name || '—'}</td>
                <td style="padding:10px 14px;font-size:0.85rem;color:#475569;">${item.variant || 'Tiêu chuẩn'}</td>
                <td style="padding:10px 14px;text-align:right;">
                  <span class="log-qty-text" style="font-weight:800;color:${log.type === 'in' ? '#15803D' : '#E31837'};">${log.type === 'in' ? '+' : '-'}${ECO_UI.fmtNum(item.qty, 2)} ${item.unit || ''}</span>
                  <div class="log-qty-edit-wrapper" style="display:none;align-items:center;justify-content:flex-end;gap:6px;">
                    <span>${log.type === 'in' ? '+' : '-'}</span>
                    <input type="number" class="log-qty-input eco-input" data-index="${idx}" value="${item.qty}" min="0" step="0.01" style="font-size:0.85rem;text-align:right;width:80px;font-weight:700;padding:4px 8px;margin:0;">
                    <span style="font-size:0.85rem;color:#475569;">${item.unit || ''}</span>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`,
      `${canEdit ? `<button onclick="KhoModule._deleteLog(${log.id})" class="btn btn-outline" style="padding:9px 20px;color:#E31837;border-color:#E31837;margin-right:auto;">Xóa phiếu</button>` : '<div style="margin-right:auto;"></div>'}
       ${canEdit ? `<button id="btn-edit-qty" onclick="KhoModule._enableQtyEdit()" class="btn btn-outline btn-blue" style="padding:9px 20px;margin-right:8px;"><i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Sửa số lượng</button>` : ''}
       <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Đóng</button>
       <button id="btn-save-log" data-log-id="${log.id}" onclick="KhoModule._saveLogAttachments(${log.id})" class="btn btn-primary" style="padding:9px 20px;"><i data-lucide="upload-cloud" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Lưu tài liệu</button>`
    );
  },

  _enableQtyEdit() {
    const texts = document.querySelectorAll('.log-qty-text');
    const edits = document.querySelectorAll('.log-qty-edit-wrapper');
    const btnEdit = document.getElementById('btn-edit-qty');
    const btnSave = document.getElementById('btn-save-log');
    if (!btnEdit || !btnSave) return;

    const isEditing = btnEdit.classList.contains('editing-active');
    const logId = btnSave.getAttribute('data-log-id');

    if (!isEditing) {
      // Chuyển sang chế độ sửa
      texts.forEach(el => el.style.display = 'none');
      edits.forEach(el => el.style.display = 'flex');
      btnEdit.classList.add('editing-active');
      btnEdit.innerHTML = '<i data-lucide="x" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Hủy sửa';
      btnEdit.style.color = '#E31837';
      btnEdit.style.borderColor = '#E31837';
      
      // Đổi nút Lưu tài liệu thành Lưu số lượng
      btnSave.setAttribute('onclick', `KhoModule._saveEditedQuantities(${logId})`);
      btnSave.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Lưu số lượng';
      btnSave.style.background = '#10B981';
      btnSave.style.borderColor = '#10B981';
    } else {
      // Hủy sửa
      texts.forEach(el => el.style.display = '');
      edits.forEach(el => el.style.display = 'none');
      btnEdit.classList.remove('editing-active');
      btnEdit.innerHTML = '<i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Sửa số lượng';
      btnEdit.style.color = '';
      btnEdit.style.borderColor = '';
      
      // Reset nút Lưu tài liệu
      btnSave.setAttribute('onclick', `KhoModule._saveLogAttachments(${logId})`);
      btnSave.innerHTML = '<i data-lucide="upload-cloud" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>Lưu tài liệu';
      btnSave.style.background = '';
      btnSave.style.borderColor = '';
    }
    
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  },

  async _saveEditedQuantities(logId) {
    const inputs = document.querySelectorAll('.log-qty-input');
    const logs = ECO_Storage.getInventoryLogs();
    const logIdx = logs.findIndex(l => l.id == logId);
    if (logIdx < 0) return;
    
    const log = { ...logs[logIdx] };
    const newItems = log.items.map((item, idx) => {
      const input = document.querySelector(`.log-qty-input[data-index="${idx}"]`);
      const val = input ? parseFloat(input.value) : item.qty;
      return { ...item, qty: isNaN(val) ? 0 : val };
    });

    if (newItems.some(item => item.qty < 0)) {
      ECO_UI.toast('Số lượng không được âm!', 'error');
      return;
    }

    // Verify stock constraints (if type is out or if we reduce type in)
    const tempLogs = logs.map((l, idx) => idx === logIdx ? { ...l, items: newItems } : l);
    
    // Simulate stock calculation
    const stock = { "Tất cả": {} };
    let hasViolation = false;
    let violationMsg = '';

    tempLogs.forEach(l => {
      const sign = l.type === 'in' ? 1 : -1;
      const subcon = l.subconName || 'Chung';
      if (!stock[subcon]) stock[subcon] = {};
      
      (l.items || []).forEach(item => {
        const qty = (parseFloat(item.qty) || 0) * sign;
        const v = item.variant || 'Tiêu chuẩn';
        
        if (!stock[subcon][item.matId]) stock[subcon][item.matId] = { total: 0, variants: {} };
        stock[subcon][item.matId].total += qty;
        stock[subcon][item.matId].variants[v] = (stock[subcon][item.matId].variants[v] || 0) + qty;
        
        if (!stock["Tất cả"][item.matId]) stock["Tất cả"][item.matId] = { total: 0, variants: {} };
        stock["Tất cả"][item.matId].total += qty;
        stock["Tất cả"][item.matId].variants[v] = (stock["Tất cả"][item.matId].variants[v] || 0) + qty;
      });
    });

    // Check if any stock level is negative
    const materials = ECO_Storage.getMaterials();
    for (const [subcon, subconStock] of Object.entries(stock)) {
      for (const [matId, matStock] of Object.entries(subconStock)) {
        if (matStock.total < -0.001) {
          const mat = materials.find(m => m.id == matId);
          hasViolation = true;
          violationMsg = `Thay đổi số lượng này sẽ làm cho tồn kho của "${mat?.name || 'Vật tư'}" tại phân kho "${subcon}" bị âm (${ECO_UI.fmtNum(matStock.total, 2)} ${mat?.unit || ''}).`;
          break;
        }
        for (const [variant, qty] of Object.entries(matStock.variants)) {
          if (qty < -0.001) {
            const mat = materials.find(m => m.id == matId);
            hasViolation = true;
            violationMsg = `Thay đổi số lượng này sẽ làm cho quy cách "${variant}" của "${mat?.name || 'Vật tư'}" tại phân kho "${subcon}" bị âm (${ECO_UI.fmtNum(qty, 2)} ${mat?.unit || ''}).`;
            break;
          }
        }
        if (hasViolation) break;
      }
      if (hasViolation) break;
    }

    if (hasViolation) {
      ECO_UI.toast(violationMsg, 'error');
      return;
    }

    // Save changes
    logs[logIdx].items = newItems;
    await ECO_Storage.saveInventoryLogs(logs);
    
    ECO_UI.closeModal();
    ECO_UI.toast('Đã cập nhật số lượng vật tư trong phiếu thành công!', 'success');
    this.render();
  },

  _deleteLog(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa phiếu kho!', 'error');
      return;
    }
    if (!confirm('Xóa phiếu kho này? Tồn kho sẽ được hoàn tác.')) return;
    ECO_Storage.saveInventoryLogs(ECO_Storage.getInventoryLogs().filter(l => l.id != id));
    ECO_UI.closeModal();
    ECO_UI.toast('Đã xóa phiếu kho', 'warning');
    this.render();
  },

  async _saveLogAttachments(id) {
    const logs = ECO_Storage.getInventoryLogs();
    const logIdx = logs.findIndex(l => l.id == id);
    if (logIdx < 0) return;
    const log = { ...logs[logIdx] };

    if (!window.ECO_Drive) {
      ECO_UI.toast('ECO Drive chưa khởi tạo', 'error');
      return;
    }

    const _makeFileRef = (res, f) => ({
      name: res.name || f.name,
      url: res.url || '',
      driveId: res.id || res.fileId || res.driveId || '',
      mimeType: res.mimeType || f.type || '',
      uploadedAt: new Date().toISOString(),
    });

    let changed = false;

    if (log.type === 'in') {
      const dnInput = document.getElementById('k-delivery-note-edit');
      if (dnInput && dnInput.files && dnInput.files[0]) {
        try {
          ECO_UI.toast('Đang tải phiếu giao hàng lên Google Drive...', 'info');
          const res = await window.ECO_Drive.uploadFile(dnInput.files[0], { folder: 'Kho/NhapKho', module: 'kho', type: 'delivery_note' });
          log.deliveryNote = _makeFileRef(res, dnInput.files[0]);
          changed = true;
        } catch(e) { ECO_UI.toast('Lỗi tải phiếu giao hàng: ' + e.message, 'error'); }
      }
      const photoInput = document.getElementById('k-warehouse-photos-edit');
      if (photoInput && photoInput.files && photoInput.files.length) {
        const photos = Array.isArray(log.warehousePhotos) ? [...log.warehousePhotos] : [];
        ECO_UI.toast('Đang tải ' + photoInput.files.length + ' ảnh nhập kho...', 'info');
        for (const f of Array.from(photoInput.files)) {
          try {
            const res = await window.ECO_Drive.uploadFile(f, { folder: 'Kho/NhapKho', module: 'kho', type: 'warehouse_photo' });
            photos.push(_makeFileRef(res, f));
            changed = true;
          } catch(e) { ECO_UI.toast('Lỗi ảnh "' + f.name + '": ' + e.message, 'error'); }
        }
        log.warehousePhotos = photos;
      }
    } else {
      const slipInput = document.getElementById('k-dispatch-slip-edit');
      if (slipInput && slipInput.files && slipInput.files[0]) {
        try {
          ECO_UI.toast('Đang tải phiếu xuất kho lên Google Drive...', 'info');
          const res = await window.ECO_Drive.uploadFile(slipInput.files[0], { folder: 'Kho/XuatKho', module: 'kho', type: 'dispatch_slip' });
          log.dispatchSlip = _makeFileRef(res, slipInput.files[0]);
          changed = true;
        } catch(e) { ECO_UI.toast('Lỗi tải phiếu xuất kho: ' + e.message, 'error'); }
      }
    }

    if (!changed) {
      ECO_UI.toast('Chưa chọn file nào để tải lên', 'warning');
      return;
    }

    logs[logIdx] = log;
    ECO_Storage.saveInventoryLogs(logs);
    ECO_UI.toast('Đã lưu tài liệu đính kèm', 'success');
    ECO_UI.closeModal();
    this.render();
  },

  _renderFileAttachments(log) {
    const _fileLink = (file, label) => {
      if (!file || !file.url) return '';
      const name = file.name || label;
      return `<a href="${file.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${name}" style="display:inline-flex;align-items:center;gap:6px;color:#15803D;text-decoration:none;font-weight:700;font-size:0.82rem;background:rgba(21,128,61,0.07);border:1px solid rgba(21,128,61,0.18);border-radius:8px;padding:6px 12px;"><i data-lucide="file-check" style="width:14px;height:14px;flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${name}</span></a>`;
    };

    const parts = [];

    if (log.type === 'in') {
      if (log.deliveryNote && log.deliveryNote.url) {
        parts.push(`<div><div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Phiếu giao hàng</div>${_fileLink(log.deliveryNote, 'Phiếu giao hàng')}</div>`);
      }
      if (log.warehousePhotos && log.warehousePhotos.length) {
        const photoLinks = log.warehousePhotos.map((p, i) => _fileLink(p, 'Ảnh ' + (i + 1))).join('');
        parts.push(`<div><div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Hình ảnh nhập kho (${log.warehousePhotos.length})</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${photoLinks}</div></div>`);
      }
    } else {
      if (log.dispatchSlip && log.dispatchSlip.url) {
        parts.push(`<div><div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Phiếu xuất kho</div>${_fileLink(log.dispatchSlip, 'Phiếu xuất kho')}</div>`);
      }
    }

    if (!parts.length) return '';
    return `<div style="background:rgba(21,128,61,0.04);border:1px solid rgba(21,128,61,0.12);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;flex-direction:column;gap:10px;">${parts.join('')}</div>`;
  },

  viewItemHistory(matId) {
    const materials = ECO_Storage.getMaterials();
    const mat = materials.find(m => m.id == matId);
    const logs = ECO_Storage.getInventoryLogs();
    const movements = [];
    logs.forEach(log => { (log.items || []).forEach(item => { if (item.matId == matId) movements.push({ log, item }); }); });
    movements.sort((a, b) => new Date(b.log.date || b.log.createdAt) - new Date(a.log.date || a.log.createdAt));
    const totalIn  = movements.filter(m => m.log.type === 'in').reduce((s, m) => s + m.item.qty, 0);
    const totalOut = movements.filter(m => m.log.type === 'out').reduce((s, m) => s + m.item.qty, 0);

    const stockGrouped = this._calcStock();
    const subconBreakdown = [];
    Object.entries(stockGrouped).forEach(([subcon, subStock]) => {
      if (subcon === 'Tất cả') return;
      if (subStock[matId] && Math.abs(subStock[matId].total) > 0.001) {
        subconBreakdown.push({ subcon, total: subStock[matId].total });
      }
    });

    ECO_UI.openModal('Lịch sử: ' + (mat?.name || '—'), `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
        <div class="eco-kho-stat"><div class="eco-kho-stat-label">Tổng nhập</div><div class="eco-kho-stat-val" style="color:#15803D;">${ECO_UI.fmtNum(totalIn, 2)} <span style="font-size:0.85rem;">${mat?.unit || ''}</span></div></div>
        <div class="eco-kho-stat"><div class="eco-kho-stat-label">Tổng xuất</div><div class="eco-kho-stat-val" style="color:#E31837;">${ECO_UI.fmtNum(totalOut, 2)} <span style="font-size:0.85rem;">${mat?.unit || ''}</span></div></div>
        <div class="eco-kho-stat"><div class="eco-kho-stat-label">Tồn hiện tại</div><div class="eco-kho-stat-val" style="color:${(totalIn - totalOut) < 0 ? '#E31837' : '#0056FF'};">${ECO_UI.fmtNum(totalIn - totalOut, 2)} <span style="font-size:0.85rem;">${mat?.unit || ''}</span></div></div>
      </div>
      
      ${subconBreakdown.length > 0
        ? `
          <div style="margin-bottom:20px; background: rgba(255,255,255,0.4); border: 1px solid rgba(0,86,255,0.08); border-radius: 10px; padding: 12px 16px;">
            <div style="font-size:0.8rem;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.04em;">Tồn kho thực tế theo nhà thầu phụ</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${subconBreakdown.map(b => `
                <div style="background:rgba(0,86,255,0.05);border:1px solid rgba(0,86,255,0.1);border-radius:8px;padding:8px 14px;font-size:0.86rem;font-weight:600;">
                  <span style="color:#64748B;">${b.subcon}:</span>
                  <span style="color:#0056FF;font-weight:800;margin-left:4px;">${ECO_UI.fmtNum(b.total, 2)} ${mat?.unit || ''}</span>
                </div>
              `).join('')}
            </div>
          </div>
          `
        : ''
      }

      <div style="overflow-x:auto;border:1px solid rgba(0,0,0,0.08);border-radius:10px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="background:rgba(0,86,255,0.06);">
            <tr>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;width:110px;">Ngày</th>
              <th style="padding:10px 14px;text-align:center;font-size:0.8rem;font-weight:700;color:#475569;width:90px;">Loại</th>
              <th style="padding:10px 14px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Đối tượng</th>
              <th style="padding:10px 14px;width:120px;text-align:left;font-size:0.8rem;font-weight:700;color:#475569;">Quy cách</th>
              <th style="padding:10px 14px;width:110px;text-align:right;font-size:0.8rem;font-weight:700;color:#475569;">Số lượng</th>
            </tr>
          </thead>
          <tbody>
            ${movements.length === 0
              ? ECO_UI.tableEmpty(5, 'Chưa có lịch sử.')
              : movements.map(({ log, item }) => `
                <tr onclick="KhoModule.viewLogDetail(${log.id})" style="cursor:pointer;border-top:1px solid rgba(0,0,0,0.06);">
                  <td style="padding:10px 14px;font-size:0.85rem;">${ECO_UI.fmtDate(log.date)}</td>
                  <td style="padding:10px 14px;text-align:center;">${ECO_UI.typeBadge(log.type)}</td>
                  <td style="padding:10px 14px;font-size:0.88rem;">${log.type === 'in' ? (log.poNo ? 'Theo PO: ' + log.poNo : 'Nhập lẻ') : 'Xuất cho: ' + (log.subconName || '—')}</td>
                  <td style="padding:10px 14px;font-size:0.85rem;color:#475569;">${item.variant || 'Tiêu chuẩn'}</td>
                  <td style="padding:10px 14px;text-align:right;font-weight:800;color:${log.type === 'in' ? '#15803D' : '#E31837'};">${log.type === 'in' ? '+' : '-'}${ECO_UI.fmtNum(item.qty, 2)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`,
      `<button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Đóng</button>`
    );
  },

  async triggerManualSanitize() {
    if (!confirm('Hệ thống sẽ rà soát toàn bộ cơ sở dữ liệu để tìm và xóa triệt để:\n1. Các phiếu kho nhập theo PO đã bị xóa.\n2. Các vật tư trong PO hoặc phiếu kho không tồn tại trong danh mục.\n\nBạn có muốn thực hiện không?')) return;
    try {
      ECO_UI.toast('Đang rà soát dữ liệu...', 'info');
      
      const pos = ECO_Storage._rawPOs();
      const logs = ECO_Storage.getInventoryLogs();
      const materials = ECO_Storage.getMaterials();
      const suppliers = ECO_Storage.getSuppliers();

      const poIds = new Set(pos.map(p => String(p.id)));
      const poNos = new Set(pos.map(p => String(p.poNo || '').trim().toLowerCase()).filter(Boolean));
      const matIds = new Set(materials.map(m => String(m.id)));

      let logsDeleted = 0;
      let logItemsDeleted = 0;
      let poItemsDeleted = 0;
      let supplierMatsDeleted = 0;

      // 1. Logs
      const cleanedLogs = [];
      logs.forEach(log => {
        if (log.type === 'in') {
          if (log.poId && !poIds.has(String(log.poId))) {
            logsDeleted++;
            return;
          }
          if (log.poNo && !log.poId && !poNos.has(String(log.poNo).trim().toLowerCase())) {
            logsDeleted++;
            return;
          }
        }

        const originalItemCount = (log.items || []).length;
        const validItems = (log.items || []).filter(item => {
          const exist = matIds.has(String(item.matId));
          if (!exist) logItemsDeleted++;
          return exist;
        });

        if (validItems.length === 0 && originalItemCount > 0) {
          logsDeleted++;
          return;
        }

        if (validItems.length !== originalItemCount) {
          log.items = validItems;
        }
        cleanedLogs.push(log);
      });

      // 2. PO items
      pos.forEach(p => {
        const originalItemCount = (p.items || []).length;
        const validItems = (p.items || []).filter(item => {
          const exist = matIds.has(String(item.matId));
          if (!exist) poItemsDeleted++;
          return exist;
        });
        if (validItems.length !== originalItemCount) {
          p.items = validItems;
        }
      });

      // 3. Suppliers
      suppliers.forEach(s => {
        const originalCount = (s.providedMaterials || []).length;
        const validMats = (s.providedMaterials || []).filter(matId => {
          const exist = matIds.has(String(matId));
          if (!exist) supplierMatsDeleted++;
          return exist;
        });
        if (validMats.length !== originalCount) {
          s.providedMaterials = validMats;
        }
      });

      const totalChanges = logsDeleted + logItemsDeleted + poItemsDeleted + supplierMatsDeleted;

      if (totalChanges > 0) {
        if (logsDeleted > 0 || logItemsDeleted > 0) {
          const cleanLogsToSave = cleanedLogs.map(({ items, ...l }) => ({
            ...l,
            items: (items || []).map(({ name, unit, ...it }) => it)
          }));
          await ECO_Storage.saveInventoryLogs(cleanLogsToSave);
        }
        if (poItemsDeleted > 0) {
          await ECO_Storage.savePOs(pos);
        }
        if (supplierMatsDeleted > 0) {
          await ECO_Storage.saveSuppliers(suppliers);
        }

        ECO_UI.toast(`Đã dọn dẹp xong: Xóa ${logsDeleted} phiếu mồ côi, ${logItemsDeleted} vật tư mồ côi, ${poItemsDeleted} vật tư PO mồ côi!`, 'success');
        this.render();
      } else {
        ECO_UI.toast('Cơ sở dữ liệu hoàn toàn sạch sẽ, không phát hiện dữ liệu mồ côi.', 'success');
      }
    } catch(err) {
      console.error(err);
      ECO_UI.toast('Lỗi rà soát dữ liệu: ' + err.message, 'error');
    }
  }
};
window.KhoModule = KhoModule;

// ===== KHỐI LƯỢNG ĐỊNH MỨC =====
// Danh mục vật tư & thiết bị lấy thẳng từ BOQ (khối lượng thi công). Mỗi hạng
// mục được gán cho 1 Nhà thầu phụ và đặt KL định mức (phải ≤ KL BOQ). Có cảnh
// báo khi nhập vượt. Lưu trực tiếp vào BOQ qua các trường subconName & normQty.
const MatModule = {
  currentSystem: 'electrical',
  collapsed: new Set(),
  _sysLabel(sysId) {
    const map = { electrical: 'Điện', elv: 'Điện - Điện nhẹ', plumbing: 'Cấp thoát nước', acmv: 'Điều hòa Thông gió', fire: 'Phòng cháy Chữa cháy' };
    return map[sysId] || sysId || '—';
  },
  _boq() {
    return (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
  },
  _cap(b) { return (b.contractedQty || 0) + (b.voQty || 0); },
  _subconOptions(selected) {
    const subcons = Object.values(window.subcontractorsData || {});
    let html = `<option value="">— Chọn thầu phụ —</option>`;
    subcons.forEach(s => { html += `<option value="${s.name}" ${s.name === selected ? 'selected' : ''}>${s.name}</option>`; });
    return html;
  },
  switchSystem(sysId) {
    this.currentSystem = sysId;
    this.render();
  },
  toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.render();
  },
  render() {
    const el = document.getElementById('mat-content');
    if (!el) return;
    const boq = this._boq();
    const showBOQ = typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSubcontractor();
    const colsCount = 6;

    const items = boq.filter(b => b.system === this.currentSystem);
    // Sắp xếp items theo ID để đảm bảo thứ tự ban đầu được bảo toàn
    items.sort((a, b) => {
      return String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
    });

    // Group tree: scope → L1 → L2 → L3
    const groups = {};
    items.forEach(item => {
      const sc = item.scope || 'Chung';
      const l1 = item.level1 || 'none';
      const l2 = item.level2 || 'none';
      const l3 = item.level3 || 'none';
      if (!groups[sc]) groups[sc] = {};
      if (!groups[sc][l1]) groups[sc][l1] = {};
      if (!groups[sc][l1][l2]) groups[sc][l1][l2] = {};
      if (!groups[sc][l1][l2][l3]) groups[sc][l1][l2][l3] = [];
      groups[sc][l1][l2][l3].push(item);
    });

    let rows = '';
    if (items.length === 0) {
      rows = ECO_UI.tableEmpty(colsCount, 'Chưa có dữ liệu cho hệ thống này.');
    } else {
      Object.keys(groups).forEach(scope => {
        const scopeKey = scope;
        const scopeCollapsed = this.collapsed.has(scopeKey);
        const scopeItems = items.filter(i => (i.scope || 'Chung') === scope);

        rows += `
          <tr onclick="MatModule.toggleGroup('${scopeKey.replace(/'/g, "\\'")}')" style="cursor:pointer;background:rgba(0,51,160,0.12);">
            <td colspan="${colsCount}" style="padding:10px 16px;font-weight:800;font-size:0.9rem;color:#0033A0;border-bottom:2px solid rgba(0,86,255,0.2);">
              <span style="margin-right:8px;font-size:0.75rem;">${scopeCollapsed ? '<i data-lucide="chevron-right" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i>' : '<i data-lucide="chevron-down" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i>'}</span>
              ${scope}
              <span style="margin-left:12px;font-size:0.78rem;font-weight:600;color:#475569;">${scopeItems.length} hạng mục</span>
            </td>
          </tr>`;

        if (scopeCollapsed) return;

        Object.keys(groups[scope]).forEach(l1 => {
          const l1Key = `${scopeKey}||${l1}`;
          const l1Collapsed = this.collapsed.has(l1Key);

          if (l1 !== 'none') {
            rows += `
              <tr onclick="MatModule.toggleGroup('${l1Key.replace(/'/g, "\\'")}')" style="cursor:pointer;background:rgba(0,86,255,0.07);">
                <td colspan="${colsCount}" style="padding:8px 16px 8px 32px;font-weight:700;font-size:0.85rem;color:#0056FF;">
                  <span style="margin-right:8px;font-size:0.7rem;">${l1Collapsed ? '<i data-lucide="chevron-right" style="width:12px;height:12px;vertical-align:middle;display:inline-block"></i>' : '<i data-lucide="chevron-down" style="width:12px;height:12px;vertical-align:middle;display:inline-block"></i>'}</span>${l1}
                </td>
              </tr>`;
            if (l1Collapsed) return;
          }

          Object.keys(groups[scope][l1]).forEach(l2 => {
            const l2Key = `${l1Key}||${l2}`;
            const l2Collapsed = this.collapsed.has(l2Key);

            if (l2 !== 'none') {
              rows += `
                <tr onclick="MatModule.toggleGroup('${l2Key.replace(/'/g, "\\'")}')" style="cursor:pointer;background:rgba(0,86,255,0.04);">
                  <td colspan="${colsCount}" style="padding:7px 16px 7px 48px;font-weight:600;font-size:0.82rem;color:#334155;">
                    <span style="margin-right:6px;font-size:0.65rem;">${l2Collapsed ? '<i data-lucide="chevron-right" style="width:10px;height:10px;vertical-align:middle;display:inline-block"></i>' : '<i data-lucide="chevron-down" style="width:10px;height:10px;vertical-align:middle;display:inline-block"></i>'}</span>${l2}
                  </td>
                </tr>`;
              if (l2Collapsed) return;
            }

            Object.keys(groups[scope][l1][l2]).forEach(l3 => {
              const l3Key = `${l2Key}||${l3}`;
              const l3Collapsed = this.collapsed.has(l3Key);

              if (l3 !== 'none') {
                rows += `
                  <tr onclick="MatModule.toggleGroup('${l3Key.replace(/'/g, "\\'")}')" style="cursor:pointer;background:rgba(248,250,252,0.6);">
                    <td colspan="${colsCount}" style="padding:6px 16px 6px 64px;font-weight:600;font-style:italic;font-size:0.8rem;color:#64748B;">
                      <span style="margin-right:6px;font-size:0.6rem;">${l3Collapsed ? '<i data-lucide="chevron-right" style="width:10px;height:10px;vertical-align:middle;display:inline-block"></i>' : '<i data-lucide="chevron-down" style="width:10px;height:10px;vertical-align:middle;display:inline-block"></i>'}</span>${l3}
                    </td>
                  </tr>`;
                if (l3Collapsed) return;
              }

              groups[scope][l1][l2][l3].forEach(b => {
                const cap = this._cap(b);
                const norm = b.normQty || 0;
                const isOver = norm > cap + 0.001;
                const indent = (l1 !== 'none' ? (l2 !== 'none' ? (l3 !== 'none' ? 80 : 64) : 48) : 32);

                rows += `
                  <tr data-boq-id="${b.id}" style="border-bottom:1px solid rgba(0,0,0,0.04);">
                    <td style="padding:8px 8px 8px ${indent}px;font-family:monospace;font-size:0.78rem;color:#475569;white-space:nowrap;">
                      <code style="font-size:0.78rem;background:rgba(0,86,255,0.08);padding:2px 6px;border-radius:4px;">${b.id}</code>
                    </td>
                    <td style="padding:8px;font-size:0.85rem;font-weight:500;">${b.name}</td>
                    <td style="padding:8px;text-align:center;font-size:0.82rem;color:#475569;">${b.unit || ''}</td>
                    <td style="width:170px;">
                      <select class="eco-select" style="font-size:0.82rem;padding:6px 8px;" onchange="MatModule.setSubcon('${b.id}', this.value)">
                        ${this._subconOptions(b.subconName)}
                      </select>
                    </td>
                    <td style="width:150px;">
                      <input type="number" min="0" step="0.01" value="${norm || ''}" placeholder="0"
                        class="eco-input mat-norm-input" style="font-size:0.85rem;text-align:right;padding:6px 8px;${isOver ? 'border-color:#E31837;box-shadow:0 0 0 2px rgba(227,24,55,0.15);' : ''}"
                        onchange="MatModule.setNorm('${b.id}', this.value, this)">
                      ${showBOQ ? `<div style="text-align:right;font-size:0.7rem;color:#94A3B8;margin-top:2px;">tối đa ${ECO_UI.fmtNum(cap, 2)} ${b.unit || ''}</div>` : ''}
                    </td>
                    <td class="mat-warn-cell" style="text-align:center;width:120px;">${MatModule._warnBadge(norm, cap, b.subconName)}</td>
                  </tr>`;
              });
            });
          });
        });
      });
    }

    const systemsHtml = (typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS : []).map(s => {
      const isActive = this.currentSystem === s.id;
      return `
        <button class="btn ${isActive ? 'btn-primary' : 'btn-outline'}" 
                onclick="MatModule.switchSystem('${s.id}')" 
                style="font-size:0.85rem;padding:8px 18px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;font-family:inherit;">
          ${s.icon || ''} ${s.name}
        </button>`;
    }).join(' ');

    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        ${systemsHtml}
      </div>
      <div class="glass-panel content-table-panel">
        <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
          <h3 style="font-size:1rem;font-weight:700;margin:0;">Khối lượng định mức (${this._sysLabel(this.currentSystem)})</h3>
          <p style="margin:4px 0 0;font-size:0.8rem;color:#94A3B8;">Danh mục lấy từ BOQ (khối lượng thi công). Gán Nhà thầu phụ và đặt KL định mức cho mỗi hạng mục ${showBOQ ? '— KL định mức phải ≤ KL BOQ' : ''}.</p>
        </div>
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead><tr>
              <th style="width:100px;">Mã BOQ</th>
              <th>Vật tư / Thiết bị (hạng mục BOQ)</th>
              <th style="text-align:center;width:60px;">ĐVT</th>
              <th style="width:170px;">Nhà thầu phụ</th>
              <th style="width:150px;">KL định mức</th>
              <th style="text-align:center;width:120px;">Cảnh báo</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="padding:10px 20px;font-size:0.78rem;color:#94A3B8;border-top:1px solid rgba(0,0,0,0.06);">
          <i data-lucide="lightbulb" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> KL định mức là khối lượng giao khoán cho thầu phụ${showBOQ ? '. Có thể nhập vượt KL BOQ nhưng hệ thống sẽ cảnh báo để kiểm tra lại' : ''}.
        </div>
      </div>`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },
  _saveBoq(boq) {
    if (typeof ECO_BOQStorage !== 'undefined') ECO_BOQStorage.saveBOQ(boq);
  },

  // Tạo badge cảnh báo — dùng chung cho render và partial update.
  _warnBadge(norm, cap, subconName) {
    const isOver = norm > cap + 0.001;
    if (isOver)            return `<span class="badge badge-alert">⚠ Vượt KL BOQ</span>`;
    if (norm > 0 && !subconName) return `<span class="badge badge-warning">Thiếu thầu phụ</span>`;
    if (norm > 0 && subconName)  return `<span class="badge badge-active">OK</span>`;
    return `<span style="color:#CBD5E1;font-size:0.8rem;">—</span>`;
  },

  // Cập nhật badge cảnh báo của 1 row mà không re-render toàn bảng.
  _updateRowWarn(itemId, norm, cap, subconName) {
    const row = document.querySelector(`tr[data-boq-id="${CSS.escape(itemId)}"]`);
    if (!row) return;
    const warnCell = row.querySelector('.mat-warn-cell');
    if (warnCell) warnCell.innerHTML = this._warnBadge(norm, cap, subconName);
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  },

  setSubcon(itemId, subcon) {
    const boq = this._boq();
    const b = boq.find(x => x.id === itemId);
    if (!b) return;
    b.subconName = subcon || null;
    this._saveBoq(boq);
    ECO_UI.toast(subcon ? 'Đã gán: ' + itemId + ' → ' + subcon : 'Đã bỏ gán thầu phụ: ' + itemId, 'success');
    this._updateRowWarn(itemId, b.normQty || 0, this._cap(b), b.subconName);
  },

  setNorm(itemId, val, inputEl) {
    const boq = this._boq();
    const b = boq.find(x => x.id === itemId);
    if (!b) return;
    const cap = this._cap(b);
    let parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    const isOver = parsed > cap + 0.001;
    if (inputEl) {
      inputEl.style.borderColor = isOver ? '#E31837' : '';
      inputEl.style.boxShadow   = isOver ? '0 0 0 2px rgba(227,24,55,0.15)' : '';
    }
    b.normQty = parsed;
    this._saveBoq(boq);
    if (isOver) {
      ECO_UI.toast('⚠ KL định mức (' + ECO_UI.fmtNum(parsed, 2) + ') vượt KL BOQ (' + ECO_UI.fmtNum(cap, 2) + ' ' + (b.unit || '') + '). Đã lưu — cần xem xét lại.', 'warning');
    } else if (parsed > 0) {
      ECO_UI.toast('Đã lưu KL định mức: ' + ECO_UI.fmtNum(parsed, 2) + ' ' + (b.unit || ''), 'success');
    }
    this._updateRowWarn(itemId, parsed, cap, b.subconName);
  },
};
window.MatModule = MatModule;

// ===== TỔNG QUAN VẬT TƯ (dashboard động) =====
const OverviewModule = {
  async syncMaterialsFromBOQ() {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền đồng bộ vật tư!', 'error');
      return;
    }
    if (!confirm('Bạn có muốn đồng bộ lại danh mục Vật tư từ bảng BOQ hiện tại không? Hệ thống sẽ cập nhật thông tin và giữ nguyên các vật tư tự thêm ngoài BOQ.')) {
      return;
    }
    ECO_UI.toast('Đang đồng bộ danh mục vật tư từ BOQ...', 'info');
    try {
      const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
      if (boq.length === 0) {
        ECO_UI.toast('Không có dữ liệu BOQ để đồng bộ', 'warning');
        return;
      }
      
      const existingMats = ECO_Storage.getMaterials() || [];
      const mergedMats = [...existingMats];

      boq.forEach(b => {
        const exist = mergedMats.find(m => String(m.boqItemId) === String(b.id));
        if (exist) {
          exist.name = b.name;
          exist.code = b.code || exist.code || `BOQ-${b.id}`;
          exist.system = b.system;
          exist.unit = b.unit || exist.unit || '—';
        } else {
          const nextMatId = ECO_Storage.nextId(mergedMats);
          mergedMats.push({
            id: nextMatId,
            name: b.name,
            code: b.code || `BOQ-${b.id}`,
            system: b.system,
            unit: b.unit || '—',
            boqItemId: b.id,
            minStock: 0,
            spec: '',
            notes: 'Đồng bộ từ BOQ'
          });
        }
      });
      
      await ECO_Storage.saveMaterials(mergedMats);
      ECO_UI.toast('Đồng bộ thành công ' + boq.length + ' vật tư từ BOQ! Giữ nguyên các vật tư khác.', 'success');
      this.render();
    } catch (e) {
      console.error(e);
      ECO_UI.toast('Lỗi đồng bộ: ' + (e.message || e), 'error');
    }
  },

  render() {
    const el = document.getElementById('mat-overview-content');
    if (!el) return;
    const mats = ECO_Storage.getMaterials();
    const logs = ECO_Storage.getInventoryLogs();
    const linked = mats.filter(m => m.boqItemId).length;
    const stock = (window.KhoModule ? KhoModule._calcStock()["Tất cả"] : {}) || {};
    const isSuperAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();

    // Tồn kho theo vật tư (giảm dần)
    const stockRows = Object.entries(stock)
      .map(([matId, s]) => ({ mat: mats.find(m => m.id == matId), s }))
      .filter(r => r.mat).sort((a, b) => b.s.total - a.s.total);

    // KL Nhập tự động đổ vào BOQ
    const recv = (window.ECO_MatLink ? ECO_MatLink.receivedByBoq() : {});
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    const boqById = {}; boq.forEach(b => boqById[b.id] = b);
    const flowRows = Object.entries(recv)
      .map(([bid, qty]) => ({ b: boqById[bid], qty })).filter(r => r.b)
      .sort((a, b) => b.qty - a.qty);

    el.innerHTML = `
      ${isSuperAdmin ? `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button class="btn btn-outline" onclick="OverviewModule.syncMaterialsFromBOQ()" style="font-size:0.8rem;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;">
          <i data-lucide="refresh-cw" style="width:14px;height:14px;vertical-align:middle;display:inline-block"></i> Đồng bộ Vật tư từ BOQ
        </button>
      </div>
      ` : ''}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px;">
        <div class="glass-panel eco-kho-stat"><div class="eco-kho-stat-label">Tổng vật tư</div><div class="eco-kho-stat-val" style="color:#0056FF;">${mats.length}</div></div>
        <div class="glass-panel eco-kho-stat"><div class="eco-kho-stat-label">Đã liên kết BOQ</div><div class="eco-kho-stat-val" style="color:#15803D;">${linked}/${mats.length}</div></div>
        <div class="glass-panel eco-kho-stat"><div class="eco-kho-stat-label">Phiếu nhập kho</div><div class="eco-kho-stat-val" style="color:#0056FF;">${logs.filter(l => l.type === 'in').length}</div></div>
        <div class="glass-panel eco-kho-stat"><div class="eco-kho-stat-label">Phiếu xuất kho</div><div class="eco-kho-stat-val" style="color:#E31837;">${logs.filter(l => l.type === 'out').length}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="glass-panel content-table-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,0.5);">
            <h3 style="font-size:0.95rem;font-weight:700;margin:0;">Tồn kho hiện tại</h3>
            <button class="btn btn-outline" onclick="switchMaterialsSection('kho'); KhoModule.setTab('stock')" style="font-size:0.78rem;padding:6px 12px;">Chi tiết kho →</button>
          </div>
          <div class="table-container" style="margin:0;border-radius:0;">
            <table class="tech-table">
              <thead><tr><th>Vật tư</th><th style="text-align:center;width:60px;">ĐVT</th><th style="text-align:right;width:120px;">Tồn kho</th></tr></thead>
              <tbody>
                ${stockRows.length === 0
                  ? ECO_UI.tableEmpty(3, 'Chưa có phát sinh nhập/xuất kho.')
                  : stockRows.map(({ mat, s }) => `
                    <tr onclick="KhoModule.viewItemHistory(${mat.id})" style="cursor:pointer;">
                      <td style="font-weight:600;">${mat.name}</td>
                      <td style="text-align:center;color:#475569;">${mat.unit}</td>
                      <td style="text-align:right;font-weight:800;color:${s.total < 0 ? '#E31837' : '#0056FF'};">${ECO_UI.fmtNum(s.total, 2)}</td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="glass-panel content-table-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,0.5);">
            <h3 style="font-size:0.95rem;font-weight:700;margin:0;">Nhập hàng → KL Nhập (BOQ)</h3>
            <button class="btn btn-outline" onclick="switchMaterialsSection('catalog'); MatModule.render()" style="font-size:0.78rem;padding:6px 12px;">Liên kết →</button>
          </div>
          <div class="table-container" style="margin:0;border-radius:0;">
            <table class="tech-table">
              <thead><tr><th style="width:90px;">Mã BOQ</th><th>Hạng mục</th><th style="text-align:right;width:130px;">KL Nhập</th></tr></thead>
              <tbody>
                ${flowRows.length === 0
                  ? ECO_UI.tableEmpty(3, 'Chưa có vật tư liên kết nào được nhập kho.')
                  : flowRows.map(({ b, qty }) => `
                    <tr>
                      <td><code style="font-size:0.78rem;background:rgba(21,128,61,0.1);padding:2px 6px;border-radius:4px;color:#15803D;">${b.id}</code></td>
                      <td style="font-weight:600;font-size:0.86rem;">${b.name}</td>
                      <td style="text-align:right;font-weight:800;color:#15803D;">${ECO_UI.fmtNum(qty, 2)} <span style="font-size:0.78rem;color:#94A3B8;">${b.unit || ''}</span></td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div style="padding:10px 18px;font-size:0.76rem;color:#94A3B8;border-top:1px solid rgba(0,0,0,0.06);">Số liệu tự động từ phiếu nhập kho — đồng bộ thẳng vào cột KL Nhập của BOQ.</div>
        </div>
      </div>`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },
};
window.OverviewModule = OverviewModule;

// Modal: stop click propagation from modal-box so backdrop never accidentally closes it
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('eco-modal-box');
  if (box) box.addEventListener('click', e => e.stopPropagation());
  
  // Initialize cover flows on page load
  if (window.initCoverFlows) window.initCoverFlows();
});

// ==================== USER GUIDE MODALS DATA & ACTION ====================
window.openGuideModal = function(moduleId) {
  const guides = {
    schedule: {
      title: "HƯỚNG DẪN: TIẾN ĐỘ THI CÔNG",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Tiến độ thi công</strong> giúp theo dõi tiến độ lắp đặt chi tiết của các hệ thống cơ điện công trình ECO Long An.</p>
          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 20px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 8px; font-size: 0.9rem; text-transform: uppercase;">Các tính năng chính:</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.88rem;">
              <li style="margin-bottom: 8px;"><strong>Thống kê tiến độ hệ thống:</strong> Xem tỷ lệ phần trăm hoàn thành tổng thể của các hệ Điện, Điện nhẹ, Cấp thoát nước.</li>
              <li style="margin-bottom: 8px;"><strong>Trạng thái hạng mục:</strong>
                <span class="badge badge-active">ON TRACK</span> chỉ tiến độ đạt kế hoạch.
                <span class="badge badge-alert">BỊ TRỄ</span> chỉ hạng mục bị chậm cần đẩy nhanh.
              </li>
              <li><strong>Chi tiết khu vực:</strong> Theo dõi phạm vi thi công thực tế tại công trường.</li>
            </ul>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-secondary);">
            <i data-lucide="info" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Dữ liệu tiến độ được đồng bộ hàng ngày từ báo cáo của Chỉ huy trưởng các thầu phụ.
          </div>
        </div>
      `
    },
    boq: {
      title: "HƯỚNG DẪN: KHỐI LƯỢNG THI CÔNG (BOQ)",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Khối lượng thi công (BOQ)</strong> là bảng khối lượng hợp đồng MEP — hiển thị song song KL hợp đồng với KL vật tư đã nhập kho thực tế, hỗ trợ kiểm soát tiến độ cung ứng vật tư theo từng hệ thống.</p>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">1. Chuyển đổi hệ thống MEP</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Sử dụng thanh <strong>Cover Flow</strong> ở header để chuyển giữa các hệ thống:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li>Điện · Điện nhẹ · Cấp thoát nước · Điều hòa Thông gió · Phòng cháy Chữa cháy</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">2. Cấu trúc bảng BOQ</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Mỗi hàng là một hạng mục công việc với đầy đủ các cột sau:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;"><strong>Mã hiệu</strong> — mã định danh hạng mục theo phân cấp hợp đồng</li>
              <li style="margin-bottom: 5px;"><strong>Nội dung công việc</strong> — tên hạng mục; nhấp vào hàng tiêu đề phân cấp để thu gọn / mở rộng nhóm</li>
              <li style="margin-bottom: 5px;"><strong>Đơn giá</strong> <span style="color:#0056FF;">(nhấp để cập nhật)</span> — đơn giá hợp đồng tính bằng VNĐ</li>
              <li style="margin-bottom: 5px;"><strong>KL Hợp đồng</strong> — khối lượng theo hợp đồng ký kết</li>
              <li style="margin-bottom: 5px;"><strong>Thành tiền HĐ</strong> — Đơn giá × KL Hợp đồng, tính tự động</li>
              <li style="margin-bottom: 5px;"><strong>KL Nhập</strong> <span style="color:#15803D;">(tự động, nhấp để xem nguồn)</span> — tổng khối lượng vật tư đã nhập kho thực tế, đồng bộ từ module Vật tư</li>
              <li style="margin-bottom: 5px;"><strong>Thành tiền Nhập</strong> — Đơn giá × KL Nhập, phản ánh giá trị vật tư đã về công trường</li>
              <li><strong>Cảnh báo</strong> — hiển thị khi KL Nhập vượt KL Hợp đồng hoặc có bất thường cần xử lý</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">3. Thu gọn / Mở rộng</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">Nhấp trực tiếp vào <strong>hàng tiêu đề phân cấp</strong> để thu gọn hoặc mở rộng nhóm đó</li>
              <li>Dùng nút <strong>Thu gọn tất cả</strong> / <strong>Mở rộng tất cả</strong> trên thanh công cụ để thao tác đồng loạt</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">4. Import / Export Excel</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;"><strong>Import Excel</strong> — nạp dữ liệu BOQ từ file Excel có sẵn; file cần có các cột: <em>Mã | Phạm vi | L1 | L2 | L3 | Tên | ĐVT | KL</em></li>
              <li><strong>Xuất Excel</strong> — xuất toàn bộ bảng BOQ hiện tại ra file Excel gồm đầy đủ KL hợp đồng, đơn giá, thành tiền và KL nhập thực tế</li>
            </ul>
          </div>

          <div style="font-size: 0.82rem; color: var(--text-secondary); display:flex; gap:16px; flex-wrap:wrap;">
            <span><i data-lucide="link" style="width:13px;height:13px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> <strong>KL Nhập</strong> đồng bộ tự động từ phiếu nhập kho — không nhập tay. Nhấp vào ô để xem chi tiết từng vật tư đóng góp.</span>
          </div>
        </div>
      `
    },
    materials: {
      title: "HƯỚNG DẪN: VẬT TƯ & THIẾT BỊ",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Vật tư & Thiết bị</strong> quản lý toàn diện vòng đời vật tư MEP — từ dự trù khối lượng định mức, lập đơn đặt hàng, quản lý nhà cung cấp đến nhập / xuất kho và theo dõi tồn kho thực tế tại công trường.</p>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">1. Tổng quan vật tư</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Dashboard tổng hợp toàn bộ hoạt động cung ứng vật tư của dự án. Tại đây bạn thấy:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">Số lượng PO đang hoạt động và tổng giá trị đơn hàng</li>
              <li style="margin-bottom: 5px;">Top vật tư còn tồn kho nhiều nhất — nhìn nhanh để điều phối xuất kho</li>
              <li style="margin-bottom: 5px;">Thống kê số lượng nhà cung cấp và vật tư đã được đăng ký trong hệ thống</li>
              <li>Biểu đồ xu hướng nhập / xuất kho theo thời gian</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">2. Đơn đặt hàng (PO)</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Lập và theo dõi toàn bộ Purchase Order của dự án. Mỗi PO bao gồm:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;"><strong>Số PO & ngày đặt hàng</strong> — mã định danh duy nhất cho mỗi đơn</li>
              <li style="margin-bottom: 5px;"><strong>Nhà cung cấp</strong> — chọn từ danh sách nhà cung cấp đã đăng ký; hệ thống tự lọc vật tư phù hợp theo nhà cung cấp được chọn</li>
              <li style="margin-bottom: 5px;"><strong>Thầu phụ thụ hưởng</strong> — liên kết đơn hàng với nhà thầu phụ sẽ sử dụng vật tư này</li>
              <li style="margin-bottom: 5px;"><strong>Danh sách vật tư</strong> — thêm nhiều dòng vật tư, mỗi dòng gồm mã SP, tên, đơn vị tính và số lượng yêu cầu</li>
              <li>Nhấn <strong>"Xem chi tiết"</strong> trên bảng PO để mở toàn bộ thông tin đơn hàng, chỉnh sửa hoặc xóa</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">3. Nhà cung cấp</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Quản lý danh sách đối tác cung ứng chính thức của dự án. Mỗi nhà cung cấp lưu trữ:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">Tên công ty, người đại diện, số điện thoại và email liên hệ</li>
              <li style="margin-bottom: 5px;">Hệ thống MEP phụ trách (điện, nước, PCCC, HVAC…)</li>
              <li>Danh mục vật tư mà nhà cung cấp đó được phép cung ứng — dùng để lọc vật tư khi lập PO</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">4. Tồn kho hiện tại</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Xem số lượng tồn thực tế của từng mã vật tư đang lưu tại kho công trường. Tính năng nổi bật:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">Lọc theo <strong>phân kho</strong> (kho A, B, C…) hoặc xem tổng toàn công trường</li>
              <li style="margin-bottom: 5px;">Số tồn kho = tổng nhập − tổng xuất, tính tự động từ lịch sử phiếu kho</li>
              <li style="margin-bottom: 5px;">Nhấn vào dòng vật tư để xem chi tiết: tồn theo từng nhà thầu phụ, lịch sử giao dịch gần nhất</li>
              <li>Hiển thị cảnh báo khi tồn kho về mức thấp cần bổ sung</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 12px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">5. Lịch sử nhập / xuất</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Tra cứu toàn bộ phiếu nhập kho và xuất kho theo thời gian. Mỗi phiếu ghi nhận:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">Loại giao dịch (<strong>Nhập</strong> từ nhà cung cấp / <strong>Xuất</strong> cho nhà thầu phụ thi công)</li>
              <li style="margin-bottom: 5px;">Ngày thực hiện, mã vật tư, số lượng, đơn vị tính và kho liên quan</li>
              <li style="margin-bottom: 5px;">Nhà thầu phụ nhận vật tư (đối với phiếu xuất kho)</li>
              <li>Nhấn vào phiếu để xem chi tiết hoặc xóa — tồn kho sẽ tự động được hoàn tác khi xóa phiếu</li>
            </ul>
          </div>

          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 16px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase;">6. Khối lượng định mức</h4>
            <p style="font-size: 0.88rem; margin: 0 0 8px;">Tra cứu khối lượng vật tư lý thuyết theo thiết kế (lấy từ BOQ thi công). Dùng để:</p>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.87rem; color: var(--text-secondary);">
              <li style="margin-bottom: 5px;">So sánh KL định mức với thực tế lắp đặt để kiểm soát hao hụt</li>
              <li style="margin-bottom: 5px;">Làm cơ sở dự trù mua hàng cho từng hạng mục và nhà thầu phụ</li>
              <li>Lọc theo hệ thống MEP; gán nhà thầu phụ chịu trách nhiệm thi công từng hạng mục — KL định mức phải ≤ KL BOQ</li>
            </ul>
          </div>

          <div style="font-size: 0.82rem; color: var(--text-secondary); display:flex; gap:16px; flex-wrap:wrap;">
            <span><i data-lucide="arrow-right-left" style="width:13px;height:13px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Tồn kho & lịch sử giao dịch đồng bộ tự động từ phiếu Nhập / Xuất kho thực tế — không cần nhập tay.</span>
            <span><i data-lucide="link" style="width:13px;height:13px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Dữ liệu vật tư liên thông với module <strong>Nhà thầu phụ</strong> (xuất kho gắn trực tiếp với thầu phụ nhận hàng) và module <strong>Khối lượng thi công</strong> (KL nhập kho thực tế cập nhật tự động vào cột KL Nhập của từng hạng mục BOQ).</span>
          </div>
        </div>
      `
    },
    submittals: {
      title: "HƯỚNG DẪN: HỒ SƠ TRÌNH DUYỆT",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Hồ sơ trình duyệt</strong> hỗ trợ theo dõi tiến trình phê duyệt các hồ sơ kỹ thuật quan trọng của dự án.</p>
          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 20px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 8px; font-size: 0.9rem; text-transform: uppercase;">Các phân loại hồ sơ:</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.88rem;">
              <li style="margin-bottom: 8px;"><strong>Bản vẽ Shopdrawing:</strong> Theo dõi tiến độ trình duyệt bản vẽ thi công chi tiết từng hệ thống và khu vực của dự án.</li>
              <li style="margin-bottom: 8px;"><strong>Biện pháp thi công (MOS):</strong> Quản lý trình duyệt quy trình, công nghệ và biện pháp thi công an toàn/kỹ thuật.</li>
              <li style="margin-bottom: 8px;"><strong>Trình duyệt vật liệu (MAS):</strong> Quản lý chất lượng, xuất xứ đầu vào của toàn bộ chủng loại vật tư cơ điện đưa vào công trình.</li>
              <li><strong>Liên kết tài liệu:</strong> Cho phép xem/tải trực tiếp tệp nguồn CAD <span style="color:#0056FF;font-weight:bold;">[DWG]</span> hoặc tệp PDF phê duyệt chính thức <span style="color:#FF1E43;font-weight:bold;">[PDF]</span>.</li>
            </ul>
          </div>
        </div>
      `
    },
    subcontractors: {
      title: "HƯỚNG DẪN: NHÀ THẦU PHỤ",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Nhà thầu phụ</strong> hỗ trợ quản lý nhân sự, sơ đồ tổ chức BCH và danh sách công nhân của từng nhà thầu phụ MEP.</p>
          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 20px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 8px; font-size: 0.9rem; text-transform: uppercase;">Các thông tin quản lý:</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.88rem;">
              <li style="margin-bottom: 8px;"><strong>Thông tin liên hệ & Phạm vi:</strong> Xem nhanh hệ thống phụ trách, khu vực thi công và thông tin Chỉ huy trưởng.</li>
              <li style="margin-bottom: 8px;"><strong>Sơ Đồ Tổ Chức BCH:</strong> Biểu diễn trực quan dạng cây phân cấp quản lý từ Giám đốc dự án đến Giám sát hiện trường.</li>
              <li style="margin-bottom: 8px;"><strong>Danh Sách Công Nhân:</strong> Thống kê chi tiết thông tin công nhân (Họ tên, Vị trí làm việc cụ thể, Số điện thoại) đang làm việc thực tế tại công trường.</li>
            </ul>
          </div>
        </div>
      `
    },
    po: {
      title: "HƯỚNG DẪN: ĐẶT HÀNG (PO)",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Đặt hàng (PO)</strong> số hóa quy trình quản lý đơn hàng vật tư và liên kết với Nhà thầu phụ thi công.</p>
          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 20px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 8px; font-size: 0.9rem; text-transform: uppercase;">Quy trình quản lý PO:</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.88rem;">
              <li style="margin-bottom: 8px;"><strong>Lập Đơn Đặt Hàng:</strong> Tạo PO mới, chọn Nhà cung cấp, liên kết thầu phụ thụ hưởng và lập danh sách chi tiết các mã vật tư yêu cầu số lượng cụ thể.</li>
              <li style="margin-bottom: 8px;"><strong>Danh Sách Nhà Cung Cấp:</strong> Lưu trữ thông tin đối tác cung cấp thiết bị chính thức (tên công ty, đại diện, thông tin liên hệ).</li>
              <li style="margin-bottom: 8px;"><strong>Theo dõi trạng thái:</strong> Cập nhật trạng thái đơn hàng (Chờ duyệt, Đang giao, Đã nhập kho...) để phối hợp điều phối vật tư hiện trường.</li>
            </ul>
          </div>
        </div>
      `
    },
    kho: {
      title: "HƯỚNG DẪN: QUẢN LÝ KHO",
      body: `
        <div style="font-family: inherit; color: var(--text-primary); line-height: 1.6;">
          <p style="margin-bottom: 16px; font-weight: 500;">Khung <strong>Quản lý Kho</strong> kiểm soát số lượng xuất/nhập thực tế của toàn bộ vật tư thiết bị lưu kho công trường.</p>
          <div style="background: rgba(0, 86, 255, 0.05); border-radius: 12px; padding: 16px; border: 1px solid rgba(0, 86, 255, 0.1); margin-bottom: 20px;">
            <h4 style="font-weight: 700; color: var(--ricons-blue-bright); margin-bottom: 8px; font-size: 0.9rem; text-transform: uppercase;">Nghiệp vụ kho:</h4>
            <ul style="padding-left: 20px; margin: 0; font-size: 0.88rem;">
              <li style="margin-bottom: 8px;"><strong>Phiếu Nhập Kho:</strong> Lập phiếu nhập kho dựa theo Số PO đã đặt hoặc Nhập lẻ ngoài PO để tăng trữ lượng tồn kho.</li>
              <li style="margin-bottom: 8px;"><strong>Phiếu Xuất Kho:</strong> Xuất kho cấp phát trực tiếp cho từng Nhà thầu phụ thi công theo khu vực. Hệ thống tự động cảnh báo nếu số lượng xuất vượt quá tồn kho thực tế.</li>
              <li style="margin-bottom: 8px;"><strong>Xem Thẻ Kho Hạng Mục:</strong> Nhấp vào bất kỳ vật tư nào trong danh sách tồn để tra cứu toàn bộ lịch sử chi tiết các lần nhập/xuất có liên quan.</li>
            </ul>
          </div>
        </div>
      `
    }
  };

  const guide = guides[moduleId];
  if (!guide) return;

  ECO_UI.openModal(
    guide.title,
    guide.body,
    `<button onclick="ECO_UI.closeModal()" class="btn btn-primary" style="padding:9px 24px;">Đã hiểu</button>`
  );
  
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 30);
};

// ===== KHAI BÁO DANH MỤC VẬT TƯ MODULE =====
const DanhMucVatTuModule = {
  render() {
    const targets = ['danh-muc-vat-tu-content', 'danh-muc-vat-tu-content-materials'];
    let rendered = false;
    targets.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      rendered = true;

      const materials = ECO_Storage.getMaterials();
      const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
      const isSuperAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();

      el.innerHTML = `
        <div class="glass-panel content-table-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);">
            <div style="display:flex;align-items:center;gap:12px;">
              <h3 style="font-size:1rem;font-weight:700;margin:0;">Khai báo Danh mục Vật tư cung cấp</h3>
              <span style="background:rgba(0,86,255,0.1);color:#0056FF;border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:700;">${materials.length} vật tư</span>
            </div>
            ${isSuperAdmin ? `
            <div style="display:flex;gap:8px;">
              <button class="btn btn-outline" onclick="DanhMucVatTuModule.syncFromBOQ()" style="font-size:0.85rem;padding:8px 18px;color:#D97706;border-color:rgba(217,119,6,0.4);" title="Đồng bộ toàn bộ danh mục vật tư từ BOQ hiện tại">
                <i data-lucide="refresh-cw" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thay thế bằng BOQ
              </button>
              <button class="btn btn-outline btn-blue" onclick="DanhMucVatTuModule.addMaterial()" style="font-size:0.85rem;padding:8px 18px;">
                <i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm Vật tư mới
              </button>
            </div>
            ` : ''}
          </div>
          <div class="table-container" style="margin:0;border-radius:0;">
            <table class="tech-table">
              <thead>
                <tr>
                  <th style="width:120px;">Mã vật tư</th>
                  <th>Tên vật tư (quy cách chi tiết)</th>
                  <th style="width:100px;text-align:center;">Đơn vị</th>
                  <th>Hạng mục BOQ liên kết</th>
                  <th style="width:180px;">Hệ thống MEP</th>
                  ${isSuperAdmin ? `<th style="width:120px;text-align:center;">Thao tác</th>` : ''}
                </tr>
              </thead>
              <tbody>
                ${materials.length === 0
                  ? ECO_UI.tableEmpty(isSuperAdmin ? 6 : 5, 'Chưa có vật tư nào được khai báo.')
                  : materials.map(m => {
                      const matchedBoq = boq.find(b => String(b.id) === String(m.boqItemId));
                      const boqText = matchedBoq ? `[${matchedBoq.code || '—'}] ${matchedBoq.name}` : '<span style="color:#94A3B8;">Chưa liên kết</span>';
                      const sysName = (typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS.find(s => s.id === m.system)?.name : null) || m.system || '—';
                      return `
                        <tr>
                          <td style="font-weight:700;color:#0056FF;">${m.code || '—'}</td>
                          <td style="font-weight:600;color:#0F172A;">${m.name || '—'}</td>
                          <td style="text-align:center;">${m.unit || '—'}</td>
                          <td style="font-size:0.82rem;">${boqText}</td>
                          <td><span style="font-size:0.82rem;background:rgba(0,51,160,0.06);color:#0033A0;padding:3px 8px;border-radius:6px;font-weight:600;">${sysName}</span></td>
                          ${isSuperAdmin ? `
                          <td style="text-align:center;">
                            <button class="btn btn-outline" onclick="DanhMucVatTuModule.editMaterial(${m.id})" style="font-size:0.75rem;padding:4px 8px;margin-right:4px;" title="Sửa vật tư"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
                            <button class="btn btn-outline" onclick="DanhMucVatTuModule.deleteMaterial(${m.id})" style="font-size:0.75rem;padding:4px 8px;color:#E31837;border-color:rgba(227,24,55,0.15);" title="Xóa vật tư"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
                          </td>
                          ` : ''}
                        </tr>`;
                    }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    });

    if (!rendered) return;
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },

  addMaterial() {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền thêm vật tư!', 'error');
      return;
    }
    this.openFormModal();
  },

  editMaterial(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền sửa vật tư!', 'error');
      return;
    }
    const materials = ECO_Storage.getMaterials();
    const m = materials.find(x => x.id === id);
    if (!m) return;
    this.openFormModal(m);
  },

  openFormModal(m = null) {
    const isEdit = !!m;
    const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
    const systems = (typeof ECO_SYSTEMS !== 'undefined' ? ECO_SYSTEMS : []);

    const body = `
      <div class="eco-form-group">
        <label>Mã vật tư (thương hiệu, quy cách viết tắt) *</label>
        <input id="m-code" class="eco-input" placeholder="VD: CAP.CADIVI-3x185" value="${m?.code || ''}">
      </div>
      <div class="eco-form-group">
        <label>Tên vật tư (tên đầy đủ và quy cách) *</label>
        <input id="m-name" class="eco-input" placeholder="VD: Cáp điện lực hạ thế Cadivi CVV 3x185mm2" value="${m?.name || ''}">
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Đơn vị tính *</label>
          <input id="m-unit" class="eco-input" placeholder="VD: m, bộ, cái..." value="${m?.unit || ''}">
        </div>
        <div class="eco-form-group">
          <label>Hệ thống MEP *</label>
          <select id="m-system" class="eco-select" onchange="DanhMucVatTuModule._filterBoqOptions(this.value)">
            <option value="">-- Chọn hệ thống --</option>
            ${systems.map(s => `<option value="${s.id}" ${m?.system === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="eco-form-group">
        <label>Liên kết với Hạng mục BOQ</label>
        <select id="m-boqItemId" class="eco-select">
          <option value="">-- Chọn hạng mục BOQ liên kết --</option>
          ${boq.map(b => `
            <option class="boq-opt" data-system="${b.system || ''}" value="${b.id}" ${String(m?.boqItemId) === String(b.id) ? 'selected' : ''}>
              [${b.code || '—'}] ${b.name} (${b.unit})
            </option>
          `).join('')}
        </select>
      </div>`;

    ECO_UI.openModal(
      isEdit ? 'Chỉnh sửa thông tin vật tư' : 'Thêm vật tư cung cấp mới',
      body,
      `<button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
       <button onclick="DanhMucVatTuModule.saveForm(${m?.id || 'null'})" class="btn btn-primary" style="padding:9px 20px;">
         <i data-lucide="${isEdit ? 'save' : 'plus'}" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>
         ${isEdit ? 'Lưu thay đổi' : 'Thêm vật tư'}
       </button>`,
      { size: 'md' }
    );

    if (m?.system) {
      this._filterBoqOptions(m.system);
    }
  },

  _filterBoqOptions(sysId) {
    const opts = document.querySelectorAll('.boq-opt');
    opts.forEach(opt => {
      if (!sysId || opt.dataset.system === sysId) {
        opt.style.display = 'block';
      } else {
        opt.style.display = 'none';
      }
    });
  },

  async saveForm(id) {
    const code = document.getElementById('m-code').value.trim();
    const name = document.getElementById('m-name').value.trim();
    const unit = document.getElementById('m-unit').value.trim();
    const system = document.getElementById('m-system').value;
    const boqItemId = document.getElementById('m-boqItemId').value;

    if (!code) { ECO_UI.toast('Vui lòng nhập Mã vật tư', 'error'); return; }
    if (!name) { ECO_UI.toast('Vui lòng nhập Tên vật tư', 'error'); return; }
    if (!unit) { ECO_UI.toast('Vui lòng nhập Đơn vị tính', 'error'); return; }
    if (!system) { ECO_UI.toast('Vui lòng chọn Hệ thống MEP', 'error'); return; }

    const materials = ECO_Storage.getMaterials();
    if (id !== null) {
      const idx = materials.findIndex(x => x.id === id);
      if (idx >= 0) {
        materials[idx] = { ...materials[idx], code, name, unit, system, boqItemId };
      }
    } else {
      const nextId = ECO_Storage.nextId(materials);
      materials.push({ id: nextId, code, name, unit, system, boqItemId });
    }

    try {
      await ECO_Storage.saveMaterials(materials);
      ECO_UI.closeModal();
      ECO_UI.toast(id !== null ? 'Đã cập nhật vật tư' : 'Đã thêm vật tư mới', 'success');
      this.render();
    } catch (err) {
      console.error('[DanhMucVatTuModule] saveForm failed:', err);
    }
  },

  async deleteMaterial(id) {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền xóa vật tư!', 'error');
      return;
    }
    if (!confirm('Bạn có chắc chắn muốn xóa vật tư này không?')) return;
    const materials = ECO_Storage.getMaterials().filter(x => x.id !== id);
    try {
      await ECO_Storage.saveMaterials(materials);
      ECO_UI.toast('Đã xóa vật tư', 'warning');
      this.render();
    } catch (err) {
      console.error('[DanhMucVatTuModule] deleteMaterial failed:', err);
    }
  },

  async syncFromBOQ() {
    if (typeof ECO_Auth !== 'undefined' && !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên hệ thống mới có quyền đồng bộ danh mục vật tư!', 'error');
      return;
    }
    if (confirm('Bạn có chắc chắn muốn THAY THẾ TOÀN BỘ danh mục vật tư hiện tại bằng dữ liệu từ BOQ hiện có không? Hệ thống sẽ tự động tạo danh mục vật tư tương ứng và liên kết trực tiếp với mỗi hạng mục BOQ.')) {
      const boq = (typeof ECO_BOQStorage !== 'undefined') ? ECO_BOQStorage.getOrSeedBOQ() : [];
      if (boq.length === 0) {
        ECO_UI.toast('Bảng BOQ hiện tại không có hạng mục nào để đồng bộ!', 'error');
        return;
      }

      const newMaterials = boq.map((b, index) => ({
        id: index + 1,
        code: b.code || ('MAT-' + b.id),
        name: b.name,
        unit: b.unit || '—',
        system: b.system,
        boqItemId: b.id
      }));

      try {
        await ECO_Storage.saveMaterials(newMaterials);
        ECO_UI.toast(`Đã tự động đồng bộ và liên kết thành công ${newMaterials.length} vật tư từ BOQ!`, 'success');
        this.render();
      } catch (err) {
        console.error('[DanhMucVatTuModule] syncFromBOQ failed:', err);
        ECO_UI.toast('Đồng bộ thất bại, vui lòng thử lại.', 'error');
      }
    }
  }
};
window.DanhMucVatTuModule = DanhMucVatTuModule;

// Proactively load database tables so cache is populated and synchronized
if (typeof ECO_Cache !== 'undefined') {
  const stores = ['eco_boq', 'eco_pos', 'eco_suppliers', 'eco_inv_logs', 'eco_materials', 'eco_progress'];
  stores.forEach(store => {
    ECO_Cache.on(store, () => {
      const tab = document.querySelector('.tab-content.active');
      if (tab && typeof renderActiveModule === 'function') {
        renderActiveModule(tab.id);
      }
      // Reload DanhMucVatTu if visible
      const dmEl = document.getElementById('purchasing-danh-muc-vat-tu');
      const matDmEl = document.getElementById('materials-danh-muc');
      if ((dmEl && dmEl.style.display === 'block') || (matDmEl && matDmEl.style.display === 'block')) {
        DanhMucVatTuModule.render();
      }
    });
  });
}

// Tự động dọn dẹp các dữ liệu mồ côi (PO đã xóa, vật tư đã xóa) khỏi toàn hệ thống
async function sanitizeDatabaseOrphans() {
  if (typeof ECO_Storage === 'undefined') return;
  try {
    const pos = ECO_Storage._rawPOs();
    const logs = ECO_Storage.getInventoryLogs();
    const materials = ECO_Storage.getMaterials();
    const suppliers = ECO_Storage.getSuppliers();

    const poIds = new Set(pos.map(p => String(p.id)));
    const poNos = new Set(pos.map(p => String(p.poNo || '').trim().toLowerCase()).filter(Boolean));
    const matIds = new Set(materials.map(m => String(m.id)));

    let logsChanged = false;
    let posChanged = false;
    let suppliersChanged = false;

    // 1. Dọn dẹp phiếu nhập/xuất kho (logs)
    const cleanedLogs = [];
    logs.forEach(log => {
      // Kiểm tra nếu phiếu nhập theo PO mà PO đó đã bị xóa (cả theo poId hoặc poNo)
      if (log.type === 'in') {
        if (log.poId && !poIds.has(String(log.poId))) {
          logsChanged = true;
          console.log(`[Sanitize] Xóa phiếu nhập kho mồ côi (PO ID không tồn tại): ${log.id} (PO: ${log.poNo})`);
          return; // Bỏ qua / xóa log này
        }
        if (log.poNo && !log.poId && !poNos.has(String(log.poNo).trim().toLowerCase())) {
          logsChanged = true;
          console.log(`[Sanitize] Xóa phiếu nhập kho mồ côi (Số PO không tồn tại): ${log.id} (PO: ${log.poNo})`);
          return; // Bỏ qua / xóa log này
        }
      }

      // Kiểm tra nếu các vật tư trong phiếu kho trỏ đến vật tư đã bị xóa trong danh mục
      const originalItemCount = (log.items || []).length;
      const validItems = (log.items || []).filter(item => {
        const exist = matIds.has(String(item.matId));
        if (!exist) {
          logsChanged = true;
          console.log(`[Sanitize] Xóa vật tư mồ côi (không tồn tại trong danh mục) khỏi phiếu kho ${log.id}: matId=${item.matId}`);
        }
        return exist;
      });

      if (validItems.length === 0 && originalItemCount > 0) {
        logsChanged = true;
        console.log(`[Sanitize] Xóa phiếu kho rỗng ${log.id} sau khi lọc vật tư mồ côi`);
        return; // Bỏ qua / xóa log này
      }

      if (validItems.length !== originalItemCount) {
        log.items = validItems;
        logsChanged = true;
      }
      cleanedLogs.push(log);
    });

    // 2. Dọn dẹp các vật tư trong PO (nếu vật tư bị xóa khỏi danh mục)
    pos.forEach(p => {
      const originalItemCount = (p.items || []).length;
      const validItems = (p.items || []).filter(item => {
        const exist = matIds.has(String(item.matId));
        if (!exist) {
          posChanged = true;
          console.log(`[Sanitize] Xóa vật tư mồ côi khỏi PO ${p.poNo}: matId=${item.matId}`);
        }
        return exist;
      });

      if (validItems.length !== originalItemCount) {
        p.items = validItems;
        posChanged = true;
      }
    });

    // 3. Dọn dẹp danh sách vật tư gán cho Nhà cung cấp
    suppliers.forEach(s => {
      const originalCount = (s.providedMaterials || []).length;
      const validMats = (s.providedMaterials || []).filter(matId => {
        const exist = matIds.has(String(matId));
        if (!exist) {
          suppliersChanged = true;
          console.log(`[Sanitize] Xóa liên kết vật tư mồ côi khỏi NCC ${s.companyName}: matId=${matId}`);
        }
        return exist;
      });

      if (validMats.length !== originalCount) {
        s.providedMaterials = validMats;
        suppliersChanged = true;
      }
    });

    // Thực hiện lưu lại nếu có thay đổi
    if (logsChanged) {
      // Loại bỏ thông tin enriched (tên, đơn vị) trước khi lưu để giữ DB gọn nhẹ
      const cleanLogsToSave = cleanedLogs.map(({ items, ...l }) => ({
        ...l,
        items: (items || []).map(({ name, unit, ...it }) => it)
      }));
      await ECO_Storage.saveInventoryLogs(cleanLogsToSave);
    }
    if (posChanged) {
      await ECO_Storage.savePOs(pos);
    }
    if (suppliersChanged) {
      await ECO_Storage.saveSuppliers(suppliers);
    }

    if (logsChanged || posChanged || suppliersChanged) {
      console.log(`[Sanitize] Đã tự động dọn dẹp sạch cơ sở dữ liệu!`);
      // Kích hoạt re-render tab đang mở
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab && typeof renderActiveModule === 'function') {
        renderActiveModule(activeTab.id);
      }
    }
  } catch (e) {
    console.warn('[Sanitize] Lỗi tự động dọn dẹp dữ liệu:', e);
  }
}




const TienDoModule = {
  render() {
    const list = ECO_Storage.getProgress();
    
    // Tính toán phần trăm hoàn thành trung bình cho mỗi hệ thống (so khớp chính xác, gộp Điện và Điện nhẹ)
    const calcAvg = (sysName) => {
      const items = list.filter(item => {
        const sys = String(item.system).toLowerCase().trim();
        if (sysName === 'Điện - Điện nhẹ') {
          return sys === 'điện' || sys === 'điện nhẹ' || sys === 'điện - điện nhẹ' || sys === 'điện & điện nhẹ';
        }
        return sys === sysName.toLowerCase().trim();
      });
      if (items.length === 0) return 0;
      const sum = items.reduce((acc, x) => acc + (parseFloat(x.progress) || 0), 0);
      return Math.round(sum / items.length);
    };

    const avgDien = calcAvg('Điện - Điện nhẹ');
    const avgNuoc = calcAvg('Cấp thoát nước');
    const avgAcmv = calcAvg('Điều hòa Không khí');
    const avgFire = calcAvg('Phòng cháy Chữa cháy');

    // Render Stats Dashboard (Sử dụng CSS Grid responsive để dàn đều 4 hệ thống giống BOQ)
    const statsHtml = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; width: 100%;">
        <div class="glass-panel" style="padding: 20px;">
          <span class="label">Điện - Điện nhẹ</span>
          <div class="data-value" style="color:#0056FF;">${avgDien}%</div>
          <div class="progress-track"><div class="progress-fill" style="width: ${avgDien}%; background:#0056FF;"></div></div>
        </div>
        <div class="glass-panel" style="padding: 20px;">
          <span class="label">Cấp thoát nước</span>
          <div class="data-value" style="color:#0EA5E9;">${avgNuoc}%</div>
          <div class="progress-track"><div class="progress-fill" style="width: ${avgNuoc}%; background:#0EA5E9;"></div></div>
        </div>
        <div class="glass-panel" style="padding: 20px;">
          <span class="label">Điều hòa Không khí</span>
          <div class="data-value" style="color:#10B981;">${avgAcmv}%</div>
          <div class="progress-track"><div class="progress-fill" style="width: ${avgAcmv}%; background:#10B981;"></div></div>
        </div>
        <div class="glass-panel" style="padding: 20px;">
          <span class="label">Phòng cháy Chữa cháy</span>
          <div class="data-value" style="color:#E31837;">${avgFire}%</div>
          <div class="progress-track"><div class="progress-fill" style="width: ${avgFire}%; background:#E31837;"></div></div>
        </div>
      </div>
    `;
    const statsGrid = document.querySelector('#schedule .dashboard-grid');
    if (statsGrid) statsGrid.innerHTML = statsHtml;

    // Render Table Content
    const isBCH = typeof ECO_Auth !== 'undefined' && ECO_Auth.roleInfo()?.group === 'command';
    const tablePanel = document.querySelector('#schedule .content-table-panel');
    if (tablePanel) {
      tablePanel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <span class="label" style="margin:0;">Bảng Tiến Độ Hạng Mục Chi Tiết</span>
          ${isBCH ? `<button onclick="TienDoModule.addProgressItem()" class="btn btn-outline btn-blue" style="font-size:0.8rem;padding:6px 14px;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm tiến độ</button>` : ''}
        </div>
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead>
              <tr>
                <th>Mã Hạng Mục</th>
                <th>Hệ Thống</th>
                <th>Nhà Thầu Phụ</th>
                <th>Khu vực thi công</th>
                <th>Ngày Kết Thúc</th>
                <th>Ngày Hoàn Thành</th>
                <th style="text-align:right;width:120px;">% Hoàn Thành</th>
                <th style="width:130px;text-align:center;">Trạng Thái</th>
                ${isBCH ? `<th style="width:100px;text-align:center;">Thao tác</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${list.length === 0 
                ? `<tr><td colspan="${isBCH ? 9 : 8}" style="text-align:center;padding:24px;color:#94A3B8;font-size:0.85rem;">Chưa có dữ liệu tiến độ thi công.</td></tr>`
                : list.map(item => {
                    let badgeClass = 'badge-active';
                    if (item.status === 'BỊ TRỄ') badgeClass = 'badge-alert';
                    else if (item.status === 'HOÀN THÀNH') badgeClass = 'badge-success';
                    
                    return `
                      <tr>
                        <td style="font-weight:700;color:#0056FF;">${item.code || '—'}</td>
                        <td>${item.system || '—'}</td>
                        <td>${item.subcontractor || '—'}</td>
                        <td>${item.area || '—'}</td>
                        <td>${item.endDate ? ECO_UI.fmtDate(item.endDate) : '—'}</td>
                        <td>${item.completionDate ? ECO_UI.fmtDate(item.completionDate) : '—'}</td>
                        <td style="text-align:right;font-weight:700;">${item.progress}%</td>
                        <td style="text-align:center;"><span class="badge ${badgeClass}">${item.status}</span></td>
                        ${isBCH ? `
                          <td style="text-align:center;">
                            <div style="display:flex;gap:6px;justify-content:center;">
                              <button onclick="TienDoModule.editProgressItem(${item.id})" class="btn btn-outline" style="font-size:0.75rem;padding:4px 8px;border-color:rgba(0,86,255,0.2);color:#0056FF;" title="Sửa"><i data-lucide="edit-2" style="width:12px;height:12px;"></i></button>
                              <button onclick="TienDoModule.deleteProgressItem(${item.id})" class="btn btn-outline" style="font-size:0.75rem;padding:4px 8px;border-color:rgba(227,24,55,0.2);color:#E31837;" title="Xóa"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
                            </div>
                          </td>
                        ` : ''}
                      </tr>
                    `;
                  }).join('')}
            </tbody>
          </table>
        </div>
      `;
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    }
  },

  addProgressItem() {
    const isBCH = typeof ECO_Auth !== 'undefined' && ECO_Auth.roleInfo()?.group === 'command';
    if (!isBCH) {
      ECO_UI.toast('Chỉ tài khoản Ban Chỉ Huy mới có quyền thêm tiến độ!', 'error');
      return;
    }
    this.openFormModal();
  },

  editProgressItem(id) {
    const isBCH = typeof ECO_Auth !== 'undefined' && ECO_Auth.roleInfo()?.group === 'command';
    if (!isBCH) {
      ECO_UI.toast('Chỉ tài khoản Ban Chỉ Huy mới có quyền sửa tiến độ!', 'error');
      return;
    }
    const item = ECO_Storage.getProgress().find(x => x.id === id);
    if (item) this.openFormModal(item);
  },

  openFormModal(item = null) {
    const isEdit = !!item;
    const subcons = Object.values(window.subcontractorsData || {});
    const systems = ['Điện - Điện nhẹ', 'Cấp thoát nước', 'Phòng cháy Chữa cháy', 'Điều hòa Không khí'];
    const statuses = ['ON TRACK', 'BỊ TRỄ', 'HOÀN THÀNH'];

    ECO_UI.openModal(isEdit ? 'Chỉnh sửa Tiến độ Hạng mục' : 'Thêm Tiến độ Hạng mục Mới', `
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Mã hạng mục *</label>
          <input id="p-code" class="eco-input" placeholder="VD: SCH-MEP-003" value="${isEdit ? item.code : ''}">
        </div>
        <div class="eco-form-group">
          <label>Hệ thống *</label>
          <select id="p-system" class="eco-select">
            ${systems.map(s => `<option value="${s}" ${isEdit && item.system === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Nhà thầu phụ</label>
          <select id="p-subcon" class="eco-select">
            <option value="">-- Chọn thầu phụ --</option>
            ${subcons.map(s => `<option value="${s.name}" ${isEdit && item.subcontractor === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="eco-form-group">
          <label>Khu vực thi công</label>
          <input id="p-area" class="eco-input" placeholder="VD: Khu B - Tầng 3" value="${isEdit ? (item.area || '') : ''}">
        </div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Ngày kết thúc</label>
          <input id="p-end-date" type="date" class="eco-input" value="${isEdit && item.endDate ? item.endDate : ''}">
        </div>
        <div class="eco-form-group">
          <label>Ngày hoàn thành</label>
          <input id="p-completion-date" type="date" class="eco-input" value="${isEdit && item.completionDate ? item.completionDate : ''}">
        </div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>% Hoàn thành (0 - 100) *</label>
          <input id="p-progress" type="number" class="eco-input" min="0" max="100" value="${isEdit ? item.progress : 0}">
        </div>
        <div class="eco-form-group">
          <label>Trạng thái *</label>
          <select id="p-status" class="eco-select">
            ${statuses.map(s => `<option value="${s}" ${isEdit && item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
    `, `
      <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
      <button onclick="TienDoModule.saveForm(${isEdit ? item.id : 'null'})" class="btn btn-primary" style="padding:9px 20px;">Lưu</button>
    `);
  },

  async saveForm(editId) {
    const code = document.getElementById('p-code').value.trim();
    const system = document.getElementById('p-system').value;
    const subcontractor = document.getElementById('p-subcon').value;
    const area = document.getElementById('p-area').value.trim();
    const endDate = document.getElementById('p-end-date').value || null;
    const completionDate = document.getElementById('p-completion-date').value || null;
    const progress = parseInt(document.getElementById('p-progress').value) || 0;
    const status = document.getElementById('p-status').value;

    if (!code) { ECO_UI.toast('Vui lòng nhập mã hạng mục', 'error'); return; }

    const list = ECO_Storage.getProgress();
    if (editId) {
      const item = list.find(x => x.id === editId);
      if (item) {
        item.code = code;
        item.system = system;
        item.subcontractor = subcontractor;
        item.area = area;
        item.endDate = endDate;
        item.completionDate = completionDate;
        item.progress = Math.min(100, Math.max(0, progress));
        item.status = status;
      }
    } else {
      list.push({
        id: ECO_Storage.nextId(list),
        code,
        system,
        subcontractor,
        area,
        endDate,
        completionDate,
        progress: Math.min(100, Math.max(0, progress)),
        status
      });
    }

    try {
      await ECO_Storage.saveProgress(list);
      ECO_UI.closeModal();
      ECO_UI.toast(editId ? 'Đã cập nhật tiến độ' : 'Đã thêm tiến độ mới', 'success');
      this.render();
    } catch (e) {
      ECO_UI.toast('Lưu tiến độ thất bại', 'error');
    }
  },

  async deleteProgressItem(id) {
    const isBCH = typeof ECO_Auth !== 'undefined' && ECO_Auth.roleInfo()?.group === 'command';
    if (!isBCH) {
      ECO_UI.toast('Chỉ tài khoản Ban Chỉ Huy mới có quyền xóa tiến độ!', 'error');
      return;
    }
    if (!confirm('Bạn có chắc chắn muốn xóa hạng mục tiến độ này?')) return;
    const list = ECO_Storage.getProgress().filter(x => x.id !== id);
    try {
      await ECO_Storage.saveProgress(list);
      ECO_UI.toast('Đã xóa hạng mục tiến độ', 'warning');
      this.render();
    } catch (err) {
      ECO_UI.toast('Xóa tiến độ thất bại', 'error');
    }
  }
};
window.TienDoModule = TienDoModule;

const MaterialsAreaModule = {
  _filterArea: '',
  _filterAreaSystem: '',
  _filterAreaSubcon: '',
  _filterAreaPo: '',

  _setAreaFilter(val) {
    this._filterArea = val;
    this.render();
  },
  _setAreaSystemFilter(val) {
    this._filterAreaSystem = val;
    this.render();
  },
  _setAreaSubconFilter(val) {
    this._filterAreaSubcon = val;
    this.render();
  },
  _setAreaPoFilter(val) {
    this._filterAreaPo = val;
    this.render();
  },
  _clearAreaFilters() {
    this._filterArea = '';
    this._filterAreaSystem = '';
    this._filterAreaSubcon = '';
    this._filterAreaPo = '';
    this.render();
  },

  addMaterialArea() {
    const pos = ECO_Storage.getPOs();
    if (pos.length === 0) {
      ECO_UI.toast('Chưa có đơn hàng (PO) nào trong hệ thống để thêm vật tư!', 'error');
      return;
    }
    const materials = ECO_Storage.getMaterials() || [];
    const areas = [...new Set(
      pos.flatMap(p => (p.items || []).map(it => (it.area || 'Chung').trim()))
    )].sort();

    ECO_UI.openModal('Thêm vật tư đặt hàng theo Khu vực thi công', `
      <div class="eco-form-group">
        <label>Chọn Đơn đặt hàng (PO) *</label>
        <select id="ma-poId" class="eco-select" style="width:100%;">
          ${pos.map(p => `<option value="${p.id}">${p.poNo} (${p.supplier})</option>`).join('')}
        </select>
      </div>
      <div class="eco-form-group">
        <label>Chọn Vật tư *</label>
        <select id="ma-matId" class="eco-select" style="width:100%;" onchange="MaterialsAreaModule._onModalMaterialChange(this.value)">
          <option value="">-- Chọn vật tư sẵn có --</option>
          ${materials.map(m => `<option value="${m.id}" data-unit="${m.unit || ''}">[${m.code}] ${m.name} (${m.unit})</option>`).join('')}
          <option value="new" style="font-weight:bold;color:#0056FF;">+ Tự nhập vật tư mới</option>
        </select>
      </div>

      <!-- New Material Section (hidden by default) -->
      <div id="ma-new-mat-section" style="display:none;background:rgba(0,86,255,0.03);border:1px solid rgba(0,86,255,0.12);border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-size:0.8rem;font-weight:700;color:#0056FF;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Thông tin vật tư mới</div>
        <div class="eco-form-row">
          <div class="eco-form-group">
            <label>Mã vật tư *</label>
            <input id="ma-new-code" class="eco-input" placeholder="VD: VT-001">
          </div>
          <div class="eco-form-group">
            <label>Đơn vị tính *</label>
            <input id="ma-new-unit" class="eco-input" placeholder="VD: m, kg, cái...">
          </div>
        </div>
        <div class="eco-form-group" style="margin-top:8px;">
          <label>Tên vật tư (quy cách chi tiết) *</label>
          <input id="ma-new-name" class="eco-input" placeholder="VD: Ống nhựa uPVC D34">
        </div>
      </div>

      <div class="eco-form-group">
        <label>Chọn Khu vực thi công *</label>
        ${renderAreaCheckboxes('Chung', false)}
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Chi tiết</label>
          <input id="ma-detail" class="eco-input" placeholder="VD: Phòng bơm, tầng 2...">
        </div>
        <div class="eco-form-group">
          <label>Số lượng đặt hàng *</label>
          <input id="ma-qty" type="number" class="eco-input" min="0.001" step="any" placeholder="Nhập số lượng...">
        </div>
      </div>
      <div class="eco-form-row">
        <div class="eco-form-group">
          <label>Quy cách / Ghi chú thêm</label>
          <input id="ma-variant" class="eco-input" placeholder="Tiêu chuẩn, dày 10mm..." value="Tiêu chuẩn">
        </div>
      </div>
    `, `
      <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
      <button onclick="MaterialsAreaModule._saveMaterialArea()" class="btn btn-primary" style="padding:9px 20px;">Lưu</button>
    `, { size: 'md' });
  },

  _onModalMaterialChange(val) {
    const newSection = document.getElementById('ma-new-mat-section');
    if (newSection) {
      newSection.style.display = val === 'new' ? 'block' : 'none';
    }
  },

  async _saveMaterialArea() {
    const poId = document.getElementById('ma-poId').value;
    const matIdVal = document.getElementById('ma-matId').value;
    const area = Array.from(document.querySelectorAll('.area-cb:checked')).map(cb => cb.value).join(', ') || 'Chung';
    const detail = document.getElementById('ma-detail').value.trim();
    const qty = parseFloat(document.getElementById('ma-qty').value) || 0;
    const variant = document.getElementById('ma-variant').value.trim() || 'Tiêu chuẩn';

    if (!poId) { ECO_UI.toast('Vui lòng chọn PO', 'error'); return; }
    if (!matIdVal) { ECO_UI.toast('Vui lòng chọn vật tư', 'error'); return; }
    if (qty <= 0) { ECO_UI.toast('Số lượng đặt hàng phải lớn hơn 0', 'error'); return; }

    const allPos = ECO_Storage.getPOs();
    const po = allPos.find(p => String(p.id) === String(poId));
    if (!po) {
      ECO_UI.toast('Không tìm thấy Đơn đặt hàng tương ứng!', 'error');
      return;
    }

    let matId = null;
    let matName = '';
    let matUnit = '';

    if (matIdVal === 'new') {
      const code = document.getElementById('ma-new-code').value.trim();
      const name = document.getElementById('ma-new-name').value.trim();
      const unit = document.getElementById('ma-new-unit').value.trim();

      if (!code) { ECO_UI.toast('Vui lòng nhập Mã vật tư mới', 'error'); return; }
      if (!name) { ECO_UI.toast('Vui lòng nhập Tên vật tư mới', 'error'); return; }
      if (!unit) { ECO_UI.toast('Vui lòng nhập Đơn vị tính mới', 'error'); return; }

      const materials = ECO_Storage.getMaterials() || [];
      let existingMat = materials.find(m => 
        m.code.toLowerCase() === code.toLowerCase() || 
        m.name.toLowerCase() === name.toLowerCase()
      );

      if (existingMat) {
        matId = existingMat.id;
        matName = existingMat.name;
        matUnit = existingMat.unit;
      } else {
        const nextId = ECO_Storage.nextId(materials);
        const newMat = {
          id: nextId,
          code: code,
          name: name,
          unit: unit,
          system: po.system || 'Tổng hợp',
          boqItemId: null
        };
        materials.push(newMat);
        await ECO_Storage.saveMaterials(materials);

        const suppliers = ECO_Storage.getSuppliers() || [];
        const supplier = suppliers.find(s => s.companyName === po.supplier);
        if (supplier) {
          if (!supplier.providedMaterials) supplier.providedMaterials = [];
          supplier.providedMaterials.push(newMat.id);
          await ECO_Storage.saveSuppliers(suppliers);
        }

        matId = newMat.id;
        matName = newMat.name;
        matUnit = newMat.unit;
      }
    } else {
      matId = parseInt(matIdVal);
      const materials = ECO_Storage.getMaterials() || [];
      const mat = materials.find(m => m.id === matId);
      if (mat) {
        matName = mat.name;
        matUnit = mat.unit;
      }
    }

    if (!po.items) po.items = [];
    
    const existingItem = po.items.find(it => 
      String(it.matId) === String(matId) && 
      (it.area || 'Chung').trim().toLowerCase() === area.toLowerCase() &&
      (it.detail || '').trim().toLowerCase() === detail.toLowerCase()
    );

    if (existingItem) {
      existingItem.qty += qty;
    } else {
      po.items.push({
        matId: matId,
        qty: qty,
        variant: variant,
        name: matName,
        unit: matUnit,
        area: area,
        detail: detail
      });
    }

    try {
      await ECO_Storage.savePOs(allPos);
      ECO_UI.closeModal();
      ECO_UI.toast(`Đã thêm vật tư thành công vào đơn hàng ${po.poNo} khu vực ${area}`, 'success');
      this.render();
    } catch (err) {
      console.error(err);
      ECO_UI.toast('Thêm vật tư thất bại!', 'error');
    }
  },


  _viewMode: 'detail',
  toggleViewMode() {
    this._viewMode = this._viewMode === 'aggregate' ? 'detail' : 'aggregate';
    this.render();
  },

  render() {
    const el = document.getElementById('materials-area-content');
    if (!el) return;
    el.innerHTML = this._renderAreaDetails();
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    if (window.updateContentTableHeights) setTimeout(window.updateContentTableHeights, 0);
  },

  quickEditArea(poNo, matId, currentArea) {
    if (!window.ECO_Auth || !ECO_Auth.isSuperAdmin()) {
      ECO_UI.toast('Chỉ quản trị viên mới có quyền sửa khu vực thi công!', 'error');
      return;
    }
    const allPos = ECO_Storage.getPOs();
    const po = allPos.find(p => p.poNo === poNo);
    if (!po) {
      ECO_UI.toast(`Không tìm thấy đơn hàng ${poNo}`, 'error');
      return;
    }
    const item = (po.items || []).find(it => it.matId === matId && (it.area || 'Chung').trim() === currentArea.trim());
    if (!item) {
      ECO_UI.toast('Không tìm thấy vật tư tương ứng trong đơn hàng', 'error');
      return;
    }
    
    const currentAreaVal = item.area || 'Chung';
    const currentDetailVal = item.detail || '';

    ECO_UI.openModal('Chỉnh sửa Khu vực thi công & Chi tiết', `
      <div class="eco-form-group">
        <label>Đơn hàng: <strong>${poNo}</strong></label>
      </div>
      <div class="eco-form-group">
        <label>Vật tư: <strong>${item.name}</strong></label>
      </div>
      <div class="eco-form-group">
        <label>Chọn Khu vực thi công *</label>
        ${renderAreaCheckboxes(currentAreaVal, false)}
      </div>
      <div class="eco-form-group">
        <label>Chi tiết</label>
        <input id="quick-edit-detail" class="eco-input" value="${currentDetailVal}" placeholder="VD: Phòng bơm, tầng 2...">
      </div>
    `, `
      <button onclick="ECO_UI.closeModal()" class="btn btn-outline" style="padding:9px 20px;">Hủy</button>
      <button id="quick-edit-save-btn" class="btn btn-primary" style="padding:9px 20px;">Lưu</button>
    `, { size: 'md' });

    document.getElementById('quick-edit-save-btn').onclick = async () => {
      const selectedAreas = Array.from(document.querySelectorAll('.area-cb:checked')).map(cb => cb.value).join(', ') || 'Chung';
      const detail = document.getElementById('quick-edit-detail').value.trim();

      item.area = selectedAreas;
      item.detail = detail;

      try {
        await ECO_Storage.savePOs(allPos);
        ECO_UI.closeModal();
        ECO_UI.toast('Đã cập nhật Khu vực thi công & Chi tiết thành công!', 'success');
        MaterialsAreaModule.render();
      } catch (err) {
        ECO_UI.toast('Cập nhật thất bại!', 'error');
      }
    };
  },

  _renderAreaDetails() {
    const allPos = ECO_Storage.getPOs();
    const areaItems = [];

    const materials = ECO_Storage.getMaterials() || [];
    const matMap = {};
    materials.forEach(m => { matMap[m.id] = m; });

    allPos.forEach(p => {
      (p.items || []).forEach(it => {
        const areaName = (it.area || 'Chung').trim();
        const mat = matMap[it.matId];
        areaItems.push({
          area: areaName,
          detail: it.detail || '—',
          code: (mat && mat.code) || '—',
          name: it.name || (mat && mat.name) || '—',
          unit: it.unit || (mat && mat.unit) || '—',
          qty: parseFloat(it.qty) || 0,
          receivedQty: parseFloat(it.receivedQty) || 0,
          system: p.system || '',
          subconName: p.subconName || 'Chung',
          poNo: p.poNo || '',
          supplier: p.supplier || '',
          matId: it.matId,
          isBoq: mat && mat.boqItemId ? true : false
        });
      });
    });

    const areas = [...new Set(areaItems.map(x => x.area).filter(Boolean))].sort();
    const systems = [...new Set(areaItems.map(x => x.system).filter(Boolean))].sort();
    const subcons = [...new Set(areaItems.map(x => x.subconName).filter(Boolean))].sort();
    const pos = [...new Set(areaItems.map(x => x.poNo).filter(Boolean))].sort();

    const activeArea = this._filterArea || '';
    const activeSys = this._filterAreaSystem || '';
    const activeSub = this._filterAreaSubcon || '';
    const activePo = this._filterAreaPo || '';

    let filtered = areaItems;
    if (activeArea) filtered = filtered.filter(x => x.area === activeArea);
    if (activeSys) filtered = filtered.filter(x => x.system === activeSys);
    if (activeSub) filtered = filtered.filter(x => x.subconName === activeSub);
    if (activePo) filtered = filtered.filter(x => x.poNo === activePo);

    filtered.sort((a, b) => {
      const areaCompare = a.area.localeCompare(b.area, 'vi', { sensitivity: 'base' });
      if (areaCompare !== 0) return areaCompare;
      return a.code.localeCompare(b.code, 'vi', { numeric: true });
    });

    const totalMats = [...new Set(filtered.map(x => x.code))].length;
    const totalQty = filtered.reduce((sum, x) => sum + x.qty, 0);
    const totalRec = filtered.reduce((sum, x) => sum + x.receivedQty, 0);
    const totalPos = [...new Set(filtered.map(x => x.poNo))].length;

    const hasFilter = activeArea || activeSys || activeSub || activePo;
    const isAdmin = typeof ECO_Auth !== 'undefined' && ECO_Auth.isSuperAdmin();
    const isAggMode = this._viewMode === 'aggregate';

    let tableHeader = '';
    let tableBody = '';

    if (isAggMode) {
      const aggregated = {};
      filtered.forEach(it => {
        const key = (it.matId || (it.code + '|' + it.name)) + '|' + it.system + '|' + it.subconName;
        if (!aggregated[key]) {
          aggregated[key] = {
            code: it.code,
            name: it.name,
            unit: it.unit,
            qty: 0,
            receivedQty: 0,
            system: it.system,
            subconName: it.subconName,
            poNos: new Set()
          };
        }
        aggregated[key].qty += it.qty;
        aggregated[key].receivedQty += it.receivedQty;
        if (it.poNo) aggregated[key].poNos.add(it.poNo);
      });

      const aggList = Object.values(aggregated);
      aggList.sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));

      tableHeader = `
        <tr>
          <th style="width:110px;">Mã vật tư</th>
          <th>Tên vật tư (quy cách chi tiết)</th>
          <th style="width:70px;text-align:center;">ĐVT</th>
          <th style="width:120px;text-align:right;">Tổng SL đặt</th>
          <th style="width:120px;text-align:right;">Tổng đã nhập</th>
          <th style="width:100px;text-align:center;">% Hoàn thành</th>
          <th style="width:130px;">Hệ thống</th>
          <th style="width:120px;">Nhà thầu phụ</th>
          <th>Các PO liên quan</th>
        </tr>
      `;

      tableBody = aggList.length === 0
        ? ECO_UI.tableEmpty(9, 'Không tìm thấy dữ liệu vật tư lũy kế.')
        : aggList.map(item => {
            const ratio = item.qty > 0 ? Math.round((item.receivedQty / item.qty) * 100) : 0;
            let ratioBadge = 'badge-neutral';
            if (ratio >= 100) ratioBadge = 'badge-success';
            else if (ratio > 0) ratioBadge = 'badge-orange';
            
            return `
              <tr>
                <td style="font-weight:700;color:#0056FF;">${item.code}</td>
                <td style="font-weight:600;">${item.name}</td>
                <td style="text-align:center;">${item.unit}</td>
                <td style="text-align:right;font-weight:700;color:#0F172A;">${ECO_UI.fmtNum(item.qty, 1)}</td>
                <td style="text-align:right;font-weight:700;color:#10B981;">${ECO_UI.fmtNum(item.receivedQty, 1)}</td>
                <td style="text-align:center;"><span class="badge ${ratioBadge}">${ratio}%</span></td>
                <td><span style="font-size:0.8rem;background:rgba(0,51,160,0.06);color:#0033A0;padding:2px 6px;border-radius:4px;font-weight:600;">${item.system}</span></td>
                <td><span style="font-size:0.8rem;background:rgba(0,86,255,0.08);color:#0033A0;padding:2px 6px;border-radius:4px;font-weight:600;">${item.subconName}</span></td>
                <td style="font-size:0.82rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748B;" title="${[...item.poNos].join(', ')}">${[...item.poNos].join(', ') || '—'}</td>
              </tr>
            `;
          }).join('');
    } else {
      tableHeader = `
        <tr>
          <th style="width:180px;">Khu vực thi công</th>
          <th style="width:150px;">Chi tiết</th>
          <th style="width:110px;">Mã vật tư</th>
          <th>Tên vật tư (quy cách chi tiết)</th>
          <th style="width:70px;text-align:center;">ĐVT</th>
          <th style="width:120px;text-align:right;">SL đặt hàng</th>
          <th style="width:120px;text-align:right;">Đã nhập kho</th>
          <th style="width:130px;">Hệ thống</th>
          <th style="width:120px;">Nhà thầu phụ</th>
          <th style="width:120px;text-align:center;">Số PO</th>
        </tr>
      `;

      tableBody = filtered.length === 0
        ? ECO_UI.tableEmpty(10, 'Không tìm thấy dữ liệu vật tư theo điều kiện lọc.')
        : filtered.map(item => {
            const boqBadge = item.isBoq ? ' <span class="badge badge-success" style="font-size: 0.65rem; margin-left: 4px;">BOQ</span>' : ' <span class="badge badge-orange" style="font-size: 0.65rem; margin-left: 4px;">TỰ NHẬP</span>';
            return `
              <tr>
                <td ${isAdmin ? `onclick="MaterialsAreaModule.quickEditArea('${item.poNo}', ${item.matId}, '${item.area}')" style="font-weight:700;color:#0033A0;cursor:pointer;background:rgba(0,51,160,0.03);" title="Nhấp để sửa nhanh Khu vực thi công"` : 'style="font-weight:700;color:#0033A0;"'}>
                  ${item.area}
                  ${isAdmin ? ` <i data-lucide="edit-2" style="width:11px;height:11px;color:#94A3B8;margin-left:4px;vertical-align:middle;display:inline-block;"></i>` : ''}
                </td>
                <td style="font-weight:600;color:#475569;">${item.detail || '—'}</td>
                <td style="font-weight:700;color:#0056FF;">${item.code}${boqBadge}</td>
                <td style="font-weight:600;">${item.name}</td>
                <td style="text-align:center;">${item.unit}</td>
                <td style="text-align:right;font-weight:700;color:#0F172A;">${ECO_UI.fmtNum(item.qty, 1)}</td>
                <td style="text-align:right;font-weight:700;color:#10B981;">${ECO_UI.fmtNum(item.receivedQty, 1)}</td>
                <td><span style="font-size:0.8rem;background:rgba(0,51,160,0.06);color:#0033A0;padding:2px 6px;border-radius:4px;font-weight:600;">${item.system}</span></td>
                <td><span style="font-size:0.8rem;background:rgba(0,86,255,0.08);color:#0033A0;padding:2px 6px;border-radius:4px;font-weight:600;">${item.subconName}</span></td>
                <td style="font-weight:700;color:#0056FF;text-align:center;">${item.poNo}</td>
              </tr>`;
          }).join('');
    }

    return `
      <!-- KPI Stats Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; width: 100%;">
        <div class="glass-panel" style="padding: 16px; border-left: 4px solid #0056FF; background: rgba(255,255,255,0.4);">
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em;">Tổng chủng loại</span>
          <div style="font-size: 1.5rem; font-weight: 800; color: #0F172A; margin-top: 4px;">${totalMats} loại</div>
        </div>
        <div class="glass-panel" style="padding: 16px; border-left: 4px solid #10B981; background: rgba(255,255,255,0.4);">
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em;">Tổng số lượng đặt</span>
          <div style="font-size: 1.5rem; font-weight: 800; color: #10B981; margin-top: 4px;">${ECO_UI.fmtNum(totalQty, 1)}</div>
        </div>
        <div class="glass-panel" style="padding: 16px; border-left: 4px solid #0EA5E9; background: rgba(255,255,255,0.4);">
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em;">Đã nhập kho thực tế</span>
          <div style="font-size: 1.5rem; font-weight: 800; color: #0EA5E9; margin-top: 4px;">${ECO_UI.fmtNum(totalRec, 1)}</div>
        </div>
        <div class="glass-panel" style="padding: 16px; border-left: 4px solid #F59E0B; background: rgba(255,255,255,0.4);">
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em;">Số lượng PO liên quan</span>
          <div style="font-size: 1.5rem; font-weight: 800; color: #F59E0B; margin-top: 4px;">${totalPos} đơn</div>
        </div>
      </div>

      <!-- Main Data Panel -->
      <div class="glass-panel content-table-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.5);flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <h3 style="font-size:1rem;font-weight:700;margin:0;margin-right:8px;">
              ${isAggMode ? 'Thống kê lũy kế tổng hợp vật tư đặt hàng' : 'Chi tiết vật tư theo khu vực'}
            </h3>
            
            <select onchange="MaterialsAreaModule._setAreaFilter(this.value)" style="font-size:0.82rem;padding:6px 12px;border:1px solid rgba(0,86,255,0.2);border-radius:8px;background:rgba(0,86,255,0.03);color:#0033A0;font-weight:600;cursor:pointer;outline:none;">
              <option value="">-- Lọc Khu vực --</option>
              ${areas.map(a => `<option value="${a}"${activeArea === a ? ' selected' : ''}>${a}</option>`).join('')}
            </select>

            <select onchange="MaterialsAreaModule._setAreaSystemFilter(this.value)" style="font-size:0.82rem;padding:6px 12px;border:1px solid rgba(0,86,255,0.2);border-radius:8px;background:rgba(0,86,255,0.03);color:#0033A0;font-weight:600;cursor:pointer;outline:none;">
              <option value="">-- Lọc Hệ thống --</option>
              ${systems.map(s => `<option value="${s}"${activeSys === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>

            <select onchange="MaterialsAreaModule._setAreaSubconFilter(this.value)" style="font-size:0.82rem;padding:6px 12px;border:1px solid rgba(0,86,255,0.2);border-radius:8px;background:rgba(0,86,255,0.03);color:#0033A0;font-weight:600;cursor:pointer;outline:none;">
              <option value="">-- Lọc Thầu phụ --</option>
              ${subcons.map(s => `<option value="${s}"${activeSub === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>

            <select onchange="MaterialsAreaModule._setAreaPoFilter(this.value)" style="font-size:0.82rem;padding:6px 12px;border:1px solid rgba(0,86,255,0.2);border-radius:8px;background:rgba(0,86,255,0.03);color:#0033A0;font-weight:600;cursor:pointer;outline:none;">
              <option value="">-- Lọc Số PO --</option>
              ${pos.map(p => `<option value="${p}"${activePo === p ? ' selected' : ''}>${p}</option>`).join('')}
            </select>

            ${hasFilter ? `<button onclick="MaterialsAreaModule._clearAreaFilters()" style="background:none;border:none;color:#E31837;cursor:pointer;font-size:0.8rem;font-weight:700;padding:4px 8px;" title="Xóa tất cả bộ lọc">✕ Xóa lọc</button>` : ''}
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-outline" onclick="MaterialsAreaModule.toggleViewMode()" style="font-size:0.85rem;padding:8px 18px;color:#0056FF;border-color:#0056FF;">
              <i data-lucide="${isAggMode ? 'list' : 'line-chart'}" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i>
              ${isAggMode ? 'Xem chi tiết PO' : 'Xem lũy kế tổng hợp'}
            </button>
            <button class="btn btn-outline btn-blue" data-perm="po:edit" onclick="MaterialsAreaModule.addMaterialArea()" style="font-size:0.85rem;padding:8px 18px;color:#0056FF;border-color:#0056FF;">
              <i data-lucide="plus" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Thêm mới
            </button>
            <button class="btn btn-outline" onclick="POModule.exportAllPosToExcel()" style="font-size:0.85rem;padding:8px 18px;color:#10B981;border-color:#10B981;"><i data-lucide="file-up" style="width:14px;height:14px;vertical-align:middle;display:inline-block;margin-right:4px;"></i> Xuất Excel</button>
          </div>
        </div>
        
        <div class="table-container" style="margin:0;border-radius:0;">
          <table class="tech-table">
            <thead>
              ${tableHeader}
            </thead>
            <tbody>
              ${tableBody}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};
window.MaterialsAreaModule = MaterialsAreaModule;
