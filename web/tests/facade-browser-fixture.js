// Exercise the actual served Three material, including GLSL compilation and
// emitted pixels. No scene lights: only window emission can color these walls.
window.testFacadeLights=()=>{
  const fixture=new Scene();fixture.background=new Color(0);
  const view=new PerspectiveCamera(65,1.5,.1,20000);
  let uniforms=createFacadeUniformsTest({modules:new Map(),quality:{level:'mobile'}},null);
  const material=createFacadeTest(uniforms,{textures:false,mobile:true});
  const geometry=new BufferGeometry(),mesh=new Mesh(geometry,material);fixture.add(mesh);
  function wall(style,size=96,party=0,kind=0){
    geometry.setAttribute('position',new BufferAttribute(new Float32Array([-size/2,0,0,size/2,0,0,size/2,size,0,-size/2,size,0]),3));
    geometry.setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),3));
    geometry.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,size,0,size,size,0,size]),2));
    geometry.setAttribute('color',new BufferAttribute(new Float32Array(Array(4).fill([.4,.2,.1]).flat()),3));
    geometry.setAttribute('aInfo',new BufferAttribute(new Float32Array(Array(4).fill([size,3.2,style*65536+1234,party]).flat()),4));
    geometry.setAttribute('aWall',new BufferAttribute(new Float32Array(Array(4).fill([size,0,3.5,kind]).flat()),4));
    geometry.setIndex([0,1,2,0,2,3]);geometry.computeBoundingSphere();
    view.position.set(0,size/2,size);view.lookAt(0,size/2,0);
  }
  function snapshot(night,time=0){
    uniforms.uNight.value=night;uniforms.uTime.value=time;
    renderer.render(fixture,view);
    const gl=renderer.getContext(),pixels=new Uint8Array(960*640*4);
    gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let lit=0,warm=0,cool=0;
    for(let i=0;i<pixels.length;i+=4){
      if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>10)lit++;
      if(pixels[i]>pixels[i+2]+10)warm++;
      if(pixels[i+2]>pixels[i]+10)cool++;
    }
    return {lit,warm,cool,pixels};
  }
  const results={};
  for(const [name,style] of [['homes',0],['offices',5]]){
    wall(style);
    const day=snapshot(0),night=snapshot(.9),later=snapshot(.9,1000);
    results[name]={day:day.lit,night:night.lit,warm:night.warm,cool:night.cool,
      stable:night.pixels.every((v,i)=>v===later.pixels[i])};
  }
  wall(0,96,96);results.party=snapshot(.9).lit;
  wall(0,96,0,1);results.roof=snapshot(.9).lit;
  wall(0,6000);results.unresolved=snapshot(.9).lit;
  uniforms=createLandmarkUniformsTest();
  const landmarkMaterial=createLandmarkFacadeTest(uniforms,true);mesh.material=landmarkMaterial;
  function landmark(size){
    wall(0,size);
    geometry.setAttribute('aStyle',new BufferAttribute(new Float32Array(4).fill(4),1));
    geometry.setAttribute('aParam',new BufferAttribute(new Float32Array(Array(4).fill([3.2,3,.7,0]).flat()),4));
    geometry.setAttribute('aParam2',new BufferAttribute(new Float32Array(Array(4).fill([0,.35,0,0]).flat()),4));
    geometry.setAttribute('aLmSeed',new BufferAttribute(new Float32Array(4).fill(1234),1));
  }
  landmark(96);
  const day=snapshot(0),night=snapshot(.9),later=snapshot(.9,1000);
  results.landmark={day:day.lit,night:night.lit,warm:night.warm,cool:night.cool,
    stable:night.pixels.every((v,i)=>v===later.pixels[i])};
  landmark(6000);results.landmarkUnresolved=snapshot(.9).lit;
  geometry.dispose();material.dispose();landmarkMaterial.dispose();renderer.render(new Scene(),view);
  return results;
};
