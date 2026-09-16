import { useState, useMemo, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, ClipboardPaste, Check, AlertTriangle, ShieldCheck,
  OctagonX, RefreshCw, Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { n } from '../lib/format';
import { Modal, Button, Select, Field, Textarea, Badge, Empty, Tabs } from './ui';
import {
  readWorkbook, decodeCsv, parseTable, buildTemplate, saveBlob, XLSX_TYPE, SHEET_ITEMS,
} from '../lib/excelFile';
import { FIELDS, autoMap, detectHeader, buildRows } from '../lib/importMap';

/* ------------------------------------------------------------------ */

export default function ImportProducts({ open, onClose, onDone }) {
  const { meta, defaultWarehouse, toast } = useApp();
  const [tab, setTab] = useState('file');
  const [raw, setRaw] = useState('');
  const [sheets, setSheets] = useState([]);       // file .xlsx nhiều sheet
  const [sheetIdx, setSheetIdx] = useState(0);
  const [table, setTable] = useState([]);         // mọi dòng của nguồn đang chọn, kể cả tiêu đề
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({});
  const [mode, setMode] = useState('create');
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [notice, setNotice] = useState('');
  const [check, setCheck] = useState(null);       // { version, res }
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');           // '' | 'read' | 'check' | 'import' | 'template'
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const header = table[headerRow] || [];
  const bump = () => setVersion((v) => v + 1);

  const applyTable = (t) => {
    const h = detectHeader(t);
    setTable(t);
    setHeaderRow(h);
    setMap(autoMap(t[h] || []));
    setResult(null);
    setCheck(null);
    setErr('');
    bump();
  };

  const load = (text) => {
    const t = parseTable(text);
    if (!t.length) { setErr('Không đọc được dữ liệu. Kiểm tra lại file hoặc nội dung dán vào.'); return; }
    setSheets([]);
    applyTable(t);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    setErr('');
    setNotice('');
    if (/\.(xls|numbers|ods|pdf)$/.test(lower)) {
      setErr(`Chưa đọc được file "${file.name}". Mở bằng Excel rồi chọn Lưu thành → Sổ làm việc Excel (.xlsx), sau đó chọn lại file.`);
      return;
    }
    setBusy('read');
    try {
      const buf = await file.arrayBuffer();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        let list;
        try {
          list = await readWorkbook(buf);
        } catch {
          setErr('File .xlsx bị hỏng hoặc có đặt mật khẩu. Mở bằng Excel, bỏ mật khẩu rồi lưu thành file mới.');
          return;
        }
        if (!list.length) { setErr('File không có dòng dữ liệu nào.'); return; }
        const pick = Math.max(0, list.findIndex((s) => s.name === SHEET_ITEMS));
        setSheets(list);
        setSheetIdx(pick);
        applyTable(list[pick].rows);
      } else {
        const { text, encoding } = decodeCsv(buf);
        if (encoding !== 'utf-8') {
          setNotice('File CSV này không lưu theo UTF-8 nên đã đọc theo bảng mã tiếng Việt của Windows. '
            + 'Xem kỹ chữ có dấu ở phần xem trước; còn lỗi thì trong Excel chọn Lưu thành → "CSV UTF-8", '
            + 'hoặc dùng file mẫu .xlsx cho chắc.');
        }
        setRaw(text);
        load(text);
      }
    } finally {
      setBusy('');
    }
  };

  const reset = () => {
    setRaw(''); setSheets([]); setTable([]); setMap({}); setResult(null); setErr('');
    setNotice(''); setCheck(null); bump();
  };

  const rows = useMemo(() => buildRows(table, headerRow, map), [table, headerRow, map]);
  const filledRows = rows.filter((r) => Object.entries(r).some(([k, v]) => k !== '_line' && String(v).trim() !== ''));
  const fresh = check && check.version === version;
  const res = fresh ? check.res : null;

  const runCheck = async (rowsToCheck = rows, v = version) => {
    if (map.name == null) { setErr('Phải chọn cột chứa Tên hàng hoá.'); return; }
    setBusy('check');
    setErr('');
    try {
      const out = await api.post('/products/import', {
        rows: rowsToCheck, mode, warehouse_id: warehouseId, dry_run: true,
      });
      setCheck({ version: v, res: out });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    setBusy('import');
    setErr('');
    try {
      const out = await api.post('/products/import', { rows, mode, warehouse_id: warehouseId });
      setResult(out);
      toast(`Đã thêm ${n(out.created)} mặt hàng, cập nhật ${n(out.updated)}`, 'ok', 6000);
      onDone?.();
    } catch (e) {
      /* Dữ liệu trên máy chủ vừa đổi (ai đó thêm mã vạch trùng…) — kiểm lại để hiện lỗi */
      setErr(e.message);
      if (e.code === 'IMPORT_INVALID') runCheck();
    } finally {
      setBusy('');
    }
  };

  /** "Dùng nhóm này": sửa mọi ô mang đúng tên nhóm sai, rồi kiểm lại ngay. */
  const pickCategory = (bad, good) => {
    const col = map.category;
    if (col == null) return;
    const next = table.map((r, i) => (i > headerRow && String(r[col] ?? '').trim() === bad
      ? r.map((c, j) => (j === col ? good : c)) : r));
    const v = version + 1;
    setTable(next);
    setVersion(v);
    runCheck(buildRows(next, headerRow, map), v);
  };

  const downloadTemplate = async () => {
    setBusy('template');
    try {
      const data = await api.get('/products/import-meta');
      if (!data.category_paths?.length) {
        toast('Tiệm chưa có nhóm hàng nào — file mẫu sẽ không có danh sách chọn nhóm. Nên dựng cây nhóm hàng trước.', 'warn', 8000);
      }
      const buf = await buildTemplate(data);
      saveBlob(buf, 'mau-nhap-hang-hoa.xlsx', XLSX_TYPE);
    } catch (e) {
      toast(`Không tạo được file mẫu: ${e.message}`, 'bad');
    } finally {
      setBusy('');
    }
  };

  const close = () => { reset(); onClose(); };
  const errorLines = new Set((res?.errors || []).map((e) => e.line));

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nhập hàng hoá từ Excel"
      subtitle="Thêm hàng loạt mặt hàng thay vì gõ tay từng cái"
      size="xl"
      footer={<>
        <Button onClick={close}>Đóng</Button>
        <div className="flex-1" />
        {table.length > 0 && !result && (
          res?.ok ? (
            <>
              <Button icon={RefreshCw} onClick={() => runCheck()} loading={busy === 'check'}>Kiểm tra lại</Button>
              <Button variant="primary" icon={Upload} onClick={submit} loading={busy === 'import'}
                disabled={!res.summary.create && !res.summary.update}>
                Nhập {n(res.summary.create + res.summary.update)} mặt hàng
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={ShieldCheck} onClick={() => runCheck()} loading={busy === 'check'}
              disabled={!filledRows.length || map.name == null}>
              Kiểm tra dữ liệu
            </Button>
          )
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
                    {result.skipped > 0 && <li>Bỏ qua vì đã có: <b>{n(result.skipped)}</b> dòng</li>}
                  </ul>
                </div>
              </div>
            </div>
            <Button onClick={reset}>Nhập tiếp file khác</Button>
          </div>
        ) : table.length === 0 ? (
          /* ---------------- Bước 1: chọn nguồn dữ liệu ---------------- */
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'file', label: 'Chọn file Excel' },
                { key: 'paste', label: 'Dán từ Excel' },
              ]}
            />

            {tab === 'file' ? (
              <div className="py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <FileSpreadsheet size={22} className="text-muted-ink" aria-hidden="true" />
                </div>
                <p className="font-semibold">Chọn file Excel (.xlsx) hoặc CSV</p>
                <p className="text-[13px] text-muted-ink mt-1 max-w-md mx-auto leading-relaxed">
                  Nên <b>tải file mẫu</b> về điền: cột Mã vạch đã để sẵn dạng Văn bản nên không mất
                  số 0 đầu, cột Nhóm hàng có danh sách chọn lấy từ chính cây nhóm của tiệm.
                </p>
                <div className="flex gap-2 justify-center mt-4 flex-wrap">
                  <Button variant="primary" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy === 'read'}>
                    Chọn file
                  </Button>
                  <Button icon={Download} onClick={downloadTemplate} loading={busy === 'template'}>
                    Tải file mẫu (.xlsx)
                  </Button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xlsm,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={onFile}
                  aria-label="Chọn file Excel hoặc CSV danh mục hàng hoá"
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
                <div className="flex gap-2 flex-wrap">
                  <Button variant="primary" icon={ClipboardPaste} onClick={() => load(raw)} disabled={!raw.trim()}>
                    Đọc dữ liệu đã dán
                  </Button>
                  <Button icon={Download} onClick={downloadTemplate} loading={busy === 'template'}>Tải file mẫu (.xlsx)</Button>
                </div>
              </div>
            )}

            <div className="card p-3 bg-muted/50">
              <p className="text-[13px] font-semibold mb-1.5">Nhập thế nào cho khỏi sai</p>
              <ul className="text-2xs text-muted-ink leading-relaxed list-disc pl-4 space-y-0.5">
                <li>Bắt buộc: <b>Tên hàng hoá</b>. Các cột khác tuỳ chọn; tên cột có dấu hay không đều nhận ra.</li>
                <li>Nhóm hàng nhiều cấp ghi dạng <b>Nhóm cha &gt; Nhóm con</b>. Nhóm chưa có trong phần mềm
                  thì <b>không tự tạo</b> — tạo trong màn hình Nhóm hàng trước.</li>
                <li>Phần mềm kiểm hết mọi dòng trước khi nhập. <b>Còn một dòng lỗi là chưa nhập dòng nào.</b></li>
              </ul>
            </div>
          </>
        ) : (
          /* ---------------- Bước 2: ghép cột, kiểm tra ---------------- */
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Đọc được {n(filledRows.length)} dòng</Badge>
              {sheets.length > 1 && (
                <Select size="sm" className="!w-auto" aria-label="Chọn sheet"
                  value={sheetIdx}
                  onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); applyTable(sheets[i].rows); }}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>Sheet: {s.name}</option>)}
                </Select>
              )}
              <Select size="sm" className="!w-auto" aria-label="Dòng tiêu đề"
                value={headerRow}
                onChange={(e) => { const h = Number(e.target.value); setHeaderRow(h); setMap(autoMap(table[h] || [])); bump(); }}>
                {table.slice(0, 5).map((_, i) => <option key={i} value={i}>Tiêu đề ở dòng {i + 1}</option>)}
              </Select>
              <div className="flex-1" />
              <Button size="sm" onClick={reset}>Chọn file khác</Button>
            </div>

            {notice && (
              <p className="text-[13px] text-amber-900 bg-amber-50 border border-warn/30 rounded p-2.5 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warn" aria-hidden="true" />{notice}
              </p>
            )}

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
                      onChange={(e) => {
                        setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }));
                        bump();
                      }}
                      className={map[f.key] == null && f.required ? '!border-danger' : ''}
                    >
                      <option value="">— Không dùng —</option>
                      {header.map((h, i) => <option key={i} value={i}>{String(h || '') || `Cột ${i + 1}`}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Khi gặp mặt hàng đã có" hint="Khớp theo mã hàng; dòng không có mã thì khớp theo tên" htmlFor="imp-mode">
                <Select id="imp-mode" value={mode} onChange={(e) => { setMode(e.target.value); bump(); }}>
                  <option value="create">Bỏ qua, chỉ thêm hàng mới</option>
                  <option value="update">Cập nhật — ô để trống thì giữ nguyên thông tin cũ</option>
                </Select>
              </Field>
              <Field label="Ghi tồn kho hiện có vào kho" hint="Chỉ áp dụng cho mặt hàng thêm mới" htmlFor="imp-wh">
                <Select id="imp-wh" value={warehouseId || ''} onChange={(e) => { setWarehouseId(Number(e.target.value)); bump(); }}>
                  {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </Field>
            </div>

            {/* ---------------- Kết quả kiểm tra ---------------- */}
            {check && !fresh && (
              <p className="text-[13px] text-muted-ink bg-muted/60 rounded p-2.5">
                Dữ liệu hoặc cách ghép cột vừa thay đổi — bấm <b>Kiểm tra dữ liệu</b> lại trước khi nhập.
              </p>
            )}
            {res && <CheckReport res={res} onPickCategory={pickCategory} busy={busy === 'check'} />}

            <div>
              <span className="label">Xem trước 8 dòng đầu</span>
              {map.name == null ? (
                <Empty
                  icon={AlertTriangle}
                  title="Chưa ghép cột Tên hàng hoá"
                  message="Hãy chọn đúng cột chứa Tên hàng hoá ở phần ghép cột phía trên."
                />
              ) : (
                <div className="table-wrap max-h-64 overflow-y-auto">
                  <table className="data">
                    <thead>
                      <tr>
                        <th className="text-right">Dòng</th>
                        <th>Mã hàng</th><th>Tên hàng hoá</th><th>Nhóm</th><th>ĐVT</th>
                        <th className="text-right">Giá vốn</th>
                        <th className="text-right">Giá lẻ</th>
                        <th>Mã vạch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filledRows.slice(0, 8).map((r) => {
                        const bad = errorLines.has(r._line) || !String(r.name || '').trim();
                        return (
                          <tr key={r._line} className={bad ? 'bg-red-50' : ''}>
                            <td className="num text-muted-ink">{r._line}</td>
                            <td className="font-mono text-muted-ink">{String(r.sku ?? '') || '(tự đặt)'}</td>
                            <td className="font-semibold">
                              {String(r.name ?? '') || <span className="text-danger">Thiếu tên hàng</span>}
                            </td>
                            <td className="text-muted-ink">{String(r.category ?? '') || '—'}</td>
                            <td>{String(r.base_unit ?? '') || 'Cái'}</td>
                            <td className="num">{String(r.cost_price ?? '') || '—'}</td>
                            <td className="num">{String(r.price_retail ?? '') || '—'}</td>
                            <td className="font-mono text-2xs">{String(r.barcode ?? '') || '—'}</td>
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

/* ------------------------------------------------------------------ */

/**
 * Báo cáo bước kiểm tra. Lỗi nhóm hàng giống nhau gộp một mục — sai tên
 * nhóm ở 50 dòng thì bấm "Dùng nhóm này" một lần là sửa cả 50.
 */
function CheckReport({ res, onPickCategory, busy }) {
  const { summary: s, errors, warnings } = res;

  const grouped = useMemo(() => {
    const out = [];
    const byCat = new Map();
    for (const e of errors) {
      if (e.field === 'category' && e.value) {
        if (!byCat.has(e.value)) {
          const g = { ...e, lines: [] };
          byCat.set(e.value, g);
          out.push(g);
        }
        byCat.get(e.value).lines.push(e.line);
      } else {
        out.push({ ...e, lines: e.line ? [e.line] : [] });
      }
    }
    return out;
  }, [errors]);

  const linesText = (lines) => (lines.length > 6
    ? `Dòng ${lines.slice(0, 6).join(', ')}… (${n(lines.length)} dòng)`
    : lines.length ? `Dòng ${lines.join(', ')}` : '');

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <Badge tone="info">{n(s.total || 0)} dòng</Badge>
        {s.create > 0 && <Badge tone="ok">Thêm mới {n(s.create)}</Badge>}
        {s.update > 0 && <Badge tone="ok">Cập nhật {n(s.update)}</Badge>}
        {s.skip > 0 && <Badge tone="mute">Bỏ qua vì đã có {n(s.skip)}</Badge>}
        {errors.length > 0 && <Badge tone="bad">{n(errors.length)} lỗi</Badge>}
        {warnings.length > 0 && <Badge tone="warn">{n(warnings.length)} cảnh báo</Badge>}
      </div>

      {errors.length > 0 ? (
        <div className="card border-danger/40 overflow-hidden">
          <div className="px-3 py-2 bg-red-50 border-b border-danger/20 flex items-center gap-2">
            <OctagonX size={16} className="text-danger shrink-0" aria-hidden="true" />
            <p className="text-[13px] font-semibold text-red-900">
              Chưa nhập dòng nào. Sửa hết {n(errors.length)} lỗi dưới đây rồi kiểm tra lại
              — hoặc vào hết, hoặc không vào gì.
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-line">
            {grouped.map((e, i) => (
              <li key={i} className="px-3 py-2 text-[13px]">
                <div className="flex flex-wrap gap-x-2 text-2xs text-muted-ink">
                  <span className="font-semibold tabular">{linesText(e.lines)}</span>
                  {e.lines.length === 1 && e.name && <span className="truncate">· {e.name}</span>}
                </div>
                <p className="font-semibold text-ink">{e.error}</p>
                {e.fix && <p className="text-muted-ink text-2xs leading-relaxed">{e.fix}</p>}
                {e.suggestions?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-2xs text-muted-ink">Ý bạn là:</span>
                    {e.suggestions.map((sg) => (
                      <button
                        key={sg}
                        type="button"
                        disabled={busy || !e.value}
                        onClick={() => onPickCategory(e.value, sg)}
                        className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent-soft/50
                                   px-2 py-1 text-2xs font-semibold text-emerald-900 hover:bg-accent-soft
                                   disabled:opacity-50 cursor-pointer"
                        title={`Đổi mọi ô "${e.value}" thành "${sg}"`}
                      >
                        <Wand2 size={12} aria-hidden="true" />
                        Dùng nhóm “{sg}”
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="card p-3 bg-emerald-50 border-emerald-300 text-[13px] text-emerald-950 flex gap-2">
          <ShieldCheck size={18} className="text-emerald-700 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Dữ liệu hợp lệ, sẵn sàng nhập.</p>
            <p>
              Sẽ thêm mới <b>{n(s.create)}</b>, cập nhật <b>{n(s.update)}</b>
              {s.skip > 0 && <>, bỏ qua <b>{n(s.skip)}</b> hàng đã có</>}.
              {s.opening_ignored > 0 && (
                <> Tồn kho ghi trong file của <b>{n(s.opening_ignored)}</b> hàng đã có sẽ <b>không</b> được cộng.</>
              )}
            </p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="card border-warn/30 bg-amber-50/60">
          <summary className="px-3 py-2 text-[13px] font-semibold text-amber-900 cursor-pointer">
            {n(warnings.length)} cảnh báo — vẫn nhập được, nên xem qua
          </summary>
          <ul className="px-3 pb-2 max-h-48 overflow-y-auto text-2xs text-amber-950 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}><b className="tabular">Dòng {w.line}</b> · {w.name}: {w.warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
