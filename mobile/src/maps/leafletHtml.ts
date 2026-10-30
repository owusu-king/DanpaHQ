import { LEAFLET_CSS, LEAFLET_JS } from "./leafletRuntime.generated";
import { safeScriptJSON } from "./bridge";

export const MAP_ORIGIN = "https://danpahq.com/";
export type TileConfig = { url: string; attribution: string; attributionUrl: string };
export function leafletHTML(tiles: TileConfig, initial: { lat: number; lng: number; zoom: number }, selecting: boolean, initialState: unknown = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; connect-src 'none'; frame-src 'none'"><style>${LEAFLET_CSS}
html,body,#map{height:100%;width:100%;margin:0;background:#f5f3ee;font-family:system-ui,sans-serif}.danpa-marker{width:0!important;height:0!important;background:none;border:0}.danpa-marker:focus-visible .pin-face{outline:3px solid #123b2c;outline-offset:3px}.pin-face{width:max-content;white-space:nowrap;background:white;border:1.5px solid #1b6b4f;border-radius:24px;padding:7px 10px;color:#123b2c;font-size:13px;font-weight:600;transform:translate(-50%,-100%)}.pin-face.cluster{border-radius:100%;background:#1b6b4f;color:white;transform:translate(-50%,-50%)}.pin-face.sale{border-color:#a77416;color:#805500}.pin-face.selected{background:#123b2c;color:white}.pin-face.visited{opacity:.8}.property-pin{width:28px;height:36px;transform:translate(-50%,-100%)}.property-pin svg{display:block;width:28px;height:36px}.leaflet-top{top:var(--map-top,0px)}.leaflet-bottom{bottom:var(--map-bottom,0px)}.leaflet-left{left:var(--map-left,0px)}.leaflet-right{right:var(--map-right,0px)}.leaflet-control-attribution{font-size:10px!important}</style></head><body><div id="map" aria-label="Property map"></div><script>${LEAFLET_JS.replace(/<\/script/gi, "<\\/script")}</script><script>
(function(){'use strict';
const config=${safeScriptJSON(tiles)}, initial=${safeScriptJSON(initial)}, selecting=${selecting ? "true" : "false"};
const send=value=>window.ReactNativeWebView.postMessage(JSON.stringify(value));
const map=L.map('map',{zoomControl:true,minZoom:4,maxZoom:19,attributionControl:true}).setView([initial.lat,initial.lng],initial.zoom);
map.attributionControl.setPrefix(false);
const credit=document.createElement('a');credit.href=config.attributionUrl;credit.textContent=config.attribution;credit.target='_blank';credit.rel='noopener noreferrer';
const tileLayer=L.tileLayer(config.url,{attribution:credit.outerHTML,maxZoom:19,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:1,noWrap:true}).addTo(map);
let loaded=false;
tileLayer.on('tileload',()=>{loaded=true;});
setTimeout(()=>{if(!loaded)send({type:'unavailable'});},12000);
let ours=true,lastFit=null,pin=null,selectable=selecting,insets={top:0,right:0,bottom:0,left:0};const markers=new Map();
map.on('dragstart',()=>{ours=false;});map.on('zoomstart',()=>{});
document.getElementById('map').addEventListener('pointerdown',()=>{ours=false;});
function move(){const size=map.getSize();if(size.x<=0||size.y<=0)return;const nw=map.containerPointToLatLng([Math.min(insets.left,size.x/3),Math.min(insets.top,size.y/3)]),se=map.containerPointToLatLng([size.x-Math.min(insets.right,size.x/3),size.y-Math.min(insets.bottom,size.y/3)]);send({type:'move',bounds:{west:nw.lng,south:se.lat,east:se.lng,north:nw.lat},zoom:map.getZoom(),byUser:!ours});ours=false;}
map.on('moveend',move);map.on('click',e=>{if(selecting&&selectable)send({type:'pin',latitude:Math.round(e.latlng.lat*1e6)/1e6,longitude:Math.round(e.latlng.lng*1e6)/1e6});else send({type:'background'});});
function face(m){const element=document.createElement('div');element.className='pin-face '+m.kind+(m.selected?' selected':'')+(m.visited?' visited':'');element.textContent=m.label;return L.divIcon({html:element,className:'danpa-marker '+m.kind,iconSize:[0,0],iconAnchor:[0,0]});}
window.DanpaMap={update:function(data){
const changedInsets=JSON.stringify(insets)!==JSON.stringify(data.insets||insets);insets=data.insets||insets;for(const side of ['top','bottom','left','right'])map.getContainer().style.setProperty('--map-'+side,insets[side]+'px');selectable=data.selectable!==false;if(changedInsets)requestAnimationFrame(move);
const wanted=new Set();(data.markers||[]).forEach(m=>{wanted.add(m.key);let marker=markers.get(m.key);if(!marker){marker=L.marker([m.position.lat,m.position.lng],{icon:face(m),title:m.accessibilityLabel,keyboard:true,bubblingMouseEvents:false}).addTo(map);marker.on('click',()=>send({type:'marker',key:m.key}));markers.set(m.key,marker);}marker.setLatLng([m.position.lat,m.position.lng]);marker.setIcon(face(m));marker.setZIndexOffset(m.selected?300:100);});
markers.forEach((marker,key)=>{if(!wanted.has(key)){marker.remove();markers.delete(key);}});
if(selecting){if(!data.pin){if(pin)pin.remove();pin=null;}else if(!pin){const node=document.createElement('div');node.className='property-pin';node.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" aria-label="Selected property location"><path d="M14 35S1 22 1 14a13 13 0 1 1 26 0c0 8-13 21-13 21Z" fill="#1b6b4f" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="4" fill="white"/></svg>';pin=L.marker([data.pin.latitude,data.pin.longitude],{draggable:selectable,zIndexOffset:1000,icon:L.divIcon({html:node,className:'danpa-marker',iconSize:[0,0],iconAnchor:[0,0]}),bubblingMouseEvents:false}).addTo(map);pin.on('dragend',()=>{const p=pin.getLatLng();send({type:'pin',latitude:Math.round(p.lat*1e6)/1e6,longitude:Math.round(p.lng*1e6)/1e6});});}else{pin.setLatLng([data.pin.latitude,data.pin.longitude]);if(selectable)pin.dragging.enable();else pin.dragging.disable();}}
if(data.fit&&data.fit.key!==lastFit){const size=map.getSize();if(size.x>48&&size.y>48){const b=data.fit.bounds;ours=true;map.fitBounds([[b.south,b.west],[b.north,b.east]],{paddingTopLeft:[Math.min(insets.left+24,size.x/3),Math.min(insets.top+24,size.y/3)],paddingBottomRight:[Math.min(insets.right+24,size.x/3),Math.min(insets.bottom+24,size.y/3)],maxZoom:16,animate:false});lastFit=data.fit.key;}}
}};
let latestState=${safeScriptJSON(initialState)};const update=window.DanpaMap.update;window.DanpaMap.update=function(data){latestState=data;update(data);};
function resize(){map.invalidateSize({animate:false});window.DanpaMap.update(latestState);}
window.addEventListener('resize',resize);if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(document.getElementById('map'));
window.DanpaMap.update(latestState);send({type:'ready'});requestAnimationFrame(move);
})();</script></body></html>`;
}
