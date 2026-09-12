(() => {
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');

  function sync() {
    if (!topbar) return;
    const rect = topbar.getBoundingClientRect();
    root.style.setProperty('--rw-topbar-bottom', `${Math.ceil(rect.bottom + 8)}px`);
  }

  window.addEventListener('resize', sync, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(sync).observe(topbar);
  sync();
})();
