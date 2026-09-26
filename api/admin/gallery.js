// =========================
// API: /api/admin/gallery (gabungan galeri + foto profil sosmed + tulis
// Berita + kelola Jadwal Pelajaran)
// ?resource=... (opsional, default "gallery"):
//   - "gallery" (default) -> POST tambah foto galeri, DELETE hapus foto galeri (body: { id })
//   - "social"            -> POST atur/ganti foto profil Instagram/TikTok (body: { platform, foto }),
//                             DELETE hapus foto profil (body: { platform })
//   - "news"              -> tulis Berita & Pengumuman (login apa pun: siswa/admin/super_admin):
//        POST   -> buat berita baru (author_id otomatis dari akun yang login)
//        PUT    -> ubah berita (body: { id, ...field }). Edit berita ORANG LAIN,
//                  dan pin/unpin, hanya untuk admin & super_admin (dicek di lib/news.js).
//        DELETE -> hapus berita (body: { id }). Hapus berita orang lain
//                  hanya untuk admin & super_admin.
//        GET    -> daftar berita milik user (siswa) / semua berita (admin & super_admin)
//   - "jadwal"            -> kelola Jadwal Pelajaran (hanya login role admin
//                            & super_admin — akun siswa tidak diizinkan):
//        GET    -> seluruh jadwal (7 hari)
//        POST   -> tambah jadwal (body: { hari, jam, mapel, guru })
//        PUT    -> ubah jadwal (body: { hari, id, jam, mapel, guru, newHari? })
//        DELETE -> hapus jadwal (body: { hari, id })
//
// CATATAN: digabung ke satu file/function (bukan file /api terpisah)
// untuk menghemat kuota Serverless Functions di paket Vercel Hobby
// (maksimal 12 function per deployment, project ini sengaja membatasi
// diri di 11 supaya masih ada sisa ruang). Pola gabung-lewat-query-param
// ini sama dengan api/admin/auth.js, api/admin/admins.js, dan
// api/admin/siswa.js. Fitur foto sosmed, Berita & Pengumuman, dan Jadwal
// Pelajaran SENGAJA ditumpangkan di file & function ini (bukan file /api
// baru) supaya jumlah total Serverless Functions tidak bertambah (tetap 11).
// =========================

const crypto = require("crypto");
const { getLoggedInAdmin, getLoggedInAdminInfo, isSuperAdminUsername, ROLES } = require("../../lib/auth");
const { readJson, writeJson, uploadImage, deleteImage } = require("../../lib/kvStore");
const { decodeImagePayload, safeFileNamePart } = require("../../lib/http");
const { setSocialAvatar, deleteSocialAvatar, isValidPlatform, HANDLES } = require("../../lib/socialAvatar");
const { logActivity } = require("../../lib/activityLog");
const news = require("../../lib/news");
const jadwal = require("../../lib/jadwal");

const SOCIAL_PLATFORM_LABELS = {
    instagram: "Instagram",
    tiktok: "TikTok"
};

function getQueryParam(req, key) {
    try {
        const url = new URL(req.url, "http://localhost");
        return url.searchParams.get(key);
    } catch {
        return null;
    }
}

async function handleGalleryPost(req, res, admin) {
    const body = req.body || {};

    let image;
    try {
        image = decodeImagePayload(body.foto);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const judul = String(body.judul || "").trim().slice(0, 100) || "Foto Galeri";
    const namePart = safeFileNamePart(body.foto && body.foto.name, "galeri");
    const filename = `${Date.now()}-${namePart.replace(/\.[a-zA-Z0-9]+$/, "")}.${image.ext}`;

    let fotoUrl;
    try {
        fotoUrl = await uploadImage("galeri", filename, image.buffer, image.contentType);
    } catch (error) {
        console.error("Upload galeri error:", error);
        return res.status(500).json({ error: "Gagal mengupload foto. Coba lagi." });
    }

    const extra = await readJson("gallery-extra.json", []);
    const entry = {
        id: crypto.randomUUID(),
        judul,
        foto: fotoUrl,
        uploadedBy: admin,
        uploadedAt: new Date().toISOString()
    };
    extra.push(entry);
    await writeJson("gallery-extra.json", extra);

    await logActivity("gallery_upload", admin, `Upload foto galeri: "${judul}".`);

    return res.status(200).json({ ok: true, item: entry });
}

async function handleGalleryDelete(req, res, admin) {
    // Hanya super_admin (azriel & david) yang boleh menghapus foto galeri.
    // Jangan pernah percaya role/permission yang dikirim dari frontend —
    // selalu cek ulang di sini terhadap identitas yang berasal dari
    // session cookie yang sudah diverifikasi (getLoggedInAdmin di atas).
    if (!isSuperAdminUsername(admin)) {
        return res.status(403).json({ error: "Anda tidak memiliki izin untuk menghapus foto." });
    }

    const body = req.body || {};
    const id = body.id;
    if (!id) {
        return res.status(400).json({ error: "id foto wajib diisi." });
    }

    const extra = await readJson("gallery-extra.json", []);
    const target = extra.find(item => item.id === id);
    if (!target) {
        return res.status(404).json({ error: "Foto tidak ditemukan (mungkin sudah dihapus)." });
    }

    const remaining = extra.filter(item => item.id !== id);
    await writeJson("gallery-extra.json", remaining);
    await deleteImage(target.foto);

    await logActivity("gallery_delete", admin, `Hapus foto galeri: "${target.judul || id}".`);

    return res.status(200).json({ ok: true });
}

async function handleSocialPost(req, res, admin) {
    const body = req.body || {};
    const platform = String(body.platform || "").toLowerCase();
    if (!isValidPlatform(platform)) {
        return res.status(400).json({ error: "Platform tidak dikenal. Gunakan instagram atau tiktok." });
    }

    let image;
    try {
        image = decodeImagePayload(body.foto);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const result = await setSocialAvatar(platform, image.buffer, image.contentType, image.ext, admin);
        await logActivity(
            "social_avatar_update",
            admin,
            `Ubah foto profil ${SOCIAL_PLATFORM_LABELS[platform] || platform} (@${HANDLES[platform]}).`
        );
        return res.status(200).json({ ok: true, platform, ...result });
    } catch (error) {
        console.error("Update foto sosmed error:", error);
        return res.status(500).json({ error: "Gagal mengupload foto. Coba lagi." });
    }
}

async function handleSocialDelete(req, res, admin) {
    const body = req.body || {};
    const platform = String(body.platform || "").toLowerCase();
    if (!isValidPlatform(platform)) {
        return res.status(400).json({ error: "Platform tidak dikenal. Gunakan instagram atau tiktok." });
    }

    try {
        await deleteSocialAvatar(platform);
        await logActivity(
            "social_avatar_delete",
            admin,
            `Hapus foto profil ${SOCIAL_PLATFORM_LABELS[platform] || platform} (@${HANDLES[platform]}).`
        );
        return res.status(200).json({ ok: true, platform });
    } catch (error) {
        console.error("Hapus foto sosmed error:", error);
        return res.status(500).json({ error: "Gagal menghapus foto." });
    }
}

// ---------- Berita & Pengumuman (resource=news) ----------
// Ketiga role (siswa, admin, super_admin) boleh membuat/mengelola berita
// miliknya sendiri; admin & super_admin boleh mengelola milik siapa pun.
// Permission SELALU dicek di server (lib/news.js) terhadap identitas dari
// session cookie yang sudah diverifikasi — bukan dari body/frontend.

async function handleNewsGet(req, res, adminInfo) {
    const items = await news.listNewsForUser(adminInfo);
    return res.status(200).json({ items });
}

async function handleNewsPost(req, res, adminInfo) {
    const body = req.body || {};

    let thumbnail = null;
    if (body.thumbnail) {
        let image;
        try {
            image = decodeImagePayload(body.thumbnail);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        const namePart = safeFileNamePart(body.thumbnail.name, "berita");
        const filename = `${Date.now()}-${namePart.replace(/\.[a-zA-Z0-9]+$/, "")}.${image.ext}`;
        try {
            thumbnail = await uploadImage("berita", filename, image.buffer, image.contentType);
        } catch (error) {
            console.error("Upload thumbnail berita error:", error);
            return res.status(500).json({ error: "Gagal mengupload thumbnail. Coba lagi." });
        }
    }

    try {
        const entry = await news.createNews({ ...body, thumbnail }, adminInfo);
        await logActivity(
            "news_create",
            adminInfo.username,
            `Membuat berita "${entry.title}" (${entry.status}).`
        );
        return res.status(200).json({ ok: true, item: entry });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

async function handleNewsPut(req, res, adminInfo) {
    const body = req.body || {};
    const id = body.id;
    if (!id) return res.status(400).json({ error: "id berita wajib diisi." });

    let thumbnail;
    if (body.thumbnail && typeof body.thumbnail === "object") {
        let image;
        try {
            image = decodeImagePayload(body.thumbnail);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        const namePart = safeFileNamePart(body.thumbnail.name, "berita");
        const filename = `${Date.now()}-${namePart.replace(/\.[a-zA-Z0-9]+$/, "")}.${image.ext}`;
        try {
            thumbnail = await uploadImage("berita", filename, image.buffer, image.contentType);
        } catch (error) {
            console.error("Upload thumbnail berita error:", error);
            return res.status(500).json({ error: "Gagal mengupload thumbnail. Coba lagi." });
        }
    }

    try {
        const entry = await news.updateNews(id, { ...body, thumbnail }, adminInfo);
        await logActivity("news_update", adminInfo.username, `Mengubah berita "${entry.title}".`);
        return res.status(200).json({ ok: true, item: entry });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

async function handleNewsDelete(req, res, adminInfo) {
    const body = req.body || {};
    const id = body.id;
    if (!id) return res.status(400).json({ error: "id berita wajib diisi." });

    try {
        const deleted = await news.deleteNews(id, adminInfo);
        if (deleted.thumbnail) await deleteImage(deleted.thumbnail);
        await logActivity("news_delete", adminInfo.username, `Menghapus berita "${deleted.title}".`);
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

// ---------- Jadwal Pelajaran (resource=jadwal) ----------
// Hanya role admin & super_admin yang boleh kelola jadwal (akun siswa
// TIDAK diizinkan — beda dengan Berita di atas yang boleh semua role).
// Permission SELALU dicek di server terhadap identitas dari session
// cookie yang sudah diverifikasi (getLoggedInAdminInfo) — bukan dari
// body/frontend.

async function handleJadwalGet(req, res) {
    const result = await jadwal.listAllForAdmin();
    return res.status(200).json(result);
}

async function handleJadwalPost(req, res, adminInfo) {
    const body = req.body || {};
    const hari = body.hari;
    if (!hari) return res.status(400).json({ error: "Hari wajib diisi." });

    try {
        const entry = await jadwal.addEntry(hari, body);
        await logActivity(
            "jadwal_create",
            adminInfo.username,
            `Menambah jadwal ${entry.mapel} (${entry.jam}) hari ${hari}.`
        );
        return res.status(200).json({ ok: true, item: entry, hari });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

async function handleJadwalPut(req, res, adminInfo) {
    const body = req.body || {};
    const hari = body.hari;
    const id = body.id;
    if (!hari) return res.status(400).json({ error: "Hari wajib diisi." });
    if (!id) return res.status(400).json({ error: "id jadwal wajib diisi." });

    try {
        const result = await jadwal.updateEntry(hari, id, body);
        await logActivity(
            "jadwal_update",
            adminInfo.username,
            `Mengubah jadwal ${result.entry.mapel} (${result.entry.jam}) hari ${result.hari}.`
        );
        return res.status(200).json({ ok: true, item: result.entry, hari: result.hari });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

async function handleJadwalDelete(req, res, adminInfo) {
    const body = req.body || {};
    const hari = body.hari;
    const id = body.id;
    if (!hari) return res.status(400).json({ error: "Hari wajib diisi." });
    if (!id) return res.status(400).json({ error: "id jadwal wajib diisi." });

    try {
        await jadwal.deleteEntry(hari, id);
        await logActivity("jadwal_delete", adminInfo.username, `Menghapus jadwal hari ${hari}.`);
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ error: error.message });
    }
}

module.exports = async function handler(req, res) {
    const resource = getQueryParam(req, "resource") || "gallery";

    // "news" dipisah dari resource lain karena butuh info role lengkap
    // (siswa/admin/super_admin), bukan cuma username seperti resource lain.
    if (resource === "news") {
        const adminInfo = await getLoggedInAdminInfo(req);
        if (!adminInfo) {
            return res.status(401).json({ error: "Silakan login terlebih dahulu." });
        }
        if (req.method === "GET") return handleNewsGet(req, res, adminInfo);
        if (req.method === "POST") return handleNewsPost(req, res, adminInfo);
        if (req.method === "PUT") return handleNewsPut(req, res, adminInfo);
        if (req.method === "DELETE") return handleNewsDelete(req, res, adminInfo);
        return res.status(405).json({ error: "Method tidak diizinkan" });
    }

    if (resource === "jadwal") {
        const adminInfo = await getLoggedInAdminInfo(req);
        if (!adminInfo) {
            return res.status(401).json({ error: "Silakan login terlebih dahulu." });
        }
        if (adminInfo.role === ROLES.SISWA) {
            return res.status(403).json({ error: "Anda tidak memiliki izin untuk mengelola jadwal pelajaran." });
        }
        if (req.method === "GET") return handleJadwalGet(req, res, adminInfo);
        if (req.method === "POST") return handleJadwalPost(req, res, adminInfo);
        if (req.method === "PUT") return handleJadwalPut(req, res, adminInfo);
        if (req.method === "DELETE") return handleJadwalDelete(req, res, adminInfo);
        return res.status(405).json({ error: "Method tidak diizinkan" });
    }

    const admin = getLoggedInAdmin(req);
    if (!admin) {
        return res.status(401).json({ error: "Silakan login sebagai admin terlebih dahulu." });
    }

    if (resource === "social") {
        if (req.method === "POST") return handleSocialPost(req, res, admin);
        if (req.method === "DELETE") return handleSocialDelete(req, res, admin);
        return res.status(405).json({ error: "Method tidak diizinkan" });
    }

    if (req.method === "POST") return handleGalleryPost(req, res, admin);
    if (req.method === "DELETE") return handleGalleryDelete(req, res, admin);

    return res.status(405).json({ error: "Method tidak diizinkan" });
};
