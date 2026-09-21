// Build, transfer and draw actual packed mobile geometry through the served worker.
window.testBuildingWorker=async(input)=>{
  const worker=new Worker('/world/assets/builder.worker-D9_Czkt3.js',{type:'module'});
  let timer;
  try {
    const built=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('building worker timed out')),15000);
      worker.onerror=event=>reject(Error(event.message));
      worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.tile);
      worker.postMessage({id:1,input:{key:'0_0',tx:0,tz:0,quality:'low',mobile:true,detailedIds:[],landmarkBins:[1],roads:[],
        buildings:[{id:1,height:100,floors:30,style:'glass',roofShape:'setback',footprint:[[[0,0],[40,0],[40,40],[0,40]]]}],...input}});
    });
    if(!(built.normal instanceof Int8Array)||!(built.color instanceof Uint8Array))throw Error('unpacked mobile buffers');
    const geometry=new BufferGeometry();
    for(const [name,key,size] of [['position','position',3],['normal','normal',3],['uv','uv',2],['color','color',3],['aInfo','info',4],['aWall','wall',4]])
      geometry.setAttribute(name,new BufferAttribute(built[key],size,built[key].BYTES_PER_ELEMENT===1));
    geometry.setIndex(new BufferAttribute(built.renderIndex,1));geometry.computeBoundingSphere();
    const material=createFacadeTest(createFacadeUniformsTest({modules:new Map(),quality:{level:'mobile'}},null),{textures:false,mobile:true});
    const fixture=new Scene();fixture.background=new Color(0);fixture.add(new HemisphereLight(0xffffff,0x666666,2));
    fixture.add(new Mesh(geometry,material));
    const view=new PerspectiveCamera(65,1.5,.1,10000);view.position.set(130,100,140);view.lookAt(20,50,20);
    if(input){view.position.set(380,300,500);view.lookAt(65,220,65);}
    renderer.render(fixture,view);
    const triangles=renderer.info.render.triangles;
    const gl=renderer.getContext(),pixels=new Uint8Array(960*640*4);gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let colored=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>10)colored++;
    const shot=input?renderer.domElement.toDataURL('image/png'):null;
    geometry.dispose();material.dispose();renderer.render(scene,camera);
    return{triangles,colored,colliders:built.colliders.length,shot};
  }finally{clearTimeout(timer);worker.terminate();}
};
