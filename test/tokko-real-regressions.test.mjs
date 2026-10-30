// Proveedores y decisiones del modelo SIMULADOS, basados en metadata pública observada.
// No se hacen GET reales ni llamadas a OpenAI; las imágenes son URLs sintéticas de pruebas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokko, normalizeProperty } from '../lib/tokko.mjs';
import { resolveCandidates, missingLocationParents } from '../lib/locations.mjs';
import { createChat } from '../lib/chat.mjs';
import observed from './fixtures/tokko-geography-observed.json' with {type:'json'};
const {sanDistrict,sanSector,otherSanSector,mirDistrict,mirChild,mirYauyos,mirOther,publishedPrices}=observed;
function syntheticProperty(id=7233794,location=mirDistrict,count=12,prices=publishedPrices) {
  return {id,reference_code:id===7233794?'GAP7233794':'SOLO-PRUEBA-'+id,publication_title:'SOLO PRUEBA · Dúplex sintético',
    location,type:{id:2,name:'Departamento'},status:2,web_price:true,total_surface:'170.00',description:'SOLO PRUEBA · Descripción sintética completa.',
    operations:[{operation_id:1,operation_type:'Venta',prices}],
    photos:Array.from({length:count},(_,i)=>({original:'https://static.tokkobroker.com/original_pictures/'+id+'_1234567890123456'+i+'123456789.jpg'}))};
}

const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const args={location:'Miraflores, Lima',operation:1,property_types:[2],currency:'PEN',max_price:1000000};
const state=()=>({history:[],properties:new Map(),lastResultIds:[],lastSearch:null,turns:0});
const call=(name,values)=>({status:'completed',output:[{type:'function_call',name,call_id:'observed-regression',arguments:JSON.stringify(values)}]});
const answer=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'SOLO PRUEBA · Respuesta simulada.'}]}]});
const context=body=>JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
function provider({failPrecise=false,missingParent=false,duplicates=false}={}){
  const urls=[], duplex=syntheticProperty(),san=syntheticProperty(80000001,sanDistrict,16,[{currency:'PEN',price:414000,period:0}]);
  const fetchImpl=async input=>{
    const u=new URL(input);urls.push(u);
    if(u.hostname==='gruporentabilizarme.com')return new Response('<meta property="og:image" content="'+duplex.photos[0].original+'">');
    assert.equal(u.hostname,'www.tokkobroker.com');
    if(u.pathname.includes('/quicksearch/')){
      if(u.searchParams.get('scope')==='minimal'){
        assert.equal(u.searchParams.get('q'),'San Miguel (Lima)');
        if(failPrecise)return json({error:'SYNTHETIC_PRIVATE_BODY'},503);
        return json({objects:missingParent?[]:[sanDistrict],meta:{total_count:missingParent?0:1,next:null}});
      }
      if(u.searchParams.get('q')==='san miguel')return json({objects:[sanSector,otherSanSector],meta:{total_count:2,next:null}});
      return json({objects:[mirYauyos,mirOther,mirChild,mirDistrict],meta:{total_count:4,next:null}});
    }
    if(u.pathname.includes('/property/search/')){
      const d=JSON.parse(u.searchParams.get('data'));
      const found=[san,duplex].filter(p=>d.current_localization_id.includes(p.location.id) && (!d.property_types.length || d.property_types.includes(p.type.id)) && p.operations.some(op=>d.operation_types.includes(op.operation_id) && op.prices.some(price=>(d.currency==='ANY' || price.currency===d.currency) && price.price<=d.price_to && price.price>=d.price_from)));
      const objects=duplicates?found.flatMap(p=>[p,p]):found;
      return json({objects,meta:{total_count:objects.length,next:null}});
    }
    const id=Number(u.pathname.match(/\/property\/(\d+)\//)?.[1]),p=[duplex,san].find(p=>p.id===id);
    assert.ok(p,'Solo IDs de fixtures, sin red');return json(p);
  };
  return {urls,duplex,san,tokko:createTokko({apiKey:'synthetic-key',fetchImpl}),fetchImpl};
}
function scripted(sequence,tokko){
  const bodies=[];return {bodies,chat:createChat({apiKey:'synthetic-key',model:'gpt-6-luna',tokko,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');bodies.push(JSON.parse(options.body));assert.ok(sequence.length);return json(sequence.shift());
  }}),done:()=>assert.equal(sequence.length,0)};
}
const searchData=p=>p.urls.filter(u=>u.pathname.includes('/property/search/')).map(u=>JSON.parse(u.searchParams.get('data')));

test('observado: Miraflores Barrio metropolitano prevalece sobre Localidad de Yauyos',()=>{
  const result=resolveCandidates([mirYauyos,mirOther,mirChild,mirDistrict],'Miraflores, Lima');
  assert.deepEqual(result.ids,[248359]);assert.equal(result.candidates[0].type,'Barrio');
  assert.deepEqual(resolveCandidates([mirYauyos,mirDistrict],'Miraflores, Yauyos, Lima').ids,[240072]);
});
test('observado: San Miguel (Lima) es seleccionable aunque Tokko lo clasifique Barrio',()=>{
  assert.deepEqual(resolveCandidates([sanDistrict,sanSector,otherSanSector],'San Miguel, Lima').ids,[250468]);
  assert.deepEqual(resolveCandidates([sanDistrict],'SAN MIGUEL LIMA').ids,[250468]);
});
test('padre ausente: se consulta el nombre calificado publicado y se verifican los IDs antes de buscar',async()=>{
  const p=provider(),result=await p.tokko.search({...args,location:'San Miguel, Lima',max_price:500000});
  const quick=p.urls.filter(u=>u.pathname.includes('/quicksearch/'));
  assert.equal(quick.length,2);assert.equal(quick[1].searchParams.get('scope'),'minimal');assert.equal(quick[1].searchParams.get('q'),'San Miguel (Lima)');
  assert.deepEqual(result.resolvedLocation.ids,[250468]);assert.deepEqual(searchData(p)[0].current_localization_id,[250468]);
  assert.equal(result.properties[0].photos.length,16);
  assert.equal(searchData(p)[0].price_to,500000);assert.equal(searchData(p)[0].currency,'PEN');assert.deepEqual(searchData(p)[0].property_types,[2]);assert.deepEqual(searchData(p)[0].operation_types,[1]);
});
test('padres observados: no se inventa una localidad ni se usa un sector de otro distrito como reemplazo',()=>{
  assert.deepEqual(missingLocationParents([sanSector,otherSanSector],'San Miguel, Lima'),[{name:'San Miguel (Lima)',path:sanDistrict.full_location}]);
  assert.deepEqual(missingLocationParents([sanDistrict,sanSector],'San Miguel, Lima'),[]);
  assert.deepEqual(missingLocationParents([otherSanSector],'San Miguel, Lima'),[]);
});
test('tope realista: 100 resultados y next null no prueban que el padre no exista',async()=>{
  const urls=[];
  const filler=Array.from({length:98},(_,i)=>({id:90000000+i,name:'SOLO PRUEBA · Homónimo '+i,type:'Localidad',full_location:'Argentina | Provincia sintética | San Miguel '+i}));
  const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>{
    const u=new URL(input);urls.push(u);
    if(u.pathname.includes('/quicksearch/'))return u.searchParams.get('scope')==='minimal'?json({objects:[sanDistrict],meta:{total_count:1,next:null}}):json({objects:[sanSector,otherSanSector,...filler],meta:{total_count:100,next:null}});
    const d=JSON.parse(u.searchParams.get('data'));assert.deepEqual(d.current_localization_id,[250468]);return json({objects:[],meta:{total_count:0,next:null}});
  }});
  const result=await tokko.search({...args,location:'San Miguel, Lima'});
  assert.deepEqual(result.resolvedLocation.ids,[250468]);assert.equal(urls.filter(u=>u.pathname.includes('/quicksearch/')).length,2);
});
test('límite del proveedor sin padre recuperable se diferencia de un vacío y no solicita la misma confirmación',async()=>{
  const p=provider({missingParent:true}),h=scripted([call('search_properties',{...args,location:'San Miguel, Lima'}),answer()],p.tokko),s=state();
  const result=await h.chat(s,'SOLO PRUEBA · San Miguel, Lima');
  assert.equal(s.lastSearchAttempt.status,'location_unavailable');assert.equal(s.lastSearch.locationUnavailable,true);
  assert.deepEqual(result.properties,[]);assert.deepEqual(result.searches,[]);assert.equal(searchData(p).length,0);
  assert.equal(JSON.parse(h.bodies[1].input.at(-1).output).status,'location_unavailable');assert.deepEqual(context(h.bodies[1]).responseCards,[]);h.done();
});
test('lookup específico verifica la jerarquía y rechaza otro padre con el mismo nombre',async()=>{
  const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>{
    const u=new URL(input);assert.ok(u.pathname.includes('/quicksearch/'),'No se busca con un padre ajeno');
    return json({objects:u.searchParams.get('scope')==='minimal'?[{...sanDistrict,id:90001000,full_location:'Peru | Lima | Yauyos | San Miguel (Lima)'}]:[sanSector,otherSanSector]});
  }});
  assert.equal((await tokko.search({...args,location:'San Miguel, Lima'})).locationUnavailable,true);
});
test('fallo de la consulta precisa es error técnico y no exposición de claves o cuerpos privados',async()=>{
  const p=provider({failPrecise:true});
  await assert.rejects(p.tokko.search({...args,location:'San Miguel, Lima'}),error=>error.code==='upstream_error' && !error.message.includes('SYNTHETIC_PRIVATE_BODY'));
  assert.equal(searchData(p).length,0);
});
test('precios observados: Miraflores PEN 500000 sin coincidencias; PEN 1000000 incluye el dúplex tipo 2',async()=>{
  const p=provider();
  const low=await p.tokko.search({...args,max_price:500000});
  assert.equal(low.status,'no_matches');assert.deepEqual(low.properties,[]);
  const high=await p.tokko.search(args,{resolvedLocation:low.resolvedLocation});
  assert.equal(high.properties[0].id,7233794);assert.equal(high.properties[0].reference,'GAP7233794');assert.equal(high.properties[0].typeId,2);assert.equal(high.properties[0].area,170);
  assert.deepEqual(high.properties[0].operations[0].prices,publishedPrices.map(p=>({amount:p.price,currency:p.currency,period:p.period})));
  assert.equal(high.properties[0].photos.length,12);assert.equal(p.urls.filter(u=>u.pathname.includes('/quicksearch/')).length,1);
  assert.deepEqual(searchData(p).map(d=>d.price_to),[500000,1000000]);assert.ok(searchData(p).every(d=>d.only_available==='checked' && d.currency==='PEN'));
});
test('consulta por enlace e inventario general comparten el mismo ID, precios y 12 fotos sin excepción por referencia',async()=>{
  const p=provider({duplicates:true});
  const tokko=p.tokko; // El código real de fromUrl verifica la página pública SIMULADA contra las fotos de la fixture.
  const h=scripted([call('get_property',{url:'https://gruporentabilizarme.com/Propiedades/Detalle?id=7233794',property_id:null}),answer(),call('search_properties',args),answer()],tokko),s=state();
  const first=await h.chat(s,'SOLO PRUEBA · Consulta el enlace');assert.equal(first.properties[0].photos.length,12);
  const result=await h.chat(s,'SOLO PRUEBA · Busca hasta 1000000 soles');
  assert.equal(result.properties.length,1);assert.equal(result.searches[0].count,1);assert.equal(result.properties[0].id,7233794);
  assert.equal(s.properties.size,1);assert.equal(s.properties.get(7233794).photos.length,12);assert.deepEqual(s.lastResultIds,[7233794]);h.done();
});
test('cambios de distrito y presupuesto conservan contexto y no muestran tarjetas recordadas como resultados nuevos',async()=>{
  const p=provider(),h=scripted([call('search_properties',{...args,location:'San Miguel, Lima',max_price:500000}),answer(),call('search_properties',{location:'Miraflores'}),answer(),call('search_properties',{max_price:1000000}),answer()],p.tokko),s=state();
  const san=await h.chat(s,'SOLO PRUEBA · San Miguel hasta 500000');assert.equal(san.properties[0].photos.length,16);
  const empty=await h.chat(s,'SOLO PRUEBA · Mejor Miraflores');assert.deepEqual(empty.properties,[]);assert.equal(s.lastSearchAttempt.status,'no_matches');
  const found=await h.chat(s,'SOLO PRUEBA · Subo a 1000000');assert.deepEqual(found.properties.map(p=>p.id),[7233794]);
  assert.equal(s.properties.size,2);assert.equal(s.properties.get(80000001).photos.length,16);
  assert.deepEqual(context(h.bodies[3]).responseCards,[]);assert.deepEqual(context(h.bodies[5]).responseCards.map(p=>p.propertyId),[7233794]);
  assert.equal(s.searchCriteria.operation,1);assert.deepEqual(s.searchCriteria.property_types,[2]);assert.equal(s.searchCriteria.currency,'PEN');h.done();
});
test('la conversión de Tokko no se reemplaza por una comparación local entre monedas incompatibles',async()=>{
  const usdOnly=syntheticProperty(80000002,mirDistrict,11,[{currency:'USD',price:200000,period:0}]);
  const tokko=createTokko({apiKey:'synthetic-key',fetchImpl:async input=>{
    const u=new URL(input);
    if(u.pathname.includes('/quicksearch/'))return json({objects:[mirDistrict]});
    if(u.pathname.includes('/property/search/')){
      const d=JSON.parse(u.searchParams.get('data'));assert.equal(d.currency,'PEN');assert.equal(d.price_to,1000000);
      // Decisión monetaria del proveedor SIMULADA; no inventar tipo de cambio local.
      return json({objects:[usdOnly],meta:{total_count:1,next:null}});
    }
    return json(usdOnly);
  }});
  const result=await tokko.search(args);assert.equal(result.properties[0].operations[0].prices[0].currency,'USD');assert.equal(result.properties[0].operations[0].prices[0].amount,200000);
});
