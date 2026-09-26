// =========================
// API: /api/gallery (gabungan galeri + baca publik Berita & Pengumuman +
// baca publik Jadwal Pelajaran)
// GET ?resource=... (opsional, default "gallery"):
//   - "gallery" (default) -> daftar foto galeri (data bawaan + tambahan admin)
//   - "news"              -> baca publik berita/pengumuman:
//        ?slug=<slug>        -> detail 1 berita (published saja) + berita terkait
//        ?home=1             -> maksimal 3 berita untuk teaser di Home
//                               (pinned lebih dulu, lalu published terbaru)
//        ?category=<nama>    -> daftar berita published, difilter kategori
//        (tanpa parameter)   -> semua berita published, terbaru & pinned dulu
//   - "jadwal"            -> baca publik Jadwal Pelajaran Hari Ini & Besok
//                            (timezone Asia/Jakarta), lihat lib/jadwal.js
//
// CATATAN: baca berita & jadwal SENGAJA ditumpangkan di file/function
// publik yang sudah ada ini (bukan file /api baru) supaya jumlah total
// Serverless Functions tidak bertambah — lihat catatan lengkap di
// api/admin/gallery.js (tempat operasi TULIS berita & jadwal ditumpangkan juga).
// =========================

const baseGallery = require("../data/gallery.json");
const { readJson } = require("../lib/kvStore");
const news = require("../lib/news");
const jadwal = require("../lib/jadwal");

function getQueryParam(req, key) {
    try {
        const url = new URL(req.url, "http://localhost");
        return url.searchParams.get(key);
    } catch {
        return null;
    }
}

async function handleGalleryGet(req, res) {
    const extra = await readJson("gallery-extra.json", []);
    const combined = [...baseGallery, ...(Array.isArray(extra) ? extra : [])];

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(combined);
}

async function handleNewsGet(req, res) {
    const slug = getQueryParam(req, "slug");
    const isHome = getQueryParam(req, "home") === "1";
    const category = getQueryParam(req, "category");

    res.setHeader("Cache-Control", "no-store");

    if (slug) {
        const item = await news.getPublishedBySlug(slug);
        if (!item) {
            return res.status(404).json({ error: "Berita tidak ditemukan." });
        }
        const related = await news.getRelatedNews(item, 3);
        return res.status(200).json({ item, related });
    }

    if (isHome) {
        const items = await news.getHomeNews(3);
        return res.status(200).json({ items });
    }

    const items = await news.listPublishedNews({ category });
    return res.status(200).json({ items, categories: news.CATEGORIES });
}

async function handleJadwalGet(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const schedule = await jadwal.getPublicSchedule();
    return res.status(200).json(schedule);
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method tidak diizinkan" });
    }

    const resource = getQueryParam(req, "resource") || "gallery";

    if (resource === "news") return handleNewsGet(req, res);
    if (resource === "jadwal") return handleJadwalGet(req, res);

    return handleGalleryGet(req, res);
};
