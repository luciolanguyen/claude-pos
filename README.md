# Phần mềm bán hàng — Tiệm điện Thạnh Hoà

Phần mềm quản lý bán hàng cho hộ kinh doanh cỡ vừa. Chạy trên một máy trong tiệm làm
máy chủ, các máy khác truy cập qua wifi nội bộ. Không cần Internet để bán hàng.

Tuỳ biến được thành cửa hàng khác chỉ bằng cách sửa **Thiết lập → Thông tin cửa hàng**.

---

## Chạy phần mềm

Nhấn đúp vào **`KHOI-DONG.bat`**. Lần đầu sẽ mất vài phút để cài đặt, các lần sau chạy ngay.

Cần cài [Node.js](https://nodejs.org) phiên bản 22 trở lên trước (bản LTS).

### Máy khác trong tiệm truy cập thế nào

Khi máy chủ khởi động, cửa sổ đen sẽ in ra các địa chỉ dạng:

```
Máy này:        http://localhost:5175
Máy trong tiệm: http://192.168.1.20:5175
```

Trên máy tính hoặc điện thoại khác **cùng wifi**, mở trình duyệt và gõ địa chỉ
`http://192.168.1.20:5175` (thay bằng số máy bạn hiện ra).

Nếu máy khác không vào được, mở Windows Firewall trên máy chủ và cho phép Node.js.

### Tài khoản đăng nhập sẵn

| Tên đăng nhập | Mật khẩu | Vai trò |
|---|---|---|
| `chu` | `1234` | Chủ cửa hàng |
| `hoa` | `1234` | Quản lý |
| `thungan` | `1234` | Thu ngân |
| `kho` | `1234` | Nhân viên kho |

Đổi mật khẩu ở **Thiết lập → Người dùng**.

Tiệm chỉ 1–2 người bán có thể bỏ hẳn màn hình đăng nhập:
**Thiết lập → Màn hình bán hàng → Bỏ qua màn hình đăng nhập**. Mở phần mềm là vào thẳng,
mọi hoá đơn ghi tên tài khoản Chủ cửa hàng.

---

## Các module

### Tổng quan
Doanh thu, lợi nhuận hôm nay và theo kỳ; biểu đồ 30 ngày; giờ bán chạy trong ngày;
hàng bán chạy; khách mua nhiều; cảnh báo hàng sắp hết; công nợ hai chiều; giá trị tồn kho;
vốn lưu động ước tính; chi phí vận hành.

### Bán hàng (POS)
Màn hình bán hàng toàn màn hình, tối ưu cho thao tác nhanh tại quầy.

| Phím | Chức năng |
|---|---|
| `F1` | Mở màn hình bán hàng từ bất kỳ đâu |
| `F2` | Nhảy tới ô tìm hàng / quét mã vạch |
| `F4` | Mở hộp thanh toán |
| `F8` | Thêm khách hàng mới |
| `Enter` | Thêm hàng vừa quét vào giỏ · hoàn tất thanh toán |
| `Esc` | Xoá ô tìm kiếm · đóng hộp thoại |

Quét mã vạch: máy quét gõ mã rồi Enter, hàng tự vào giỏ. Đổi đơn vị tính ngay trên
từng dòng (bán lẻ mét hay nguyên cuộn). Sửa đơn giá tại chỗ. Thanh toán tiền mặt,
chuyển khoản, ghi nợ hoặc kết hợp.

### Quản lý bán hàng
- **Hoá đơn** — tìm theo mã, khách, số điện thoại; lọc theo kỳ và hình thức thanh toán;
  xem chi tiết kèm giá vốn và lãi; thu tiền nợ; huỷ hoá đơn (hàng tự về kho); xuất Excel.
- **Khách trả hàng** — lập từ hoá đơn gốc nên không trả quá số đã bán.
- **Khách hàng** — hồ sơ, lịch sử mua, hàng hay mua, công nợ, hạn mức nợ, bảng giá riêng.
- **Công nợ khách** — danh sách phải thu, cảnh báo vượt hạn mức và nợ quá 60 ngày.

### Mua hàng
- **Phiếu nhập hàng** — nhập theo đơn vị lớn (cuộn, thùng), tự quy đổi tồn kho và
  tính lại giá vốn bình quân gia quyền. Chi phí vận chuyển phân bổ vào giá vốn theo
  tỉ trọng giá trị từng dòng.
- **Trả hàng NCC** — trừ tồn kho, ghi nhận NCC hoàn tiền.
- **Nhà cung cấp** — hồ sơ, hạn công nợ, lịch sử nhập, lịch sử thanh toán.
- **Công nợ NCC** — phải trả, cảnh báo khoản quá hạn.

### Kho hàng
- **Hàng hoá** — nhiều đơn vị quy đổi và 3 bảng giá cho mỗi mặt hàng; tồn tối thiểu/tối đa;
  vị trí trên kệ; thẻ kho đầy đủ. Có **nhập hàng loạt từ Excel** (xem mục dưới).
- **Tồn kho** — lọc sắp hết / hết hàng / vượt định mức; điều chỉnh tồn thủ công có ghi lý do.
- **Kiểm kê** — tạo phiếu nháp, nhập số đếm thực tế, xem chênh lệch rồi mới cân bằng kho.
- **Chuyển kho** — điều chuyển giữa kho cửa hàng và kho phụ.

### Quỹ tiền
Nhiều quỹ (tiền mặt, ngân hàng, ví điện tử). Phiếu thu chi tự sinh từ bán hàng,
nhập hàng, thu/trả nợ; thêm được phiếu thủ công cho chi phí vận hành. Chuyển tiền
giữa các quỹ. Biểu đồ dòng tiền theo ngày.

### Báo cáo
Bán hàng (theo ngày/tháng/nhân viên/khách/hình thức TT), lãi lỗ theo mặt hàng,
kết quả kinh doanh, xuất nhập tồn, mua hàng theo NCC. Tất cả xuất được ra Excel.

### Thiết lập
Thông tin cửa hàng, mẫu hoá đơn, màn hình bán hàng, bảng giá, kho, người dùng,
sao lưu/khôi phục dữ liệu.

---

## Nhập danh mục hàng hoá từ Excel

Vào **Kho hàng → Hàng hoá → Nhập từ Excel**. Hai cách đưa dữ liệu vào:

- **Chọn file CSV** — trong Excel bấm *Lưu thành* rồi chọn *CSV UTF-8 (dấu phẩy phân cách)*.
- **Dán từ Excel** — bôi đen vùng dữ liệu kèm dòng tiêu đề, Ctrl+C rồi Ctrl+V vào ô dán.

Dòng đầu tiên phải là tiêu đề cột. Hệ thống tự đoán cột nào ứng với trường nào theo tên
tiêu đề tiếng Việt (kể cả gõ không dấu); nếu đoán sai thì chỉnh lại ở bước ghép cột trước
khi nhập. Có nút tải file mẫu.

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| Tên hàng hoá | Có | |
| Mã hàng | Không | Bỏ trống thì hệ thống tự đặt |
| Nhóm hàng | Không | Nhóm chưa có sẽ được tạo tự động |
| ĐVT | Không | Mặc định "Cái" |
| Giá vốn, Giá bán lẻ, Giá sỉ, Giá thợ | Không | Nhận cả dạng `1.250.000` và `1250000` |
| Tồn kho | Không | Chỉ ghi cho mặt hàng thêm mới |
| Đơn vị lớn + Hệ số quy đổi | Không | Ví dụ `Cuộn 100m` và `100` |
| Tồn tối thiểu, Mã vạch, Hãng, Vị trí kệ, Thuế GTGT | Không | |

**Nhập lại file đã sửa không tạo bản trùng.** Hệ thống khớp theo mã hàng; dòng nào không có
mã thì khớp theo tên. Chọn *Bỏ qua, chỉ thêm hàng mới* để giữ nguyên hàng cũ, hoặc
*Cập nhật lại thông tin và giá* để sửa giá hàng loạt — chế độ cập nhật **không đụng tới
tồn kho**, tránh làm sai số liệu.

---

## In hoá đơn

Ba khổ giấy, chọn ngay trong hộp thoại in:

| Khổ | Dùng cho |
|---|---|
| **K80** | Máy in nhiệt 80mm — phiếu tính tiền tại quầy |
| **A5** | Phiếu giao hàng, nửa tờ A4 |
| **A4** | Hoá đơn đầy đủ / hoá đơn GTGT, có đọc số tiền bằng chữ và ô chữ ký |

Điền đủ **ngân hàng + số tài khoản + tên chủ tài khoản** ở Thiết lập thì hoá đơn
tự có mã QR VietQR để khách quét chuyển tiền. Mã QR lấy ảnh từ `img.vietqr.io`
nên cần Internet để hiện; mọi phần khác của hoá đơn in bình thường khi mất mạng.

**Máy in nhiệt in lệch mép?** Vào **Thiết lập → Hoá đơn & in ấn → Căn khổ giấy máy in nhiệt**.
Chọn 72mm cho giấy 80mm thông thường, 76mm nếu muốn in sát mép, 48mm nếu tiệm dùng giấy 58mm.
In thử lại sau mỗi lần đổi.

---

## Nghiệp vụ riêng của tiệm điện

**Đơn vị quy đổi.** Mỗi mặt hàng khai nhiều đơn vị: dây điện có `Mét` (cơ bản) và
`Cuộn 100m` (hệ số 100). Nhập nguyên cuộn, bán lẻ theo mét — hệ thống luôn quy về
đơn vị cơ bản khi ghi tồn kho, nên số liệu không bao giờ lệch.

**Nhiều bảng giá.** Ba mức sẵn: Giá lẻ, Giá sỉ, Giá thợ điện. Gán bảng giá cho khách,
khi bán hệ thống tự áp đúng giá. Thêm bảng giá mới ở Thiết lập.

**Hoá đơn GTGT.** Tích ô "Xuất hoá đơn GTGT" khi bán để tách thuế riêng. Thuế suất
đặt theo từng mặt hàng (0/5/8/10%).

---

## Sao lưu dữ liệu

**Thiết lập → Dữ liệu & sao lưu → Tải file sao lưu.** Nên làm mỗi tuần một lần và
cất file vào USB hoặc Google Drive.

Toàn bộ dữ liệu nằm trong một file duy nhất: `data/pos.db`. Sao chép file này cũng
là một cách sao lưu.

Khi đã quen phần mềm và muốn bỏ dữ liệu mẫu để nhập số liệu thật:
**Thiết lập → Dữ liệu & sao lưu → Xoá dữ liệu giao dịch** (giữ lại danh mục hàng hoá,
khách hàng, nhà cung cấp).

---

## Đổi thành cửa hàng khác

1. **Thiết lập → Thông tin cửa hàng**: đổi tên, địa chỉ, điện thoại, mã số thuế,
   tài khoản ngân hàng.
2. **Thiết lập → Dữ liệu**: xoá dữ liệu giao dịch.
3. **Kho hàng → Hàng hoá**: xoá hàng mẫu, rồi bấm **Nhập từ Excel** để đưa toàn bộ
   danh mục hàng của cửa hàng mới vào một lần (nhanh hơn nhiều so với gõ tay).
4. **Thiết lập → Bảng giá**: đổi tên các mức giá cho hợp ngành hàng.

Đổi màu chủ đạo: sửa biến `--accent` trong `client/src/index.css` rồi chạy `npm run build`.

---

## Dành cho người kỹ thuật

```
server/            Máy chủ Node.js + Express
  schema.sql       Lược đồ CSDL SQLite
  db.js            Kết nối, transaction, các hàm nghiệp vụ dùng chung
  seed.js          Nạp dữ liệu mẫu (mô phỏng 70 ngày kinh doanh)
  routes/          API theo module
client/            Giao diện React + Vite + Tailwind
  src/lib/         Gọi API, định dạng số tiền/ngày Việt Nam, trạng thái chung
  src/components/  Bộ giao diện dùng chung, mẫu in hoá đơn
  src/pages/       Các màn hình
data/pos.db        Toàn bộ dữ liệu (SQLite, tạo tự động)
dist/              Giao diện đã build, máy chủ phục vụ từ đây
```

Dùng `node:sqlite` có sẵn trong Node 22+ nên không phải biên dịch thư viện native.

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy chế độ phát triển (API cổng 5175, giao diện cổng 5174) |
| `npm run build` | Build giao diện ra thư mục `dist/` |
| `npm start` | Chạy máy chủ phục vụ cả API và giao diện đã build |
| `npm run seed` | Nạp dữ liệu mẫu (chỉ khi CSDL trống) |
| `npm run reset` | Xoá sạch và nạp lại dữ liệu mẫu |

**Quy ước dữ liệu**

- Tiền tệ lưu dạng **số nguyên VND**, không có phần thập phân — tránh sai số dấu phẩy động.
- Tồn kho luôn lưu theo **đơn vị cơ bản** của mặt hàng; đơn vị lớn chỉ là lớp quy đổi khi
  nhập/bán.
- Giá vốn tính theo **bình quân gia quyền**, cập nhật mỗi lần nhập hàng.
- Mọi biến động kho đều ghi vào `stock_moves` kèm tồn sau biến động, nên tra lại được
  lịch sử đầy đủ của từng mặt hàng.
- Mọi thao tác ghi nhiều bảng đều chạy trong transaction, lỗi giữa chừng sẽ rollback sạch.

**Bảo mật.** Đăng nhập chỉ để phân biệt người bán trên hoá đơn, không phải lớp bảo mật
mạnh (mật khẩu lưu dạng chữ thường). Phần mềm thiết kế cho mạng nội bộ trong tiệm —
**không mở cổng 5175 ra Internet**.
