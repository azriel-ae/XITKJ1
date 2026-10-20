// =========================
// lib/jadwal.js
// Helper untuk fitur "Jadwal Pelajaran". SENGAJA dibuat sebagai lib biasa
// (bukan file di /api), lalu "ditumpangkan" ke function yang sudah ada
// (api/gallery.js untuk baca publik Hari Ini/Besok, api/admin/gallery.js
// untuk kelola jadwal via login admin) — supaya jumlah total Serverless
// Functions TIDAK bertambah (tetap 11). Lihat catatan lengkap di kedua
// file tersebut.
//
// Data disimpan lewat lib/kvStore.js (key "jadwal.json"), konsisten
// dengan pola penyimpanan lain di project ini (news.json, gallery-extra.json).
// Timezone SELALU Asia/Jakarta (tidak ada DST, jadi aman dipakai untuk
// hitung "besok" dengan tambah 24 jam).
// =========================

const crypto = require("crypto");
const { readJson, writeJson } = require("./kvStore");

const JADWAL_KEY = "jadwal.json";
const TIMEZONE = "Asia/Jakarta";

const DAYS = ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu"];

const DAY_LABELS = {
    senin: "Senin",
    selasa: "Selasa",
    rabu: "Rabu",
    kamis: "Kamis",
    jumat: "Jumat",
    sabtu: "Sabtu",
    minggu: "Minggu"
};

// Nama hari (Inggris, hasil Intl) -> key hari kita.
const DAY_KEY_BY_WEEKDAY = {
    Sunday: "minggu",
    Monday: "senin",
    Tuesday: "selasa",
    Wednesday: "rabu",
    Thursday: "kamis",
    Friday: "jumat",
    Saturday: "sabtu"
};

function emptyJadwalData() {
    const data = {};
    DAYS.forEach(day => { data[day] = []; });
    return data;
}

function isValidDay(day) {
    return DAYS.includes(day);
}

// Baca data jadwal tersimpan, dijamin selalu punya ketujuh key hari
// (kalau data lama/sebagian rusak/kosong, hari yang hilang diisi array kosong).
async function getJadwalData() {
    const raw = await readJson(JADWAL_KEY, null);
    const data = emptyJadwalData();
    if (raw && typeof raw === "object") {
        DAYS.forEach(day => {
            if (Array.isArray(raw[day])) data[day] = raw[day];
        });
    }
    return data;
}

async function saveJadwalData(data) {
    await writeJson(JADWAL_KEY, data);
}

function sortByJam(items) {
    return [...items].sort((a, b) => String(a.jam || "").localeCompare(String(b.jam || "")));
}

// Info hari (key + label tanggal lengkap berbahasa Indonesia) untuk sebuah
// Date, dihitung di timezone Asia/Jakarta.
function dayInfoFor(date) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long" }).format(date);
    const dateLabel = new Intl.DateTimeFormat("id-ID", {
        timeZone: TIMEZONE,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(date);
    return { key: DAY_KEY_BY_WEEKDAY[weekday], dateLabel };
}

// ---------- Baca publik: Hari Ini & Besok ----------
async function getPublicSchedule() {
    const data = await getJadwalData();
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const todayInfo = dayInfoFor(now);
    const tomorrowInfo = dayInfoFor(tomorrow);

    return {
        hariIni: {
            key: todayInfo.key,
            label: DAY_LABELS[todayInfo.key],
            dateLabel: todayInfo.dateLabel,
            items: sortByJam(data[todayInfo.key] || [])
        },
        besok: {
            key: tomorrowInfo.key,
            label: DAY_LABELS[tomorrowInfo.key],
            dateLabel: tomorrowInfo.dateLabel,
            items: sortByJam(data[tomorrowInfo.key] || [])
        }
    };
}

// ---------- Admin: baca semua data (untuk panel kelola) ----------
async function listAllForAdmin() {
    const data = await getJadwalData();
    const result = {};
    DAYS.forEach(day => { result[day] = sortByJam(data[day]); });
    return { days: DAYS, labels: DAY_LABELS, data: result };
}

function validationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function cleanEntryFields(body) {
    const jam = String(body.jam || "").trim();
    const mapel = String(body.mapel || "").trim().slice(0, 100);
    const guru = String(body.guru || "").trim().slice(0, 100);

    if (!jam) throw validationError("Jam wajib diisi.");
    if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(jam)) {
        throw validationError('Format jam tidak valid. Gunakan contoh: "07:00 - 08:30".');
    }
    if (!mapel) throw validationError("Mata pelajaran wajib diisi.");
    if (!guru) throw validationError("Nama guru wajib diisi.");

    return { jam, mapel, guru };
}

// ---------- Admin: tambah jadwal ----------
async function addEntry(hari, body) {
    if (!isValidDay(hari)) throw validationError("Hari tidak valid.");
    const fields = cleanEntryFields(body);

    const data = await getJadwalData();
    const entry = { id: crypto.randomUUID(), ...fields };
    data[hari].push(entry);
    await saveJadwalData(data);
    return entry;
}

// ---------- Admin: edit jadwal (boleh pindah hari via body.newHari) ----------
async function updateEntry(hari, id, body) {
    if (!isValidDay(hari)) throw validationError("Hari tidak valid.");
    if (!id) throw validationError("id jadwal wajib diisi.");

    const targetDay = body.newHari && body.newHari !== hari ? body.newHari : hari;
    if (!isValidDay(targetDay)) throw validationError("Hari tujuan tidak valid.");

    const fields = cleanEntryFields(body);

    const data = await getJadwalData();
    const index = data[hari].findIndex(item => item.id === id);
    if (index === -1) {
        const error = new Error("Jadwal tidak ditemukan.");
        error.statusCode = 404;
        throw error;
    }

    const updatedEntry = { id, ...fields };

    if (targetDay === hari) {
        data[hari][index] = updatedEntry;
    } else {
        data[hari].splice(index, 1);
        data[targetDay].push(updatedEntry);
    }

    await saveJadwalData(data);
    return { entry: updatedEntry, hari: targetDay };
}

// ---------- Admin: hapus jadwal ----------
async function deleteEntry(hari, id) {
    if (!isValidDay(hari)) throw validationError("Hari tidak valid.");
    if (!id) throw validationError("id jadwal wajib diisi.");

    const data = await getJadwalData();
    const before = data[hari].length;
    data[hari] = data[hari].filter(item => item.id !== id);
    if (data[hari].length === before) {
        const error = new Error("Jadwal tidak ditemukan (mungkin sudah dihapus).");
        error.statusCode = 404;
        throw error;
    }

    await saveJadwalData(data);
}

module.exports = {
    DAYS,
    DAY_LABELS,
    isValidDay,
    getPublicSchedule,
    listAllForAdmin,
    addEntry,
    updateEntry,
    deleteEntry
};
