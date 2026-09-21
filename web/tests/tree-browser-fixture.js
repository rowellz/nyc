// Runs in the scenery browser harness with the shipped tree factory and textures.
window.testTrees=()=>{
  const root=new Group(),treeScene=new Scene();treeScene.background=new Color(0x9ab2c5);treeScene.add(root);
  treeScene.add(new HemisphereLight(0xffffff,0x666666,2));
  const sun=new DirectionalLight(0xffffff,2);sun.position.set(100,300,100);treeScene.add(sun);
  const view=new PerspectiveCamera(65,1.5,.1,10000);view.position.set(0,10,40);view.lookAt(0,8,0);
  const leaves={},crowns={};
  for(const arch of ['plane','locust','pear','ginkgo','oak']) {
    leaves[arch]=finishRecipe(leafRecipe(arch,256,null));
    crowns[arch]=finishRecipe(crownRecipe(arch,256));
  }
  const bark={map:null,normal:null,rough:null};
  const context={...ctx,camera:view,worldGroup:root,quality:{...ctx.quality,shadows:false},time:{sunDir:sun.position.clone().normalize()}};
  const shared={uTime:{value:0},uWind:{value:{x:0,y:0,length:()=>0}},uWetness:{value:0},uSafe:{value:{x:-10000,y:0,z:0}}};
  const trees=createTreesTest(context,root,{leaves,crowns,bark:{plane:bark,dark:bark,grey:bark},soil:bark},shared,()=>{});
  const tile={key:'0_0',roads:[],parks:[],sidewalks:[[[[-10,-12],[12,10],[10,12],[-12,-10]]]],trees:[{x:0,z:0,height:16,dbh:20,species:'London plane'}]};
  root.userData.sceneryTreeTiles=new Map([[tile.key,tile]]);
  trees.addTile(tile);
  let tick=0;
  const sample=()=>{
    trees.update(tick+=1);renderer.render(treeScene,view);
    return {batches:Object.fromEntries(root.children.filter(m=>m.isInstancedMesh&&m.count>0).map(m=>[m.name,m.count])),triangles:renderer.info.render.triangles};
  };
  const near=sample(),nearShot=renderer.domElement.toDataURL();
  const pit=root.children.find(m=>m.name==='env-tree-pits');
  const guard=root.children.find(m=>m.name==='env-tree-guards');
  const pitDirection=[pit.instanceMatrix.array[0],pit.instanceMatrix.array[2]];
  const guardDirection=guard?[guard.instanceMatrix.array[0],guard.instanceMatrix.array[2]]:null;
  view.position.z=140;const middle=sample(),middleShot=renderer.domElement.toDataURL();
  view.position.z=500;const far=sample();
  // Keep the far model large enough in the screenshot to inspect its silhouette.
  view.zoom=8;view.updateProjectionMatrix();sample();const farShot=renderer.domElement.toDataURL();
  view.zoom=1;view.updateProjectionMatrix();
  const distance=ctx.world.ios?2000:ctx.quality.level==='mobile'?3000:2000;
  view.position.z=distance-20;const extended=sample();
  const originalRange=context.quality.farDistance;
  context.quality.farDistance=100;const reduced=sample();
  context.quality.farDistance=originalRange;const restored=sample();
  trees.removeTile(tile.key);const fallback=sample();
  root.userData.sceneryTreeTiles.clear();const unloaded=sample();
  // Exercise actual decoded scenery records as well as the isolated handoff.
  root.userData.sceneryTreeTiles=worldGroup.userData.sceneryTreeTiles;
  view.position.copy(camera.position);view.lookAt(512,0,-1200);
  const streamed=sample();
  trees.dispose();for(const texture of [...Object.values(leaves),...Object.values(crowns)])texture.dispose();
  renderer.render(treeScene,view);
  return {near,middle,far,extended,reduced,restored,fallback,unloaded,streamed,pitDirection,guardDirection,remaining:root.children.length,shots:{near:nearShot,middle:middleShot,far:farShot}};
};
