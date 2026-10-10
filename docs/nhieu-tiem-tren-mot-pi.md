# Chạy nhiều tiệm trên một con Raspberry Pi

Hướng dẫn này dành cho trường hợp một con Pi chạy **nhiều bản phần mềm độc lập**, mỗi
bản là một tiệm riêng với sổ sách riêng.

## Nguyên tắc: mỗi thư mục là một tiệm

Phần mềm lấy mọi thứ theo **thư mục đang chạy**: cơ sở dữ liệu `data/pos.db`, ảnh hàng
hoá, ảnh bảo hành, ảnh phiếu lương, chứng chỉ HTTPS — tất cả nằm trong `data/` của chính
thư mục đó. Nên bốn bản chép ra bốn thư mục là bốn tiệm hoàn toàn tách biệt, **không dùng
chung thứ gì**.

Việc duy nhất phải tự đặt là **cổng**. Cổng HTTPS cho điện thoại máy tự lấy bằng
**cổng thường + 1000** (xem `server/index.js`), không cần khai.

| Thư mục | Người chạy | HTTP (máy tính) | HTTPS (điện thoại) |
|---|---|---|---|
| `/home/laclacboy/claude-pos` | `laclacboy` | 5175 | 6175 |
| `/home/tinchi/claude-pos` | `tinchi` | 5165 | 6165 |
| `/home/nhatran/claude-pos` | `nhatran` | 5155 | 6155 |
| `/home/kimngan/claude-pos` | `kimngan` | 5145 | 6145 |

Thêm tiệm mới thì cứ theo nếp đó: một thư mục, một cổng chưa ai dùng.

## 1. Chuẩn bị từng thư mục (một lần cho mỗi tiệm)

```bash
cd /home/tinchi/claude-pos
npm ci
npm run build
```

Phần mềm dùng `node:sqlite` nên **Node phải từ 22 trở lên** — kiểm bằng `node -v`.

## 2. Thử chạy tay

```bash
cd /home/tinchi/claude-pos
PORT=5165 npm start
```

Màn hình phải in ra địa chỉ `http://…:5165` và dòng hướng dẫn cài chứng chỉ cho điện
thoại. Xem xong nhấn `Ctrl+C`.

## 3. Cho chạy sẵn mỗi khi bật Pi

Khai cổng cho từng tiệm, để ngoài thư mục mã nguồn cho khỏi lẫn vào git:

```bash
for u in laclacboy:5175 tinchi:5165 nhatran:5155 kimngan:5145; do
  echo "PORT=${u#*:}" | sudo tee /etc/default/claude-pos-${u%:*}
done
```

Một khuôn dịch vụ dùng chung cho cả bốn — `%i` chính là tên người dùng:

```bash
sudo tee /etc/systemd/system/claude-pos@.service > /dev/null <<'EOF'
[Unit]
Description=POS Thanh Hoa - tiem %i
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=/home/%i/claude-pos
EnvironmentFile=/etc/default/claude-pos-%i
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now claude-pos@laclacboy claude-pos@tinchi claude-pos@nhatran claude-pos@kimngan
```

Xem một tiệm chạy ra sao / xem nhật ký đang chạy:

```bash
systemctl status claude-pos@tinchi
journalctl -u claude-pos@tinchi -f
```

**Hai chỗ hay vấp:**

- `ExecStart` phải là đường dẫn **tuyệt đối** tới node. Kiểm bằng
  `readlink -f $(which node)`. Nếu ra `/home/…/.nvm/…` thì systemd không thấy được —
  cài Node hệ thống (NodeSource) rồi sửa lại dòng đó cho đúng.
- `WorkingDirectory` sai một chữ là tiệm này ghi vào sổ của tiệm khác. Soát ở bước 4.

## 4. Soát lại ngay sau khi bật — đừng bỏ qua

```bash
for p in 5175 5165 5155 5145; do
  echo -n "$p -> "; curl -s localhost:$p/api/system-info | head -c 90; echo
done
```

Mỗi dòng phải chỉ đúng `/home/<đúng người>/claude-pos/data/pos.db`.

> **Hai cổng cùng trỏ vào một file nghĩa là một tiệm đang ghi vào sổ của tiệm khác.**
> Tắt ngay rồi sửa `WorkingDirectory`, đừng để chạy tiếp một phút nào.

Xem cổng nào đang mở: `ss -ltnp | grep -E ':(51|61)[0-9]{2}'`

## 5. Điện thoại của từng tiệm

Mỗi tiệm tự dựng **chứng chỉ gốc riêng** trong `data/tls` của mình, không dùng chung.
Điện thoại của tiệm nào thì:

1. mở `http://<ip-pi>:<cổng tiệm đó>/dien-thoai` rồi cài chứng chỉ (một lần duy nhất);
2. từ đó bán hàng ở `https://<ip-pi>:<cổng đó + 1000>` — có HTTPS thì camera quét mã
   vạch mới chạy được.

Ví dụ tiệm Tín Chi: cài ở `:5165/dien-thoai`, dùng ở `:6165`. Ai làm cả hai tiệm thì cài
hai chứng chỉ, không sao.

## 6. Cập nhật mã — làm **từng tiệm một**

```bash
cd /home/tinchi/claude-pos
mkdir -p ~/saoluu-$(date +%F)
cp -a data/pos.db data/pos.db-wal data/pos.db-shm ~/saoluu-$(date +%F)/
git pull
npm ci
npm run build
sudo systemctl restart claude-pos@tinchi
```

Khởi động lại là **cơ sở dữ liệu tự nâng cấp cấu trúc**, nên sao lưu trước rồi hãy
restart. Xong một tiệm thì soát lại `/api/system-info` và mở thử màn hình bán hàng của
tiệm đó, rồi mới sang tiệm kế — hỏng thì biết ngay là hỏng ở đâu.

## 7. Vài điều nên biết trên Pi 4

- Bốn tiến trình Node, mỗi cái cỡ 120–200 MB. Pi 4 GB trở lên thoải mái; bản 2 GB nên
  bật zram.
- `npm ci` mỗi thư mục tốn khoảng 300 MB, bốn tiệm hơn 1 GB thẻ nhớ — chưa kể dữ liệu
  và ảnh hàng hoá.
- SQLite ghi liên tục xuống thẻ: nên chạy trên SSD/USB tốt, và hẹn giờ sao lưu `data/`
  ra ổ ngoài.
- **Đừng mở cổng 51xx hay 61xx ra Internet.** Cần dùng từ xa thì đi đường VPN
  (WireGuard, Tailscale).
- Đặt IP tĩnh cho Pi, để điện thoại khỏi phải dò lại địa chỉ mỗi khi router cấp IP mới.
