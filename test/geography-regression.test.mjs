// SOLO PRUEBAS: IDs, propiedades y decisiones del modelo sintéticos. Sin APIs reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokko, normalizeProperty } from '../lib/tokko.mjs';
import { createChat } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';
const json = (v,status=200) => new Response(JSON.stringify(v),{status});
const san = {id:65001,name:'San Miguel',type:'Distrito',full_location:'Perú | Lima | San Miguel',resource_uri:'/api/v1/location/65001/'};
const mira = {id:65004,name:'Miraflores',type:'Distrito',full_location:'Perú | Lima | Lima | Miraflores',resource_uri:'/api/v1/location/65004/'};
const homonyms = [
  {id:65002,name:'San Miguel',type:'Barrio',full_location:'Perú | Lima | Lima | Los Olivos | San Miguel'},
  {id:65003,name:'San Miguel',type:'Sector',full_location:'Perú | Lima | Lima | San Martín de Porres | San Miguel'},
  {id:65005,name:'San Miguel',type:'Localidad',full_location:'Argentina | Buenos Aires | San Miguel'},
];
const property = (id,location=san) => ({id,publication_title:'SOLO PRUEBA · Departamento sintético',location,type:{id:2,name:'Departamento'},description:'SOLO PRUEBA · Descripción íntegra.',
  operations:[{operation_id:1,operation_type:'Venta',prices:[{currency:'PEN',price:490000}]}],
  photos:Array.from({length:16},(_,i)=>({original:'https://example.test/synthetic/'+id+'/'+i+'.jpg'}))});
const state = () => ({history:[],properties:new Map(),lastResultIds:[],lastSearch:null,turns:0});
const criteria = {location:'San Miguel, Lima',operation:1,property_types:[2],currency:'PEN',max_price:500000};
const call = (changes,name='search_properties') => ({status:'completed',output:[{type:'function_call',name,call_id:'synthetic-geo',arguments:JSON.stringify(changes)}]});
const answer = () => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'SOLO PRUEBA · Respuesta simulada.'}]}]});
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
function catalog({locations=[san,...homonyms,mira], properties=[property(65101),property(65104,mira)], searchFailure=null, rawResults=null, detailOverride=null}={}) {
  const requests=[];
  const fetchImpl=async(input)=>{
    const url=new URL(input);requests.push(url);
    if(url.pathname.includes('/quicksearch/')) return json({objects:locations});
    if(url.pathname.includes('/property/search/')){
      const data=JSON.parse(url.searchParams.get('data'));
      const failure=typeof searchFailure==='function'?searchFailure(data):searchFailure;
      if(failure)return json({error:'SYNTHETIC_PRIVATE_PROVIDER_TEXT'},failure);
      const matches=rawResults || properties.filter(p=>data.current_localization_id.includes(p.location.id) && (!data.property_types.length || data.property_types.includes(p.type.id)) && p.operations.some(op=>data.operation_types.includes(op.operation_id) && op.prices.some(price=>(data.currency==='ANY'||data.currency===price.currency) && price.price>=data.price_from && price.price<=data.price_to)));
      return json({objects:matches,meta:{total_count:matches.length,next:null}});
    }
    const found=properties.find(p=>url.pathname==='/api/v1/property/'+p.id+'/');
    assert.ok(found,'Solo detalles de la fixture, sin red real');return json(detailOverride?detailOverride(found):found);
  };
  return {requests,fetchImpl,tokko:createTokko({apiKey:'synthetic-key',fetchImpl})};
}
function scripted(sequence,tokko){
  const bodies=[];
  return {bodies,chat:createChat({apiKey:'synthetic-key',model:'gpt-6-luna',tokko,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');bodies.push(JSON.parse(options.body));assert.ok(sequence.length);return json(sequence.shift());
  }}),done:()=>assert.equal(sequence.length,0)};
}
const searches = c => c.requests.filter(u=>u.pathname.includes('/property/search/')).map(u=>JSON.parse(u.searchParams.get('data')));

test('San Miguel: distrito de Lima con padres opcionales prevalece sobre sectores homónimos',async()=>{
  const c=catalog(),result=await c.tokko.search(criteria);
  assert.equal(result.needsLocation,undefined);assert.deepEqual(result.resolvedLocation.ids,[san.id]);
  assert.deepEqual(searches(c)[0].current_localization_id,[san.id]);
  assert.equal(searches(c)[0].price_to,500000);assert.equal(searches(c)[0].currency,'PEN');
  assert.deepEqual(searches(c)[0].operation_types,[1]);assert.deepEqual(searches(c)[0].property_types,[2]);
  assert.equal(result.properties[0].photos.length,16);
});
test('San Miguel: type distingue distrito de sector incluso con rutas publicadas iguales',async()=>{
  const sector={...san,id:65009,type:'Sector'};
  const c=catalog({locations:[sector,san]});
  const result=await c.tokko.search(criteria);
  assert.deepEqual(result.resolvedLocation.ids,[san.id]);
});
test('cambio en el mismo turno: Miraflores sustituye San Miguel sin bloquearse ni acumular tarjetas',async()=>{
  const p=normalizeProperty(property(65101)),m=normalizeProperty(property(65104,mira)),calls=[];
  const h=scripted([call(criteria),call({location:'Miraflores'}),answer()],{search:async filters=>{
    calls.push(filters);return {properties:[filters.location==='Miraflores'?m:p],filters,nextOffset:null};
  }});
  const s=state(),result=await h.chat(s,'SOLO PRUEBA · Revisa San Miguel; luego Miraflores conservando mis criterios.');
  assert.equal(calls.length,2);assert.equal(calls[1].operation,1);assert.equal(calls[1].max_price,500000);
  assert.deepEqual(result.properties.map(p=>p.id),[m.id]);assert.equal(result.searches.length,1);
  assert.deepEqual(context(h.bodies[2]).responseCards.map(p=>p.propertyId),[m.id]);
  assert.deepEqual(s.lastResultIds,[m.id]);assert.ok(s.properties.has(p.id));h.done();
});
test('un fallo de nueva búsqueda elimina referencias activas antiguas pero conserva las propiedades conocidas',async()=>{
  const s=state(),p=normalizeProperty(property(65101));s.properties.set(p.id,p);s.lastResultIds=[p.id];s.lastSearch={filters:criteria,properties:[p]};
  const c=catalog({searchFailure:503}),h=scripted([call({location:'Miraflores'}),answer()],c.tokko);
  const result=await h.chat(s,'SOLO PRUEBA · Ahora Miraflores');
  assert.deepEqual(result.properties,[]);assert.deepEqual(s.lastResultIds,[]);assert.equal(s.lastSearch,null);
  assert.equal(s.lastSearchAttempt.status,'error');assert.deepEqual(s.properties.get(p.id).photos,p.photos);h.done();
});


test('confirmaciones repetidas: ID verificado permanece en sesión y quicksearch no se repite',async()=>{
  const c=catalog(),h=scripted([call(criteria),answer(),call({location:'SAN MIGUEL LIMA'}),answer(),call({location:'Perú | Lima | Lima | San Miguel'}),answer()],c.tokko),s=state();
  for(const message of ['SOLO PRUEBA · departamento en venta en San Miguel, Lima hasta 500000 soles','SÍ SAN MIGUEL LIMA','SOLO PRUEBA · Sí, el mismo distrito']){
    const result=await h.chat(s,message);
    assert.deepEqual(result.properties.map(p=>p.id),[65101]);assert.equal(result.properties[0].photos.length,16);
  }
  assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,1);
  assert.ok(searches(c).every(data=>data.current_localization_id[0]===san.id));
  assert.deepEqual(s.resolvedLocation.ids,[san.id]);assert.equal(context(h.bodies[4]).resolvedLocation.candidates[0].type,'Distrito');h.done();
});
test('refinamiento conserva el ID incluso si quicksearch cambia; precio sustituye presupuesto y mantiene venta/departamento/PEN',async()=>{
  const locations=[san,...homonyms],c=catalog({locations}),h=scripted([call(criteria),answer(),call({max_price:510000}),answer()],c.tokko),s=state();
  await h.chat(s,'SOLO PRUEBA · San Miguel');
  locations.splice(0,1); // El proveedor simulado solo devolvería homónimos en una nueva resolución.
  const result=await h.chat(s,'SOLO PRUEBA · Puedo llegar a 510000 soles');
  const data=searches(c)[1];
  assert.equal(data.price_to,510000);assert.equal(data.currency,'PEN');assert.deepEqual(data.operation_types,[1]);assert.deepEqual(data.property_types,[2]);
  assert.deepEqual(data.current_localization_id,[san.id]);assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,1);
  assert.deepEqual(result.properties[0].photos,normalizeProperty(property(65101)).photos);h.done();
});
test('nuevo turno y distrito: reemplaza listado/responseCards y conserva el catálogo anterior sin mezclarlo',async()=>{
  const c=catalog(),h=scripted([call(criteria),answer(),call({location:'Miraflores',offset:20}),answer()],c.tokko),s=state();
  await h.chat(s,'SOLO PRUEBA · San Miguel');
  const result=await h.chat(s,'SOLO PRUEBA · Mejor Miraflores');
  assert.deepEqual(result.properties.map(p=>p.id),[65104]);assert.deepEqual(s.lastResultIds,[65104]);
  assert.deepEqual(s.resolvedLocation.ids,[mira.id]);assert.equal(s.searchCriteria.location,'Miraflores');
  assert.equal(s.searchCriteria.operation,1);assert.deepEqual(s.searchCriteria.property_types,[2]);assert.equal(s.searchCriteria.max_price,500000);
  assert.deepEqual(searches(c)[1].current_localization_id,[mira.id]);
  assert.equal(c.requests.filter(u=>u.pathname.includes('/property/search/'))[1].searchParams.get('offset'),'0');
  const current=context(h.bodies[3]);
  assert.deepEqual(current.lastSearch.properties.map(p=>p.id),[65104]);assert.deepEqual(current.responseCards.map(p=>p.propertyId),[65104]);
  assert.deepEqual(current.knownProperties.map(p=>p.id),[65101,65104]);assert.equal(s.properties.get(65101).photos.length,16);h.done();
});
test('nuevo resultado vacío en el mismo turno retira las fichas de la búsqueda anterior',async()=>{
  const c=catalog({properties:[property(65101)]}),h=scripted([call(criteria),call({location:'Miraflores'}),answer()],c.tokko),s=state();
  const result=await h.chat(s,'SOLO PRUEBA · Cambia el distrito');
  assert.deepEqual(result.properties,[]);assert.deepEqual(s.lastResultIds,[]);assert.equal(result.searches.length,1);assert.equal(result.searches[0].count,0);
  assert.equal(s.lastSearchAttempt.status,'no_matches');assert.equal(s.lastSearch.status,'no_matches');
  assert.deepEqual(context(h.bodies[2]).responseCards,[]);assert.ok(s.properties.has(65101));h.done();
});
test('error en el mismo turno retira fichas previas y se distingue de cero coincidencias',async()=>{
  const c=catalog({searchFailure:data=>data.current_localization_id.includes(mira.id)?503:null});
  const h=scripted([call(criteria),call({location:'Miraflores'}),answer()],c.tokko),s=state(),result=await h.chat(s,'SOLO PRUEBA · Cambia el distrito');
  assert.deepEqual(result.properties,[]);assert.deepEqual(result.searches,[]);assert.equal(s.lastSearch,null);assert.deepEqual(s.lastResultIds,[]);
  assert.equal(s.lastSearchAttempt.status,'error');assert.equal(s.lastSearchAttempt.error,'upstream_error');
  assert.ok(s.properties.has(65101));assert.equal(s.properties.get(65101).photos.length,16);
  const outputs=h.bodies[2].input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output));
  assert.deepEqual(outputs.map(o=>o.status),['matches','error']);assert.deepEqual(context(h.bodies[2]).responseCards,[]);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_PROVIDER_TEXT'));h.done();
});
test('aclaración real tras una búsqueda retira posiciones activas antiguas sin borrar memoria',async()=>{
  const zones=[{id:65201,name:'Zona',type:'Sector',full_location:'Perú | Lima | Lima | Sector A | Zona'},{id:65202,name:'Zona',type:'Sector',full_location:'Perú | Lima | Lima | Sector B | Zona'}];
  const c=catalog({locations:[san,...zones]}),h=scripted([call(criteria),call({location:'Zona'}),answer()],c.tokko),s=state();
  const result=await h.chat(s,'SOLO PRUEBA · Cambia a una zona ambigua');
  assert.equal(s.lastSearchAttempt.status,'needs_location');assert.deepEqual(s.lastResultIds,[]);assert.deepEqual(result.properties,[]);
  assert.deepEqual(context(h.bodies[2]).responseCards,[]);assert.equal(s.lastSearch.properties.length,0);assert.ok(s.properties.has(65101));h.done();
});
test('ambigüedad equivalente se aclara por jerarquía y después se conserva su ID',async()=>{
  const zones=[{id:65201,name:'Zona',type:'Sector',full_location:'Perú | Lima | Lima | Sector A | Zona'},{id:65202,name:'Zona',type:'Sector',full_location:'Perú | Lima | Lima | Sector B | Zona'}];
  const c=catalog({locations:zones,properties:[]}),h=scripted([call({location:'Zona',operation:1,property_types:[2],currency:'PEN',max_price:500000}),answer(),call({location:'Zona, Sector B, Lima'}),answer(),call({max_price:510000}),answer()],c.tokko),s=state();
  await h.chat(s,'SOLO PRUEBA · Zona');
  assert.equal(s.lastSearchAttempt.status,'needs_location');assert.equal(searches(c).length,0);assert.equal(s.lastSearch.locations.length,2);
  await h.chat(s,'SOLO PRUEBA · Sector B');
  assert.deepEqual(s.resolvedLocation.ids,[65202]);
  await h.chat(s,'SOLO PRUEBA · Cambio presupuesto');
  assert.deepEqual(searches(c).map(data=>data.current_localization_id),[[65202],[65202]]);
  assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,2);h.done();
});
test('búsqueda válida sin coincidencias conserva ID y filtros, sin confundirse con error o ambigüedad',async()=>{
  const c=catalog({properties:[]}),h=scripted([call(criteria),answer(),call({max_price:510000}),answer()],c.tokko),s=state();
  const first=await h.chat(s,'SOLO PRUEBA · Busca');assert.equal(first.searches[0].count,0);
  assert.equal(s.lastSearchAttempt.status,'no_matches');assert.deepEqual(s.resolvedLocation.ids,[san.id]);
  await h.chat(s,'SOLO PRUEBA · Aumento presupuesto');
  assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,1);assert.equal(s.lastSearchAttempt.status,'no_matches');h.done();
});
test('error del proveedor después de resolver conserva el ID para reintentar sin confirmar de nuevo',async()=>{
  let fail=true;
  const c=catalog({searchFailure:()=>fail?503:null}),h=scripted([call(criteria),answer(),call({}),answer()],c.tokko),s=state();
  await h.chat(s,'SOLO PRUEBA · Busca San Miguel');assert.equal(s.lastSearchAttempt.status,'error');assert.deepEqual(s.resolvedLocation.ids,[san.id]);
  fail=false;const result=await h.chat(s,'SOLO PRUEBA · Reintenta');
  assert.equal(result.properties[0].id,65101);assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,1);h.done();
});
test('respuesta del proveedor en otro distrito es inconsistencia técnica, nunca un resultado válido ni un vacío',async()=>{
  const c=catalog({rawResults:[property(65104,mira)]}),h=scripted([call(criteria),answer()],c.tokko),s=state();
  const result=await h.chat(s,'SOLO PRUEBA · San Miguel');
  assert.equal(s.lastSearchAttempt.status,'error');assert.equal(s.lastSearchAttempt.error,'inconsistent_results');
  assert.deepEqual(result.properties,[]);assert.deepEqual(result.searches,[]);assert.equal(s.lastSearch,null);
  assert.deepEqual(searches(c)[0].current_localization_id,[san.id]);
  assert.equal(c.requests.filter(u=>/\/property\/\d+\//.test(u.pathname)).length,0);h.done();
});
test('detalle fuera del distrito solicitado también genera inconsistencia y conserva intactas las fotos del proveedor',async()=>{
  const original=property(65101),c=catalog({properties:[original],detailOverride:p=>({...p,location:mira})});
  await assert.rejects(c.tokko.search(criteria),error=>error.code==='inconsistent_results');
  assert.equal(original.photos.length,16);assert.equal(original.location.id,san.id);
});
test('un barrio llamado San Miguel dentro de otro distrito no se considera el distrito seleccionado',async()=>{
  const c=catalog({rawResults:[property(65106,homonyms[0])]});
  await assert.rejects(c.tokko.search(criteria),error=>error.code==='inconsistent_results');
});
test('la jerarquía metropolitana prevalece sobre un homónimo provincial de tipo Distrito',async()=>{
  const metro={id:65301,name:'Santiago de Surco',type:'Localidad',full_location:'Perú | Lima | Lima | Santiago de Surco'};
  const other={id:65302,name:'Surco',type:'Distrito',full_location:'Perú | Lima | Huarochirí | Surco'};
  const c=catalog({locations:[other,metro],properties:[]});
  assert.deepEqual((await c.tokko.search({location:'Surco, Lima'})).resolvedLocation.ids,[metro.id]);
});
test('ubicación totalmente calificada selecciona sus padres explícitos sin asumir siempre Lima ciudad',async()=>{
  const outsideMetro={id:65303,name:'San Miguel',type:'Distrito',full_location:'Perú | Lima | Yauyos | San Miguel'};
  const c=catalog({locations:[san,...homonyms,outsideMetro],properties:[]});
  const result=await c.tokko.search({location:'Perú | Lima | Yauyos | San Miguel'});
  assert.deepEqual(result.resolvedLocation.ids,[outsideMetro.id]);
});
test('distrito nuevo y almacén utilizan los IDs del proveedor sin lista local de nombres',async()=>{
  const place={id:65304,name:'Distrito sintético nuevo',type:'Distrito',full_location:'Perú | Lima | Provincia de Lima | Distrito sintético nuevo'};
  const warehouse={...property(65401,place),type:{id:12,name:'Nave Industrial'}};
  const c=catalog({locations:[place],properties:[warehouse]});
  const result=await c.tokko.search({location:place.name,property_types:[12],operation:1});
  assert.deepEqual(result.resolvedLocation.ids,[place.id]);assert.deepEqual(searches(c)[0].property_types,[12]);
  assert.equal(result.properties[0].typeId,12);assert.equal(result.properties[0].photos.length,16);
});
test('quicksearch paginado completa los candidatos antes de decidir entre sectores y distrito',async()=>{
  const offsets=[],sectors=Array.from({length:100},(_,i)=>({id:66000+i,name:'San Miguel',type:'Sector',full_location:'Perú | Lima | Lima | Distrito sintético '+i+' | San Miguel'}));
  const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>{
    const url=new URL(input);
    if(url.pathname.includes('/quicksearch/')){
      assert.equal(url.searchParams.get('q'),'san miguel');assert.equal(url.searchParams.get('scope'),'full');
      const offset=Number(url.searchParams.get('offset'));offsets.push(offset);
      return json({objects:offset===0?sectors:[san],meta:{total_count:101,next:offset===0?'/api/v1/location/quicksearch/?offset=100&key=SYNTHETIC_PRIVATE':null}});
    }
    const data=JSON.parse(url.searchParams.get('data'));assert.deepEqual(data.current_localization_id,[san.id]);
    return json({objects:[],meta:{total_count:0,next:null}});
  }});
  const result=await tokko.search(criteria);assert.deepEqual(offsets,[0,100]);assert.deepEqual(result.resolvedLocation.ids,[san.id]);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
});
test('quicksearch: array documentado y tipo Localidad se resuelven sin adivinar códigos numéricos',async()=>{
  const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>new URL(input).pathname.includes('/quicksearch/')?json([{...san,type:'Localidad'}]):json({objects:[],meta:{total_count:0,next:null}})});
  assert.deepEqual((await tokko.search(criteria)).resolvedLocation.ids,[san.id]);
});
test('IDs de ubicaciones no válidos y paginación detenida son errores, no búsquedas generales',async()=>{
  for(const invalid of [true,false]){
    let searchesCalled=0;
    const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>{
      if(new URL(input).pathname.includes('/property/search/'))searchesCalled++;
      return invalid?json({objects:[{...san,id:'not-a-provider-id'}]}):json({objects:[san],meta:{total_count:200,next:'synthetic-next-page'}});
    }});
    await assert.rejects(tokko.search(criteria),error=>error.code==='invalid_response');assert.equal(searchesCalled,0);
  }
});
test('propiedad anterior sigue consultable y su galería completa se puede mostrar explícitamente después del cambio',async()=>{
  const c=catalog(),h=scripted([call(criteria),answer(),call({location:'Miraflores'}),answer(),call({property_id:65101,result_index:null},'show_property'),answer()],c.tokko),s=state();
  await h.chat(s,'SOLO PRUEBA · San Miguel');await h.chat(s,'SOLO PRUEBA · Miraflores');
  const result=await h.chat(s,'SOLO PRUEBA · Vuelve a mostrar el anterior de San Miguel');
  assert.equal(result.properties[0].id,65101);assert.equal(result.properties[0].photos.length,16);assert.deepEqual(s.lastResultIds,[65104]);assert.equal(searches(c).length,2);h.done();
});
test('HTTP: ubicaciones, presupuesto, resultados y resolución se mantienen aislados entre sesiones',async t=>{
  const c=catalog(),bodies=[],sequence=[call(criteria),answer(),call({...criteria,location:'Miraflores'}),answer(),call({max_price:510000}),answer(),call({max_price:520000}),answer()];
  const app=createApp({env:{OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'synthetic-key',TOKKO_API_KEY:'synthetic-key'},fetchImpl:async(input,options)=>{
    if(String(input)==='https://api.openai.com/v1/responses'){bodies.push(JSON.parse(options.body));assert.ok(sequence.length);return json(sequence.shift());}
    return c.fetchImpl(input,options);
  }});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
  const post=(message,cookie)=>fetch('http://127.0.0.1:'+app.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({message,mode:'demo'})});
  const a=await post('SOLO PRUEBA · San Miguel'),cookieA=a.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await a.json()).properties.map(p=>p.id),[65101]);
  const b=await post('SOLO PRUEBA · Miraflores'),cookieB=b.headers.get('set-cookie').split(';')[0];assert.notEqual(cookieA,cookieB);
  assert.deepEqual((await b.json()).properties.map(p=>p.id),[65104]);
  assert.deepEqual((await (await post('SOLO PRUEBA · Aumento A',cookieA)).json()).properties.map(p=>p.id),[65101]);
  assert.deepEqual((await (await post('SOLO PRUEBA · Aumento B',cookieB)).json()).properties.map(p=>p.id),[65104]);
  assert.deepEqual(context(bodies[4]).resolvedLocation.ids,[san.id]);assert.deepEqual(context(bodies[6]).resolvedLocation.ids,[mira.id]);
  assert.deepEqual(context(bodies[4]).knownProperties.map(p=>p.id),[65101]);
  assert.deepEqual(context(bodies[6]).knownProperties.map(p=>p.id),[65104]);
  assert.equal(c.requests.filter(u=>u.pathname.includes('/quicksearch/')).length,2);
  assert.ok(bodies.every(body=>body.model==='gpt-6-luna' && body.tool_choice==='auto' && body.reasoning.effort==='none'));assert.equal(sequence.length,0);
});


test('un único sector homónimo no se convierte silenciosamente en el distrito solicitado',async()=>{
  const c=catalog({locations:[homonyms[0]],properties:[]});
  const result=await c.tokko.search(criteria);
  assert.equal(result.needsLocation,true);assert.equal(result.locations[0].type,'Barrio');assert.equal(searches(c).length,0);
  const explicit=await c.tokko.search({...criteria,location:'San Miguel, Los Olivos, Lima'});
  assert.deepEqual(explicit.resolvedLocation.ids,[homonyms[0].id]);
});
