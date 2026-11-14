# Antarmuka dan preview COSTMOSYS

COSTMOSYS (Cow Stress Monitoring System) menampilkan kondisi Kandang A, status sprinkler, konfigurasi kontrol, tren sensor, dan administrasi akun sesuai izin pengguna. Nama COSTMOSYS hanya mengubah merek antarmuka; proyek Firebase `smartcow-de25f`, domain Hosting, ID perangkat, path RTDB, dan namespace JavaScript tetap dipertahankan agar akses yang sudah berjalan tidak terputus. THI tetap indikator lingkungan agregat, bukan diagnosis stres atau kesehatan sapi.

Tampilan memakai tema terang/gelap dan layout responsif tanpa library UI, font, atau ikon eksternal; ikon berupa SVG inline. Permukaan datar berbatas tipis menggantikan bayangan lunak, dengan aksen jingga untuk suhu, biru untuk kelembapan, dan hijau untuk THI. Status juga disampaikan melalui teks, bukan warna saja. Badge koneksi, status sprinkler, dan nilai kosong membedakan terhubung, offline atau data lama, belum diketahui, dan belum tersedia.

## Preview lokal

Dari root repositori, jalankan:

```sh
node scripts/preview.cjs
```

Buka `http://127.0.0.1:8765` dan hentikan server dengan Ctrl+C. Server hanya melayani aset web yang diizinkan; firmware, direktori Git, dan konfigurasi privat tidak dapat diakses melalui server ini. Request tulis ke server preview ditolak.

Preview lokal tetap memakai backend Firebase asli. SDK dan login membutuhkan internet. Jika domain tidak diizinkan, periksa Authorized domains pada Firebase Authentication dan gunakan `http://localhost:8765` sesuai konfigurasi proyek. Jangan menonaktifkan autentikasi atau melonggarkan Database Rules.

**Perintah pada dashboard bukan simulasi.** Setelah login, perubahan mode, ON/OFF manual, dan Simpan Pengaturan dapat mengubah kontrol perangkat asli. Jangan mencoba tombol tersebut pada instalasi yang sedang mengoperasikan beban hanya untuk memeriksa tampilan.

## Sesi dan akses

Saat halaman dibuka, form login dan dashboard sama-sama tersembunyi sampai Firebase menyelesaikan pemulihan sesi. Pengguna tanpa sesi melihat halaman masuk; pengguna dengan sesi dan izin valid dapat langsung kembali ke dashboard. Jika pemeriksaan gagal, halaman menampilkan pesan pemulihan tanpa membuka data privat.

Logout menutup popup serta membersihkan pembacaan dan data akun. Perubahan izin membangun ulang subscription dan tampilan sesuai akses terbaru. Pemeriksaan di browser tidak menggantikan penegakan izin oleh Firebase Rules. Detail pengelolaan akun ada di [Admin dan User](ADMIN-USER.md).

## Navigasi dan monitoring

Sidebar dimulai tertutup. Pada desktop, pembukaannya menggeser area konten; pada ponsel, navigasi memakai drawer dan overlay. Popup rincian sensor mengikuti pembacaan terbaru, dapat ditutup dengan tombol, Escape, atau klik di luar, lalu mengembalikan fokus ke pemicunya.

Overview mendahulukan status relay dan mode operasi sebelum ringkasan sensor. Rincian enam DS dan empat DHT tersedia dari kartu masing-masing. Label Titik terendah dan Titik tertinggi merujuk pembacaan terkini, bukan rekor harian. Sapaan mengikuti identitas akun yang tersedia, dengan nama cadangan Pengelola.

Bagian konfigurasi dan tren memiliki lebar konten yang sejajar. Container query mengikuti lebar panel sebenarnya, termasuk saat sidebar terbuka. Pada layar sempit, input dan jadwal mengalir ke bawah tanpa mengecilkan teks. Fokus keyboard, batas kontrol, forced colors, dan preferensi reduced motion tetap diperhatikan.

## Pengaturan dan administrasi

Ringkasan dan garis threshold pada grafik mengikuti dasar kontrol yang sudah tersimpan. Mengedit draft atau berpindah pilihan sebelum menyimpan tidak mengubah threshold terapan. Pembacaan pada dasar lain tetap tersedia untuk monitoring tanpa perbandingan threshold yang tidak relevan. Jika konfigurasi belum dimuat, ambang tidak ditampilkan seolah sudah diketahui.

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
node --test test/core.test.js test/telemetry.test.js test/control.test.js test/preview.test.js test/ui-threshold.test.js test/access.test.js
node scripts/build-rules.cjs --check
```

Tes preview memeriksa gerbang sesi, aset yang tersedia, serta penolakan akses ke firmware dan konfigurasi privat. Tes rendering memeriksa threshold tersimpan versus draft, data hilang, dan garis grafik. Logika THI, kontrol, serta izin memiliki pemeriksaan terpisah. Pengujian Rules dan bridge SDK menggunakan proyek emulator demo sebagaimana dijelaskan dalam panduan Admin dan User.

Riwayat perubahan antarmuka tersedia melalui commit Git. Hasil tes otomatis tidak membuktikan kinerja perangkat, aksesibilitas formal, atau keselamatan instalasi. Jangan mempublikasikan backup lokal yang dapat memuat konfigurasi atau kredensial privat.
