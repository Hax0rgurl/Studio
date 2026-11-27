// This window holds a snapshot. The crew can keep changing the live project.
(async function displayPrintPreview(){
  const source=new DOMParser().parseFromString(window.studioPrintDocument,'text/html');
  delete window.studioPrintDocument;
  const permitted=new Set('div p span b i em strong h1 h2 h3 section table thead tbody tr th td br'.split(' '));
  function printable(node){
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
    if(!permitted.has(node.localName))return document.createDocumentFragment();
    const copy=document.createElement(node.localName);
    for(const name of ['class','style','colspan','title']){
      if(node.hasAttribute(name))copy.setAttribute(name,node.getAttribute(name));
    }
    copy.append(...Array.from(node.childNodes,printable));
    return copy;
  }
  document.title=source.title||'Print preview';
  const style=document.createElement('style');
  style.textContent=Array.from(source.head.querySelectorAll('style'),s=>s.textContent).join('\n')+
    '\n@media print{.print-controls{display:none!important}}';
  document.head.append(style);
  document.body.replaceChildren(...Array.from(source.body.childNodes,printable));
  const controls=document.createElement('div'),button=document.createElement('button'),status=document.createElement('span');
  controls.className='print-controls';
  controls.style.cssText='position:sticky;top:0;padding:8px;background:#191b21;color:white;font:14px system-ui';
  button.textContent='Print or save PDF';
  status.setAttribute('role','status');
  controls.append(button,status);document.body.prepend(controls);
  const print=()=>window.__TAURI__.core.invoke('print_preview').catch(error=>{status.textContent=' Could not open print dialog: '+String(error);});
  button.onclick=print;
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await print();
})();
