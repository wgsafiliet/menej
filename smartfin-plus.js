/* SmartFin Plus — perbaikan bug, getar, notifikasi HP, tampilan lebih mudah.
   Pasang SETELAH skrip utama: <script src="smartfin-plus.js"></script> sebelum </body> */
(function(){
'use strict';

/* ---------- 1. PERBAIKAN ZONA WAKTU (WIB) ----------
   Bug asli: toISOString() memakai UTC, sehingga "hari ini" salah sebelum jam 07.00 WIB
   dan daftar bulan bergeser. Di sini toISOString diganti ke waktu lokal. */
(function(){
  const p=n=>String(n).padStart(2,'0');
  Date.prototype.toISOString=function(){
    if(isNaN(this)) throw new RangeError('Invalid time value');
    return this.getFullYear()+'-'+p(this.getMonth()+1)+'-'+p(this.getDate())+'T'+p(this.getHours())+':'+p(this.getMinutes())+':'+p(this.getSeconds())+'.'+String(this.getMilliseconds()).padStart(3,'0');
  };
})();
S.filterMonth=monthKey();

/* ---------- 2. PREFERENSI ---------- */
const pref={
  get(k,d){ try{ const v=localStorage.getItem('sfp_'+k); return v===null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem('sfp_'+k,JSON.stringify(v)); }catch(e){} }
};
const applyFont=()=>document.documentElement.style.setProperty('--fs',pref.get('big',false)?'17px':'15px');
applyFont();

/* ---------- 3. GETAR ---------- */
const PAT={tap:12,ok:[18,40,18],warn:[60,60,60],err:[120,70,120],crit:[200,100,200,100,300]};
window.vibe=function(t){ if(!pref.get('vib',true)) return; try{ navigator.vibrate&&navigator.vibrate(PAT[t||'tap']); }catch(e){} };
document.addEventListener('click',e=>{
  const el=e.target.closest('.btn,.fab,.toggle,.seg button,.tabs button,.navbot a,.nav a,.qa a,.amt-c,.bell,.notif .act button,.hl,.install-btn');
  if(el) vibe(el.classList.contains('danger')?'warn':'tap');
},true);
const _toast=window.toast;
window.toast=function(m,e){ _toast(m,e); vibe(e===1?'err':e===2?'warn':'ok'); };
const _confirm=window.confirm.bind(window);
window.confirm=function(m){ vibe('warn'); return _confirm(m); };

/* ---------- 4. NOTIFIKASI HP ---------- */
function sysNotify(title,body,tag){
  if(!('Notification' in window)||Notification.permission!=='granted') return;
  const o={body,icon:'icon-192.png',badge:'icon-192.png',tag:tag||'sf',vibrate:[200,100,200],lang:'id'};
  if(navigator.serviceWorker&&navigator.serviceWorker.controller)
    navigator.serviceWorker.ready.then(r=>r.showNotification(title,o)).catch(()=>{ try{ new Notification(title,o); }catch(e){} });
  else { try{ new Notification(title,o); }catch(e){} }
}
let _sent=0;
function deliver(n){
  if(inQuietHours()) return;
  if(n.prioritas==='crit') vibe('crit'); else if(n.prioritas==='hi') vibe('warn');
  if((n.prioritas==='crit'||n.prioritas==='hi') && _sent<3){ _sent++; sysNotify(n.judul,n.pesan,n.kunci); }
}
// addNotif baru: tidak muncul ulang setelah "Ditangani" (bug asli), + getar & notif HP
window.addNotif=function(n){
  const d=D(), set=d.pengaturan.notif||{};
  if(n.tipe in set && !set[n.tipe]) return;
  if(n.tipe==='tagihan'&&n.judul==='Tagihan jatuh tempo hari ini'){ // bug asli: tagihan lewat tempo salah ditulis "hari ini"
    const b=d.tagihan.find(x=>n.kunci==='bl-'+x.id); if(b&&daysUntil(b.jatuh_tempo)<0) return;
  }
  const dk=n.tipe+'|'+(n.kunci||''), win=n.once?Infinity:86400000;
  const ex=d.notifikasi.find(x=>x.kunci===dk&&(Date.now()-new Date(x.timestamp).getTime())<win);
  if(ex){ if(n.prioritas==='crit'&&ex.prioritas!=='crit'&&ex.status!=='handled'){ ex.prioritas='crit'; ex.pesan=n.pesan; } return; }
  const notif=Object.assign({id:uid2(),timestamp:new Date().toISOString(),kunci:dk,status:'new',snoozeUntil:null},n);
  d.notifikasi.unshift(notif); if(d.notifikasi.length>100) d.notifikasi.length=100;
  deliver(notif);
};
const _gen=window.generateNotifications;
window.generateNotifications=function(){
  _sent=0;
  D().notifikasi.forEach(n=>{ if(n.status==='snooze'&&n.snoozeUntil&&new Date(n.snoozeUntil)<=new Date()) n.status='new'; });
  _gen(); extra(); persist();
};
function extra(){
  const d=D(), td=todayISO(), now=new Date();
  billsUpcoming().filter(b=>b.hari<0).forEach(b=>addNotif({tipe:'tagihan',kunci:'late-'+b.id,prioritas:'crit',emoji:'⏰',judul:'Tagihan terlambat '+(-b.hari)+' hari',pesan:`${b.nama} ${R(b.jumlah)} sudah lewat jatuh tempo (${fmtDate(b.jatuh_tempo)}). Segera bayar agar tidak kena denda.`,aksi:[{l:'Sudah bayar',t:'paybill',v:b.id}]}));
  debtsActive().filter(u=>daysUntil(u.jatuh_tempo)<0).forEach(u=>addNotif({tipe:'utang',kunci:'utlate-'+u.id,prioritas:'crit',emoji:'⏰',judul:'Cicilan terlambat',pesan:`${u.nama}: cicilan ${R(u.cicilan)} sudah lewat jatuh tempo (${fmtDate(u.jatuh_tempo)}).`,aksi:[{l:'Lihat utang',t:'go',v:'tagihan'}]}));
  d.rekening.forEach(r=>{ const s=saldoRekening(r.id); if(s<0) addNotif({tipe:'cashflow',kunci:'neg-'+r.id,prioritas:'crit',emoji:'🆘',judul:'Saldo '+r.nama+' minus',pesan:`Saldo ${r.nama} ${R(s)}. Cek apakah ada catatan yang salah atau pindahkan dana.`,aksi:[{l:'Lihat transaksi',t:'go',v:'trx'}]}); });
  const avg=d.transaksi.filter(t=>t.tipe==='out'&&daysUntil(t.tgl)>=-30&&daysUntil(t.tgl)<=0).reduce((a,t)=>a+(+t.jumlah||0),0)/30, sal=totalSaldo();
  if(avg>0&&sal>=0&&sal<avg*7) addNotif({tipe:'cashflow',kunci:'tipis',prioritas:'hi',emoji:'👛',judul:'Uang tinggal cukup '+Math.floor(sal/avg)+' hari',pesan:`Saldo ${R(sal)}; rata-rata belanja ${R(Math.round(avg))}/hari. Kurangi pengeluaran yang tidak penting.`});
  const inc=penghasilanInfo().v, lim=inc>0?inc*0.2:1000000;
  d.transaksi.filter(t=>t.tipe==='out'&&String(t.tgl).slice(0,10)===td&&+t.jumlah>=lim).forEach(t=>addNotif({tipe:'abnormal',kunci:'big-'+t.id,prioritas:'mid',emoji:'💸',judul:'Pengeluaran besar tercatat',pesan:`${t.deskripsi||KAT(t.kategori_id).nama} ${R(t.jumlah)}${inc>0?' — '+Math.round(t.jumlah/inc*100)+'% dari penghasilan bulanan':''}.`}));
  if(now.getDate()<=3){
    const p=new Date(now.getFullYear(),now.getMonth()-1,1), pk=monthKey(p), tr=trxByMonth(pk);
    if(tr.length){ const net=sumIn(tr)-sumOut(tr); addNotif({tipe:'evaluasi',kunci:'ev-'+pk,once:true,prioritas:'lo',emoji:'📊',judul:'Rangkuman '+MONTHS_L[p.getMonth()],pesan:`Masuk ${R(sumIn(tr))}, keluar ${R(sumOut(tr))} → ${net>=0?'sisa':'kurang'} ${R(Math.abs(net))}.`,aksi:[{l:'Lihat laporan',t:'go',v:'laporan'}]}); }
  }
  if(hasData()&&now.getHours()>=19&&!d.transaksi.some(t=>String(t.tgl).slice(0,10)===td))
    addNotif({tipe:'tidakCatat',kunci:'daily-'+td,prioritas:'lo',emoji:'📝',judul:'Sudah mencatat hari ini?',pesan:'Catat belanja hari ini sebelum lupa — cukup 10 detik.',aksi:[{l:'Catat sekarang',t:'go',v:'trx'}]});
}
const _ub=window.updateBell;
window.updateBell=function(){ _ub(); try{ const c=unreadCount(); if(c>0) navigator.setAppBadge&&navigator.setAppBadge(c); else navigator.clearAppBadge&&navigator.clearAppBadge(); }catch(e){} };
setInterval(()=>{ if(!document.hidden&&S.d) recomputeAll(); },10*60000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&S.d) recomputeAll(); });

window.sfAskNotif=async function(){
  if(!('Notification' in window)){ toast('Browser ini belum mendukung notifikasi HP',2); return; }
  const r=await Notification.requestPermission();
  toast(r==='granted'?'Notifikasi HP aktif':'Ditolak — aktifkan lewat pengaturan browser',r==='granted'?0:2);
  renderPengaturan();
};
window.sfTestNotif=function(){
  const ok='Notification' in window&&Notification.permission==='granted';
  toast('Percobaan dikirim'+(ok?'':' (aktifkan izin notifikasi dulu)'),2);
  vibe('crit'); sysNotify('SmartFin','Ini contoh notifikasi. Jika HP bergetar, fitur berfungsi ✅','test');
};

/* ---------- 5. PERBAIKAN FUNGSI ---------- */
function addPeriod(iso,f){
  const d=new Date(iso+'T00:00:00');
  if(f==='mingguan') d.setDate(d.getDate()+7); else if(f==='tahunan') d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1);
  return d.toISOString().slice(0,10);
}
// Bug asli: tagihan bulanan jadi "lunas" selamanya. Sekarang jatuh tempo maju ke periode berikutnya.
window.payBill=function(id){
  const b=D().tagihan.find(x=>x.id===id); if(!b) return;
  if(b.frekuensi==='sekali') b.status='lunas'; else b.jatuh_tempo=addPeriod(b.jatuh_tempo,b.frekuensi);
  mutate('tagihan','upd',b);
  mutate('transaksi','add',{id:uid('trx'),tgl:todayISO(),tipe:'out',kategori_id:b.kategori_id,rekening_id:(D().rekening[0]||{}).id,deskripsi:'Bayar '+b.nama,jumlah:b.jumlah});
  toast(b.frekuensi==='sekali'?'Tagihan lunas':'Tercatat. Tagihan berikutnya: '+fmtDate(b.jatuh_tempo));
};
// Bug asli: cicilan dibayar tapi jatuh tempo tidak maju → terus "jatuh tempo".
window.payDebt=function(id){
  const u=D().utang.find(x=>x.id===id); if(!u) return;
  const a=Math.min(+u.cicilan||0,+u.sisa||0); if(a<=0){ toast('Tidak ada cicilan',1); return; }
  u.sisa=Math.max(0,(+u.sisa)-a); if(u.sisa>0) u.jatuh_tempo=addPeriod(u.jatuh_tempo,u.frekuensi);
  mutate('utang','upd',u);
  const kd=D().kategori.find(k=>k.tipe==='out'&&/cicilan|utang/i.test(k.nama));
  mutate('transaksi','add',{id:uid('trx'),tgl:todayISO(),tipe:'out',kategori_id:kd?kd.id:'k16',rekening_id:(D().rekening[0]||{}).id,deskripsi:'Bayar cicilan '+u.nama,jumlah:a});
  toast('Cicilan '+R(a)+' dibayar');
};
// Tagihan sebelumnya tidak bisa dibayar/diubah/dihapus dari daftar → tombol ditambahkan
const _rt=window.renderTagihanUtang;
window.renderTagihanUtang=function(){
  _rt();
  const lst=document.querySelector('#v-tagihan .card .list'); if(!lst) return;
  lst.innerHTML=billsUpcoming().map(b=>{
    const chip=b.hari<0?`<span class="chip r">Terlambat ${-b.hari} hari</span>`:b.hari===0?'<span class="chip r">Hari ini</span>':b.hari<=3?`<span class="chip r">H-${b.hari}</span>`:b.hari<=7?`<span class="chip a">H-${b.hari}</span>`:`<span class="chip">${b.hari} hari lagi</span>`;
    return `<div class="li" style="flex-wrap:wrap"><div class="ic-c" style="background:var(--amber-l)">📅</div><div class="grow"><div class="nm">${E(b.nama)}</div><div class="sb">${fmtDate(b.jatuh_tempo)} · ${b.frekuensi}</div></div><div style="text-align:right"><div class="v">${R(b.jumlah)}</div>${chip}</div>
    <div class="row" style="width:100%;gap:6px;margin:2px 0 4px 49px"><button class="btn sm" onclick="payBill('${b.id}')">✓ Sudah bayar</button><button class="btn ghost sm" onclick="openBillForm('${b.id}')">Ubah</button><button class="btn danger sm" onclick="delBill('${b.id}')">Hapus</button></div></div>`;
  }).join('');
};
// Bug asli: tombol "Terapkan saran" alokasi rusak (tanda kutip di atribut HTML)
const _rk=window.renderKeamanan;
window.renderKeamanan=function(){
  _rk();
  document.querySelectorAll('#v-keamanan a').forEach(a=>{
    if(/Terapkan saran/.test(a.textContent)){ a.removeAttribute('onclick'); a.onclick=e=>{ e.preventDefault(); D().pengaturan.alokasi=recommendAllocation(); savePengaturan(); toast('Saran alokasi diterapkan'); }; }
  });
};

/* ---------- 6. KELOLA REKENING (sebelumnya tidak ada menunya) ---------- */
window.openRekForm=function(id){
  const r=id?D().rekening.find(x=>x.id===id):{nama:'',jenis:'Bank',saldo_awal:0};
  openSheet(id?'Ubah rekening':'Tambah rekening',`
    <div class="fld"><label>Nama rekening / dompet</label><input id="_rN" value="${E(r.nama)}" placeholder="cth: BCA, GoPay, Tunai"></div>
    ${nameChips('_rN',['Tunai','BCA','BRI','Mandiri','GoPay','OVO','Dana','Tabungan darurat'])}
    <div class="fld"><label>Jenis</label><select id="_rJ">${['Bank','Dompet digital','Tunai'].map(j=>`<option ${r.jenis===j?'selected':''}>${j}</option>`).join('')}</select></div>
    ${amtField('_rS','Saldo saat mulai dicatat',[100000,500000,1000000,5000000,10000000],r.saldo_awal)}
    <label class="tg-row" style="cursor:pointer"><input type="checkbox" id="_rD" ${id&&D().pengaturan.danaDaruratRekening===id?'checked':''} style="width:20px;height:20px"><div class="lb">Ini simpanan dana darurat<small>Saldonya dihitung sebagai dana darurat</small></div></label>
    <div class="row" style="gap:8px;margin-top:10px">${id?`<button class="btn danger" onclick="delRek('${id}')">Hapus</button>`:''}<button class="btn ghost grow" onclick="closeSheet()">Batal</button><button class="btn grow" onclick="saveRek('${id||''}')">Simpan</button></div>`);
};
window.saveRek=function(id){
  const row={id:id||uid('rek'),nama:$('_rN').value.trim(),jenis:$('_rJ').value,saldo_awal:rp2num($('_rS').value)};
  if(!row.nama){ toast('Isi nama rekening',1); return; }
  if(id) mutate('rekening','upd',row); else { D().rekening.push(row); persist(); pushQ({t:'rekening',op:'add',id:row.id,row}); }
  const set=D().pengaturan;
  if($('_rD').checked) set.danaDaruratRekening=row.id; else if(set.danaDaruratRekening===row.id) set.danaDaruratRekening='';
  savePengaturan(); closeSheet(); toast('Rekening disimpan');
};
window.delRek=function(id){
  if(D().transaksi.some(t=>t.rekening_id===id||t.ke_rekening_id===id)){ toast('Sudah dipakai transaksi — tidak bisa dihapus',1); return; }
  if(D().rekening.length<=1){ toast('Minimal ada 1 rekening',1); return; }
  if(!confirm('Hapus rekening ini?')) return;
  mutate('rekening','del',{id}); closeSheet(); toast('Dihapus');
};

/* ---------- 7. PENGATURAN: kenyamanan + rekening ---------- */
window.sfTog=function(k,el){ const v=!pref.get(k,k==='vib'); pref.set(k,v); el.classList.toggle('on',v); if(k==='big') applyFont(); if(k==='vib'&&v) vibe('ok'); };
const _rp=window.renderPengaturan;
window.renderPengaturan=function(){
  _rp();
  const perm='Notification' in window?Notification.permission:'unsupported';
  const row=(k,t,s,d)=>`<div class="tg-row"><div class="grow"><div class="lb">${t}<small>${s}</small></div></div><div class="toggle ${pref.get(k,d)?'on':''}" onclick="sfTog('${k}',this)"></div></div>`;
  const html=`<div class="card"><h3>✨ Kenyamanan & Notifikasi HP</h3>
    ${row('vib','Getar','HP bergetar saat tombol penting ditekan & ada peringatan',true)}
    ${row('big','Huruf lebih besar','Lebih mudah dibaca',false)}
    <div class="tg-row"><div class="grow"><div class="lb">Notifikasi di layar HP<small>${perm==='granted'?'Aktif ✓':perm==='denied'?'Diblokir — ubah di pengaturan browser':perm==='unsupported'?'Tidak didukung browser ini':'Belum aktif'}</small></div></div>${perm==='default'?'<button class="btn sm" onclick="sfAskNotif()">Aktifkan</button>':''}</div>
    <button class="btn ghost block sm" style="margin-top:6px" onclick="sfTestNotif()">Coba notifikasi & getar</button>
    <div class="muted xs" style="margin-top:8px">Peringatan muncul saat aplikasi dibuka atau berjalan di latar. Getar hanya di HP yang mendukung (Android).</div></div>
    <div class="card"><h3>🏦 Rekening & Dompet <a class="ml" href="#" onclick="openRekForm();return false">+ Tambah</a></h3>
    ${D().rekening.map(r=>`<div class="li" onclick="openRekForm('${r.id}')"><div class="ic-c">${/tunai/i.test(r.nama)?'💵':'🏦'}</div><div class="grow"><div class="nm">${E(r.nama)}${D().pengaturan.danaDaruratRekening===r.id?' 🛡️':''}</div><div class="sb">${E(r.jenis||'')}</div></div><div class="v">${R(saldoRekening(r.id))}</div></div>`).join('')}
    <div class="muted xs" style="margin-top:6px">Ketuk untuk mengubah. 🛡️ = simpanan dana darurat.</div></div>`;
  const h=$('v-pengaturan').querySelector('.hdr'); if(h) h.insertAdjacentHTML('afterend',html);
};

/* ---------- 8. TAMPILAN MUDAH DIMENGERTI ---------- */
const WORDS=[[/Cashflow/g,'Arus Uang'],[/cashflow/g,'arus uang'],[/\bDD\b/g,'Dana Darurat'],[/Surplus/g,'Untung'],[/Defisit/g,'Rugi']];
function plain(root){ const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ let t=n.nodeValue; WORDS.forEach(([a,b])=>{ t=t.replace(a,b); }); if(t!==n.nodeValue) n.nodeValue=t; } }
const _rv=window.renderView;
window.renderView=function(tab){ _rv(tab); const el=$('v-'+tab); if(el) plain(el); };

window.buildNav=function(){
  NAV.find(n=>n.id==='dash').l='Beranda'; NAV.find(n=>n.id==='keamanan').l='Perencana'; NAV.find(n=>n.id==='trx').l='Catatan';
  $('navSide').innerHTML=NAV.map(n=>`<a data-t="${n.id}" onclick="go('${n.id}')"><svg class="ic" viewBox="0 0 24 24">${n.i}</svg>${n.l}</a>`).join('');
  const b=[['dash','Beranda'],['trx','Catatan'],['anggaran','Anggaran'],['keamanan','Rencana']];
  $('navBot').innerHTML=`<div class="in">`+b.map(([id,l])=>`<a data-t="${id}" onclick="go('${id}')"><svg class="ic" viewBox="0 0 24 24">${NAV.find(n=>n.id===id).i}</svg>${l}</a>`).join('')+`<a class="more" onclick="openMore()"><svg class="ic" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>Lainnya</a></div>`;
};

const _rd=window.renderDashboard;
window.renderDashboard=function(){
  _rd();
  const el=$('v-dash'), t=trxByMonth(monthKey()), inT=sumIn(t), outT=sumOut(t);
  const cf=predictCashflow(), ef=calcEmergency(), nb=billsUpcoming()[0];
  let cls='g',em='😊',head='Keuangan Anda aman',sub='Tidak ada hal mendesak saat ini.';
  if(!hasData()){ cls='b'; em='👋'; head='Selamat datang!'; sub='Mulai dengan mencatat uang masuk dan keluar. Hitungannya dikerjakan aplikasi.'; }
  else if(cf.risk==='Kritis'||(ef.beban>0&&ef.rasio<1)){ cls='r'; em='😟'; head='Perlu perhatian segera'; sub=cf.risk==='Kritis'?'Uang Anda diperkirakan tidak cukup sampai gajian berikutnya.':'Simpanan darurat Anda sangat tipis.'; }
  else if(cf.risk==='Berisiko'||(ef.beban>0&&ef.rasio<3)||(nb&&nb.hari<=3)){ cls='a'; em='🙂'; head='Cukup baik, tetap waspada'; sub=nb&&nb.hari<=3?`Tagihan ${nb.nama} ${nb.hari<0?'sudah lewat jatuh tempo':nb.hari===0?'jatuh tempo hari ini':'jatuh tempo '+nb.hari+' hari lagi'}.`:'Pantau pengeluaran beberapa hari ke depan.'; }
  const sisa=inT-outT;
  const simple=`<div class="banner ${cls}" style="font-size:15px;align-items:center"><span class="em" style="font-size:30px">${em}</span><div><b>${head}</b><div style="font-weight:500;margin-top:2px">${sub}</div></div></div>
  <div class="kpi" style="margin-bottom:12px">
    <div class="b bal"><div class="lbl">Uang saya sekarang</div><div class="v">${R(totalSaldo())}</div></div>
    <div class="b ${sisa>=0?'in':'out'}"><div class="lbl">Masuk − keluar bulan ini</div><div class="v">${sisa<0?'−':''}${R(Math.abs(sisa))}</div></div>
  </div>
  <div class="grid2" style="margin-bottom:12px"><button class="btn" style="padding:16px;font-size:15px;background:var(--red)" onclick="openAdd('out')">➖ Catat Pengeluaran</button><button class="btn" style="padding:16px;font-size:15px" onclick="openAdd('in')">➕ Catat Pemasukan</button></div>
  ${nb?`<div class="card tight"><div class="row"><div class="grow"><div class="muted xs">Tagihan terdekat</div><div class="nm" style="font-weight:700">${E(nb.nama)} · ${R(nb.jumlah)}</div><div class="sb muted xs">${nb.hari<0?'Terlambat '+(-nb.hari)+' hari':nb.hari===0?'Jatuh tempo hari ini':nb.hari+' hari lagi'}</div></div><button class="btn sm" onclick="payBill('${nb.id}')">Sudah bayar</button></div></div>`:''}`;
  const orig=el.innerHTML;
  el.innerHTML=simple+`<details class="collapsible" style="margin-bottom:14px"><summary class="btn ghost block">📊 Lihat rincian lengkap</summary><div style="margin-top:12px">${orig}</div></details>`;
  plain(el);
};

window.openHelp=function(){
  openSheet('Bantuan: arti istilah',`<div class="col">`+[
    ['🛡️ Dana darurat','Simpanan khusus untuk keadaan mendadak (sakit, kehilangan kerja). Idealnya cukup untuk 6 bulan pengeluaran wajib.'],
    ['🔮 Arus uang','Perjalanan uang masuk dan keluar. "Berisiko" berarti uang diperkirakan habis sebelum gajian.'],
    ['💳 Rasio cicilan','Berapa persen penghasilan habis untuk cicilan. Di atas 30% dianggap berat.'],
    ['💯 Skor kesehatan','Nilai 0–100 dari tabungan, cicilan, dan kebiasaan belanja. Hanya panduan, bukan penilaian bank.'],
    ['📊 Anggaran','Batas belanja per kategori tiap bulan, misalnya Makan maksimal Rp1.500.000.'],
    ['🎯 Target','Tujuan menabung, misalnya beli laptop. Aplikasi menghitung setoran bulanan yang dibutuhkan.']
  ].map(([t,d])=>`<div class="hl" style="flex-direction:column;align-items:flex-start;gap:2px"><div class="nm">${t}</div><div class="sb">${d}</div></div>`).join('')+`</div>`);
};
const bell=$('bellBtn');
if(bell) bell.insertAdjacentHTML('beforebegin','<button class="bell" onclick="openHelp()" aria-label="Bantuan"><b style="font-size:17px">?</b></button>');

if(S.d) recomputeAll();
})();
