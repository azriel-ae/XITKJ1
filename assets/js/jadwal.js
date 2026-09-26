// =========================
// assets/js/jadwal.js
// Frontend Jadwal Pelajaran, khusus halaman /berita (berita.html):
// - Tab [ Pengumuman | Jadwal Pelajaran ]
// - Render Hari Ini & Besok dari /api/gallery?resource=jadwal
// File terpisah dari assets/js/news.js supaya sistem Pengumuman yang
// sudah ada TIDAK disentuh sama sekali. Hanya jalan kalau elemen terkait
// ada di halaman (lihat pengecekan null di initPageTabs/initJadwal).
// =========================

function escapeHtmlJadwal(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jadwalColumnHtml(col) {
  const items = Array.isArray(col.items) ? col.items : [];
  const list = items.length
    ? `<div class="jadwal-list">${items.map(item => `
        <div class="jadwal-item">
          <span class="jadwal-item-time">${escapeHtmlJadwal(item.jam)}</span>
          <div class="jadwal-item-body">
            <span class="jadwal-item-mapel">${escapeHtmlJadwal(item.mapel)}</span>
            <span class="jadwal-item-guru">${escapeHtmlJadwal(item.guru)}</span>
          </div>
        </div>`).join("")}</div>`
    : `<div class="jadwal-empty">No Data</div>`;

  return list;
}

async function initJadwal() {
  const container = document.getElementById("jadwalContainer");
  if (!container) return;

  container.innerHTML = `<div class="empty-state">Memuat jadwal...</div>`;

  try {
    const res = await fetch("/api/gallery?resource=jadwal");
    const data = await res.json();
    const hariIni = data.hariIni || {};
    const besok = data.besok || {};

    container.innerHTML = `
      <div class="jadwal-columns">
        <div class="jadwal-day-card">
          <p class="jadwal-day-heading"><i class="fa-solid fa-calendar-day"></i> Hari Ini</p>
          <p class="jadwal-day-date">${escapeHtmlJadwal(hariIni.dateLabel)}</p>
          ${jadwalColumnHtml(hariIni)}
        </div>
        <div class="jadwal-day-card">
          <p class="jadwal-day-heading"><i class="fa-solid fa-calendar-days"></i> Besok</p>
          <p class="jadwal-day-date">${escapeHtmlJadwal(besok.dateLabel)}</p>
          ${jadwalColumnHtml(besok)}
        </div>
      </div>`;
  } catch (error) {
    console.error("Gagal memuat jadwal pelajaran:", error);
    container.innerHTML = `<div class="empty-state is-error">Gagal memuat jadwal pelajaran. Coba muat ulang halaman.</div>`;
  }
}

// ---------- Tab utama: Pengumuman <-> Jadwal Pelajaran ----------

function initPageTabs() {
  const tabs = document.querySelectorAll(".page-mode-tab");
  if (!tabs.length) return;

  let jadwalLoaded = false;

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.pageTab;

      tabs.forEach(t => t.classList.toggle("is-active", t === tab));

      document.querySelectorAll("[data-page-panel]").forEach(panel => {
        panel.hidden = panel.dataset.pagePanel !== target;
      });

      if (target === "jadwal" && !jadwalLoaded) {
        jadwalLoaded = true;
        initJadwal();
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initPageTabs();
});
