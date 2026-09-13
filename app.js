import * as THREE from './vendor/three.module.min.js';

const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const esc = s => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motionOff = false;
try { motionOff = localStorage.getItem('opom-motion')==='off'; } catch {}
const minimal = () => reduced.matches || motionOff || !window.gsap;
let photos=[], renderer, scene, camera, W=0,H=0, meshes=[], current=[], transition=null, hover=-1;
let state={mode:'collection',index:0,position:0,full:false,pair:false,collection:{index:0,position:0}};
let overviewY=0, overviewReturn=null, drag=null, lastRoute='', pendingFrame=0, wheelTimer=0;
const canvas=$('#ribbon'), stage=$('#stage'), raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
const lastIndex=()=>photos.length-1;
const number=i=>String(i+1).padStart(2,'0');
function stopWheel(flush=true){const pending=!!wheelTimer;clearTimeout(wheelTimer);wheelTimer=0;if(pending&&flush&&state.mode==='collection')writeRoute(true);}
function photoId(i){return photos[i].id;}
function photoIndex(id){return photos.findIndex(p=>p.id===id);}
function related(i){return photoIndex(photos[i][W<=800?'mobile':'desktop'].relatedId || photos[i].desktop.relatedId);}
function isPair(){return !state.full && state.pair===true && related(state.index)>=0;}
function rectPose(x,y,w,h,opacity=1,uv=[0,0,1,1]){return {v:[x-W/2,H/2-y,0,x-W/2+w,H/2-y,0,x-W/2,H/2-y-h,0,x-W/2+w,H/2-y-h,0],uv,opacity};}
function crop(p,r,fit='cover',position='50% 50%'){
 if(fit==='contain')return [0,0,1,1];
 const ratio=p.width/p.height,target=r.w/r.h,[fx,fy]=position.split(' ').map(x=>parseFloat(x)/100);
 let uw=1,uh=1;if(target<ratio)uw=target/ratio;else uh=ratio/target;
 // Three's UV origin is bottom-left; object-position is measured from top-left.
 return [(1-uw)*fx,(1-uh)*(1-fy),uw,uh];
}
function contained(p,r){const f=Math.min(r.w/p.width,r.h/p.height);return{x:r.x+(r.w-p.width*f)/2,y:r.y+(r.h-p.height*f)/2,w:p.width*f,h:p.height*f};}
function collectionLayout(pos=state.position){
 const bh=Math.min(H*(W<=800?.41:.49),470), widths=photos.map((p,i)=>bh*clamp(p.width/p.height,.62,1.24)*(hover===i?1.055:1));
 const nodes=[[0,0]],angle=[];
 for(let i=0;i<photos.length;i++){
  const d=i-pos;let theta=Math.sin(d*1.65)*1.03;
  if(hover===i)theta*=.55;
  angle[i]=theta;nodes.push([nodes[i][0]+Math.cos(theta)*widths[i],nodes[i][1]+Math.sin(theta)*widths[i]]);
 }
 const lo=clamp(Math.floor(pos),0,lastIndex()),hi=clamp(lo+1,0,lastIndex()),f=pos-lo;
 const cx=mix((nodes[lo][0]+nodes[lo+1][0])/2,(nodes[hi][0]+nodes[hi+1][0])/2,f);
 const cz=mix((nodes[lo][1]+nodes[lo+1][1])/2,(nodes[hi][1]+nodes[hi+1][1])/2,f);
 const rz=W<=800?.12:.12,rx=-.20,scale=W<=800?.78:1;
 const transform=(x,y,z)=>{x=(x-cx)*scale;y*=scale;z=(z-cz)*scale;const yy=y*Math.cos(rx)-z*Math.sin(rx),zz=y*Math.sin(rx)+z*Math.cos(rx);return[x*Math.cos(rz)-yy*Math.sin(rz),x*Math.sin(rz)+yy*Math.cos(rz)+H*.005,zz];};
 return photos.map((p,i)=>{
  const a=nodes[i],b=nodes[i+1];
  const v=[...transform(a[0],bh/2,a[1]),...transform(b[0],bh/2,b[1]),...transform(a[0],-bh/2,a[1]),...transform(b[0],-bh/2,b[1])];
  return {v,uv:crop(p,{w:widths[i],h:bh}),opacity:Math.abs(i-pos)>7?0:1};
 });
}
function targetLayout(){
 const poses=collectionLayout(state.position);if(state.mode!=='photo')return poses;
 const mobile=W<=800, pad=mobile?16:28, top=mobile?133:(H<=650?111:146), bottom=mobile?185:174;
 const box={x:pad,y:top,w:W-pad*2,h:Math.max(120,H-top-bottom)};
 const p=photos[state.index],m=p[mobile?'mobile':'desktop'];let r={...box}, partner=related(state.index), r2=null;
 if(state.full){r=contained(p,box);}
 else if(isPair() && partner>=0){
  if(mobile){const h=Math.min(box.h*(p.format==='Square'?.72:.62),box.w/(p.width/p.height));r={x:pad,y:top,w:box.w,h};if(m.fit==='contain')r=contained(p,r);r2={x:pad,y:top+h+7,w:box.w,h:box.h-h-7};}
  else{const primaryW=m.protectFull?Math.min(box.h*(p.width/p.height),box.w*.72):box.w*.54;r={x:pad,y:top,w:primaryW,h:box.h};r2={x:pad+primaryW+8,y:top,w:box.w-primaryW-8,h:box.h};if(m.protectFull)r=contained(p,r);}
 }else if(m.fit==='contain' && p.format!=='Portrait'){r=contained(p,box);}
 else if(!mobile && p.format==='Portrait'){r=contained(p,box);}
 // Resting poses are derived from the same collection; no modal image replacement.
 poses.forEach((q,i)=>{q.opacity=0;const sign=i<state.index?-1:1;for(let j=0;j<12;j+=3){q.v[j]+=sign*W*1.35;q.v[j+2]-=W*.35;}});
 const fit=(state.full || (!isPair() && (m.fit==='contain'||(!mobile && p.format==='Portrait'))) || (isPair()&&(m.protectFull||(mobile&&m.fit==='contain'))))?'contain':'cover';
 poses[state.index]=rectPose(r.x,r.y,r.w,r.h,1,crop(p,r,fit,m.objectPosition));
 if(r2 && r2.h>0){const pp=photos[partner],pm=pp[mobile?'mobile':'desktop'];poses[partner]=rectPose(r2.x,r2.y,r2.w,r2.h,1,crop(pp,r2,'cover',pm.objectPosition));}
 return poses;
}
function render(){
 if(!renderer){renderFallback();return;}
 for(let i=0;i<meshes.length;i++){
  const mesh=meshes[i],p=current[i];if(!p)continue;
  mesh.visible=p.opacity>.001;if(!mesh.visible)continue;
  mesh.geometry.attributes.position.array.set(p.v);mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeBoundingSphere();
  const [u,v,w,h]=p.uv;mesh.geometry.attributes.uv.array.set([u,v+h,u+w,v+h,u,v,u+w,v]);mesh.geometry.attributes.uv.needsUpdate=true;
  mesh.material.opacity=p.opacity;
 }
 renderer.render(scene,camera);syncHits();
}
function requestRender(){if(!pendingFrame)pendingFrame=requestAnimationFrame(()=>{pendingFrame=0;render();});}
function project(v){const p=new THREE.Vector3(v[0],v[1],v[2]).project(camera);return[(p.x+1)*W/2,(1-p.y)*H/2];}
function syncHits(){
 const enabled=state.mode==='collection'&&!drag;
 meshes.forEach((mesh,i)=>{
  const el=$('#hit-'+photos[i].id),p=current[i];if(!el||!p)return;
  if(!enabled||p.opacity<.8||Math.abs(i-state.position)>4){el.hidden=true;el.tabIndex=-1;return;}
  const q=[0,3,9,6].map(j=>project(p.v.slice(j,j+3))),xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);
  const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
  if(x+w<0||x>W||y+h<0||y>H){el.hidden=true;el.tabIndex=-1;return;}
  el.hidden=false;el.tabIndex=i===state.index?0:-1;
  el.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px;clip-path:polygon(${q.map(p=>`${(p[0]-x)/w*100}% ${(p[1]-y)/h*100}%`).join(',')});z-index:${Math.round(1000-p.v[2])}`;
 });
}
function settle(){stopWheel();transition?.kill();transition=null;current=targetLayout();trimTextures();render();document.body.dataset.animating='false';}
function animate(duration=.9,ease='power3.inOut'){
 transition?.kill();const to=targetLayout();if(!current.length||minimal()){current=to;trimTextures();render();document.body.dataset.animating='false';return;}
 const from=current.map(p=>({v:[...p.v],uv:[...p.uv],opacity:p.opacity})),t={value:0};
 document.body.dataset.animating='true';
 transition=gsap.timeline({defaults:{ease},onComplete:()=>{current=to;transition=null;document.body.dataset.animating='false';trimTextures();render();}}).addLabel('unfold',0).to(t,{value:1,duration,onUpdate:()=>{
  const v=t.value;current=to.map((p,i)=>({v:p.v.map((x,j)=>mix(from[i].v[j],x,v)),uv:p.uv.map((x,j)=>mix(from[i].uv[j],x,v)),opacity:mix(from[i].opacity,p.opacity,v)}));render();
 }},'unfold');
}
const texLoader=new THREE.TextureLoader();
function loadTexture(i,high=false){
 const mesh=meshes[i];if(!mesh||mesh.userData[high?'high':'thumb'])return;mesh.userData[high?'high':'thumb']=true;
 const generation=mesh.userData.generation||0;
 texLoader.load(`/images/${photos[i].id}${high?'':'-thumb'}.webp`,texture=>{
  if(!renderer||generation!==(mesh.userData.generation||0)){texture.dispose();return;}
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  if(!high&&mesh.userData.highReady){texture.dispose();return;}
  const previous=mesh.material.map;mesh.material.map=texture;mesh.material.color.set(0xffffff);mesh.material.needsUpdate=true;mesh.userData.highReady ||=high;previous?.dispose();requestRender();
  if(i===state.index){$('#loading').hidden=true;$('#error').hidden=true;}
 },undefined,()=>{if(generation!==(mesh.userData.generation||0))return;mesh.userData[high?'high':'thumb']=false;if(i===state.index&&!mesh.material.map){$('#loading').hidden=true;$('#error').hidden=false;}});
}
function trimTextures(){
 if(!renderer)return;
 const partner=isPair()?related(state.index):-1;
 // Keep outgoing photographs resident until their transition has finished.
 meshes.forEach((mesh,i)=>{
  if(Math.abs(i-state.index)<=8||i===partner||current[i]?.opacity>.001)return;
  if(!mesh.userData.thumb&&!mesh.userData.high)return;
  mesh.userData.generation=(mesh.userData.generation||0)+1;
  mesh.material.map?.dispose();mesh.material.map=null;mesh.material.color.set(0x222527);mesh.material.needsUpdate=true;
  mesh.userData.thumb=false;mesh.userData.high=false;mesh.userData.highReady=false;
 });
}
function prime(){
 if(!renderer)return;
 trimTextures();const partner=isPair()?related(state.index):-1;
 if(state.mode==='collection')for(let d=-7;d<=7;d++){const i=state.index+d;if(photos[i])loadTexture(i);}
 for(let d=-1;d<=1;d++){const i=state.index+d;if(photos[i])loadTexture(i,true);}
 if(partner>=0)loadTexture(partner,true);
}
function initRenderer(){
 try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x0b0c0e,0);scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,1,20000);
  meshes=photos.map((p,i)=>{const geometry=new THREE.PlaneGeometry(1,1);const material=new THREE.MeshBasicMaterial({color:0x222527,side:THREE.DoubleSide,transparent:true,toneMapped:false,depthTest:true});const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.userData.index=i;scene.add(mesh);return mesh;});
 }catch(error){console.warn('Spatial view unavailable; using the image view.');renderer=null;canvas.hidden=true;$('#fallback').hidden=false;$('#loading').hidden=true;}
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();transition?.kill();renderer=null;canvas.hidden=true;$('#fallback').hidden=false;$('#loading').hidden=true;renderFallback();});
}
function renderFallback(){const p=photos[state.index],other=isPair()?photos[related(state.index)]:null,key=p.id+(other?.id||'');if($('#fallback').dataset.key!==key){$('#fallback').dataset.key=key;$('#fallback').innerHTML=`<img src="/images/${p.id}.webp" alt="${esc(p.alt)}">${other?`<img src="/images/${other.id}.webp" alt="${esc(other.alt)}">`:''}`;}$('#loading').hidden=true;$('#hit-area').hidden=true;}
function resize(){
 stopWheel();W=stage.clientWidth;H=stage.clientHeight;transition?.kill();hover=-1;drag=null;stage.classList.remove('dragging');
 if(renderer){renderer.setSize(W,H,false);camera.aspect=W/H;camera.position.z=H/(2*Math.tan(THREE.MathUtils.degToRad(19)));camera.updateProjectionMatrix();}
 updateUI();settle();prime();
}
function routeHash(s){return s.mode==='photo'?`#photo/${photoId(s.index)}${s.full?'/full':s.pair===true?'/related':''}`:s.mode==='overview'?'#overview':`#collection/${photoId(s.index)}`;}
function writeRoute(replace=false){history[replace?'replaceState':'pushState']({opom3:true,...state,photoId:photoId(state.index),collection:{...state.collection,photoId:photoId(state.collection.index)}},'',routeHash(state));lastRoute=location.hash;}
function updateUI(){
 const p=photos[hover>=0&&state.mode==='collection'?hover:state.index];document.body.classList.toggle('view-photo',state.mode==='photo');document.body.dataset.mode=state.mode;document.body.dataset.photo=photoId(state.index);
 $('.view-tools').hidden=state.mode!=='photo';$('#photo-title').textContent=p.title;$('#chapter').textContent=p.chapter;$('#counter').textContent=`${number(photoIndex(p.id))} / ${photos.length}`;
 $('#view-label').textContent=state.mode==='photo'?(state.full?'FULL FRAME':isPair()?'IN RELATION':'PHOTOGRAPH'):'THE COLLECTION';
 $('#gesture').innerHTML=state.mode==='photo'?(state.full?'The complete photograph':isPair()?'Two photographs, one conversation':'Take your time.'):'SCROLL OR DRAG <span aria-hidden="true">↔</span><span class="keyboard-hint"> / USE ← →</span>';
 $('#pair').textContent=isPair()?'View one':'View together';$('#pair').setAttribute('aria-pressed',isPair());$('#full').textContent=state.full?'Fill view ↙':'Full frame ⤢';$('#full').setAttribute('aria-pressed',state.full);
 $('#companion').hidden=state.mode!=='photo'||!isPair();if(isPair())$('#companion-title').textContent=photos[related(state.index)].title+' ↗';$('#relation').hidden=true;$('#previous').disabled=state.index===0;$('#next').disabled=state.index===lastIndex();
 $('#position-rail').style.transform=`scaleX(${(state.index+1)/photos.length})`;
 $('#motion').setAttribute('aria-pressed',minimal());$('#motion').textContent=minimal()?'Motion reduced':'Motion on';
 $('#ribbon').setAttribute('aria-label',state.mode==='photo'?p.alt+(isPair()?' Beside it: '+photos[related(state.index)].alt:''):'A continuous folded photographic ribbon. Selected: '+p.title+'. '+p.alt);
 document.title=state.mode==='photo'?`${p.title} — One Photograph, One Memory`:'One Photograph, One Memory';
 document.querySelectorAll('.overview-photo').forEach(el=>el.setAttribute('aria-current',el.dataset.id===p.id));
 $('#announcement').textContent=`${number(photoIndex(p.id))} of ${photos.length}. ${p.title}. ${state.mode==='photo'?'Photograph open.':'Collection.'}`;
}
function openPhoto(i){
 if(!photos[i])return;stopWheel();if(state.mode==='collection')state.collection={index:i,position:state.position};
 if($('#overview').open){overviewY=$('#overview').scrollTop;$('#overview').close();}
 hover=-1;state={...state,mode:'photo',index:i,full:true,pair:false};updateUI();writeRoute();prime();animate(.95);$('#return').focus({preventScroll:true});
}
function returnCollection(){
 stopWheel();if($('#overview').open)$('#overview').close();hover=-1;state={...state,mode:'collection',...state.collection,full:false,pair:false};updateUI();writeRoute();prime();animate(.9);$('#open-photo').focus({preventScroll:true});
}
function step(d){
 stopWheel();const i=clamp(state.index+d,0,lastIndex());if(i===state.index)return;hover=-1;
 if(state.mode==='photo'){state={...state,index:i,full:true,pair:false};writeRoute();}
 else{state.index=i;state.position=i;state.collection={index:i,position:i};writeRoute(true);}
 updateUI();prime();animate(state.mode==='photo'?.8:.65);
}
function showOverview(push=true){stopWheel();hover=-1;overviewReturn={...state,collection:{...state.collection}};state.mode='overview';if(push)writeRoute();$('#overview').showModal();$('#overview').scrollTop=overviewY;updateUI();}
function readRoute(){
 if(lastRoute===location.hash)return;stopWheel(false);lastRoute=location.hash;const saved=history.state;
 if(saved?.opom3&&photoIndex(saved.photoId)>=0&&photoIndex(saved.collection?.photoId)>=0){
  const index=photoIndex(saved.photoId),ci=photoIndex(saved.collection.photoId);
  const position=clamp(ci+saved.collection.position-saved.collection.index,0,lastIndex());
  state={...saved,index,position:saved.mode==='collection'?clamp(index+saved.position-saved.index,0,lastIndex()):position,collection:{index:ci,position}};
 }
 else{
  const match=location.hash.match(/^#(?:photo[/-]|collection\/)(p\d{2,})(?:\/(related|full))?$/i),i=match?photoIndex(match[1].toLowerCase()):-1;
  if(i>=0){const isPhoto=location.hash.startsWith('#photo');state={...state,mode:isPhoto?'photo':'collection',index:i,position:i,full:isPhoto&&match[2]!=='related',pair:match[2]==='related',collection:{index:i,position:i}};}
  else if(['#archive','#overview'].includes(location.hash)){state.mode='overview';}
  else{const chapter=location.hash.slice(1).toUpperCase(),found=photos.findIndex(p=>p.chapter===chapter);const i=found>=0?found:Math.max(0,photoIndex('p07'));state={mode:'collection',index:i,position:i,full:false,pair:false,collection:{index:i,position:i}};}
  writeRoute(true);
 }
 hover=-1;if(state.mode==='overview'){if(!$('#overview').open)$('#overview').showModal();$('#overview').scrollTop=overviewY;}else if($('#overview').open)$('#overview').close();
 updateUI();prime();animate(.75);
}
function hitAt(x,y){if(!renderer)return state.index;pointer.set(x/W*2-1,1-y/H*2);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(meshes).find(h=>h.object.visible&&h.object.material.opacity>.75)?.object.userData.index??-1;}
function bind(){
 $('#companion-title').onclick=()=>openPhoto(related(state.index));
 $('#open-photo').onclick=()=>openPhoto(hover>=0?hover:state.index);$('#return').onclick=returnCollection;
 $('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);
 $('#full').onclick=()=>{state.full=!state.full;state.pair=false;hover=-1;updateUI();writeRoute(true);animate(.7);};
 $('#pair').onclick=()=>{state.pair=!isPair();state.full=!state.pair;updateUI();writeRoute(true);prime();animate(.8);};
 $('#motion').onclick=()=>{motionOff=!motionOff;try{localStorage.setItem('opom-motion',motionOff?'off':'on');}catch{}updateUI();settle();};
 reduced.addEventListener('change',()=>{updateUI();settle();});
 $('#overview-open').onclick=()=>{if(state.mode==='collection')state.collection={index:state.index,position:state.position};showOverview();};
 const closeOverview=()=>{overviewY=$('#overview').scrollTop;$('#overview').close();if(overviewReturn){state=overviewReturn;overviewReturn=null;updateUI();writeRoute(true);animate(.4);$('#overview-open').focus({preventScroll:true});}else returnCollection();};
 $('#overview-close').onclick=closeOverview;$('#overview').addEventListener('cancel',e=>{e.preventDefault();closeOverview();});
 $('.skip').onclick=e=>{e.preventDefault();showOverview();};$('.identity').onclick=e=>{e.preventDefault();returnCollection();};
 $('#overview-grid').onclick=e=>{const a=e.target.closest('[data-id]');if(a){e.preventDefault();openPhoto(photoIndex(a.dataset.id));}};
 $('#hit-area').onclick=e=>{const b=e.target.closest('[data-id]');if(b&&e.detail===0)openPhoto(photoIndex(b.dataset.id));};
 $('#hit-area').addEventListener('focusin',e=>{if(state.mode==='collection'&&e.target.dataset.id){hover=photoIndex(e.target.dataset.id);updateUI();animate(.28);}});
 stage.addEventListener('wheel',e=>{
  if(state.mode!=='collection'||$('#overview').open||drag||e.ctrlKey||e.metaKey)return;
  const raw=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
  if(!raw)return;
  if(e.cancelable)e.preventDefault();
  stopWheel(false);hover=-1;
  const pixels=raw*(e.deltaMode===1?16:e.deltaMode===2?H:1);
  state.position=clamp(state.position+clamp(pixels/(W<=800?200:280),-3,3),0,lastIndex());
  state.index=Math.round(state.position);state.collection={index:state.index,position:state.position};
  updateUI();prime();animate(.24,'power2.out');
  wheelTimer=setTimeout(()=>{
   wheelTimer=0;writeRoute(true);
  },180);
 },{passive:false});
 stage.addEventListener('pointerdown',e=>{
  if(state.mode==='photo'&&isPair()&&e.button===0){const i=hitAt(e.clientX,e.clientY);if(i===related(state.index))openPhoto(i);return;}if(state.mode!=='collection'||e.button!==0)return;stopWheel();transition?.kill();hover=-1;drag={x:e.clientX,y:e.clientY,position:state.position,lastX:e.clientX,lastTime:performance.now(),velocity:0,moved:false};stage.setPointerCapture(e.pointerId);
 });
 stage.addEventListener('pointermove',e=>{
  if(state.mode!=='collection')return;
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)>6)drag.moved=true;if(!drag.moved&&Math.abs(dy)>12)return;
   if(drag.moved){stage.classList.add('dragging');const now=performance.now();drag.velocity=(e.clientX-drag.lastX)/Math.max(1,now-drag.lastTime);drag.lastX=e.clientX;drag.lastTime=now;const previous=state.index;state.position=clamp(drag.position-dx/(W<=800?155:230),0,lastIndex());state.index=Math.round(state.position);current=collectionLayout();updateUI();if(previous!==state.index)prime();render();}
  }else if(e.pointerType==='mouse'&&!transition&&!wheelTimer){const found=hitAt(e.clientX,e.clientY);if(found!==hover){hover=found;updateUI();animate(.22);}}
 });
 const release=e=>{
  if(!drag)return;const d=drag;drag=null;stage.classList.remove('dragging');if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
  if(e.type==='pointercancel'){state.position=Math.round(state.position);state.index=state.position;state.collection={index:state.index,position:state.position};writeRoute(true);updateUI();prime();animate(.25);return;}
  if(!d.moved){const i=hitAt(e.clientX,e.clientY);if(i>=0)openPhoto(i);return;}
  const fresh=performance.now()-d.lastTime<100?d.velocity:0;state.index=clamp(Math.round(state.position-(minimal()?0:clamp(fresh*0.34,-1.35,1.35))),0,lastIndex());state.position=state.index;state.collection={index:state.index,position:state.position};writeRoute(true);updateUI();prime();animate(.65);
 };
 stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);
 stage.addEventListener('pointerleave',()=>{if(!drag&&state.mode==='collection'&&hover!==-1){hover=-1;updateUI();animate(.22);}});
 document.addEventListener('keydown',e=>{
  if($('#overview').open)return;
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const fromFacet=document.activeElement.classList.contains('photo-hit');step(e.key==='ArrowRight'?1:-1);if(fromFacet)$('#open-photo').focus({preventScroll:true});}
  else if(e.key==='Escape'&&state.mode==='photo'){e.preventDefault();returnCollection();}
  else if((e.key==='Home'||e.key==='End')&&state.mode==='collection'){e.preventDefault();step((e.key==='Home'?0:lastIndex())-state.index);}
 });
 addEventListener('popstate',readRoute);addEventListener('hashchange',readRoute);
 let resizeFrame=0;addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);});
 addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 addEventListener('pagehide',()=>{stopWheel();transition?.kill();cancelAnimationFrame(pendingFrame);meshes.forEach(m=>{m.userData.generation=(m.userData.generation||0)+1;m.material.map?.dispose();m.material.dispose();m.geometry.dispose();});renderer?.dispose();renderer=null;});
}
async function start(){
 try{
  const response=await fetch('/photos.json',{cache:'no-cache'});if(!response.ok)throw Error('Manifest unavailable');photos=await response.json();if(!photos.length||new Set(photos.map(p=>p.id)).size!==photos.length)throw Error('Invalid collection');
  const initial=Math.max(0,photoIndex('p07'));state.index=initial;state.position=initial;state.collection={index:initial,position:initial};
  $('.skip').textContent=`All ${photos.length} photographs`;$('#overview-open sup').textContent=photos.length;$('#overview-title').textContent=`${photos.length} ways of seeing.`;$('#loading span').textContent=`${photos.length} photographs / One continuous thread`;
  $('#overview-grid').innerHTML=photos.map((p,i)=>`<a class="overview-photo" data-id="${p.id}" href="#photo/${p.id}" aria-label="Open ${esc(p.title)}"><img src="/images/${p.id}-thumb.webp" alt="${esc(p.alt)}" width="${p.width}" height="${p.height}" loading="lazy"><span class="overview-label"><small>${number(i)}</small><span>${esc(p.title)}</span></span></a>`).join('');
  $('#hit-area').innerHTML=photos.map(p=>`<button class="photo-hit" id="hit-${p.id}" data-id="${p.id}" aria-label="Open ${esc(p.title)}. ${esc(p.alt)}" tabindex="-1"></button>`).join('');
  initRenderer();bind();resize();lastRoute='__initial__';readRoute();prime();
 }catch(error){console.error(error);$('#loading').hidden=true;$('#error').hidden=false;}
}
start();
