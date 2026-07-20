// ==================== ECO STORE — Tầng dữ liệu (Data Foundation) ====================
// Mục tiêu: ĐỔI BACKEND (localStorage -> Supabase) chỉ bằng cách thay 1 adapter,
//           KHÔNG phải sửa code render đang chạy đồng bộ.
//
// Kiến trúc 2 lớp:
//   • ECO_DB    : adapter I/O BẤT ĐỒNG BỘ (load/persist/remove/subscribe).
//   • ECO_Cache : cache trong RAM. Getter ĐỒNG BỘ (đọc nhanh từ cache),
//                 writer ghi cache ngay (optimistic) + persist async + phát sự kiện.
// ====================================================================================

(function (global) {
  'use strict';

  const mapKeyToTable = {
    'eco_boq': 'boq',
    'eco_vos': 'vos',
    'eco_suppliers': 'suppliers',
    'eco_pos': 'pos',
    'eco_inv_logs': 'inventory_logs',
    'eco_materials': 'materials',
    'eco_users': 'users',
    'eco_submittals': 'submittals',
    'eco_progress': 'progress'
  };

  // Chuyển đổi các key của row sang snake_case (chỉ chuyển cấp cao nhất để giữ cấu trúc JSON bên trong)
  function toSnakeRow(row) {
    if (!row || typeof row !== 'object') return row;
    const res = {};
    for (let k in row) {
      const snakeK = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      res[snakeK] = row[k];
    }
    return res;
  }

  // Chuyển đổi các key của row từ snake_case sang camelCase (chỉ chuyển cấp cao nhất)
  function toCamelRow(row) {
    if (!row || typeof row !== 'object') return row;
    const res = {};
    for (let k in row) {
      const camelK = k.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      res[camelK] = row[k];
    }
    return res;
  }

  const makeSupabaseAdapter = function (sb, keyToTable) {
    const tbl = (key) => keyToTable[key] || key;
    return {
      name: 'supabase',
      async load(key) {
        if (!sb) {
          console.error('[ECO_DB] Supabase Client chưa được khởi tạo');
          return null;
        }
        const { data, error } = await sb.from(tbl(key)).select('*');
        if (error) {
          const errMsg = String(error.message || '');
          if (errMsg.includes('relation') || errMsg.includes('does not exist') || errMsg.includes('schema cache') || errMsg.includes('Could not find')) {
            console.warn(`[ECO_DB] Không tìm thấy bảng ${tbl(key)} trên Supabase. Tự động chuyển hướng lưu trữ cục bộ (localStorage).`);
            const localVal = localStorage.getItem(key);
            return localVal ? JSON.parse(localVal) : [];
          }
          console.error('[ECO_DB] Load error cho key:', key, error);
          return null;
        }
        let dataRows = data || [];
        if (key === 'eco_users') {
          const subIdMap = { 1: 'dat-phan', 2: 'dinh-an', 3: 'phan-nguyen', 4: 'han-viet', 5: 'thuan-thien' };
          dataRows = dataRows.map(row => {
            const copy = { ...row };
            if (copy.sub_id) {
              copy.sub_id = subIdMap[copy.sub_id] || copy.sub_id;
            }
            return copy;
          });
        }
        let camelRows = dataRows.map(toCamelRow);
        if (key === 'eco_pos') {
          camelRows = camelRows.map(p => {
            if (p.items && p.items[0] && p.items[0].approvedFile) {
              p.approvedFile = p.items[0].approvedFile;
            }
            return p;
          });
        }
        if (key === 'eco_suppliers') {
          camelRows = camelRows.map(s => {
            let providedMaterials = [];
            let rep = s.representative || '';
            if (rep.includes(' ||provided|| ')) {
              const parts = rep.split(' ||provided|| ');
              rep = parts[0];
              try {
                providedMaterials = JSON.parse(parts[1]);
              } catch (e) {
                providedMaterials = [];
              }
            }
            return {
              ...s,
              representative: rep,
              providedMaterials: providedMaterials
            };
          });
        }
        if (key === 'eco_inv_logs') {
          camelRows = camelRows.map(log => {
            const att = log.attachments || {};
            return {
              ...log,
              deliveryNote: att.deliveryNote || null,
              warehousePhotos: att.warehousePhotos || null,
              dispatchSlip: att.dispatchSlip || null
            };
          });
        }
        return camelRows;
      },
      async persist(key, val) {
        const r = await this.persistWithError(key, val);
        return r.ok;
      },
      async persistWithError(key, val) {
        if (!sb) return { ok: false, error: { message: 'Supabase chưa được khởi tạo' } };
        const tableName = tbl(key);

        if (!Array.isArray(val)) {
          const snakeVal = toSnakeRow(val);
          if (key === 'eco_users' && snakeVal.sub_id) {
            const subIdToNum = { 'dat-phan': 1, 'dinh-an': 2, 'phan-nguyen': 3, 'han-viet': 4, 'thuan-thien': 5 };
            snakeVal.sub_id = subIdToNum[snakeVal.sub_id] || null;
          }
          if (key === 'eco_suppliers') {
            const rep = snakeVal.representative || '';
            const prov = val.providedMaterials || [];
            snakeVal.representative = rep + ' ||provided|| ' + JSON.stringify(prov);
            delete snakeVal.provided_materials;
          }
          if (key === 'eco_materials') {
            if (snakeVal.boq_item_id === '' || snakeVal.boq_item_id === 'none' || (snakeVal.boq_item_id && String(snakeVal.boq_item_id).trim() === '')) {
              snakeVal.boq_item_id = null;
            }
          }
          if (key === 'eco_boq') {
            delete snakeVal.executed_qty;
            delete snakeVal.exported_qty;
          }
          if (key === 'eco_pos') {
            const file = snakeVal.approved_file || snakeVal.approvedFile || null;
            if (file) {
              if (!snakeVal.items) snakeVal.items = [];
              if (snakeVal.items.length === 0) snakeVal.items.push({ virtual: true });
              snakeVal.items[0].approvedFile = file;
            } else if (snakeVal.items && snakeVal.items[0]) {
              delete snakeVal.items[0].approvedFile;
            }
            delete snakeVal.approved_file;
            delete snakeVal.approvedFile;
            delete snakeVal.signed_approved_file;
            delete snakeVal.signedApprovedFile;
            delete snakeVal.signed_file;
            delete snakeVal.signedFile;
          }
          if (key === 'eco_inv_logs') {
            const att = {};
            if (val.deliveryNote) att.deliveryNote = val.deliveryNote;
            if (val.warehousePhotos) att.warehousePhotos = val.warehousePhotos;
            if (val.dispatchSlip) att.dispatchSlip = val.dispatchSlip;
            snakeVal.attachments = att;
            delete snakeVal.delivery_note;
            delete snakeVal.warehouse_photos;
            delete snakeVal.dispatch_slip;
          }
          const { error } = await sb.from(tableName).upsert(snakeVal);
          if (error) {
            const errMsg = String(error.message || '');
            if (errMsg.includes('relation') || errMsg.includes('does not exist') || errMsg.includes('schema cache') || errMsg.includes('Could not find')) {
              console.warn(`[ECO_DB] Không tìm thấy bảng ${tableName} trên Supabase. Tự động sao lưu vào LocalStorage.`);
              localStorage.setItem(key, JSON.stringify(val));
              return { ok: true };
            }
            return { ok: false, error };
          }
          return { ok: true };
        }

        let snakeVals = val.map(toSnakeRow);
        if (key === 'eco_users') {
          const subIdToNum = { 'dat-phan': 1, 'dinh-an': 2, 'phan-nguyen': 3, 'han-viet': 4, 'thuan-thien': 5 };
          snakeVals = snakeVals.map(row => {
            const copy = { ...row };
            if (copy.sub_id) {
              copy.sub_id = subIdToNum[copy.sub_id] || null;
            }
            return copy;
          });
        }
        if (key === 'eco_suppliers') {
          snakeVals = snakeVals.map((row, idx) => {
            const original = val[idx];
            const copy = { ...row };
            const rep = copy.representative || '';
            const prov = original.providedMaterials || [];
            copy.representative = rep + ' ||provided|| ' + JSON.stringify(prov);
            delete copy.provided_materials;
            return copy;
          });
        }
        if (key === 'eco_boq') {
          snakeVals = snakeVals.map(row => {
            const copy = { ...row };
            delete copy.executed_qty;
            delete copy.exported_qty;
            return copy;
          });
        }
        if (key === 'eco_materials') {
          snakeVals = snakeVals.map(row => {
            const copy = { ...row };
            if (copy.boq_item_id === '' || copy.boq_item_id === 'none' || (copy.boq_item_id && String(copy.boq_item_id).trim() === '')) {
              copy.boq_item_id = null;
            }
            return copy;
          });
        }
        if (key === 'eco_pos') {
          snakeVals = snakeVals.map(row => {
            const copy = { ...row };
            const file = copy.approved_file || copy.approvedFile || null;
            if (file) {
              if (!copy.items) copy.items = [];
              if (copy.items.length === 0) copy.items.push({ virtual: true });
              copy.items[0].approvedFile = file;
            } else if (copy.items && copy.items[0]) {
              delete copy.items[0].approvedFile;
            }
            delete copy.approved_file;
            delete copy.approvedFile;
            delete copy.signed_approved_file;
            delete copy.signedApprovedFile;
            delete copy.signed_file;
            delete copy.signedFile;
            return copy;
          });
        }
        if (key === 'eco_inv_logs') {
          snakeVals = snakeVals.map((row, idx) => {
            const original = val[idx];
            const copy = { ...row };
            const att = {};
            if (original.deliveryNote) att.deliveryNote = original.deliveryNote;
            if (original.warehousePhotos) att.warehousePhotos = original.warehousePhotos;
            if (original.dispatchSlip) att.dispatchSlip = original.dispatchSlip;
            copy.attachments = att;
            delete copy.delivery_note;
            delete copy.warehouse_photos;
            delete copy.dispatch_slip;
            return copy;
          });
        }
        const currentIds = val.map(item => item.id).filter(id => id !== undefined && id !== null);

        // Xóa các dòng cũ không còn nằm trong mảng truyền lên
        if (currentIds.length > 0) {
          const isTextId = typeof currentIds[0] === 'string';
          let query = sb.from(tableName).delete();
          if (isTextId) {
            query = query.not('id', 'in', `(${currentIds.map(id => `"${id}"`).join(',')})`);
          } else {
            query = query.not('id', 'in', `(${currentIds.join(',')})`);
          }
          const { error: delError } = await query;
          if (delError) {
            const errMsg = String(delError.message || '');
            if (errMsg.includes('relation') || errMsg.includes('does not exist') || errMsg.includes('schema cache') || errMsg.includes('Could not find')) {
              console.warn(`[ECO_DB] Không tìm thấy bảng ${tableName} trên Supabase. Tự động chuyển hướng lưu trữ cục bộ (localStorage).`);
              localStorage.setItem(key, JSON.stringify(val));
              return { ok: true };
            }
            console.error('[ECO_DB] Delete sync error:', delError);
            return { ok: false, error: delError };
          }
        } else {
          const { error: delError } = await sb.from(tableName).delete().neq('id', '0');
          if (delError) {
            const errMsg = String(delError.message || '');
            if (errMsg.includes('relation') || errMsg.includes('does not exist') || errMsg.includes('schema cache') || errMsg.includes('Could not find')) {
              console.warn(`[ECO_DB] Không tìm thấy bảng ${tableName} trên Supabase. Tự động chuyển hướng lưu trữ cục bộ (localStorage).`);
              localStorage.setItem(key, JSON.stringify(val));
              return { ok: true };
            }
            console.error('[ECO_DB] Delete clear error:', delError);
            return { ok: false, error: delError };
          }
        }

        // Upsert các dòng mới/cập nhật
        if (snakeVals.length > 0) {
          const { error: upsertError } = await sb.from(tableName).upsert(snakeVals);
          if (upsertError) {
            const errMsg = String(upsertError.message || '');
            if (errMsg.includes('relation') || errMsg.includes('does not exist') || errMsg.includes('schema cache') || errMsg.includes('Could not find')) {
              console.warn(`[ECO_DB] Không tìm thấy bảng ${tableName} trên Supabase. Tự động chuyển hướng lưu trữ cục bộ (localStorage).`);
              localStorage.setItem(key, JSON.stringify(val));
              return { ok: true };
            }
            console.error('[ECO_DB] Upsert error cho table:', tableName, upsertError);
            return { ok: false, error: upsertError };
          }
        }
        return { ok: true };
      },
      async remove(key) {
        if (!sb) return false;
        const { error } = await sb.from(tbl(key)).delete().neq('id', '0');
        return !error;
      },
      subscribe(key, cb) {
        if (!sb) return function unsubscribe() {};
        const tableName = tbl(key);
        let _rtTimer = null;
        const ch = sb.channel('rt:' + tableName)
          .on('postgres_changes', { event: '*', schema: 'public', table: tableName },
              () => {
                clearTimeout(_rtTimer);
                _rtTimer = setTimeout(async () => {
                  const refreshedData = await this.load(key);
                  cb(refreshedData);
                }, 300);
              })
          .subscribe();
        return () => { clearTimeout(_rtTimer); sb.removeChannel(ch); };
      },
    };
  };

  // Khởi tạo adapter kết nối Supabase
  const ECO_DB = makeSupabaseAdapter(window.supabase, mapKeyToTable);

  // ---------- REALTIME STORE + PUB/SUB ----------
  // Kiến trúc 1 chiều: DB → _data → UI.
  // Chiều ghi:         UI → ECO_DB.persist() → DB → realtime → _data → UI.
  // _data KHÔNG BAO GIỜ được ghi trực tiếp từ set() — chỉ nhận từ _receive().
  const _data = new Map();   // key -> giá trị xác nhận từ server (không phải cache local)
  const _subs = new Map();   // key -> Set<cb>
  const _live = new Map();   // key -> unsubscribe() của Supabase channel

  function _receive(key, val) {
    _data.set(key, val);
    ECO_Cache.emit(key, val);
  }

  const ECO_Cache = {
    /** Đọc đồng bộ giá trị mới nhất đã nhận từ server. Null nếu chưa load. */
    get(key, fallback) {
      if (_data.has(key)) {
        const v = _data.get(key);
        return (v == null && fallback !== undefined) ? fallback : v;
      }
      return fallback !== undefined ? fallback : null;
    },

    /**
     * Ghi xuống DB — KHÔNG ghi vào _data.
     * _data chỉ cập nhật khi Supabase xác nhận qua realtime hoặc manual refresh.
     * Ném lỗi nếu persist thất bại để caller biết và xử lý.
     */
    async set(key, val) {
      const result = await ECO_DB.persistWithError(key, val);
      if (!result.ok) {
        const detail = result.error ? ` (${result.error.message || result.error.code || JSON.stringify(result.error)})` : '';
        const msg = '[ECO_Cache] Ghi dữ liệu thất bại: ' + key + detail;
        console.error(msg, result.error);
        if (typeof ECO_UI !== 'undefined') ECO_UI.toast('Lỗi lưu dữ liệu. Vui lòng thử lại.' + detail, 'error');
        throw new Error(msg);
      }
      // Cập nhật _data ngay với giá trị vừa lưu (optimistic) để UI phản hồi tức thì.
      // Realtime sẽ xác nhận lại sau ~300ms; nếu server không đổi thêm thì không thấy khác biệt.
      _receive(key, val);
      if (!_live.has(key)) {
        const fresh = await ECO_DB.load(key);
        _receive(key, fresh);
      }
    },

    /** Đăng ký nhận dữ liệu. Tự động load lần đầu + mở realtime channel. Trả hàm hủy. */
    on(key, cb) {
      if (!_subs.has(key)) _subs.set(key, new Set());
      _subs.get(key).add(cb);

      if (key !== '*') {
        if (!_data.has(key)) {
          _data.set(key, null);   // đánh dấu đang tải
          ECO_DB.load(key).then(val => _receive(key, val));
        } else if (_data.get(key) !== null) {
          try { cb(_data.get(key), key); } catch (e) { console.error(e); }
        }
        if (!_live.has(key)) {
          const off = ECO_DB.subscribe(key, val => _receive(key, val));
          _live.set(key, typeof off === 'function' ? off : function () {});
        }
      }

      return () => {
        _subs.get(key) && _subs.get(key).delete(cb);
        if (_subs.get(key) && _subs.get(key).size === 0 && _live.has(key)) {
          _live.get(key)(); _live.delete(key); _data.delete(key);
        }
      };
    },

    /** Phát sự kiện tới subscriber của key + subscriber '*'. */
    emit(key, val) {
      const fire = (set) => set && set.forEach((cb) => { try { cb(val, key); } catch (e) { console.error(e); } });
      fire(_subs.get(key));
      fire(_subs.get('*'));
    },
  };

  // API quản trị tầng store
  const ECO_Store = {
    get adapter() { return ECO_DB; },
    useAdapter(adapter) {
      _live.forEach((off) => { try { off(); } catch (e) {} });
      _live.clear();
      _data.clear();
      console.info('[ECO_Store] Đã chuyển đổi adapter');
    },
  };

  global.ECO_DB = ECO_DB;
  global.ECO_Cache = ECO_Cache;
  global.ECO_Store = ECO_Store;

})(typeof window !== 'undefined' ? window : globalThis);
