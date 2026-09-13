// =========================
// assets/js/news.js
// Frontend Berita & Pengumuman. Semua data berasal dari
// /api/gallery?resource=news (baca publik, lihat api/gallery.js).
// Satu file ini dipakai di 3 halaman (index.html, berita.html,
// berita-detail.html) — tiap fungsi cuma jalan kalau elemen terkait ada
// di halaman itu.
// =========================

function escapeHtmlNews(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NEWS_CATEGORY_ICON = {
  Pengumuman: "fa-bullhorn",
  Kegiatan: "fa-calendar-days",
  Informasi: "fa-circle-info",
  Penting: "fa-thumbtack"
};

function formatNewsDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

function newsRoleLabel(role) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "Siswa";
}

function newsCardMedia(item) {
  if (item.thumbnail) {
    return `<div class="news-card-media">
      ${item.isPinned ? `<span class="news-pin-badge"><i class="fa-solid fa-thumbtack"></i> Penting</span>` : ""}
      <img src="${escapeHtmlNews(item.thumbnail)}" alt="${escapeHtmlNews(item.title)}" loading="lazy">
    </div>`;
  }
  const icon = NEWS_CATEGORY_ICON[item.category] || "fa-newspaper";
  return `<div class="news-card-media">
    ${item.isPinned ? `<span class="news-pin-badge"><i class="fa-solid fa-thumbtack"></i> Penting</span>` : ""}
    <div class="news-card-media-fallback"><i class="fa-solid ${icon}"></i></div>
  </div>`;
}

function renderNewsCard(item) {
  return `
    <a class="news-card" href="/berita/${encodeURIComponent(item.slug)}">
      ${newsCardMedia(item)}
      <div class="news-card-body">
        <span class="news-category-badge">${escapeHtmlNews(item.category)}</span>
        <h3 class="news-card-title">${escapeHtmlNews(item.title)}</h3>
        <span class="news-card-date">${formatNewsDate(item.publishedAt || item.createdAt)}</span>
        ${item.excerpt ? `<p class="news-card-excerpt">${escapeHtmlNews(item.excerpt)}</p>` : ""}
        <div class="news-card-foot">
          <span class="news-card-author">Oleh <strong>${escapeHtmlNews(item.authorName)}</strong> · ${newsRoleLabel(item.authorRole)}</span>
          <span class="news-card-readmore">Baca <i class="fa-solid fa-arrow-right"></i></span>
        </div>
      </div>
    </a>`;
}

// ---------- Home: "Pengumuman Terbaru" (maksimal 3, pinned dulu) ----------

async function initNewsHome() {
  const container = document.getElementById("newsHomeList");
  if (!container) return;
  const emptyEl = document.getElementById("newsHomeEmpty");
  const footEl = document.getElementById("newsHomeFoot");

  try {
    const res = await fetch("/api/gallery?resource=news&home=1");
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
      container.innerHTML = "";
      container.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (footEl) footEl.hidden = true;
      return;
    }

    container.hidden = false;
    if (emptyEl) emptyEl.hidden = true;
    container.className = `news-grid${items.length === 1 ? " is-single" : ""}`;
    container.innerHTML = items.map(renderNewsCard).join("");
    if (footEl) footEl.hidden = false;
  } catch (error) {
    console.error("Gagal memuat pengumuman:", error);
    container.innerHTML = `<div class="col-12"><div class="empty-state">Gagal memuat pengumuman. Coba muat ulang halaman.</div></div>`;
  }
}

// ---------- /berita: daftar semua berita + filter kategori ----------

async function initNewsList() {
  const container = document.getElementById("newsListContainer");
  if (!container) return;
  const tabsEl = document.getElementById("newsFilterTabs");
  let activeCategory = "Semua";

  async function load() {
    container.innerHTML = `<div class="empty-state">Memuat berita...</div>`;
    try {
      const url = activeCategory === "Semua"
        ? "/api/gallery?resource=news"
        : `/api/gallery?resource=news&category=${encodeURIComponent(activeCategory)}`;
      const res = await fetch(url);
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      if (tabsEl && !tabsEl.dataset.rendered) {
        const categories = ["Semua", ...(data.categories || [])];
        tabsEl.innerHTML = categories.map(cat =>
          `<button type="button" class="news-filter-tab${cat === activeCategory ? " is-active" : ""}" data-category="${escapeHtmlNews(cat)}">${escapeHtmlNews(cat)}</button>`
        ).join("");
        tabsEl.dataset.rendered = "1";
        tabsEl.querySelectorAll("[data-category]").forEach(btn => {
          btn.addEventListener("click", () => {
            activeCategory = btn.dataset.category;
            tabsEl.querySelectorAll("[data-category]").forEach(b => b.classList.toggle("is-active", b === btn));
            load();
          });
        });
      }

      if (!items.length) {
        container.innerHTML = `<div class="empty-state">Belum ada berita untuk kategori ini.</div>`;
        return;
      }

      container.innerHTML = `<div class="news-list-grid">${items.map(renderNewsCard).join("")}</div>`;
    } catch (error) {
      console.error("Gagal memuat berita:", error);
      container.innerHTML = `<div class="empty-state is-error">Gagal memuat berita. Coba muat ulang halaman.</div>`;
    }
  }

  load();
}

// ---------- /berita/[slug]: detail satu berita ----------

function newsSlugFromPath() {
  const match = window.location.pathname.match(/\/berita\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function initNewsDetail() {
  const container = document.getElementById("newsDetailContainer");
  if (!container) return;

  const slug = newsSlugFromPath();
  if (!slug) {
    container.innerHTML = `<div class="empty-state">Berita tidak ditemukan.</div>`;
    return;
  }

  try {
    const res = await fetch(`/api/gallery?resource=news&slug=${encodeURIComponent(slug)}`);
    if (res.status === 404) {
      container.innerHTML = `<div class="empty-state">Berita tidak ditemukan atau belum dipublikasikan.</div>`;
      return;
    }
    const data = await res.json();
    const item = data.item;
    const related = Array.isArray(data.related) ? data.related : [];

    document.title = `${item.title} | XI TKJ 1`;

    container.innerHTML = `
      <div class="news-detail-wrap">
        <a class="news-back-link" href="/berita"><i class="fa-solid fa-arrow-left"></i> Kembali ke Berita</a>
        ${item.thumbnail ? `<div class="news-detail-thumb"><img src="${escapeHtmlNews(item.thumbnail)}" alt="${escapeHtmlNews(item.title)}"></div>` : ""}
        <span class="news-category-badge">${escapeHtmlNews(item.category)}</span>
        <h1 class="news-detail-title">${escapeHtmlNews(item.title)}</h1>
        <div class="news-detail-meta">
          <span><i class="fa-regular fa-calendar"></i> ${formatNewsDate(item.publishedAt || item.createdAt)}</span>
          <span><i class="fa-regular fa-user"></i> Ditulis oleh <strong>${escapeHtmlNews(item.authorName)}</strong> · ${newsRoleLabel(item.authorRole)}</span>
        </div>
        <div class="news-detail-content">${item.content}</div>
        ${related.length ? `
          <div class="news-related">
            <h2>Berita Terkait</h2>
            <div class="news-list-grid">${related.map(renderNewsCard).join("")}</div>
          </div>` : ""}
      </div>`;
  } catch (error) {
    console.error("Gagal memuat detail berita:", error);
    container.innerHTML = `<div class="empty-state is-error">Gagal memuat berita. Coba muat ulang halaman.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initNewsHome();
  initNewsList();
  initNewsDetail();
});
