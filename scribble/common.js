// Shared by the Scribble phone page and TV mode: palette and stroke rendering.
const SC_COLORS=["#2b2420","#8e2638","#2f4a3a","#b08a3e","#2f5d8a","#d2691e","#7a4fa0","#fffcf7"];
function scDraw(canvas, strokes, opts){
  opts=opts||{};
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const w=canvas.clientWidth||canvas.width, h=canvas.clientHeight||canvas.height;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){ canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr); }
  const ctx=canvas.getContext("2d");
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#fffcf7"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const s=canvas.width/1000;
  ctx.lineCap="round"; ctx.lineJoin="round";
  for(const st of (strokes||[])){
    const p=st.p; if(!p||p.length<2) continue;
    ctx.strokeStyle=SC_COLORS[st.c]||SC_COLORS[0]; ctx.lineWidth=Math.max(1,st.w*s);
    ctx.beginPath(); ctx.moveTo(p[0]*s,p[1]*s);
    if(p.length===2) ctx.lineTo(p[0]*s+0.01,p[1]*s+0.01);
    for(let i=2;i<p.length;i+=2){
      if(i+2<p.length){ const mx=(p[i]+p[i+2])/2*s, my=(p[i+1]+p[i+3])/2*s; ctx.quadraticCurveTo(p[i]*s,p[i+1]*s,mx,my); }
      else ctx.lineTo(p[i]*s,p[i+1]*s);
    }
    ctx.stroke();
  }
}
