import test from 'node:test';
import assert from 'node:assert/strict';
import { messageTokens, renderMessageText } from '../public/message-format.mjs';
import { renderDemoRequest } from '../public/demo-requests.js';
// DOM mínimo de prueba: detecta las únicas etiquetas creadas y conserva todo texto sin interpretar HTML.
function documentFixture() {
  const tags = [];
  const doc = { createTextNode: text => ({ textContent: text }), createElement: tag => {
    tags.push(tag);
    return { tag, ownerDocument: doc, children: [], attributes: {}, events: {},
      append(...children) { this.children.push(...children); },
      setAttribute(key,value) { this.attributes[key]=value; },
      addEventListener(key,handler) { this.events[key]=handler; },
      set textContent(value) { this.children=[{textContent:String(value)}]; },
      get textContent() { return this.children.map(child=>child.textContent).join(''); },
    };
  }};
  return {doc,tags};
}
test('Markdown: negrita, énfasis, código y saltos conservan el texto sin asteriscos de formato',()=>{
  const {doc,tags}=documentFixture(),node=doc.createElement('p');
  renderMessageText(node,'Condición: **2 meses de garantía**\nTambién *énfasis* y `código`.');
  assert.equal(node.textContent,'Condición: 2 meses de garantía\nTambién énfasis y código.');
  assert.deepEqual(tags,['p','strong','em','code']);
  assert.equal(messageTokens('Sin formato *incompleto')[0].text,'Sin formato *incompleto');
});
test('Markdown: HTML, scripts, URLs peligrosas y enlaces permanecen como texto no ejecutable',()=>{
  for(const payload of ['**<img src=x onerror=alert(1)>**','<script>alert(1)</script>','[abrir](javascript:alert(1))','[dato](data:text/html,<script>alert(1)</script>)','<svg onload=alert(1)>','**<a href="javascript:x">texto</a>**']){
    const {doc,tags}=documentFixture(),node=doc.createElement('p');
    renderMessageText(node,payload);
    assert.ok(tags.every(tag=>['p','strong','em','code'].includes(tag)));
    assert.ok(!tags.some(tag=>['a','script','img','svg'].includes(tag)));
    assert.ok(node.textContent.includes(payload.replace(/^\*\*|\*\*$/g,'')));
  }
});
test('resumen demo: presenta todos los datos, estado de simulación y acción de corrección con texto seguro',()=>{
  const {doc,tags}=documentFixture();let edited=null;
  const request={kind:'visit',statusLabel:'Solicitud preparada — simulación, pendiente de confirmación',propertyLabel:'SOLO PRUEBA · Inmueble',name:'SOLO PRUEBA <script>x</script>',contact:'SOLO-PRUEBA-000',preferred_date:'viernes de prueba',preferred_time:'16:00',comment:'SOLO PRUEBA',missingFields:[]};
  const node=renderDemoRequest(request,doc,kind=>{edited=kind;});
  assert.ok(node.textContent.includes(request.statusLabel));assert.ok(node.textContent.includes('No enviada. Sin reserva ni disponibilidad confirmada.'));
  for(const key of ['propertyLabel','name','contact','preferred_date','preferred_time','comment'])assert.ok(node.textContent.includes(request[key]));
  assert.ok(!tags.includes('script'));
  const button=node.children.find(child=>child.tag==='button');button.events.click();assert.equal(edited,'visit');
  assert.equal(node.attributes['aria-label'],'Solicitud de visita simulada');
});
test('resumen demo: borrador de asesor identifica únicamente los campos que faltan',()=>{
  const {doc}=documentFixture();
  const node=renderDemoRequest({kind:'advisor',statusLabel:'Borrador — simulación',name:'SOLO PRUEBA',missingFields:['contact']},doc,()=>{});
  assert.ok(node.textContent.includes('Por completar: contacto'));
  assert.ok(!node.textContent.includes('Por completar: contacto, fecha'));
});


test('resumen demo: fecha legible con día de semana, hora y expresión original sin HTML ejecutable',()=>{
  const {doc,tags}=documentFixture();
  const node=renderDemoRequest({kind:'visit',statusLabel:'Solicitud preparada — simulación, pendiente de confirmación',propertyLabel:'SOLO PRUEBA',name:'SOLO PRUEBA',contact:'SOLO-PRUEBA-000',preferred_date:'2026-10-31',preferred_time:'15:00',schedule:{dateLabel:'Sábado, 31 de octubre de 2026',timeLabel:'3:00 p. m.',date:{original:'mañana'},time:{original:'a las 3 de la tarde <script>x</script>'},feedback:[]},missingFields:[]},doc,()=>{});
  assert.match(node.textContent,/Sábado, 31 de octubre de 2026/);assert.match(node.textContent,/3:00 p\. m\./);
  assert.ok(node.textContent.includes('Preferencia recibida: mañana · a las 3 de la tarde <script>x</script>'));
  assert.ok(!tags.includes('script'));assert.ok(node.textContent.includes('Sin reserva ni disponibilidad confirmada'));
});
test('resumen demo: conserva una franja sin inventar hora y muestra la aclaración pendiente',()=>{
  const {doc}=documentFixture();
  const node=renderDemoRequest({kind:'visit',statusLabel:'Borrador — simulación',preferred_date:'2026-11-02',preferred_time:null,schedule:{dateLabel:'Lunes, 2 de noviembre de 2026',periodLabel:'por la mañana',feedback:['Conservo la franja; falta indicar la hora aproximada.']},missingFields:['preferred_time']},doc,()=>{});
  assert.match(node.textContent,/Lunes, 2 de noviembre de 2026/);assert.match(node.textContent,/por la mañana/);
  assert.match(node.textContent,/falta indicar la hora aproximada/);assert.match(node.textContent,/Por completar: hora aproximada/);
});
