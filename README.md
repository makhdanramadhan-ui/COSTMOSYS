# COSTMOSYS

COSTMOSYS (Cow Stress Monitoring System) adalah proyek pemantauan lingkungan kandang dan pengendalian sprinkler yang menggabungkan perangkat embedded, komunikasi nirkabel, Firebase, serta dashboard web. Pengembangannya juga mencakup computer vision untuk mengenali postur sapi dan keberadaan orang dari CCTV.

Pengerjaannya tidak berhenti pada menampilkan angka sensor. Sistem perlu membedakan pembacaan terkini dari data yang kedaluwarsa, menjalankan kontrol perangkat tanpa bergantung pada browser, dan membatasi kewenangan pengguna saat mengubah pengaturan atau mengoperasikan sprinkler.

Repositori ini memuat aplikasi web, firmware ESP32, aturan akses database, dan pengujiannya. Kode training, bobot, serta evaluasi computer vision dikelola dalam [repositori Machine Learning COSTMOSYS YOLO26n](https://github.com/makhdanramadhan-ui/Machine-Learning-COSTMOSYS-YOLO26n).

## Arsitektur sistem

Dua ESP32 membagi pembacaan enam DS18B20 dan empat DHT22. ESP kiri mengirim hasil pengukuran melalui ESP-NOW; ESP kanan menggabungkannya dengan sensor lokal, menjalankan kebijakan kontrol, mengoperasikan SSR, dan bertukar data dengan Firebase. Dashboard membaca telemetry serta mengirim konfigurasi dan perintah melalui Realtime Database.

| Lapisan | Implementasi | Tanggung jawab |
|---|---|---|
| Perangkat | ESP32, DS18B20, DHT22, SSR | Pengukuran, validasi sensor, dan kontrol sprinkler |
| Komunikasi lokal | ESP-NOW | Pengiriman sampel antar-board dengan ACK, sequence, dan retry |
| Layanan data | Firebase Realtime Database dan Authentication | Telemetry, konfigurasi, status, identitas, dan izin akses |
| Dashboard | HTML, CSS, JavaScript | Monitoring, grafik, pengaturan, operasi manual, dan administrasi akun |
| Computer vision | YOLO26n, Ultralytics, PyTorch, OpenCV, Roboflow | Pengolahan CCTV dan deteksi objek, dikembangkan terpisah |

Arsitektur ini memisahkan antarmuka pengguna dari keputusan relay. Browser tidak menjalankan timer otomatis atau mengirim perintah OFF atas nama perangkat. Setelah konfigurasi diterima, ESP kanan dapat melanjutkan kontrol lokal ketika internet terputus, selama persyaratan sensor dan waktu masih terpenuhi.

## Keputusan teknis

### Pembacaan yang bisa dipercaya

Setiap kanal memiliki informasi validitas dan usia sampel. Angka terakhir yang masih tersimpan tidak langsung dianggap sebagai kondisi terkini. Dashboard mempertahankan posisi enam kartu suhu dan empat kartu kelembapan saat sensor terputus, menandai data yang tidak tersedia, dan tidak menganggap relay offline sebagai relay OFF.

Konversi DS18B20 dijadwalkan tanpa menahan seluruh loop selama menunggu hasil. Firmware kanan memisahkan pekerjaan HTTP/TLS ke task tersendiri dan bertukar snapshot melalui queue. Pembacaan serta keputusan kontrol tidak perlu menunggu satu siklus permintaan jaringan selesai.

### Kebijakan kontrol pada perangkat

Kontrol otomatis dapat memakai rata-rata suhu enam DS18B20 atau THI agregat dari suhu DS dan kelembapan empat DHT22. Kedua dasar kontrol memiliki profil terpisah untuk threshold, hysteresis, durasi maksimum, cooldown, dan hingga enam jadwal bertanggal dalam WIB.

Jadwal diperlakukan sebagai jendela izin operasi, bukan perintah paksa ON. Threshold dan seluruh pengaman tetap diperiksa di dalamnya. Auto suhu membutuhkan keenam DS valid dan fresh; auto THI membutuhkan seluruh enam DS dan empat RH. Ketika input yang diwajibkan tidak memenuhi syarat, relay otomatis OFF.

Pengaturan pada dashboard dipisahkan antara draft dan konfigurasi terapan. Berpindah profil tidak langsung mengubah kontrol; pengaturan baru diterapkan setelah disimpan. Mode manual memiliki perilaku tersendiri: ON bertahan sampai perintah OFF, termasuk ketika internet terputus, tanpa batas durasi dan cooldown otomatis.

### Izin akses yang ditegakkan di database

Firebase Authentication memeriksa identitas, sementara Database Rules membatasi akses berdasarkan record pengguna. Izin Monitoring, Pengaturan, dan Operasi sprinkler dibedakan hingga tingkat field. Menyembunyikan tombol di browser bukan satu-satunya pengaman; aturan yang sama berlaku untuk permintaan API langsung.

Pembuatan akun memakai instance Auth terpisah agar sesi Admin tidak terganti. Penghapusan akses aplikasi dibedakan dari penghapusan identitas Firebase Auth. Akun Admin yang sudah ada tidak dapat diubah atau dihapus melalui dashboard, dan pencabutan izin tidak diam-diam mengubah keadaan sprinkler.

## Dashboard

Antarmuka berbahasa Indonesia menampilkan ringkasan suhu, kelembapan, THI, status sprinkler, serta rincian tiap kanal. Grafik, riwayat hingga 120 baris, ekspor CSV, dan catatan aktivitas membantu pemeriksaan pembacaan dan tindakan perangkat. THI digunakan sebagai indikator lingkungan agregat, bukan diagnosis kondisi sapi.

Dashboard dibangun tanpa framework UI, dengan tema terang/gelap, navigasi responsif, popup rincian sensor, dan dukungan reduced motion. Penanganan sesi menunggu pemulihan identitas serta izin sebelum membuka konten privat. Logout atau perubahan akses membersihkan data tampilan dan subscription terkait.

Publikasi web menggunakan allowlist aset melalui `scripts/prepare-hosting.cjs`. Firmware, konfigurasi privat, dan berkas pengembangan tidak ikut diterbitkan. Alamat Hosting proyek: [smartcow-de25f.web.app](https://smartcow-de25f.web.app).

## Computer vision untuk CCTV

Pengembangan ML menggunakan YOLO26n untuk mendeteksi `cow_standing`, `cow_lying`, dan `person`. Frame dipilih dari rekaman CCTV berdasarkan kualitas serta keragaman waktu, kemudian dilabeli otomatis melalui Roboflow. Sebanyak 999 gambar dibagi berdasarkan sesi rekaman menjadi 599 training, 152 validasi, dan 248 test.

Model di-fine-tune melalui Ultralytics dan PyTorch menggunakan CPU. Evaluasi pada test set menghasilkan mAP50 0.858 dan mAP50-95 0.551. Angka ini menunjukkan kesesuaian dengan label otomatis Roboflow, bukan akurasi operasional di kandang. Pengujian inferensi juga mencakup satu video penuh sekitar 28 menit dengan prediksi setiap frame.

Jalur CCTV dijalankan pada komputer atau server, bukan ESP32. Hasilnya belum dihubungkan ke Firebase atau dashboard dalam repositori ini. Pelacakan identitas sapi dan perhitungan durasi berdiri/berbaring per individu juga belum divalidasi; postur berbaring tidak otomatis berarti tidur.

Detail dataset, konfigurasi training, bobot `best.pt`, contoh label versus prediksi, dan hasil evaluasi tersedia di [Machine Learning COSTMOSYS YOLO26n](https://github.com/makhdanramadhan-ui/Machine-Learning-COSTMOSYS-YOLO26n). Dataset serta video penuh tidak diduplikasi di sini.

## Pengujian dan status pengembangan

Tes aplikasi mencakup perhitungan suhu/THI, freshness sensor, profil kontrol, jadwal bersyarat, izin akun, dan server preview. Pengujian Rules memakai emulator Auth/Realtime Database pada proyek demo terpisah, bukan data produksi. Generator Rules menyediakan pemeriksaan agar konfigurasi hasil generasi tetap sesuai sumbernya.

Firmware FINAL sebelumnya berhasil dikompilasi pada Arduino-ESP32 2.0.17 dengan library sensor dan ArduinoJson yang dicatat dalam panduan firmware. Callback core 3.x tersedia, tetapi kompilasi pada core tersebut belum diverifikasi. Pengujian perangkat fisik, ketepatan sensor, jangkauan radio, dan keselamatan instalasi tetap perlu dilakukan di lokasi.

COSTMOSYS masih merupakan pilot. TLS firmware masih memakai `setInsecure()`, autentikasi perangkat menggunakan Database Secret legacy, dan ESP-NOW belum dienkripsi. Pengaturan juga belum persisten setelah reboot. Batas tersebut tidak disamakan dengan kesiapan produksi atau jaminan keselamatan.

## Dokumentasi teknis

| Dokumen | Isi |
|---|---|
| [Firmware dua ESP32](firmware/smart-cow-sprinkler-firebase/README-DUA-ESP.md) | Wiring, library, pairing, upload, kontrak data, kebijakan relay, dan checklist perangkat |
| [Admin dan User](docs/ADMIN-USER.md) | Peran, izin, pengelolaan akun, Database Rules, dan pengujian emulator |
| [Antarmuka dan preview](docs/UI-PREVIEW.md) | Menjalankan dashboard lokal, perilaku sesi, dan pengujian antarmuka |
| [Integrasi data](docs/INTEGRATION.md) | Jalur telemetri ke dashboard, freshness, dan bukti emulator |
| [Spesifikasi produk](PRODUCT.md) | Cakupan fitur dan batas pengoperasian |
| [Istilah proyek](CONTEXT.md) | Definisi istilah pengukuran dan kontrol |
| [Model YOLO26n](https://github.com/makhdanramadhan-ui/Machine-Learning-COSTMOSYS-YOLO26n) | Dataset, training, bobot, dan evaluasi ML |

Instalasi SSR dan solenoid 220 V harus ditangani orang kompeten, dengan pengujian awal tanpa beban AC. Jangan menyimpan password atau Database Secret dalam repositori publik; kredensial yang pernah terekspos perlu dirotasi.
