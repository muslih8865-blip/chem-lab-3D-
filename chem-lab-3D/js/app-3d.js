// app-3d.js - main logic with lightweight Three.js scenes per tube
// Assumes three.min.js is loaded by CDN (r152 used in HTML)
const MATERIALS = [
  { id:'HCl', name:'HCl', color:'#fef08a', type:'acid', desc:'حمض قوي — يتفاعل مع المعادن والقلويات.'},
  { id:'NaOH', name:'NaOH', color:'#a7f3d0', type:'base', desc:'قاعدة قوية — تعادل الأحماض.'},
  { id:'CuSO4', name:'CuSO4', color:'#60a5fa', type:'salt', desc:'محلول أزرق يعكس أيونات النحاس.'},
  { id:'Zn', name:'Zn', color:'#cbd5e1', type:'metal', desc:'معدن — يطلق H₂ عند التفاعل مع الأحماض.'},
  { id:'H2O2', name:'H2O2', color:'#fda4af', type:'oxidizer', desc:'بيروكسيد — يتحلل إلى ماء وأكسجين.'},
  { id:'MnO2', name:'MnO2', color:'#94a3b8', type:'catalyst', desc:'محفز لتحلل الـ H2O2.'},
];

const REACTIONS = [
  { name:'حمض + معدن → تصاعد غاز', requires:['HCl','Zn'], result:{effect:'bubbles', color:'#fff2cc', info:'تفاعل حمض + معدن يُطلق غاز الهيدروجين.'}, points:10 },
  { name:'حمض + قاعدة → ملح + ماء', requires:['HCl','NaOH'], result:{effect:'colorChange', color:'#c7f9e4', info:'تفاعل التعادل — تشكل ملح وماء.'}, points:8 },
  { name:'بيروكسيد + محفز → رغوة', requires:['H2O2','MnO2'], result:{effect:'foam', color:'#ffffff', info:'تحلل H2O2 بسرعة → رغوة (أكسجين + ماء).'}, points:15 },
];

// DOM refs
const materialsDiv = document.getElementById('materials');
const dropzones = document.querySelectorAll('.dropzone');
const scoreSpan = document.getElementById('score');
const logDiv = document.getElementById('log');
const quickDiv = document.getElementById('quickResults');
const infoText = document.getElementById('infoText');
const toggle3DBtn = document.getElementById('toggle3D');

let enable3D = (localStorage.getItem('chem_3d') || 'true') === 'true';
toggle3DBtn.textContent = enable3D ? 'تعطيل 3D' : 'تفعيل 3D';

// per-tube state
const tubes = {};
const tubeScenes = {}; // { tubeId: { renderer, scene, camera, mixers..., particles:[] } }

// init materials list
MATERIALS.forEach(mat => {
  const el = document.createElement('div'); el.className='chem'; el.draggable=true; el.dataset.id=mat.id;
  el.innerHTML = `<div class="swatch" style="background:${mat.color}">${mat.id.replace(/[^A-Za-z0-9₂₃₄₅₆₇₈₉₀]/g,'')}</div><div style="font-size:12px;color:var(--muted)">${mat.name}</div>`;
  el.title = mat.desc; el.addEventListener('dragstart', e=> e.dataTransfer.setData('text/plain', mat.id));
  materialsDiv.appendChild(el);
});

// prepare tubes and (optionally) attach three.js small renderers
dropzones.forEach(z => {
  const id = z.dataset.tube; tubes[id]=[];
  // create a canvas container for three scene
  const canvasEl = document.createElement('div'); canvasEl.className='tube-canvas'; z.appendChild(canvasEl);
  // init scene object (but build renderer only if 3D enabled)
  tubeScenes[id] = { container: canvasEl, active:false, particles:[], lastTime:performance.now() };
  // drag handlers
  z.addEventListener('dragover', e=>{ e.preventDefault(); z.style.outline='2px dashed rgba(96,165,250,0.6)';});
  z.addEventListener('dragleave', e=>{ z.style.outline='none';});
  z.addEventListener('drop', e=>{ e.preventDefault(); z.style.outline='none'; const mid = e.dataTransfer.getData('text/plain'); if(mid) addMaterialToTube(id, mid); });
});

// utilities for color blending
function hexToRgb(hex){ hex=hex.replace('#',''); if(hex.length===3) hex=hex.split('').map(c=>c+c).join(''); const num=parseInt(hex,16); return {r:(num>>16)&255,g:(num>>8)&255,b:num&255}; }
function blendColors(colors){ if(colors.length===1) return colors[0]; const rgbs=colors.map(hexToRgb); const avg=rgbs.reduce((a,c)=>{a.r+=c.r;a.g+=c.g;a.b+=c.b;return a},{r:0,g:0,b:0}); avg.r=Math.round(avg.r/rgbs.length);avg.g=Math.round(avg.g/rgbs.length);avg.b=Math.round(avg.b/rgbs.length); return `rgb(${avg.r},${avg.g},${avg.b})`; }

// add material to tube
function addMaterialToTube(tid, mid){
  if(tubes[tid].length>=3){ pushLog(`الأنبوب ${tid} ممتلئ`); return; }
  tubes[tid].push(mid); updateTubeVisual(tid); pushLog(`أضفت ${mid} إلى أنبوب ${tid}`);
}

// update visuals (2D liquid) and reflect 3D color if enabled
function updateTubeVisual(tid){
  const zone = document.querySelector(`.dropzone[data-tube="${tid}"]`);
  const items = tubes[tid]; const contents = zone.parentElement.querySelector('.contents'); const liq = zone.querySelector('.liquid');
  contents.textContent = items.length? items.join(' + ') : 'فارغ';
  const height = Math.min(90, items.length*30); liq.style.height = height + '%';
  if(items.length===0){ liq.style.background='transparent'; } else { const cols = items.map(id=> (MATERIALS.find(m=>m.id===id)||{}).color||'#fff'); liq.style.background = blendColors(cols); }
  // if 3D enabled, update tube scene ambient color
  if(enable3D) ensureTubeScene(tid);
  if(enable3D && tubeScenes[tid].scene){
    // set a gentle tint light based on blend
    const cols = items.length? items.map(id=> (MATERIALS.find(m=>m.id===id)||{}).color||'#fff') : ['#000000'];
    const tint = hexToRgb( (cols[0]||'#ffffff') );
    const light = tubeScenes[tid].tintLight; if(light) light.color.setRGB(tint.r/255, tint.g/255, tint.b/255);
  }
}

// find reaction (order-insensitive)
function findReaction(items){
  const s = new Set(items);
  for(const rx of REACTIONS){ if(rx.requires.every(x=> s.has(x))) return rx; }
  return null;
}

// mix action
document.getElementById('mixBtn').addEventListener('click', ()=>{
  let any=false; quickDiv.innerHTML='';
  Object.keys(tubes).forEach(tid=>{
    const items = tubes[tid];
    if(items.length>0){ any=true; const rx = findReaction(items); if(rx){ applyReaction(tid, rx); } else { pushQuick(`أنبوب ${tid}: لا يحدث تفاعل ملحوظ.`); pushLog(`أنبوب ${tid}: خليط ${items.join('+')} — لا تفاعل.`); visualPulse(tid); } }
  });
  if(!any) pushLog('لا توجد مواد للخلط.');
});

// apply reaction: points, info, and 3D effect
let score = parseInt(localStorage.getItem('chem_score')||'0',10); scoreSpan.textContent = score;
function applyReaction(tid, reaction){
  const pts = reaction.points||5; pushQuick(`أنبوب ${tid}: ${reaction.name} → +${pts} نقاط`); pushLog(`تفاعل في أنبوب ${tid}: ${reaction.name}`);
  score += pts; scoreSpan.textContent = score; localStorage.setItem('chem_score', score);
  // 3D: spawn appropriate particles
  if(enable3D){ if(reaction.result.effect==='bubbles') spawnBubbles3D(tid); else if(reaction.result.effect==='foam') spawnFoam3D(tid); else if(reaction.result.effect==='colorChange') colorFlash3D(tid, reaction.result.color); }
  // default 2D visual pulse
  visualPulse(tid, reaction.result.color);
  tubes[tid]=[]; setTimeout(()=> updateTubeVisual(tid), 700);
  infoText.innerHTML = `<strong>${reaction.name}</strong><br>${reaction.result.info||''}`;
}

// small visual pulse on 2D liquid
function visualPulse(tid, color='#ffffff'){ const zone = document.querySelector(`.dropzone[data-tube="${tid}"]`); const liq = zone.querySelector('.liquid'); const prev = liq.style.background; liq.style.background = color||prev; setTimeout(()=> liq.style.background = prev, 900); flashOnCanvas(zone, color); playSimpleSound('ping'); }

// flash effect on main canvas (reuse small overlay technique)
function flashOnCanvas(zone, color='#fff'){ const rect = zone.getBoundingClientRect(); const parent = document.querySelector('.lab').getBoundingClientRect(); let overlay = zone._flashEl; if(!overlay){ overlay = document.createElement('div'); overlay.style.position='absolute'; overlay.style.left = (rect.left - parent.left) + 'px'; overlay.style.top = (rect.top - parent.top) + 'px'; overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px'; overlay.style.borderRadius='8px'; overlay.style.pointerEvents='none'; overlay.style.background = color; overlay.style.opacity='0.06'; overlay.style.transition='opacity 600ms ease'; document.querySelector('.lab').appendChild(overlay); zone._flashEl = overlay; setTimeout(()=>{ overlay.style.opacity='0'; setTimeout(()=> overlay.remove(),700); }, 80); } }

// audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSimpleSound(kind){ try{ const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type='sine'; if(kind==='ping'){ o.frequency.value=880; g.gain.value=0.02; } else if(kind==='bubble'){ o.frequency.value=300; g.gain.value=0.03; } else { o.frequency.value=440; g.gain.value=0.02; } o.connect(g); g.connect(audioCtx.destination); o.start(); setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.25); o.stop(audioCtx.currentTime+0.26); }, 120+Math.random()*160); }catch(e){} }

// --- THREE.JS mini-scenes management --- //
function ensureTubeScene(tid){
  const ts = tubeScenes[tid]; if(ts.active) return;
  // create renderer
  const w = ts.container.clientWidth || ts.container.offsetWidth || 180;
  const h = ts.container.clientHeight || ts.container.offsetHeight || 110;
  const renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true, preserveDrawingBuffer:false });
  renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ts.container.appendChild(renderer.domElement);
  // scene & camera
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(40, w/h, 0.1, 50); camera.position.set(0,1.6,3);
  // lights
  const ambient = new THREE.AmbientLight(0x223344, 0.8); scene.add(ambient);
  const tint = new THREE.PointLight(0x66bbff, 0.6, 8); tint.position.set(0,1.2,1.2); scene.add(tint);
  // glass cylinder (simple visual)
  const cylGeo = new THREE.CylinderGeometry(0.9,0.9,1.6,24,1,true);
  const cylMat = new THREE.MeshPhysicalMaterial({ color:0x001122, transparent:true, opacity:0.08, roughness:0.05, metalness:0.0, side:THREE.DoubleSide });
  const cylinder = new THREE.Mesh(cylGeo, cylMat); cylinder.rotation.x = Math.PI/2; scene.add(cylinder);
  // small plane to represent liquid surface (we'll animate)
  const planeGeo = new THREE.CircleGeometry(0.7, 32); const planeMat = new THREE.MeshStandardMaterial({ color:0x004466, transparent:true, opacity:0.7, roughness:0.4 });
  const liquidPlane = new THREE.Mesh(planeGeo, planeMat); liquidPlane.rotation.x = -Math.PI/2; liquidPlane.position.z = -0.2; liquidPlane.position.y = -0.4;
  scene.add(liquidPlane);
  // store
  ts.renderer = renderer; ts.scene = scene; ts.camera = camera; ts.liquid = liquidPlane; ts.tintLight = tint; ts.active = true; ts.particles = [];
  ts.animate = function(now){ const dt = (now - (ts.lastTime||now))/1000; ts.lastTime = now; // update particles
    for(let i=ts.particles.length-1;i>=0;i--){ const p = ts.particles[i]; p.userData.vy += -9.8*dt*0.02; p.position.y += p.userData.vy * dt * 1.8; p.material.opacity -= dt*0.6; if(p.material.opacity<=0){ ts.scene.remove(p); ts.particles.splice(i,1); } }
    // rotate slight
    ts.renderer.render(ts.scene, ts.camera);
  };
  // responsive on resize
  window.addEventListener('resize', ()=>{ const w2 = ts.container.clientWidth || 180; const h2 = ts.container.clientHeight || 110; renderer.setSize(w2,h2); ts.camera.aspect = w2/h2; ts.camera.updateProjectionMatrix(); });
  // start loop for this scene
  function loop(t){ if(!ts.active) return; ts.animate(t); ts.raf = requestAnimationFrame(loop); }
  ts.raf = requestAnimationFrame(loop);
}

// spawn bubbles (3D spheres) in tube scene
function spawnBubbles3D(tid){
  const ts = tubeScenes[tid]; if(!ts.active) ensureTubeScene(tid);
  const scene = ts.scene;
  const col = 0xffffff;
  for(let i=0;i<12;i++){
    const g = new THREE.SphereGeometry(0.06+Math.random()*0.06, 10, 8); const m = new THREE.MeshStandardMaterial({ color:0xffffff, transparent:true, opacity:0.95, roughness:0.1, metalness:0.0 });
    const s = new THREE.Mesh(g,m);
    s.position.set((Math.random()-0.5)*0.8, -0.6 + Math.random()*0.3, (Math.random()-0.5)*0.2);
    s.userData = { vy: 0.5 + Math.random()*0.6 };
    scene.add(s); ts.particles.push(s);
  }
  playSimpleSound('bubble');
}

// spawn foam: many small spheres expanding
function spawnFoam3D(tid){
  const ts = tubeScenes[tid]; if(!ts.active) ensureTubeScene(tid);
  const scene = ts.scene;
  for(let i=0;i<28;i++){
    const g = new THREE.SphereGeometry(0.04+Math.random()*0.06, 8, 6);
    const m = new THREE.MeshStandardMaterial({ color:0xffffff, transparent:true, opacity:0.95, roughness:0.8 });
    const s = new THREE.Mesh(g,m);
    s.position.set((Math.random()-0.5)*0.7, -0.5 + Math.random()*0.4, (Math.random()-0.5)*0.2);
    s.userData = { vy: 0.2 + Math.random()*0.4 };
    scene.add(s); ts.particles.push(s);
  }
  playSimpleSound('boom');
}

// color flash using tint light
function colorFlash3D(tid, hex){
  const ts = tubeScenes[tid]; if(!ts.active) ensureTubeScene(tid);
  const c = hexToRgb(hex||'#ffffff');
  const light = ts.tintLight; if(light){
    light.color.setRGB(c.r/255, c.g/255, c.b/255);
    setTimeout(()=>{ light.color.setRGB(0.4,0.6,0.9); }, 900);
  }
  playSimpleSound('ping');
}

// toggle 3D enable/disable
toggle3DBtn.addEventListener('click', ()=>{
  enable3D = !enable3D; localStorage.setItem('chem_3d', enable3D); toggle3DBtn.textContent = enable3D ? 'تعطيل 3D' : 'تفعيل 3D';
  // activate or fade scenes
  Object.keys(tubeScenes).forEach(tid=>{
    const ts = tubeScenes[tid];
    if(enable3D && !ts.active){ ensureTubeScene(tid); ts.container.classList.remove('disabled'); }
    if(!enable3D && ts.active){ // teardown renderer
      if(ts.raf) cancelAnimationFrame(ts.raf);
      if(ts.renderer){ ts.renderer.domElement.remove(); ts.renderer.dispose(); }
      ts.active = false; ts.particles=[]; ts.container.classList.add('disabled');
    }
  });
});

// helper: small flash overlay on zone already implemented above
function pushLog(txt){ const el=document.createElement('div'); el.textContent = new Date().toLocaleTimeString('ar-EG') + ' — ' + txt; logDiv.prepend(el); }
function pushQuick(txt){ const el=document.createElement('div'); el.textContent = new Date().toLocaleTimeString('ar-EG') + ' — ' + txt; quickDiv.prepend(el); }

// buttons: clear, hints, login (simple local)
document.getElementById('clearBtn').addEventListener('click', ()=>{ Object.keys(tubes).forEach(k=>tubes[k]=[]); Object.keys(tubes).forEach(k=>updateTubeVisual(k)); pushLog('تم تفريغ الأنابيب.'); });
document.getElementById('loginBtn').addEventListener('click', ()=>{ const name = prompt('ادخل اسمك (سيُحفظ محليًا):', localStorage.getItem('chem_user')||''); if(name && name.trim()){ localStorage.setItem('chem_user', name.trim()); document.getElementById('welcomeTxt').textContent = `مرحبًا، ${name.trim()}`; pushLog(`المستخدم ${name.trim()} سجل الدخول.`); } });

// simple suggestion and hint handlers
document.getElementById('autoSuggest').addEventListener('click', ()=>{ const rx = REACTIONS[Math.floor(Math.random()*REACTIONS.length)]; alert('اقترح خلط: ' + rx.requires.join(' + ') + '\nسيؤدي إلى: ' + rx.name); });
document.getElementById('hintBtn').addEventListener('click', ()=> alert('تلميح: جرّب H2O2 + MnO2 لإنتاج رغوة (في الحياة الواقعية لا تجرب ذلك بدون إشراف).'));

// initialize optional 3D scenes if enabled
if(enable3D){ Object.keys(tubeScenes).forEach(tid=> ensureTubeScene(tid)); } else { Object.keys(tubeScenes).forEach(tid=> tubeScenes[tid].container.classList.add('disabled')); }

// small export button opens README
document.getElementById('exportBtn').addEventListener('click', ()=> window.open('README.md','_blank'));

// init
pushLog('ChemLab 3D جاهز. اسحب المواد ثم اضغط "اخلط!"');