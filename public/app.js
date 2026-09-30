const $ = (id) => document.getElementById(id);
let bootstrap = null;
let imageDataUrl = "";
let inboxId = "";
let deferredInstall = null;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok || data.ok === false && data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function status(id, message, type = "ok") {
  const el = $(id); el.hidden = !message; el.className = `status ${type}`; el.textContent = message || "";
}
function hideCards(){ $("analysisCard").hidden=true; $("manualCard").hidden=true; }
function todayBr(){ return new Intl.DateTimeFormat("pt-BR").format(new Date()); }
function money(value, decimals=2){ return Number(value||0).toLocaleString("pt-BR",{minimumFractionDigits:decimals,maximumFractionDigits:decimals}); }

function fillProjects(projects=[]){ $("projects").innerHTML = projects.map((p)=>`<option value="${p.replaceAll('"','&quot;')}"></option>`).join(""); }

function parseBrDate(value){ const m=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m)return null; const d=new Date(Number(m[3]),Number(m[2])-1,Number(m[1])); if(d.getDate()!=Number(m[1])||d.getMonth()!=Number(m[2])-1||d.getFullYear()!=Number(m[3]))return null; return d; }
function reimbursement(dateText){ const date=parseBrDate(dateText); if(!date||!bootstrap)return null; const add=date.getDate()<=Number(bootstrap.cutoffDay||25)?1:2; const target=new Date(date.getFullYear(),date.getMonth()+add,1); const months=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]; return { competence:`${months[target.getMonth()]}/${target.getFullYear()}`, date:`01/${String(target.getMonth()+1).padStart(2,"0")}/${target.getFullYear()}` }; }
function currency(){ return document.querySelector('input[name="currency"]:checked')?.value || "BRL"; }

function updateManualPreview(){
  if(!bootstrap)return; const cycle=reimbursement($("mDate").value.trim()); const amount=Number($("mAmount").value||0); const usd=currency()==="USD"; const fx=Number(bootstrap.usdBrl||0); const rate=Number(bootstrap.iofRate||0.035); const base=usd?amount*fx:amount; const iof=usd?base*rate:0; const total=base+iof;
  $("mCompetence").textContent=cycle?.competence||"—"; $("mReimbursement").textContent=cycle?.date||"—"; $("mFxRow").hidden=!usd; $("mIofRow").hidden=!usd; $("mFx").textContent=usd?`R$ ${money(fx,4)}/US$`:"—"; $("mIof").textContent=usd?`R$ ${money(iof)} (${money(rate*100,1)}%)`:"—"; $("mTotal").textContent=`R$ ${money(total)}`; $("mHint").textContent=usd?"Estimativa em reais usando a cotação e o IOF configurados. O valor efetivo da fatura pode variar.":`Compras até o dia ${bootstrap.cutoffDay||25} são previstas para reembolso em 01 do mês seguinte. Fornecedor e fonte serão identificados automaticamente.`;
}

async function init(){
  try{ bootstrap=await api("/api/bootstrap"); fillProjects(bootstrap.projetos); $("mDate").value=todayBr(); updateManualPreview(); }
  catch(e){ status("captureStatus",e.message,"err"); }
}

$("imagem").addEventListener("change",()=>{ const file=$("imagem").files[0]; imageDataUrl=""; $("preview").hidden=true; if(!file)return; if(!file.type.startsWith("image/")){status("captureStatus","Envie uma imagem.","err");return} if(file.size>4*1024*1024){status("captureStatus","Imagem muito grande. Limite: 4 MB.","err");return} const reader=new FileReader(); reader.onload=()=>{imageDataUrl=reader.result;$("preview").src=imageDataUrl;$("preview").hidden=false}; reader.readAsDataURL(file); });

$("analyzeBtn").addEventListener("click",async()=>{ const text=$("texto").value.trim(); if(!text&&!imageDataUrl){status("captureStatus","Digite algo ou envie um print/foto.","warn");return} const btn=$("analyzeBtn");btn.disabled=true;btn.textContent="Analisando…";status("captureStatus","Analisando lançamento…","warn"); try{ const result=await api("/api/analyze",{method:"POST",body:JSON.stringify({texto:text,imagemDataUrl:imageDataUrl})}); inboxId=result.inboxId; const d=result.dados; $("aCompetence").value=d.fatura||"";$("aDate").value=d.data||"";$("aSupplier").value=d.fornecedor||"";$("aSource").value=d.fonte||"";$("aDescription").value=d.descricao||"";$("aBase").value=d.valor_base||0;$("aIof").value=d.iof||0;$("aTotal").value=d.total||0;$("aUsd").value=d.usd||0;$("aProject").value=d.projeto_sugerido||"";$("aNotes").value=d.observacoes||""; $("analysisMeta").textContent=`Confiança ${d.confianca||0}% • R$ ${money(result.custoIA||0,4)}`; if(result.duplicidade?.duplicate)status("duplicateStatus",`Possível duplicidade na linha ${result.duplicidade.row}.`,"warn");else status("duplicateStatus",""); hideCards();$("analysisCard").hidden=false;status("captureStatus","Análise concluída. Revise e aprove.","ok");$("analysisCard").scrollIntoView({behavior:"smooth"}); }catch(e){status("captureStatus",e.message,"err")}finally{btn.disabled=false;btn.textContent="Analisar com IA"} });

$("manualBtn").addEventListener("click",()=>{ hideCards();$("manualCard").hidden=false;$("mDate").value=todayBr();$("mDescription").value="";$("mAmount").value="";$("mProject").value="";document.querySelector('input[name="currency"][value="BRL"]').checked=true;status("manualStatus","");updateManualPreview();$("manualCard").scrollIntoView({behavior:"smooth"}); });
[$("mDate"),$("mAmount")].forEach((el)=>el.addEventListener("input",updateManualPreview));document.querySelectorAll('input[name="currency"]').forEach((el)=>el.addEventListener("change",updateManualPreview));

async function approveAnalyzed(confirmDup=false){ const d={fatura:$("aCompetence").value,data:$("aDate").value,fornecedor:$("aSupplier").value,fonte:$("aSource").value,descricao:$("aDescription").value,valor_base:Number($("aBase").value||0),iof:Number($("aIof").value||0),total:Number($("aTotal").value||0),usd:Number($("aUsd").value||0),projeto_sugerido:$("aProject").value,observacoes:$("aNotes").value}; $("approveBtn").disabled=true;status("analysisStatus","Gravando…","warn");try{const r=await api("/api/approve",{method:"POST",body:JSON.stringify({inboxId,dados:d,confirmarDuplicidade:confirmDup})});if(r.precisaConfirmarDuplicidade){$("approveBtn").disabled=false;if(confirm(`${r.mensagem}\n\nLançar mesmo assim?`))return approveAnalyzed(true);status("analysisStatus",r.mensagem,"warn");return}status("analysisStatus",r.mensagem,"ok");setTimeout(reset,1200)}catch(e){status("analysisStatus",e.message,"err");$("approveBtn").disabled=false}}
$("approveBtn").addEventListener("click",()=>approveAnalyzed(false));

async function approveManual(confirmDup=false){ const body={data:$("mDate").value,descricao:$("mDescription").value,moeda:currency(),valor:Number($("mAmount").value||0),projeto_sugerido:$("mProject").value,confirmarDuplicidade:confirmDup};$("manualApproveBtn").disabled=true;status("manualStatus","Calculando e gravando…","warn");try{const r=await api("/api/manual",{method:"POST",body:JSON.stringify(body)});if(r.precisaConfirmarDuplicidade){$("manualApproveBtn").disabled=false;if(confirm(`${r.mensagem}\n\nLançar mesmo assim?`))return approveManual(true);status("manualStatus",r.mensagem,"warn");return}status("manualStatus",`${r.mensagem} Competência ${r.competencia} • Reembolso ${r.reembolsoPrevisto}.`,"ok");setTimeout(reset,1500)}catch(e){status("manualStatus",e.message,"err");$("manualApproveBtn").disabled=false}}
$("manualApproveBtn").addEventListener("click",()=>approveManual(false));

function reset(){ hideCards();$("texto").value="";$("imagem").value="";$("preview").hidden=true;imageDataUrl="";inboxId="";status("captureStatus","");status("analysisStatus","");status("manualStatus","");$("approveBtn").disabled=false;$("manualApproveBtn").disabled=false;window.scrollTo({top:0,behavior:"smooth"}); }
document.querySelectorAll(".newBtn").forEach((b)=>b.addEventListener("click",reset));

window.addEventListener("beforeinstallprompt",(event)=>{ event.preventDefault();deferredInstall=event;$("installBtn").hidden=false; });
$("installBtn").addEventListener("click",async()=>{ if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").hidden=true; });
window.addEventListener("appinstalled",()=>{$("installBtn").hidden=true});
function updateOnline(){const online=navigator.onLine;$("onlineDot").classList.toggle("offline",!online);$("onlineText").textContent=online?"Online":"Offline"}window.addEventListener("online",updateOnline);window.addEventListener("offline",updateOnline);updateOnline();
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(console.error);
init();
