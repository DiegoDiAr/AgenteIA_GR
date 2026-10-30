// SOLO PRUEBAS: reloj, personas, inmuebles y decisiones simulados; ninguna API real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limaClock, parseDatePreference, parseTimePreference, temporalReference } from '../lib/visit-schedule.mjs';
import { prepareDemoRequest, refreshDemoState } from '../lib/demo-requests.mjs';
import { createChat } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
const now = new Date('2026-10-30T14:00:00Z'); // 09:00 en Lima, viernes.
const fixture = normalizeProperty({id:99001,publication_title:'SOLO PRUEBA · Inmueble ficticio',description:'SOLO PRUEBA · Datos completos conservados.',photos:Array.from({length:16},(_,i)=>({original:'https://example.test/synthetic/'+i+'.jpg'}))});
const known = new Map([[fixture.id,fixture]]);
const args = changes => ({kind:'visit',property_id:null,name:null,contact:null,preferred_date:null,preferred_time:null,comment:null,reset_fields:[],...changes});
const complete = {property_id:fixture.id,name:'SOLO PRUEBA · Persona ficticia',contact:'SOLO-PRUEBA-000',preferred_date:'mañana',preferred_time:'3 de la tarde'};
const prepare = (state,changes,options={}) => prepareDemoRequest(state,args(changes),known,{now,...options});
const parsedContext = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
const call = changes => ({status:'completed',output:[{type:'function_call',name:'prepare_demo_request',call_id:'synthetic-date',arguments:JSON.stringify(args(changes))}]});
const answer = () => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'SOLO PRUEBA · Respuesta simulada.'}]}]});
const session = () => ({history:[],properties:new Map(known),lastResultIds:[fixture.id],lastSearch:null,turns:0});

test('calendario: ejemplos de octubre usan fecha civil de Lima y no el calendario del modelo',()=>{
  for(const [input,expected] of [
    ['Mañana','2026-10-31'],['pasado mañana','2026-11-01'],['El lunes','2026-11-02'],
    ['Mañana a las 3 de la tarde','2026-10-31'],['El próximo martes a las 10 de la mañana','2026-11-03'],
    ['el domingo','2026-11-01'],['el sábado','2026-10-31'],
  ]) assert.equal(parseDatePreference(input,now).value,expected,input);
  assert.equal(parseDatePreference('por la mañana',now).found,false);
  assert.equal(parseDatePreference('a las 10 de la mañana',now).found,false);
});
test('calendario: cambio de mes, año y bisiesto sin desbordar fechas',()=>{
  for(const [clock,input,expected] of [
    ['2026-10-31T14:00:00Z','mañana','2026-11-01'],
    ['2026-12-31T14:00:00Z','mañana','2027-01-01'],
    ['2026-12-30T14:00:00Z','pasado mañana','2027-01-01'],
    ['2028-02-28T14:00:00Z','mañana','2028-02-29'],
    ['2028-02-29T14:00:00Z','mañana','2028-03-01'],
  ]) assert.equal(parseDatePreference(input,new Date(clock)).value,expected);
});
test('zona horaria: medianoche UTC no cambia prematuramente el día de Lima',()=>{
  assert.equal(limaClock('2026-10-31T00:30:00Z').date,'2026-10-30');
  assert.equal(limaClock('2026-10-31T04:59:00Z').time,'23:59');
  assert.equal(limaClock('2026-10-31T05:00:00Z').date,'2026-10-31');
  assert.equal(parseDatePreference('mañana','2026-11-01T02:00:00Z').value,'2026-11-01');
  assert.equal(limaClock(now).timeZone,'America/Lima');
});
test('fechas explícitas: ISO, día/mes/año y meses en español',()=>{
  for(const input of ['sábado 31 de octubre de 2026','31 de octubre','31 de octubre de 2026','31/10/2026','31/10','31-10-2026','2026-10-31'])
    assert.equal(parseDatePreference(input,now).value,'2026-10-31',input);
  assert.equal(parseDatePreference('1 de noviembre de 2026',now).value,'2026-11-01');
});
test('fechas ambiguas o inexistentes nunca se registran como definitivas',()=>{
  for(const [input,issue] of [
    ['31 de noviembre','invalid_date'],['31/02/2027','invalid_date'],['31/10/26','ambiguous_year'],
    ['31 de octubre de 26','ambiguous_year'],['31/10/20266','invalid_date'],
    ['mañana o pasado mañana','ambiguous_date'],['el viernes','ambiguous_weekday'],
    ['1 de enero','ambiguous_year'],['el fin de semana','unrecognized_date'],
  ]) {
    const result=parseDatePreference(input,now);
    assert.equal(result.value,null,input);assert.equal(result.issue,issue,input);
  }
  assert.equal(parseDatePreference('el próximo viernes',now).value,'2026-11-06');
  assert.equal(parseDatePreference('este viernes',now).value,'2026-10-30');
});
test('horarios: mañana, tarde, noche, AM/PM, palabras y minutos normalizan a 24 horas',()=>{
  for(const [input,expected] of [
    ['3 de la tarde','15:00'],['10 de la mañana','10:00'],['7 de la noche','19:00'],
    ['3:00 p. m.','15:00'],['3pm','15:00'],['10 a. m.','10:00'],['00:00','00:00'],
    ['a las 10:00','10:00'],['10:00 aproximadas','10:00'],['03:00 de la tarde','15:00'],['7 de la tarde','19:00'],['15:45','15:45'],['a las tres y media de la tarde','15:30'],['diez y cuarto de la mañana','10:15'],
    ['12 p. m.','12:00'],['12 a. m.','00:00'],
  ]) assert.equal(parseTimePreference(input).value,expected,input);
  assert.equal(parseTimePreference('10 de la mañana').original,'10 de la mañana');
  assert.equal(parseTimePreference('3:00 p. m.').original,'3:00 p. m.');
});
test('horarios ambiguos, rangos y franjas no inventan una hora',()=>{
  for(const input of ['a las 5','3 o 5','entre las 3 y 5','a las 3 o a las 4'])assert.equal(parseTimePreference(input).issue,'ambiguous_time',input);
  for(const input of ['por la mañana','por la tarde','por la noche']){
    const result=parseTimePreference(input);assert.equal(result.issue,'time_required');assert.equal(result.value,null);
  }
  for(const input of ['25:00','15:75','15:5','a las 15:abc','15 am','15:00 de la mañana'])assert.equal(parseTimePreference(input).issue,'invalid_time',input);
});
test('visita: almacena ISO y hora de 24h, originales, referencia, etiquetas y simulación',()=>{
  const result=prepare(null,complete,{message:'Tal vez para mañana a las 3 de la tarde'}).request;
  assert.equal(result.preferred_date,'2026-10-31');assert.equal(result.preferred_time,'15:00');
  assert.equal(result.schedule.date.original,'mañana');assert.equal(result.schedule.time.original,'a las 3 de la tarde');
  assert.equal(result.schedule.date.reference,'2026-10-30');assert.equal(result.schedule.date.expressedAt,now.toISOString());
  assert.match(result.schedule.dateLabel,/Sábado.*31 de octubre de 2026/);assert.equal(result.schedule.timeLabel,'3:00 p. m.');
  assert.equal(result.statusLabel,'Solicitud preparada — simulación, pendiente de confirmación');
  assert.equal(result.notified,false);assert.equal(result.confirmed,false);
});
test('fuente: expresión del cliente prevalece sobre un calendario u hora calculados erróneamente por el modelo',()=>{
  const result=prepare(null,{...complete,preferred_date:'2026-11-01',preferred_time:'03:00'},{message:'Tal vez para mañana a las 3 de la tarde'}).request;
  assert.equal(result.preferred_date,'2026-10-31');assert.equal(result.preferred_time,'15:00');
});
test('franja sin hora: mantiene preferencia y solicita precisión en vez de completar la visita',()=>{
  const result=prepare(null,{...complete,preferred_time:'por la tarde'}).request;
  assert.equal(result.preferred_time,null);assert.equal(result.schedule.period,'tarde');
  assert.equal(result.schedule.periodLabel,'por la tarde');assert.equal(result.status,'draft');
  assert.deepEqual(result.missingFields,['preferred_time']);assert.match(result.schedule.feedback.join(),/falta indicar la hora/);
});
test('correcciones: cambia domingo a las 5 conservando franja, identidad y propiedad',()=>{
  const before=prepare(null,complete), original=structuredClone(before.state);
  const result=prepare(before.state,{preferred_date:'el domingo',preferred_time:'a las 5'},{message:'Mejor el domingo a las 5'}).request;
  assert.equal(result.preferred_date,'2026-11-01');assert.equal(result.preferred_time,'17:00');
  assert.equal(result.property_id,fixture.id);assert.equal(result.name,complete.name);assert.equal(result.contact,complete.contact);
  assert.deepEqual(before.state,original);assert.deepEqual(known.get(fixture.id).photos,fixture.photos);
});
test('correcciones: fecha sola conserva hora, nueva franja reemplaza hora precisa y se puede completar después',()=>{
  const first=prepare(null,complete);
  const second=prepare(first.state,{preferred_date:'pasado mañana'},{message:'Cámbialo para pasado mañana'});
  assert.equal(second.request.preferred_date,'2026-11-01');assert.equal(second.request.preferred_time,'15:00');
  const third=prepare(second.state,{preferred_date:'el lunes',preferred_time:'por la mañana'},{message:'Prefiero el lunes por la mañana'});
  assert.equal(third.request.preferred_date,'2026-11-02');assert.equal(third.request.preferred_time,null);
  assert.equal(third.request.status,'draft');assert.equal(third.request.schedule.period,'manana');
  const fourth=prepare(third.state,{preferred_time:'a las 10'},{message:'A las 10'});
  assert.equal(fourth.request.preferred_date,'2026-11-02');assert.equal(fourth.request.preferred_time,'10:00');assert.equal(fourth.request.status,'prepared');
});
test('ambigüedad: no decide AM/PM para una nueva visita sin franja previa',()=>{
  const result=prepare(null,{...complete,preferred_date:'el domingo',preferred_time:'a las 5'}).request;
  assert.equal(result.preferred_date,'2026-11-01');assert.equal(result.preferred_time,null);
  assert.equal(result.status,'draft');assert.equal(result.schedule.issues.time,'ambiguous_time');
});
test('fechas y horas pasadas impiden dar por preparada una solicitud',()=>{
  const date=prepare(null,{...complete,preferred_date:'29/10/2026'}).request;
  assert.equal(date.preferred_date,null);assert.equal(date.status,'draft');assert.equal(date.schedule.issues.date,'past_date');
  const time=prepare(null,{...complete,preferred_date:'hoy',preferred_time:'08:00'}).request;
  assert.equal(time.status,'draft');assert.equal(time.schedule.issues.time,'past_time');
  assert.ok(time.missingFields.includes('preferred_time'));
  const future=prepare(null,{...complete,preferred_date:'hoy',preferred_time:'09:01'}).request;
  assert.equal(future.status,'prepared');
});
test('medianoche: datos nuevos ajenos a horario y ecos de mañana conservan la fecha original',()=>{
  const first=prepare(null,complete,{now:new Date('2026-10-31T04:59:00Z')});
  for(const changes of [{comment:'SOLO PRUEBA · Otro dato'},{preferred_date:'mañana'},{preferred_date:'manana'},{preferred_date:'2026-10-31'}]){
    const next=prepare(first.state,changes,{now:new Date('2026-10-31T05:01:00Z'),message:'SOLO PRUEBA · Conservo lo anterior.'}).request;
    assert.equal(next.preferred_date,'2026-10-31');
    assert.equal(next.schedule.date.reference,'2026-10-30');
  }
  const edited=prepare(first.state,{preferred_date:'mañana'},{now:new Date('2026-10-31T05:01:00Z'),message:'Mejor mañana'}).request;
  assert.equal(edited.preferred_date,'2026-11-01');assert.equal(edited.schedule.date.reference,'2026-10-31');
});
test('fecha ya normalizada que pasa no se desplaza: exige corregir preferencia sin perder la referencia',()=>{
  const first=prepare(null,complete);
  const refreshed=refreshDemoState(first.state,new Date('2026-11-01T14:00:00Z')).requests.visit;
  assert.equal(refreshed.preferred_date,'2026-10-31');assert.equal(refreshed.status,'draft');
  assert.equal(refreshed.schedule.issues.date,'past_date');assert.equal(first.request.status,'prepared');
});
test('preferencias históricas sin referencia requieren confirmación en vez de recalcular mañana',()=>{
  const old={profile:{},requests:{visit:{...args(complete),preferred_date:'mañana'}}};
  const result=refreshDemoState(old,now).requests.visit;
  assert.equal(result.preferred_date,null);assert.equal(result.schedule.issues.date,'legacy_date');assert.equal(result.status,'draft');
});
test('reloj de recepción: un ciclo de herramientas que cruza medianoche no desplaza mañana',async()=>{
  let current=new Date('2026-10-31T04:59:00Z');const bodies=[], sequence=[call(complete),answer()];
  const chat=createChat({apiKey:'synthetic-key',model:'gpt-6-luna',clock:()=>new Date(current),tokko:{search:()=>assert.fail('Sin Tokko'),detail:()=>assert.fail('Sin Tokko')},fetchImpl:async(_url,options)=>{
    bodies.push(JSON.parse(options.body));current=new Date('2026-10-31T05:01:00Z');return new Response(JSON.stringify(sequence.shift()));
  }});
  const s=session(), result=await chat(s,'SOLO PRUEBA · Mañana a las 3 de la tarde',{demo:true});
  assert.equal(result.demoRequests[0].preferred_date,'2026-10-31');
  assert.equal(parsedContext(bodies[0]).demoClock.date,'2026-10-30');
  assert.equal(parsedContext(bodies[1]).demoClock.date,'2026-10-30');
  assert.deepEqual(result.properties,[]);assert.deepEqual(s.properties.get(fixture.id).photos,fixture.photos);
  assert.equal(bodies[0].tool_choice,'auto');assert.equal(bodies[0].model,'gpt-6-luna');assert.deepEqual(bodies[0].reasoning,{effort:'none'});
});
test('herramienta diferida: mañana usa la referencia del mensaje anterior y no la del turno posterior',async()=>{
  let current=new Date('2026-10-31T04:59:00Z');const sequence=[answer(),call(complete),answer()];
  const chat=createChat({apiKey:'synthetic-key',clock:()=>new Date(current),tokko:{},fetchImpl:async()=>new Response(JSON.stringify(sequence.shift()))});
  const s=session();
  await chat(s,'SOLO PRUEBA · Prefiero mañana a las 3 de la tarde',{demo:true});
  assert.equal(s.demoTemporalReferences[0].expressedAt,'2026-10-31T04:59:00.000Z');
  current=new Date('2026-10-31T05:01:00Z');
  const result=await chat(s,'SOLO PRUEBA · Mi contacto ficticio',{demo:true});
  assert.equal(result.demoRequests[0].preferred_date,'2026-10-31');
  assert.equal(result.demoRequests[0].schedule.date.reference,'2026-10-30');
});
test('turno fallido: no confirma ni incorpora referencias temporales en la sesión',async()=>{
  const s=session();
  const chat=createChat({apiKey:'synthetic-key',clock:()=>now,tokko:{},fetchImpl:async()=>new Response(JSON.stringify({status:'failed',output:[]}))});
  await assert.rejects(chat(s,'SOLO PRUEBA · Mañana',{demo:true}));
  assert.equal(s.demoState,undefined);assert.equal(s.demoTemporalReferences,undefined);
});
test('HTTP: referencias, solicitudes y correcciones de fecha aisladas entre dos sesiones',async t=>{
  let current=new Date('2026-10-31T04:59:00Z');const bodies=[];
  const sequence=[
    call({...complete,property_id:null}),answer(),
    call({...complete,property_id:null,preferred_date:'pasado mañana',name:'SOLO PRUEBA · B'}),answer(),
    call({comment:'SOLO PRUEBA · Revisión A'}),answer(),
    call({preferred_date:'el lunes',preferred_time:'por la mañana'}),answer(),
  ];
  const app=createApp({clock:()=>new Date(current),env:{OPENAI_API_KEY:'synthetic-key',TOKKO_API_KEY:'synthetic-key',OPENAI_MODEL:'gpt-6-luna'},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');bodies.push(JSON.parse(options.body));assert.ok(sequence.length);return new Response(JSON.stringify(sequence.shift()));
  }});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
  const post=async(message,cookie)=>fetch('http://127.0.0.1:'+app.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({message,mode:'demo'})});
  const first=await post('SOLO PRUEBA · mañana a las 3 de la tarde'),cookieA=first.headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).demoRequests[0].preferred_date,'2026-10-31');
  const second=await post('SOLO PRUEBA · pasado mañana a las 3 de la tarde'),cookieB=second.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookieA,cookieB);assert.equal((await second.json()).demoRequests[0].preferred_date,'2026-11-01');
  current=new Date('2026-10-31T05:01:00Z');
  const review=await post('SOLO PRUEBA · Revisar A',cookieA);assert.equal((await review.json()).demoRequests[0].preferred_date,'2026-10-31');
  const edit=await post('SOLO PRUEBA · Prefiero el lunes por la mañana',cookieB),request=(await edit.json()).demoRequests[0];
  assert.equal(request.preferred_date,'2026-11-02');assert.equal(request.preferred_time,null);
  assert.equal(parsedContext(bodies[4]).demoState.requests.visit.name,complete.name);
  assert.equal(parsedContext(bodies[6]).demoState.requests.visit.name,'SOLO PRUEBA · B');
  assert.equal(sequence.length,0);
});
test('referencias temporales guardan fragmentos pertinentes sin copiar el nombre ni el contacto del mensaje',()=>{
  const reference=temporalReference('SOLO PRUEBA · Soy Persona Ficticia, contacto SOLO-PRUEBA-000, mañana a las 3 de la tarde',now);
  assert.equal(reference.date,'mañana');assert.equal(reference.time,'a las 3 de la tarde');
  assert.ok(!JSON.stringify(reference).includes('SOLO-PRUEBA-000'));
});


test('corrección a hora de 24h reemplaza también la franja previa para futuras ediciones',()=>{
  const first=prepare(null,complete);
  const second=prepare(first.state,{preferred_time:'05:00'});
  assert.equal(second.request.preferred_time,'05:00');assert.equal(second.request.schedule.period,'manana');
  const third=prepare(second.state,{preferred_time:'a las 6'});
  assert.equal(third.request.preferred_time,'06:00');
});
