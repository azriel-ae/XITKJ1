// =========================
// lib/news.js
// Helper untuk fitur "Berita & Pengumuman". SENGAJA dibuat sebagai lib
// biasa (bukan file di /api), lalu "ditumpangkan" ke function yang sudah
// ada (api/gallery.js untuk baca publik, api/admin/gallery.js untuk
// tulis via login) — supaya jumlah total Serverless Functions TIDAK
// bertambah (lihat catatan di kedua file tersebut).
//
// Data disimpan lewat lib/kvStore.js (key "news.json"), konsisten dengan
// pola penyimpanan lain di project ini (gallery-extra.json, dll).
// =========================

const crypto = require("crypto");
const { readJson, writeJson } = require("./kvStore");
const { ROLES } = require("./auth");

const NEWS_KEY = "news.json";

const CATEGORIES = ["Pengumuman", "Kegiatan", "Informasi", "Penting"];
const STATUSES = ["draft", "published"];

function isValidCategory(category) {
    return CATEGORIES.includes(category);
}

// Sanitasi dasar terhadap HTML isi berita yang datang dari rich text editor
// di dashboard. PENTING: berita bisa dibuat oleh SIAPA PUN yang login
// (termasuk siswa) dan ditampilkan ke seluruh pengunjung publik lewat
// innerHTML di frontend — jadi wajib dibersihkan di server sebelum
// disimpan, bukan cuma diandalkan ke frontend. Ini bukan parser HTML
// penuh, tapi cukup untuk membuang vektor XSS paling umum: <script>,
// <style>, <iframe>/<object>/<embed>, atribut event (onClick dst), dan
// URL javascript:/data: pada href/src.
function sanitizeContentHtml(html) {
    let out = String(html || "");
    out = out.replace(/<\/?(script|style|iframe|object|embed|link|meta|form)[^>]*>/gi, "");
    out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    out = out.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '$1="#"');
    out = out.replace(/(href|src)\s*=\s*("data:(?!image\/)[^"]*"|'data:(?!image\/)[^']*')/gi, '$1="#"');
    return out;
}

// Slug otomatis dari judul: huruf kecil, spasi/simbol -> "-", dijamin unik
// terhadap daftar berita yang sudah ada (nambah -2, -3, dst kalau bentrok).
function slugify(title) {
    const base = String(title || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return base || "berita";
}

async function ensureUniqueSlug(baseSlug, excludeId) {
    const all = await readJson(NEWS_KEY, []);
    const list = Array.isArray(all) ? all : [];
    let slug = baseSlug;
    let counter = 2;
    // eslint-disable-next-line no-loop-func
    while (list.some(item => item.slug === slug && item.id !== excludeId)) {
        slug = `${baseSlug}-${counter}`;
        counter += 1;
    }
    return slug;
}

async function loadAllNews() {
    const all = await readJson(NEWS_KEY, []);
    return Array.isArray(all) ? all : [];
}

// Urutan tampil: pinned+published dulu, lalu published terbaru, draft
// tidak pernah ikut di daftar publik (difilter oleh pemanggil).
function sortForDisplay(list) {
    return [...list].sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        const dateA = Date.parse(a.publishedAt || a.createdAt || 0) || 0;
        const dateB = Date.parse(b.publishedAt || b.createdAt || 0) || 0;
        return dateB - dateA;
    });
}

function toPublicShape(item) {
    return {
        id: item.id,
        title: item.title,
        slug: item.slug,
        excerpt: item.excerpt,
        content: item.content,
        category: item.category,
        thumbnail: item.thumbnail || null,
        authorId: item.authorId,
        authorName: item.authorName,
        authorRole: item.authorRole,
        status: item.status,
        isPinned: !!item.isPinned,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        publishedAt: item.publishedAt || null
    };
}

// ---------- baca (dipakai publik lewat api/gallery.js) ----------

async function listPublishedNews({ category } = {}) {
    const all = await loadAllNews();
    let list = all.filter(item => item.status === "published");
    if (category && category !== "Semua") {
        list = list.filter(item => item.category === category);
    }
    return sortForDisplay(list).map(toPublicShape);
}

async function getPublishedBySlug(slug) {
    const all = await loadAllNews();
    const item = all.find(n => n.slug === slug && n.status === "published");
    return item ? toPublicShape(item) : null;
}

async function getRelatedNews(item, limit) {
    const all = await loadAllNews();
    const list = all.filter(
        n => n.status === "published" && n.id !== item.id && n.category === item.category
    );
    return sortForDisplay(list).slice(0, limit || 3).map(toPublicShape);
}

async function getHomeNews(limit) {
    const list = await listPublishedNews();
    return list.slice(0, limit || 3);
}

// ---------- baca (dipakai dashboard, hanya untuk pemilik/admin) ----------

async function listNewsForUser(adminInfo) {
    const all = await loadAllNews();
    const canSeeAll = adminInfo.role === ROLES.ADMIN || adminInfo.role === ROLES.SUPER_ADMIN;
    const list = canSeeAll ? all : all.filter(item => item.authorId === adminInfo.username);
    return sortForDisplay(list).map(toPublicShape);
}

// ---------- permission ----------

function canManageAllNews(adminInfo) {
    return adminInfo.role === ROLES.ADMIN || adminInfo.role === ROLES.SUPER_ADMIN;
}

function canEditNews(adminInfo, item) {
    if (!adminInfo || !item) return false;
    if (canManageAllNews(adminInfo)) return true;
    return item.authorId === adminInfo.username;
}

function canPin(adminInfo) {
    return canManageAllNews(adminInfo);
}

// ---------- tulis (dipakai lewat api/admin/gallery.js, resource=news) ----------

async function createNews(input, adminInfo) {
    const title = String(input.title || "").trim().slice(0, 150);
    if (!title) throw new Error("Judul wajib diisi.");

    const category = isValidCategory(input.category) ? input.category : "Informasi";
    const excerpt = String(input.excerpt || "").trim().slice(0, 300);
    const contentRaw = String(input.content || "").trim();
    if (!contentRaw) throw new Error("Isi berita wajib diisi.");
    const content = sanitizeContentHtml(contentRaw);

    const status = STATUSES.includes(input.status) ? input.status : "draft";

    // Hanya admin/super_admin yang boleh pin, dan hanya saat membuat
    // berita sendiri sebagai admin. Siswa tidak pernah bisa set pinned.
    const isPinned = canPin(adminInfo) ? !!input.isPinned : false;

    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(baseSlug);

    const now = new Date().toISOString();

    const entry = {
        id: crypto.randomUUID(),
        title,
        slug,
        excerpt,
        content,
        category,
        thumbnail: input.thumbnail || null,
        // author_id selalu dari akun yang sedang login (server-side),
        // TIDAK PERNAH dari body/frontend — mencegah user memalsukan penulis.
        authorId: adminInfo.username,
        authorName: adminInfo.username,
        authorRole: adminInfo.role,
        status,
        isPinned,
        createdAt: now,
        updatedAt: now,
        publishedAt: status === "published" ? now : null
    };

    const all = await loadAllNews();
    all.push(entry);
    await writeJson(NEWS_KEY, all);

    return toPublicShape(entry);
}

async function updateNews(id, input, adminInfo) {
    const all = await loadAllNews();
    const index = all.findIndex(item => item.id === id);
    if (index === -1) throw new Error("Berita tidak ditemukan (mungkin sudah dihapus).");

    const target = all[index];
    if (!canEditNews(adminInfo, target)) {
        const error = new Error("Anda tidak memiliki izin untuk mengedit berita ini.");
        error.statusCode = 403;
        throw error;
    }

    // Pin/unpin: hanya admin & super_admin, walaupun berita itu milik
    // sendiri. Kalau field tidak dikirim, nilai lama dipertahankan.
    if (input.isPinned !== undefined) {
        if (!canPin(adminInfo)) {
            const error = new Error("Hanya admin/super_admin yang boleh mem-pin berita.");
            error.statusCode = 403;
            throw error;
        }
        target.isPinned = !!input.isPinned;
    }

    if (input.title !== undefined) {
        const title = String(input.title || "").trim().slice(0, 150);
        if (!title) throw new Error("Judul wajib diisi.");
        if (title !== target.title) {
            const baseSlug = slugify(title);
            target.slug = await ensureUniqueSlug(baseSlug, target.id);
        }
        target.title = title;
    }
    if (input.category !== undefined && isValidCategory(input.category)) {
        target.category = input.category;
    }
    if (input.excerpt !== undefined) {
        target.excerpt = String(input.excerpt || "").trim().slice(0, 300);
    }
    if (input.content !== undefined) {
        const content = String(input.content || "").trim();
        if (!content) throw new Error("Isi berita wajib diisi.");
        target.content = sanitizeContentHtml(content);
    }
    if (input.thumbnail !== undefined) {
        target.thumbnail = input.thumbnail || null;
    }
    if (input.status !== undefined && STATUSES.includes(input.status)) {
        const wasPublished = target.status === "published";
        target.status = input.status;
        if (!wasPublished && target.status === "published") {
            target.publishedAt = new Date().toISOString();
        }
    }

    target.updatedAt = new Date().toISOString();
    all[index] = target;
    await writeJson(NEWS_KEY, all);

    return toPublicShape(target);
}

async function deleteNews(id, adminInfo) {
    const all = await loadAllNews();
    const target = all.find(item => item.id === id);
    if (!target) throw new Error("Berita tidak ditemukan (mungkin sudah dihapus).");

    if (!canEditNews(adminInfo, target)) {
        const error = new Error("Anda tidak memiliki izin untuk menghapus berita ini.");
        error.statusCode = 403;
        throw error;
    }

    const remaining = all.filter(item => item.id !== id);
    await writeJson(NEWS_KEY, remaining);
    return target;
}

module.exports = {
    CATEGORIES,
    STATUSES,
    slugify,
    listPublishedNews,
    getPublishedBySlug,
    getRelatedNews,
    getHomeNews,
    listNewsForUser,
    canManageAllNews,
    canEditNews,
    canPin,
    createNews,
    updateNews,
    deleteNews
};
