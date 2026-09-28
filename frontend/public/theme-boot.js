// Apply the saved theme before first paint, so there is no light or
// dark flash before React mounts. useTheme writes the snapshot
// (src/lib/themeBoot.ts); without one, use the default dark theme.
(function () {
  var root = document.documentElement;
  try {
    var boot = JSON.parse(localStorage.getItem('theme-boot'));
    if (boot && boot.v === 1 && boot.vars) {
      // Auto: the snapshot holds both picks; use the one for the
      // device's colour scheme right now
      if (boot.system && typeof matchMedia === 'function') {
        var picked = matchMedia('(prefers-color-scheme: dark)').matches
          ? boot.system.dark
          : boot.system.light;
        if (picked && picked.vars) boot = picked;
      }
      for (var name in boot.vars) root.style.setProperty(name, boot.vars[name]);
      if (boot.dark) root.classList.add('dark');
      else root.classList.remove('dark');
      if (typeof boot.themeColor === 'string') {
        // Status bar / PWA title bar colour, set before first paint
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'theme-color');
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', boot.themeColor);
      }
      return;
    }
  } catch (e) {}
  root.classList.add('dark');
  root.style.setProperty('--background', 'oklch(0.17 0.02 275)');
})();
