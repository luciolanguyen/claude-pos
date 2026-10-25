/* ====================================================================
   NHẬP KHÁCH HÀNG / NHÀ CUNG CẤP TỪ EXCEL (10/10/2026)

   Cùng ba bước với nhập hàng hoá: chọn file (hoặc dán) → ghép cột → kiểm
   tra → nhập. Máy chủ kiểm hết mọi dòng trước; còn một dòng lỗi là chưa
   ghi dòng nào.

   Chế độ "Cập nhật theo mã" sửa hồ sơ đã có — dễ ghi đè nhầm nếu file cũ,
   nên bước kiểm liệt kê hồ sơ nào sẽ đổi gì (trước → sau) rồi mới cho bấm.
   Ô để trống trong file thì GIỮ NGUYÊN số cũ, không xoá.

   Cố ý không có cột nợ đầu kỳ: nợ đi đường "Điều chỉnh công nợ" có PIN.
   ==================================================================== */
import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, ClipboardPaste, Check, AlertTriangle, ShieldCheck, OctagonX,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { n } from '../lib/format';
import { Modal, Button, Select, Textarea, Badge, Tabs } from './ui';
import {
  readWorkbook, decodeCsv, parseTable, buildSimpleTemplate, saveBlob, XLSX_TYPE,
} from '../lib/excelFile';
import {
  autoMapFields, detectHeaderFields, buildRows, hasDebtColumn, CUSTOMER_FIELDS, SUPPLIER_FIELDS,
} from '../lib/importMap';

/* Cấu hình từng loại: trường ghép, đường gọi máy chủ, file mẫu */
const KINDS = {
  customers: {
    title: 'Nhập khách hàng từ Excel',
    noun: 'khách hàng',
    fields: CUSTOMER_FIELDS,
    url: '/customers/import',
    file: 'mau-nhap-khach-hang.xlsx',
    sheet: 'Khách hàng',
    columns: [
      { header: 'Mã KH', width: 12, text: true, note: 'Để trống thì máy tự sinh mã.\nCập nhật theo mã thì ghi đúng mã đang có.' },
      { header: 'Tên khách hàng', width: 28, required: true },
      { header: 'SĐT 1', width: 14, text: true },
      { header: 'SĐT 2', width: 14, text: true },
      { header: 'SĐT 3', width: 14, text: true },
      { header: 'Địa chỉ', width: 32 },
      { header: 'Tên công ty', width: 24 },
      { header: 'Mã số thuế', width: 14, text: true },
      { header: 'Email', width: 22 },
      { header: 'Ngày sinh', width: 12, text: true, note: 'Ghi kiểu 25/12/1980' },
      { header: 'Loại khách', width: 14, note: 'Thành viên, VIP hoặc Khách sỉ' },
      { header: 'Hạn mức nợ', width: 14, note: 'Chỉ chủ tiệm / quản lý nhập cột này mới có tác dụng' },
      { header: 'Số ngày nợ tối đa', width: 12, note: 'Chỉ chủ tiệm / quản lý nhập cột này mới có tác dụng' },
      { header: 'Ghi chú', width: 30 },
    ],
    sample: [['', 'Anh Ba thợ điện', '0909123456', '', '', 'Ấp 1, Cái Bè', '', '', '', '', 'Khách sỉ', '', '', 'Thợ quen']],
  },
  suppliers: {
    title: 'Nhập nhà cung cấp từ Excel',
    noun: 'nhà cung cấp',
    fields: SUPPLIER_FIELDS,
    url: '/suppliers/import',
    file: 'mau-nhap-nha-cung-cap.xlsx',
    sheet: 'Nhà cung cấp',
    columns: [
      { header: 'Mã NCC', width: 12, text: true, note: 'Để trống thì máy tự sinh mã.' },
      { header: 'Tên nhà cung cấp', width: 30, required: true },
      { header: 'Người liên hệ', width: 18 },
      { header: 'Điện thoại', width: 14, text: true, note: 'Cập nhật theo mã: số mới được THÊM vào, số cũ giữ nguyên' },
      { header: 'Email', width: 22 },
      { header: 'Địa chỉ', width: 32 },
      { header: 'Mã số thuế', width: 14, text: true },
      { header: 'Ngân hàng', width: 16 },
      { header: 'Số tài khoản', width: 18, text: true, note: 'Phải ghi kèm tên ngân hàng' },
      { header: 'Số ngày được nợ', width: 12 },
      { header: 'Ghi chú', width: 30 },
    ],
    sample: [['', 'Công ty Điện Quang CN Tiền Giang', 'Chị Lan', '0273123456', '', 'TP Mỹ Tho', '', 'Vietcombank', '0123456789', '30', '']],
  },
};

export default function ImportPartners({ kind = 'customers', open, onClose, onDone }) {
  const cfg = KINDS[kind];
  const { toast } = useApp();
  const [tab, setTab] = useState('file');
  const [raw, setRaw] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [table, setTable] = useState([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({});
  const [mode, setMode] = useState('create');
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const header = table[headerRow] || [];
  const rows = table.length ? buildRows(table, headerRow, map) : [];
  const filledRows = rows.filter((r) => Object.entries(r).some(([k, v]) => k !== '_line' && String(v).trim() !== ''));
  const debtCol = hasDebtColumn(header);

  const applyTable = (t) => {
    const h = detectHeaderFields(cfg.fields, t);
    setTable(t);
    setHeaderRow(h);
    setMap(autoMapFields(cfg.fields, t[h] || []));
    setCheck(null); setResult(null); setErr('');
  };

  const reset = () => {
    setRaw(''); setSheets([]); setTable([]); setMap({}); setCheck(null); setResult(null); setErr('');
  };

  const close = () => { reset(); onClose?.(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    setErr('');
    if (/\.(xls|numbers|ods|pdf)$/.test(lower)) {
      setErr(`Chưa đọc được file "${file.name}". Mở bằng Excel rồi Lưu thành → Sổ làm việc Excel (.xlsx).`);
      return;
    }
    setBusy('read');
    try {
      const buf = await file.arrayBuffer();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        let list;
        try { list = await readWorkbook(buf); } catch {
          setErr('File .xlsx bị hỏng hoặc có mật khẩu. Mở bằng Excel, bỏ mật khẩu rồi lưu thành file mới.');
          return;
        }
        if (!list.length) { setErr('File không có dòng dữ liệu nào.'); return; }
        setSheets(list);
        setSheetIdx(0);
        applyTable(list[0].rows);
      } else {
        const t = parseTable(decodeCsv(buf).text);
        if (!t.length) { setErr('Không đọc được dữ liệu trong file.'); return; }
        setSheets([]);
        applyTable(t);
      }
    } finally {
      setBusy('');
    }
  };

  const downloadTemplate = async () => {
    setBusy('template');
    try {
      const buf = await buildSimpleTemplate(cfg.sheet, cfg.columns, cfg.sample);
      saveBlob(buf, cfg.file, XLSX_TYPE);
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusy('');
    }
  };

  const send = async (dryRun) => {
    if (map.name == null && mode === 'create') { setErr(`Phải chọn cột chứa tên ${cfg.noun}.`); return; }
    if (map.name == null && map.code == null) { setErr('Chọn ít nhất cột Mã hoặc cột Tên.'); return; }
    setBusy(dryRun ? 'check' : 'import');
    setErr('');
    try {
      const out = await api.post(cfg.url, { rows: filledRows, mode, dry_run: dryRun });
      if (dryRun) setCheck(out);
      else {
        setResult(out);
        onDone?.();
      }
    } catch (e) {
      /* 422: kiểm lại thấy lỗi — hiện bảng lỗi thay vì chỉ một dòng thông báo */
      if (e.body?.errors) setCheck({ ...e.body, ok: false });
      setErr(e.message);
    } finally {
      setBusy('');
    }
  };

  const changeMap = (key, idx) => {
    setMap((m) => ({ ...m, [key]: idx === '' ? undefined : Number(idx) }));
    setCheck(null);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={cfg.title}
      subtitle="Kiểm hết mọi dòng trước khi ghi — còn một lỗi là chưa nhập dòng nào"
      size="lg"
      footer={result ? <Button onClick={close}>Đóng</Button> : table.length ? <>
        <Button onClick={close}>Huỷ</Button>
        <Button icon={ShieldCheck} onClick={() => send(true)} loading={busy === 'check'}>Kiểm tra dữ liệu</Button>
        <Button variant="primary" icon={Check} onClick={() => send(false)} loading={busy === 'import'}
          disabled={!check?.ok}>
          Nhập {n(filledRows.length)} dòng
        </Button>
      </> : <Button onClick={close}>Đóng</Button>}
    >
      <div className="space-y-3">
        {result ? (
          <div className="card p-4 bg-accent-soft/60 border-accent/40">
            <div className="flex items-start gap-2.5">
              <Check size={20} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">Nhập {cfg.noun} xong</p>
                <ul className="text-[13px] mt-1 space-y-0.5">
                  <li>Thêm mới: <b>{n(result.created)}</b></li>
                  <li>Cập nhật: <b>{n(result.updated)}</b></li>
                  {result.warnings?.length > 0 && <li>Cảnh báo: <b>{n(result.warnings.length)}</b> (xem lại bên dưới)</li>}
                </ul>
              </div>
            </div>
            <Button className="mt-3" onClick={reset}>Nhập tiếp file khác</Button>
          </div>
        ) : table.length === 0 ? (
          <>
            <Tabs value={tab} onChange={setTab}
              tabs={[{ key: 'file', label: 'Chọn file Excel' }, { key: 'paste', label: 'Dán từ Excel' }]} />
            {tab === 'file' ? (
              <div className="py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <FileSpreadsheet size={22} className="text-muted-ink" aria-hidden="true" />
                </div>
                <p className="font-semibold">Chọn file Excel (.xlsx) hoặc CSV</p>
                <p className="text-[13px] text-muted-ink mt-1 max-w-md mx-auto leading-relaxed">
                  Nên <b>tải file mẫu</b> về điền: cột số điện thoại, mã, số tài khoản đã để dạng Văn bản
                  nên Excel không làm rụng số 0 đầu.
                </p>
                <div className="flex gap-2 justify-center mt-4 flex-wrap">
                  <Button variant="primary" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy === 'read'}>
                    Chọn file
                  </Button>
                  <Button icon={Download} onClick={downloadTemplate} loading={busy === 'template'}>Tải file mẫu (.xlsx)</Button>
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={onFile}
                  accept=".xlsx,.xlsm,.csv,text/csv,text/plain"
                  aria-label={`Chọn file Excel hoặc CSV danh sách ${cfg.noun}`} />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-muted-ink">
                  Trong Excel, bôi đen vùng dữ liệu <b>kèm dòng tiêu đề</b>, Ctrl+C rồi dán vào đây.
                </p>
                <Textarea rows={8} value={raw} onChange={(e) => setRaw(e.target.value)}
                  className="font-mono text-2xs" aria-label="Dán dữ liệu từ Excel" />
                <Button variant="primary" icon={ClipboardPaste} disabled={!raw.trim()}
                  onClick={() => { const t = parseTable(raw); if (t.length) applyTable(t); else setErr('Không đọc được dữ liệu đã dán.'); }}>
                  Đọc dữ liệu đã dán
                </Button>
              </div>
            )}
            <div className="card p-3 bg-muted/50">
              <p className="text-[13px] font-semibold mb-1.5">Nhập thế nào cho khỏi sai</p>
              <ul className="text-2xs text-muted-ink leading-relaxed list-disc pl-4 space-y-0.5">
                <li>Bắt buộc: <b>tên {cfg.noun}</b>. Tên cột có dấu hay không đều nhận ra.</li>
                <li><b>Không nhập nợ đầu kỳ</b> qua file — nợ cũ ghi bằng "Điều chỉnh công nợ" trong hồ sơ (có PIN, ghi lý do).</li>
                <li>Số điện thoại bị Excel làm rụng số 0 đầu thì phần mềm tự thêm lại.</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Đọc được {n(filledRows.length)} dòng</Badge>
              {sheets.length > 1 && (
                <Select size="sm" className="!w-auto" aria-label="Chọn sheet" value={sheetIdx}
                  onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); applyTable(sheets[i].rows); }}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>Sheet: {s.name}</option>)}
                </Select>
              )}
              <Select size="sm" className="!w-auto" aria-label="Dòng tiêu đề" value={headerRow}
                onChange={(e) => { const h = Number(e.target.value); setHeaderRow(h); setMap(autoMapFields(cfg.fields, table[h] || [])); setCheck(null); }}>
                {table.slice(0, 5).map((_, i) => <option key={i} value={i}>Tiêu đề ở dòng {i + 1}</option>)}
              </Select>
              <div className="flex-1" />
              <Button size="sm" onClick={reset}>Chọn file khác</Button>
            </div>

            {/* Hai chế độ — chủ tiệm chốt 10/10: trùng mã thì cập nhật hồ sơ cũ */}
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Chế độ nhập">
              {[
                ['create', 'Chỉ thêm mới', 'Mã đã có trong máy là báo lỗi, không đụng hồ sơ cũ.'],
                ['update', 'Cập nhật theo mã', 'Mã đã có thì sửa hồ sơ đó; ô trống trong file giữ nguyên số cũ.'],
              ].map(([k, label, hint]) => (
                <label key={k} className={`flex items-start gap-2 rounded border p-2 text-[13px] cursor-pointer
                  ${mode === k ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-muted/60'}`}>
                  <input type="radio" name={`imp-mode-${kind}`} className="w-4 h-4 mt-0.5 accent-emerald-700"
                    checked={mode === k} onChange={() => { setMode(k); setCheck(null); }} />
                  <span><b className="block">{label}</b><span className="text-2xs text-muted-ink">{hint}</span></span>
                </label>
              ))}
            </div>

            {debtCol && (
              <p className="text-[13px] bg-muted border border-line rounded p-2.5 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warn" aria-hidden="true" />
                File có cột nợ — cột đó sẽ bị bỏ qua. Nợ cũ ghi bằng "Điều chỉnh công nợ" trong hồ sơ.
              </p>
            )}

            <div>
              <span className="label">Ghép cột trong file với trường của phần mềm</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {cfg.fields.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <label htmlFor={`imp-${kind}-${f.key}`} className="text-[13px] w-36 shrink-0 truncate">
                      {f.label}{f.required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
                    </label>
                    <Select id={`imp-${kind}-${f.key}`} size="sm" value={map[f.key] ?? ''}
                      onChange={(e) => changeMap(f.key, e.target.value)}>
                      <option value="">— Không có —</option>
                      {header.map((h, i) => <option key={i} value={i}>{String(h || `Cột ${i + 1}`)}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {check && <CheckReport check={check} />}
          </>
        )}

        {result?.warnings?.length > 0 && <CheckReport check={{ ...result, ok: true, errors: [] }} />}
        {err && <p className="text-[13px] text-danger font-semibold" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** Bảng kết quả kiểm: lỗi, cảnh báo, và hồ sơ nào sẽ đổi gì. */
function CheckReport({ check }) {
  const s = check.summary || {};
  const updates = (check.preview || []).filter((p) => p.action === 'update' && p.changes?.length);
  return (
    <div className="space-y-2">
      <div className={`card p-3 flex items-start gap-2 ${check.ok ? 'border-accent/40' : 'border-danger/40'}`}>
        {check.ok
          ? <ShieldCheck size={18} className="text-accent shrink-0" aria-hidden="true" />
          : <OctagonX size={18} className="text-danger shrink-0" aria-hidden="true" />}
        <div className="text-[13px]">
          {check.ok
            ? <b>Dữ liệu sạch, bấm "Nhập" để ghi.</b>
            : <b className="text-danger">Có {n(check.errors.length)} lỗi — sửa trong file rồi kiểm lại.</b>}
          <div className="text-muted-ink">
            Sẽ thêm mới {n(s.create || 0)} · cập nhật {n((s.update || 0) - (s.unchanged || 0))}
            {s.unchanged > 0 && ` · ${n(s.unchanged)} dòng không đổi gì`}
          </div>
        </div>
      </div>

      {check.errors?.length > 0 && (
        <ul className="text-[13px] max-h-48 overflow-auto rounded border border-danger/30 p-2 space-y-0.5">
          {check.errors.map((e, i) => (
            <li key={i}><b className="text-danger">{e.line ? `Dòng ${e.line}: ` : ''}</b>{e.msg}</li>
          ))}
        </ul>
      )}
      {check.warnings?.length > 0 && (
        <ul className="text-[13px] max-h-36 overflow-auto rounded border border-warn/30 p-2 space-y-0.5">
          {check.warnings.map((w, i) => (
            <li key={i}><b className="text-warn">{w.line ? `Dòng ${w.line}: ` : 'Lưu ý: '}</b>{w.msg}</li>
          ))}
        </ul>
      )}
      {updates.length > 0 && (
        <div>
          <p className="text-[13px] font-semibold mb-1">Hồ sơ cũ sẽ đổi ({n(updates.length)})</p>
          <div className="table-wrap max-h-60">
            <table className="data">
              <thead><tr><th>Dòng</th><th>Mã</th><th>Trường</th><th>Đang là</th><th>Sẽ thành</th></tr></thead>
              <tbody>
                {updates.flatMap((p) => p.changes.map((c, j) => (
                  <tr key={`${p.line}-${j}`}>
                    <td className="tabular">{j === 0 ? p.line : ''}</td>
                    <td className="font-mono">{j === 0 ? p.code : ''}</td>
                    <td>{c.label}</td>
                    <td className="text-muted-ink line-through">{String(c.from) || '—'}</td>
                    <td className="font-semibold">{String(c.to) || '—'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
