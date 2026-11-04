// Publication Explorer: stable 2D projections + an orthographic 3D scatterplot.
// One paper = one equal-sized mark. Selection is shared between every view and list.
window.RKG = window.RKG || {};
RKG.bubble3d = (function() {
  'use strict';
  const esc = RKG.util.escapeHtml;
  const PALETTE = ['#0071E3','#248A3D','#B25000','#8944AB','#0092A8','#D70015','#5856D6'];
  const ROLE = {first:'First author', senior:'Last author', middle:'Middle author', none:'Unknown role'};
  const ROLE_COLOR = {first:'#0071E3', senior:'#8944AB', middle:'#248A3D', none:'#86868B'};
  const VIEWS = {
    citations: {title:'Citation history', x:'year', y:'cites'},
    journal: {title:'Journal history', x:'year', y:'metric'},
    impact: {title:'Journal metric & paper citations', x:'metric', y:'cites'},
    '3d': {title:'A career in three dimensions'}
  };
  const AXIS = {year:'Publication year', cites:'Citations', metric:'Journal metric (JIF / OA)'};
  const $ = id => document.getElementById(id);
  let _ready = false, _active = false, _view = 'citations', _colorBy = 'topic', _scale = 'sqrt';
  let _all = [], _filtered = [], _plotted = [], _topicColors = new Map(), _filterKey = null;
  let _selected = null, _group = null, _limit = 40, _fit = null, _domain, _stateKey = '';
  let _authorRef, _worksRef, _statsRef, _plot, _svg, _tooltip, _empty, _zoom;
  let _transform, _screenPoints = [], _scene, _camera, _renderer, _controls, _cloud, _guides;
  let _labels = [], _meshes = [], _frame = 0, _pointerStart = null, _dragged = false, _threeFailed = false;

  function init() {
    RKG.state.subscribe(() => { if (_ready) { sync(); if (_active) render(); } });
    document.addEventListener('rkg:tab-shown', e => {
      _active = e.detail.tab === 'bubble3d';
      if (!_active) { stopAnimation(); hideTooltip(); return; }
      if (!_ready) setup();
      if (_ready) { sync(); render(); }
    });
  }

  function setup() {
    _plot = $('bubble-3d-container');
    if (!_plot || !window.d3) return;
    _ready = true;
    _transform = d3.zoomIdentity;
    _svg = d3.select(_plot).append('svg').attr('role','img').attr('aria-label','Publication scatterplot. Use the adjacent paper list to select papers.');
    _tooltip = document.createElement('div');
    _tooltip.className = 'explorer-tooltip'; _tooltip.hidden = true;
    _plot.appendChild(_tooltip);
    _empty = document.createElement('div'); _empty.className = 'explorer-empty';
    _empty.style.display = 'none'; _plot.appendChild(_empty);
    document.querySelectorAll('[data-explorer-view]').forEach(btn => btn.addEventListener('click', () => {
      _view = btn.dataset.explorerView; _group = null; _transform = d3.zoomIdentity;
      hideTooltip(); render();
    }));
    $('explorer-color').addEventListener('change', e => { _colorBy = e.target.value; _filterKey = null; _group = null; _fit = null; _transform = d3.zoomIdentity; render(); });
    $('explorer-scale').addEventListener('change', e => { _scale = e.target.value; _transform = d3.zoomIdentity; render(); });
    $('explorer-fit').addEventListener('click', () => {
      if (!_filtered.length) return;
      _fit = makeDomain(visiblePapers()); _transform = d3.zoomIdentity; render(); resetCamera();
    });
    $('bubble-3d-reset').addEventListener('click', () => {
      _fit = null; _transform = d3.zoomIdentity; render(); resetCamera();
    });
    $('explorer-search').addEventListener('input', () => { _limit = 40; renderList(); });
    $('explorer-clear-group').addEventListener('click', () => { _group = null; renderList(); });
    $('explorer-more').addEventListener('click', () => { _limit += 40; renderList(); });
    $('explorer-paper-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-paper]'); if (btn) selectPaper(btn.dataset.paper);
    });
    _zoom = d3.zoom().scaleExtent([1,12]).on('zoom', e => {
      _transform = e.transform; hideTooltip(); draw2D();
      $('explorer-domain').textContent = e.transform.k > 1.01 ? 'Zoomed view · Reset to restore' : (_fit ? 'Fitted to filtered papers' : 'Career-wide axes');
    });
    _svg.call(_zoom).on('dblclick.zoom', null);
    new ResizeObserver(() => { if (_active) draw(); }).observe(_plot);
  }

  function numeric(value) { return value != null && value !== '' && Number.isFinite(+value) && +value >= 0 ? +value : null; }
  function sync() {
    const s = RKG.state.get();
    const newAuthor = s.author !== _authorRef;
    if (newAuthor) {
      _selected = null; _fit = null; _group = null; _filterKey = null; _limit = 40;
      _transform = d3.zoomIdentity; $('explorer-search').value = '';
      _authorRef = s.author;
    }
    if (newAuthor || s.works !== _worksRef || s.sourceStats !== _statsRef) {
      _worksRef = s.works; _statsRef = s.sourceStats;
      _all = s.works.map((w,i) => {
        const source = w.primary_location && w.primary_location.source;
        const stat = source ? s.sourceStats.get(source.id) : null;
        return {id:String(w.id || w.doi || 'paper-'+i), work:w, year:numeric(w.publication_year),
          cites:numeric(w.cited_by_count), metric:numeric(stat && stat.if_2yr),
          source:stat && stat.if_source, journal:(stat && stat.display_name) || (source && source.display_name) || 'Unknown journal',
          role:RKG.state.getAuthorshipRole(w), topic:RKG.state.getPrimaryTopic(w) || 'Unclassified'};
      });
      const counts = d3.rollup(_all, v => v.length, p => p.topic);
      _topicColors = new Map([...counts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,7).map(([t],i) => [t,PALETTE[i]]));
      _domain = makeDomain(_all);
      _fit = null;
      if (!_all.some(p => p.id === _selected)) _selected = null;
    }
    const stateKey = [s.filteredYearMin,s.filteredYearMax,s.authorshipRole,s.selectedCoauthor].join('|');
    if (stateKey !== _stateKey) { _fit = null; _group = null; _transform = d3.zoomIdentity; _stateKey = stateKey; }
    const works = new Set(RKG.state.getFilteredWorks());
    _filtered = _all.filter(p => works.has(p.work));
  }
  function makeDomain(papers) {
    const years = papers.map(p => p.year).filter(y => y != null);
    const lo = d3.min(years) || new Date().getFullYear();
    const hi = d3.max(years) || lo;
    return {year:[lo === hi ? lo-1 : lo,lo === hi ? hi+1 : hi],
      cites:[0,Math.max(1,d3.max(papers,p => p.cites) || 0)], metric:[0,Math.max(1,d3.max(papers,p => p.metric) || 0)]};
  }
  function category(p) { return _colorBy === 'role' ? p.role : (_topicColors.has(p.topic) ? p.topic : '__other'); }
  function color(p) { return _colorBy === 'role' ? ROLE_COLOR[p.role] : (_topicColors.get(p.topic) || '#86868B'); }
  function visiblePapers() { return _filtered.filter(p => !_filterKey || category(p) === _filterKey); }
  function canPlot(p) {
    if (_view === '3d') return p.year != null && p.metric != null && p.cites != null;
    const v = VIEWS[_view]; return p[v.x] != null && p[v.y] != null;
  }
  function render() {
    if (!_ready) return;
    const filteredWorks = new Set(RKG.state.getFilteredWorks());
    _filtered = _all.filter(p => filteredWorks.has(p.work));
    const papers = visiblePapers();
    _plotted = papers.filter(canPlot);
    document.querySelectorAll('[data-explorer-view]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.explorerView === _view)));
    $('explorer-chart-title').textContent = VIEWS[_view].title;
    $('explorer-count').textContent = `${_plotted.length} of ${_all.length} papers plotted${_filterKey ? ' · color filter active' : ''}`;
    $('explorer-domain').textContent = _fit ? 'Fitted to filtered papers' : 'Career-wide axes';
    $('explorer-gesture').textContent = _view === '3d' ? 'Drag to rotate · Shift-drag to pan · Scroll to zoom · Click to select' : 'Click to select · Scroll / pinch to zoom · Drag to pan';
    $('explorer-fit').disabled = !papers.length;
    const missing = papers.length-_plotted.length;
    $('explorer-missing').textContent = missing ? `${missing} paper${missing===1?'':'s'} missing a required value; available in the paper list. Unknown is not zero.` : '';
    renderLegend(); renderDetail(); renderList(); draw();
  }
  function renderLegend() {
    const entries = _colorBy === 'role' ? Object.entries(ROLE_COLOR).filter(([k]) => _all.some(p => p.role===k)).map(([k,c]) => [k,ROLE[k],c]) : [..._topicColors].map(([k,c]) => [k,k,c]);
    if (_colorBy === 'topic' && _all.some(p => !_topicColors.has(p.topic))) entries.push(['__other','Other topics','#86868B']);
    const root = $('explorer-legend'); root.replaceChildren();
    entries.forEach(([key,label,c]) => {
      const btn = document.createElement('button'); btn.type='button';
      btn.setAttribute('aria-pressed',String(!_filterKey || key===_filterKey));
      btn.title = 'Show only '+label;
      btn.innerHTML = `<span class="explorer-swatch" style="background:${c}"></span>${esc(label)}`;
      btn.addEventListener('click', () => { _filterKey = _filterKey===key ? null : key; _group=null; _fit=null; _transform=d3.zoomIdentity; render(); });
      root.appendChild(btn);
    });
    if (_filterKey) {
      const reset=document.createElement('button'); reset.type='button'; reset.className='explorer-legend-reset'; reset.textContent='Show all';
      reset.addEventListener('click',()=>{_filterKey=null; _group=null; _fit=null; _transform=d3.zoomIdentity; render();});root.appendChild(reset);
    }
  }
  function selectPaper(id) {
    _selected=id; renderDetail(); renderList();
    if (_view==='3d') updateSelection3D(); else draw2D();
  }
  function renderDetail() {
    const p = _all.find(p => p.id===_selected);
    if (!p) {
      $('explorer-detail').innerHTML='<div class="explorer-detail-empty"><span class="explorer-detail-eyebrow">One dot. One paper.</span><strong>Explore the story behind a point.</strong><p>Select a paper on the chart or in the list. Its details stay with you as you switch views.</p></div>'; return;
    }
    const inFilter = visiblePapers().some(q => q.id===p.id);
    let link = '';
    if (p.work.doi) {
      const doi = String(p.work.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'');
      link = `<a class="explorer-detail-link" href="${esc('https://doi.org/'+encodeURI(doi))}" target="_blank" rel="noopener noreferrer">Open publication ↗</a>`;
    } else if (p.work._pmid && /^\d+$/.test(String(p.work._pmid))) {
      link = `<a class="explorer-detail-link" href="https://pubmed.ncbi.nlm.nih.gov/${p.work._pmid}/" target="_blank" rel="noopener noreferrer">Open in PubMed ↗</a>`;
    }
    const metricLabel = p.metric==null ? 'Journal metric unavailable' : p.source==='JCR' ? 'JCR 2025 JIF' : p.source==='OA' ? 'OpenAlex 2-year mean' : 'Journal metric · source unknown';
    $('explorer-detail').innerHTML = `<div class="explorer-detail-eyebrow"><span class="explorer-swatch" style="background:${color(p)}"></span>Selected paper · ${esc(p.year || 'Unknown year')}</div>
      <h4 class="explorer-detail-title">${esc(p.work.title || 'Untitled paper')}</h4><p class="explorer-detail-journal">${esc(p.journal)}</p>
      <div class="explorer-detail-metrics"><div><strong>${p.cites==null?'—':p.cites.toLocaleString()}</strong><span>Citations</span></div><div><strong>${p.metric==null?'—':p.metric.toFixed(2)}</strong><span>${metricLabel}</span></div></div>
      <div class="explorer-detail-meta"><span>${ROLE[p.role]}</span><span>${esc(p.topic)}</span></div>${link}
      ${!inFilter?'<p class="explorer-detail-notice">This selection is outside the current filters.</p>':!canPlot(p)?'<p class="explorer-detail-notice">A required value is unknown, so this paper is not plotted in this view.</p>':''}`;
  }
  function renderList() {
    const focused = document.activeElement && document.activeElement.dataset.paper;
    const query = $('explorer-search').value.trim().toLowerCase();
    const papers = visiblePapers().filter(p => (!_group || _group.includes(p.id)) && (!query || ((p.work.title||'')+' '+p.journal).toLowerCase().includes(query)))
      .sort((a,b) => (b.cites ?? -1)-(a.cites ?? -1) || (b.year||0)-(a.year||0) || a.id.localeCompare(b.id));
    $('explorer-list-title').textContent = `${_group?'Nearby papers':'Filtered papers'} · ${papers.length}`;
    $('explorer-clear-group').hidden = !_group;
    $('explorer-paper-list').innerHTML = papers.slice(0,_limit).map(p => `<button type="button" class="explorer-paper-row" data-paper="${esc(p.id)}" aria-pressed="${p.id===_selected}"><span class="explorer-paper-row-title"><span class="explorer-swatch" style="background:${color(p)}"></span><span>${esc(p.work.title||'Untitled paper')}</span></span><span class="explorer-paper-row-meta">${esc(p.year||'Year unknown')} · ${p.cites==null?'Citations unknown':p.cites.toLocaleString()+' citations'}${!canPlot(p)?' · Not plotted':''}</span></button>`).join('') || '<p class="explorer-list-empty">No papers match. Adjust the filters or search.</p>';
    $('explorer-more').hidden = papers.length <= _limit;
    if (focused) [...$('explorer-paper-list').querySelectorAll('[data-paper]')].find(b=>b.dataset.paper===focused)?.focus({preventScroll:true});
  }
  function scaleFor(key,range) {
    const domain = (_fit||_domain)[key];
    const s = key==='year' || _scale==='linear' ? d3.scaleLinear() : d3.scaleSqrt();
    return s.domain(domain).range(range);
  }
  function ticks(s,key,count) {
    if (key==='year') return s.ticks(count).filter(Number.isInteger);
    if (_scale==='linear') return s.ticks(count).filter(n => n>=0 && (key!=='cites'||Number.isInteger(n)));
    const [lo,hi]=s.domain();
    const values = [0];
    for(let e=-1;e<=9;e++) for(const m of [1,2,5]) {const v=m*Math.pow(10,e);if(v>0 && (key!=='cites'||Number.isInteger(v)))values.push(v);}
    let last=null;
    return values.filter(v=>v>=Math.max(0,lo)&&v<=hi).sort((a,b)=>a-b).filter(v=>{const pos=s(v);if(last!=null&&Math.abs(pos-last)<32)return false;last=pos;return true;});
  }
  function formatTick(n) { return n>=1000 ? d3.format('~s')(n) : d3.format('~g')(n); }
  function axisLabel(key) { return AXIS[key]+(key!=='year' ? (_scale==='sqrt'?' · √ scale':' · linear') : ''); }
  function draw() {
    if (!_active || !_plot.clientWidth) return;
    hideTooltip();
    if (_view==='3d') { _svg.style('display','none'); draw3D(); }
    else {
      stopAnimation(); if (_renderer) _renderer.domElement.style.display='none';
      _labels.forEach(l=>l.el.hidden=true);
      _svg.style('display','block'); _svg.property('__zoom',_transform); draw2D();
    }
  }
  function showEmpty(message) {
    _empty.style.display=message?'flex':'none';
    _empty.innerHTML=message?`<strong>${esc(message)}</strong><span>Change the filters or choose another view.</span>`:'';
  }
  function draw2D() {
    if (!_active || _view==='3d') return;
    const w=_plot.clientWidth,h=_plot.clientHeight;
    if(!w||!h)return;
    const m={left:68,right:28,top:30,bottom:58};
    const v=VIEWS[_view];
    const sx=_transform.rescaleX(scaleFor(v.x,[m.left+8,w-m.right-8]));
    const sy=_transform.rescaleY(scaleFor(v.y,[h-m.bottom-8,m.top+8]));
    const tx=ticks(sx,v.x,w<460?4:6),ty=ticks(sy,v.y,6);
    _svg.attr('viewBox',`0 0 ${w} ${h}`).selectAll('*').remove();
    _svg.append('defs').append('clipPath').attr('id','explorer-clip').append('rect').attr('x',m.left).attr('y',m.top).attr('width',w-m.left-m.right).attr('height',h-m.top-m.bottom);
    const ygrid=_svg.append('g').attr('class','grid').attr('transform',`translate(${m.left},0)`).call(d3.axisLeft(sy).tickValues(ty).tickSize(-(w-m.left-m.right)).tickFormat(''));
    ygrid.selectAll('text').remove();
    _svg.append('g').attr('transform',`translate(0,${h-m.bottom})`).call(d3.axisBottom(sx).tickValues(tx).tickFormat(v.x==='year'?d3.format('d'):formatTick).tickSizeOuter(0).tickPadding(10));
    _svg.append('g').attr('transform',`translate(${m.left},0)`).call(d3.axisLeft(sy).tickValues(ty).tickFormat(formatTick).tickSize(0).tickPadding(10)).select('.domain').remove();
    _svg.append('text').attr('class','axis-title').attr('x',(m.left+w-m.right)/2).attr('y',h-13).attr('text-anchor','middle').text(axisLabel(v.x));
    _svg.append('text').attr('class','axis-title').attr('x',m.left).attr('y',17).text(axisLabel(v.y));
    const dots=_svg.append('g').attr('clip-path','url(#explorer-clip)');
    _screenPoints=_plotted.map(p=>({p,x:sx(p[v.x]),y:sy(p[v.y])})).filter(d=>d.x>=m.left&&d.x<=w-m.right&&d.y>=m.top&&d.y<=h-m.bottom);
    dots.selectAll('circle.paper').data(_screenPoints).join('circle').attr('class','paper').attr('cx',d=>d.x).attr('cy',d=>d.y).attr('r',4.5).attr('fill',d=>color(d.p)).attr('fill-opacity',.78).attr('stroke','#fff').attr('stroke-width',1);
    const chosen=_screenPoints.find(d=>d.p.id===_selected);
    if(chosen) {
      dots.append('path').attr('d',`M${m.left},${chosen.y}H${chosen.x}V${h-m.bottom}`).attr('fill','none').attr('stroke',color(chosen.p)).attr('stroke-dasharray','4 4').attr('stroke-opacity',.6);
      dots.append('circle').attr('cx',chosen.x).attr('cy',chosen.y).attr('r',8.5).attr('fill','#fff').attr('stroke',color(chosen.p)).attr('stroke-width',2);
      dots.append('circle').attr('cx',chosen.x).attr('cy',chosen.y).attr('r',4.5).attr('fill',color(chosen.p));
    }
    // A few collision-checked annotations keep the overview legible.
    const occupied=[];
    [..._screenPoints].sort((a,b)=>(b.p.id===_selected)-(a.p.id===_selected)||(b.p.cites||0)-(a.p.cites||0)).slice(0,w<460?1:4).forEach(d=>{
      const text=d.p.id===_selected?'Selected':`${d.p.year} · ${d.p.cites==null?'—':d.p.cites.toLocaleString()} cites`;
      const label=dots.append('text').attr('x',d.x+10).attr('y',d.y<m.top+24?d.y+20:d.y-11).attr('font-size',11).attr('fill','#515154').text(text);
      let box=label.node().getBBox();
      if(box.x+box.width>w-m.right) {label.attr('x',d.x-10).attr('text-anchor','end');box=label.node().getBBox();}
      if(box.y<m.top||box.x<m.left||occupied.some(b=>box.x<b.x+b.width+6&&box.x+box.width+6>b.x&&box.y<b.y+b.height+6&&box.y+box.height+6>b.y))label.remove();else occupied.push(box);
    });
    const hit=_svg.append('rect').attr('x',m.left).attr('y',m.top).attr('width',w-m.left-m.right).attr('height',h-m.top-m.bottom).attr('fill','transparent').attr('class','explorer-mark');
    hit.on('pointermove',e=>{
      if(e.buttons){hideTooltip();return;}
      const [x,y]=d3.pointer(e,_svg.node());const near=nearby(x,y,14);
      if(near.length)showTooltip(near[0].p,near.length,x,y);else hideTooltip();
    }).on('pointerleave',hideTooltip).on('click',e=>{
      if(e.defaultPrevented)return;
      const [x,y]=d3.pointer(e,_svg.node());const near=nearby(x,y,e.pointerType==='touch'?24:14);
      if(near.length){_group=near.length>1?near.map(d=>d.p.id):null;selectPaper(near[0].p.id);}
    });
    showEmpty(!_plotted.length ? (_filtered.length?'No papers with values for these axes':'No papers match these filters') : null);
  }
  function nearby(x,y,r) {
    return _screenPoints.map(d=>({...d,distance:Math.hypot(d.x-x,d.y-y)})).filter(d=>d.distance<=r).sort((a,b)=>a.distance-b.distance || (a.z||0)-(b.z||0));
  }
  function showTooltip(p,n,x,y) {
    _tooltip.innerHTML=`<strong>${esc(p.work.title||'Untitled paper')}</strong>${esc(p.year||'Unknown year')} · ${p.cites==null?'Citations unknown':p.cites.toLocaleString()+' citations'}<br>${n>1?`${n} nearby papers · click to choose`:'Click to keep details open'}`;
    _tooltip.hidden=false;
    _tooltip.style.left=Math.max(8,Math.min(x+14,_plot.clientWidth-_tooltip.offsetWidth-8))+'px';
    _tooltip.style.top=Math.max(8,Math.min(y+14,_plot.clientHeight-_tooltip.offsetHeight-8))+'px';
  }
  function hideTooltip(){if(_tooltip)_tooltip.hidden=true;}

  function setup3D() {
    if(_renderer)return true;
    if(_threeFailed)return false;
    try {
      if(!window.THREE || !THREE.OrbitControls)throw new Error('Three.js unavailable');
      _scene=new THREE.Scene();_scene.background=new THREE.Color('#FFFFFF');
      _camera=new THREE.OrthographicCamera(-12,12,9,-9,.1,200);
      _renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
      _renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      _renderer.domElement.setAttribute('aria-label','3D publication chart. Select a paper from the adjacent list for accessible details.');
      _plot.insertBefore(_renderer.domElement,_tooltip);
      _controls=new THREE.OrbitControls(_camera,_renderer.domElement);
      _controls.enableDamping=true;_controls.dampingFactor=.12;_controls.zoomSpeed=.5;
      _controls.minZoom=.6;_controls.maxZoom=5;
      _controls.maxPolarAngle=Math.PI*.85;_controls.minPolarAngle=.12;
      _controls.addEventListener('change',()=>{hideTooltip();});
      _renderer.domElement.addEventListener('pointerdown',e=>{_pointerStart={x:e.clientX,y:e.clientY};_dragged=false;});
      _renderer.domElement.addEventListener('pointermove',e=>{
        if(_pointerStart && Math.hypot(e.clientX-_pointerStart.x,e.clientY-_pointerStart.y)>5)_dragged=true;
        if(e.buttons){hideTooltip();return;}
        const r=_plot.getBoundingClientRect(),near=nearby(e.clientX-r.left,e.clientY-r.top,14);
        if(near.length)showTooltip(near[0].p,near.length,e.clientX-r.left,e.clientY-r.top);else hideTooltip();
      });
      _renderer.domElement.addEventListener('pointerleave',hideTooltip);
      _renderer.domElement.addEventListener('pointercancel',()=>{_pointerStart=null;_dragged=true;});
      _renderer.domElement.addEventListener('click',e=>{
        if(_dragged||e.button!==0)return;
        const r=_plot.getBoundingClientRect(),near=nearby(e.clientX-r.left,e.clientY-r.top,e.pointerType==='touch'?24:14);
        if(near.length){_group=near.length>1?near.map(d=>d.p.id):null;selectPaper(near[0].p.id);}
        _pointerStart=null;
      });
      resetCamera();return true;
    } catch(e) {
      _threeFailed=true;return false;
    }
  }
  function resetCamera() {
    if(!_controls)return; // setup3D can fail after creating the camera, when WebGL is unavailable.
    _camera.position.set(18,13,23);_camera.up.set(0,1,0);_camera.zoom=1;
    _controls.target.set(0,3,3);_controls.update();_camera.updateProjectionMatrix();
  }
  function disposeGroup(group) {
    if(!group)return;
    _scene.remove(group);const geometries=new Set(),materials=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
  function line(group,a,b,color,opacity=1) {
    const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);
    const obj=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));group.add(obj);return obj;
  }
  function label(text,pos,title=false) {
    const el=document.createElement('span');el.className='explorer-axis-label'+(title?' axis-title':'');el.textContent=text;
    _plot.appendChild(el);_labels.push({el,pos:new THREE.Vector3(...pos),title});
  }
  function draw3D() {
    if(!setup3D()) {
      showEmpty(null);_empty.style.display='flex';
      _empty.innerHTML='<strong>3D is unavailable in this browser.</strong><span>The three 2D views and paper details are still available.</span>';return;
    }
    _renderer.domElement.style.display='block';
    const w=_plot.clientWidth,h=_plot.clientHeight;
    _renderer.setSize(w,h);
    // Fit the box at the default orientation, including numerical axis labels.
    const halfH=Math.max(8.5,13*h/w);
    _camera.left=-halfH*w/h;_camera.right=halfH*w/h;_camera.top=halfH;_camera.bottom=-halfH;_camera.updateProjectionMatrix();
    disposeGroup(_cloud);_cloud=new THREE.Group();_scene.add(_cloud);_meshes=[];
    _labels.forEach(l=>l.el.remove());_labels=[];
    const sx=scaleFor('year',[-8,8]),sy=scaleFor('metric',[0,7]),sz=scaleFor('cites',[0,7]);
    const dom=_fit||_domain;
    // Three bounded data planes; no decorative infinite floor.
    ticks(scaleFor('year',[0,500]),'year',6).forEach(t=>{
      const x=sx(t);line(_cloud,[x,0,0],[x,0,7],'#E8ECF1');line(_cloud,[x,0,0],[x,7,0],'#EDF0F4');label(String(t),[x,-.45,7.25]);
    });
    // Explicit transformed tick positions: labels always show original values.
    const metricTicks=ticks(scaleFor('metric',[0,350]),'metric',5);
    metricTicks.forEach(t=>{const y=sy(t);line(_cloud,[-8,y,0],[8,y,0],'#E8ECF1');label(formatTick(t),[-8.6,y,0]);});
    ticks(scaleFor('cites',[0,350]),'cites',5).forEach(t=>{const z=sz(t);line(_cloud,[-8,0,z],[8,0,z],'#E8ECF1');label(formatTick(t),[8.65,0,z]);});
    line(_cloud,[-8,0,7],[8,0,7],'#AAB4C1');line(_cloud,[-8,0,0],[-8,7,0],'#AAB4C1');line(_cloud,[8,0,0],[8,0,7],'#AAB4C1');
    label('Publication year',[0,-1.2,7.3],true);
    label('Journal metric'+(_scale==='sqrt'?' · √':''),[-8.2,8,0],true);
    label('Citations'+(_scale==='sqrt'?' · √':''),[9.2,-.8,3.5],true);
    const sphere=new THREE.SphereGeometry(.105,10,8);
    const mats=new Map();
    _plotted.forEach(p=>{
      if(p.year<dom.year[0]||p.year>dom.year[1]||p.metric>dom.metric[1]||p.cites>dom.cites[1])return;
      const c=color(p);if(!mats.has(c))mats.set(c,new THREE.MeshBasicMaterial({color:c}));
      const mesh=new THREE.Mesh(sphere,mats.get(c));mesh.position.set(sx(p.year),sy(p.metric),sz(p.cites));mesh.userData.paper=p;
      _cloud.add(mesh);_meshes.push(mesh);
    });
    if(!_meshes.length)sphere.dispose();
    updateSelection3D();showEmpty(!_plotted.length?'No papers with values for all three axes':null);
    startAnimation();
  }
  function updateSelection3D() {
    if(!_scene)return;
    disposeGroup(_guides);_guides=new THREE.Group();_scene.add(_guides);
    const chosen=_meshes.find(m=>m.userData.paper.id===_selected);
    _meshes.forEach(m=>m.scale.setScalar(m===chosen?1.6:1));
    if(chosen) {
      const {x,y,z}=chosen.position,c=color(chosen.userData.paper);
      line(_guides,[x,y,z],[x,0,z],c,.7);line(_guides,[x,0,z],[x,0,7],c,.7);
      line(_guides,[x,y,z],[x,y,0],c,.7);line(_guides,[x,y,0],[-8,y,0],c,.7);
      line(_guides,[x,0,z],[8,0,z],c,.7);
      const ring=new THREE.Mesh(new THREE.SphereGeometry(.22,12,8),new THREE.MeshBasicMaterial({color:c,wireframe:true,transparent:true,opacity:.45}));
      ring.position.copy(chosen.position);_guides.add(ring);
    }
  }
  function projectScene() {
    const w=_plot.clientWidth,h=_plot.clientHeight,occupied=[];
    _screenPoints=_meshes.map(m=>{const v=m.position.clone().project(_camera);return {p:m.userData.paper,x:(v.x+1)*w/2,y:(1-v.y)*h/2,z:v.z};}).filter(d=>d.z>=-1&&d.z<=1&&d.x>=0&&d.x<=w&&d.y>=0&&d.y<=h);
    [..._labels].sort((a,b)=>Number(b.title)-Number(a.title)).forEach(l=>{
      const v=l.pos.clone().project(_camera),x=(v.x+1)*w/2,y=(1-v.y)*h/2;
      l.el.hidden=false;
      const width=l.el.offsetWidth||50,height=l.el.offsetHeight||14;
      const box={x:x-width/2,y:y-height/2,w:width,h:height};
      const hidden=v.z < -1||v.z>1||box.x<2||box.x+width>w-2||box.y<2||box.y+height>h-2||occupied.some(b=>box.x<b.x+b.w+3&&box.x+box.w+3>b.x&&box.y<b.y+b.h+3&&box.y+box.h+3>b.y);
      l.el.hidden=hidden;l.el.style.left=x+'px';l.el.style.top=y+'px';if(!hidden)occupied.push(box);
    });
  }
  function startAnimation() {
    if(_frame)return;
    const tick=()=>{
      // New search hides the dashboard without a tab change; the resize observer restarts this.
      if(!_active||_view!=='3d'||document.hidden||!_plot.clientWidth){_frame=0;return;}
      _controls.update();_renderer.render(_scene,_camera);projectScene();_frame=requestAnimationFrame(tick);
    };
    _frame=requestAnimationFrame(tick);
  }
  function stopAnimation(){if(_frame)cancelAnimationFrame(_frame);_frame=0;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&_active&&_view==='3d'&&_renderer)startAnimation();else stopAnimation();});
  return {init};
})();
