from pathlib import Path
import base64, html, re
root = Path(__file__).resolve().parent.parent / 'docs'
source=(root/'操作手冊.md').read_text()
lines=source.splitlines(); out=[]; i=0; section=False; anchor=''
def inline(s):
 tokens=[]
 def stash(value):
  tokens.append(value); return f'@@TOKEN{len(tokens)-1}@@'
 s=re.sub(r'`([^`]+)`',lambda m:stash('<code>'+html.escape(m[1])+'</code>'),s)
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:stash('<a href="'+html.escape(m[2],quote=True)+'">'+html.escape(m[1])+'</a>'),s)
 s=html.escape(s)
 s=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',s)
 for n,t in enumerate(tokens):s=s.replace(f'@@TOKEN{n}@@',t)
 return s
while i<len(lines):
 line=lines[i]
 if not line.strip():i+=1;continue
 m=re.fullmatch(r'<a id="([^"]+)"></a>',line)
 if m:anchor=m[1];i+=1;continue
 m=re.match(r'^(#{1,3}) (.+)$',line)
 if m:
  level=len(m[1]);title=m[2]
  if level==2:
   if section:out.append('</section>')
   ident=anchor or ('toc' if title=='目錄' else 'section');anchor=''
   out.append(f'<section class="chapter" id="{ident}">');section=True
  out.append(f'<h{level}>{inline(title)}</h{level}>');i+=1;continue
 if line.startswith('```'):
  code=[];i+=1
  while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
  out.append('<pre><code>'+html.escape('\n'.join(code))+'</code></pre>');i+=1;continue
 if line.startswith('|'):
  table=[]
  while i<len(lines) and lines[i].startswith('|'):table.append([v.strip() for v in lines[i].strip('|').split('|')]);i+=1
  out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(v)+'</th>' for v in table[0])+'</tr></thead><tbody>')
  for row in table[2:]:out.append('<tr>'+''.join('<td>'+inline(v)+'</td>' for v in row)+'</tr>')
  out.append('</tbody></table></div>');continue
 m=re.fullmatch(r'!\[([^\]]+)\]\(([^)]+)\)',line)
 if m:
  data=(root/m[2]).read_bytes();uri='data:image/png;base64,'+base64.b64encode(data).decode()
  out.append('<figure><button class="image-open" type="button" aria-label="放大'+html.escape(m[1],quote=True)+'"><img src="'+uri+'" alt="'+html.escape(m[1],quote=True)+'"></button><figcaption>'+html.escape(m[1])+'</figcaption></figure>');i+=1;continue
 if re.match(r'^圖 \d+：',line):i+=1;continue
 m=re.match(r'^(\d+\. |\- )(.+)$',line)
 if m:
  ordered=m[1][0].isdigit();tag='ol' if ordered else 'ul';out.append('<'+tag+'>')
  while i<len(lines):
   m=re.match(r'^(\d+\. |\- )(.+)$',lines[i])
   if not m or m[1][0].isdigit()!=ordered:break
   out.append('<li>'+inline(m[2])+'</li>');i+=1
  out.append('</'+tag+'>');continue
 para=[line];i+=1
 while i<len(lines) and lines[i].strip() and not re.match(r'^(#|<a |!\[|\||```|\d+\. |\- )',lines[i]):para.append(lines[i]);i+=1
 out.append('<p>'+inline(' '.join(para))+'</p>')
if section:out.append('</section>')
css='''
:root{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;color:#0f172a;background:#f7f9fc;font-size:16px}*{box-sizing:border-box}body{margin:0;line-height:1.85}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 24px;display:flex;gap:20px;align-items:center;z-index:2}header strong{margin-right:auto}a{color:#1d4ed8}button{font:inherit;cursor:pointer}header button{border:1px solid #cbd5e1;border-radius:8px;padding:6px 14px;background:#fff;color:#0f172a}main{max-width:1040px;margin:auto;padding:40px 32px 80px}h1{font-size:34px;line-height:1.45;margin:0 0 24px}h2{font-size:25px;line-height:1.5;margin:0 0 20px}h3{font-size:20px;margin:30px 0 12px}p{margin:16px 0}li{margin:7px 0}.chapter{background:#fff;border:1px solid #e2e8f0;border-radius:18px;margin-top:32px;padding:32px;scroll-margin-top:90px}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.65}td,th{padding:10px;border:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f1f5f9}.table-wrap{overflow:auto}figure{margin:24px 0;break-inside:avoid}figure img{display:block;max-width:100%;height:auto;max-height:850px;margin:auto;object-fit:contain;border-radius:10px;border:1px solid #dbe3ef}.image-open{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}figcaption{text-align:center;color:#64748b;font-size:13px;margin-top:8px}code{background:#f1f5f9;border-radius:4px;padding:1px 4px}pre{white-space:pre-wrap;background:#f1f5f9;border-radius:10px;padding:16px;font-size:14px;line-height:1.7}pre code{padding:0}dialog{width:min(98vw,1600px);max-height:96vh;padding:12px;border:1px solid #cbd5e1;border-radius:12px}dialog::backdrop{background:#0f172ab3}dialog img{width:100%;height:auto}dialog button{position:sticky;top:0;float:right;padding:6px 15px;background:#fff;border:1px solid #94a3b8;border-radius:8px}.print-note{color:#64748b;font-size:13px}
@media(max-width:640px){header{padding:8px 12px;gap:12px;font-size:14px}header strong{display:none}main{padding:24px 12px}h1{font-size:26px}.chapter{padding:18px;border-radius:12px}h2{font-size:22px}td,th{min-width:110px}figure img{border-radius:6px}}
@page{size:A4;margin:15mm 14mm 17mm}
@media print{html,body{background:#fff;font-size:11pt;line-height:1.7}header,.print-note,dialog{display:none}main{max-width:none;padding:0}h1{font-size:24pt}h2{font-size:19pt;break-after:avoid}h3{font-size:14pt;break-after:avoid}.chapter{border:none;border-radius:0;padding:0;margin:0;break-before:page;scroll-margin:0}#toc{break-before:auto;margin-top:20px}table{font-size:9pt}tr{break-inside:avoid}.table-wrap{overflow:visible}figure{break-inside:avoid;margin:16px 0}figure img{max-width:100%;max-height:175mm;border-radius:0}figcaption{font-size:9pt}.image-open{cursor:default}a{color:inherit;text-decoration:none}pre{font-size:10pt}p,li{orphans:3;widows:3}}
'''
script='''const viewer=document.getElementById('viewer');document.querySelectorAll('.image-open').forEach(button=>button.addEventListener('click',()=>{const img=button.querySelector('img');viewer.querySelector('img').src=img.src;viewer.querySelector('img').alt=img.alt;viewer.showModal();}));viewer.querySelector('button').addEventListener('click',()=>viewer.close());viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close();});'''
page='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>逆水寒幫會管理平台｜操作手冊</title><style>'+css+'</style></head><body><header><strong>幫會管理平台｜操作手冊</strong><a href="#toc">目錄</a><button type="button" onclick="window.print()">列印／儲存 PDF</button></header><main><p class="print-note">可離線閱讀，點圖片可放大，按 Esc 關閉；使用目錄跳至操作章節。</p>'+''.join(out)+'</main><dialog id="viewer" aria-label="操作畫面放大"><button type="button">關閉</button><img alt=""></dialog><script>'+script+'</script></body></html>'
(root/'操作手冊.html').write_text(page)
print('Rendered standalone HTML; images',len(re.findall(r'<figure>',page)))
