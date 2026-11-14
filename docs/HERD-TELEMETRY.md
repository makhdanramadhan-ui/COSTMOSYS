# Kontrak telemetri aktivitas sapi (baca-saja)

Status: **pembaca dan eksportir berkas sudah ada; penulis Firebase belum ada.**
Tidak ada proses yang mengisi node ini hari ini, jadi dashboard harus menampilkan
kondisi kosong netral, bukan nol dan bukan status normal.

- Pembaca: `js/herd.js` (`SCSHerd.view`). Modul ini sudah masuk allowlist
  `scripts/prepare-hosting.cjs`, tetapi `index.html` belum memuatnya; integrasi
  UI menunggu pemilik frontend.
- Eksportir berkas: `scripts/herd-export.cjs` (hanya JSON lokal, tanpa kredensial
  dan tanpa tulis Firebase).
- Penulis/penyiar: **belum ada**. Kredensial penulis belum ditetapkan (lihat
  "Prasyarat penulis").

## Prinsip

1. Yang disimpan hanya pengamatan: durasi di dalam rentang video yang benar-benar
   diproses. Tidak ada ekstrapolasi ke 24 jam dan tidak ada penjembatanan antar
   sampel yang berjauhan.
2. Satu video = satu objek anak imutabel. Idempoten: memproses ulang video yang
   sama menimpa objek yang sama, tidak menambah baris.
3. Postur tidak dikenal (`sebagian_teramati`, `kurang_terlihat`) tetap dilaporkan
   sebagai durasi, bukan dibuang dan bukan diisi postur tebakan.
4. Ketidakhadiran orang tidak pernah disimpulkan dari tidak adanya kotak `person`.
5. Setiap objek membawa sidik bobot (`weightsSha256`) dan setelan deteksi, karena
   ada dua keluarga model di mesin ini.

## Lokasi node

```text
devices/<deviceId>/herd/days/<YYYY-MM-DD>/<runId>
```

- `<deviceId>` mengikuti konvensi yang ada (`cow-sprinkler-01`, lihat `js/firebase.js`).
- `<YYYY-MM-DD>` = tanggal **WIB** dari waktu mulai segmen video (`Asia/Jakarta`).
- `<runId>` = `<stem video>__<8 hex pertama weightsSha256>`. Deterministik; jangan
  pakai `push()`.
- Tidak ada node `latest`: pembaca menurunkan "terakhir" dari `windowEndTs` terbesar.

Contoh: `herd/days/2026-10-26/20261026_134036_tp00001__0147ac72`.

Segmen yang melewati tengah malam WIB dipotong menjadi objek terpisah hanya bila
`events.csv` tersedia dan menutup seluruh rentang tanpa lubang. Tanpa bukti waktu
itu, objek disimpan di tanggal mulai dengan `boundary: "unknown"`; pembaca
menghitungnya sebagai `unknownBoundary` dan **tidak** memasukkannya ke total hari
mana pun. Pemotongan tidak pernah menebak pembagian durasi.

## Isi objek

| field | tipe | arti |
|---|---|---|
| `schemaVersion` | int | `1` |
| `video` | string | nama berkas sumber, tanpa path |
| `windowStartTs`, `windowEndTs` | int ms | batas segmen yang diproses (epoch UTC); untuk potongan tengah malam, batas potongan |
| `windowS` | num | durasi segmen yang diproses, detik; sama dengan `(windowEndTs-windowStartTs)/1000` |
| `startLocal` | string | ISO dengan offset, mis. `2026-10-26T13:40:36.000+07:00` |
| `tzOffsetH` | int | `7` |
| `samples`, `everyS`, `maxGapS` | int/num | jumlah sampel, jarak sampling, batas celah |
| `weightsName`, `weightsSha256` | string | bobot yang benar-benar dipakai |
| `modelNames` | map | indeks kelas → nama, apa adanya dari checkpoint |
| `conf`, `imgsz` | num/int | setelan operasi |
| `ts` | int ms | waktu tulis objek; eksportir memakai mtime `summary.json` |
| `boundary` | string | `exact` atau `unknown` (lihat tengah malam) |
| `split` | objek | hanya objek potongan: `{ part, of }`; 1-based |
| `videoWindowStartTs`, `videoWindowEndTs` | int ms | hanya objek potongan: rentang video penuh sebelum dipotong |
| `zones.<zone>` | objek | lihat bawah, satu per zona di `monitor/zones.json` |
| `person` | objek | `{ presentS, framesWithPerson, samplesTotal }`; `presentS` selalu `null` |
| `quality` | objek | `{ cowsPerSampleMean, cowConfMean, samplesWithoutCow }` |

`person.framesWithPerson` hanya jumlah sampel (frame) yang memuat kotak orang;
`summary.json` tidak menyimpan durasi kehadiran orang, jadi `person.presentS`
dibiarkan `null`. Ketiadaan kotak orang bukan bukti tidak ada orang.
`quality.cowsPerSampleMean` adalah rata-rata jumlah kotak sapi per sampel untuk
menilai kualitas detektor, bukan jumlah ekor di kandang.

`zones.<zone>`:

| field | arti |
|---|---|
| `durationsS.standing`, `.lying`, `.mixed` | postur yang benar-benar teramati |
| `durationsS.partial` | `sebagian_teramati` |
| `durationsS.unobserved` | `kurang_terlihat` |
| `durationsS.gap` | celah antar sampel > `maxGapS` |
| `windowS` | total durasi segmen, bukan 24 jam |
| `observedPct` | durasi postur teramati ÷ `windowS` × 100, satu desimal |
| `partialPct` | durasi `partial` ÷ `windowS` × 100, satu desimal |
| `unobservedReasons` | map alasan → detik |
| `nCowsMax`, `personPresentS` | `null`; `summary.json` tidak menyimpan puncak sapi atau detik orang per zona |

Zona hanya boleh dibaca per zona. `R1_near` dan `R2_mid` bertumpang tindih, jadi
penjumlahan antar zona bukan jumlah kandang dan bukan jumlah ekor.

## Sumber ekspor yang tepat

`scripts/herd-export.cjs --runs <run dir>[,<run dir>...] --out <file.json>` membaca:

- `summary.json`: `start_local`, `processed_s`, `tz_offset_h`, `samples`,
  `every_s`, `max_gap_s`, `detector.{weights, weights_sha256, model_names, conf,
  imgsz}`, `quality.{samples_with_person, cows_per_sample_mean, cow_conf_mean,
  samples_without_cow}`, `summaries.<zone>.{durations_s, unobserved_reasons_s}`.
- `events.csv`: **hanya** untuk memotong segmen yang melewati tengah malam WIB;
  kolom `zone,state,start_s,end_s,reasons`.

`processed_s` adalah panjang rentang yang benar-benar diproses, bukan
`video_duration_s`; video terpotong tidak boleh dihitung penuh. Folder tanpa
`start_local` (mis. `eval_*`) dan ringkasan yang tidak konsisten (jumlah durasi
tidak sama dengan `processed_s`, sidik bobot tidak valid, `start_local` tidak
terbaca) ditolak dan dilaporkan, tidak diisi nol. Bila beberapa direktori berbagi
`<hari>/<runId>` yang sama, eksportir mempertahankan berkas `summary.json` dengan
mtime terbaru, meniru penulisan ulang idempoten di Realtime Database; urutan
argumen tidak mengubah hasil.

Keluaran hanya JSON lokal berbentuk `{contract:"smartcow.herd.days",schemaVersion:1,days}`
yang siap disalurkan penulis aman nanti. Skrip tidak membaca kredensial, tidak
menulis ke Firebase, dan tidak membuat feed runtime palsu.

## Aturan baca (rules)

`scripts/build-rules.cjs` (sumber tunggal; `database.rules.json` dibangun ulang
lalu `--check`):

```js
herd: { days: { '.read': device('monitor') } }
```

Tidak ada `.write` untuk web, sama seperti `telemetry/latest`. Klien dengan izin
`monitor` boleh membaca; tidak ada akun web yang boleh menulis, termasuk admin.

## Aturan baca sisi pembaca (`js/herd.js`)

```js
const view = SCSHerd.view(daysSnapshot, now);
```

`now` harus waktu server terkoreksi (`SCSFirebase.now()`), bukan jam perangkat;
nilai ini hanya dipakai untuk status `stale` dan `latest.ageMs`.

- `view(null, now)` = `{ present:false, days:[], latest:null, stale:null, ... }`;
  ini kondisi kosong netral yang disetujui pengguna.
- Hari dihitung dari `windowStartTs` + `tzOffsetH` per objek, bukan dari jam
  browser. Objek dengan tanggal yang tidak cocok dengan key hari ditolak.
- Jendela duplikat (rentang dan video sama dari dua run) dihitung **sekali**;
  yang dipakai adalah `ts` terbaru, lalu `runId` terbesar. Jumlah yang kalah
  dilaporkan sebagai `superseded`.
- Jendela yang saling tumpang tindih (model berbeda pada rentang yang sama)
  tidak dijumlahkan. Yang dipertahankan adalah `windowS` terbesar, lalu `ts`
  terbaru; sisanya masuk `overlapDropped`. Tidak ada detik yang dihitung dua kali.
- Durasi divalidasi terhadap `windowS` objek; ringkasan rusak masuk
  `invalidSegments`, bukan nol.
- `boundary:"unknown"` masuk `unknownBoundary`, tidak masuk total zona/hari.
- `stale` = `windowEndTs` terbaru lebih tua dari 24 jam, atau lebih dari 10 menit
  di masa depan. Umur (`latest.ageMs`) selalu ditampilkan; `stale` bukan penilaian
  kesehatan, hanya status umpan.
- `gapS`, `partialS`, `unobservedS` tetap terpisah; cakupan (`coveragePct`) hanya
  memakai postur teramati dibagi `windowS` per zona.
- Pembaca tidak mengembalikan total kandang dan tidak menjumlahkan zona.
- `day.personFrames` dan `day.samples` hanya menjumlahkan segmen `exact` yang
  dipertahankan. Nilainya `null` bila salah satu segmen tidak punya angka bulat
  non-negatif, atau bila hari itu tidak punya segmen; tidak pernah diisi nol.
  `personFrames` adalah konteks deteksi kotak orang per frame, bukan bukti
  kehadiran orang.

## Bukti cakupan hari ini

Rekaman di `E:/Dataset ML IoT/drive cctv` berjumlah 55 berkas, 25,53 jam, terpicu
gerakan, dengan celah antar berkas hingga lebih dari 5 jam. Cakupan per tanggal
WIB: 2026-09-26 2,38 jam (9,9%), 2026-09-27 7,98 jam (33,3%), 2026-10-25 9,86 jam
(41,1%), 2026-10-26 5,31 jam (22,1%).

Uji ujung-ke-ujung memakai 8 run produksi di `SmartCow-ML/monitor/out` (folder
`eval_*` dikecualikan) dan membaca hasil ekspornya lewat `SCSHerd.view` tanpa
Firebase. Semua run tersebut terpotong (`truncated: true`), jadi `windowS` jauh
lebih kecil dari durasi video penuh.

## Prasyarat penulis (belum dipenuhi)

Penulis memerlukan kredensial server yang boleh menulis ke
`devices/cow-sprinkler-01/herd/days/...`. Repo ini **tidak** memberikan izin tulis
Realtime Database kepada akun web mana pun. Dua pilihan yang belum diputuskan:

1. Memakai Database Secret perangkat ESP yang sudah ada. Satu kebocoran membuka
   telemetri perangkat dan herd sekaligus; tidak disarankan.
2. Kredensial server terpisah (Admin SDK dengan akses tulis database) yang tidak
   pernah dikirim ke browser. Pemberian peran IAM-nya harus diverifikasi di
   konsol proyek, bukan diasumsikan dari dokumen ini.

Sampai keputusan itu dibuat dan kredensial dipasang di luar repo, tidak ada feed
runtime. Jangan menambahkan aturan tulis untuk klien dan jangan mengarang izin
RTDB.

## Yang tidak didukung kontrak ini

- Identitas per ekor dan durasi berbaring satu sapi: tidak ada tracker dan tidak
  ada ID di checkpoint mana pun (`README` model, `monitor/README.md`).
- Durasi zona **bukan** jam berdiri sapi: satu zona bisa memuat beberapa sapi,
  dan `standing` hanya disimpulkan dari geometri kotak untuk zona yang mampu
  menilai postur.
- Ketiadaan orang: recall kelas `person` pada evaluasi klip 0,105 (7 dari 67).
- Status kesehatan atau label stres sapi: tidak ada skor 4 tingkat dan tidak ada
  diagnosis. Sensor hanya mengukur paparan panas kandang (suhu/THI), bukan respons
  sapi.
