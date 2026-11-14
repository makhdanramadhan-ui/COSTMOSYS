# COSTMOSYS

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pengelola kandang menggunakan dashboard melalui ponsel atau komputer untuk membaca kondisi lingkungan dan mengoperasikan sprinkler. Admin mengelola akses akun; User memperoleh izin Monitoring, Pengaturan, dan Operasi sprinkler sesuai tugasnya.

## Product Purpose

COSTMOSYS (Cow Stress Monitoring System) menghubungkan pembacaan enam DS18B20 dan empat DHT22 dengan kontrol sprinkler pada dua ESP32. Dashboard menampilkan suhu, kelembapan, THI, dan status perangkat. Pengguna dapat memilih kontrol otomatis berdasarkan suhu atau THI, atau mengoperasikan relay secara manual.

## Positioning

Pemantauan lingkungan, konfigurasi sprinkler, dan riwayat pembacaan tersedia dalam satu dashboard. Keputusan relay tetap dijalankan ESP kanan, bukan browser. THI merupakan indikator lingkungan agregat, bukan diagnosis kondisi sapi.

## Operating Context

Sistem ditujukan untuk pilot di kandang dengan koneksi yang dapat terputus. Pengguna memeriksa pembacaan dan status, menyimpan profil kontrol, serta meninjau riwayat atau mengunduh CSV. Data perangkat yang tidak tersedia atau kedaluwarsa ditandai secara eksplisit; aplikasi tidak menggantinya dengan data simulasi.

## Capabilities and Constraints

- ESP kiri membaca tiga DS18B20 dan dua DHT22, lalu mengirim hasil melalui ESP-NOW. ESP kanan membaca sensor lokal dengan jumlah yang sama, menggabungkan data, mengoperasikan SSR GPIO23, dan berkomunikasi dengan Firebase.
- Setiap DS menggunakan jalur DATA terpisah pada GPIO4/14/18. DHT memakai GPIO19/25 di masing-masing board. Pin dan pull-up dijelaskan dalam panduan firmware.
- Rata-rata suhu hanya memakai DS18B20. THI memakai rata-rata enam DS dan rata-rata empat RH, bukan suhu DHT.
- Profil Suhu dan THI menyimpan threshold, hysteresis, durasi maksimum, cooldown, dan hingga enam jadwal bertanggal WIB secara terpisah. Perubahan draft diterapkan setelah pengguna menyimpan pengaturan.
- Jadwal merupakan jendela waktu yang tetap mensyaratkan threshold dan pengaman otomatis. Jadwal tidak memaksa relay ON.
- Auto suhu membutuhkan enam DS valid dan fresh; auto THI membutuhkan enam DS dan empat RH valid dan fresh. Input yang tidak lengkap membuat relay otomatis OFF.
- Manual ON bertahan sampai perintah OFF, termasuk saat koneksi internet terputus; batas durasi dan cooldown otomatis tidak berlaku pada mode manual.
- Firebase Realtime Database menyimpan telemetry, control, events, dan status. Firebase Authentication serta Database Rules mengatur akses dashboard. ESP kanan menggunakan Database Secret legacy yang harus dijaga secara terpisah.
- Antarmuka berupa HTML, CSS, dan JavaScript tanpa build framework. Jalankan melalui server HTTP; SDK Firebase dan login membutuhkan internet. Waktu ditampilkan dalam WIB, dengan riwayat hingga 120 baris dan ekspor CSV.
- Beban solenoid AC 220 V memerlukan SSR, isolasi, dan instalasi yang sesuai. Uji tanpa beban AC terlebih dahulu; pengerjaan kelistrikan harus dilakukan orang kompeten.

## Brand Commitments

Nama produk: COSTMOSYS (Cow Stress Monitoring System). Antarmuka menggunakan Bahasa Indonesia, suhu dalam °C, kelembapan dalam %RH, dan waktu WIB. Tidak ada klaim pelanggan, keberhasilan mengurangi stres panas, atau hasil lapangan yang belum dibuktikan.

## Evidence on Hand

Dashboard tersedia di `index.html`, `css/style.css`, dan `js/`. Firmware aktif berada di folder `espkanan_FINAL` dan `espkiri_FINAL`; varian lama dipertahankan terpisah. Tes Node.js memeriksa logika dan kontrak aplikasi, sedangkan pengujian Rules memakai emulator lokal. Hasil kompilasi dan checklist perangkat ada dalam panduan firmware; keduanya tidak menggantikan pengujian fisik di kandang.

## Product Principles

1. Bedakan pembacaan valid, data kedaluwarsa, dan status perangkat yang belum diketahui.
2. Jalankan pengaman otomatis pada perangkat, terpisah dari sesi dashboard.
3. Pisahkan izin membaca data, menyimpan pengaturan, dan mengoperasikan sprinkler.
4. Pertahankan riwayat dan status yang dapat diperiksa tanpa mengarang data perangkat.
5. Utamakan keselamatan pemasangan dan kejelasan perilaku manual maupun otomatis.

## Accessibility & Inclusion

Dashboard perlu terbaca pada ponsel di area kandang, dengan angka yang jelas, kontrol yang dapat dijangkau, fokus keyboard terlihat, dan status yang tidak bergantung pada warna saja. Tema terang/gelap, tampilan responsif, dan preferensi reduced motion dipertahankan. Pengujian antarmuka tidak dianggap sebagai sertifikasi aksesibilitas formal.
