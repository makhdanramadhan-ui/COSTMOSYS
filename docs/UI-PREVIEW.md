# Antarmuka dan preview COSTMOSYS

COSTMOSYS (Cow Stress Monitoring System) menampilkan kondisi Kandang A, status sprinkler, konfigurasi kontrol, tren sensor, dan administrasi akun sesuai izin pengguna. Nama COSTMOSYS hanya mengubah merek antarmuka; proyek Firebase `smartcow-de25f`, domain Hosting, ID perangkat, path RTDB, dan namespace JavaScript tetap dipertahankan agar akses yang sudah berjalan tidak terputus. THI tetap indikator lingkungan agregat, bukan diagnosis stres atau kesehatan sapi.

Antarmuka memakai identitas slate dan oranye yang sama dengan situs yang sudah berjalan (font sistem, ikon SVG inline, ilustrasi Kandang A lokal) dalam dua tema, terang dan gelap. Merek COSTMOSYS berada di bilah atas, di samping tombol menu. Warna selalu disertai label, satuan, batas nilai, dan status data.

## Preview lokal

Dari root repositori, jalankan:

```sh
node scripts/preview.cjs
```

Buka `http://127.0.0.1:8765` dan hentikan server dengan Ctrl+C. Server hanya melayani aset web yang diizinkan; firmware, direktori Git, dan konfigurasi privat tidak dapat diakses melalui server ini. Request tulis ke server preview ditolak.

Preview lokal tetap memakai backend Firebase asli. SDK dan login membutuhkan internet. Jika domain tidak diizinkan, periksa Authorized domains pada Firebase Authentication dan gunakan `http://localhost:8765` sesuai konfigurasi proyek. Jangan menonaktifkan autentikasi atau melonggarkan Database Rules.

**Perintah pada dashboard bukan simulasi.** Setelah login, perubahan mode, ON/OFF manual, dan Simpan Pengaturan dapat mengubah kontrol perangkat asli. Jangan mencoba tombol tersebut pada instalasi yang sedang mengoperasikan beban hanya untuk memeriksa tampilan.

### Preview sintetis (tanpa risiko kontrol)

```sh
node scripts/preview-synthetic.cjs
```

Buka `http://127.0.0.1:8766`. Server mengganti jembatan Firebase dengan simulasi lokal; tidak ada login, telemetry, atau perintah ke Firebase maupun perangkat. Content-Security-Policy memblokir request keluar. Halaman ditandai **DATA SINTETIS**, dan hasil simpan menyebut simulasi lokal, bukan penyimpanan Firebase.

Parameter `herd` memilih umpan aktivitas sintetis: `empty` (default), `fresh`, `stale`, atau `error`. `authDelay` (ms) menunda pemulihan sesi dan `sdkDelay` (ms) menunda pemuatan `js/firebase.js` agar keadaan memuat dapat diperiksa. Bagian Aktivitas Sapi dan Kondisi Sapi memberi label **DATA SINTETIS** pada umpan ini.

Parameter `scenario` memilih `live`, `hot`, `cycle`, `cooldown`, `quota`, `time-unavailable`, `version2`, `stale`, `unknown`, `partial`, `thi`, `manual`, `viewer`, `operator`, `noaccess`, `disabled`, atau `login`. `burst` mengatur jumlah titik awal grafik; `interval` mengatur milidetik antar laporan. Untuk pemeriksaan waktu deterministik, buka `?scenario=cycle&clock=fixed&burst=0`, lalu gunakan `SCS_SYNTHETIC.advance(seconds)` pada konsol preview. Jam sintetis dimulai pukul 10:30 WIB: semprot 10 menit, berhenti 10:40, lalu cooldown 120 menit hingga 12:40. Mulai otomatis keempat diblokir setelah tiga mulai. Fungsi ini hanya tersedia melalui jembatan sintetis. Data contoh bukan bukti kondisi kandang.

## Sesi dan akses

Saat halaman dibuka, kerangka dashboard yang sama (sidebar, bilah atas, kartu) langsung tampil dalam keadaan `data-state="loading"`, `aria-busy="true"`, dan `inert`, tanpa kartu pemuatan layar penuh. Logo sidebar beranimasi halus; dengan preferensi reduced motion animasi dihentikan. Kartu tidak memuat nilai tersimpan, status koneksi menampilkan MENGHUBUNGKAN, dan semua tombol perangkat, pengaturan, serta admin tetap nonaktif sampai sesi, izin, dan telemetry terkini terverifikasi. Pengguna tanpa sesi lalu melihat halaman masuk; pengguna dengan sesi dan izin valid kembali ke dashboard. Jika pemeriksaan gagal, catatan galat kecil tampil dengan tombol muat ulang, tanpa membuka data privat. Memuat dibedakan dari data lama: lencana OFFLINE / DATA LAMA hanya muncul setelah telemetry pertama diterima.

Logout menutup popup serta membersihkan pembacaan dan data akun. Perubahan izin membangun ulang subscription dan tampilan sesuai akses terbaru. Pemeriksaan di browser tidak menggantikan penegakan izin oleh Firebase Rules. Detail pengelolaan akun ada di [Admin dan User](ADMIN-USER.md).

## Navigasi dan monitoring

Navigasi halaman memakai sidebar yang dibuka dengan tombol menu; sidebar dimulai tertutup dan inert, kecuali pada keadaan memuat di layar lebar. Popup rincian sensor mengikuti pembacaan terbaru, dapat ditutup dengan tombol, Escape, atau klik di luar, lalu mengembalikan fokus ke pemicunya; pada ponsel popup tampil sebagai lembar bawah.

Ringkasan menampilkan kartu suhu, kelembapan, dan THI. Kartu suhu memuat indikator hijau/oranye/merah dari threshold Suhu tersimpan, dan penanda threshold grafik berupa garis putus-putus sederhana tanpa ikon sinyal. Hijau berarti T < threshold − 1 °C, oranye threshold − 1 °C ≤ T < threshold, merah T ≥ threshold. Rentang oranye hanya penanda mendekati threshold, bukan batas mati, diagnosis kesehatan, atau keputusan relay. Threshold hanya syarat mulai; siklus berjalan sesuai durasi, dengan penghentian dini untuk pengaman sensor atau penutupan jadwal. Draft tidak mengubah indikator terapan. Data parsial, kedaluwarsa, atau dasar Suhu tidak aktif tidak diberi penanda zona aktif.

## Kondisi Sapi dan Aktivitas Sapi

Ringkasan memuat empat saluran bukti terpisah di bawah judul **Kondisi Sapi**. Saluran tidak dijumlahkan menjadi skor, label stres empat tingkat, atau diagnosis:

1. **Paparan panas kandang**: suhu rata-rata dan THI dari sensor yang masih terkini, dibandingkan dengan threshold terapan. Menggambarkan lingkungan, bukan respons sapi.
2. **Postur teramati**: cakupan pengamatan per zona dari umpan herd, dengan umur umpan.
3. **Konteks orang**: jumlah sampel yang memuat kotak orang. Nol atau tidak ada data berarti tidak diketahui, bukan tidak ada orang.
4. **Sprinkler dan cooldown**: status, fase siklus, dan hitungan harian dari laporan perangkat.

Halaman **Aktivitas Sapi** (sidebar) menampilkan durasi postur teramati per zona kamera (berdiri, berbaring, campuran, sebagian teramati, kurang terlihat, celah), cakupan pengamatan, alasan kurang terlihat, dan catatan kualitas umpan (tengah malam tanpa bukti waktu, jendela tumpang tindih, rekaman tidak valid). Zona tidak dijumlahkan, tidak diekstrapolasi ke 24 jam, dan bukan jam berdiri satu sapi. Pembaca `SCSHerd.view` dan kontraknya dijelaskan di [HERD-TELEMETRY.md](HERD-TELEMETRY.md).

Keadaan umpan: memeriksa, kosong (belum ada penerbit; netral, bukan Normal), tidak terbaca, lama (lebih dari 24 jam), dan terkini. Umpan hanya dapat dibaca akun dengan izin Monitoring. Belum ada penerbit umpan; tampilan tetap kosong sampai kredensial penulis dipasang di luar repositori.

Bagian konfigurasi dan tren memakai lebar konten yang sejajar. Pada layar sempit, input dan jadwal mengalir ke bawah tanpa mengecilkan teks. Fokus keyboard, batas kontrol, forced colors, dan preferensi reduced motion tetap diperhatikan.

## Pengaturan dan administrasi

Ringkasan dan garis threshold pada grafik mengikuti dasar kontrol yang sudah tersimpan. Mengedit draft atau berpindah pilihan sebelum menyimpan tidak mengubah threshold terapan. Pembacaan pada dasar lain tetap tersedia untuk monitoring tanpa perbandingan threshold yang tidak relevan. Jika konfigurasi belum dimuat, threshold tidak ditampilkan seolah sudah diketahui.

Pengaturan kebijakan 3 menampilkan Durasi semprot dan Cooldown dalam menit, termasuk cooldown 120 menit. Data kontrol dikirim dalam detik: 10 menit menjadi 600 detik, 120 menit menjadi 7200 detik. Maksimal semprot per hari menghitung mulai otomatis pada perangkat per hari WIB, dipakai bersama profil Suhu/THI, pilihan waktu operasi, dan pergantian mode. Mengubah profil tidak menghapus hitungan. Manual tidak termasuk batas harian otomatis dan tetap menyala sampai dimatikan.

Semua input pengaturan dan tombol Simpan terkunci jika konfirmasi firmware kebijakan 3 tidak tersedia atau telemetry tidak terbaru. Tidak ada penurunan otomatis ke kebijakan lama. Status siklus, sisa semprot/cooldown, tanggal WIB, dan jumlah mulai dibaca dari laporan perangkat, bukan penghitung browser. Cooldown dimulai sejak sprinkler benar-benar mati. Saat waktu perangkat tidak valid, mulai otomatis diblokir dan tanggal browser tidak dipakai untuk mengarang kuota. Nilai yang hilang ditampilkan sebagai belum diketahui, bukan nol atau siap.

Dashboard Admin memisahkan form pembuatan akun, kartu akun yang sedang login, dan daftar akun. Kartu User menyediakan tindakan pengaturan izin, aktivasi, dan penghapusan akses setelah konfirmasi. Admin baru memperoleh seluruh izin; Admin yang sudah ada tidak dapat diedit atau dihapus dari dashboard. Penghapusan akses aplikasi tidak sama dengan penghapusan identitas Firebase Auth.

Kartu anggota memakai permukaan berbeda dari panel induk pada kedua tema. Informasi dan kontrol tetap disusun menurut urutan baca dan Tab, bukan hanya menurut posisi visual. Akun yang tampil pada kartu sesi diambil dari sesi aktif, bukan akun pertama dalam direktori.

## Publikasi aset web

Hosting memakai aset dari allowlist, bukan seluruh direktori proyek. Siapkan salinan aset sebelum deployment:

```sh
node scripts/prepare-hosting.cjs
firebase deploy --only hosting,database --project smartcow-de25f
```

Perintah kedua memperbarui Hosting dan Database Rules pada proyek Firebase asli. Jalankan hanya untuk publikasi yang memang diotorisasi. Firmware, secret lokal, dan file konfigurasi login lama tidak ikut disalin. Deploy tidak menulis telemetry atau control perangkat. Perubahan aturan akses harus dilakukan melalui generator `scripts/build-rules.cjs` dan diuji sebelum diterbitkan.

## Pengujian

```sh
node --test test/*.test.js
node test/ui-herd-browser.cjs   # preview sintetis 8766 harus berjalan
node test/ui-browser.cjs
```

Tes preview memeriksa gerbang sesi, aset yang tersedia, serta penolakan akses ke firmware dan konfigurasi privat; tes preview sintetis memastikan penanda, pemblokiran request keluar, dan jembatan tanpa URL Firebase. Tes rendering memeriksa threshold tersimpan versus draft, data hilang, dan garis grafik. Logika THI, kontrol, serta izin memiliki pemeriksaan terpisah. Pengujian Rules dan bridge SDK menggunakan proyek emulator demo sebagaimana dijelaskan dalam panduan Admin dan User.

Riwayat perubahan antarmuka tersedia melalui commit Git. Hasil tes otomatis tidak membuktikan kinerja perangkat, aksesibilitas formal, atau keselamatan instalasi. Jangan mempublikasikan backup lokal yang dapat memuat konfigurasi atau kredensial privat.
