# Istilah SmartCow

Istilah berikut digunakan pada dashboard dan panduan pengoperasian kandang.

## Titik suhu

Lokasi pengukuran suhu kandang. Sistem membaca enam titik dengan DS18B20; posisi fisiknya ditentukan saat pemasangan.

## Rata-rata kandang

Rata-rata suhu dari titik yang valid dan masih baru. Kontrol otomatis berbasis suhu membutuhkan keenam titik dalam kondisi tersebut.

## Kelembapan relatif

Kandungan uap air relatif terhadap kondisi jenuh, ditampilkan dalam %RH. Empat titik kelembapan digunakan untuk menghitung rata-rata kandang.

## THI

Temperature-Humidity Index, indikator lingkungan yang menggabungkan suhu dan kelembapan. SmartCow memakai rata-rata enam titik suhu dan empat titik kelembapan. Nilai ini bukan diagnosis stres panas pada sapi.

## Dasar kontrol

Pilihan besaran yang mengendalikan sprinkler: suhu atau THI. Keduanya memiliki profil pengaturan tersendiri; hanya profil terpilih yang digunakan.

## Threshold

Batas nilai yang mengizinkan sprinkler mulai menyala dalam mode otomatis, selama syarat sensor dan pengaman lain terpenuhi.

## Hysteresis

Selisih di bawah threshold untuk mematikan sprinkler, agar relay tidak berulang kali hidup dan mati ketika pembacaan berada di sekitar batas.

## Cooldown

Jeda setelah sprinkler berhenti sebelum siklus otomatis berikutnya dapat dimulai.

## Jadwal semprot

Jendela waktu bertanggal dalam WIB yang membatasi kapan kontrol otomatis boleh bekerja. Jadwal tidak memaksa sprinkler menyala: threshold, kelengkapan pembacaan, durasi maksimum, dan cooldown tetap berlaku.

## Override manual

Perintah pengguna untuk mengoperasikan sprinkler dalam mode manual. ON bertahan sampai perintah OFF; proteksi durasi dan cooldown otomatis tidak diterapkan pada mode ini.

## Data kedaluwarsa

Pembacaan yang sudah melewati batas usia penggunaan. Angka terakhir mungkin masih tersedia, tetapi tidak boleh dianggap sebagai kondisi terkini.

## Event

Catatan perubahan atau tindakan pada sistem, seperti sprinkler menyala, berhenti, atau pengaturan diperbarui.
