// 3D bubble timeline. Three.js + OrbitControls.
// X = publication year, Y = journal IF, Z = sqrt(citations).
// Right-drag: rotate. Left-drag: pan. Scroll: zoom.
// Click sphere: open DOI. Hover: tooltip.
// Role encoding: senior=solid, first=wireframe, middle=translucent.

window.RKG = window.RKG || {};

RKG.bubble3d = (function() {
  'use strict';

  const TOPIC_PALETTE = ['#0078D4','#00B294','#FF8C00','#E81123','#8764B8','#00B7C3','#498205'];
  const OTHER_COLOR = '#69797E';

  let _container, _tooltip;
  let _scene, _camera, _renderer, _controls;
  let _meshes = [];
  let _raycaster, _mouse;
  let _ready = false;
  let _hovered = null;

  function init() {
    RKG.state.subscribe(() => { if (_ready) _render(); });
    document.addEventListener('rkg:tab-shown', e => {
      if (e.detail.tab !== 'bubble3d') return;
      if (!_ready) _setup();
      _resize();
      if (RKG.state.get().author) _render();
    });
  }

  function _setup() {
    _container = document.getElementById('bubble-3d-container');
    if (!_container) return;
    if (!window.THREE || !THREE.OrbitControls) {
      _container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:13px;color:#6B6B6B;">Three.js를 불러올 수 없습니다 (네트워크 확인).</div>';
      return;
    }

    _ready = true;
    _container.style.position = 'relative';

    const w = _container.clientWidth || 900;
    const h = _container.clientHeight || 560;

    // Scene
    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0xFFFEFA);
    _scene.fog = new THREE.FogExp2(0xFFFEFA, 0.016);

    // Camera
    _camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 300);
    _camera.position.set(2, 8, 22);

    // Renderer
    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _container.appendChild(_renderer.domElement);

    // Lights
    _scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(6, 12, 10);
    _scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.22);
    fill.position.set(-5, -3, -8);
    _scene.add(fill);

    // Floor grid
    const grid = new THREE.GridHelper(26, 26, 0xDDD7C5, 0xDDD7C5);
    grid.position.y = -0.45;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    _scene.add(grid);

    // OrbitControls — right-drag = rotate, left-drag = pan
    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.08;
    _controls.screenSpacePanning = true;
    _controls.target.set(0, 3, 4);
    _controls.update();

    // Raycaster
    _raycaster = new THREE.Raycaster();
    _mouse = new THREE.Vector2(-999, -999);

    // HTML tooltip overlay
    _tooltip = document.createElement('div');
    Object.assign(_tooltip.style, {
      position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
      background: 'rgba(255,254,250,0.97)', border: '1px solid #E5DFCF',
      padding: '9px 12px', borderRadius: '4px', fontSize: '11.5px',
      lineHeight: '1.55', maxWidth: '260px', display: 'none',
      fontFamily: "'Pretendard Variable', system-ui, sans-serif",
      color: '#1A1A1A', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', zIndex: '10',
    });
    _container.appendChild(_tooltip);

    // Reset button
    const resetBtn = document.getElementById('bubble-3d-reset');
    if (resetBtn) resetBtn.addEventListener('click', _resetCamera);

    _renderer.domElement.addEventListener('mousemove', _onMouseMove);
    _renderer.domElement.addEventListener('click', _onClick);
    window.addEventListener('resize', _resize);

    _animate();
  }

  function _resetCamera() {
    if (!_camera || !_controls) return;
    _camera.position.set(2, 8, 22);
    _controls.target.set(0, 3, 4);
    _controls.update();
  }

  function _hexToColor(hex) {
    return new THREE.Color(parseInt(hex.slice(1), 16));
  }

  function _render() {
    if (!_ready || !_scene) return;
    const s = RKG.state.get();
    if (!s.author) return;

    // Dispose old meshes
    for (const m of _meshes) {
      _scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    _meshes = [];
    _hovered = null;

    const works = RKG.state.getFilteredWorks();
    if (!works.length) return;

    // Topic color map
    const topicCounts = new Map();
    for (const w of works) {
      const t = RKG.state.getPrimaryTopic(w);
      if (t) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    }
    const topicColor = new Map();
    [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPIC_PALETTE.length)
      .forEach(([t], i) => topicColor.set(t, TOPIC_PALETTE[i]));

    const yearMin = s.filteredYearMin;
    const yearMax = s.filteredYearMax;
    const yearRange = Math.max(yearMax - yearMin, 1);
    const maxCites = Math.max(...works.map(w => w.cited_by_count || 0), 1);

    const ifVals = works.map(w => {
      const sid = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      return sid ? ((s.sourceStats.get(sid) || {}).if_2yr || 0) : 0;
    });
    const maxIF = Math.max(...ifVals.filter(v => v > 0), 10);

    works.forEach((w, wi) => {
      const role = RKG.state.getAuthorshipRole(w);
      if (role === 'none') return;

      const year = w.publication_year || yearMin;
      const cites = w.cited_by_count || 0;
      const ifVal = ifVals[wi];

      // Scene coordinates: X=-8..+8, Y=0..7.5, Z=0..8
      const x = ((year - yearMin) / yearRange) * 16 - 8;
      const y = Math.min((ifVal / maxIF) * 7.5, 7.5);
      const z = Math.min((Math.sqrt(cites) / Math.sqrt(maxCites)) * 8, 8);

      const colorHex = topicColor.get(RKG.state.getPrimaryTopic(w)) || OTHER_COLOR;
      const color = _hexToColor(colorHex);

      let baseR = role === 'senior' ? 0.24 : role === 'first' ? 0.20 : 0.13;
      baseR += Math.sqrt(cites) * 0.008;
      const r = Math.min(baseR, 0.52);

      let mesh;
      if (role === 'first') {
        // Wireframe = ring aesthetic (same as 2D border-only bubbles)
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(r, 12, 8),
          new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.65 })
        );
      } else {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(r, 14, 10),
          new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity: role === 'senior' ? 0.72 : 0.40,
            shininess: role === 'senior' ? 80 : 30,
          })
        );
      }

      mesh.position.set(x, y, z);
      // Store metadata for tooltip/click
      const sid = w.primary_location && w.primary_location.source && w.primary_location.source.id;
      const stat = sid ? s.sourceStats.get(sid) : null;
      mesh._work = w;
      mesh._journal = stat ? (stat.display_name || '') : '';
      mesh._role = role;
      mesh._ifVal = ifVal;

      _scene.add(mesh);
      _meshes.push(mesh);
    });
  }

  function _onMouseMove(e) {
    const rect = _renderer.domElement.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, _camera);

    const hits = _raycaster.intersectObjects(_meshes, false);
    if (hits.length && hits[0].object._work) {
      _hovered = hits[0].object;
      const m = _hovered;
      const w = m._work;
      const roleLabel = { first: '제1저자', senior: '교신/마지막', middle: '중간저자' }[m._role] || '';
      _tooltip.innerHTML = [
        `<strong>${(w.title || '').length > 72 ? w.title.slice(0, 70) + '…' : (w.title || '')}</strong>`,
        [m._journal, w.publication_year].filter(Boolean).join(' · '),
        [`${w.cited_by_count || 0} 인용`, roleLabel, m._ifVal ? `IF ${m._ifVal.toFixed(1)}` : ''].filter(Boolean).join(' · '),
      ].join('<br>');
      _tooltip.style.display = 'block';
      const cr = _container.getBoundingClientRect();
      let tx = e.clientX - cr.left + 14;
      if (tx + 268 > _container.clientWidth) tx = e.clientX - cr.left - 278;
      _tooltip.style.left = tx + 'px';
      _tooltip.style.top = (e.clientY - cr.top - 6) + 'px';
      _renderer.domElement.style.cursor = 'pointer';
    } else {
      _hovered = null;
      _tooltip.style.display = 'none';
      _renderer.domElement.style.cursor = 'default';
    }
  }

  function _onClick() {
    if (!_hovered || !_hovered._work) return;
    const w = _hovered._work;
    if (w.doi) window.open(`https://doi.org/${w.doi.replace('https://doi.org/', '')}`, '_blank');
  }

  function _resize() {
    if (!_renderer || !_container || !_camera) return;
    const w = _container.clientWidth;
    const h = _container.clientHeight;
    if (!w || !h) return;
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    _renderer.setSize(w, h);
  }

  function _animate() {
    requestAnimationFrame(_animate);
    if (_controls) _controls.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  }

  return { init };
})();
