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

// Read the actual GPU LOD weight at a point on a 400 m wall. Looking at a
// remote floor must not promote it; moving the camera to that floor must.
window.testFacadeSurfaceLod=()=>{
  const fixture=new Scene(),view=new PerspectiveCamera(65,1.5,.1,2000);
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([-200,0,0,200,0,0,200,400,0,-200,400,0]),3));
  geometry.setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),3));
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,400,0,400,400,0,400]),2));
  for(const [name,values] of [
    ['color',[.7,.66,.6]],['aInfo',[400,3.2,4*65536+1234,0]],['aWall',[400,0,3.5,0]],
    ['aStyle',[1]],['aParam',[3.2,3,1.5,2]],['aParam2',[0,.35,0,0]],['aLmSeed',[1234]],
  ])geometry.setAttribute(name,new BufferAttribute(new Float32Array(Array(4).fill(values).flat()),values.length));
  geometry.setIndex([0,1,2,0,2,3]);
  const mesh=new Mesh(geometry);fixture.add(mesh);
  const results={};
  for(const landmark of [false,true]){
    const material=landmark?createLandmarkFacadeTest(createLandmarkUniformsTest(),true)
      :createFacadeTest(createFacadeUniformsTest({modules:new Map(),quality:{level:'mobile'}},null),{textures:false,mobile:true});
    const compile=material.onBeforeCompile;
    material.onBeforeCompile=(shader,...args)=>{
      compile(shader,...args);
      shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`
        float weight = mobileSurfaceDetail(vWPos, fwidth(${landmark?'vFuv':'vUvM'}));
        gl_FragColor = vec4(weight, 1.0-weight, 0.0, 1.0);
      `);
    };
    material.customProgramCacheKey=()=>`surface-lod-probe-${landmark}`;
    mesh.material=material;
    const sample=(cameraY,targetY,z=24,x=0)=>{
      view.position.set(x,cameraY,z);view.lookAt(0,targetY,0);
      renderer.render(fixture,view);
      const gl=renderer.getContext(),pixel=new Uint8Array(4);
      gl.readPixels(480,320,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return [...pixel];
    };
    results[landmark?'landmark':'ordinary']={
      street:sample(8,8),upperFromStreet:sample(8,300),
      flying:sample(200,200),lowerFromAir:sample(300,8),crown:sample(380,380),
      horizontal:sample(200,200,24,300),transition:sample(200,200,192),
      outside:sample(200,200,244),
    };
    material.dispose();
  }
  geometry.dispose();renderer.render(new Scene(),view);
  return results;
};

// Compare the shortcut against the original always-compute-both path, using
// actual rendered pixels. Move across the detail boundary without changing
// geometry/materials: this must neither pop nor compile a new shader.
window.testFacadeDetailShortcut=()=>{
  const fixture=new Scene(),view=new PerspectiveCamera(65,1.5,.1,2000);
  fixture.add(new HemisphereLight(0xffffff,0x666666,2));
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([-400,0,0,400,0,0,400,800,0,-400,800,0]),3));
  geometry.setAttribute('normal',new BufferAttribute(new Float32Array(Array(4).fill([0,0,1]).flat()),3));
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,800,0,800,800,0,800]),2));
  geometry.setAttribute('color',new BufferAttribute(new Float32Array(Array(4).fill([.55,.5,.45]).flat()),3));
  geometry.setAttribute('aWall',new BufferAttribute(new Float32Array(Array(4).fill([800,1,3.5,0]).flat()),4));
  geometry.setAttribute('aInfo',new BufferAttribute(new Float32Array(16),4));
  geometry.setIndex([0,1,2,0,2,3]);
  const uniforms=createFacadeUniformsTest({modules:new Map(),quality:{level:'mobile'}},null);
  const fast=createFacadeTest(uniforms,{textures:false,mobile:true});
  const reference=createFacadeTest(uniforms,{textures:false,mobile:true});
  const compile=reference.onBeforeCompile;
  reference.onBeforeCompile=(shader,...args)=>{
    compile(shader,...args);
    const guard='if (detail < 1.0) {';
    if(shader.fragmentShader.split(guard).length!==3)throw Error('Facade comparison anchors changed');
    shader.fragmentShader=shader.fragmentShader.replaceAll(guard,'{');
  };
  reference.customProgramCacheKey=()=>`${fast.customProgramCacheKey()}-reference`;
  const mesh=new Mesh(geometry,fast);fixture.add(mesh);
  const gl=renderer.getContext(),actual=new Uint8Array(960*640*4),expected=new Uint8Array(actual.length);
  const results=[];
  for(const style of [0,4,5]){
    geometry.attributes.aInfo.array.set(Array(4).fill([800,3.2,style*65536+1234,0]).flat());
    geometry.attributes.aInfo.needsUpdate=true;
    for(const night of [0,.9])for(const distance of [24,96,192,244]){
      uniforms.uNight.value=night;uniforms.uWet.value=night>0?.65:0;
      view.position.set(0,200,distance);view.lookAt(0,200,0);
      mesh.material=reference;renderer.render(fixture,view);
      gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,expected);
      mesh.material=fast;renderer.render(fixture,view);
      gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,actual);
      let maxDifference=0,colored=0;
      for(let i=0;i<actual.length;i++){
        maxDifference=Math.max(maxDifference,Math.abs(actual[i]-expected[i]));
        if(i%4!==3&&actual[i]>10)colored++;
      }
      results.push({style,night,distance,maxDifference,colored});
    }
  }
  const programs=renderer.info.programs.length;
  for(const distance of [240,192,144,96,24,144,240]){
    view.position.z=distance;renderer.render(fixture,view);
  }
  const stablePrograms=renderer.info.programs.length===programs;
  geometry.dispose();fast.dispose();reference.dispose();renderer.render(new Scene(),view);
  return {results,stablePrograms};
};
