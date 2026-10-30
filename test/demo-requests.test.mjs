// SOLO PRUEBAS: contactos, inmuebles y decisiones ficticios. Sin APIs reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDemoRequest as prepareRequest, DEMO_REQUEST_TOOL } from '../lib/demo-requests.mjs';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
import { createApp } from '../server.mjs';
import { commercialProcess } from '../config/commercial-process.mjs';
const testClock = () => new Date('2026-10-30T14:00:00Z');
const prepareDemoRequest = (state, args, known) => prepareRequest(state, args, known, {now:testClock()});
const property = id => normalizeProperty({ id, reference_code: 'SOLO-PRUEBA-' + id, publication_title: 'SOLO PRUEBA · Inmueble', description: 'SOLO PRUEBA · Condición exclusiva de este inmueble.', photos: Array.from({length:16}, (_,i)=>({original:'https://photos.example.test/'+id+'/'+i+'.jpg'})) });
const a = property(99701), b = property(99702), known = new Map([[a.id,a],[b.id,b]]);
const args = (kind, changes = {}) => ({kind, property_id:null, name:null, contact:null, preferred_date:null, preferred_time:null, comment:null, reset_fields:[], ...changes});
const call = values => ({status:'completed',output:[{type:'function_call',name:'prepare_demo_request',call_id:'synthetic-request',arguments:JSON.stringify(values)}]});
const answer = () => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'SOLO PRUEBA · Respuesta simulada.'}]}]});
const state = () => ({history:[],properties:new Map(known),lastResultIds:[a.id,b.id],lastSearch:null,turns:0});
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
function harness(sequence, diagnostics = false) {
  const bodies=[];
  const fetchImpl=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');bodies.push(JSON.parse(options.body));assert.ok(sequence.length);return new Response(JSON.stringify(sequence.shift()));};
  return {bodies,fetchImpl, chat:createChat({apiKey:'synthetic-key',model:'gpt-6-luna',clock:testClock,diagnostics,fetchImpl,tokko:{search:()=>assert.fail('No hay llamadas al proveedor'),detail:()=>assert.fail('No hay llamadas al proveedor')}}), done:()=>assert.equal(sequence.length,0)};
}
test('visita: borrador progresivo, completado, corrección y borrado conservan datos y nunca reservan ni notifican',()=>{
  let result=prepareDemoRequest(null,args('visit',{property_id:a.id,name:'SOLO PRUEBA · Cliente ficticio'}),known);
  assert.equal(result.request.status,'draft');
  assert.deepEqual(result.request.missingFields,['contact','preferred_date','preferred_time']);
  const before=structuredClone(result.state);
  result=prepareDemoRequest(result.state,args('visit',{contact:'SOLO-PRUEBA-000',preferred_date:'mañana',preferred_time:'16:00 aproximadas'}),known);
  assert.deepEqual(before.requests.visit.missingFields,['contact','preferred_date','preferred_time']);
  assert.equal(result.request.status,'prepared'); assert.equal(result.request.comment,null);
  assert.equal(result.request.statusLabel,'Solicitud preparada — simulación, pendiente de confirmación');
  result=prepareDemoRequest(result.state,args('visit',{property_id:b.id,preferred_date:'el lunes',comment:'SOLO PRUEBA · Prefiero la tarde.'}),known);
  assert.equal(result.request.property_id,b.id);assert.equal(result.request.preferred_date,'2026-11-02');
  assert.equal(result.request.name,'SOLO PRUEBA · Cliente ficticio');assert.equal(result.request.contact,'SOLO-PRUEBA-000');assert.equal(result.request.preferred_time,'16:00');
  assert.equal(result.request.simulation,true);assert.equal(result.request.confirmed,false);assert.equal(result.request.notified,false);
  result=prepareDemoRequest(result.state,args('visit',{reset_fields:['preferred_time']}),known);
  assert.equal(result.request.status,'draft');assert.deepEqual(result.request.missingFields,['preferred_time']);
});
test('asesor: reutiliza nombre y contacto conocidos, propiedad opcional y revisión editable',()=>{
  const visit=prepareDemoRequest(null,args('visit',{property_id:a.id,name:'SOLO PRUEBA · Persona ficticia',contact:'SOLO-PRUEBA-000'}),known);
  const advisor=prepareDemoRequest(visit.state,args('advisor'),known);
  assert.equal(advisor.request.status,'prepared');assert.equal(advisor.request.property_id,a.id);
  assert.equal(advisor.request.name,visit.request.name);assert.equal(advisor.request.contact,visit.request.contact);
  assert.deepEqual(advisor.request.missingFields,[]);
  const edit=prepareDemoRequest(advisor.state,args('advisor',{property_id:b.id,contact:'SOLO-PRUEBA-111'}),known);
  assert.equal(edit.request.property_id,b.id);assert.equal(edit.request.contact,'SOLO-PRUEBA-111');
  assert.equal(edit.request.notified,false);assert.equal(edit.request.confirmed,false);
  const review=prepareDemoRequest(edit.state,args('advisor'),known);
  assert.deepEqual(review.request,edit.request);
});
test('solicitudes: rechazan propiedades desconocidas y argumentos inválidos sin mutar estado',()=>{
  const initial=prepareDemoRequest(null,args('advisor',{name:'SOLO PRUEBA'}),known).state;
  const copy=structuredClone(initial);
  for(const changes of [{property_id:9999999},{name:42},{contact:' '},{reset_fields:['unknown']}])assert.throws(()=>prepareDemoRequest(initial,args('visit',changes),known));
  assert.deepEqual(initial,copy);
  assert.throws(()=>prepareDemoRequest(initial,args('booking'),known));
  const schema=DEMO_REQUEST_TOOL.parameters;
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(Object.keys(schema.properties).sort(),[...schema.required].sort());
});
test('visita conversacional: cuatro turnos guardan y editan el resumen sin repetir fichas ni registrar datos personales',async t=>{
  const entries=[];t.mock.method(console,'info',line=>entries.push(JSON.parse(line)));
  const updates=[
    args('visit',{property_id:a.id,name:'SOLO PRUEBA · Nombre privado'}),
    args('visit',{contact:'SOLO-PRUEBA-TELEFONO-000',preferred_date:'mañana'}),
    args('visit',{preferred_time:'16:00',comment:'SOLO PRUEBA · Comentario privado'}),
    args('visit',{property_id:b.id,preferred_date:'el lunes',preferred_time:'10:00'}),
  ];
  const h=harness(updates.flatMap(update=>[call(update),answer()]),true),s=state();
  for(let i=0;i<updates.length;i++){
    const result=await h.chat(s,'SOLO PRUEBA · Datos ficticios de turno '+i,{demo:true});
    assert.deepEqual(result.properties,[]);assert.equal(result.demoRequests.length,1);
    assert.equal(result.demoRequests[0].status,i<2?'draft':'prepared');
    assert.ok(h.bodies[2*i].tools.some(tool=>tool.name==='prepare_demo_request'));
    assert.equal(h.bodies[2*i].tool_choice,'auto');assert.deepEqual(h.bodies[2*i].reasoning,{effort:'none'});
  }
  assert.equal(s.demoState.requests.visit.property_id,b.id);assert.equal(s.demoState.requests.visit.name,updates[0].name);
  assert.equal(s.demoState.requests.visit.contact,updates[1].contact);
  assert.deepEqual(s.properties.get(a.id).photos,a.photos);assert.deepEqual(s.lastResultIds,[a.id,b.id]);
  assert.equal(context(h.bodies[2]).demoState.requests.visit.name,updates[0].name);
  assert.deepEqual(context(h.bodies[7]).responseCards,[]);
  for(const secret of [updates[0].name,updates[1].contact,updates[2].comment])assert.ok(!JSON.stringify(entries).includes(secret));
  assert.ok(entries.some(entry=>entry.tools?.includes('prepare_demo_request')));
  assert.ok(!entries.some(entry=>entry.event==='agent_tokko'));
  h.done();
});
test('modo original: no expone herramienta ni estado comercial; no confirma un turno fallido',async()=>{
  const h=harness([call(args('advisor',{name:'SOLO PRUEBA'})),answer()]),s=state();
  const result=await h.chat(s,'SOLO PRUEBA · Contacto.');
  assert.deepEqual(h.bodies[0].tools,TOOLS);assert.equal(context(h.bodies[0]).demoState,undefined);
  assert.equal(JSON.parse(h.bodies[1].input.at(-1).output).error,'unknown_tool');
  assert.equal(result.demoRequests,undefined);assert.equal(s.demoState,undefined);
  const failed=harness([call(args('advisor',{name:'SOLO PRUEBA'})),{status:'failed',output:[]}]);
  await assert.rejects(failed.chat(s,'SOLO PRUEBA',{demo:true}));
  assert.equal(s.demoState,undefined);
});
test('búsqueda genérica y orientación: historial intacto, sin proveedor, procedimientos pendientes y condiciones verificadas por inmueble',async()=>{
  const h=harness([answer(),answer()]),s=state();
  // La aclaración es una decisión SIMULADA, no una demostración de OpenAI real.
  await h.chat(s,'Estoy buscando una propiedad, ¿me ayudas?',{demo:true});
  await h.chat(s,'¿Cómo suele ser una compra o alquiler?',{demo:true});
  assert.deepEqual(context(h.bodies[0]).commercialProcess,commercialProcess);
  assert.equal(commercialProcess.status,'pending_carlos');
  assert.equal(commercialProcess.rental,null);assert.equal(commercialProcess.purchase,null);
  assert.ok(h.bodies[1].input.some(item=>item.content==='Estoy buscando una propiedad, ¿me ayudas?'));
  assert.match(h.bodies[0].instructions,/no hay criterios útiles/);
  assert.match(h.bodies[1].instructions,/No inventes requisitos crediticios/);
  assert.match(h.bodies[1].instructions,/no los generalices/);
  assert.match(h.bodies[1].instructions,/No envía mensajes, no reserva citas/i);
  assert.deepEqual(s.demoState.requests,{});h.done();
});
test('solicitudes HTTP: aislamiento entre sesiones, revisión y reinicio sin datos persistentes ni herramientas fuera de demo',async t=>{
  const h=harness([
    call(args('advisor',{name:'SOLO PRUEBA · A'})),answer(),
    call(args('advisor',{name:'SOLO PRUEBA · B',contact:'SOLO-PRUEBA-B-000'})),answer(),
    call(args('advisor',{contact:'SOLO-PRUEBA-A-000'})),answer(),
    answer(),answer(),
  ]);
  const app=createApp({env:{OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'synthetic-key',TOKKO_API_KEY:'synthetic-key'},fetchImpl:h.fetchImpl});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base='http://127.0.0.1:'+app.address().port;
  const post=(message,cookie,demo=true)=>fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({message,...(demo?{mode:'demo'}:{})})});
  const firstA=await post('SOLO PRUEBA · Quiero asesor, soy A.');
  const cookieA=firstA.headers.get('set-cookie').split(';')[0];assert.equal((await firstA.json()).demoRequests[0].status,'draft');
  const firstB=await post('SOLO PRUEBA · Quiero asesor, soy B.');
  const cookieB=firstB.headers.get('set-cookie').split(';')[0];assert.notEqual(cookieA,cookieB);
  assert.equal((await firstB.json()).demoRequests[0].status,'prepared');
  assert.deepEqual(context(h.bodies[2]).demoState,{profile:{},requests:{}});
  const completeA=await post('SOLO PRUEBA · Mi contacto de A.',cookieA);
  assert.equal((await completeA.json()).demoRequests[0].contact,'SOLO-PRUEBA-A-000');
  assert.equal(context(h.bodies[4]).demoState.requests.advisor.name,'SOLO PRUEBA · A');
  assert.ok(!JSON.stringify(context(h.bodies[4]).demoState).includes('SOLO PRUEBA · B'));
  const original=await post('SOLO PRUEBA · Hola.',cookieA,false);
  assert.equal((await original.json()).demoRequests,undefined);assert.equal(context(h.bodies[6]).demoState,undefined);
  assert.equal((await fetch(base+'/api/session/reset',{method:'POST',headers:{Cookie:cookieA}})).status,200);
  assert.equal((await post('SOLO PRUEBA',cookieA)).status,409);
  const fresh=await post('SOLO PRUEBA · Nueva conversación.');assert.deepEqual((await fresh.json()).demoRequests,[]);
  assert.deepEqual(context(h.bodies[7]).demoState,{profile:{},requests:{}});
  h.done();
});
