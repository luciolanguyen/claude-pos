import { useState, useMemo, useRef } from 'react';
import { Upload, Download, FileSpreadsheet, ClipboardPaste, Check, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { n, money, noAccent } from '../lib/format';
import { Modal, Button, Select, Field, Textarea, Badge, Empty, Tabs } from './ui';

/* ------------------------------------------------------------------ */
/* Đọc file: hỗ trợ CSV (dấu phẩy / chấm phẩy) và dán từ Excel (tab)    */
/* ------------------------------------------------------------------ */

/** Tách một dòng có tôn trọng dấu nháy kép bao quanh ô. */
function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === sep && !inQuote) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseTable(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return { header: [], rows: [] };
  const first = clean.split('\n')[0];
  // Đoán dấu phân cách theo ký tự xuất hiện nhiều nhất ở dòng tiêu đề
  const sep = ['\t', ';', ','].reduce((best, s) =>
    (first.split(s).length > first.split(best).length ? s : best), ',');
  const lines = clean.split('\n').filter((l) => l.trim());
  const header = splitLine(lines[0], sep);
  const rows = lines.slice(1).map((l) => splitLine(l, sep));
  return { header, rows };
}

/* ------------------------------------------------------------------ */
/* Các cột hệ thống hiểu được + từ khoá để tự nhận diện                 */
/* ------------------------------------------------------------------ */

const FIELDS = [
  { key: 'sku', label: 'Mã hàng', hints: ['ma hang', 'ma sp', 'sku', 'ma'] },
  { key: 'name', label: 'Tên hàng hoá', hints: ['ten hang', 'ten san pham', 'ten', 'name'], required: true },
  { key: 'category', label: 'Nhóm hàng', hints: ['nhom hang', 'nhom', 'loai', 'danh muc'] },
  { key: 'base_unit', label: 'Đơn vị tính', hints: ['dvt', 'don vi', 'dv tinh', 'unit'] },
  { key: 'cost_price', label: 'Giá vốn / giá nhập', hints: ['gia von', 'gia nhap', 'gia mua', 'cost'] },
  { key: 'price_retail', label: 'Giá bán lẻ', hints: ['gia le', 'gia ban le', 'gia ban', 'don gia', 'gia'] },
  { key: 'price_wholesale', label: 'Giá sỉ', hints: ['gia si', 'gia buon'] },
  { key: 'price_dealer', label: 'Giá thợ / đại lý', hints: ['gia tho', 'gia dai ly', 'gia dl'] },
  { key: 'opening_qty', label: 'Tồn kho hiện có', hints: ['ton kho', 'ton', 'so luong', 'sl'] },
  { key: 'min_stock', label: 'Tồn tối thiểu', hints: ['ton toi thieu', 'ton min', 'dinh muc'] },
  { key: 'barcode', label: 'Mã vạch', hints: ['ma vach', 'barcode'] },
  { key: 'brand', label: 'Hãng', hints: ['hang', 'thuong hieu', 'brand', 'nsx'] },
  { key: 'location', label: 'Vị trí kệ', hints: ['vi tri', 'ke', 'location'] },
  { key: 'vat_rate', label: 'Thuế GTGT (%)', hints: ['thue', 'vat', 'gtgt'] },
  { key: 'big_unit', label: 'Đơn vị lớn', hints: ['don vi lon', 'dv lon', 'quy cach'] },
  { key: 'big_factor', label: 'Hệ số quy đổi', hints: ['he so', 'quy doi', 'factor'] },
  { key: 'big_price', label: 'Giá đơn vị lớn', hints: ['gia don vi lon', 'gia lon', 'gia cuon', 'gia thung'] },
];

/** Tự đoán cột nào ứng với trường nào dựa vào tiêu đề file. */
function autoMap(header) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS) {
    const idx = header.findIndex((h, i) => {
      if (used.has(i)) return false;
      const hh = noAccent(h);
      return f.hints.some((hint) => hh === hint || hh.startsWith(hint) || hh.includes(hint));
    });
    if (idx >= 0) { map[f.key] = idx; used.add(idx); }
  }
  return map;
}

const SAMPLE = `Mã hàng,Tên hàng hoá,Nhóm hàng,ĐVT,Giá vốn,Giá bán lẻ,Giá sỉ,Tồn kho,Đơn vị lớn,Hệ số quy đổi
DC010,Dây điện Cadivi VCm 1x4.0,Dây & cáp điện,Mét,17000,23000,21000,600,Cuộn 100m,100
CB010,Aptomat MCB 2P 20A LS,Thiết bị đóng cắt,Cái,95000,135000,122000,40,,
DE010,Bóng LED bulb 12W Rạng Đông,Đèn chiếu sáng,Cái,34000,49000,44000,120,Thùng 50 cái,50`;

/* ------------------------------------------------------------------ */

export default function ImportProducts({ open, onClose, onDone }) {
  const { meta, defaultWarehouse, toast } = useApp();
  const [tab, setTab] = useState('file');
  const [raw, setRaw] = useState('');
  const [header, setHeader] = useState([]);
  const [rows, setRows] = useState([]);
  const [map, setMap] = useState({});
  const [mode, setMode] = useState('create');
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const load = (text) => {
    const { header: h, rows: rs } = parseTable(text);
    if (!h.length) { setErr('Không đọc được dữ liệu. Kiểm tra lại file hoặc nội dung dán vào.'); return; }
    setHeader(h);
    setRows(rs);
    setMap(autoMap(h));
    setResult(null);
    setErr('');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    load(text);
    e.target.value = '';
  };

  const reset = () => {
    setRaw(''); setHeader([]); setRows([]); setMap({}); setResult(null); setErr('');
  };

  /** Dựng các dòng đã ánh xạ để xem trước và gửi lên máy chủ. */
  const mapped = useMemo(() => rows.map((r) => {
    const o = {};
    for (const [key, idx] of Object.entries(map)) {
      if (idx !== '' && idx != null) o[key] = r[idx] ?? '';
    }
    return o;
  }), [rows, map]);

  const validCount = mapped.filter((r) => String(r.name || '').trim()).length;
  const invalidCount = mapped.length - validCount;

  const submit = async () => {
    if (map.name == null) { setErr('Phải chọn cột chứa Tên hàng hoá.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/products/import', {
        rows: mapped, mode, warehouse_id: warehouseId,
      });
      setResult(res);
      toast(`Đã thêm ${res.created} mặt hàng, cập nhật ${res.updated}`, 'ok', 6000);
      onDone?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + SAMPLE], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau-nhap-hang-hoa.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Nhập hàng hoá từ Excel"
      subtitle="Thêm hàng loạt mặt hàng thay vì gõ tay từng cái"
      size="xl"
      footer={<>
        <Button onClick={() => { reset(); onClose(); }}>Đóng</Button>
        <div className="flex-1" />
        {header.length > 0 && !result && (
          <Button variant="primary" onClick={submit} loading={busy} disabled={!validCount}>
            Nhập {n(validCount)} mặt hàng
          </Button>
        )}
      </>}
    >
      <div className="space-y-3">
        {/* ---------------- Kết quả sau khi nhập ---------------- */}
        {result ? (
          <div className="space-y-3">
            <div className="card p-4 bg-emerald-50 border-emerald-300">
              <div className="flex items-start gap-2.5">
                <Check size={20} className="text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-bold text-emerald-900">Nhập hàng hoá xong</p>
                  <ul className="text-[13px] text-emerald-900/90 mt-1 space-y-0.5">
                    <li>Thêm mới: <b>{n(result.created)}</b> mặt hàng</li>
                    <li>Cập nhật: <b>{n(result.updated)}</b> mặt hàng</li>
                    {result.skipped > 0 && (
                      <li>Bỏ qua do trùng mã: <b>{n(result.skipped)}</b> dòng</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            {result.errors?.length > 0 && (
              <div className="card p-3 border-warn/40 bg-amber-50">
                <p className="font-semibold text-warn text-[13px] mb-1.5">
                  {result.errors.length} dòng không nhập được
                </p>
                <ul className="text-[13px] text-amber-900 space-y-0.5 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>Dòng {e.line}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button onClick={reset}>Nhập tiếp file khác</Button>
          </div>
        ) : header.length === 0 ? (
          /* ---------------- Bước 1: chọn nguồn dữ liệu ---------------- */
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'file', label: 'Chọn file CSV' },
                { key: 'paste', label: 'Dán từ Excel' },
              ]}
            />

            {tab === 'file' ? (
              <div className="py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <FileSpreadsheet size={22} className="text-muted-ink" aria-hidden="true" />
                </div>
                <p className="font-semibold">Chọn file CSV từ máy tính</p>
                <p className="text-[13px] text-muted-ink mt-1 max-w-md mx-auto leading-relaxed">
                  Trong Excel, bấm <b>Lưu thành</b> rồi chọn định dạng
                  <b> CSV UTF-8 (dấu phẩy phân cách)</b>. Dòng đầu tiên phải là tiêu đề cột.
                </p>
                <div className="flex gap-2 justify-center mt-4">
                  <Button variant="primary" icon={Upload} onClick={() => fileRef.current?.click()}>
                    Chọn file
                  </Button>
                  <Button icon={Download} onClick={downloadTemplate}>Tải file mẫu</Button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={onFile}
                  aria-label="Chọn file CSV danh mục hàng hoá"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-muted-ink leading-relaxed">
                  Trong Excel, bôi đen vùng dữ liệu <b>kèm dòng tiêu đề</b>, nhấn Ctrl+C,
                  rồi dán vào ô dưới đây bằng Ctrl+V.
                </p>
                <Textarea
                  rows={8}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={'Mã hàng\tTên hàng hoá\tĐVT\tGiá vốn\tGiá bán lẻ\nDC010\tDây điện 1x4.0\tMét\t17000\t23000'}
                  className="font-mono text-2xs"
                  aria-label="Dán dữ liệu từ Excel"
                />
                <div className="flex gap-2">
                  <Button variant="primary" icon={ClipboardPaste} onClick={() => load(raw)} disabled={!raw.trim()}>
                    Đọc dữ liệu đã dán
                  </Button>
                  <Button icon={Download} onClick={downloadTemplate}>Tải file mẫu</Button>
                </div>
              </div>
            )}

            <div className="card p-3 bg-muted/50">
              <p className="text-[13px] font-semibold mb-1.5">Các cột hệ thống hiểu được</p>
              <p className="text-2xs text-muted-ink leading-relaxed">
                Bắt buộc: <b>Tên hàng hoá</b>. Tuỳ chọn: Mã hàng, Nhóm hàng, ĐVT, Giá vốn,
                Giá bán lẻ, Giá sỉ, Giá thợ, Tồn kho, Tồn tối thiểu, Mã vạch, Hãng, Vị trí kệ,
                Thuế GTGT, Đơn vị lớn, Hệ số quy đổi, Giá đơn vị lớn.
                <br />
                Hệ thống tự nhận cột theo tiêu đề; nếu nhận sai thì chỉnh lại ở bước sau.
                Nhóm hàng chưa có sẽ được tạo tự động.
              </p>
            </div>
          </>
        ) : (
          /* ---------------- Bước 2: ánh xạ cột + xem trước ---------------- */
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Đọc được {n(rows.length)} dòng</Badge>
              {validCount > 0 && <Badge tone="ok">{n(validCount)} dòng hợp lệ</Badge>}
              {invalidCount > 0 && <Badge tone="warn">{n(invalidCount)} dòng thiếu tên hàng</Badge>}
              <div className="flex-1" />
              <Button size="sm" onClick={reset}>Chọn file khác</Button>
            </div>

            <div>
              <span className="label">Ghép cột trong file với trường của phần mềm</span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <label htmlFor={`map-${f.key}`} className="text-[13px] w-32 shrink-0 truncate">
                      {f.label}
                      {f.required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
                    </label>
                    <Select
                      id={`map-${f.key}`}
                      size="sm"
                      value={map[f.key] ?? ''}
                      onChange={(e) => setMap((m) => ({
                        ...m,
                        [f.key]: e.target.value === '' ? undefined : Number(e.target.value),
                      }))}
                      className={map[f.key] == null && f.required ? '!border-danger' : ''}
                    >
                      <option value="">— Không dùng —</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `Cột ${i + 1}`}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Khi gặp mặt hàng đã có" hint="Khớp theo mã hàng; dòng không có mã thì khớp theo tên" htmlFor="imp-mode">
                <Select id="imp-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="create">Bỏ qua, chỉ thêm hàng mới</option>
                  <option value="update">Cập nhật lại thông tin và giá</option>
                </Select>
              </Field>
              <Field label="Ghi tồn kho hiện có vào kho" hint="Chỉ áp dụng cho mặt hàng thêm mới" htmlFor="imp-wh">
                <Select id="imp-wh" value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                  {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </Field>
            </div>

            <div>
              <span className="label">Xem trước 8 dòng đầu</span>
              {validCount === 0 ? (
                <Empty
                  icon={AlertTriangle}
                  title="Chưa dòng nào hợp lệ"
                  message="Hãy chọn đúng cột chứa Tên hàng hoá ở phần ghép cột phía trên."
                />
              ) : (
                <div className="table-wrap max-h-64 overflow-y-auto">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mã hàng</th><th>Tên hàng hoá</th><th>Nhóm</th><th>ĐVT</th>
                        <th className="text-right">Giá vốn</th>
                        <th className="text-right">Giá lẻ</th>
                        <th className="text-right">Tồn</th>
                        <th>Đơn vị lớn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.slice(0, 8).map((r, i) => {
                        const bad = !String(r.name || '').trim();
                        return (
                          <tr key={i} className={bad ? 'bg-red-50' : ''}>
                            <td className="font-mono text-muted-ink">{r.sku || '(tự đặt)'}</td>
                            <td className="font-semibold">
                              {r.name || <span className="text-danger">Thiếu tên hàng</span>}
                            </td>
                            <td className="text-muted-ink">{r.category || '—'}</td>
                            <td>{r.base_unit || 'Cái'}</td>
                            <td className="num">{r.cost_price || '—'}</td>
                            <td className="num">{r.price_retail || '—'}</td>
                            <td className="num">{r.opening_qty || '—'}</td>
                            <td className="text-muted-ink text-2xs">
                              {r.big_unit ? `${r.big_unit} × ${r.big_factor || '?'}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {err && (
          <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
