# Integrasi data, build, dan kesiapan lapangan

Produk: **COSTMOSYS**. Firebase project, database, dan device ID tetap historis:
`smartcow-de25f` dan `cow-sprinkler-01`. Repositori: `COSTMOSYS` dan
`Machine-Learning-COSTMOSYS-YOLO26n`. Ganti nama tidak mengubah path RTDB, rules, atau konfigurasi
Firebase mana pun.

Dokumen ini merangkum jalur data, bukti integrasi yang dapat dijalankan ulang, serta prosedur
kesiapan lapangan dan deployment. Kontrak field lengkap ada di
[firmware dua ESP32](../firmware/smart-cow-sprinkler-firebase/README-DUA-ESP.md).

## Jalur data

```text
ESP kanan (REST + Database Secret)
  devices/cow-sprinkler-01/telemetry/latest   -> js/firebase.js onValue -> js/telemetry.js view()
  devices/cow-sprinkler-01/telemetry/log      -> orderByChild('ts') limitToLast(120) -> logRow()
  devices/cow-sprinkler-01/events             -> orderByChild('ts') limitToLast(50) -> {t,msg}
  devices/cow-sprinkler-01/control            -> js/control.js fromFirebase()
Dashboard (Auth user)                          -> hanya baca telemetri/status; tulis control + events
```

`telemetry/latest` tidak memiliki rule `.write`: klien web tidak dapat menulis telemetri. Firmware
menulis dengan Database Secret sehingga melewati Rules, dan tetap wajib menulis dokumen telemetri ke
root `telemetry/latest` dan `telemetry/log` (bukan alias `timestamp`/`measuredAt`/`relayOn`).

Freshness: `js/telemetry.js` memakai `now = Date.now() + .info/serverTimeOffset`, batas online
15 detik dari `ts` dan `measuredTs`, usia per kanal 3/7/10 detik. Snapshot lama tidak pernah
ditampilkan sebagai live; `ssr` menjadi `null` saat offline dan nilai lama tidak dipakai. Payload
dengan alias field lama ditolak parser dan tetap offline.

## Menjalankan bukti

```bash
node --test test/*.test.js          # parser, kontrol, UI statis, kontrak firmware
cd test/rbac && npm ci
npm run test                        # 231 pemeriksaan RBAC emulator (rules.cjs)
npm run test:integration            # 55 pemeriksaan jalur data (integration.cjs)
node ../../scripts/build-rules.cjs --check
```

`test:integration` menjalankan emulator database dengan `database.rules.json` asli, menulis payload
kanonik seperti firmware, lalu membaca sebagai akun monitor/settings/operate. Yang dibuktikan: izin
baca per peran dan penolakan tulis telemetri, parsing `SCSTelemetry.view` (online, 6 DS + 4 RH, THI,
relay, node kiri, fase siklus v3), kedaluwarsa 15 detik, penolakan alias field, query
`orderByChild('ts')` untuk log dan event, kontrak event `{type,reason,ts}` yang tidak dapat ditimpa,
serta round-trip profil kontrol v3 (`temp*` dan `thi*` tidak tercampur, kuota harian global, cooldown
hingga 86400 detik, tanpa hysteresis). Batas siklus yang diuji: mulai 10:30, berhenti 10:40,
cooldown 7200 detik sehingga 12:39 belum layak dan 12:40 layak; kuota bersama memblokir mulai
keempat; hari WIB baru hanya membuka kuota dari waktu perangkat tepercaya; snapshot setelah reboot
tetap membawa hari, kuota, dan cooldown tanpa menghitung ulang siklus yang terputus. Batas rules
yang diuji: kuota 1..100, durasi 1..10800 detik, cooldown 0..86400 detik, jadwal 1..180 menit,
enam slot, serta penolakan hysteresis dan key legacy. Semua memakai project `demo-*`; tidak ada
produksi.

Bukti serialisasi firmware saat ini tidak dapat dieksekusi: tidak ada test yang memeriksa sumber
serializer firmware, dan yang dapat dijalankan hanya sisi pembacaan dashboard (emulator di atas).
Tidak ada artefak firmware yang dapat dieksekusi: pencarian tidak menemukan `.pio`, `*.bin`, atau
`*.elf` untuk sketch ESP kanan di bawah `E:/Dataset ML IoT` (kedalaman 5) maupun folder field; cache
Arduino IDE di `C:` hanya berisi sketch lama (`espkiri`, `sketch_may*`); dan target xtensa tidak dapat
dijalankan di host. Bukti eksekusi serializer memerlukan instalasi library + compile, keduanya di luar
lingkup saat ini. Tidak ada klaim bahwa serializer firmware sudah diuji secara eksekusi.

## Jalur build, cache, dan temp (wajib di `E:`)

Terperiksa pada sesi ini:

| Komponen | Lokasi | Catatan |
|---|---|---|
| `arduino-cli` 1.5.1 | `E:/arduino-cli_1.5.1_Windows_64bit/arduino-cli.exe` | tidak ada di `PATH` |
| Config arduino-cli | `E:/arduino-data/arduino-cli.yaml` | `data`, `downloads`, `user` sudah di `E:` |
| Core ESP32 | `E:/arduino-data/data/packages/esp32/hardware/esp32/3.3.12` | terpasang |
| Library tersedia | `E:/arduino-data/sketches/libraries` | hanya `DHT_sensor_library_for_ESPx`, `LiquidCrystal_I2C` |
| PlatformIO Core 6.2.0 | `C:/Users/LyNx/.platformio` (2,1 GB, `.cache` 623 MB) | default `C:`, harus diarahkan ulang |
| Cache Arduino IDE | `C:/Users/LyNx/AppData/Local/arduino` (cores 22 MB, sketches 300 MB) | default `C:` |
| `TMP`/`TEMP` | `C:/Users/LyNx/AppData/Local/Temp` | default `C:` |

`ArduinoJson` 7, `OneWire`, dan `DallasTemperature` **belum terpasang** di `E:/arduino-data`, jadi
compile sketch field akan gagal sebelum tiga library itu diinstal ke `E:`. Build cache dan temp
belum diarahkan ke `E:`; untuk run berikutnya wajib menetapkan eksplisit:

```bash
# arduino-cli: data/download/user sudah di E:, tambahkan build path eksplisit
E:/arduino-cli_1.5.1_Windows_64bit/arduino-cli.exe --config-file E:/arduino-data/arduino-cli.yaml \
  compile --fqbn esp32:esp32:esp32 --build-path "E:/arduino-data/build/espkanan" \
  "F:/apaelah/TUGAS/smt5/IoT/Kodingan ESP/ESPKANAN"

# PlatformIO bila dipakai: pindahkan core dan temp, jangan biarkan di C:
PLATFORMIO_CORE_DIR=E:/platformio-core TMP=E:/platformio-core/tmp TEMP=E:/platformio-core/tmp pio run
```

Jangan menghapus cache lama di `C:` sebagai bagian dari pekerjaan ini; cukup arahkan run baru ke `E:`.

## Kesiapan lapangan (prosedur, belum dijalankan)

Firmware kanan: `F:/apaelah/TUGAS/smt5/IoT/Kodingan ESP/ESPKANAN/ESPkanan.ino` +
`ClimatePolicy.h`. Kedua berkas harus disalin bersama-sama; `ClimatePolicy.h` di folder field hanya
berbeda newline dari versi repo. Berkas field memuat Database Secret asli: jangan di-commit,
di-upload, atau disalin ke repositori/dokumen; rotasi secret jika pernah tersebar.

1. **Uji tanpa beban sebelum flash.** Rakit ESP + sensor di meja, SSR/solenoid dilepas dan diganti
   LED atau multimeter. Pastikan relay OFF saat boot dan tetap OFF sebelum perintah.
2. **Satu sumber sketch.** Buka folder `ESPKANAN` utuh (`.ino` dan `.h`), jangan mencampur berkas
   dari `espkanan_FINAL` atau varian test.
3. **Kanal Wi-Fi = `ESPNOW_CHANNEL`.** Sketch memakai kanal 6 (`WiFi.begin(..., 6)` dan
   `esp_wifi_set_channel(6, ...)`) tanpa auto-scan. Set router ke kanal 6; router dengan auto-channel
   dapat gagal menghubungkan ESP.
4. **Enam titik DS.** Serial boot mencetak `S1`..`S6` beserta GPIO dan status sensor. Enam baris
   harus muncul, tidak boleh ada `-127` yang dianggap valid; `validMask`/`validCount` menentukan
   kelayakan, bukan angka terakhir.
5. **Empat titik RH.** Serial mencetak `DHT1`..`DHT4`; periksa pull-up, daya, dan checksum. RH gagal
   harus `null`, bukan nol. Node kiri juga dilaporkan (`ESP kiri: <MAC>`, `leftOnline`, `leftAgeMs`).
6. **HTTP dan telemetri.** Serial harus menampilkan `[Firebase] Telemetry OK` tanpa
   `Firebase ... gagal: <kode>`; pastikan REST mengembalikan 200 dan `telemetry/latest` berubah dengan
   `ts` server dan `measuredTs` masuk akal. NTP gagal membuat `measuredTs` 0; itu bukan kondisi siap.
7. **Freshness dan waktu di web.** Setelah login, dashboard harus menampilkan data terkini (bukan
   badge offline), jam WIB wajar, dan berubah menjadi kedaluwarsa bila aliran berhenti lebih dari
   15 detik. Status relay lama tidak boleh tampil sebagai kondisi kini.
8. **Manual tetap ON sampai OFF.** Mode manual ON harus bertahan walau tab ditutup atau internet
   putus; OFF hanya dari perintah manual. Uji juga bahwa mode otomatis menolak jalan bila data tidak
   lengkap.
9. **Batas klaim.** Daftar ini adalah prosedur uji lapangan. Tidak ada klaim siap produksi sampai
   seluruh langkah dijalankan pada perangkat nyata dan dicatat hasilnya.

## Kesiapan deployment (belum dijalankan)

Terperiksa hanya-baca: `firebase-tools` 15.18.0, login `m.akhdanramadhan@apps.ipb.ac.id`, project
`smartcow-de25f` ACTIVE, site Hosting `smartcow-de25f` (`https://smartcow-de25f.web.app`,
app id `1:545959235832:web:d7ee7ec89f8f92a4a72b0d`). `firebase.json` memakai `public/`, predeploy
`node scripts/prepare-hosting.cjs`, serta header cache HTML `no-cache`.

Allowlist `prepare-hosting.cjs` memuat 12 aset dan cocok dengan seluruh referensi lokal
`index.html` (CSS, sembilan JS, SVG, HTML); tidak ada berkas hilang dan tidak ada literal mirip
kredensial. `public/` belum ada dan akan dibuat oleh predeploy; script menolak berkas tak terdaftar
dan symlink.

Aset produksi pernah diperiksa hanya-baca: kesembilan berkas JavaScript yang disajikan identik secara
fungsional dengan repo (selisih hanya komentar), dan `js/firebase-public.js` memakai project serta
device yang sama.

Perintah publikasi setelah audit frontend dan otorisasi induk:

```bash
firebase deploy --only hosting --project smartcow-de25f
# opsional preflight validasi konfigurasi (menghubungi project, tanpa menulis):
firebase deploy --only hosting --project smartcow-de25f --dry-run
```

Deploy `database`/`functions` tidak diperlukan karena tidak ada perubahan rules atau function.
Deploy belum dijalankan dan tidak ada tulisan ke produksi dari sesi ini.
